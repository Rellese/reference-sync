import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
globalThis.require=createRequire(import.meta.url);
const {downloadPython,pythonDownloadUrl}=await import('../../js/python-download.js');
const {pythonBuild,PYTHON_BUILDS}=await import('../../js/python-builds.js');
const {extractPython}=await import('../../js/python-archive.js');
const {findManagedPython,installManagedPython}=await import('../../js/managed-python.js');
const {preparePython}=await import('../../js/toolchain.js');
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-python-unit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function tar(entries){
 const parts=[];
 for(const e of entries){
  const h=Buffer.alloc(512),data=Buffer.from(e.data||''),type=e.type||'0';
  h.write(e.name);h.write('0000700\0',100);h.write((e.size??data.length).toString(8).padStart(11,'0')+'\0',124);h[156]=type.charCodeAt(0);if(e.link)h.write(e.link,157);h.write('ustar\0',257);h.fill(32,148,156);
  h.write([...h].reduce((sum,b)=>sum+b,0).toString(8).padStart(6,'0')+'\0 ',148);parts.push(h,data,Buffer.alloc((512-data.length%512)%512));
 }
 return Buffer.concat([...parts,Buffer.alloc(1024)]);
}
const goodEntries=()=>[{name:'python/',type:'5'},{name:'python/bin/',type:'5'},{name:'python/bin/python3.13',data:'fixture'},{name:'python/bin/python3',type:'2',link:'python3.13'}];
function gzipFile(root,entries){const file=path.join(root,'archive.gz');fs.writeFileSync(file,zlib.gzipSync(tar(entries)));return file;}
function buildFor(data){return {url:'https://github.com/astral-sh/python-build-standalone/releases/download/fixture/file.gz',bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};}
function requestFor(data,{redirect,record=[]}={}){return (address,options,callback)=>{
 const req=new EventEmitter();req.abort=req.destroy=()=>{};record.push({address,options});
 queueMicrotask(()=>{if(redirect&&record.length===1)callback(Object.assign(Readable.from([]),{statusCode:302,headers:{location:redirect}}));else callback(Object.assign(Readable.from([data]),{statusCode:200,headers:{}}));});return req;
};}
test('pinned portable builds cover Mac/Windows Intel and ARM64 with SHA-256 and no latest lookup',()=>{
 assert.equal(Object.keys(PYTHON_BUILDS).length,3);
 for(const [platform,arch] of [['darwin','x64'],['darwin','arm64'],['win32','x64'],['win32','arm64']]){const b=pythonBuild(platform,arch);assert.match(b.sha256,/^[a-f0-9]{64}$/);assert.match(b.url,/20261003/);assert.ok(!b.url.includes('latest'));assert.ok(b.bytes>1000000);}
 assert.throws(()=>pythonBuild('linux','x64'),/PYTHON_PLATFORM/);
 assert.equal(pythonBuild('win32','arm64').usesX64Emulation,true);assert.match(pythonBuild('win32','arm64').url,/x86_64-pc-windows/);
 for(const url of ['http://github.com/file','https://github.com.evil.test/file','https://user:pass@github.com/file','https://github.com:8443/file'])assert.throws(()=>pythonDownloadUrl(url));
});
test('download verifies before return, restricts redirects, sends no cookies and preserves existing files',async t=>{
 const root=temp(t),data=Buffer.from('fixture archive'),record=[],file=path.join(root,'ok.gz');
 await downloadPython(buildFor(data),file,{request:requestFor(data,{record,redirect:'https://release-assets.githubusercontent.com/fixture'})});assert.deepEqual(fs.readFileSync(file),data);assert.equal(record.length,2);
 assert.deepEqual(Object.keys(record[0].options.headers).sort(),['Accept','User-Agent']);
 await assert.rejects(downloadPython(buildFor(data),file,{request:requestFor(data)}),{code:'EEXIST'});assert.deepEqual(fs.readFileSync(file),data);
 const bad=path.join(root,'bad.gz');await assert.rejects(downloadPython({...buildFor(data),sha256:'0'.repeat(64)},bad,{request:requestFor(data)}),/PYTHON_CHECKSUM/);assert.equal(fs.existsSync(bad),false);
 await assert.rejects(downloadPython(buildFor(data),bad,{request:requestFor(data,{redirect:'http://github.com/file'})}),/PYTHON_DOWNLOAD_URL/);assert.equal(fs.existsSync(bad),false);
});
test('download cancellation never leaves a snapshot or starts a pre-aborted request',async t=>{
 const root=temp(t),file=path.join(root,'cancel.gz'),data=Buffer.alloc(128),stop=new AbortController();let calls=0;
 await assert.rejects(downloadPython(buildFor(data),file,{signal:stop.signal,request:(...args)=>{calls++;return requestFor(data)(...args);},onProgress:()=>stop.abort()}),{code:'JOB_STOPPED'});
 assert.equal(fs.existsSync(file),false);assert.equal(calls,1);
 await assert.rejects(downloadPython(buildFor(data),file,{signal:stop.signal,request:()=>assert.fail('must not run')}),{code:'JOB_STOPPED'});
});
test('tar extracts only bounded Python files; Unix symlinks and Windows links stay within root',async t=>{
 for(const platform of ['darwin','win32']){const root=temp(t),unpacked=await extractPython(gzipFile(root,goodEntries()),root,{platform});assert.equal(fs.readFileSync(path.join(unpacked,'python/bin/python3'),'utf8'),'fixture');assert.equal(fs.existsSync(path.join(root,'python-install.tar')),false);}
});
test('published tar shape may omit directory entries and still creates a regular Python root',async t=>{
 const root=temp(t),opened=await extractPython(gzipFile(root,goodEntries().filter(e=>e.type!=='5')),root);
 assert.ok(fs.statSync(path.join(opened,'python')).isDirectory());assert.equal(fs.readFileSync(path.join(opened,'python/bin/python3'),'utf8'),'fixture');
});
test('tar rejects traversal, device paths, foreign links, duplicate names and invalid headers',async t=>{
 const invalid=[{name:'../outside',data:'x'},{name:'/python/outside',data:'x'},{name:'python/../outside',data:'x'},{name:'python/CON',data:'x'},{name:'python/file:stream',data:'x'},{name:'python/link',type:'2',link:'/etc/passwd'},{name:'python/link',type:'2',link:'../../outside'},{name:'python/huge',size:513*1024*1024}];
 for(const entry of invalid){const root=temp(t);await assert.rejects(extractPython(gzipFile(root,[...goodEntries(),entry]),root),/PYTHON_ARCHIVE/);assert.equal(fs.existsSync(path.join(root,'outside')),false);}
 const root=temp(t);await assert.rejects(extractPython(gzipFile(root,[...goodEntries(),{name:'python/bin/python3.13',data:'duplicate'}]),root),/PYTHON_ARCHIVE/);
 const other=temp(t),data=tar(goodEntries());data[0]^=1;const file=path.join(other,'bad.gz');fs.writeFileSync(file,zlib.gzipSync(data));await assert.rejects(extractPython(file,other),/PYTHON_ARCHIVE/);
});
test('private Python install is atomic, reuses completed files, cleans cancellation and retries',async t=>{
 const root=temp(t),archive=zlib.gzipSync(tar(goodEntries()));let verifies=0,downloads=0;
 const options={root,platform:'darwin',arch:'arm64',download:async(_b,file)=>{downloads++;fs.writeFileSync(file,archive);},preparePip:async()=>{},verify:async file=>{assert.equal(fs.readFileSync(file,'utf8'),'fixture');verifies++;}};
 const executable=await installManagedPython(options);assert.equal(findManagedPython(options),executable);assert.equal(verifies,2);
 await installManagedPython(options);assert.equal(downloads,1);assert.ok(!fs.readdirSync(path.join(root,'python')).some(n=>n.startsWith('install-')));
 const retryRoot=temp(t),stop=new AbortController();await assert.rejects(installManagedPython({...options,root:retryRoot,signal:stop.signal,download:async(_b,file)=>{fs.writeFileSync(file,archive);stop.abort();}}),{code:'JOB_STOPPED'});
 assert.deepEqual(fs.readdirSync(path.join(retryRoot,'python')),[]);await installManagedPython({...options,root:retryRoot});
});
test('preparation installs Python only after no suitable interpreter was found and respects stop',async()=>{
 let installs=0;const install=async()=>{installs++;return '/managed/python';};
 assert.equal(await preparePython({find:async()=>'/existing/python',install,check:async()=>true}),'/existing/python');assert.equal(installs,0);
 assert.equal(await preparePython({find:async()=>'/no-pip/python',install,check:async()=>false}),'/managed/python');assert.equal(installs,1);
 assert.equal(await preparePython({find:async()=>null,install}),'/managed/python');assert.equal(installs,2);
 const stop=new AbortController();stop.abort();await assert.rejects(preparePython({signal:stop.signal,find:()=>assert.fail('must not probe'),install}),{code:'JOB_STOPPED'});
});
