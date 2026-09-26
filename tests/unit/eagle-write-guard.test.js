import test from 'node:test';
import assert from 'node:assert/strict';
import { guardedEagleWrite, pendingEagleWrite, retireIntermediateEagleWrite } from '../../js/eagle-write-guard.js';
import { importToEagle } from '../../js/eagle-import.js';

test('unanswered Eagle write stops the queue, blocks retries and records a late acknowledgement', async t => {
  const oldFetch = globalThis.fetch, oldStorage = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  t.after(() => { globalThis.fetch = oldFetch; globalThis.localStorage = oldStorage; });
  let complete, calls = 0;
  const late = [], progress = [];
  globalThis.fetch = () => { calls++; return new Promise(resolve => { complete = resolve; }); };
  const item = { path: '/fixture/1.jpg', postId: 'pin:197', component: '0', componentCount: 1 };
  const result = await importToEagle({ items: [item, { ...item, postId: 'pin:198' }], writeTimeoutMs: 15,
    onLateCreated: entry => late.push(entry), onProgress: value => progress.push(value.completed) });
  assert.equal(calls, 1);
  assert.equal(result.created.length, 0);
  assert.match(result.stopReason, /не подтвердил/);
  assert.deepEqual(progress, [0]);
  assert.equal(pendingEagleWrite().item.postId, 'pin:197');
  assert.equal(storage.size, 1);
  await assert.rejects(guardedEagleWrite(() => { throw new Error('Must not dispatch'); }, { item }), /не подтвердил/);
  complete({ ok: true, json: async () => ({ status: 'success', data: 'EAGLE197' }) });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(late[0].id, 'EAGLE197');
  assert.equal(storage.size, 0);
  assert.equal(pendingEagleWrite(), null);
});

test('import progress counts acknowledgements instead of dispatched requests', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let id = 0;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', data: `eagle-${++id}` }) });
  const counts = [];
  const result = await importToEagle({ items: [1, 2].map(i => ({ path: `/fixture/${i}.jpg`, postId: String(i) })), onProgress: p => counts.push(p.completed) });
  assert.deepEqual(counts, [0, 1, 1, 2]);
  assert.equal(result.created.length, 2);
});

test('298-file queue stops at unanswered request 197 with exactly 196 confirmed files', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0, release;
  const acknowledged = [];
  globalThis.fetch = () => {
    calls++;
    if (calls === 197) return new Promise(resolve => { release = resolve; });
    return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: `ID-${calls}` }) });
  };
  const result = await importToEagle({ items: Array.from({ length: 298 }, (_, index) => ({ path: `/fixture/${index}.jpg`, postId: `post-${index}`, component: '0' })),
    writeTimeoutMs: 15, onCreated: entry => acknowledged.push(entry.id) });
  assert.equal(result.created.length, 196);
  assert.equal(calls, 197);
  assert.equal(acknowledged.length, 196);
  assert.match(result.stopReason, /не подтвердил/);
  release({ ok: true, json: async () => ({ status: 'success', data: 'ID-197' }) });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(acknowledged.length, 197);
  assert.equal(new Set(acknowledged).size, 197);
  assert.equal(pendingEagleWrite(), null);
});

test('reload retires only obsolete intermediate writes, preserving uncertain final media', t => {
  const previous = globalThis.localStorage;
  let stored;
  globalThis.localStorage = { getItem: () => stored, removeItem: () => { stored = null; } };
  t.after(() => { globalThis.localStorage = previous; });
  for (const file of ['/staging/1.faudio1-1.mp4', 'C:\\staging\\1.f1244.mp4']) {
    stored = JSON.stringify({ item: { path: file } });
    assert.equal(retireIntermediateEagleWrite(), true);
    assert.equal(stored, null);
  }
  for (const file of ['/staging/1.mp4', '/staging/1.jpg', '/staging/holiday.mp4']) {
    stored = JSON.stringify({ item: { path: file } });
    assert.equal(retireIntermediateEagleWrite(), false);
    assert.ok(stored);
  }
});
