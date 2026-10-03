import {eagleApi} from '../node-bridge.js';
import {createGhostButton} from '../ui.js';
import {setUiText} from '../i18n.js';
import {makeStopError,throwIfAborted} from '../job-control.js';
import {VIMEO_CONFIG_SCRIPT,vimeoPlayerUrl} from './vimeo-config.js';

export function embeddedPlayerAvailable() {
 return Boolean(eagleApi && typeof document!=='undefined' && typeof window!=='undefined' && window.crypto?.randomUUID);
}

// No browser profile, preload, Node integration, persistent partition or popup
// access is given to the remote page. The guest is destroyed on every exit.
export async function captureVimeoConfig(target,{signal,control,timeout=45000,doc=document}={}) {
 await control?.checkpoint();throwIfAborted(signal);
 const root=doc.createElement('div');root.className='rs-modal is-open';
 const box=doc.createElement('div');box.className='rs-modal__box';box.style.width='min(720px, calc(100vw - 48px))';
 const title=doc.createElement('div');title.className='rs-modal__title';setUiText(title,'Получение видео Behance');
 const message=doc.createElement('div');setUiText(message,'Ожидайте загрузки плеера. Если видео недоступно, его можно пропустить.');
 const view=doc.createElement('webview');view.style.cssText='width:100%;height:min(360px,40vh);flex-shrink:0;background:#111';
 view.setAttribute('partition','reference-sync-vimeo-'+window.crypto.randomUUID());
 view.setAttribute('webpreferences','sandbox=yes,contextIsolation=yes,nodeIntegration=no,nodeIntegrationInSubFrames=no,webSecurity=yes,allowRunningInsecureContent=no');
 view.setAttribute('httpreferrer',target.referrer);
 const foot=doc.createElement('div');foot.className='rs-modal__foot';
 let finish,settled=false,poll,ready=false,busy=false,left=timeout,lastTick=Date.now();
 const skip=createGhostButton({label:'Пропустить видео',onClick:()=>finish(Error('Видеоблок пропущен пользователем.'))});
 foot.append(skip.node);box.append(title,message,view,foot);root.append(box);
 const abort=()=>finish(makeStopError());
 const unloading=()=>abort();
 try {
  return await new Promise((resolve,reject)=>{
   finish=(error,config)=>{if(settled)return;settled=true;error?reject(error):resolve(config);};
   const check=async()=>{
    if(settled)return;
    const now=Date.now(),elapsed=now-lastTick;lastTick=now;
    if(signal?.aborted||control?.isStopped){abort();return;}
    if(control?.isPaused)return;
    left-=elapsed;if(left<=0){finish(Error('Встроенный плеер не вернул видео за отведённое время.'));return;}
    if(!ready||busy)return;
    busy=true;
    try{
     await control?.checkpoint();throwIfAborted(signal);
     const config=await view.executeJavaScript(VIMEO_CONFIG_SCRIPT);
     if(config?.id)finish(null,config);
    }catch(error){if(error.code==='JOB_STOPPED')finish(error);}
    finally{busy=false;}
   };
   view.addEventListener('dom-ready',()=>{ready=true;check();});
   const navigation=e=>{const current=vimeoPlayerUrl(e.url);if(!current||current.id!==target.id)finish(Error('Плеер перенаправил на другую страницу.'));};
   view.addEventListener('did-navigate',navigation);
   view.addEventListener('did-fail-load',e=>{
    // ERR_ABORTED is normal when the player reloads after its page check.
    if(e.isMainFrame && e.errorCode!==-3)finish(Error('Не удалось открыть встроенный плеер.'));
   });
   view.addEventListener('new-window',()=>finish(Error('Плеер попытался открыть другое окно.')));
   signal?.addEventListener('abort',abort,{once:true});window.addEventListener('beforeunload',unloading,{once:true});
   poll=setInterval(check,250);
   if(signal?.aborted){abort();return;}
   view.setAttribute('src',target.url);doc.body.append(root);
  });
 }finally{
  clearInterval(poll);signal?.removeEventListener('abort',abort);window.removeEventListener('beforeunload',unloading);
  try{view.stop();}catch{/* Guest may not have attached yet. */}root.remove();
 }
}
