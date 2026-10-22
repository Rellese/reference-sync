import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {nodeApi} from '../../js/node-bridge.js';import {watchCaseProgress,caseProgressInfo} from '../../js/case/progress.js';
test('case progress advances by final unique blocks and resets within the next case',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rs-progress-'));Object.assign(nodeApi,{fs,path});t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const events=[],post={source:'behance',caseSelection:{whole:true},components:[{index:1},{index:2}]};
 const stop=watchCaseProgress({post,postDir:dir,current:1,total:5,onProgress:e=>events.push(e)},10);t.after(stop);
 fs.writeFileSync(path.join(dir,'1.png'),'ok');fs.writeFileSync(path.join(dir,'2.mp4.part'),'partial');
 await new Promise(r=>setTimeout(r,35));stop();
 assert.equal(events[0].caseBlocks.completed,0);assert.equal(events.at(-1).caseBlocks.completed,1);assert.equal(caseProgressInfo(events.at(-1)).fraction,.1);
 assert.equal(caseProgressInfo({...events[0],current:2}).fraction,.2);
 assert.equal(caseProgressInfo({current:2,total:5}),null);
 const count=events.length;fs.writeFileSync(path.join(dir,'2.mp4'),'ok');await new Promise(r=>setTimeout(r,25));assert.equal(events.length,count);
});
