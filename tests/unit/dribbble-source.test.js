import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
globalThis.require=createRequire(import.meta.url);
const {nodeApi}=await import('../../js/node-bridge.js');
const {discoverDribbble,listDribbbleCollections,normalizeDribbble,downloadDribbble,default:source}=await import('../../js/sources/dribbble.js');
const {dribbbleTarget,dribbbleMediaUrl}=await import('../../js/sources/dribbble-target.js');
const {withDribbbleSession,requestDribbble}=await import('../../js/sources/dribbble-session.js');
const {parseStopLink}=await import('../../js/stop-link.js');
const {searchSettings,validateSourceLink}=await import('../../js/source-link.js');
const {buildNames}=await import('../../js/eagle-import.js');
const collection={id:'10',name:'Saved',url:'https://dribbble.com/collector/collections/10-Saved'};
const item=(id=1,count=3)=>({id:String(id),url:`https://dribbble.com/shots/${id}-Title`,title:'Shot title',author:'artist',description:'Intro\n\nA\n\nB',introDescription:'Intro',collections:[collection],
 components:Array.from({length:count},(_,i)=>({index:i+1,blockId:String(100+i),mediaType:i?'image':'video',extension:i?'jpg':'mp4',url:`https://cdn.dribbble.com/userupload/1/file/${i?'a.jpg':'large-a.mp4'}`,previewUrl:'https://cdn.dribbble.com/userupload/1/file/still-a.png',description:['A','B',''][i]}))});
const session=async(options,action)=>action({...options,cookieFile:'fixture'});
function home(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-drib-test-')),original=nodeApi.os.homedir;nodeApi.os.homedir=()=>root;t.after(()=>{nodeApi.os.homedir=original;fs.rmSync(root,{recursive:true,force:true});});return root;}
test('Dribbble supports saved browser collections and strict shot/collection/profile HTTPS links',()=>{
 assert.equal(source.needsAccount,false);assert.deepEqual(source.sourceModes,['browser']);assert.equal(searchSettings({platform:'dribbble',source:'meta'}).source,'browser');
 for(const input of ['http://dribbble.com/shots/1-a','https://u:p@dribbble.com/shots/1','https://dribbble.com:8443/shots/1','https://evil.dribbble.com/shots/1','https://dribbble.com/a/likes','https://dribbble.com/shots/popular','https://dribbble.com/account'])assert.throws(()=>dribbbleTarget(input));
 assert.equal(validateSourceLink('dribbble','https://www.dribbble.com/a/buckets/10-Saved'),'https://dribbble.com/a/collections/10-Saved');
 assert.equal(dribbbleTarget('https://dribbble.com/a').url,'https://dribbble.com/a/collections');
 for(const url of ['http://dribbble.com/shots/1','https://evil.dribbble.com/shots/1','https://dribbble.com/a/collections/1'])assert.equal(parseStopLink(url,'dribbble').ok,false);
 assert.equal(parseStopLink('https://dribbble.com/shots/1-Title','dribbble').publicationId,'1');
 for(const url of ['http://cdn.dribbble.com/userupload/a.jpg','https://cdn.dribbble.com.evil/a.jpg','https://cdn.dribbble.com/login'])assert.throws(()=>dribbbleMediaUrl(url));
});
for(const mode of ['full','smart','recent'])test(`Dribbble ${mode} defaults to all saved collections without supplying a Likes target`,async()=>{
 let spec;const r=await discoverDribbble({searchMode:mode,limit:15,knownPostIds:['dribbble:2','x:3']},{session,request:async s=>{spec=s;return {posts:[item()]};}});
 assert.equal(spec.target,null);assert.deepEqual(spec.collections,[]);assert.equal(spec.perFolder,false);assert.equal(spec.limit,mode==='recent'?15:0);assert.deepEqual(spec.known,mode==='full'?[]:['2']);assert.equal(r.posts[0].postId,'dribbble:1');
});
test('selected collections retain verified IDs/URLs and get an independent N; catalog has no builtin Likes',async()=>{
 let spec;await discoverDribbble({collections:[collection],searchMode:'recent',limit:2,stopLink:parseStopLink('https://dribbble.com/shots/4','dribbble')},{session,request:async s=>{spec=s;return {posts:[]};}});
 assert.equal(spec.perFolder,true);assert.equal(spec.limit,2);assert.equal(spec.collections[0].url,collection.url);assert.equal(spec.stopId,'4');
 assert.deepEqual((await listDribbbleCollections({},{session,request:async()=>({containers:[collection]})})).map(c=>c.id),['10']);
 assert.throws(()=>normalizeDribbble({...item(),url:'https://dribbble.com/shots/99'}));
});
test('Dribbble source snapshots are private before writing and cleaned on a failed request',async t=>{
 home(t);const paths=[];
 await withDribbbleSession({},async options=>{
  await assert.rejects(requestDribbble({operation:'probe'},options,async(script,args)=>{paths.push(args[0]);return {code:1,stdout:'{"error":"DRIBBBLE_AUTH"}',stderr:'secret'};}),e=>e.code==='DRIBBBLE_SESSION_INVALID'&&!e.message.includes('secret'));
 },async(script,args)=>{paths.push(args[0]);assert.equal(args[3],'dribbble');if(process.platform!=='win32')assert.equal(fs.statSync(args[0]).mode&0o777,0o600);return {code:0};});
 assert.ok(paths.every(p=>!fs.existsSync(p)));
});
test('each Dribbble component uses the shot title and only its own caption, including a blank caption',()=>{
 const p=normalizeDribbble(item());const values=buildNames({posts:[p],selected:[p.postId],numberingEnabled:false,descriptionEnabled:false}).get(p.postId);
 assert.deepEqual(values.componentNames,['Shot title','Shot title','Shot title']);assert.deepEqual(values.componentDescriptions,['A','B','']);assert.ok(!values.description.includes('Intro'));
});
test('single media does not inherit leading or aggregated shot text',()=>{
 const p=normalizeDribbble(item(1,1));p.components[0].description='';
 const values=buildNames({posts:[p],selected:[p.postId],numberingEnabled:false,descriptionEnabled:false}).get(p.postId);
 assert.equal(values.componentDescriptions[0],'');assert.equal(values.description,'');assert.equal(values.name,'Shot title');
});
test('selected component positions, numbering, and extra description rules stay independent',()=>{
 const p=normalizeDribbble(item());p.selectedComponents=[1,3];
 const v=buildNames({posts:[p],selected:[p.postId],counters:[{id:'c',mode:'carousel',start:4,direction:'start',placement:'start',destination:'both',marker:'C',independent:true}],descriptions:[{text:'Extra',destination:'description',placement:'end'}]}).get(p.postId);
 assert.deepEqual(v.componentNames,['Shot title C4',,'Shot title C6']);assert.equal(v.componentDescriptions[0],'A\n\nC4\n\nExtra');assert.equal(v.componentDescriptions[2],'C6\n\nExtra');assert.ok(!v.description.includes('B'));
});
test('legacy numbering and extra text preserve local captions and a common base title',()=>{
 const p=normalizeDribbble(item());const v=buildNames({posts:[p],selected:[p.postId],startNumber:4,marker:'D',destination:'both',extraDescription:'Extra'}).get(p.postId);
 assert.deepEqual(v.componentNames,['Shot title D4-1','Shot title D4-2','Shot title D4-3']);assert.deepEqual(v.componentDescriptions,['D4-1\n\nExtra\n\nA','D4-2\n\nExtra\n\nB','D4-3\n\nExtra']);
});
test('unselected posts still display the shot title and local captions',()=>{
 const p=normalizeDribbble(item());const v=buildNames({posts:[p],selected:[],numberingEnabled:true,descriptionEnabled:false}).get(p.postId);
 assert.equal(v.name,'Shot title');assert.deepEqual(v.componentDescriptions,['A','B','']);
});
test('Dribbble download validates selected files before recovery callback and marks partial media failures',async t=>{
 home(t);const p=normalizeDribbble(item());p.selectedComponents=[1,3];const events=[];
 const r=await downloadDribbble({posts:[p],onCompleted:e=>events.push(e.files.length)},{download:async(url,file,options)=>{options.validateUrl(url);assert.equal(options.cookies,undefined);fs.writeFileSync(file,'fixture');},validate:async file=>{events.push(path.basename(file));if(file.endsWith('3.jpg'))throw Error('corrupt');}});
 assert.deepEqual(events,['1.mp4','3.jpg',1]);assert.equal(r.results[0].files.length,1);assert.ok(r.results[0].error);
});
test('Dribbble download stops on rate limit, cancellation, or disk full without advancing the queue',async t=>{
 home(t);const posts=[normalizeDribbble(item(1)),normalizeDribbble(item(2))];
 for(const [error,code] of [[Error('HTTP 429'),'DRIBBBLE_RATE_LIMIT'],[Object.assign(Error('disk'),{code:'ENOSPC'}),'DISK_SPACE_LOW'],[Object.assign(Error('cancel'),{code:'JOB_STOPPED'}),'JOB_STOPPED']]){
  let calls=0;await assert.rejects(downloadDribbble({posts},{download:async()=>{calls++;throw error;}}),{code});assert.equal(calls,1);
 }
 const controller=new AbortController();await assert.rejects(discoverDribbble({signal:controller.signal},{session,request:async()=>{controller.abort();return {posts:[]};}}),{code:'JOB_STOPPED'});
});
test('browser request identity reads the installed Chromium version without copying profile/account metadata',async t=>{
 home(t);const {browserRoot}=await import('../../js/browser-profiles.js');const {dribbbleBrowserIdentity}=await import('../../js/sources/dribbble-browser.js');
 const root=browserRoot('chrome');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'Last Version'),'155.0.1.2');
 const identity=dribbbleBrowserIdentity('chrome');assert.ok(identity.headers['User-Agent'].includes('Chrome/155.0.0.0'));assert.ok(identity.headers['sec-ch-ua'].includes('v="155"'));
 assert.deepEqual(Object.keys(identity.headers).sort(),['User-Agent','sec-ch-ua','sec-ch-ua-platform']);assert.deepEqual(dribbbleBrowserIdentity('unknown'),{});
});
test('recovery keeps the common shot title and local captions for selected media',async()=>{
 const {normalizeRecoveryState}=await import('../../js/job-recovery.js');const p=normalizeDribbble(item());p.selectedComponents=[2,3];
 const restored=normalizeRecoveryState({jobId:'fixture',phase:'downloaded',posts:[p],selectedPostIds:[p.postId]}).posts[0];
 const values=buildNames({posts:[restored],selected:[restored.postId],numberingEnabled:false,descriptionEnabled:false}).get(p.postId);
 assert.deepEqual(restored.selectedComponents,[2,3]);assert.deepEqual(values.componentNames,[,'Shot title','Shot title']);assert.deepEqual(values.componentDescriptions,[,'B','']);
});
test('Dribbble refuses a download root outside its staging area',async t=>{
 const root=home(t);await assert.rejects(downloadDribbble({posts:[normalizeDribbble(item())],stagingRoot:path.join(root,'foreign')},{download:async()=>assert.fail('must not download')}),/Unsafe staging directory/);
});
