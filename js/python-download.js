import {nodeApi} from './node-bridge.js';
import {throwIfAborted} from './job-control.js';

const HOSTS = new Set(['github.com','objects.githubusercontent.com','release-assets.githubusercontent.com']);
export function pythonDownloadUrl(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||!HOSTS.has(url.hostname)||url.username||url.password||(url.port&&url.port!=='443'))throw Error('PYTHON_DOWNLOAD_URL');
  return url.href;
}

// Only the pinned public archive is requested. No cookies, credentials or local
// paths are sent. Electron's isolated net request honors the system proxy.
export async function downloadPython(build,destination,{signal,onProgress,request,net}={}) {
  throwIfAborted(signal);
  const {fs,crypto,Buffer}=nodeApi;
  let nativeNet=net||(!request&&nodeApi.net);
  if(!request&&!nativeNet){try{nativeNet=typeof window!=='undefined'&&window.require?.('@electron/remote')?.net;}catch{}}
  const url=pythonDownloadUrl(build.url);
  return new Promise((resolve,reject)=>{
    let current,response,output,descriptor,settled=false,created=false,bytes=0,redirects=0;
    const hash=crypto.createHash('sha256');
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const fail=error=>{
      if(settled)return;settled=true;cleanup();
      try{current?.abort?.();current?.destroy?.();response?.destroy?.();}catch{}
      if(output){output.once('close',()=>{if(created){try{fs.unlinkSync(destination);}catch{}}reject(error);});output.destroy();}
      else{if(created){try{fs.closeSync(descriptor);fs.unlinkSync(destination);}catch{}}reject(error);}
    };
    const abort=()=>{try{throwIfAborted(signal);}catch(error){fail(error);}};
    const timer=setTimeout(()=>fail(Error('PYTHON_DOWNLOAD')),600000);
    signal?.addEventListener('abort',abort,{once:true});
    function accept(incoming){
      response=incoming;
      if(incoming.statusCode!==200){fail(Error('PYTHON_DOWNLOAD'));return;}
      try{descriptor=fs.openSync(destination,'wx',0o600);created=true;output=fs.createWriteStream(destination,{fd:descriptor,autoClose:true});}
      catch(error){fail(error);return;}
      output.on('error',error=>fail(error));
      output.on('drain',()=>incoming.resume?.());
      incoming.on('error',()=>fail(Error('PYTHON_DOWNLOAD')));
      incoming.on('aborted',()=>fail(Error('PYTHON_DOWNLOAD')));
      incoming.on('data',chunk=>{
        if(settled)return;
        const data=Buffer.from(chunk);bytes+=data.length;
        if(bytes>build.bytes||bytes>128*1024*1024){fail(Error('PYTHON_SIZE'));return;}
        hash.update(data);if(!output.write(data))incoming.pause?.();
        onProgress?.(bytes/build.bytes);
      });
      incoming.on('end',()=>{
        if(settled)return;
        if(bytes!==build.bytes){fail(Error('PYTHON_SIZE'));return;}
        if(hash.digest('hex')!==build.sha256){fail(Error('PYTHON_CHECKSUM'));return;}
        output.once('close',()=>{if(settled)return;settled=true;cleanup();resolve();});output.end();
      });
    }
    function follow(location){
      if(++redirects>5)throw Error('PYTHON_DOWNLOAD_URL');
      return pythonDownloadUrl(location);
    }
    function nodeRequest(address){
      current=(request||nodeApi.https.get)(address,{headers:{'User-Agent':'ReferenceSync Python setup','Accept':'application/octet-stream'}},incoming=>{
        if([301,302,303,307,308].includes(incoming.statusCode)){
          incoming.resume();try{nodeRequest(follow(new URL(incoming.headers.location,address).href));}catch(error){fail(error);}
        }else accept(incoming);
      });
      current.on('error',()=>fail(Error('PYTHON_DOWNLOAD')));
    }
    try{
      if(nativeNet?.request){
        current=nativeNet.request({url,method:'GET',redirect:'manual',credentials:'omit',useSessionCookies:false,
          partition:'reference-sync-python-'+crypto.randomBytes(12).toString('hex')});
        current.on('redirect',(_status,_method,address)=>{try{follow(address);current.followRedirect();}catch(error){fail(error);}});
        current.on('error',()=>fail(Error('PYTHON_DOWNLOAD')));
        current.on('response',accept);current.end();
      }else nodeRequest(url);
      if(signal?.aborted)abort();
    }catch(error){fail(error);}
  });
}
