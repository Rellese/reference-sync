import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import behance, { behanceTarget, validateBehanceDiscovery } from '../../js/sources/behance.js';
import { parseDumpJson } from '../../js/sources/gallery-source.js';
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
  assert.equal(post.collectionId,'789');
  assert.deepEqual(selectedDownloadedFiles({post,files:['1.jpg','3.mp4','4.gif']},[3]).map(x=>x.componentIndex),[1]);
});
test('Behance accepts only explicit project/collection HTTPS links and routes a collection',async()=>{
  for(const url of ['https://evil.example/collection/1','https://behance.net.evil.example/gallery/1','file:///gallery/1','designer']) assert.throws(()=>behanceTarget(url));
  assert.equal(behanceTarget('https://behance.net/gallery/123/Case?x=1').url,'https://www.behance.net/gallery/123/');
  assert.equal((await behance.listContainers({username:'https://www.behance.net/collection/789/Test'}))[0].id,'789');
});
test('Behance passes selected block numbers to downloader and keeps only importable final files', async t=>{
  const oldNode={...nodeApi},oldTool={...toolchain};
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-behance-'));
  t.after(()=>{Object.assign(nodeApi,oldNode);Object.assign(toolchain,oldTool);fs.rmSync(root,{recursive:true,force:true});});
  Object.assign(nodeApi,{available:true,fs,path,os:{homedir:()=>root},childProcess:{spawn(command,args){
    assert.equal(args[args.indexOf('--range')+1],'4');
    assert.equal(args.at(-1),'https://www.behance.net/gallery/123/');
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
