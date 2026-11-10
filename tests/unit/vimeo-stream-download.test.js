import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {nodeApi} from '../../js/node-bridge.js';
import {downloadVimeoStream,recoverEmbeddedVideo} from '../../js/case/vimeo-stream.js';
const stream={url:'https://cdn.vimeocdn.com/video.m3u8?token=private-fixture',referrer:'https://www.behance.net/gallery/123/a',duration:20};
function fixture(t){
 const old={...nodeApi},root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-stream-test-')),postDir=path.join(root,'media');fs.mkdirSync(postDir);
 Object.assign(nodeApi,{available:true,fs,path,os:{homedir:()=>root},crypto,Buffer});
 t.after(()=>{Object.assign(nodeApi,old);fs.rmSync(root,{recursive:true,force:true});});
 let snapshot;
 const options={postDir,ffmpeg:'/fixture/ffmpeg',ffprobe:'/fixture/ffprobe',
  run:async(script,args)=>{snapshot=args[0];const info=JSON.parse(fs.readFileSync(snapshot,'utf8'));
   assert.deepEqual(info,{url:stream.url,referrer:stream.referrer});assert.equal(fs.statSync(snapshot).mode&0o777,0o600);
   assert.equal(fs.statSync(path.dirname(snapshot)).mode&0o777,0o700);assert.ok(!args.some(a=>a.includes('private-fixture')));
   assert.ok(!script.includes('cookiesfrombrowser'));fs.writeFileSync(path.join(postDir,'7.mp4'),'video');return {code:0};},
  probe:async(command,args)=>{assert.equal(command,'/fixture/ffprobe');assert.equal(args.at(-1),path.join(postDir,'7.mp4'));return {code:0,stdout:JSON.stringify({format:{duration:'20.03'}})};}};
 return {root,postDir,options,get snapshot(){return snapshot;}};
}
test('stream download protects the signed address before writing, checks full duration, and removes both reserved snapshots',async t=>{
 const f=fixture(t),file=await downloadVimeoStream(stream,7,f.options);
 assert.equal(file,path.join(f.postDir,'7.mp4'));assert.ok(!fs.existsSync(f.snapshot));assert.ok(!fs.existsSync(f.snapshot+'.tmp'));
});
for(const mode of ['download','duration'])test(`stream failure (${mode}) removes private snapshots and never returns an importable file`,async t=>{
 const f=fixture(t),run=f.options.run;
 await assert.rejects(downloadVimeoStream(stream,7,{...f.options,
  run:async(...args)=>({...await run(...args),code:mode==='download'?1:0}),
  probe:async()=>({code:0,stdout:'{"format":{"duration":"2"}}'})}),mode==='download'?/сохранить полный/:/Длительность/);
 assert.ok(!fs.existsSync(f.snapshot));assert.ok(!fs.existsSync(f.snapshot+'.tmp'));
});
for(const mode of ['signal','control'])test(`stream Stop (${mode}) terminates the worker and removes private snapshots`,async t=>{
 const f=fixture(t),controller=new AbortController(),control={isStopped:false,checkpoint:async()=>{}};
 await assert.rejects(downloadVimeoStream(stream,7,{...f.options,signal:controller.signal,control,
  run:async(script,args,options)=>{await f.options.run(script,args);if(mode==='signal')controller.abort();else control.isStopped=true;
   if(!options.signal.aborted)await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));
   return {code:null};}}),{code:'JOB_STOPPED'});
 assert.ok(!fs.existsSync(f.snapshot));
});
test('unavailable embedded player and unsupported targets preserve the existing selected-browser path',async()=>{
 for(const post of [{url:'http://www.behance.net/gallery/123/a'},{url:stream.referrer,components:[{index:7,mediaType:'video',url:'https://youtube.com/watch?v=fixture'}]}]){
  assert.equal(await recoverEmbeddedVideo(7,{post},{available:()=>true,capture:async()=>assert.fail('no player request')}),null);
 }
 assert.equal(await recoverEmbeddedVideo(7,{post:{url:stream.referrer,components:[{index:7,mediaType:'video',url:'https://player.vimeo.com/video/123'}]}},{available:()=>false,capture:async()=>assert.fail('no player request')}),null);
});
