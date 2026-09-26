import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import {nodeApi} from '../../js/node-bridge.js';
import {findPython,hasVideoDownloader,toolchain} from '../../js/toolchain.js';
function mock(t,execute){
 const before={...nodeApi},oldTool={...toolchain};t.after(()=>{Object.assign(nodeApi,before);Object.assign(toolchain,oldTool);});
 Object.assign(nodeApi,{available:true,path,os:{homedir:()=>'/fixture'},fs:{existsSync:p=>p==='/usr/local/bin/python3'},childProcess:{spawn(command,args){
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdout.setEncoding=child.stderr.setEncoding=()=>{};child.kill=()=>{};
  queueMicrotask(()=>{const result=execute(command,args);child.stdout.emit('data',result.stdout||'');child.emit('close',result.code||0);});return child;
 }}});
}
test('engine preparation skips Python 3.9 when modern video dependencies are requested',async t=>{
 mock(t,(command,args)=>{
  if(command==='which') return {stdout:'/usr/bin/python3\n'};
  if(command==='/usr/bin/python3') return {stdout:'(3, 9)\n'};
  if(command==='/usr/local/bin/python3') return {stdout:'(3, 13)\n'};
  return {code:1};
 });
 assert.equal(await findPython(),'/usr/bin/python3');
 assert.equal(await findPython({minimumMinor:10}),'/usr/local/bin/python3');
});
test('Behance video preflight detects missing browser compatibility without blocking existing ordinary video checks',async t=>{
 const probes=[];
 mock(t,(_,args)=>{probes.push(args[1]);return {code:args[1].includes('curl_cffi')?1:0};});
 Object.assign(toolchain,{ffmpeg:'/fixture/ffmpeg',kind:'module',command:'/fixture/python',pythonPath:null});
 assert.equal(await hasVideoDownloader(),true);
 assert.equal(await hasVideoDownloader({requireBrowserCompatibility:true}),false);
 assert.ok(probes.some(script=>script.includes('sys.version_info >= (3, 10)')));
});
