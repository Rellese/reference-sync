import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';
globalThis.require=createRequire(import.meta.url);
const {nodeApi}=await import('../../js/node-bridge.js');
const {discoverVimeo,listVimeoCollections,normalizeVimeo,default:source}=await import('../../js/sources/vimeo.js');
const {vimeoTarget,vimeoSavedLists}=await import('../../js/sources/vimeo-target.js');
const {downloadVimeo}=await import('../../js/sources/vimeo-download.js');
const {withVimeoSession,requestVimeo,vimeoFailure}=await import('../../js/sources/vimeo-session.js');
const {createJobControl}=await import('../../js/job-control.js');
const {validateSourceLink,searchSettings}=await import('../../js/source-link.js');
const {parseStopLink}=await import('../../js/stop-link.js');
const item=id=>({id:String(id),url:`https://vimeo.com/${id}`,title:'Title',description:'Description',author:'Artist',created:'2026-01-01T00:00:00Z'});
const session=async(options,action)=>action({...options,cookieFile:'fixture'});
function home(t){const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'rs-vimeo-test-')),original=nodeApi.os.homedir;
 nodeApi.os.homedir=()=>temporary;t.after(()=>{nodeApi.os.homedir=original;fs.rmSync(temporary,{recursive:true,force:true});});return temporary;}

test('Vimeo routes only HTTPS videos/showcases and preserves unlisted hashes',()=>{
 for(const url of ['http://vimeo.com/123','https://vimeo.com.evil/123','https://vimeo.com:8443/123',
  'https://a:b@vimeo.com/123','https://vimeo.com/user1','https://vimeo.com/login','https://vimeo.com/showcase/1/../x',
  'https://player.vimeo.com/123','https://player.vimeo.com/video/123?h=bad'])assert.throws(()=>vimeoTarget(url),url);
 const expected='https://vimeo.com/123/012345abcd';
 assert.equal(validateSourceLink('vimeo',expected+'?share=copy#x'),expected);
 assert.equal(validateSourceLink('vimeo','https://player.vimeo.com/video/123?h=012345abcd'),expected);
 assert.equal(validateSourceLink('vimeo','https://vimeo.com/123?h=012345abcd'),expected);
 assert.equal(vimeoTarget('https://vimeo.com/channels/staffpicks/123').url,'https://vimeo.com/123');
 assert.equal(vimeoTarget('https://vimeo.com/showcase/456').resource,'/albums/456/videos');
 for(const url of ['https://vimeo.com/showcase/456','http://vimeo.com/123','https://vimeo.com:123/456'])assert.equal(parseStopLink(url,'vimeo').ok,false);
 assert.equal(parseStopLink(expected,'vimeo').publicationId,'123');
});
test('Vimeo source has no archive/carousels/account field; saved search defaults to Favorites',async()=>{
 assert.equal(source.needsAccount,false);assert.equal(source.videoOnly,true);assert.deepEqual(source.sourceModes,['browser']);
 assert.equal(searchSettings({platform:'vimeo',source:'meta',folderSearch:false}).source,'browser');
 const calls=[];const result=await discoverVimeo({searchMode:'full'},{session,request:async spec=>{calls.push(spec);return {posts:[item(1)]};}});
 assert.equal(calls.length,1);assert.equal(calls[0].resource,'/me/likes');
 assert.equal(result.posts[0].collectionId,'favorites');assert.equal(result.posts[0].type,'Видео');
 assert.equal(result.posts[0].componentCount,1);assert.deepEqual(result.posts[0].selectedComponents,[1]);
});
for(const mode of ['smart','recent','full'])test(`${mode} carries the independent per-folder range/boundaries to the helper`,async()=>{
 const calls=[],progress=[];
 const result=await discoverVimeo({searchMode:mode,limit:15,knownPostIds:new Set(['vimeo:2','behance:3']),
  collections:[{id:'10',name:'A'},{id:'20',name:'B'}],stopLink:parseStopLink('https://vimeo.com/4','vimeo'),onProgress:p=>progress.push(p)},
 {session,request:async(spec,options)=>{calls.push(spec);options.onProgress(1,['1']);return {posts:[item(1)],stoppedEarly:true,stopLinkReached:true};}});
 assert.deepEqual(calls.map(c=>c.resource),['/albums/10/videos','/albums/20/videos']);
 assert.ok(calls.every(c=>c.limit===(mode==='recent'?15:0)&&c.stopId==='4'));
 assert.deepEqual(calls[0].known,mode==='full'?[]:['2']);
 assert.equal(result.posts.length,1);assert.equal(result.posts[0].containers.length,2);
 assert.deepEqual(result.stopLinkTargets,['10','20']);assert.ok(progress.every(p=>p.found===1));
});
test('catalog exposes saved lists and Showcases; no own-upload folder is fabricated',async()=>{
 const result=await listVimeoCollections({},{session,request:async()=>({containers:[{id:'10',name:'Collection'}]})});
 assert.deepEqual(result.map(c=>c.id),['favorites','watchlater','10']);assert.equal(result[2].type,'COLLECTION');
});
test('mismatched IDs/URLs and unrelated preview hosts are rejected',()=>{
 assert.throws(()=>normalizeVimeo({...item(1),url:'https://vimeo.com/2'},vimeoSavedLists[0]));
 assert.throws(()=>normalizeVimeo({...item(1),url:'https://evil.test/1'},vimeoSavedLists[0]));
 assert.equal(normalizeVimeo({...item(1),thumbnail:'http://i.vimeocdn.com/p.jpg'},vimeoSavedLists[0]).previewUrl,'');
});
test('cancelled discovery does not request a second folder',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(discoverVimeo({signal:controller.signal,collections:[{id:'10'},{id:'20'}]},
 {session,request:async()=>{calls++;controller.abort();return {posts:[]};}}),{code:'JOB_STOPPED'});assert.equal(calls,1);
});
test('cookie export is private before writing and removed after success/failure/abort',async t=>{
 home(t);const files=[];
 const run=async(script,args)=>{const file=args[0];files.push(file);
  if(process.platform!=='win32'){assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);}
  fs.writeFileSync(file,'fixture');return {code:0};};
 await withVimeoSession({},async options=>assert.ok(fs.existsSync(options.cookieFile)),run);
 await assert.rejects(withVimeoSession({},async()=>{throw Error('fixture');},run),/fixture/);
 const controller=new AbortController();
 await assert.rejects(withVimeoSession({signal:controller.signal},()=>assert.fail(),async(script,args)=>{
  await run(script,args);controller.abort();return {code:0};}),{code:'JOB_STOPPED'});
 for(const file of files)assert.equal(fs.existsSync(file),false);
});
test('private request/control files are cleaned and structured errors do not leak raw output',async t=>{
 home(t);const paths=[],control=createJobControl();
 await withVimeoSession({},async options=>{
  await assert.rejects(requestVimeo({operation:'discover'}, {...options,control},async(script,args)=>{
   const spec=JSON.parse(fs.readFileSync(args[0],'utf8'));paths.push(args[0],spec.control);
   if(process.platform!=='win32')assert.equal(fs.statSync(spec.control).mode&0o777,0o600);
   return {code:1,stdout:'{"error":"VIMEO_AUTH"}',stderr:'secret-signed-url'};
  }),error=>error.code==='VIMEO_SESSION_INVALID'&&!error.message.includes('secret'));
 },async()=>({code:0}));
 assert.ok(paths.every(file=>!fs.existsSync(file)));
 assert.equal(vimeoFailure('VIMEO_RATE_LIMIT').code,'VIMEO_RATE_LIMIT');
});
test('Pause is mirrored atomically and Stop aborts the running helper without an outer signal',async t=>{
 home(t);const control=createJobControl();let controlPath;
 await withVimeoSession({},async options=>{
  await assert.rejects(requestVimeo({operation:'discover'},{...options,control},async(script,args,runOptions)=>{
   controlPath=JSON.parse(fs.readFileSync(args[0],'utf8')).control;control.pause();
   await new Promise(resolve=>setTimeout(resolve,140));
   assert.equal(JSON.parse(fs.readFileSync(controlPath)).paused,true);control.stop();
   await new Promise(resolve=>runOptions.signal.addEventListener('abort',resolve,{once:true}));
   return {code:1,stdout:''};
  }),{code:'JOB_STOPPED'});
 },async()=>({code:0}));
 assert.equal(fs.existsSync(controlPath),false);
});
test('download publishes only a fully validated video and retains the common callback order',async t=>{
 home(t);const events=[],post=normalizeVimeo(item(1),vimeoSavedLists[0]);
 const result=await downloadVimeo({posts:[post],onStagingReady:()=>events.push('staging'),onCompleted:()=>events.push('completed')},
 {session,request:async spec=>{fs.writeFileSync(path.join(spec.directory,'1.mp4'),'fixture');fs.writeFileSync(path.join(spec.directory,'1.f123.mp4'),'intermediate');},
 validate:async()=>events.push('validated')});
 assert.deepEqual(events,['staging','validated','completed']);assert.equal(result.results[0].files.length,1);
 assert.match(result.results[0].files[0],/1\.mp4$/);
});
test('corrupt video stays out of the import callback; Stop and rate limits stop the queue',async t=>{
 home(t);const post=normalizeVimeo(item(1),vimeoSavedLists[0]);let completed=0;
 const result=await downloadVimeo({posts:[post],onCompleted:()=>completed++},{session,
 request:async spec=>fs.writeFileSync(path.join(spec.directory,'1.mp4'),'broken'),validate:async()=>{throw Error('bad video');}});
 assert.equal(result.results[0].files.length,0);assert.equal(completed,0);
 for(const code of ['JOB_STOPPED','VIMEO_RATE_LIMIT','DISK_SPACE_LOW']){
  let calls=0;await assert.rejects(downloadVimeo({posts:[post,normalizeVimeo(item(2),vimeoSavedLists[0])]},{session,
   request:async()=>{calls++;throw Object.assign(Error(code),{code});}}),{code});assert.equal(calls,1);
 }
});
