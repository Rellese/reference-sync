import test from 'node:test';
import assert from 'node:assert/strict';

import {
  counterHistorySeeds,
  counterNumberingSeriesKey,
  parseCounterHistoryRecords,
  rememberCounterHistory,
  serializeCounterHistoryRecords,
} from '../../js/numbering-history.js';

function generated(values) {
  return new Map(
    Object.entries(values).map(
      ([postId, counterValues]) => [
        postId,
        {
          counterValues,
        },
      ],
    ),
  );
}

test('global counter history remembers the next number', () => {
  const counters = [
    {
      id: 'counter-1',
      mode: 'global',
      start: 1,
    },
  ];

  const records = rememberCounterHistory({
    records: new Map(),
    platform: 'instagram',
    counters,
    posts: [
      {
        postId: 'post-1',
        username: '@anna',
      },
      {
        postId: 'post-2',
        username: '@bob',
      },
    ],
    generated: generated({
      'post-1': {
        'counter-1': 1,
      },
      'post-2': {
        'counter-1': 2,
      },
    }),
    importedPostIds: new Set([
      'post-1',
      'post-2',
    ]),
  });

  assert.deepEqual(
    counterHistorySeeds({
      records,
      platform: 'instagram',
      counters,
    }),
    {
      'counter-1': {
        nextNumber: 3,
      },
    },
  );
});

test('author history continues each author independently', () => {
  const counters = [
    {
      id: 'counter-1',
      mode: 'author',
      start: 10,
    },
  ];

  const records = rememberCounterHistory({
    records: new Map(),
    platform: 'instagram',
    counters,
    posts: [
      {
        postId: 'anna-1',
        username: '@anna',
      },
      {
        postId: 'anna-2',
        username: '@anna',
      },
      {
        postId: 'bob-1',
        username: '@bob',
      },
    ],
    generated: generated({
      'anna-1': {
        'counter-1': 10,
      },
      'anna-2': {
        'counter-1': 11,
      },
      'bob-1': {
        'counter-1': 10,
      },
    }),
    importedPostIds: new Set([
      'anna-1',
      'anna-2',
      'bob-1',
    ]),
  });

  assert.deepEqual(
    counterHistorySeeds({
      records,
      platform: 'instagram',
      counters,
    }),
    {
      'counter-1': {
        authors: {
          anna: 12,
          bob: 11,
        },
      },
    },
  );
});

test('unused author mode does not remember publications', () => {
  const records = rememberCounterHistory({
    records: new Map(),
    platform: 'instagram',
    counters: [
      {
        id: 'counter-1',
        mode: 'batch',
        start: 1,
      },
    ],
    posts: [
      {
        postId: 'post-1',
        username: '@anna',
      },
    ],
    generated: generated({
      'post-1': {
        'counter-1': 1,
      },
    }),
    importedPostIds: new Set([
      'post-1',
    ]),
  });

  assert.equal(records.size, 0);
});

test('the same post is never counted twice', () => {
  const counters = [
    {
      id: 'counter-1',
      mode: 'author',
      start: 1,
    },
  ];

  const first = rememberCounterHistory({
    records: new Map(),
    platform: 'instagram',
    counters,
    posts: [
      {
        postId: 'post-1',
        username: '@anna',
      },
    ],
    generated: generated({
      'post-1': {
        'counter-1': 1,
      },
    }),
    importedPostIds: new Set([
      'post-1',
    ]),
  });

  const second = rememberCounterHistory({
    records: first,
    platform: 'instagram',
    counters,
    posts: [
      {
        postId: 'post-1',
        username: '@anna',
      },
    ],
    generated: generated({
      'post-1': {
        'counter-1': 999,
      },
    }),
    importedPostIds: new Set([
      'post-1',
    ]),
  });

  assert.deepEqual(
    counterHistorySeeds({
      records: second,
      platform: 'instagram',
      counters,
    }),
    {
      'counter-1': {
        authors: {
          anna: 2,
        },
      },
    },
  );
});

test('different start numbers create independent series', () => {
  const firstCounters = [
    {
      id: 'counter-1',
      mode: 'global',
      start: 1,
    },
  ];

  const secondCounters = [
    {
      id: 'counter-1',
      mode: 'global',
      start: 100,
    },
  ];

  let records = rememberCounterHistory({
    records: new Map(),
    platform: 'instagram',
    counters: firstCounters,
    posts: [
      {
        postId: 'first-series',
        username: '@anna',
      },
    ],
    generated: generated({
      'first-series': {
        'counter-1': 1,
      },
    }),
    importedPostIds: new Set([
      'first-series',
    ]),
  });

  records = rememberCounterHistory({
    records,
    platform: 'instagram',
    counters: secondCounters,
    posts: [
      {
        postId: 'second-series',
        username: '@bob',
      },
    ],
    generated: generated({
      'second-series': {
        'counter-1': 100,
      },
    }),
    importedPostIds: new Set([
      'second-series',
    ]),
  });

  assert.deepEqual(
    counterHistorySeeds({
      records,
      platform: 'instagram',
      counters: firstCounters,
    }),
    {
      'counter-1': {
        nextNumber: 2,
      },
    },
  );

  assert.deepEqual(
    counterHistorySeeds({
      records,
      platform: 'instagram',
      counters: secondCounters,
    }),
    {
      'counter-1': {
        nextNumber: 101,
      },
    },
  );
});

test('each counter has independent history', () => {
  const counters = [
    {
      id: 'counter-1',
      mode: 'author',
      start: 1,
    },
    {
      id: 'counter-2',
      mode: 'author',
      start: 100,
    },
  ];

  const records = rememberCounterHistory({
    records: new Map(),
    platform: 'instagram',
    counters,
    posts: [
      {
        postId: 'post-1',
        username: '@anna',
      },
    ],
    generated: generated({
      'post-1': {
        'counter-1': 1,
        'counter-2': 100,
      },
    }),
    importedPostIds: new Set([
      'post-1',
    ]),
  });

  assert.deepEqual(
    counterHistorySeeds({
      records,
      platform: 'instagram',
      counters,
    }),
    {
      'counter-1': {
        authors: {
          anna: 2,
        },
      },
      'counter-2': {
        authors: {
          anna: 101,
        },
      },
    },
  );
});

test('counter histories survive serialization', () => {
  const record = {
    platform: 'instagram',
    counterId: 'counter-1',
    mode: 'author',
    start: 1,
    authors: {
      anna: 4,
      bob: 2,
    },
    seenPostIds: [
      'post-1',
      'post-2',
      'post-1',
    ],
  };

  const key =
    counterNumberingSeriesKey(record);

  const serialized =
    serializeCounterHistoryRecords(
      new Map([
        [key, record],
      ]),
    );

  const restored =
    parseCounterHistoryRecords(
      serialized,
    );

  assert.deepEqual(
    restored.get(key),
    {
      platform: 'instagram',
      counterId: 'counter-1',
      mode: 'author',
      start: 1,
      authors: {
        anna: 4,
        bob: 2,
      },
      seenPostIds: [
        'post-1',
        'post-2',
      ],
    },
  );
});
