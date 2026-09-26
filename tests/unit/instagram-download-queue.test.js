import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { nodeApi } from '../../js/node-bridge.js';
import { toolchain } from '../../js/toolchain.js';
import { importToEagle } from '../../js/eagle-import.js';
import { downloadPosts } from '../../js/instagram.js';
import { INSTAGRAM_RATE_LIMITED } from '../../js/job-control.js';

for (const mode of ['all', 'last-rate-limit', 'half-fail']) {
  test(`Instagram 80-post download queue: ${mode}`, async () => {
    const savedNode = { ...nodeApi }, savedTool = { ...toolchain }, savedFetch = globalThis.fetch;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-download-'));
    const visited = [], completed = [];
    Object.assign(nodeApi, { available: true, fs, path, os, childProcess: { spawn(command, args) {
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
      const destination = args[args.indexOf('--dest') + 1];
      const number = Number(path.basename(destination)); visited.push(number);
      queueMicrotask(() => {
        const rateLimited = mode === 'last-rate-limit' && number === 79;
        const failed = rateLimited || (mode === 'half-fail' && number % 2 === 1);
        if (failed) {
          fs.writeFileSync(path.join(destination, '1.jpg.part'), 'unfinished');
          child.stderr.emit('data', rateLimited ? 'HTTP 429 Too Many Requests' : 'HTTP 403 Forbidden');
        } else fs.writeFileSync(path.join(destination, '1.jpg'), 'fixture');
        child.emit('close', failed ? 1 : 0);
      });
      return child;
    } } });
    Object.assign(toolchain, { ready: true, command: 'fixture', args: [], kind: 'binary' });
    try {
      const result = await downloadPosts({
        posts: Array.from({ length: 80 }, (_, i) => ({ postId: String(i), url: `https://www.instagram.com/p/fixture${i}/`, componentCount: 1 })),
        stagingRoot: root, cookieFile: '/fixture/not-read',
        onCompleted: async entry => { await Promise.resolve(); completed.push(entry.post.postId); },
      });
      assert.equal(visited.length, 80);
      assert.equal(result.completed.length, mode === 'all' ? 80 : mode === 'half-fail' ? 40 : 79);
      assert.equal(completed.length, result.completed.length);
      assert.equal(result.results.length, 80);
      assert.equal(result.stopReason, mode === 'last-rate-limit' ? INSTAGRAM_RATE_LIMITED : null);
      let adds = 0;
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', data: `fixture-${++adds}` }) });
      const imported = await importToEagle({ items: result.results.flatMap(entry => entry.files.map(file => ({ path: file, postId: entry.post.postId }))) });
      assert.equal(imported.created.length, result.completed.length);
      assert.equal(imported.failed.length, 0);
      for (const failed of result.failed) {
        assert.equal(failed.files.length, 0);
        assert.doesNotMatch(failed.error, /raw is not defined/);
      }
    } finally {
      Object.assign(nodeApi, savedNode); Object.assign(toolchain, savedTool); globalThis.fetch = savedFetch;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
