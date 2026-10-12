import {eagleApi} from '../node-bridge.js';
import {throwIfAborted,makeStopError} from '../job-control.js';
import {dribbbleTarget} from './dribbble-target.js';
import {setUiText} from '../i18n.js';
export const dribbblePageAvailable=()=>Boolean(eagleApi&&typeof document!=='undefined'&&window.crypto?.randomUUID);
// Public shot only, no browser profile/cookies/preload/Node access. Destroy on exit.
export async function readDribbblePage(url,{signal,control,timeout=45000,doc=document}={}){
 const target=dribbbleTarget(url);if(target.type!=='POST')throw Error('DRIBBBLE_URL');
 await control?.checkpoint();throwIfAborted(signal);
 const root=doc.createElement('div');root.className='rs-modal is-open';
 const box=doc.createElement('div');box.className='rs-modal__box';
 const title=doc.createElement('div');title.textContent='Dribbble';
 const message=doc.createElement('div');setUiText(message,'Открываем страницу публикации…');
 const view=doc.createElement('webview');view.style.cssText='width:100%;height:min(420px,50vh)';
 view.setAttribute('partition','reference-sync-dribbble-'+window.crypto.randomUUID());
 view.setAttribute('webpreferences','sandbox=yes,contextIsolation=yes,nodeIntegration=no,nodeIntegrationInSubFrames=no,webSecurity=yes,allowRunningInsecureContent=no');
 const skip=doc.createElement('button');setUiText(skip,'Пропустить');box.append(title,message,view,skip);root.append(box);
 let finish,poll,ready=false,busy=false,left=timeout,tick=Date.now();
 const abort=()=>finish(makeStopError());
 try{return await new Promise((resolve,reject)=>{
  let settled=false;finish=(error,html)=>{if(settled)return;settled=true;error?reject(error):resolve(html);};
  skip.addEventListener('click',()=>finish(Error('DRIBBBLE_CHALLENGE')));
  const check=async()=>{
   if(settled)return;const now=Date.now(),elapsed=now-tick;tick=now;
   if(signal?.aborted||control?.isStopped){abort();return;}if(control?.isPaused)return;
   if((left-=elapsed)<=0){finish(Error('DRIBBBLE_CHALLENGE'));return;}if(!ready||busy)return;busy=true;
   try{
    const data=await view.executeJavaScript(`(()=>{const p=location.pathname.match(/^\\/shots\\/(\\d+)(?:-[^/]+)?\\/?$/);if(location.protocol!=='https:'||location.hostname!=='dribbble.com'||!p||p[1]!==${JSON.stringify(target.id)})return null;if(document.querySelector('form[action*="captcha"],#captcha-container'))return {challenge:true};if(!document.querySelector('h1.shot-header__title')||!document.querySelector('#ssr-app,.main-shot'))return null;const html=document.documentElement.outerHTML;return html.length<=16777216?{html}:null;})()`);
    if(data?.challenge)finish(Error('DRIBBBLE_CHALLENGE'));else if(data?.html)finish(null,data.html);
   }catch{}finally{busy=false;}
  };
  view.addEventListener('dom-ready',()=>{ready=true;check();});
  view.addEventListener('did-navigate',e=>{try{const next=dribbbleTarget(e.url);if(next.type!=='POST'||next.id!==target.id)finish(Error('DRIBBBLE_URL'));}catch{finish(Error('DRIBBBLE_URL'));}});
  view.addEventListener('new-window',()=>finish(Error('DRIBBBLE_URL')));
  view.addEventListener('did-fail-load',e=>{if(e.isMainFrame&&e.errorCode!==-3)finish(Error('DRIBBBLE_CHALLENGE'));});
  signal?.addEventListener('abort',abort,{once:true});window.addEventListener('beforeunload',abort,{once:true});
  poll=setInterval(check,250);view.setAttribute('src',target.url);doc.body.append(root);
 });}finally{clearInterval(poll);signal?.removeEventListener('abort',abort);window.removeEventListener('beforeunload',abort);try{view.stop();}catch{}root.remove();}
}
