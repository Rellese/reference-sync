import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { spawn } from 'node:child_process';
import { nodeApi, runCommand } from '../../js/node-bridge.js';
import { toolchain } from '../../js/toolchain.js';
import { STOPPED } from '../../js/job-control.js';
import { discoverSaved } from '../../js/instagram.js';
import pinterest from '../../js/sources/pinterest.js';
import { createGallerySource } from '../../js/sources/gallery-source.js';
import { parseStopLink } from '../../js/stop-link.js';
import { runDiscoveryWithStop } from '../../js/discovery-stop.js';

// Реальные adapters → toolchain → runCommand; заменён только внешний процесс.
// Никаких cookies, сети и пользовательских файлов.
function fakeEngine(t, targets) {
  const oldNode = { ...nodeApi };
  const oldToolchain = { ...toolchain };
  const calls = [];
  t.after(() => { Object.assign(nodeApi, oldNode); Object.assign(toolchain, oldToolchain); });
  Object.assign(toolchain, { ready: true, command: 'fixture-gallery', args: [] });
  nodeApi.available = true;
  nodeApi.childProcess = {
    spawn(command, args, options) {
      const fixture = targets[calls.length];
      assert.ok(fixture, 'unexpected extra gallery process');
      const call = { args, options, killed: false, emitted: 0 };
      calls.push(call);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout.setEncoding = child.stderr.setEncoding = () => {};
      child.kill = () => { call.killed = true; return true; };
      setImmediate(() => {
        if (fixture.error) { child.emit('error', new Error(fixture.error)); return; }
        for (const chunk of fixture.chunks) {
          if (call.killed) break;
          call.emitted++;
          child.stdout.emit('data', chunk);
        }
        if (fixture.stderr) child.stderr.emit('data', fixture.stderr);
        fixture.after?.();
        child.emit('close', call.killed ? null : fixture.code || 0);
      });
      return child;
    },
  };
  return calls;
}

function messages(source, id, count = 1) {
  const meta = source === 'instagram'
    ? { post_id: String(id), post_shortcode: `SC${id}`, username: 'fixture' }
    : { id: String(id), pin_id: String(id), title: 'Fixture' };
  return [
    [2, meta],
    ...Array.from({ length: count }, (_, i) => [
      3, `https://cdn.example.test/${id}-${i + 1}.jpg`,
      { ...meta, num: i + 1, media_id: `${id}-${i + 1}`, extension: 'jpg' },
    ]),
  ];
}
const jsonl = (items) => items.map((item) => JSON.stringify(item) + '\n');
const stopFor = (source, id = 2) => parseStopLink(source === 'instagram'
  ? `https://instagram.com/reel/SC${id}/?test=1`
  : `https://ru.pinterest.com/pin/${id}/?test=1`, source);
const discover = (source, options = {}) => (source === 'instagram' ? discoverSaved : pinterest.discover)({
  username: 'fixture', cookieFile: 'fixture-cookie-file', searchMode: 'full', limit: 0,
  stopLink: stopFor(source), ...options,
});

for (const source of ['instagram', 'pinterest']) {
  test(`${source}: stops the process, excludes boundary and preserves entire preceding carousel`, async (t) => {
    const calls = fakeEngine(t, [{ chunks: jsonl([
      ...messages(source, 1, 3), ...messages(source, 2), ...messages(source, 3),
    ]) }]);
    const parent = new AbortController();
    const progress = [];
    const result = await discover(source, { signal: parent.signal, onProgress: (p) => progress.push(p.found) });
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0].componentCount, 3);
    assert.equal(result.stopLinkReached, true);
    assert.equal(result.stoppedEarly, true);
    assert.equal(calls[0].emitted, 5); // Directory + 3 media + boundary Directory.
    assert.equal(calls[0].killed, true);
    assert.equal(calls[0].options.env.PYTHONUNBUFFERED, '1');
    assert.equal(parent.signal.aborted, false);
    assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
    assert.deepEqual(progress, [1]);
  });

  test(`${source}: boundary first is a successful empty result, not an error`, async (t) => {
    fakeEngine(t, [{ chunks: jsonl([...messages(source, 2), ...messages(source, 3)]) }]);
    const result = await discover(source);
    assert.deepEqual(result.posts, []);
    assert.equal(result.stopLinkReached, true);
  });

  test(`${source}: missing boundary leaves results intact`, async (t) => {
    const calls = fakeEngine(t, [{ chunks: jsonl([...messages(source, 1), ...messages(source, 3)]) }]);
    const result = await discover(source);
    assert.equal(result.posts.length, 2);
    assert.equal(result.stopLinkReached, false);
    assert.equal(calls[0].killed, false);
  });

  test(`${source}: disabled Stop Link preserves original discovery`, async (t) => {
    const calls = fakeEngine(t, [{ chunks: jsonl([...messages(source, 1), ...messages(source, 2)]) }]);
    const result = await discover(source, { stopLink: null });
    assert.equal(result.posts.length, 2);
    assert.equal(calls[0].killed, false);
  });

  test(`${source}: fragmented JSONL and multiple records in one chunk cannot leak older posts`, async (t) => {
    const text = jsonl([...messages(source, 1), ...messages(source, 2), ...messages(source, 3)]).join('');
    fakeEngine(t, [{ chunks: [text.slice(0, 7), text.slice(7, 30), text.slice(30)] }]);
    const result = await discover(source);
    assert.equal(result.posts.length, 1);
    assert.equal(result.stopLinkReached, true);
  });

  test(`${source}: each selected folder stops independently before deduplication`, async (t) => {
    const calls = fakeEngine(t, [
      { chunks: jsonl([...messages(source, 1), ...messages(source, 2), ...messages(source, 3)]) },
      { chunks: jsonl([...messages(source, 3), ...messages(source, 1), ...messages(source, 2), ...messages(source, 4)]) },
      { chunks: jsonl(messages(source, 4)) },
    ]);
    const collections = [
      { id: 'a', name: 'A', type: 'BOARD', url: 'https://pinterest.com/fixture/a/' },
      { id: 'b', name: 'B', type: 'SECTION', parentId: 'a', url: 'https://pinterest.com/fixture/a/b/' },
      { id: 'c', name: 'C', type: 'BOARD', url: 'https://pinterest.com/fixture/c/' },
    ];
    const result = await discover(source, { collections });
    assert.deepEqual(result.stopLinkTargets, ['a', 'b']);
    assert.deepEqual(calls.map((call) => call.killed), [true, true, false]);
    assert.equal(result.posts.length, 3);
    const occurrences = result.posts.map((p) => p.collectionOccurrences.map((o) => o.collectionId));
    assert.deepEqual(occurrences, [['a', 'b'], ['b'], ['c']]);
    assert.deepEqual(result.posts.map((p) => p.containers.map((c) => c.id)), occurrences);
  });

  for (const searchMode of ['smart', 'recent', 'full']) {
    test(`${source}: Stop Link is active in ${searchMode} without replacing mode options`, async (t) => {
      const calls = fakeEngine(t, [{ chunks: jsonl([...messages(source, 1), ...messages(source, 2)]) }]);
      const result = await discover(source, { searchMode, limit: searchMode === 'recent' ? 5 : 0 });
      assert.equal(result.posts.length, 1);
      assert.equal(calls[0].args.includes('--post-range'), searchMode === 'recent');
    });
  }

  test(`${source}: known-post boundary still takes precedence in smart mode`, async (t) => {
    // Реальный Instagram --filter завершится до выдачи известного файла;
    // fixture также проверяет резервную JS-проверку известной публикации.
    fakeEngine(t, [{ chunks: jsonl([...messages(source, 1), ...messages(source, 3)]) }]);
    const result = await discover(source, { searchMode: 'smart', knownPostIds: new Set([source === 'instagram' ? '1' : 'pinterest:1']) });
    assert.deepEqual(result.posts, []);
    assert.equal(result.stopLinkReached, false);
    assert.equal(result.stoppedEarly, true);
  });

  test(`${source}: manual Stop overrides reaching Stop Link`, async (t) => {
    const parent = new AbortController();
    fakeEngine(t, [{ chunks: jsonl(messages(source, 2)), after: () => parent.abort() }]);
    await assert.rejects(discover(source, { signal: parent.signal }), { code: STOPPED });
    assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  });

  test(`${source}: authentication failure without boundary is not reported as success`, async (t) => {
    fakeEngine(t, [{ chunks: [], code: 1, stderr: 'Login required' }]);
    await assert.rejects(discover(source));
  });
}

test('real child process terminates on Stop Link without aborting the parent operation', { timeout: 5000 }, async (t) => {
  const oldNode = { ...nodeApi };
  t.after(() => Object.assign(nodeApi, oldNode));
  nodeApi.available = true;
  nodeApi.childProcess = { spawn };
  const parent = new AbortController();
  let output = '';
  const script = `
    console.log(JSON.stringify([3, 'https://cdn.example.test/1.jpg', {id: '1'}]));
    console.log(JSON.stringify([2, {id: '2'}]));
    setTimeout(() => console.log('must not arrive'), 10000);
  `;
  const result = await runDiscoveryWithStop(
    (args, options) => runCommand(process.execPath, args, { ...options, timeout: 3000 }),
    ['-e', script],
    {
      stopLink: stopFor('pinterest'), signal: parent.signal,
      recordToPost: (record) => ({ source: 'pinterest', externalId: record.id }),
      onStdout: (chunk) => { output += chunk; },
    },
  );
  assert.equal(result.stopLinkReached, true);
  assert.equal(parent.signal.aborted, false);
  assert.equal(output.includes('must not arrive'), false);
  assert.equal(output.includes('"id":"2"'), false);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('Instagram does not retry a deliberately terminated process on cookie warning', async (t) => {
  const calls = fakeEngine(t, [{ chunks: jsonl(messages('instagram', 2)), stderr: 'database is locked' }]);
  const result = await discover('instagram');
  assert.equal(result.stopLinkReached, true);
  assert.equal(calls.length, 1);
});

test('Pinterest matches long string IDs without rounding', async (t) => {
  const id = '123456789012345678';
  fakeEngine(t, [{ chunks: jsonl([...messages('pinterest', 1), ...messages('pinterest', id)]) }]);
  const result = await discover('pinterest', { stopLink: stopFor('pinterest', id) });
  assert.equal(result.posts.length, 1);
  assert.equal(result.stopLinkReached, true);
});

test('Instagram HTTP 429 remains fatal even if boundary was received', async (t) => {
  fakeEngine(t, [{ chunks: jsonl(messages('instagram', 2)), stderr: 'HTTP 429 Too Many Requests' }]);
  await assert.rejects(discover('instagram'), (error) => /ограничил/.test(error.message));
});

test('shared runner removes listener after spawn failure and already-aborted signal never starts', async () => {
  const controller = new AbortController();
  const options = { stopLink: stopFor('pinterest'), signal: controller.signal, recordToPost: () => null };
  await assert.rejects(runDiscoveryWithStop(async () => { throw new Error('spawn failed'); }, [], options), /spawn failed/);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
  await assert.rejects(runDiscoveryWithStop(() => assert.fail('must not start'), [], options), { code: STOPPED });
});

test('shared runner ignores Queue messages and handles compact dump arrays and final line without newline', async (t) => {
  const items = [[6, 'https://pinterest.com/pin/2/', { pin_id: '2' }], ...messages('pinterest', 1), ...messages('pinterest', 2)];
  fakeEngine(t, [{ chunks: [JSON.stringify(items)] }]);
  const result = await discover('pinterest');
  assert.equal(result.posts.length, 1);
  assert.equal(result.stopLinkReached, true);
});

for (const [source, idField, url] of [
  ['dribbble', 'id', 'https://dribbble.com/shots/2-title'],
  ['behance', 'id', 'https://behance.net/gallery/2/title'],
  ['vimeo', 'id', 'https://vimeo.com/2'],
  ['x', 'tweet_id', 'https://x.com/fixture/status/2'],
]) {
  test(`generic adapter: ${source} matches its publication ID`, async (t) => {
    const adapter = createGallerySource({
      code: source, title: source, cookies: false, needsAccount: false,
      idFields: [idField], buildTargets: () => [{ id: 'saved', name: 'Saved', url }],
    });
    const calls = fakeEngine(t, [{ chunks: jsonl([1, 2, 3].map((id) => [3, `https://cdn.example.test/${id}.jpg`, { [idField]: id, extension: 'jpg' }])) }]);
    const result = await adapter.discover({ stopLink: parseStopLink(url), limit: 0 });
    assert.equal(result.posts.length, 1);
    assert.equal(calls[0].emitted, 2);
    assert.equal(calls[0].killed, true);
  });
}
