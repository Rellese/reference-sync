import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
globalThis.require=createRequire(import.meta.url);
const {nodeApi}=await import('../../js/node-bridge.js');
const {discoverLayers,listLayersCollections,normalizeLayers,downloadLayers,default:source}=await import('../../js/sources/layers.js');
const {layersTarget,layersMediaUrl}=await import('../../js/sources/layers-target.js');
const {withLayersSession,requestLayers}=await import('../../js/sources/layers-session.js');
const {parseStopLink}=await import('../../js/stop-link.js');
const {searchSettings,validateSourceLink}=await import('../../js/source-link.js');
const {buildNames}=await import('../../js/eagle-import.js');
const {selectedDownloadedFiles}=await import('../../js/carousel-selection.js');
const id=n=>'c'+String(n).padStart(24,'0'),collection={id:id(10),name:'Saved',url:'https://layers.to/collections/'+id(10)};
const item=(n=1,ext='png')=>({id:id(n),url:'https://layers.to/layers/'+id(n),title:'Work title',author:'artist',description:'Caption\nSecond paragraph',created:'2026-01-01',collections:[collection],components:[{index:1,mediaType:ext==='mp4'?'video':'image',extension:ext,url:'https://layers-r2.com/file.'+ext,previewUrl:'https://layers-r2.com/poster.png'}]});
const session=async(options,action)=>action({...options,cookieFile:'fixture'});
function home(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-layers-test-')),original=nodeApi.os.homedir;nodeApi.os.homedir=()=>root;t.after(()=>{nodeApi.os.homedir=original;fs.rmSync(root,{recursive:true,force:true});});return root;}
test('Layers offers saved browser collections and only verified HTTPS layer/collection/profile routes',()=>{
 assert.equal(source.needsAccount,false);assert.deepEqual(source.sourceModes,['browser']);assert.equal(source.singleMediaOnly,true);assert.equal(searchSettings({platform:'layers',source:'meta'}).source,'browser');
 for(const url of ['http://layers.to/layers/'+id(1),'https://u:p@layers.to/layers/'+id(1),'https://layers.to:8443/layers/'+id(1),'https://evil.layers.to/layers/'+id(1),'https://layers.to/a/likes','https://layers.to/explore','https://layers.to/api/v1/groups'])assert.throws(()=>layersTarget(url));
 assert.equal(validateSourceLink('layers','https://www.layers.to/layers/'+id(1)+'-Title?ref=share'),'https://layers.to/layers/'+id(1));assert.equal(layersTarget('https://layers.to/collector').url,'https://layers.to/collector/groups');
 assert.equal(parseStopLink('https://layers.to/layers/'+id(1)+'-Title','layers').publicationId,id(1));
 for(const url of ['http://layers.to/layers/'+id(1),'https://layers.to/collections/'+id(1),'https://evil.layers.to/layers/'+id(1)])assert.equal(parseStopLink(url,'layers').ok,false);
});
test('Layers media allowlist accepts platform buckets and rejects unrelated storage or HTTP',()=>{
 for(const url of ['https://layers-r2.com/a.mp4','https://layers-uploads-prod.s3.eu-west-2.amazonaws.com/a.png','https://s3.amazonaws.com/layers-uploads-prod/a.svg'])assert.equal(layersMediaUrl(url),url);
 for(const url of ['http://layers-r2.com/a.mp4','https://layers-r2.com.evil.test/a.png','https://other.s3.eu-west-2.amazonaws.com/a.png','https://s3.amazonaws.com/other/a.png'])assert.throws(()=>layersMediaUrl(url));
});
for(const mode of ['full','smart','recent'])test(`Layers ${mode} defaults to own collections with the proper limit/known boundary`,async()=>{
 let spec;const r=await discoverLayers({searchMode:mode,limit:15,knownPostIds:['layers:'+id(2),'x:3']},{session,request:async s=>{spec=s;return {posts:[item()]};}});
 assert.equal(spec.target,null);assert.deepEqual(spec.collections,[]);assert.equal(spec.perFolder,false);assert.equal(spec.limit,mode==='recent'?15:0);assert.deepEqual(spec.known,mode==='full'?[]:[id(2)]);assert.equal(r.posts[0].postId,'layers:'+id(1));
});
test('selected Layers folders use their own IDs; catalog adds no Likes/Explore entry',async()=>{
 let spec;await discoverLayers({collections:[collection],searchMode:'recent',limit:2,stopLink:parseStopLink('https://layers.to/layers/'+id(4),'layers')},{session,request:async s=>{spec=s;return {posts:[]};}});
 assert.equal(spec.perFolder,true);assert.equal(spec.collections[0].id,collection.id);assert.equal(spec.stopId,id(4));
 assert.deepEqual((await listLayersCollections({},{session,request:async()=>({containers:[collection]})})).map(c=>c.id),[id(10)]);
});
test('Layers title, author, description and single media remain distinct with standard naming rules',()=>{
 const p=normalizeLayers(item());const v=buildNames({posts:[p],selected:[p.postId],numberingEnabled:false,descriptionEnabled:false}).get(p.postId);
 assert.equal(p.username,'@artist');assert.equal(v.name,'Work title');assert.equal(v.componentDescriptions[0],'Caption\nSecond paragraph');assert.equal(p.componentCount,1);
 assert.throws(()=>normalizeLayers({...item(),components:[...item().components,...item().components]}));
});
test('Layers snapshots are private before writing and cleaned on failure',async t=>{
 home(t);const paths=[];
 await withLayersSession({},async options=>{
  await assert.rejects(requestLayers({operation:'probe'},options,async(script,args)=>{paths.push(args[0]);return {code:1,stdout:'{"error":"LAYERS_AUTH"}',stderr:'private-secret'};}),e=>e.code==='LAYERS_SESSION_INVALID'&&!e.message.includes('private-secret'));
 },async(script,args)=>{paths.push(args[0]);assert.equal(args[3],'layers');if(process.platform!=='win32')assert.equal(fs.statSync(args[0]).mode&0o777,0o600);return {code:0};});assert.ok(paths.every(file=>!fs.existsSync(file)));
});
test('Layers SVG/GIF and video files retain their final indices for import; unselected media is not downloaded',async t=>{
 home(t);const posts=[normalizeLayers(item(1,'svg')),normalizeLayers(item(2,'gif')),normalizeLayers(item(3,'mp4'))];posts[2].selectedComponents=[];const callbacks=[];
 const r=await downloadLayers({posts,onCompleted:e=>callbacks.push(e.post.postId)},{download:async(url,file,options)=>{options.validateUrl(url);assert.equal(options.cookies,undefined);fs.writeFileSync(file,'fixture');},validate:async()=>{}});
 assert.equal(r.results[0].files.length,1);assert.equal(r.results[2].files.length,0);assert.deepEqual(callbacks,posts.slice(0,2).map(p=>p.postId));assert.equal(selectedDownloadedFiles(r.results[0])[0].componentIndex,0);
});
test('failed validation is not published to recovery; rate limit, stop and disk full halt the queue',async t=>{
 home(t);const posts=[normalizeLayers(item(1,'mp4')),normalizeLayers(item(2))];let callbacks=0;
 const r=await downloadLayers({posts:[posts[0]],onCompleted:()=>callbacks++},{download:async(url,file)=>fs.writeFileSync(file,'fixture'),validate:async()=>{throw Error('corrupt');}});assert.equal(r.results[0].files.length,0);assert.ok(r.results[0].error);assert.equal(callbacks,0);
 for(const [error,code] of [[Error('HTTP 429'),'LAYERS_RATE_LIMIT'],[Object.assign(Error('disk'),{code:'ENOSPC'}),'DISK_SPACE_LOW'],[Object.assign(Error('stop'),{code:'JOB_STOPPED'}),'JOB_STOPPED']]){
  let calls=0;await assert.rejects(downloadLayers({posts},{download:async()=>{calls++;throw error;}}),{code});assert.equal(calls,1);
 }
});
test('Layers cancellation, recovery and staging boundaries use the existing contracts',async t=>{
 const root=home(t),controller=new AbortController();await assert.rejects(discoverLayers({signal:controller.signal},{session,request:async()=>{controller.abort();return {posts:[]};}}),{code:'JOB_STOPPED'});
 await assert.rejects(downloadLayers({posts:[normalizeLayers(item())],stagingRoot:path.join(root,'foreign')}),/Unsafe staging directory/);
 const {normalizeRecoveryState}=await import('../../js/job-recovery.js');const p=normalizeLayers(item()),restored=normalizeRecoveryState({jobId:'fixture',phase:'downloaded',posts:[p]}).posts[0];assert.equal(restored.namingName,'Work title');assert.equal(restored.components[0].index,1);
});
