import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPostRecords,
  canonicalUrl,
  collectPostRecords,
  normalizePost,
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
