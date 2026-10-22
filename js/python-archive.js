import {nodeApi} from './node-bridge.js';
import {throwIfAborted} from './job-control.js';
const LIMIT=512*1024*1024;
const invalid=()=>{throw Error('PYTHON_ARCHIVE');};
function text(block,start,length){return block.subarray(start,start+length).toString('utf8').split('\0')[0];}
function number(block,start,length){const value=text(block,start,length).trim();if(!/^[0-7]*$/.test(value))invalid();return parseInt(value||'0',8);}
export function pythonArchivePath(name){
  name=name.replace(/\/$/,'');
  if(!name||/[\\:\x00-\x1f\x7f]/.test(name)||name.length>2048)invalid();
  const parts=name.split('/');if(parts[0]!=='python'||parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)))invalid();
  // Prevent Win32 device aliases and alternate filesystem interpretations.
  if(parts.some(p=>/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))invalid();
  return name;
}
function pax(buffer){
  const values={};let offset=0;
  while(offset<buffer.length){
    const space=buffer.indexOf(32,offset);if(space<0)invalid();
    const length=Number(buffer.subarray(offset,space).toString());
    if(!Number.isSafeInteger(length)||length<=space-offset+2||offset+length>buffer.length||buffer[offset+length-1]!==10)invalid();
    const record=buffer.subarray(space+1,offset+length-1).toString('utf8'),equal=record.indexOf('=');if(equal<1)invalid();
    values[record.slice(0,equal)]=record.slice(equal+1);offset+=length;
  }
  return values;
}
// Uncompress to a bounded private file, then extract regular files before links.
// No external tar command, archive script, special file or out-of-root link runs.
export async function extractPython(archive,root,{signal,platform=process.platform,onProgress}={}){
  const {fs,path,stream,zlib,Buffer}=nodeApi;
  const tar=path.join(root,'python-install.tar');let size=0,fd,ownedTar=false;
  const input=fs.createReadStream(archive),output=fs.createWriteStream(tar,{flags:'wx',mode:0o600});
  output.once('open',()=>ownedTar=true);
  const bound=new stream.Transform({transform(chunk,_encoding,done){size+=chunk.length;done(size>LIMIT?Error('PYTHON_SIZE'):null,chunk);}});
  const abort=()=>input.destroy(Object.assign(Error('JOB_STOPPED'),{code:'JOB_STOPPED'}));
  signal?.addEventListener('abort',abort,{once:true});
  try{
    throwIfAborted(signal);
    await new Promise((resolve,reject)=>stream.pipeline(input,zlib.createGunzip(),bound,output,error=>error?reject(error):resolve()));
    throwIfAborted(signal);fd=fs.openSync(tar,'r');
    const destination=path.join(root,'unpacked');fs.mkdirSync(destination,{mode:0o700});
    const read=(length,offset)=>{const data=Buffer.alloc(length);if(fs.readSync(fd,data,0,length,offset)!==length)invalid();return data;};
    let offset=0,count=0,metadata={},longName='',longLink='',ended=false;
    const seen=new Set(),links=[];
    while(offset+512<=size){
      throwIfAborted(signal);if(++count>50000)invalid();
      const header=read(512,offset);offset+=512;
      if(header.every(byte=>byte===0)){
        if(offset+512>size||!read(512,offset).every(byte=>byte===0))invalid();
        // Do not accept concatenated/hidden archives after the tar terminator.
        for(let at=offset+512;at<size;at+=65536)if(!read(Math.min(65536,size-at),at).every(byte=>byte===0))invalid();
        ended=true;break;
      }
      const checksum=number(header,148,8);let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:header[i];if(checksum!==sum)invalid();
      const length=number(header,124,12),mode=number(header,100,8),type=text(header,156,1)||'0';
      const next=offset+Math.ceil(length/512)*512;if(next>size||length>LIMIT)invalid();
      let name=text(header,0,100),prefix=text(header,257,6)==='ustar'?text(header,345,155):'';if(prefix)name=prefix+'/'+name;
      if(['x','g','L','K'].includes(type)){
        if(length>1024*1024)invalid();const data=read(length,offset);
        if(type==='x')metadata=pax(data);
        else if(type==='g'){const global=pax(data);if(global.path||global.linkpath||global.size)invalid();}
        else if(type==='L')longName=data.toString('utf8').replace(/\0.*$/s,'').replace(/\n$/,'');
        else longLink=data.toString('utf8').replace(/\0.*$/s,'').replace(/\n$/,'');
        offset=next;continue;
      }
      name=pythonArchivePath(metadata.path||longName||name);
      if(metadata.size!==undefined&&Number(metadata.size)!==length)invalid();
      const identity=name.toLowerCase();if(seen.has(identity))invalid();seen.add(identity);
      const target=path.join(destination,...name.split('/'));
      if(type==='5'){
        if(length)invalid();fs.mkdirSync(target,{recursive:true,mode:0o700});
      }else if(type==='0'){
        fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
        const writer=fs.openSync(target,'wx',mode&0o111?0o700:0o600);
        try{for(let at=0;at<length;at+=65536){throwIfAborted(signal);const data=read(Math.min(65536,length-at),offset+at);let wrote=0;while(wrote<data.length)wrote+=fs.writeSync(writer,data,wrote,data.length-wrote);}}
        finally{fs.closeSync(writer);}
      }else if(type==='1'||type==='2'){
        if(length)invalid();const link=metadata.linkpath||longLink||text(header,157,100);
        if(!link||path.posix.isAbsolute(link)||/[\\:\x00-\x1f]/.test(link))invalid();
        const relative=pythonArchivePath(path.posix.normalize(type==='1'?link:path.posix.join(path.posix.dirname(name),link)));
        links.push({name,target,relative,type});
      }else invalid();
      metadata={};longName=longLink='';offset=next;
      if(count%50===0){onProgress?.(offset/size);await new Promise(resolve=>setTimeout(resolve,0));}
    }
    const pythonRoot=path.join(destination,'python');
    if(!ended||!fs.existsSync(pythonRoot)||!fs.lstatSync(pythonRoot).isDirectory()||fs.lstatSync(pythonRoot).isSymbolicLink())invalid();
    const pending=new Map(links.map(link=>[link.name,link]));
    function resolveLink(name,trail=new Set()){
      if(trail.has(name))invalid();trail.add(name);const link=pending.get(name);
      if(link)return resolveLink(link.relative,trail);
      const target=path.join(destination,...name.split('/'));if(!fs.existsSync(target))invalid();return target;
    }
    for(const link of links){
      throwIfAborted(signal);const resolved=resolveLink(link.relative);
      fs.mkdirSync(path.dirname(link.target),{recursive:true,mode:0o700});
      if(link.type==='1'||platform==='win32'){
        if(!fs.statSync(resolved).isFile())invalid();fs.linkSync(resolved,link.target);
      }else fs.symlinkSync(path.posix.relative(path.posix.dirname(link.name),link.relative),link.target);
    }
    onProgress?.(1);return destination;
  }finally{signal?.removeEventListener('abort',abort);if(fd!==undefined)fs.closeSync(fd);if(ownedTar){try{fs.unlinkSync(tar);}catch{}}}
}
