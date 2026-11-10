import {runEnginePython} from '../toolchain.js';
import {makeStopError} from '../job-control.js';
import {withBrowserSession,requestPrivatePython} from './private-session.js';
import {threadsScript} from './threads-python.js';
export function threadsFailure(code) {
  if (code === 'JOB_STOPPED') return makeStopError();
  const message = code === 'THREADS_AUTH' ? 'В выбранном профиле браузера вход в Threads не выполнен или доступ отклонён. Откройте сайт в этом профиле и повторите поиск.'
    : code === 'THREADS_RATE_LIMIT' ? 'Threads ограничил запросы. Поиск остановлен; повторите позже.'
    : code === 'THREADS_COOKIES' ? 'Не удалось прочитать cookies Threads из выбранного профиля браузера.'
    : code === 'THREADS_FORMAT' ? 'Не удалось прочитать все медиа публикации Threads. Неполная публикация не импортируется.'
    : code === 'THREADS_PAGING' ? 'Threads не подтвердил продолжение списка. Поиск остановлен, чтобы не выдать неполный список за полный.'
    : 'Не удалось получить данные Threads. Проверьте вход в выбранном браузере и соединение.';
  return Object.assign(Error(message), {code:code === 'THREADS_AUTH'?'THREADS_SESSION_INVALID':code,sourceTitle:'Threads'});
}
export const withThreadsSession=(options,action,run=runEnginePython)=>withBrowserSession('threads',options,action,run,threadsFailure);
export const requestThreads=(spec,options,run=runEnginePython)=>requestPrivatePython('threads',spec,options,run,threadsScript,threadsFailure);
export async function probeThreads(options) {
  return withThreadsSession(options,async next=>{
    try {
      const {session}=await requestThreads({operation:'probe'},next);
      if (!/^[A-Za-z0-9_.]{1,80}$/.test(session?.username || '')) throw threadsFailure('THREADS_RESPONSE');
      return {authenticated:true,username:session.username,status:'authenticated'};
    } catch(error) {
      if(error.code==='THREADS_SESSION_INVALID') return {authenticated:false,status:'signed-out'};
      throw error;
    }
  });
}
