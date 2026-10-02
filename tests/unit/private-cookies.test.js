import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
globalThis.require=createRequire(import.meta.url);
const {nodeApi}=await import('../../js/node-bridge.js');
const {createPrivateCookieFile,verifyPrivateCookieFile,cleanupCookieSnapshots}=await import('../../js/private-cookies.js');
test('cookie destination is private before writing, checks exporter permissions and cleans dead sessions',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-cookie-test-'));const original=nodeApi.os.homedir;nodeApi.os.homedir=()=>root;
 t.after(()=>{nodeApi.os.homedir=original;fs.rmSync(root,{recursive:true,force:true});});
 const file=createPrivateCookieFile('fixture');assert.equal(fs.statSync(file).size,0);
 if(process.platform!=='win32'){
  assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);
  fs.chmodSync(file,0o644);assert.throws(()=>verifyPrivateCookieFile(file),/permissions/);fs.chmodSync(file,0o600);
 }
 const cache=path.dirname(path.dirname(file)),dead=path.join(cache,'session-2147483647-fixture');fs.mkdirSync(dead);fs.writeFileSync(path.join(dead,'old.txt'),'fixture');
 const legacy=path.join(cache,'pinterest-old.txt');fs.writeFileSync(legacy,'fixture');fs.utimesSync(legacy,1,1);
 cleanupCookieSnapshots(path.dirname(cache));assert.equal(fs.existsSync(dead),false);assert.equal(fs.existsSync(legacy),false);assert.equal(fs.existsSync(file),true);
 const target=path.join(root,'external');fs.writeFileSync(target,'fixture');const linked=path.join(path.dirname(file),'link');fs.symlinkSync(target,linked);assert.throws(()=>verifyPrivateCookieFile(linked),/Unsafe/);
});
