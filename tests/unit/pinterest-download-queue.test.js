import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { nodeApi } from '../../js/node-bridge.js';
import { toolchain } from '../../js/toolchain.js';
import pinterest from '../../js/sources/pinterest.js';
import { recordCreatedEagleItems, reconcileImportRecords } from '../../js/import-registry.js';

function setup(t, spawn) {
  const previous = { ...nodeApi }, engine = { ...toolchain };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-pinterest-'));
  Object.assign(nodeApi, { available: true, fs, path, os: { homedir: () => root }, childProcess: { spawn } });
  Object.assign(toolchain, { ready: true, command: 'fixture', args: [], kind: 'binary' });
  t.after(() => { Object.assign(nodeApi, previous); Object.assign(toolchain, engine); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function childProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  return child;
}
test('Pinterest download ignores text/audio/partial files and reports a missing visual component', async t => {
  const root = setup(t, (command, args) => {
    const child = childProcess();
    queueMicrotask(() => {
      const directory = args[args.indexOf('--dest') + 1];
      for (const name of ['1.txt', '2.jpg', '3.mp3', '4.mp4.part']) fs.writeFileSync(path.join(directory, name), 'fixture');
      fs.mkdirSync(path.join(directory, '5.jpg'));
      child.emit('close', 0);
    });
    return child;
  });
  const result = await pinterest.download({ stagingRoot: root, cookieFile: '/fixture/not-read', posts: [{
    postId: 'pinterest:123', url: 'https://www.pinterest.com/pin/123/', componentCount: 2,
    components: [{ index: 2 }, { index: 4 }], selectedComponents: [2, 4],
  }] });
  assert.deepEqual(result.results[0].files.map(file => path.basename(file)), ['2.jpg']);
  assert.match(result.results[0].error, /не все/);
});

test('Pinterest new-only discovery stops at a previously acknowledged pin in every selected folder', async t => {
  let killed = 0, runs = 0;
  setup(t, () => {
    const child = childProcess();
    const kill = child.kill; child.kill = () => { killed++; kill(); };
    queueMicrotask(() => {
      runs++;
      for (const id of ['999', '123', '001']) {
        if (child.killed) break;
        child.stdout.emit('data', JSON.stringify([3, `https://cdn.example/${id}.jpg`, { id, num: 1, extension: 'jpg' }]) + '\n');
      }
      child.emit('close', child.killed ? null : 0);
    });
    return child;
  });
  const records = recordCreatedEagleItems(new Map(), [{ id: 'EAGLE', item: { postId: 'pinterest:123', component: '0', componentCount: 1 } }]);
  const { knownPostIds } = reconcileImportRecords(records, [{ id: 'EAGLE' }]);
  const result = await pinterest.discover({ username: 'fixture', cookieFile: '/fixture/not-read', knownPostIds, searchMode: 'smart',
    collections: [{ id: 'a', name: 'A', type: 'BOARD', url: 'https://www.pinterest.com/fixture/a/' }, { id: 'b', name: 'B', type: 'BOARD', url: 'https://www.pinterest.com/fixture/b/' }],
  });
  assert.equal(runs, 2);
  assert.equal(killed, 2);
  assert.equal(result.stoppedEarly, true);
  assert.deepEqual(result.posts.map(post => post.postId), ['pinterest:999']);
  assert.equal(result.posts[0].collectionOccurrences.length, 2);
});

test('Pinterest downloads discovered MP4 directly when the HLS downloader is unavailable', async t => {
  const root = setup(t, () => { throw new Error('Cannot import yt-dlp or youtube-dl'); });
  const stream = await import('node:stream');
  Object.assign(nodeApi, { stream, https: {
    Agent: class { destroy() {} },
    get(url, options, callback) {
      assert.equal(url.href, 'https://cdn.example/video.mp4');
      const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = () => {};
      queueMicrotask(() => {
        const response = new PassThrough(); response.statusCode = 200;
        response.headers = { 'content-type': 'video/mp4', 'content-length': '4' };
        callback(response); response.end('data');
      });
      return request;
    },
  } });
  const { parseDumpJson } = await import('../../js/sources/gallery-source.js');
  const posts = pinterest.assemble(parseDumpJson(JSON.stringify([3, 'ytdl:https://cdn.example/video.m3u8', {
    id: '123', num: 1, extension: 'mp4', _fallback: ['https://cdn.example/video.mp4'],
  }])), { target: { id: 'board', name: 'Board' } });
  const result = await pinterest.download({ posts, cookieFile: '/fixture/not-read', stagingRoot: root, speedProfile: 'lightning' });
  assert.equal(result.results[0].error, null);
  assert.equal(fs.readFileSync(result.results[0].files[0], 'utf8'), 'data');
});
