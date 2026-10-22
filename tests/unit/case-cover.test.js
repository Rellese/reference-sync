import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {Readable} from 'node:stream';
import {nodeApi} from '../../js/node-bridge.js';import {downloadCaseCover} from '../../js/case/cover.js';
import {behanceCover} from '../../js/sources/behance-preview.js';
function transport(handler){return {get(options,callback){assert.equal(typeof callback,'function');assert.equal(Object.getPrototypeOf(options),Object.prototype);const req=new EventEmitter();req.destroy=()=>{};queueMicrotask(()=>handler(options,callback));return req;}};}
function response(callback,data,headers={},statusCode=200){const stream=Readable.from([data]);Object.assign(stream,{headers,statusCode});callback(stream);}
test('cover loader accepts image bytes and rejects HTML, oversized replies and unsafe redirects',async t=>{
 const previous=nodeApi.Buffer;nodeApi.Buffer=Buffer;t.after(()=>nodeApi.Buffer=previous);
 const url='https://mir-s3-cdn-cf.behance.net/project.png';const png=Buffer.from([137,80,78,71,13,10,26,10]);
 assert.deepEqual((await downloadCaseCover(url,{https:transport((u,cb)=>response(cb,png))})).data,png);
 await assert.rejects(downloadCaseCover(url,{https:transport((u,cb)=>response(cb,Buffer.from('<html>blocked</html>')))}),/Invalid cover image/);
 await assert.rejects(downloadCaseCover(url,{https:transport((u,cb)=>response(cb,png,{'content-length':9*1024*1024}))}),/Cover unavailable/);
 await assert.rejects(downloadCaseCover(url,{https:transport((u,cb)=>response(cb,Buffer.alloc(0),{location:'https://example.test/file'},302))}),/Invalid Behance/);
 await assert.rejects(downloadCaseCover('file:///tmp/cover'),/Invalid Behance/);
 await assert.rejects(downloadCaseCover(url,{signal:AbortSignal.abort()}),/CANCELLED/);
});
test('case cover prefers the larger project crop to the small table thumbnail',()=>{
 const root='https://mir-s3-cdn-cf.behance.net/projects/';
 assert.equal(behanceCover({covers:{allAvailable:[{url:root+'202/a.png'},{url:root+'max_808/a.png'}]}}),root+'max_808/a.png');
});
test('cover engine fallback keeps the deadline, validates image bytes and never receives browser cookies',async t=>{
 const previous=nodeApi.Buffer;nodeApi.Buffer=Buffer;t.after(()=>nodeApi.Buffer=previous);
 const url='https://mir-s3-cdn-cf.behance.net/project.png',png=Buffer.from([137,80,78,71,13,10,26,10]);
 const https=transport((u,cb)=>response(cb,Buffer.alloc(0),{},503));
 let calls=0;
 const run=async(script,args,options)=>{
  calls++;assert.equal(args[0],url);assert.ok(options.timeout>0&&options.timeout<=15000);
  assert.equal(args.length,3);assert.ok(!script.includes('cookies-from-browser'));
  return {code:0,stdout:png.toString('base64')};
 };
 assert.deepEqual((await downloadCaseCover(url,{https,run})).data,png);assert.equal(calls,1);
 await assert.rejects(downloadCaseCover('http://mir-s3-cdn-cf.behance.net/project.png',{https,run}),/Invalid Behance/);
 await assert.rejects(downloadCaseCover(url,{https:transport((u,cb)=>response(cb,Buffer.alloc(0),{location:'https://example.test/image'},302)),run}),/Invalid Behance/);
 assert.equal(calls,1);
 await assert.rejects(downloadCaseCover(url,{https,run:async()=>({code:0,stdout:Buffer.from('<html>').toString('base64')})}),/Invalid cover image/);
 const controller=new AbortController();
 await assert.rejects(downloadCaseCover(url,{https,signal:controller.signal,run:async()=>{controller.abort();return {code:0,stdout:png.toString('base64')};}}),/CANCELLED/);
});
