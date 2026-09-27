import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import stream from 'node:stream';
import zlib from 'node:zlib';
import {nodeApi} from '../../js/node-bridge.js';
import {packageBehanceCase} from '../../js/case/package.js';
import {writeCaseZip} from '../../js/case/zip-writer.js';
import {listZip,extractZip} from '../../js/archive-zip.js';

function setup(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-case-'));
 const previous={...nodeApi};Object.assign(nodeApi,{fs,path,crypto,stream,zlib,Buffer});
 t.after(()=>{Object.assign(nodeApi,previous);fs.rmSync(root,{recursive:true,force:true});});
 return root;
}
function entry(root) {
 const image=path.join(root,'1.png');
 fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'));
 return {files:[image],post:{source:'behance',caseDocument:{format:'reference-sync-case',version:1,canvasWidth:1400,
  source:{id:'12',url:'https://www.behance.net/gallery/12/a',title:'Case'},cookies:'secret',
  blocks:[{kind:'image',componentNumber:1,sourceUrl:'https://cdn.example/private?token=secret'},
   {kind:'text',text:'<script>literal text</script>',links:[{url:'javascript:alert(1)'},{url:'https://example.test/',text:'Source'}]},
   {kind:'video',componentNumber:2,status:'downloadable',embedUrl:'https://player.example/'},
   {kind:'unsupported',status:'unsupported'}]}}};
}
test('case round trips local assets, ordered text and missing blocks without remote media or local paths',async t=>{
 const root=setup(t), input=entry(root), output=path.join(root,'case.rscase');
 const result=await packageBehanceCase(input,output);
 assert.equal(result.manifest.complete,false);
 assert.deepEqual(result.manifest.blocks.map(b=>b.status),['local','text','unavailable','unsupported']);
 assert.equal(result.manifest.cover,'assets/1.png');
 assert.deepEqual(listZip(output).map(e=>e.name),['manifest.json','assets/1.png']);
 await extractZip(output,path.join(root,'unpacked'));
 assert.deepEqual(fs.readFileSync(path.join(root,'unpacked/assets/1.png')),fs.readFileSync(input.files[0]));
 const saved=fs.readFileSync(path.join(root,'unpacked/manifest.json'),'utf8');
 assert.deepEqual(JSON.parse(saved),result.manifest);
 assert.equal(/secret|cdn.example|player.example/.test(saved),false);assert.equal(saved.includes(root),false);
 assert.deepEqual(result.manifest.blocks[1].links,[{url:'https://example.test/',text:'Source'}]);
 assert.equal(fs.existsSync(input.files[0]),true);
});
test('text-only case has a local generated cover and no dependency on remote thumbnails',async t=>{
 const root=setup(t),input=entry(root);input.files=[];input.post.caseDocument.blocks=[{kind:'text',text:'Hello'}];
 const result=await packageBehanceCase(input,path.join(root,'text.rscase'));
 assert.equal(result.manifest.complete,true);assert.equal(result.manifest.cover,'cover.svg');
 await extractZip(result.path,path.join(root,'read'));
 assert.match(fs.readFileSync(path.join(root,'read/cover.svg'),'utf8'),/^<svg/);
});
test('atomic publication preserves existing output and removes temporary files on failure or cancellation',async t=>{
 const root=setup(t),input=entry(root),output=path.join(root,'existing.rscase');fs.writeFileSync(output,'original');
 await assert.rejects(packageBehanceCase(input,output),{code:'EEXIST'});
 assert.equal(fs.readFileSync(output,'utf8'),'original');
 const next=path.join(root,'new.rscase');
 await assert.rejects(packageBehanceCase(input,next,{maxBytes:50}),/size limit/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(packageBehanceCase(input,next,{signal:controller.signal}),{code:'JOB_STOPPED'});
 assert.equal(fs.existsSync(next),false);assert.equal(fs.readdirSync(root).some(name=>name.endsWith('.tmp')),false);
});
test('writer rejects traversal, duplicate names, symlinks and unsupported asset types',async t=>{
 const root=setup(t),input=entry(root),output=path.join(root,'case.rscase');
 await assert.rejects(writeCaseZip(output,[{name:'../outside',data:'bad'}]),/путь/);
 await assert.rejects(writeCaseZip(output,[{name:'A',data:'a'},{name:'a',data:'b'}]),/entry name/);
 const link=path.join(root,'2.png');fs.symlinkSync(input.files[0],link);
 input.files=[link];input.post.caseDocument.blocks=[{kind:'image',componentNumber:2}];
 await assert.rejects(packageBehanceCase(input,output));
 input.files=[path.join(root,'1.html')];await assert.rejects(packageBehanceCase(input,output),/asset/);
 assert.equal(fs.existsSync(output),false);
});
test('cancellation during streamed media writing leaves neither a published case nor temporary archive',async t=>{
 const root=setup(t),file=path.join(root,'large.mp4'),output=path.join(root,'cancel.rscase');
 fs.writeFileSync(file,Buffer.alloc(1024*1024,7));
 let checks=0;
 const signal={get aborted(){return ++checks>4;}};
 await assert.rejects(writeCaseZip(output,[{name:'assets/1.mp4',file}],{signal}),{code:'JOB_STOPPED'});
 assert.equal(fs.existsSync(output),false);
 assert.deepEqual(fs.readdirSync(root),['large.mp4']);
});
