import {runEnginePython} from '../toolchain.js';
import {makeStopError} from '../job-control.js';
import {withBrowserSession,requestPrivatePython} from './private-session.js';
import {layersApiScript} from './layers-python.js';
export function layersFailure(code){
 if(code==='JOB_STOPPED')return makeStopError();
 const message=code==='LAYERS_AUTH'?'В выбранном профиле браузера вход в Layers не выполнен или доступ отклонён. Откройте сайт в этом профиле и повторите поиск.'
 :code==='LAYERS_RATE_LIMIT'?'Layers ограничил запросы. Очередь остановлена; повторите позже.'
 :code==='LAYERS_COOKIES'?'Не удалось прочитать cookies Layers из выбранного профиля браузера.'
 :code==='LAYERS_FORMAT'?'Формат медиа Layers не поддерживается. Работа не будет импортирована неполностью.'
 :'Не удалось получить данные Layers. Проверьте вход в выбранном браузере и соединение.';
 return Object.assign(Error(message),{code:code==='LAYERS_AUTH'?'LAYERS_SESSION_INVALID':code,sourceTitle:'Layers'});
}
export const withLayersSession=(options,action,run=runEnginePython)=>withBrowserSession('layers',options,action,run,layersFailure);
export const requestLayers=(spec,options,run=runEnginePython)=>requestPrivatePython('layers',spec,options,run,layersApiScript,layersFailure);
export async function probeLayers(options){
 return withLayersSession(options,async next=>{
  try{const data=await requestLayers({operation:'probe'},next),username=String(data.session?.username||'');
   if(!/^[A-Za-z0-9_.-]{1,80}$/.test(username))throw layersFailure('LAYERS_RESPONSE');
   return {authenticated:true,username,displayName:String(data.session?.name||username),status:'authenticated'};
  }catch(error){if(error.code==='LAYERS_SESSION_INVALID')return {authenticated:false,status:'signed-out'};throw error;}
 });
}
