import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {nodeApi} from '../../js/node-bridge.js';
import {retryMissingCaseVideos,isVimeoHttp401,waitForVideoRetry} from '../../js/case/video-retry.js';
import {makeStopError} from '../../js/job-control.js';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {toolchain} from '../../js/toolchain.js';
import {recoverEmbeddedVideo,VIMEO_STREAM_SCRIPT} from '../../js/case/vimeo-stream.js';
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
  run:async args=>{assert.equal(args[args.indexOf('--range')+1],'7');
   assert.equal(args.filter(arg=>arg.startsWith('downloader.ytdl.retries=')).at(-1),'downloader.ytdl.retries=0');
   const dest=args[args.indexOf('--dest')+1];seen.push(dest);
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
test('Eagle player recovery replaces a Vimeo 401 without more metadata requests and validates before publication',async t=>{
 const f=fixture(t);let players=0,decoded=0;
 const result=await retryMissingCaseVideos({...f.options,recover:async(number,options)=>{
  players++;assert.equal(number,7);assert.equal(options.post,f.options.post);assert.notEqual(options.postDir,f.root);
  const file=path.join(options.postDir,'7.mp4');fs.writeFileSync(file,'valid');return file;
 },validate:async file=>{decoded++;await f.options.validate(file);}});
 assert.equal(f.seen.length,1);assert.equal(players,1);assert.equal(decoded,1);assert.deepEqual(f.waits,[]);
 assert.equal(result.recovered,1);assert.deepEqual(result.failures,[]);assert.deepEqual(fs.readdirSync(f.root),['7.mp4']);
});
test('gallery retry enters the real player downloader using Python, then probes and decodes the final video',async t=>{
 const f=fixture(t),oldTools={...toolchain},workers=[];
 t.after(()=>Object.assign(toolchain,oldTools));
 const video=fs.readFileSync(new URL('../fixtures/media/synthetic-av.mp4',import.meta.url));
 Object.assign(nodeApi,{available:true,crypto,Buffer,os:{homedir:()=>f.root},childProcess:{spawn(command,args){
  workers.push(command);
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  queueMicrotask(()=>{
   if(command==='fixture-python'){
    assert.equal(args[0],'-c');assert.equal(args[1],VIMEO_STREAM_SCRIPT);
    const snapshot=args[2],data=JSON.parse(fs.readFileSync(snapshot,'utf8'));
    assert.equal(data.url,'https://cdn.vimeocdn.com/full.mp4?token=fixture-private');
    assert.equal(fs.statSync(snapshot).mode&0o777,0o600);
    assert.ok(!args.slice(2).some(a=>a.includes('fixture-private')));
    fs.writeFileSync(path.join(args[3],'7.mp4'),video);child.stdout.write('{"success":true}');
   }else if(command==='fixture-ffprobe')child.stdout.write('{"format":{"duration":"1"}}');
   else{assert.equal(command,'fixture-ffmpeg');child.stdout.write('frame=3\n');}
   child.emit('close',0);
  });return child;
 }}});
 Object.assign(toolchain,{ready:true,python:'fixture-python',kind:'binary',ffprobe:'fixture-ffprobe'});
 const post={url:'https://www.behance.net/gallery/123/a',components:[{index:7,mediaType:'video',url:'https://player.vimeo.com/video/123'}]};
 const {validate:galleryValidation,...options}=f.options;
 const result=await retryMissingCaseVideos({...options,post,ffmpeg:'fixture-ffmpeg',recover:(number,context)=>recoverEmbeddedVideo(number,context,{
  available:()=>true,capture:async()=>({nodeAccess:false,id:'123',duration:1,files:{progressive:[{width:1400,url:'https://cdn.vimeocdn.com/full.mp4?token=fixture-private'}]}}),
 })});
 assert.equal(f.seen.length,1);assert.deepEqual(workers,['fixture-python','fixture-ffprobe','fixture-ffmpeg']);
 assert.equal(result.recovered,1);assert.deepEqual(result.failures,[]);assert.deepEqual(f.waits,[]);
 assert.deepEqual(fs.readFileSync(result.files[0]),video);
 assert.deepEqual(fs.readdirSync(f.root).filter(n=>!n.startsWith('.')),['7.mp4']);
 const cache=path.join(f.root,'.reference-sync','cookie-cache');
 assert.ok(fs.readdirSync(cache).every(dir=>fs.readdirSync(path.join(cache,dir)).length===0));
});
for(const failure of ['player','corrupt','foreign'])test(`failed Eagle player (${failure}) is tried once, retains no fragments and cannot complete a case`,async t=>{
 const f=fixture(t);let players=0;
 const result=await retryMissingCaseVideos({...f.options,recover:async(number,options)=>{
  players++;if(failure==='player')throw Error('player unavailable');
  const file=path.join(options.postDir,failure==='foreign'?'8.mp4':'7.mp4');fs.writeFileSync(file,'broken');return file;
 }});
 assert.equal(players,1);assert.equal(f.seen.length,1);assert.equal(result.recovered,0);assert.deepEqual(result.files,[]);
 assert.deepEqual(f.waits,[]);assert.deepEqual(fs.readdirSync(f.root),[]);
});
test('Stop inside the Eagle player recovery is propagated and cleans its directory',async t=>{
 const f=fixture(t);
 await assert.rejects(retryMissingCaseVideos({...f.options,recover:async(number,options)=>{
  fs.writeFileSync(path.join(options.postDir,'7.mp4.part'),'partial');throw makeStopError();
 }}),{code:'JOB_STOPPED'});
 assert.equal(f.seen.length,1);assert.deepEqual(fs.readdirSync(f.root),[]);
});
test('a restored job cannot multiply recovery attempts by its previous downloader retry setting',async t=>{
 const f=fixture(t);f.options.args.splice(f.options.args.length-1,0,'-o','downloader.ytdl.retries=3');
 const result=await retryMissingCaseVideos(f.options);
 assert.equal(f.seen.length,3);assert.deepEqual(f.waits,[2000,4000]);assert.equal(result.recovered,0);
 assert.deepEqual(fs.readdirSync(f.root),[]);
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
