import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDirectDownloadPlan,
  buildDiscoveryModeArgs,
  buildPostRecords,
  buildSmartStopFilter,
  canonicalUrl,
  collectPostRecords,
  normalizePost,
  SEARCH_MODES,
  stopsAtKnownPost,
} from '../../js/instagram.js';

const galleryDump = [
  {
    post_id: 'post-001',
    post_shortcode: 'AAA111',
    media_id: 'media-001',
    extension: 'jpg',
    num: 1,
    username: 'artist_one',
    taken_at: 200,
    user: {
      pk: 'author-must-not-become-post',
      username: 'artist_one',
    },
  },
  {
    post_id: 'post-002',
    post_shortcode: 'BBB222',
    media_id: 'media-002-a',
    extension: 'jpg',
    num: 1,
    username: 'artist_two',
    taken_at: 100,
  },
  {
    post_id: 'post-002',
    post_shortcode: 'BBB222',
    media_id: 'media-002-b',
    extension: 'mp4',
    num: 2,
    username: 'artist_two',
    taken_at: 100,
  },
];

test('nested author pk is not treated as a publication', () => {
  const records = collectPostRecords(galleryDump);

  assert.equal(records.length, 3);
  assert.equal(
    records.some((record) => record.pk === 'author-must-not-become-post'),
    false,
  );
});

test('gallery records are grouped into publications and carousels', () => {
  const records = buildPostRecords(collectPostRecords(galleryDump));
  const posts = records.map((record) => normalizePost(record));

  assert.equal(posts.length, 2);

  assert.equal(posts[0].postId, 'post-001');
  assert.equal(posts[0].type, 'Фото');
  assert.equal(posts[0].componentCount, 1);

  assert.equal(posts[1].postId, 'post-002');
  assert.equal(posts[1].type, 'Карусель, видео');
  assert.equal(posts[1].componentCount, 2);
  assert.equal(posts[1].components[1].mediaType, 'video');
});

test('invalid nested identifiers do not create fake Instagram URLs', () => {
  assert.equal(canonicalUrl('author-001', '', ''), '');

  assert.equal(
    normalizePost({
      pk: 'author-001',
      username: 'nested_user',
    }),
    null,
  );
});

test('smart mode stops at the first known post', () => {
  assert.equal(
    buildSmartStopFilter(
      new Set(['222', '111', '222']),
    ),
    'str(post_id) not in ("111","222",) or abort()',
  );
});

test('smart stop filter ignores unsafe identifiers', () => {
  assert.equal(
    buildSmartStopFilter(
      new Set(['123', 'bad") or true']),
    ),
    'str(post_id) not in ("123",) or abort()',
  );

  assert.equal(
    buildSmartStopFilter(new Set()),
    null,
  );
});

test('recent mode stops at the first known post', () => {
  assert.equal(
    stopsAtKnownPost(SEARCH_MODES.RECENT),
    true,
  );

  assert.equal(
    stopsAtKnownPost(SEARCH_MODES.SMART),
    true,
  );

  assert.equal(
    stopsAtKnownPost(SEARCH_MODES.FULL),
    false,
  );
});

test('recent mode combines N limit with known-post stop filter', () => {
  assert.deepEqual(
    buildDiscoveryModeArgs({
      searchMode: SEARCH_MODES.RECENT,
      limit: 500,
      knownPostIds: new Set(['222', '111']),
    }),
    [
      '--post-range',
      '1-500',
      '--filter',
      'str(post_id) not in ("111","222",) or abort()',
    ],
  );
});

test('recent mode keeps N limit when there are no known posts', () => {
  assert.deepEqual(
    buildDiscoveryModeArgs({
      searchMode: SEARCH_MODES.RECENT,
      limit: 500,
      knownPostIds: new Set(),
    }),
    [
      '--post-range',
      '1-500',
    ],
  );
});

test('smart mode stops at known posts without an N limit', () => {
  assert.deepEqual(
    buildDiscoveryModeArgs({
      searchMode: SEARCH_MODES.SMART,
      limit: 500,
      knownPostIds: new Set(['111']),
    }),
    [
      '--filter',
      'str(post_id) not in ("111",) or abort()',
    ],
  );
});

test('full mode has neither an N limit nor an early stop filter', () => {
  assert.deepEqual(
    buildDiscoveryModeArgs({
      searchMode: SEARCH_MODES.FULL,
      limit: 500,
      knownPostIds: new Set(['111']),
    }),
    [],
  );
});

test('direct download plan preserves component order and extensions', () => {
  const plan = buildDirectDownloadPlan({
    components: [
      {
        index: 2,
        url: 'https://cdn.example.com/video',
        extension: '.mp4',
      },
      {
        index: 1,
        url: 'https://cdn.example.com/image',
        extension: 'jpg',
      },
    ],
  });

  assert.deepEqual(plan, [
    {
      componentIndex: 1,
      url: 'https://cdn.example.com/image',
      extension: 'jpg',
    },
    {
      componentIndex: 2,
      url: 'https://cdn.example.com/video',
      extension: 'mp4',
    },
  ]);
});

test('direct download plan falls back when component data is incomplete', () => {
  assert.deepEqual(
    buildDirectDownloadPlan({
      components: [
        {
          index: 1,
          url: '',
          extension: 'jpg',
        },
      ],
    }),
    [],
  );
});
