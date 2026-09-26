import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadIssue, summarizeImportOutcome } from '../../js/download-outcome.js';
import { alignPinterestRecordCounts, reconcileImportRecords } from '../../js/import-registry.js';

test('only explicit source not-found marks a post unavailable; CDN/auth/validation errors remain retryable', () => {
  assert.equal(downloadIssue('[pinterest][error] NotFoundError: Requested pin could not be found').unavailable, true);
  for (const error of ['HTTP 404: https://cdn.example/video.mp4', '403 Forbidden', '429 Too many requests', 'Неполный MP4-контейнер']) {
    assert.equal(downloadIssue(error).unavailable, false);
    assert.ok(downloadIssue(error).detail);
  }
});

test('fresh Pinterest shape removes phantom counts without altering Eagle IDs or other sources', () => {
  const records = new Map([
    ['pinterest:1', { componentCount: 3, components: new Map([['0', 'video'], ['2', 'old-track']]) }],
    ['instagram:1', { componentCount: 3, components: new Map([['0', 'other']]) }],
  ]);
  const posts = ['pinterest:1', 'instagram:1'].map(postId => ({ postId, componentCount: 1, components: [{ index: 2 }] }));
  const aligned = alignPinterestRecordCounts(records, posts);
  assert.equal(records.get('pinterest:1').componentCount, 3);
  assert.deepEqual([...aligned.get('pinterest:1').components], [['0', 'video']]);
  const result = reconcileImportRecords(aligned, [{ id: 'video' }, { id: 'other' }]);
  assert.equal(result.knownPostIds.has('pinterest:1'), true);
  assert.equal(result.knownPostIds.has('instagram:1'), false);
});

test('421 files and 409 complete posts out of 444 are distinct counters; partial posts are explicit', () => {
  const posts = Array.from({length:444}, (_,i) => ({postId:String(i)}));
  const known = new Set(posts.slice(0,409).map(p=>p.postId));
  const records = new Map(posts.slice(409,420).map(p=>[p.postId,{components:new Map([['0','id']])}]));
  const created = Array.from({length:421},(_,i)=>({item:{postId:String(i%420)}}));
  assert.deepEqual(summarizeImportOutcome(posts,known,records,created),
    {total:444,complete:409,partial:11,notImported:24,remaining:35,files:421,touched:420});
});

test('fallback files of one component produce exactly one Eagle item', async () => {
  const { selectedDownloadedFiles } = await import('../../js/carousel-selection.js');
  const result = selectedDownloadedFiles({ post: { componentCount: 1, components: [{ index: 1, mediaType: 'video' }] }, files: ['/tmp/1.jpg', '/tmp/1.mp4'] });
  assert.deepEqual(result, [{ file: '/tmp/1.mp4', componentIndex: 0 }]);
});
