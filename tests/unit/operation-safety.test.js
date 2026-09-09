import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STOPPED,
  throwIfAborted,
} from '../../js/job-control.js';

import {
  applyDiscoveryBoundary,
  fullyImportedPostIds,
  parseImportRecords,
  parseKnownPostIds,
  reconcileImportRecords,
  selectImportablePosts,
  serializeImportRecords,
  serializeKnownPostIds,
  summarizeMissingComponents,
} from '../../js/import-registry.js';

test('aborted discovery is reported as user stop', () => {
  const controller = new AbortController();
  controller.abort();

  assert.throws(
    () => throwIfAborted(controller.signal),
    (error) => {
      assert.equal(error.code, STOPPED);
      assert.equal(
        error.message,
        'Процесс остановлен пользователем',
      );
      return true;
    },
  );
});

test('known post registry survives serialization', () => {
  const serialized = serializeKnownPostIds(
    new Set(['post-3', 'post-1', 'post-3']),
  );

  assert.equal(
    serialized,
    '["post-1","post-3"]',
  );

  assert.deepEqual(
    parseKnownPostIds(serialized),
    new Set(['post-1', 'post-3']),
  );

  assert.deepEqual(
    parseKnownPostIds('повреждённые данные'),
    new Set(),
  );
});

test('post becomes known only when all its Eagle items were created', () => {
  const items = [
    { postId: 'photo-1', path: '/photo.jpg' },
    { postId: 'carousel-1', path: '/slide-1.jpg' },
    { postId: 'carousel-1', path: '/slide-2.jpg' },
  ];

  const created = [
    { item: items[0], id: 'eagle-photo' },
    { item: items[1], id: 'eagle-slide-1' },
  ];

  assert.deepEqual(
    fullyImportedPostIds(items, created),
    new Set(['photo-1']),
  );
});

test('already imported posts cannot enter another import queue', () => {
  const posts = [
    { postId: 'already-imported' },
    { postId: 'new-post' },
    { postId: 'not-selected' },
  ];

  const selected = new Set([
    'already-imported',
    'new-post',
  ]);

  const known = new Set([
    'already-imported',
  ]);

  assert.deepEqual(
    selectImportablePosts(posts, selected, known),
    [{ postId: 'new-post' }],
  );
});

test('deleted Eagle components are released for another import', () => {
  const records = new Map([
    ['photo-1', {
      componentCount: 1,
      components: new Map([
        ['0', 'eagle-photo'],
      ]),
    }],
    ['carousel-1', {
      componentCount: 2,
      components: new Map([
        ['0', 'eagle-slide-1'],
        ['1', 'eagle-slide-2'],
      ]),
    }],
  ]);

  const restored = parseImportRecords(
    serializeImportRecords(records),
  );

  assert.deepEqual(restored, records);

  const reconciled = reconcileImportRecords(restored, [
    { id: 'eagle-photo', isDeleted: false },
    { id: 'eagle-slide-1', isDeleted: false },
    { id: 'eagle-slide-2', isDeleted: true },
  ]);

  assert.deepEqual(
    reconciled.knownPostIds,
    new Set(['photo-1']),
  );

  assert.deepEqual(
    reconciled.missingComponents.get('carousel-1'),
    new Set(['1']),
  );
});

test('missing Eagle summary counts components and publications separately', () => {
  const summary =
    summarizeMissingComponents(
      new Map([
        [
          'photo-1',
          new Set(['0']),
        ],
        [
          'carousel-1',
          new Set(['1', '2']),
        ],
      ]),
    );

  assert.deepEqual(summary, {
    publicationCount: 2,
    componentCount: 3,
  });
});

test('recent discovery stops at the first known post', () => {
  const result = applyDiscoveryBoundary(
    [
      { postId: 'new-1' },
      { postId: 'new-2' },
      { postId: 'known-1' },
      { postId: 'old-1' },
    ],
    new Set(['known-1']),
    {
      stopAtKnown: true,
      limit: 60,
    },
  );

  assert.deepEqual(
    result.posts,
    [
      { postId: 'new-1' },
      { postId: 'new-2' },
    ],
  );

  assert.equal(
    result.knownBoundaryFound,
    true,
  );

  assert.equal(
    result.stoppedEarly,
    true,
  );
});

test('recent discovery returns nothing when newest post is known', () => {
  const result = applyDiscoveryBoundary(
    [
      { postId: 'known-1' },
      { postId: 'old-1' },
    ],
    new Set(['known-1']),
    {
      stopAtKnown: true,
      limit: 60,
    },
  );

  assert.deepEqual(
    result.posts,
    [],
  );

  assert.equal(
    result.knownBoundaryFound,
    true,
  );
});

test('recent discovery limits only new posts', () => {
  const result = applyDiscoveryBoundary(
    [
      { postId: 'new-1' },
      { postId: 'new-2' },
      { postId: 'new-3' },
      { postId: 'known-1' },
    ],
    new Set(['known-1']),
    {
      stopAtKnown: true,
      limit: 2,
    },
  );

  assert.deepEqual(
    result.posts,
    [
      { postId: 'new-1' },
      { postId: 'new-2' },
    ],
  );
});

test('full discovery keeps known posts visible', () => {
  const posts = [
    { postId: 'new-1' },
    { postId: 'known-1' },
    { postId: 'old-1' },
  ];

  const result = applyDiscoveryBoundary(
    posts,
    new Set(['known-1']),
    {
      stopAtKnown: false,
      limit: 0,
    },
  );

  assert.deepEqual(
    result.posts,
    posts,
  );
});
