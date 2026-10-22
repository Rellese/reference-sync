import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {nodeApi} from '../../js/node-bridge.js';
import {readBehancePage} from '../../js/sources/behance-collections.js';
import {refreshBehanceChallenge} from '../../js/sources/behance-session.js';

// Eagle has Chromium's URL constructor in the renderer, not Node's URL class.
const NodeURL=URL;
class RendererURL {
 constructor(value,base) {
  const parsed=new NodeURL(value,base);
  for(const key of ['hostname','pathname','search','protocol','port','username','password','href'])this[key]=parsed[key];
 }
}
test('reproduces reported Node listener error for a renderer URL and verifies GET/POST compatible calls',async t=>{
 assert.throws(()=>https.request({hostname:'www.behance.net',pathname:'/'},{method:'GET'},()=>{}),/listener.*function.*Object/);
 const previous={...nodeApi};const calls=[];
 t.after(()=>{Object.assign(nodeApi,previous);globalThis.URL=NodeURL;});globalThis.URL=RendererURL;
 function request(options,callback) {
  assert.equal(arguments.length,2);assert.equal(typeof callback,'function');assert.equal(options.hostname,'www.behance.net');
  assert.equal(options instanceof RendererURL,false);calls.push(options);
  const req=new EventEmitter();req.destroy=error=>{if(error)req.emit('error',error);};
  req.end=body=>{options.sentBody=body;queueMicrotask(()=>{const res=new PassThrough();res.statusCode=200;res.headers={};callback(res);res.end('page');});};
  return req;
 }
 Object.assign(nodeApi,{fs:{readFileSync:()=>'.behance.net\tTRUE\t/\tTRUE\t0\tbcp\ttoken\n'},https:{request,get(options,callback){assert.equal(arguments.length,2);const req=request(options,callback);req.end();return req;}}});
 assert.equal(await readBehancePage('https://www.behance.net/designer/moodboards',{cookieFile:'fixture'}),'page');
 await readBehancePage('https://www.behance.net/v3/graphql',{cookieFile:'fixture',json:{variables:{after:'cursor'}}});
 await refreshBehanceChallenge('fixture','https://www.behance.net/',null);
 assert.equal(calls[0].path,'/designer/moodboards');assert.equal(calls[1].method,'POST');
 assert.equal(calls[1].headers['X-BCP'],'token');assert.equal(JSON.parse(calls[1].sentBody).variables.after,'cursor');
});
