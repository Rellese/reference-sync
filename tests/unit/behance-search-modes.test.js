import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverBehance} from '../../js/sources/behance.js';
import {parseStopLink} from '../../js/stop-link.js';

const url=id=>`https://www.behance.net/gallery/${id}/a`;
const board=id=>({id:String(id),name:`Board ${id}`,url:`https://www.behance.net/collection/${id}/a`});
function fixture(ids,{empty=[],controller}={}) {
 const calls={lists:[],projects:[],refresh:[],progress:[]};
 return {calls,dependencies:{
  session:async(options,target,action)=>action({...options,cookieFile:'fixture'}),
  run:async args=>{
   calls.lists.push(args);controller?.abort();
   return {code:0,stdout:JSON.stringify(ids.map(id=>[6,url(id),{id}]))};
  },
  refresh:async(file,target)=>calls.refresh.push(target),
  discoverProject:async options=>{
   const id=Number(options.collections[0].url.match(/gallery\/(\d+)/)[1]);
   calls.projects.push({id,options});
   return {posts:empty.includes(id)?[]:[{postId:`behance:${id}`,url:url(id),
    containers:[{id:options.collections[0].id}],collectionOccurrences:[{collectionId:options.collections[0].id}]}]};
  },
 }};
}
test('recent searches at most 15 projects per board and bounds the engine collection pass',async()=>{
 const {calls,dependencies}=fixture(Array.from({length:60},(_,i)=>i+1));
 const result=await discoverBehance({searchMode:'recent',limit:'15',collections:[board(10),board(20)],onProgress:p=>calls.progress.push(p)},dependencies);
 assert.equal(calls.projects.length,30);assert.equal(calls.refresh.length,30);
 assert.deepEqual(calls.projects.map(c=>c.id),[...Array.from({length:15},(_,i)=>i+1),...Array.from({length:15},(_,i)=>i+1)]);
 assert.equal(result.posts.length,15);assert.ok(result.posts.every(p=>p.collectionOccurrences.length===2));
 for(const args of calls.lists)assert.equal(args[args.indexOf('--child-range')+1],'1-15');
 assert.ok(calls.projects.every(c=>c.options.limit===0)); // No truncation of a case's blocks.
 assert.ok(calls.progress.every(p=>p.stage==='discover'&&p.found<=15));
});
test('recent range counts inspected projects even if a project contains no downloadable media',async()=>{
 const {calls,dependencies}=fixture([1,2,3,4],{empty:[1]});
 const result=await discoverBehance({searchMode:'recent',limit:2,collections:[board(10)]},dependencies);
 assert.deepEqual(calls.projects.map(c=>c.id),[1,2]);assert.deepEqual(result.posts.map(p=>p.postId),['behance:2']);
});
for(const mode of ['smart','recent','full'])for(const known of ['behance:2','case:v1:behance:2']) {
 test(`${mode} honors previously imported ${known.startsWith('case:')?'whole cases':'blocks'} independently per board`,async()=>{
  const {calls,dependencies}=fixture([1,2,3]);
  const result=await discoverBehance({searchMode:mode,limit:15,knownPostIds:new Set([known]),collections:[board(10),board(20)]},dependencies);
  const expected=mode==='full'?[1,2,3,1,2,3]:[1,1];
  assert.deepEqual(calls.projects.map(c=>c.id),expected);
  assert.equal(result.stoppedEarly,mode!=='full');assert.equal(result.stopLinkReached,false);
  assert.equal(result.posts.length,mode==='full'?3:1);
  for(const args of calls.lists)assert.equal(args.includes('--child-range'),mode==='recent');
 });
}
for(const mode of ['smart','recent','full'])test(`Stop Link excludes its project before metadata requests in ${mode}`,async()=>{
 const {calls,dependencies}=fixture([1,2,3]);
 const result=await discoverBehance({searchMode:mode,limit:15,collections:[board(10),board(20)],stopLink:parseStopLink(url(2),'behance')},dependencies);
 assert.deepEqual(calls.projects.map(c=>c.id),[1,1]);assert.deepEqual(result.stopLinkTargets,['10','20']);
 assert.equal(result.stopLinkReached,true);assert.equal(calls.refresh.length,2);
});
test('manual cancellation while listing a collection prevents all project requests',async()=>{
 const controller=new AbortController(),{calls,dependencies}=fixture([1,2],{controller});
 await assert.rejects(discoverBehance({searchMode:'recent',limit:15,collections:[board(10)],signal:controller.signal},dependencies),{code:'JOB_STOPPED'});
 assert.equal(calls.projects.length,0);assert.equal(calls.refresh.length,0);
});
