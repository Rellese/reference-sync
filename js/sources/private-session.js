import {nodeApi} from '../node-bridge.js';
import {browserCookieSpecForProfile} from '../browser-profiles.js';
import {createPrivateCookieFile,verifyPrivateCookieFile,removePrivateCookieFile} from '../private-cookies.js';
import {throwIfAborted,makeStopError} from '../job-control.js';
import {browserCookiesScript} from './private-python.js';

export async function withBrowserSession(site,options,action,run,failure){
 throwIfAborted(options.signal);const file=createPrivateCookieFile(site);
 try{
  const args=options.cookieFile?[file,'file',options.cookieFile]:[file,browserCookieSpecForProfile(options.browser||'chrome',options.browserProfile||'')];
  const result=await run(browserCookiesScript,[...args,...(args.length===2?['']:[]),site],{signal:options.signal,timeout:45000});
  throwIfAborted(options.signal);
  if(result.code)throw failure(site.toUpperCase()+'_COOKIES');
  verifyPrivateCookieFile(file);
  return await action({...options,cookieFile:file});
 }finally{removePrivateCookieFile(file);}
}
export async function requestPrivatePython(site,spec,options,run,script,failure){
 const file=createPrivateCookieFile(site+'-request');let controlFile,browserReply,timer,writeError,browserTask;
 const controller=new AbortController(),abort=()=>controller.abort();
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 try{
  await options.control?.checkpoint();throwIfAborted(options.signal);verifyPrivateCookieFile(options.cookieFile);
  if(site==='dribbble'&&typeof options.readBrowserPage==='function')browserReply=createPrivateCookieFile('dribbble-page');
  if(options.control){
   controlFile=createPrivateCookieFile(site+'-control');let previous='';
   const update=()=>{try{
    const value=JSON.stringify({paused:options.control.isPaused,stopped:options.control.isStopped});
    if(value!==previous){
     nodeApi.fs.writeFileSync(controlFile+'.tmp',value,{mode:0o600});verifyPrivateCookieFile(controlFile+'.tmp');
     nodeApi.fs.renameSync(controlFile+'.tmp',controlFile);previous=value;
    }
    if(options.control.isStopped)abort();
   }catch(error){writeError=error;abort();}};
   update();timer=setInterval(update,100);
  }
  nodeApi.fs.writeFileSync(file,JSON.stringify({...spec,cookies:options.cookieFile,control:controlFile,browserReply,speed:options.speedProfile}));verifyPrivateCookieFile(file);
  let buffer='';
  const result=await run(script,[file],{signal:controller.signal,timeout:spec.operation==='download'||['dribbble','layers','instagram'].includes(site)&&spec.operation==='discover'?3600000:300000,onStdout:chunk=>{
   buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();
   for(const line of lines)try{const data=JSON.parse(line);if(data.event==='progress')options.onProgress?.(data.found,data.ids);
    if(data.event==='browser-page'&&browserReply&&!browserTask){
     browserTask=(async()=>{
      let response;try{const html=await options.readBrowserPage(data.url,{signal:controller.signal,control:options.control});
       if(typeof html!=='string'||nodeApi.Buffer.byteLength(html,'utf8')>16*1024*1024)throw Error('DRIBBBLE_RESPONSE');
       response={url:data.url,html};}
      catch{response={url:data.url,error:'DRIBBBLE_CHALLENGE'};}
      if(controller.signal.aborted)return;
      verifyPrivateCookieFile(browserReply);nodeApi.fs.writeFileSync(browserReply,JSON.stringify(response));verifyPrivateCookieFile(browserReply);
     })().catch(error=>{writeError=error;abort();}).finally(()=>{browserTask=null;});
    }
   }catch{}
  }});
  throwIfAborted(options.signal);
  if(writeError)throw writeError;
  if(options.control?.isStopped)throw makeStopError();
  verifyPrivateCookieFile(options.cookieFile);
  let data;try{data=JSON.parse(result.stdout.trim().split('\n').pop());}catch{throw failure(site.toUpperCase()+'_RESPONSE');}
  if(result.code||data.error)throw failure(data.error||site.toUpperCase()+'_RESPONSE');
  return data;
 }finally{clearInterval(timer);controller.abort();await browserTask;options.signal?.removeEventListener('abort',abort);removePrivateCookieFile(browserReply);removePrivateCookieFile(controlFile);removePrivateCookieFile(file);}
}
