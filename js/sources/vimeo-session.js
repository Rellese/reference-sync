import {nodeApi} from '../node-bridge.js';
import {runEnginePython} from '../toolchain.js';
import {browserCookieSpecForProfile} from '../browser-profiles.js';
import {createPrivateCookieFile,verifyPrivateCookieFile,removePrivateCookieFile} from '../private-cookies.js';
import {throwIfAborted,makeStopError} from '../job-control.js';
import {vimeoCookiesScript,vimeoApiScript} from './vimeo-python.js';

export function vimeoFailure(code){
 if(code==='JOB_STOPPED')return makeStopError();
 const message=code==='VIMEO_AUTH' ? 'В выбранном профиле браузера вход в Vimeo не выполнен. Войдите в нужный аккаунт и повторите поиск.'
  : code==='VIMEO_RATE_LIMIT' ? 'Vimeo ограничил запросы. Очередь остановлена; повторите позже.'
  : code==='VIMEO_COOKIES' ? 'Не удалось прочитать cookies Vimeo из выбранного профиля браузера.'
  : code==='VIMEO_DOWNLOAD' ? 'Vimeo не разрешил скачать это видео. Проверьте доступ в выбранном браузере.'
  : 'Не удалось получить данные Vimeo. Проверьте вход в выбранном браузере и соединение.';
 return Object.assign(new Error(message),{code:code==='VIMEO_AUTH'?'VIMEO_SESSION_INVALID':code,sourceTitle:'Vimeo'});
}
export async function withVimeoSession(options,action,run=runEnginePython){
 throwIfAborted(options.signal);const file=createPrivateCookieFile('vimeo');
 try{
  const args=options.cookieFile?[file,'file',options.cookieFile]:[file,browserCookieSpecForProfile(options.browser||'chrome',options.browserProfile||'')];
  const result=await run(vimeoCookiesScript,args,{signal:options.signal,timeout:45000});
  throwIfAborted(options.signal);
  if(result.code)throw vimeoFailure('VIMEO_COOKIES');
  verifyPrivateCookieFile(file);
  return await action({...options,cookieFile:file});
 }finally{removePrivateCookieFile(file);}
}
export async function requestVimeo(spec,options,run=runEnginePython,script=vimeoApiScript){
 const file=createPrivateCookieFile('vimeo-request');let controlFile,timer,writeError;
 const controller=new AbortController(),abort=()=>controller.abort();
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 try{
  await options.control?.checkpoint();throwIfAborted(options.signal);verifyPrivateCookieFile(options.cookieFile);
  if(options.control){
   controlFile=createPrivateCookieFile('vimeo-control');let previous='';
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
  nodeApi.fs.writeFileSync(file,JSON.stringify({...spec,cookies:options.cookieFile,control:controlFile,speed:options.speedProfile}));verifyPrivateCookieFile(file);
  let buffer='';
  const result=await run(script,[file],{signal:controller.signal,timeout:spec.operation==='download'?3600000:300000,onStdout:chunk=>{
   buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();
   for(const line of lines)try{const data=JSON.parse(line);if(data.event==='progress')options.onProgress?.(data.found,data.ids);}catch{}
  }});
  throwIfAborted(options.signal);
  if(writeError)throw writeError;
  if(options.control?.isStopped)throw makeStopError();
  verifyPrivateCookieFile(options.cookieFile);
  let data;try{data=JSON.parse(result.stdout.trim().split('\n').pop());}catch{throw vimeoFailure('VIMEO_RESPONSE');}
  if(result.code||data.error)throw vimeoFailure(data.error||'VIMEO_RESPONSE');
  return data;
 }finally{clearInterval(timer);options.signal?.removeEventListener('abort',abort);removePrivateCookieFile(controlFile);removePrivateCookieFile(file);}
}
export async function probeVimeo(options){
 return withVimeoSession(options,async next=>{
  try{
   const data=await requestVimeo({operation:'probe'},next),id=String(data.session?.uri||'').match(/^\/users\/(\d+)$/)?.[1];
   return {authenticated:!!id,username:id?'user'+id:'',displayName:data.session?.name||'',status:id?'authenticated':'signed-out'};
  }catch(error){if(error.code==='VIMEO_SESSION_INVALID')return {authenticated:false,status:'signed-out'};throw error;}
 });
}
