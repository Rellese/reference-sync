import test from 'node:test';
import assert from 'node:assert/strict';
import { guardedEagleWrite, pendingEagleWrite, retireIntermediateEagleWrite,recoverAcknowledgedEagleWrite } from '../../js/eagle-write-guard.js';
import { importToEagle } from '../../js/eagle-import.js';
const readable=url=>({ok:true,json:async()=>({status:'success',data:{id:new URL(url).searchParams.get('id'),size:1}})});

test('unanswered Eagle write stops the queue, blocks retries and records a late acknowledgement', async t => {
  const oldFetch = globalThis.fetch, oldStorage = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  t.after(() => { globalThis.fetch = oldFetch; globalThis.localStorage = oldStorage; });
  let complete, calls = 0;
  const late = [], progress = [];
  globalThis.fetch = (url,options) => { if(options?.method!=='POST')return Promise.resolve(readable(url));calls++; return new Promise(resolve => { complete = resolve; }); };
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
  globalThis.fetch = async (url,options) => options?.method!=='POST'?readable(url):({ ok: true, json: async () => ({ status: 'success', data: `eagle-${++id}` }) });
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
  globalThis.fetch = (url,options) => {
    if(options?.method!=='POST')return Promise.resolve(readable(url));
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

test('queued HTTP ID survives read failure and is recovered only after a ready item is confirmed',async t=>{
 const previous=globalThis.localStorage,storage=new Map();
 globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 t.after(()=>{globalThis.localStorage=previous;});
 const item={path:'/fixture/ready.mp4',postId:'test:1'},created=[];
 await assert.rejects(guardedEagleWrite(queued=>{queued('queued-id');throw Error('read unavailable');},{item}));
 assert.equal(pendingEagleWrite().confirmed,false);
 await assert.rejects(guardedEagleWrite(()=>{throw Error('MUST NOT DISPATCH');},{item}),/не подтвердил/);
 assert.equal(await recoverAcknowledgedEagleWrite(e=>created.push(e),async()=>false),false);
 assert.equal(created.length,0);
 assert.equal(await recoverAcknowledgedEagleWrite(e=>created.push(e),async()=>true),true);
 assert.equal(created[0].id,'queued-id');assert.equal(pendingEagleWrite(),null);
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
