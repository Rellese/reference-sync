import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import behanceAdapter, { behanceMediaSource as behance, behanceTarget, buildBehanceTargets, validateBehanceDiscovery } from '../../js/sources/behance.js';
import { parseDumpJson, describeFailure } from '../../js/sources/gallery-source.js';
import { selectedDownloadedFiles } from '../../js/carousel-selection.js';
import { nodeApi } from '../../js/node-bridge.js';
import { toolchain } from '../../js/toolchain.js';
const project = {id:123,creator:{name:'designer'},name:'Case',description:'Project description'};
const messages = [
  [2,'',project],
  [3,'https://cdn.example/1.jpg',{...project,num:1,extension:'jpg'}],
  [3,'text:Heading',{...project,num:2,extension:'txt'}],
  [3,'ytdl:https://player.example/video',{...project,num:3,extension:'mp4'}],
  [3,'https://cdn.example/4.gif',{...project,num:4,extension:'gif'}],
];
const posts = () => behance.assemble(parseDumpJson(JSON.stringify(messages)),{target:behanceTarget('https://www.behance.net/collection/789/Test'),accountUsername:'ignored'});
test('Behance distinguishes an external player failure from account authorization', () => {
  const failure={code:1,stderr:'[downloader.ytdl][error] [vimeo] HTTP Error 401: Unauthorized'};
  assert.match(describeFailure(failure,'chrome','Behance'), /встроенное видео/);
  assert.match(describeFailure({code:1,stderr:'[behance][error] Unauthorized'},'chrome','Behance'), /повторный вход/);
});
test('Behance rejects extraction errors even when gallery-dl exits successfully', () => {
  for (const message of ['403 Forbidden', 'NO_PROTOCOLS_AVAILABLE']) {
    assert.throws(() => validateBehanceDiscovery(parseDumpJson(JSON.stringify([
      ...messages, [-1, {error:'HttpError', message}],
    ]))), /Behance не разрешил/);
  }
  assert.doesNotThrow(() => validateBehanceDiscovery(parseDumpJson(JSON.stringify(messages))));
});
test('Behance groups media blocks by project and excludes text while keeping source numbers',()=>{
  const [post] = posts();
  assert.equal(post.postId,'behance:123');
  assert.equal(post.username,'@designer');
  assert.equal(post.source,'behance');
  assert.deepEqual(post.components.map(c=>c.index),[1,3,4]);
  assert.equal(post.components[1].mediaType,'video');
  assert.equal(post.components[1].url,'https://player.example/video');
  assert.equal(post.collectionId,'789');
  assert.deepEqual(selectedDownloadedFiles({post,files:['1.jpg','3.mp4','4.gif']},[3]).map(x=>x.componentIndex),[1]);
});
test('Behance accepts only explicit project/collection HTTPS links and routes a collection',async()=>{
  for(const url of ['https://evil.example/collection/1','https://behance.net.evil.example/gallery/1','file:///gallery/1','designer']) assert.throws(()=>behanceTarget(url));
  assert.equal(behanceTarget('https://behance.net/gallery/123/Case?x=1').url,'https://www.behance.net/gallery/123/a');
  assert.equal(behanceTarget('https://www.behance.net/moodboard/789/Test').id,'789');
  assert.throws(() => behanceAdapter.listContainers({username:'https://www.behance.net/collection/789/Test'}), /имя пользователя/);
});
test('Behance passes selected block numbers to downloader and keeps only importable final files', async t=>{
  const oldNode={...nodeApi},oldTool={...toolchain};
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-behance-'));
  t.after(()=>{Object.assign(nodeApi,oldNode);Object.assign(toolchain,oldTool);fs.rmSync(root,{recursive:true,force:true});});
  Object.assign(nodeApi,{available:true,fs,path,os:{homedir:()=>root},childProcess:{spawn(command,args){
    assert.equal(args[args.indexOf('--range')+1],'4');
    const playerArgs=args.find(arg=>arg.startsWith('downloader.ytdl.cmdline-args='));
    assert.deepEqual(JSON.parse(playerArgs.slice(playerArgs.indexOf('=')+1)),['--referer','https://www.behance.net/gallery/123/a','--no-playlist']);
    assert.equal(args.at(-1),'https://www.behance.net/gallery/123/a');
    const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.kill=()=>{};
    queueMicrotask(()=>{const dir=args[args.indexOf('--dest')+1];fs.writeFileSync(path.join(dir,'4.gif'),Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64'));fs.writeFileSync(path.join(dir,'3.faudio.mp4'),'intermediate');child.emit('close',0);});
    return child;
  }}});
  Object.assign(toolchain,{ready:true,command:'fixture',args:[],kind:'binary',ffmpeg:null});
  const [post]=posts();post.selectedComponents=[4];
  const {results}=await behance.download({posts:[post],cookieFile:'/fixture/cookies',stagingRoot:root,speedProfile:'lightning'});
  assert.equal(results[0].error,null);
  assert.deepEqual(results[0].files.map(file=>path.basename(file)),['4.gif']);
  assert.equal(selectedDownloadedFiles(results[0],[4])[0].componentIndex,2);
});

test('Behance enumerates queued projects, prepares each page and counts recent posts per board', async () => {
  const {discoverBehance} = await import('../../js/sources/behance.js');
  const refreshed=[], extracted=[];
  const result=await discoverBehance({username:'designer',collections:[{id:'10',name:'A',url:'https://www.behance.net/moodboard/10/a'},{id:'20',name:'B',url:'https://www.behance.net/collection/20/a'}],limit:1}, {
    session:async(options,url,action)=>action({...options,cookieFile:'fixture'}),
    run:async()=>({code:0,stdout:JSON.stringify([[6,'https://www.behance.net/gallery/123/a',{id:123}],[6,'https://www.behance.net/gallery/456/a',{id:456}]])}),
    refresh:async(file,url)=>refreshed.push(url),
    discoverProject:async options=>{
      extracted.push(options.collections[0]);
      return {posts:[{postId:'behance:123',containers:[{id:options.collections[0].id}],collectionOccurrences:[{collectionId:options.collections[0].id}]}]};
    },
  });
  assert.equal(extracted.length,2);assert.deepEqual(extracted.map(x=>x.id),['10','20']);
  assert.equal(refreshed.length,2);assert.equal(result.posts.length,1);
  assert.equal(result.posts[0].collectionOccurrences.length,2);
});
test('Behance stops only the current board at a known post or stop link',async()=>{
 const {discoverBehance}=await import('../../js/sources/behance.js');let calls=0;
 const result=await discoverBehance({collections:[{id:'10',url:'https://www.behance.net/collection/10/a'},{id:'20',url:'https://www.behance.net/collection/20/a'}]}, {
  session:async(o,u,f)=>f({...o,cookieFile:'fixture'}),refresh:async()=>{},
  run:async()=>({code:0,stdout:JSON.stringify([[6,'https://www.behance.net/gallery/123/a',{}],[6,'https://www.behance.net/gallery/456/a',{}]])}),
  discoverProject:async()=>{calls++;return {posts:[],stoppedEarly:true,stopLinkReached:true};},
 });
 assert.equal(calls,2);assert.deepEqual(result.stopLinkTargets,['10','20']);
});

test('project discovery retains its selected moodboard identity',()=>{
 const [target]=buildBehanceTargets({collections:[{id:'789',name:'Board',type:'COLLECTION',url:'https://www.behance.net/gallery/123/a'}]});
 assert.equal(target.id,'789');assert.equal(target.type,'COLLECTION');assert.equal(target.name,'Board');
});
