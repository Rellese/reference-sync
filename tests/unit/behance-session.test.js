import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {nodeApi} from '../../js/node-bridge.js';
import {behanceChallengeCookie,behanceCookieText,withBehanceSession} from '../../js/sources/behance-session.js';
const token='a'.repeat(128);
const challenge=`<script>document.cookie = "js_challenge_value=${token}; Path=/";window.location.reload();</script>`;
test('Behance accepts only a literal expected challenge; never evaluates script',()=>{
 assert.equal(behanceChallengeCookie(challenge),token);
 for(const text of ['document.cookie=stealCookies()','document.cookie="other=abc; Path=/"','document.cookie="js_challenge_value=evil(); Path=/"']) assert.equal(behanceChallengeCookie(text),'');
 const result=behanceCookieText('#HttpOnly_.behance.net\tTRUE\t/\tTRUE\t0\tsession\ttest\n.evilbehance.net\tTRUE\t/\tTRUE\t0\tsecret\tno\nwww.behance.net\tFALSE\t/\tTRUE\t0\tjs_challenge_value\told\n',token);
 assert.ok(result.includes('session\ttest'));
 assert.ok(result.includes(token));
 assert.ok(!result.includes('secret')&&!result.includes('old'));
});
for(const outcome of ['success','failure','cancel']) test(`Behance temporary session cleans up after ${outcome}`,async t=>{
 const before={...nodeApi}; const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rs-session-test-'));
 t.after(()=>{Object.assign(nodeApi,before);fs.rmSync(dir,{recursive:true,force:true});});
 const original=path.join(dir,'input'); const initial='.behance.net\tTRUE\t/\tTRUE\t0\tsession\tfixture\n';fs.writeFileSync(original,initial);
 const controller=new AbortController(); let prepared;
 Object.assign(nodeApi,{available:true,fs,path,crypto,os:{...os,homedir:()=>dir},https:{get(options,callback){
   assert.equal(options.hostname,'www.behance.net');
   const request=new EventEmitter();request.destroy=e=>request.emit('error',e);
   queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=403;response.setEncoding=()=>{};response.resume=()=>{};callback(response);response.emit('data',challenge);response.emit('end');});
   return request;
 }}});
 const run=()=>withBehanceSession({cookieFile:original,signal:controller.signal},'https://www.behance.net/gallery/1/',async options=>{
   prepared=options.cookieFile;assert.ok(fs.readFileSync(prepared,'utf8').includes(token));
   if(outcome==='failure') throw Error('download failed');
   if(outcome==='cancel') {controller.abort();throw Error('cancelled');}
   return 42;
 });
 if(outcome==='success') assert.equal(await run(),42); else await assert.rejects(run());
 assert.ok(prepared&&!fs.existsSync(prepared));assert.equal(fs.readFileSync(original,'utf8'),initial);
});

test('Behance refuses unknown challenges and redirects outside its host, cleaning temporary files', async t=>{
 const before={...nodeApi};const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rs-session-refusal-'));
 t.after(()=>{Object.assign(nodeApi,before);fs.rmSync(directory,{recursive:true,force:true});});
 const original=path.join(directory,'input');fs.writeFileSync(original,'# Netscape HTTP Cookie File\n');
 for(const status of [302,403]) {
  let calls=0;
  Object.assign(nodeApi,{available:true,fs,path,crypto,os:{...os,homedir:()=>directory,tmpdir:()=>directory},https:{get(options,callback){
   calls++;const request=new EventEmitter();request.destroy=error=>request.emit('error',error);
   queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=status;response.headers={location:'https://outside.example/'};response.resume=()=>{};response.setEncoding=()=>{};callback(response);response.emit('data','<script>runUnknownCode()</script>');response.emit('end');});return request;
  }}});
  await assert.rejects(withBehanceSession({cookieFile:original},'https://www.behance.net/gallery/1/a',()=>assert.fail('must not download')));
  assert.equal(calls,1);assert.ok(!fs.readdirSync(path.join(directory,'.reference-sync','cookie-cache'),{recursive:true}).some(name=>String(name).endsWith('.txt')));
 }
});
