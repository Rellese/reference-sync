import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import stream from 'node:stream';
import { EventEmitter } from 'node:events';
import { nodeApi } from '../../js/node-bridge.js';
import { downloadMedia } from '../../js/media-download.js';

test('media stream is written atomically and HTML/partial responses are rejected', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-media-'));
  const original = { ...nodeApi };
  t.after(() => { Object.assign(nodeApi, original); fs.rmSync(root, { recursive: true, force: true }); });
  Object.assign(nodeApi, { fs, path, stream });
  let status = 200, mime = 'image/jpeg', length = 4;
  nodeApi.https = { get(url, options, callback) {
    assert.equal(url.protocol, 'https:');
    assert.equal(options.headers.Cookie, undefined);
    const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {};
    queueMicrotask(() => {
      const res = new stream.PassThrough(); res.statusCode = status;
      res.headers = { 'content-type': mime, 'content-length': String(length) };
      callback(res); res.end(Buffer.from([255, 216, 255, 217]));
    });
    return req;
  } };
  const destination = path.join(root, '1.jpg');
  await downloadMedia('https://cdn.example/image.jpg', destination);
  assert.equal(fs.statSync(destination).size, 4);
  assert.equal(fs.existsSync(destination + '.part'), false);
  fs.unlinkSync(destination); mime = 'text/html';
  await assert.rejects(downloadMedia('https://cdn.example/image.jpg', destination), /INVALID_CONTENT/);
  assert.equal(fs.existsSync(destination), false);
  mime = 'image/jpeg'; length = 10;
  await assert.rejects(downloadMedia('https://cdn.example/image.jpg', destination), /INCOMPLETE/);
  assert.equal(fs.existsSync(destination + '.part'), false);
  status = 429;
  await assert.rejects(downloadMedia('https://cdn.example/image.jpg', destination), /429/);
  await assert.rejects(downloadMedia('http://cdn.example/image.jpg', destination), /HTTPS/);
});

test('abort during asynchronous file open waits for close and removes the partial file', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-media-abort-'));
  const original = { ...nodeApi };
  t.after(() => { Object.assign(nodeApi, original); fs.rmSync(root, { recursive: true, force: true }); });
  Object.assign(nodeApi, { fs, path, stream });
  const controller = new AbortController();
  nodeApi.https = { get(url, options, callback) {
    const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = () => {};
    queueMicrotask(() => {
      const response = new stream.PassThrough();
      response.statusCode = 200; response.headers = { 'content-type': 'image/jpeg' };
      callback(response);
      response.write(Buffer.from([255, 216]));
      controller.abort();
    });
    return request;
  } };
  const destination = path.join(root, '1.jpg');
  await assert.rejects(downloadMedia('https://cdn.example/image.jpg', destination, { signal: controller.signal }), /STOPPED/);
  assert.equal(fs.existsSync(destination), false);
  assert.equal(fs.existsSync(destination + '.part'), false);
});

test('source-scoped media validation rejects cross-host or HTTP redirects before requesting them', async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-media-scope-')),original={...nodeApi};
 t.after(()=>{Object.assign(nodeApi,original);fs.rmSync(root,{recursive:true,force:true});});
 Object.assign(nodeApi,{fs,path,stream});let calls=0,location='https://evil.test/video.mp4';
 nodeApi.https={get(url,options,callback){calls++;const request=new EventEmitter();request.setTimeout=()=>{};request.destroy=()=>{};
  queueMicrotask(()=>{const response=new stream.PassThrough();response.statusCode=302;response.headers={location};callback(response);response.end();});return request;}};
 const validateUrl=url=>{const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='video.twimg.com')throw Error('UNSAFE_MEDIA_URL');};
 for(const next of ['https://evil.test/a','http://video.twimg.com/a']){
  location=next;calls=0;await assert.rejects(downloadMedia('https://video.twimg.com/a',path.join(root,'1.mp4'),{validateUrl}),/UNSAFE_MEDIA_URL/);assert.equal(calls,1);
 }
});
