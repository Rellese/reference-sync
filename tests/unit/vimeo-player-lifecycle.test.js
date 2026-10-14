import test from 'node:test';import assert from 'node:assert/strict';
import {captureVimeoConfig} from '../../js/case/vimeo-player.js';
const target={id:'123',url:'https://player.vimeo.com/video/123?muted=1',referrer:'https://www.behance.net/gallery/456/a'};
const config={id:'123',nodeAccess:false,duration:20,files:{}};
function fixture(t,mode='ready') {
 const originalDocument=globalThis.document,originalWindow=globalThis.window;
 let guest,button,removed=0,stopped=0;
 class Element extends EventTarget {
  constructor(tag){super();this.tag=tag;this.ownerDocument=doc;this.attributes={};this.children=[];this.style={};this.classList={contains:()=>false};}
  append(...nodes){this.children.push(...nodes);if(this===doc.body&&mode!=='pending')queueMicrotask(()=>{
   if(mode==='foreign')guest.dispatchEvent(Object.assign(new Event('did-navigate'),{url:'https://attacker.test/'}));
   else {guest.dispatchEvent(Object.assign(new Event('did-fail-load'),{isMainFrame:true,errorCode:-3}));guest.dispatchEvent(new Event('dom-ready'));}
  });}
  appendChild(node){this.append(node);}
  setAttribute(key,value){this.attributes[key]=value;}
  remove(){removed++;}
  stop(){stopped++;}
  async executeJavaScript(){return config;}
 }
 const doc={createElement(tag){const node=new Element(tag);if(tag==='webview')guest=node;if(tag==='button')button=node;return node;},createTextNode:()=>new Element('text')};doc.body=new Element('body');
 const win=new EventTarget();win.crypto={randomUUID:()=> 'fixture'};globalThis.document=doc;globalThis.window=win;
 t.after(()=>{globalThis.document=originalDocument;globalThis.window=originalWindow;});
 return {doc,win,get guest(){return guest;},get button(){return button;},get removed(){return removed;},get stopped(){return stopped;}};
}
test('embedded page has no Node/preload/profile/popups, accepts normal challenge reload and is destroyed after capture',async t=>{
 const f=fixture(t);assert.equal(await captureVimeoConfig(target,{doc:f.doc}),config);
 assert.equal(f.guest.attributes.src,target.url);assert.equal(f.guest.attributes.httpreferrer,target.referrer);
 assert.ok(!f.guest.attributes.partition.startsWith('persist:'));
 for(const preference of ['sandbox=yes','contextIsolation=yes','nodeIntegration=no','nodeIntegrationInSubFrames=no','webSecurity=yes','allowRunningInsecureContent=no'])assert.ok(f.guest.attributes.webpreferences.includes(preference));
 assert.equal(f.guest.attributes.preload,undefined);assert.equal(f.guest.attributes.allowpopups,undefined);assert.equal(f.removed,1);assert.equal(f.stopped,1);
});
test('Pause does not consume the player timeout or mark the case failed',async t=>{
 const f=fixture(t,'pending'),control={isPaused:true,checkpoint:async()=>{}};
 const pending=captureVimeoConfig(target,{doc:f.doc,control,timeout:150});
 await new Promise(resolve=>setTimeout(resolve,300));assert.equal(f.removed,0);
 control.isPaused=false;f.guest.dispatchEvent(new Event('dom-ready'));
 assert.equal(await pending,config);assert.equal(f.removed,1);
});
for(const mode of ['signal','control','skip','timeout','foreign','unload'])test(`embedded player ${mode} destroys the guest and removes the overlay`,async t=>{
 const f=fixture(t,mode==='foreign'?'foreign':'pending'),controller=new AbortController(),control={isStopped:false,checkpoint:async()=>{}};
 const pending=captureVimeoConfig(target,{doc:f.doc,signal:controller.signal,control,timeout:mode==='timeout'?20:2000});
 const rejected=assert.rejects(pending,mode==='signal'||mode==='control'||mode==='unload'?{code:'JOB_STOPPED'}:undefined);
 await new Promise(resolve=>setImmediate(resolve));
 if(mode==='signal')controller.abort();if(mode==='control')control.isStopped=true;
 if(mode==='skip')f.button.dispatchEvent(new Event('click'));if(mode==='unload')f.win.dispatchEvent(new Event('beforeunload'));
 await rejected;
 assert.equal(f.removed,1);assert.equal(f.stopped,1);
});
