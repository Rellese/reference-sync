import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import {nodeApi} from '../../js/node-bridge.js';
import {findPython,findFFmpeg,runGallery,hasVideoDownloader,toolchain} from '../../js/toolchain.js';
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
test('video tools prefer a verified FFmpeg/FFprobe pair over a cached standalone binary',async t=>{
 const calls=[];
 mock(t,(command,args)=>{calls.push({command,args});return {code:0};});
 const folder=path.join('/fixture','video-tools');
 const ffmpeg=path.join(folder,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
 const ffprobe=path.join(folder,process.platform==='win32'?'ffprobe.exe':'ffprobe');
 nodeApi.fs.existsSync=p=>[ffmpeg,ffprobe].includes(p);
 const oldPath=process.env.PATH;process.env.PATH=folder;t.after(()=>process.env.PATH=oldPath);
 Object.assign(toolchain,{ready:true,ffmpeg:'/fixture/standalone',ffprobe:null,command:'fixture',args:[]});
 assert.equal(await findFFmpeg(),ffmpeg);
 assert.equal(toolchain.ffprobe,ffprobe);
 assert.deepEqual(calls.map(call=>call.command).sort(),[ffmpeg,ffprobe].sort());
 await runGallery(['--config-ignore','https://www.behance.net/gallery/1/a']);
 const option=calls.at(-1).args.find(arg=>arg.startsWith('downloader.ytdl.raw-options='));
 assert.equal(JSON.parse(option.split('=').slice(1).join('=')).ffmpeg_location,folder);
});
test('Behance video preflight detects missing browser compatibility without blocking existing ordinary video checks',async t=>{
 const probes=[];
 mock(t,(_,args)=>{probes.push(args[1]);return {code:args[1].includes('curl_cffi')?1:0};});
 Object.assign(toolchain,{ffmpeg:'/fixture/ffmpeg',kind:'module',command:'/fixture/python',pythonPath:null});
 assert.equal(await hasVideoDownloader(),true);
 assert.equal(await hasVideoDownloader({requireBrowserCompatibility:true}),false);
 assert.ok(probes.some(script=>script.includes('sys.version_info >= (3, 10)')));
});
