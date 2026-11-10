import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const id='659051af-6657-4df6-9b46-ac64ccaae260';
const run=(script,args,cwd)=>spawnSync(process.execPath,[script,...args],{cwd,encoding:'utf8',timeout:10000});
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rs-release-id-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('release retains the existing store UUID and changes only the exported version',t=>{
 const dir=temporary(t),target=path.join(dir,'release'),original=fs.readFileSync(path.join(root,'manifest.json'),'utf8');
 const result=run(path.join(root,'scripts/prepare-release.mjs'),['--output',target,'--version','1.0.0'],root);
 assert.equal(result.status,0,result.stderr);
 const manifest=JSON.parse(fs.readFileSync(path.join(target,'manifest.json')));
 assert.equal(manifest.id,id);assert.equal(manifest.version,'1.0.0');
 assert.equal(fs.readFileSync(path.join(root,'manifest.json'),'utf8'),original);
 assert.match(fs.readFileSync(path.join(target,'js/panels.js'),'utf8'),/version = 'v1\.0\.0'/);
});
for(const invalid of ['reference-sync','00000000-0000-0000-0000-000000000000','e0937c47-f9d8-4821-b7dd-7db655f17f71'])test('release refuses an invalid or replaced store ID before writing: '+invalid,t=>{
 const dir=temporary(t);fs.mkdirSync(path.join(dir,'scripts'));
 fs.copyFileSync(path.join(root,'scripts/prepare-release.mjs'),path.join(dir,'scripts/prepare-release.mjs'));
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({...JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),id:invalid}));
 assert.equal(spawnSync('git',['init','-q'],{cwd:dir}).status,0);
 const target=path.join(dir,'output'),result=run(path.join(dir,'scripts/prepare-release.mjs'),['--output',target,'--version','1.0.0'],dir);
 assert.notEqual(result.status,0);assert.match(result.stderr,/INVALID_PLUGIN_ID/);assert.equal(fs.existsSync(target),false);
});
