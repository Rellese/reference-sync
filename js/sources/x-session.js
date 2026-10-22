import {runEnginePython} from '../toolchain.js';
import {makeStopError} from '../job-control.js';
import {withBrowserSession,requestPrivatePython} from './private-session.js';
import {xApiScript} from './x-python.js';
export function xFailure(code){
 if(code==='JOB_STOPPED')return makeStopError();
 const message=code==='X_AUTH'?'В выбранном профиле браузера вход в X не выполнен. Войдите в нужный аккаунт и повторите поиск.'
 :code==='X_RATE_LIMIT'?'X ограничил запросы. Очередь остановлена; повторите позже.'
 :code==='X_COOKIES'?'Не удалось прочитать cookies X из выбранного профиля браузера.'
 :code==='X_FOLDERS'?'Не удалось получить папки закладок X. Для папок нужен X Premium; общий список доступен без поиска по папкам.'
 :'Не удалось получить данные X. Проверьте вход в выбранном браузере и соединение.';
 return Object.assign(Error(message),{code:code==='X_AUTH'?'X_SESSION_INVALID':code,sourceTitle:'X'});
}
export const withXSession=(options,action,run=runEnginePython)=>withBrowserSession('x',options,action,run,xFailure);
export const requestX=(spec,options,run=runEnginePython)=>requestPrivatePython('x',spec,options,run,xApiScript,xFailure);
export async function probeX(options){
 return withXSession(options,async next=>{
  try{const data=await requestX({operation:'probe'},next);
   return {authenticated:!!data.session?.username,username:data.session?.username||'',displayName:data.session?.name||'',status:'authenticated'};
  }catch(error){if(error.code==='X_SESSION_INVALID')return {authenticated:false,status:'signed-out'};throw error;}
 });
}
