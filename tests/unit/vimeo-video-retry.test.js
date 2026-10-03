import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {nodeApi} from '../../js/node-bridge.js';
import {retryMissingCaseVideos,isVimeoHttp401,waitForVideoRetry} from '../../js/case/video-retry.js';
import {makeStopError} from '../../js/job-control.js';
const refused='[downloader.ytdl][error] [vimeo] 123: Unable to download webpage: HTTP Error 401: Unauthorized\n[download][error] Failed to download 7.mp4';

test('only Vimeo 401 gets delayed retries; other errors and mixed failures do not',()=>{
 assert.equal(isVimeoHttp401(refused),true);
 for(const raw of [refused.replace('401','403'),refused.replace('[vimeo]','[youtube]'),
  refused+'\n[behance][error] Failed to extract project',
  refused+'\n[downloader.ytdl][error] [vimeo] 456: Video not found',
  'HTTP Error 401',refused+'\n[download][error] Failed to download 1.jpg'])assert.equal(isVimeoHttp401(raw),false,raw);
});
function fixture(t) {
 const old={...nodeApi};Object.assign(nodeApi,{fs,path});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-vimeo-retry-'));
 t.after(()=>{Object.assign(nodeApi,old);fs.rmSync(root,{recursive:true,force:true});});
 const seen=[],waits=[],logs=[];
 return {root,seen,waits,logs,options:{post:{components:[{index:7,mediaType:'video'}]},files:[],existingFiles:[],
  args:['--dest',root,'--range','1,7','https://www.behance.net/gallery/123/a'],postDir:root,ffmpeg:'ffmpeg',
  validate:async file=>assert.equal(fs.readFileSync(file,'utf8'),'valid'),
  wait:async ms=>waits.push(ms),onLog:s=>logs.push(s),
  run:async args=>{assert.equal(args[args.indexOf('--range')+1],'7');const dest=args[args.indexOf('--dest')+1];seen.push(dest);
   fs.writeFileSync(path.join(dest,'7.mp4.part'),'unfinished');return {code:4,stderr:refused};}}};
}
test('transient 401 recovers in a fresh directory, validates once, and leaves no partial files',async t=>{
 const f=fixture(t),failed=f.options.run;let decoded=0;
 const result=await retryMissingCaseVideos({...f.options,run:async args=>{
  if(f.seen.length<2)return failed(args);
  const dest=args[args.indexOf('--dest')+1];f.seen.push(dest);fs.writeFileSync(path.join(dest,'7.mp4'),'valid');
  return {code:0,stderr:refused}; // Earlier failed attempts may remain in successful downloader stderr.
 },validate:async file=>{decoded++;await f.options.validate(file);}});
 assert.equal(result.recovered,1);assert.deepEqual(result.failures,[]);assert.equal(decoded,1);
 assert.deepEqual(f.waits,[2000,4000]);assert.equal(new Set(f.seen).size,3);
 assert.deepEqual(fs.readdirSync(f.root),['7.mp4']);assert.deepEqual(result.files,[path.join(f.root,'7.mp4')]);
});
test('persistent 401 stops after three fresh attempts and leaves the case incomplete',async t=>{
 const f=fixture(t),result=await retryMissingCaseVideos(f.options);
 assert.equal(f.seen.length,3);assert.deepEqual(f.waits,[2000,4000]);assert.equal(result.recovered,0);
 assert.match(result.failures[0],/Видеоблок 7.*401/);assert.deepEqual(result.files,[]);assert.deepEqual(fs.readdirSync(f.root),[]);
});
test('403 is not repeatedly retried as a transient player rejection',async t=>{
 const f=fixture(t),run=f.options.run;
 const result=await retryMissingCaseVideos({...f.options,run:async args=>({...await run(args),stderr:refused.replace('401','403')})});
 assert.equal(f.seen.length,1);assert.deepEqual(f.waits,[]);assert.match(result.failures[0],/403/);
});
test('a corrupt downloaded video stops recovery instead of triggering more network attempts',async t=>{
 const f=fixture(t);
 const result=await retryMissingCaseVideos({...f.options,run:async args=>{const dest=args[args.indexOf('--dest')+1];f.seen.push(dest);
  fs.writeFileSync(path.join(dest,'7.mp4'),'broken');return {code:0};},validate:async()=>{throw Error('invalid container');}});
 assert.equal(f.seen.length,1);assert.deepEqual(f.waits,[]);assert.deepEqual(fs.readdirSync(f.root),[]);
 assert.deepEqual(result.failures,['invalid container']);
});
for(const stop of ['signal','control'])test(`cancelling the delayed retry (${stop}) never starts another request`,async t=>{
 const f=fixture(t),controller=new AbortController();
 await assert.rejects(retryMissingCaseVideos({...f.options,signal:controller.signal,wait:async()=>{
  if(stop==='signal')controller.abort();else throw makeStopError();
 }}),{code:'JOB_STOPPED'});
 assert.equal(f.seen.length,1);assert.deepEqual(fs.readdirSync(f.root),[]);
});
test('actual delay responds to abort while waiting',async()=>{
 const controller=new AbortController();
 const waiting=waitForVideoRetry(4000,{signal:controller.signal});controller.abort();
 await assert.rejects(waiting,{code:'JOB_STOPPED'});
});
test('actual delay observes Stop without an AbortSignal',async()=>{
 let checks=0;
 await assert.rejects(waitForVideoRetry(4000,{control:{checkpoint:async()=>{if(++checks===2)throw makeStopError();}}}),{code:'JOB_STOPPED'});
 assert.equal(checks,2);
});
