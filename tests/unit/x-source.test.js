import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
globalThis.require=createRequire(import.meta.url);
const {nodeApi}=await import('../../js/node-bridge.js');
const {discoverX,listXCollections,normalizeX,default:source}=await import('../../js/sources/x.js');
const {downloadX}=await import('../../js/sources/x-download.js');
const {xTarget,xBookmarks,xMediaUrl}=await import('../../js/sources/x-target.js');
const {withXSession,requestX}=await import('../../js/sources/x-session.js');
const {parseStopLink}=await import('../../js/stop-link.js');
const {searchSettings,validateSourceLink}=await import('../../js/source-link.js');
const item=(id,count=1)=>({id:String(id),username:'artist',description:'Title\nCaption',created:'2026-01-01',components:Array.from({length:count},(_,i)=>({index:i+1,mediaType:i?'image':'video',extension:i?'jpg':'mp4',url:i?'https://pbs.twimg.com/media/a.jpg':'https://video.twimg.com/a.mp4',previewUrl:'https://pbs.twimg.com/media/a.jpg'}))});
const session=async(options,action)=>action({...options,cookieFile:'fixture'});
function home(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-x-test-')),original=nodeApi.os.homedir;nodeApi.os.homedir=()=>root;t.after(()=>{nodeApi.os.homedir=original;fs.rmSync(root,{recursive:true,force:true});});return root;}

test('X supports saved browser media and strict HTTPS post links only',()=>{
 assert.equal(source.needsAccount,false);assert.deepEqual(source.sourceModes,['browser']);
 assert.equal(searchSettings({platform:'x',source:'meta'}).source,'browser');
 for(const input of ['http://x.com/a/status/123','https://user:pass@x.com/a/status/123','https://x.com:8443/a/status/123','https://evil.x.com/a/status/123','https://x.com/a','https://x.com/i/bookmarks/123'])assert.throws(()=>xTarget(input));
 for(const input of ['https://x.com/a/status/123?share=1','https://twitter.com/a/status/123','https://x.com/i/web/status/123']){
  assert.equal(validateSourceLink('x',input),'https://x.com/i/web/status/123');assert.equal(parseStopLink(input,'x').publicationId,'123');}
 for(const input of ['http://x.com/a/status/123','https://evil.x.com/a/status/123'])assert.equal(parseStopLink(input,'x').ok,false);
 assert.throws(()=>xMediaUrl('https://pbs.twimg.com.evil/a'));assert.throws(()=>xMediaUrl('http://pbs.twimg.com/a'));
});
test('default Bookmarks and mixed carousels retain independent component indices',async()=>{
 const calls=[];const result=await discoverX({searchMode:'full'},{session,request:async spec=>{calls.push(spec);return {posts:[item(1,3)],checked:2,skippedText:1};}});
 assert.equal(calls[0].folder,'');assert.equal(result.posts[0].collectionId,'bookmarks');
 assert.equal(result.posts[0].type,'Карусель');assert.deepEqual(result.posts[0].selectedComponents,[1,2,3]);assert.equal(result.skippedText,1);
 assert.equal(result.posts[0].description,'Title\nCaption');
});
for(const mode of ['full','smart','recent'])test(`${mode} passes independent ranges and never substitutes folders with all bookmarks`,async()=>{
 const calls=[];const result=await discoverX({searchMode:mode,limit:15,knownPostIds:['x:2','vimeo:3'],collections:[{id:'10',name:'A'},{id:'20',name:'B'}],stopLink:parseStopLink('https://x.com/a/status/4','x')},
 {session,request:async spec=>{calls.push(spec);return {posts:[item(1)],stoppedEarly:true,stopLinkReached:true};}});
 assert.deepEqual(calls.map(c=>c.folder),['10','20']);assert.ok(calls.every(c=>c.limit===(mode==='recent'?15:0)&&c.stopId==='4'));
 assert.deepEqual(calls[0].known,mode==='full'?[]:['2']);assert.equal(result.posts.length,1);assert.equal(result.posts[0].containers.length,2);
 assert.deepEqual(result.stopLinkTargets,['10','20']);
});
test('X catalog and direct post are explicit; bad media or indices are rejected',async()=>{
 assert.deepEqual((await listXCollections({},{session,request:async()=>({containers:[{id:'7',name:'Folder'}]})})).map(c=>c.id),['bookmarks','7']);
 let spec;await discoverX({targetUrl:'https://x.com/a/status/99'},{session,request:async s=>{spec=s;return {posts:[]};}});assert.equal(spec.postId,'99');assert.equal(spec.folder,'');
 assert.throws(()=>normalizeX({...item(1),components:[{...item(1).components[0],url:'https://evil.test/a'}]},xBookmarks));
 assert.throws(()=>normalizeX({...item(1),components:[{...item(1).components[0],index:99}]},xBookmarks));
});
test('X snapshots are private before export and removed after failed requests',async t=>{
 home(t);const paths=[];
 await withXSession({},async options=>{assert.ok(fs.existsSync(options.cookieFile));
  await assert.rejects(requestX({operation:'probe'},options,async(script,args)=>{paths.push(args[0]);return {code:1,stdout:'{"error":"X_AUTH"}',stderr:'private-secret'};}),e=>e.code==='X_SESSION_INVALID'&&!e.message.includes('secret'));
 },async(script,args)=>{paths.push(args[0]);assert.equal(args[3],'x');if(process.platform!=='win32')assert.equal(fs.statSync(args[0]).mode&0o777,0o600);return {code:0};});
 assert.ok(paths.every(p=>!fs.existsSync(p)));
});
test('X downloads only selected components, validates before publishing and reports partial failure',async t=>{
 home(t);const post=normalizeX(item(1,3),xBookmarks);post.selectedComponents=[1,3];const events=[];
 const result=await downloadX({posts:[post],onCompleted:entry=>events.push(entry.files.length)},
 {download:async(url,file,options)=>{options.validateUrl(url);fs.writeFileSync(file,'fixture');},validate:async file=>{events.push(path.basename(file));if(file.endsWith('3.jpg'))throw Error('corrupt');}});
 assert.deepEqual(events,['1.mp4','3.jpg',1]);assert.equal(result.results[0].files.length,1);assert.ok(result.results[0].error);
});
test('X rate limit, cancellation and disk full stop the queue',async t=>{
 home(t);const posts=[normalizeX(item(1),xBookmarks),normalizeX(item(2),xBookmarks)];
 for(const [error,code] of [[Error('HTTP 429'),'X_RATE_LIMIT'],[Object.assign(Error('disk'),{code:'ENOSPC'}),'DISK_SPACE_LOW'],[Object.assign(Error('cancel'),{code:'JOB_STOPPED'}),'JOB_STOPPED']]){
  let calls=0;await assert.rejects(downloadX({posts},{download:async()=>{calls++;throw error;}}),{code});assert.equal(calls,1);}
 const controller=new AbortController();let calls=0;
 await assert.rejects(discoverX({signal:controller.signal,collections:[{id:'10'},{id:'20'}]},{session,request:async()=>{calls++;controller.abort();return {posts:[]};}}),{code:'JOB_STOPPED'});assert.equal(calls,1);
});
