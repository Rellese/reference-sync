import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {Readable} from 'node:stream';
import {nodeApi} from '../../js/node-bridge.js';import {downloadCaseCover} from '../../js/case/cover.js';
import {behanceCover} from '../../js/sources/behance-preview.js';
function transport(handler){return {get(url,options,callback){const req=new EventEmitter();req.destroy=()=>{};queueMicrotask(()=>handler(url,callback));return req;}};}
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
