import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
globalThis.require=createRequire(import.meta.url);
const {nodeApi}=await import('../../js/node-bridge.js');
const {default:source,discoverThreads,normalizeThreads,downloadThreads}=await import('../../js/sources/threads.js');
const {threadsTarget,threadsMediaUrl}=await import('../../js/sources/threads-target.js');
const {withThreadsSession}=await import('../../js/sources/threads-session.js');
const {parseStopLink}=await import('../../js/stop-link.js');
const {searchSettings,effectiveFolderSearch,validateSourceLink}=await import('../../js/source-link.js');
const {parseArchiveMetadata}=await import('../../js/archive-reader.js');
const {archiveHttpsUrl}=await import('../../js/authenticated-links.js');
const {resolveThreadsArchiveLinks}=await import('../../js/sources/threads-archive.js');
const item=(id='Code_1')=>({id,url:`https://www.threads.com/@artist/post/${id}`,author:'artist',description:'Title\nCaption',takenAt:1000,components:[{index:1,mediaType:'image',url:'https://scontent.cdninstagram.com/a.jpg',previewUrl:'https://scontent.cdninstagram.com/a.jpg',extension:'jpg'},{index:2,mediaType:'video',url:'https://video.fbcdn.net/a.mp4',previewUrl:'https://scontent.cdninstagram.com/a.jpg',extension:'mp4'}]});
const session=async(options,action)=>action({...options,cookieFile:'fixture'});
function home(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-threads-source-')),old=nodeApi.os.homedir;nodeApi.os.homedir=()=>root;t.after(()=>{nodeApi.os.homedir=old;fs.rmSync(root,{recursive:true,force:true});});return root;}
test('Threads is the eighth source with Saved/Link/Likes and archives, without manual account or fake folders',async()=>{
 const {installSources}=await import('../../js/sources/index.js');const all=installSources();assert.equal(all.at(-1).code,'threads');assert.equal(all.length,8);assert.deepEqual(source.sourceModes,['browser','archive']);assert.equal(source.needsAccount,false);assert.equal(source.listContainers,undefined);assert.equal(searchSettings({platform:'threads',source:'meta',folderSearch:true}).folderSearch,false);assert.equal(effectiveFolderSearch({platform:'threads',folderSearch:true}),false);
});
test('Threads links and stop boundaries canonicalize both domains and short links while rejecting foreign routes',()=>{
 for(const url of ['https://www.threads.net/@artist/post/Code_1?x=1','https://threads.com/@artist/post/Code_1'])assert.equal(validateSourceLink('threads',url),'https://www.threads.com/@artist/post/Code_1');
 assert.equal(threadsTarget('https://threads.net/t/Code_1').id,'Code_1');assert.equal(parseStopLink('https://threads.com/@artist/post/Code_1','threads').publicationId,'Code_1');
 for(const url of ['http://threads.com/t/Code_1','https://threads.com:8443/t/Code_1','https://u:p@threads.com/t/Code_1','https://threads.com.evil.test/t/Code_1','https://evil.threads.com/t/Code_1','https://threads.com/@artist','https://threads.com/saved/','https://threads.com/api/graphql']){assert.throws(()=>threadsTarget(url));assert.equal(parseStopLink(url,'threads').ok,false);}
});
test('Threads CDN allowlist never permits cookies to arbitrary media or local URLs',()=>{
 assert.equal(threadsMediaUrl('https://scontent.cdninstagram.com/a.jpg?token=fixture'),'https://scontent.cdninstagram.com/a.jpg?token=fixture');
 for(const url of ['http://video.fbcdn.net/a.mp4','https://cdninstagram.com.evil.test/a.jpg','https://127.0.0.1/a.jpg','file:///tmp/a.jpg','https://u:p@video.fbcdn.net/a.mp4'])assert.throws(()=>threadsMediaUrl(url));
});
for(const mode of ['smart','full','recent'])test('Threads '+mode+' search passes only its own known IDs and correct limit',async()=>{
 let spec;const r=await discoverThreads({searchMode:mode,limit:15,knownPostIds:['threads:Code_2','instagram:Code_1'],folderSearch:true,collections:[{id:'other-network'}]},{session,request:async s=>{spec=s;return {posts:[item()]};}});
 assert.equal(spec.feed,'saved');assert.equal(spec.target,null);assert.equal(spec.limit,mode==='recent'?15:0);assert.deepEqual(spec.known,mode==='full'?[]:['Code_2']);assert.equal(spec.collections,undefined);assert.equal(r.posts[0].postId,'threads:Code_1');
});
test('Threads Likes ignores retained folder/link input and uses the same publication ID for duplicate protection',async()=>{
 let spec;const r=await discoverThreads({downloadMode:'liked',targetUrl:'invalid-retained-link',collections:[{id:'old'}]},{session,request:async s=>{spec=s;return {posts:[{...item(),feed:'liked'}]};}});
 assert.equal(spec.feed,'liked');assert.equal(spec.target,null);assert.equal(r.posts[0].postId,normalizeThreads(item()).postId);assert.equal(r.posts[0].collectionId,'liked');
});
test('Threads mixed carousel uses one title and description, stable component order and separate media IDs',()=>{
 const post=normalizeThreads(item());assert.equal(post.title,'Title');assert.equal(post.description,'Title\nCaption');assert.equal(post.type,'Карусель');assert.deepEqual(post.selectedComponents,[1,2]);assert.deepEqual(post.components.map(c=>c.mediaType),['image','video']);assert.equal(post.components.length,2);
 assert.throws(()=>normalizeThreads({...item(),id:'different'}));assert.throws(()=>normalizeThreads({...item(),components:[{...item().components[0],index:2}]}));
});
test('Threads archives read Meta JSON/HTML links without running markup or including other networks and secrets',()=>{
 const json=JSON.stringify({saved:[{string_map_data:{link:{href:'http://www.threads.net/@artist/post/Code_1'}}},{href:'https://threads.com/t/Code_1'}],messages:{href:'https://threads.com/t/Secret1'},cookies:{href:'https://threads.com/t/Secret2'},instagram:{href:'https://instagram.com/p/Other1'}});
 const result=parseArchiveMetadata(json,'.json','threads');assert.equal(result.links.length,1);assert.equal(result.links[0].publicationId,'Code_1');assert.ok(result.links[0].url.startsWith('https://www.threads.com/'));
 const html=parseArchiveMetadata('<script>throw Error()</script><a href="https://www.threads.net/t/Code_2?x=1&amp;y=2">post</a>','.html','threads');assert.equal(html.links[0].publicationId,'Code_2');
 assert.equal(archiveHttpsUrl('http://threads.net/t/Code_1','threads'),'https://www.threads.com/t/Code_1');assert.throws(()=>archiveHttpsUrl('http://threads.net.evil.test/t/Code_1','threads'));
 const ordered=parseArchiveMetadata(JSON.stringify({saved:[{string_map_data:{link:{href:'https://threads.com/t/Code_1'}}},{string_map_data:{link:{href:'https://threads.com/t/Code_2'}}}]}),'.json','threads');assert.deepEqual(ordered.links.map(link=>link.publicationId),['Code_1','Code_2']);
});
test('Threads archive link resolution reuses one browser snapshot and checkpoints complete posts only',async()=>{
 let sessions=0,calls=0,resolved=0;const links=[{publicationId:'Code_1',url:'https://threads.net/t/Code_1'},{publicationId:'Code_2',url:'https://threads.net/t/Code_2'}];
 const r=await resolveThreadsArchiveLinks(links,{settings:{browser:'firefox',browserProfile:'selected'},onResolved:()=>resolved++},{session:async(o,action)=>{sessions++;assert.equal(o.browserProfile,'selected');return action(o);},discover:async o=>{calls++;assert.equal(o.downloadMode,'link');assert.equal(o.folderSearch,false);return {posts:[normalizeThreads(item(calls===1?'Code_1':'Code_2'))]};}});
 assert.equal(sessions,1);assert.equal(calls,2);assert.equal(resolved,2);assert.equal(r.posts.length,2);assert.ok(r.posts.every(p=>p.archiveLink));
});
test('Threads archive rate limit halts the queue after prior complete posts were checkpointed',async()=>{
 let calls=0,resolved=0;const links=[1,2,3].map(n=>({publicationId:'Code_'+n,url:'https://threads.com/t/Code_'+n}));
 await assert.rejects(resolveThreadsArchiveLinks(links,{settings:{},onResolved:()=>resolved++},{session,discover:async()=>{calls++;if(calls===2)throw Object.assign(Error('limited'),{code:'THREADS_RATE_LIMIT'});return {posts:[normalizeThreads(item())]};}}),{code:'THREADS_RATE_LIMIT'});assert.equal(calls,2);assert.equal(resolved,1);
});
test('Threads selected-component download and recovery preserve existing carousel/import contracts',async t=>{
 home(t);const post={...normalizeThreads(item()),selectedComponents:[2]},downloads=[];
 const r=await downloadThreads({posts:[post]},{download:async(url,file)=>{downloads.push(url);fs.writeFileSync(file,'fixture');},validate:async()=>{}});assert.equal(r.results[0].files.length,1);assert.ok(downloads[0].endsWith('/a.mp4'));
 const {normalizeRecoveryState}=await import('../../js/job-recovery.js');const saved=normalizeRecoveryState({jobId:'fixture',phase:'downloaded',posts:[post]}).posts[0];assert.equal(saved.postId,post.postId);assert.deepEqual(saved.selectedComponents,[2]);
});
test('Threads private cookie export is protected before writing and removed after failed requests',async t=>{
 const root=home(t);let file;
 await assert.rejects(withThreadsSession({browser:'chrome',browserProfile:'Profile 1'},async()=>{throw Error('test failure');},async(_script,args)=>{file=args[0];assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(args.at(-1),'threads');return {code:0};}),/test failure/);
 assert.equal(fs.existsSync(file),false);assert.ok(file.startsWith(root));
});
test('Threads new messages are available in all supported languages',async()=>{const {threadsMessages}=await import('../../js/locales/threads.js');const {translate}=await import('../../js/i18n.js');for(const row of threadsMessages)for(const lang of ['en','fr','es','zh'])assert.notEqual(translate(row[0],lang),row[0]);});

test('Threads partial discovery reports safe failed-post URLs and interruptions',async()=>{const logs=[];const r=await discoverThreads({onLog:text=>logs.push(text)},{session,request:async()=>({posts:[item()],failures:[{code:'THREADS_FORMAT',url:'https://threads.net/t/Code_2'}],interruption:{code:'THREADS_RATE_LIMIT'}})});assert.equal(r.posts.length,1);assert.equal(r.failures.length,1);assert.equal(logs.length,2);assert.ok(logs[0].includes('https://www.threads.com/t/Code_2'));await assert.rejects(discoverThreads({},{session,request:async()=>({posts:[],failures:[{code:'THREADS_FORMAT',url:'https://evil.test/t/Code_2'}]})}),{code:'THREADS_URL'});});
test('Threads refreshes expired signed media once per post and preserves selected carousel indices',async t=>{
 home(t);let refreshed=0;const attempts=[];const post=normalizeThreads(item());
 const r=await downloadThreads({posts:[post]},{download:async(url,file)=>{attempts.push(url);if(!url.includes('?fresh'))throw Error('HTTP 403');fs.writeFileSync(file,'fixture');},validate:async()=>{},discover:async o=>{refreshed++;assert.equal(o.targetUrl,post.url);assert.equal(o.onProgress,null);return {posts:[{...post,components:post.components.map(c=>({...c,url:c.url+'?fresh=1'}))}]};}});
 assert.equal(refreshed,1);assert.equal(r.results[0].files.length,2);assert.equal(attempts.length,4);
});
test('Threads refuses changed carousel structure during signed-link refresh',async t=>{
 home(t);const post=normalizeThreads(item());let writes=0,refreshes=0;
 const r=await downloadThreads({posts:[post]},{download:async()=>{writes++;throw Error('HTTP 403');},validate:async()=>{},discover:async()=>{refreshes++;return {posts:[{...post,components:post.components.slice(0,1)}]};}});assert.equal(r.results[0].files.length,0);assert.equal(writes,2);assert.equal(refreshes,1);assert.ok(r.results[0].error.includes('Неполная публикация'));
});
test('Threads media refresh rate limit aborts the remaining queue',async t=>{
 home(t);let attempts=0;
 await assert.rejects(downloadThreads({posts:[normalizeThreads(item()),normalizeThreads(item('Code_2'))]},{download:async()=>{attempts++;throw Error('HTTP 403');},discover:async()=>{throw Object.assign(Error('limited'),{code:'THREADS_RATE_LIMIT'});}}),{code:'THREADS_RATE_LIMIT'});assert.equal(attempts,1);
});
