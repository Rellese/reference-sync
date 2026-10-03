import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {nodeApi} from '../../js/node-bridge.js';
import {toolchain} from '../../js/toolchain.js';
import {behanceMediaSource} from '../../js/sources/behance.js';
import {downloadWithCases} from '../../js/case/download.js';

const image=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
const video=fs.readFileSync(new URL('../fixtures/media/synthetic-av.mp4',import.meta.url));
const originalError='[downloader.ytdl][error] [vimeo] 123: HTTP Error 401: Unauthorized\n[download][error] Failed to download 2.mp4';
const warnings='\n[downloader.ytdl][warning] [vimeo] 456: Failed to parse XML'.repeat(5);

function fixture(t,{retry='valid',otherError='',missingImage=false,selected,controller}={}) {
 const before={...nodeApi},beforeTools={...toolchain};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-behance-recover-'));
 const calls=[],logs=[];
 t.after(()=>{Object.assign(nodeApi,before);Object.assign(toolchain,beforeTools);fs.rmSync(root,{recursive:true,force:true});});
 Object.assign(nodeApi,{available:true,fs,path,crypto,Buffer,os:{homedir:()=>root},childProcess:{spawn(command,args){
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  queueMicrotask(()=>{
   if(command==='fixture-ffmpeg'){child.stdout.write('frame=3\n');child.emit('close',0);return;}
   assert.equal(command,'fixture-gallery');calls.push(args);
   assert.ok(args.includes('extractor.cookies-update=false'));
   const dir=args[args.indexOf('--dest')+1];
   if(calls.length===1){
    if(!missingImage)fs.writeFileSync(path.join(dir,'1.gif'),image);
    child.stderr.write(originalError+otherError+warnings);child.emit('close',1);return;
   }
   assert.notEqual(dir,path.join(root,'behance_123'));assert.equal(args[args.indexOf('--range')+1],'2');
   fs.writeFileSync(path.join(dir,'2.mp4.part'),'partial');
   if(retry==='valid')fs.writeFileSync(path.join(dir,'2.mp4'),video);
   else if(retry==='corrupt')fs.writeFileSync(path.join(dir,'2.mp4'),'broken');
   else child.stderr.write(originalError+warnings);
   controller?.abort();child.emit('close',retry==='failed'?1:0);
  });
  return child;
 }}});
 Object.assign(toolchain,{ready:true,command:'fixture-gallery',args:[],kind:'binary',ffmpeg:'fixture-ffmpeg',ffprobe:null});
 const post={source:'behance',postId:'behance:123',url:'https://www.behance.net/gallery/123/a',
  components:[{index:1,mediaType:'image'},{index:2,mediaType:'video'}],selectedComponents:selected || [1,2],
  caseDocument:{source:{title:'Fixture'}},caseSelection:{whole:true,blocks:false}};
 return {root,post,calls,logs,options:{posts:[post],cookieFile:'/fixture/cookies',stagingRoot:root,speedProfile:'lightning',signal:controller?.signal,onLog:line=>logs.push(line)}};
}

test('missing video is retried in isolation, decoded and permits whole-case packaging',async t=>{
 const f=fixture(t);let packaged=0;
 const {results}=await downloadWithCases(f.options,behanceMediaSource.download,async(entry,destination)=>{
  packaged++;assert.deepEqual(entry.files.map(p=>path.basename(p)),['1.gif','2.mp4']);assert.equal(entry.error,null);
  return {path:destination,manifest:{complete:true}};
 });
 assert.equal(f.calls.length,2);assert.equal(packaged,1);assert.equal(results[0].caseComplete,true);
 assert.equal(results[0].error,null);assert.equal(results[0].issue,null);assert.deepEqual(results[0].blockFiles,[]);
 assert.deepEqual(fs.readdirSync(path.join(f.root,'behance_123')).sort(),['1.gif','2.mp4']);
});
for(const retry of ['failed','corrupt','empty'])test(`failed missing-video retry (${retry}) retains images and cannot publish an incomplete case`,async t=>{
 const f=fixture(t,{retry});let packaged=0;
 const {results}=await downloadWithCases(f.options,behanceMediaSource.download,async()=>{packaged++;throw Error('must not package');});
 assert.equal(f.calls.length,retry==='failed'?4:2);assert.equal(packaged,0);assert.equal(results[0].caseFile,undefined);
 assert.match(results[0].caseError,retry==='corrupt'?/2\.mp4.*Неполный MP4/:/Видеоблок 2.*401/);
 if(retry!=='corrupt')assert.doesNotMatch(results[0].error,/Failed to parse XML/);
 assert.deepEqual(fs.readdirSync(path.join(f.root,'behance_123')),['1.gif']);
 assert.deepEqual(fs.readFileSync(results[0].files[0]),image);
});
for(const options of [{otherError:'\n[behance][error] Failed to extract project'},
 {otherError:'\n[download][error] Failed to download 1.gif'},{missingImage:true}])test(`video recovery does not erase unrelated failure (${JSON.stringify(options)})`,async t=>{
 const f=fixture(t,options);let packaged=0;
 const {results}=await downloadWithCases(f.options,behanceMediaSource.download,async()=>{packaged++;});
 assert.equal(f.calls.length,2);assert.equal(packaged,0);assert.ok(results[0].error);assert.equal(results[0].caseFile,undefined);
});
test('individual block selection never downloads an unselected missing video',async t=>{
 const f=fixture(t,{selected:[1]});
 await behanceMediaSource.download(f.options);
 assert.equal(f.calls.length,1);
});
test('cancelling video recovery cleans temporary files and prevents packaging',async t=>{
 const controller=new AbortController(),f=fixture(t,{controller});let packaged=0;
 await assert.rejects(downloadWithCases(f.options,behanceMediaSource.download,async()=>{packaged++;}),{code:'JOB_STOPPED'});
 assert.equal(f.calls.length,2);assert.equal(packaged,0);assert.deepEqual(fs.readdirSync(path.join(f.root,'behance_123')),['1.gif']);
});
test('Stop at a recovery checkpoint remains cancellation even without an AbortSignal',async t=>{
 const f=fixture(t);let checkpoints=0;
 f.options.control={checkpoint:async()=>{if(++checkpoints===2)throw Object.assign(Error('Stopped'),{code:'JOB_STOPPED'});},resetRetries:()=>{}};
 await assert.rejects(downloadWithCases(f.options,behanceMediaSource.download,async()=>{assert.fail('must not package');}),{code:'JOB_STOPPED'});
 assert.equal(f.calls.length,1);assert.deepEqual(fs.readdirSync(path.join(f.root,'behance_123')),['1.gif']);
});
