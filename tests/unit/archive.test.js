import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import stream from 'node:stream';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import url from 'node:url';
import { nodeApi } from '../../js/node-bridge.js';
import { listZip, extractZip } from '../../js/archive-zip.js';
import { parseArchiveMetadata, readArchive } from '../../js/archive-reader.js';
function zip(name, data, crc = 0) {
  const bytes = Buffer.from(data), filename = Buffer.from(name);
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; }
  value = (value ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(value, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(crc || value, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + filename.length, 12); end.writeUInt32LE(30 + filename.length + bytes.length, 16);
  return Buffer.concat([local, filename, bytes, central, filename, end]);
}
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-archive-'));
  const original = { ...nodeApi };
  Object.assign(nodeApi, { available: true, fs, path, stream, zlib, crypto, url, Buffer, os: { homedir: () => root } });
  t.after(() => { Object.assign(nodeApi, original); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
test('ZIP extracts media and rejects traversal and bad checksums', async t => {
  const root = setup(t), file = path.join(root, 'data.zip');
  fs.writeFileSync(file, zip('media/a.jpg', 'fixture'));
  assert.equal(listZip(file)[0].name, 'media/a.jpg');
  const files = await extractZip(file, path.join(root, 'valid'));
  assert.equal(fs.readFileSync(files[0].path, 'utf8'), 'fixture');
  fs.writeFileSync(file, zip('../escape.jpg', 'fixture'));
  assert.throws(() => listZip(file), /путь/);
  fs.writeFileSync(file, zip('media/a.jpg', 'fixture', 123));
  await assert.rejects(extractZip(file, path.join(root, 'bad')), /сумма/);
  assert.equal(fs.existsSync(path.join(root, 'bad/media/a.jpg')), false);
});
test('Meta JSON groups carousel media; HTML extracts Pinterest links without executing markup', () => {
  const parsed = parseArchiveMetadata(JSON.stringify([{ title: 'Caption', media: [{ uri: 'media/a.jpg' }, { uri: 'media/b.mp4' }] }]), '.json', 'instagram');
  assert.equal(parsed.groups[0].paths.length, 2);
  const html = parseArchiveMetadata('<script>throw Error()</script><a href="https://ru.pinterest.com/pin/123456/">Pin</a>', '.html', 'pinterest');
  assert.equal(html.links[0].publicationId, '123456');
  assert.equal(parseArchiveMetadata('{"messages":{"url":"https://www.instagram.com/p/PRIVATE/"}}', '.json', 'instagram').links.length, 0);
});
test('local JSON resolves only contained media and stable content IDs', async t => {
  const root = setup(t), file = path.join(root, 'posts.json');
  fs.mkdirSync(path.join(root, 'media'));
  fs.writeFileSync(path.join(root, 'media/a.jpg'), 'image fixture');
  fs.writeFileSync(file, JSON.stringify([{ title: 'Caption', media: [{ uri: 'media/a.jpg' }] }]));
  const first = await readArchive(file);
  const second = await readArchive(file);
  assert.equal(first.posts.length, 1);
  assert.equal(first.posts[0].postId, second.posts[0].postId);
  assert.equal(first.posts[0].archiveLocal, true);
  fs.writeFileSync(file, JSON.stringify([{ media: [{ uri: '../outside.jpg' }] }]));
  await assert.rejects(readArchive(file), /путь/);
});

test('local archive transfer copies only selected components and preserves originals', async t => {
  const root = setup(t);
  const { downloadArchivePosts } = await import('../../js/archive-transfer.js');
  const media = path.join(root, 'a.jpg'), other = path.join(root, 'b.jpg');
  fs.writeFileSync(media, 'first'); fs.writeFileSync(other, 'second');
  const post = { postId: 'instagram:archive-fixture', archiveLocal: true, archiveBase: root, selectedComponents: [2], components: [{ index: 1, archivePath: media }, { index: 2, archivePath: other }] };
  let completed = 0;
  const result = await downloadArchivePosts({ posts: [post], stagingRoot: path.join(root, 'staging'), onCompleted: () => { completed++; } }, () => { throw new Error('Should not use network'); });
  assert.equal(completed, 1);
  assert.equal(result.results[0].files.length, 1);
  assert.equal(path.basename(result.results[0].files[0]), '2.jpg');
  assert.equal(fs.readFileSync(result.results[0].files[0], 'utf8'), 'second');
  assert.equal(fs.readFileSync(media, 'utf8'), 'first');
  assert.equal(fs.readFileSync(other, 'utf8'), 'second');
});

test('archive links resolve through the normal Instagram normalizer and keep partial progress', async () => {
  const { resolveArchiveLinks } = await import('../../js/archive-transfer.js');
  const links = [{ publicationId: 'ABCD', url: 'https://www.instagram.com/p/ABCD/' }, { publicationId: 'PRIVATE', url: 'https://www.instagram.com/p/PRIVATE/' }];
  const saved = [];
  let calls = 0;
  const result = await resolveArchiveLinks(links, {
    settings: { platform: 'instagram', browser: 'chrome', speed: 'safe' },
    onResolved: (link, posts) => saved.push(...posts),
    run: async args => {
      assert.ok(args.includes('--sleep-request'));
      return ++calls === 1 ? { code: 0, stdout: JSON.stringify([3, 'https://cdn.example/image.jpg', { post_id: '1', post_shortcode: 'ABCD', username: 'fixture', media_id: '11', extension: 'jpg', num: 1 }]) }
        : { code: 1, stderr: 'unavailable' };
    },
  });
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].archiveLink, true);
  assert.equal(saved.length, 1);
  assert.equal(result.failed.length, 1);
});


test('large ordinary JSON and ZIP are not rejected by scalar count', async t => {
  const root = setup(t);
  const text = JSON.stringify({ saved: Array.from({ length: 30000 }, (_, i) => ({
    title: 'Saved post', timestamp: i, labels: ['a', 'b', 'c', 'd', 'e'],
    url: `https://www.instagram.com/p/POST${i}/`,
  })) });
  const parsed = parseArchiveMetadata(text, '.json', 'instagram');
  assert.equal(parsed.links.length, 30000);
  const file = path.join(root, 'large.zip');
  fs.writeFileSync(file, zip('saved.json', text));
  assert.equal((await readArchive(file)).links.length, 30000);
  assert.throws(() => parseArchiveMetadata('['.repeat(514) + '0' + ']'.repeat(514), '.json', 'instagram'), /сложная/);
});

test('archive resolution batches URLs and keeps successes even when a neighbour fails', async () => {
  const { resolveArchiveLinks } = await import('../../js/archive-transfer.js');
  const links = Array.from({ length: 45 }, (_, i) => ({ publicationId: `POST${i}`, url: `https://www.instagram.com/p/POST${i}/` }));
  let calls = 0;
  const saved = [];
  const result = await resolveArchiveLinks([...links, links[0]], {
    settings: { platform: 'instagram', browser: 'chrome', speed: 'safe' },
    onResolved: link => saved.push(link.publicationId),
    run: async args => {
      calls++;
      assert.equal(args[args.indexOf('--sleep-request') + 1], '3-5');
      const urls = args.filter(arg => arg.startsWith('https://'));
      assert.ok(urls.length <= 20);
      return { code: 1, stderr: 'One private publication', stdout: urls.filter(url => !url.endsWith('/POST7/')).map(url => {
        const id = url.split('/').at(-2);
        return JSON.stringify([[3, 'https://cdn.example/image.jpg', { post_id: id, post_shortcode: id, username: 'fixture', media_id: id, extension: 'jpg', num: 1 }]]);
      }).join('\n') };
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.posts.length, 44);
  assert.deepEqual(result.failed, [links[7]]);
  assert.equal(new Set(saved).size, 44);
});

test('archive rate limit stops the running batch and never starts the next batch', async () => {
  const { resolveArchiveLinks } = await import('../../js/archive-transfer.js');
  let calls = 0;
  const links = Array.from({ length: 21 }, (_, i) => ({ publicationId: String(i), url: `https://www.pinterest.com/pin/${i}/` }));
  await assert.rejects(resolveArchiveLinks(links, {
    settings: { platform: 'pinterest', speed: 'safe' },
    run: async (args, options) => {
      calls++;
      options.onStderr('HTTP 429 Too Many Requests');
      assert.equal(options.signal.aborted, true);
      return { code: 1, stdout: '', stderr: 'HTTP 429 Too Many Requests' };
    },
  }), /429|огранич/i);
  assert.equal(calls, 1);
});
