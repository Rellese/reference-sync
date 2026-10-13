import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
globalThis.require=createRequire(import.meta.url);
const {nodeApi}=await import('../../js/node-bridge.js'),{requestPrivatePython}=await import('../../js/sources/private-session.js');
const {createPrivateCookieFile,removePrivateCookieFile}=await import('../../js/private-cookies.js');
for(const cancelled of [false,true])test('native page reply is private and removed after '+(cancelled?'cancellation':'success'),async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-browser-reply-')),original=nodeApi.os.homedir;nodeApi.os.homedir=()=>root;
 t.after(()=>{nodeApi.os.homedir=original;fs.rmSync(root,{recursive:true,force:true});});
 const cookieFile=createPrivateCookieFile('dribbble'),controller=new AbortController();let reply;
 const readBrowserPage=async(url,{signal})=>{
  assert.equal(url,'https://dribbble.com/shots/123-Public');
  if(cancelled)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));
  return '<html>public</html>';
 };
 const run=async(script,args,options)=>{
  const spec=JSON.parse(fs.readFileSync(args[0],'utf8'));reply=spec.browserReply;
  assert.equal(fs.statSync(reply).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(reply)).mode&0o777,0o700);
  options.onStdout(JSON.stringify({event:'browser-page',url:'https://dribbble.com/shots/123-Public'})+'\n');
  if(cancelled){controller.abort();return {code:1,stdout:JSON.stringify({error:'JOB_STOPPED'})};}
  for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,5));if(fs.statSync(reply).size)break;}
  assert.deepEqual(JSON.parse(fs.readFileSync(reply,'utf8')),{url:'https://dribbble.com/shots/123-Public',html:'<html>public</html>'});
  assert.equal(fs.statSync(reply).mode&0o777,0o600);return {code:0,stdout:JSON.stringify({posts:[]})};
 };
 const pending=requestPrivatePython('dribbble',{operation:'discover'},{cookieFile,readBrowserPage,signal:controller.signal},run,'fixture',code=>Object.assign(Error(code),{code}));
 if(cancelled)await assert.rejects(pending,{code:'JOB_STOPPED'});else assert.deepEqual(await pending,{posts:[]});
 assert.ok(!fs.existsSync(reply));assert.ok(!fs.existsSync(reply+'.tmp'));removePrivateCookieFile(cookieFile);
});
test('Dribbble all-format failure retains diagnostics while request/snapshot cleanup still runs',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-format-failure-')),original=nodeApi.os.homedir;nodeApi.os.homedir=()=>root;
 t.after(()=>{nodeApi.os.homedir=original;fs.rmSync(root,{recursive:true,force:true});});
 const cookieFile=createPrivateCookieFile('dribbble'),failures=[{id:'1',url:'https://dribbble.com/shots/1-Public',code:'DRIBBBLE_FORMAT'}];let requestFile;
 const run=async(script,args)=>{requestFile=args[0];return {code:1,stdout:JSON.stringify({error:'DRIBBBLE_FORMAT',failures})};};
 await assert.rejects(requestPrivatePython('dribbble',{operation:'discover'},{cookieFile},run,'fixture',code=>Object.assign(Error(code),{code})),error=>{
  assert.equal(error.code,'DRIBBBLE_FORMAT');assert.deepEqual(error.discoveryFailures,failures);return true;
 });
 assert.ok(!fs.existsSync(requestFile));removePrivateCookieFile(cookieFile);
});
