import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import {nodeApi} from '../../js/node-bridge.js';
import {downloadWithCases,caseImportItem,caseRegistryId} from '../../js/case/download.js';
import {recordCreatedEagleItems,reconcileImportRecords} from '../../js/import-registry.js';
const post=()=>({source:'behance',postId:'behance:12',url:'https://www.behance.net/gallery/12/a',components:[{index:1},{index:3}],selectedComponents:[3],caseSelection:{whole:false,blocks:true},caseDocument:{source:{title:'Case'}}});
function setup(t){const previous={...nodeApi};Object.assign(nodeApi,{path,crypto});t.after(()=>Object.assign(nodeApi,previous));}
const pack=async(entry,destination)=>({path:destination,manifest:{complete:entry.files.length===2}});
function downloader(inspect=()=>{}) {return async options=>{
 inspect(options);await options.onStagingReady?.('/tmp/staging');
 const results=[];
 for(const post of options.posts){const entry={post,files:['/tmp/1.jpg','/tmp/3.mp4'],error:null};results.push(entry);await options.onCompleted?.(entry);}
 return {results,stagingRoot:'/tmp/staging'};
};}
test('combined mode downloads full case once, preserves chosen blocks and checkpoints packaged output once',async t=>{
 setup(t);const original=post();original.caseSelection={whole:true,blocks:true};let callbacks=0;
 const output=await downloadWithCases({posts:[original],onCompleted:async entry=>{await Promise.resolve();assert.ok(entry.caseFile);callbacks++;}},
 downloader(options=>assert.deepEqual(options.posts[0].selectedComponents,[1,3])),pack);
 assert.equal(callbacks,1);assert.equal(output.results[0].post,original);assert.deepEqual(original.selectedComponents,[3]);
 assert.deepEqual(output.results[0].blockFiles,['/tmp/3.mp4']);assert.equal(output.results[0].caseComplete,true);
});
test('case only has no loose files; both modes off or an empty block selection schedules nothing',async t=>{
 setup(t);const original=post();original.caseSelection={whole:true,blocks:false};
 const output=await downloadWithCases({posts:[original]},downloader(),pack);
 assert.deepEqual(output.results[0].blockFiles,[]);assert.ok(caseImportItem(output.results[0]));
 for(const candidate of [{...original,caseSelection:{whole:false,blocks:false}},{...post(),selectedComponents:[]}]) {
  const empty=await downloadWithCases({posts:[candidate]},downloader(options=>assert.equal(options.posts.length,0)),pack);
  assert.equal(empty.results.length,0);
 }
});
test('packaging failure retains downloaded blocks and never creates an importable case item',async t=>{
 setup(t);const original={...post(),caseSelection:{whole:true,blocks:true}};
 const output=await downloadWithCases({posts:[original]},downloader(),async()=>{throw new Error('Disk full');});
 assert.equal(output.results[0].caseError,'Disk full');assert.deepEqual(output.results[0].blockFiles,['/tmp/3.mp4']);
 assert.equal(caseImportItem(output.results[0]),null);
});
test('case confirmation and media confirmation use independent registry IDs, including deletion recovery',()=>{
 const original=post(),item=caseImportItem({post:original,caseFile:'/tmp/test.rscase'});
 let records=recordCreatedEagleItems(new Map(),[{id:'CASE',item}]);
 let result=reconcileImportRecords(records,[{id:'CASE'}]);
 assert.equal(result.knownPostIds.has(caseRegistryId(original)),true);
 assert.equal(result.knownPostIds.has(original.postId),false);
 records=recordCreatedEagleItems(records,[{id:'MEDIA',item:{postId:original.postId,component:'0',componentCount:2}}]);
 result=reconcileImportRecords(records,[{id:'MEDIA'}]);
 assert.equal(result.knownPostIds.has(caseRegistryId(original)),false);
 assert.equal(result.records.get(original.postId).components.get('0'),'MEDIA');
 assert.equal(result.missingComponents.get(caseRegistryId(original)).has('0'),true);
});
test('cancellation after network completion prevents packaging and publishing callbacks',async t=>{
 setup(t);const controller=new AbortController();let packed=false,notified=false;
 await assert.rejects(downloadWithCases({posts:[{...post(),caseSelection:{whole:true}}],signal:controller.signal,onCompleted:()=>{notified=true;}},
  async options=>{controller.abort();return {results:[{post:options.posts[0],files:[]}]};},
  async()=>{packed=true;}),{code:'JOB_STOPPED'});
 assert.equal(packed,false);assert.equal(notified,false);
});

test('case modes count one publication and allow a case after all loose media were imported',async()=>{
 const {selectImportablePosts}=await import('../../js/import-registry.js');
 const {summarizeImportOutcome}=await import('../../js/download-outcome.js');
 const original={...post(),caseSelection:{whole:true,blocks:false},selectedComponents:[]};
 const mediaKnown=new Set([original.postId]);
 assert.equal(selectImportablePosts([original],new Set([original.postId]),mediaKnown).length,1);
 const known=new Set([caseRegistryId(original)]);
 assert.equal(summarizeImportOutcome([original],known,new Map(),[{id:'CASE',item:caseImportItem({post:original,caseFile:'/tmp/case.rscase'})}]).complete,1);
 known.add(original.postId);
 assert.equal(selectImportablePosts([original],new Set([original.postId]),known).length,0);
});

test('recovery keeps the independent mode, packaged file and original block choice',async()=>{
 const {normalizeRecoveryState}=await import('../../js/job-recovery.js');
 const original={...post(),caseSelection:{whole:true,blocks:false}};
 const input={jobId:'case',phase:'downloaded',posts:[original],downloaded:[{postId:original.postId,files:['/tmp/1.jpg'],caseFile:'/tmp/case.rscase',caseComplete:false,blockFiles:[]}]};
 const recovery=normalizeRecoveryState(input);
 assert.deepEqual(recovery.posts[0].caseSelection,{whole:true,blocks:false});
 assert.deepEqual(recovery.posts[0].selectedComponents,[3]);
 assert.equal(recovery.downloaded[0].caseFile,'/tmp/case.rscase');
 assert.equal(recovery.downloaded[0].caseComplete,false);
});

test('new Behance cases default to whole case while explicit modes survive',async()=>{
 const {caseModes}=await import('../../js/case/download.js');const fresh=post();delete fresh.caseSelection;
 assert.deepEqual(caseModes(fresh),{whole:true,blocks:false});
 assert.deepEqual(caseModes(post()),{whole:false,blocks:true});
 assert.deepEqual(caseModes({source:'instagram'}),{whole:false,blocks:true});
});
test('a whole imported case is disabled without marking separate blocks imported',async()=>{
 const {isPostImported,caseRegistryId}=await import('../../js/case/download.js');
 const original={...post(),caseSelection:{whole:true,blocks:false}};
 const known=new Set([caseRegistryId(original)]);
 assert.equal(isPostImported(original,known),true);
 assert.equal(isPostImported({...original,caseSelection:{whole:false,blocks:true}},known),false);
 assert.equal(isPostImported({...original,caseSelection:{whole:true,blocks:true}},known),false);
});
test('failed or missing downloadable media cannot produce a falsely complete case',async t=>{
 setup(t);let packed=0;const original={...post(),caseSelection:{whole:true,blocks:true}};
 const output=await downloadWithCases({posts:[original]},async options=>({stagingRoot:'/tmp/staging',results:[{post:options.posts[0],files:['/tmp/3.mp4'],error:'Incomplete MP4'}]}),async()=>{packed++;return pack();});
 assert.equal(packed,0);assert.equal(output.results[0].caseFile,undefined);assert.equal(output.results[0].caseError,'Incomplete MP4');assert.deepEqual(output.results[0].blockFiles,['/tmp/3.mp4']);
});
