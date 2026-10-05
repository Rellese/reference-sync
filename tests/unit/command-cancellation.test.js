import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
globalThis.require=createRequire(import.meta.url);
const {runCommand,nodeApi}=await import('../../js/node-bridge.js');
const {installToolchain,toolchain}=await import('../../js/toolchain.js');
test('cancelled commands never start and running commands stop with their captured output',async()=>{
 const stopped=new AbortController();stopped.abort();
 await assert.rejects(runCommand(process.execPath,['-e','process.exit(99)'],{signal:stopped.signal}),{name:'AbortError'});
 const active=new AbortController();let started=false;
 const job=runCommand(process.execPath,['-e','console.log("ready");setInterval(()=>{},1000)'],{signal:active.signal,timeout:5000,onStdout:()=>{started=true;active.abort();}});
 const result=await job;assert.notEqual(result.code,0);assert.equal(started,true);assert.match(result.stdout,/ready/);
});
test('Python manager automatic installs are disabled only in child environment',async()=>{
 const before=process.env.PYTHON_MANAGER_AUTOMATIC_INSTALL;
 const result=await runCommand(process.execPath,['-e','console.log(process.env.PYTHON_MANAGER_AUTOMATIC_INSTALL)']);
 assert.equal(result.stdout.trim(),'false');assert.equal(process.env.PYTHON_MANAGER_AUTOMATIC_INSTALL,before);
});
test('cancelling the pip check cannot fall through to ensurepip or dependency installation',async t=>{
 const before={...nodeApi},old={...toolchain},controller=new AbortController(),calls=[];
 t.after(()=>{Object.assign(nodeApi,before);Object.assign(toolchain,old);});
 Object.assign(nodeApi,{available:true,fs:{existsSync:()=>true},os:{homedir:()=>'/fixture'},childProcess:{spawn(command,args){
  calls.push(args);const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  child.stdout.setEncoding=child.stderr.setEncoding=()=>{};child.kill=()=>{};
  queueMicrotask(()=>{if(args.includes('pip'))controller.abort();else child.stdout.emit('data',command==='which'?'/fixture/python\n':'(3, 13)\n');child.emit('close',args.includes('pip')?null:0);});return child;
 }}});
 await assert.rejects(installToolchain({signal:controller.signal}),{code:'JOB_STOPPED'});
 assert.ok(calls.some(args=>args.includes('pip')));assert.ok(!calls.some(args=>args.includes('ensurepip')||args.includes('install')));
});
