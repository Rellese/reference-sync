import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {nodeApi} from '../../js/node-bridge.js';import {validateCaseVideo} from '../../js/case/video-retry.js';
for(const repaired of [true,false])test(`fresh video retry validates before replacement (${repaired})`,async t=>{
 Object.assign(nodeApi,{fs,path});const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-video-retry-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'10.mp4');fs.writeFileSync(file,'broken');let runs=0;
 const options={postDir:root,ffmpeg:'ffmpeg',args:['--dest',root,'--range','1,10,12','https://www.behance.net/gallery/1/a'],validate:async p=>{if(fs.readFileSync(p,'utf8')!=='valid')throw Error('invalid video');},run:async args=>{
  runs++;assert.equal(args[args.indexOf('--range')+1],'10');const dest=args[args.indexOf('--dest')+1];assert.notEqual(dest,root);fs.writeFileSync(path.join(dest,'10.mp4'),repaired?'valid':'broken');return {code:0};}};
 if(repaired)await validateCaseVideo(file,options);else await assert.rejects(validateCaseVideo(file,options),/invalid video/);
 assert.equal(runs,1);assert.equal(fs.readFileSync(file,'utf8'),repaired?'valid':'broken');assert.deepEqual(fs.readdirSync(root),['10.mp4']);
});
