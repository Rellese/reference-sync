import test from 'node:test';import assert from 'node:assert/strict';
import {readDribbblePage} from '../../js/sources/dribbble-page.js';
const url='https://dribbble.com/shots/123-Public';
function fixture(t,mode='ready'){
 const previous={window:globalThis.window,document:globalThis.document};let guest,button,removed=0,stopped=0;
 class Element extends EventTarget{
  constructor(tag){super();this.tag=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.style={};}
  append(...children){this.children.push(...children);if(this===doc.body&&mode!=='pending')queueMicrotask(()=>{guest.dispatchEvent(mode==='foreign'?Object.assign(new Event('did-navigate'),{url:'https://evil.test/shots/123'}):new Event('dom-ready'));});}
  appendChild(node){this.append(node);}
  setAttribute(k,v){this.attributes[k]=v;}remove(){removed++;}stop(){stopped++;}
  async executeJavaScript(){return mode==='captcha'?{challenge:true}:{html:'<html>Public shot</html>'};}
 }
 const doc={createTextNode:()=>new Element('text'),createElement(tag){const e=new Element(tag);if(tag==='webview')guest=e;if(tag==='button')button=e;return e;}};doc.body=new Element('body');
 const win=new EventTarget();win.crypto={randomUUID:()=> 'fixture'};globalThis.window=win;globalThis.document=doc;t.after(()=>Object.assign(globalThis,previous));
 return {doc,win,get guest(){return guest;},get button(){return button;},get removed(){return removed;},get stopped(){return stopped;}};
}
test('public guest reads DOM without Node, profile, preload or popups, then destroys its session',async t=>{
 const f=fixture(t);assert.equal(await readDribbblePage(url,{doc:f.doc}),'<html>Public shot</html>');
 assert.ok(!f.guest.attributes.partition.startsWith('persist:'));
 for(const p of ['sandbox=yes','contextIsolation=yes','nodeIntegration=no','nodeIntegrationInSubFrames=no','webSecurity=yes','allowRunningInsecureContent=no'])assert.ok(f.guest.attributes.webpreferences.includes(p));
 assert.equal(f.guest.attributes.preload,undefined);assert.equal(f.guest.attributes.allowpopups,undefined);assert.equal(f.removed,1);assert.equal(f.stopped,1);
});
for(const mode of ['captcha','foreign','abort','skip','timeout'])test('Dribbble guest '+mode+' cannot publish HTML and cleans up',async t=>{
 const f=fixture(t,['abort','skip','timeout'].includes(mode)?'pending':mode),controller=new AbortController();
 const pending=readDribbblePage(url,{doc:f.doc,signal:controller.signal,timeout:mode==='timeout'?10:2000});const rejection=assert.rejects(pending);await new Promise(r=>setImmediate(r));
 if(mode==='abort')controller.abort();if(mode==='skip')f.button.dispatchEvent(new Event('click'));await rejection;assert.equal(f.removed,1);assert.equal(f.stopped,1);
});
test('Dribbble guest refuses HTTP, foreign sites and account pages before navigation',async t=>{
 const f=fixture(t);for(const target of ['http://dribbble.com/shots/123','https://evil.test/shots/123','https://dribbble.com/collector/collections'])await assert.rejects(readDribbblePage(target,{doc:f.doc}));assert.equal(f.guest,undefined);
});
test('paused native page preserves its time budget and resumes reading',async t=>{
 const f=fixture(t,'pending'),control={isPaused:true,checkpoint:async()=>{}};
 const pending=readDribbblePage(url,{doc:f.doc,control,timeout:100});await new Promise(r=>setTimeout(r,300));assert.equal(f.removed,0);
 control.isPaused=false;f.guest.dispatchEvent(new Event('dom-ready'));assert.equal(await pending,'<html>Public shot</html>');assert.equal(f.removed,1);
});
