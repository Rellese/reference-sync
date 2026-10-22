import {makeStopError} from '../job-control.js';
import {withBrowserSession,requestPrivatePython} from './private-session.js';
import {runEnginePython} from '../toolchain.js';
import {vimeoApiScript} from './vimeo-python.js';

export function vimeoFailure(code){
 if(code==='JOB_STOPPED')return makeStopError();
 const message=code==='VIMEO_AUTH' ? 'В выбранном профиле браузера вход в Vimeo не выполнен. Войдите в нужный аккаунт и повторите поиск.'
  : code==='VIMEO_RATE_LIMIT' ? 'Vimeo ограничил запросы. Очередь остановлена; повторите позже.'
  : code==='VIMEO_COOKIES' ? 'Не удалось прочитать cookies Vimeo из выбранного профиля браузера.'
  : code==='VIMEO_DOWNLOAD' ? 'Vimeo не разрешил скачать это видео. Проверьте доступ в выбранном браузере.'
  : 'Не удалось получить данные Vimeo. Проверьте вход в выбранном браузере и соединение.';
 return Object.assign(new Error(message),{code:code==='VIMEO_AUTH'?'VIMEO_SESSION_INVALID':code,sourceTitle:'Vimeo'});
}
export const withVimeoSession=(options,action,run=runEnginePython)=>withBrowserSession('vimeo',options,action,run,vimeoFailure);
export const requestVimeo=(spec,options,run=runEnginePython,script=vimeoApiScript)=>requestPrivatePython('vimeo',spec,options,run,script,vimeoFailure);
export async function probeVimeo(options){
 return withVimeoSession(options,async next=>{
  try{
   const data=await requestVimeo({operation:'probe'},next),id=String(data.session?.uri||'').match(/^\/users\/(\d+)$/)?.[1];
   return {authenticated:!!id,username:id?'user'+id:'',displayName:data.session?.name||'',status:id?'authenticated':'signed-out'};
  }catch(error){if(error.code==='VIMEO_SESSION_INVALID')return {authenticated:false,status:'signed-out'};throw error;}
 });
}
