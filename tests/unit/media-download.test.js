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
