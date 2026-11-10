import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import stream from 'node:stream';
import zlib from 'node:zlib';
import {nodeApi} from '../../js/node-bridge.js';
import {writeCaseZip} from '../../js/case/zip-writer.js';
import {compactPackedCase} from '../../js/case/compact.js';
import {downloadWithCases} from '../../js/case/download.js';
import {listZip} from '../../js/archive-zip.js';
import {assertDiskSpace,isDiskFull} from '../../js/disk-space.js';

function setup(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'rs-compact-')),prior={...nodeApi};
 Object.assign(nodeApi,{available:true,fs,path,crypto,Buffer,stream,zlib,os:{homedir:()=>home}});
 const root=path.join(home,'.reference-sync','staging','job');fs.mkdirSync(root,{recursive:true});
 t.after(()=>{Object.assign(nodeApi,prior);fs.rmSync(home,{recursive:true,force:true});});return root;
}
function media(root,id=12){
 const post={source:'behance',externalId:String(id),postId:`behance:${id}`,components:[{index:1},{index:2}],selectedComponents:[2],caseSelection:{whole:true,blocks:false},caseDocument:{format:'reference-sync-case',version:1}};
 const dir=path.join(root,`behance_${id}`);fs.mkdirSync(dir);
 const files=[1,2].map(n=>{const file=path.join(dir,`${n}.jpg`);fs.writeFileSync(file,`media-${id}-${n}`);return file;});
 return {post,files,blockFiles:[],error:null};
}
async function pack(entry,destination){
 const manifest={format:'reference-sync-case',version:1,source:{id:entry.post.externalId},complete:true};
 await writeCaseZip(destination,[{name:'manifest.json',data:JSON.stringify(manifest)},...entry.files.map(file=>({name:'assets/'+path.basename(file),file}))]);
 return {path:destination,manifest};
}
async function ready(entry,root){entry.caseFile=path.join(root,`case-${crypto.randomBytes(12).toString('hex')}.rscase`);await pack(entry,entry.caseFile);return entry;}
test('verified case replaces originals after checkpoint, while the archive stays for the later Eagle batch',async t=>{
 const root=setup(t),entry=await ready(media(root),root),originals=[...entry.files];let saved=false;
 await compactPackedCase(entry,root,{onReady:snapshot=>{assert.deepEqual(snapshot.files,[]);assert.ok(originals.every(fs.existsSync));assert.ok(fs.existsSync(snapshot.caseFile));saved=true;}});
 assert.equal(saved,true);assert.ok(originals.every(file=>!fs.existsSync(file)));assert.ok(fs.existsSync(entry.caseFile));assert.equal(entry.downloadedFileCount,2);
});
test('combined mode retains only chosen standalone blocks',async t=>{
 const root=setup(t),entry=await ready(media(root),root),[first,second]=entry.files;entry.blockFiles=[second];
 await compactPackedCase(entry,root);assert.equal(fs.existsSync(first),false);assert.ok(fs.existsSync(second));assert.deepEqual(entry.files,[second]);
});
test('corrupted packed media cannot cause any original to be deleted',async t=>{
 const root=setup(t),entry=await ready(media(root),root),asset=listZip(entry.caseFile).find(e=>e.name==='assets/1.jpg');
 const fd=fs.openSync(entry.caseFile,'r+');fs.writeSync(fd,Buffer.from('X'),0,1,asset.dataOffset);fs.closeSync(fd);
 await assert.rejects(compactPackedCase(entry,root),/контрольная сумма/);assert.ok(entry.files.every(fs.existsSync));
});
test('an archive missing an original, a failed checkpoint and cancellation all preserve sources',async t=>{
 const root=setup(t),entry=await ready(media(root),root),extra=path.join(path.dirname(entry.files[0]),'3.jpg');fs.writeFileSync(extra,'extra');entry.files.push(extra);
 await assert.rejects(compactPackedCase(entry,root),/не содержит/);assert.ok(entry.files.every(fs.existsSync));entry.files.pop();
 await assert.rejects(compactPackedCase(entry,root,{onReady:()=>false}),{code:'DISK_SPACE_LOW'});assert.equal(entry.files.length,2);assert.ok(entry.files.every(fs.existsSync));
 const controller=new AbortController();controller.abort();await assert.rejects(compactPackedCase(entry,root,{signal:controller.signal}),{code:'JOB_STOPPED'});assert.ok(entry.files.every(fs.existsSync));
});
test('case download compacts each case before the next starts, preserving one completion per case',async t=>{
 const root=setup(t),entries=[media(root,12),media(root,13)];let completed=0;
 const output=await downloadWithCases({posts:entries.map(e=>e.post),onCompleted:e=>{assert.ok(e.caseFile);assert.equal(e.files.length,0);completed++;}},async options=>{
  await options.onStagingReady(root);
  for(const [index,entry] of entries.entries()){
   if(index)assert.ok(entries[0].files.every(file=>!fs.existsSync(file)));
   await options.onCompleted(entry);
  }
  return {stagingRoot:root,results:entries};
 },pack);
 assert.equal(completed,2);assert.equal(output.results.length,2);assert.ok(output.results.every(e=>fs.existsSync(e.caseFile)));
});
test('disk reservations add writes on the same device and reject a shortage without writing files',async t=>{
 const root=setup(t);await assert.rejects(assertDiskSpace([{path:root,bytes:60},{path:root,bytes:50}],{reserve:10,read:async()=>119}),{code:'DISK_SPACE_LOW'});
 await assertDiskSpace([{path:root,bytes:60},{path:root,bytes:50}],{reserve:10,read:async()=>120});
 assert.ok(isDiskFull('No space left on device'));assert.ok(isDiskFull({code:'ENOSPC'}));assert.equal(isDiskFull('HTTP 401'),false);
});
test('cleanup refuses a path outside plugin staging and a symbolic-link source',async t=>{
 const root=setup(t),entry=await ready(media(root),root),outside=path.dirname(path.dirname(root));
 await assert.rejects(compactPackedCase(entry,outside),/Invalid case staging/);assert.ok(entry.files.every(fs.existsSync));
 const target=entry.files[0]+'.target';fs.renameSync(entry.files[0],target);fs.symlinkSync(target,entry.files[0]);
 await assert.rejects(compactPackedCase(entry,root),/не содержит/);assert.ok(fs.existsSync(target));assert.ok(fs.existsSync(entry.files[1]));
});
