import {runEnginePython} from '../toolchain.js';
import {makeStopError} from '../job-control.js';
import {withBrowserSession,requestPrivatePython} from './private-session.js';
import {dribbbleApiScript} from './dribbble-python.js';
import {dribbbleBrowserIdentity} from './dribbble-browser.js';
import {dribbblePageAvailable,readDribbblePage} from './dribbble-page.js';
export function dribbbleFailure(code){
 if(code==='JOB_STOPPED')return makeStopError();
 const message=code==='DRIBBBLE_AUTH'?'В выбранном профиле браузера вход в Dribbble не выполнен или запрос заблокирован. Проверьте доступ в браузере и повторите поиск.'
 :code==='DRIBBBLE_CHALLENGE'?'Dribbble запросил проверку браузера. Откройте сайт в выбранном профиле, обновите страницу и повторите поиск.'
 :code==='DRIBBBLE_RATE_LIMIT'?'Dribbble ограничил запросы. Очередь остановлена; повторите позже.'
 :code==='DRIBBBLE_COOKIES'?'Не удалось прочитать cookies Dribbble из выбранного профиля браузера.'
 :code==='DRIBBBLE_FORMAT'?'Структура шота Dribbble не поддерживается. Публикация не будет импортирована частично.'
 :'Не удалось получить данные Dribbble. Проверьте вход в выбранном браузере и соединение.';
 return Object.assign(Error(message),{code:code==='DRIBBBLE_AUTH'?'DRIBBBLE_SESSION_INVALID':code,sourceTitle:'Dribbble'});
}
export const withDribbbleSession=(options,action,run=runEnginePython)=>withBrowserSession('dribbble',options,action,run,dribbbleFailure);
export const requestDribbble=(spec,options,run=runEnginePython)=>requestPrivatePython('dribbble',{...spec,identity:options.requestIdentity||dribbbleBrowserIdentity(options.browser,options.browserProfile)},
 {...options,readBrowserPage:options.readBrowserPage||(dribbblePageAvailable()?readDribbblePage:undefined)},run,dribbbleApiScript,dribbbleFailure);
export async function probeDribbble(options){
 return withDribbbleSession(options,async next=>{
  try{const data=await requestDribbble({operation:'probe'},next);
   const username=String(data.session?.username||'');
   if(!/^[A-Za-z0-9_-]{1,80}$/.test(username))throw dribbbleFailure('DRIBBBLE_RESPONSE');
   return {authenticated:true,username,displayName:String(data.session?.name||username),status:'authenticated'};
  }catch(error){if(error.code==='DRIBBBLE_SESSION_INVALID')return {authenticated:false,status:'signed-out'};throw error;}
 });
}
