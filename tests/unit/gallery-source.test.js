import pinterestSource from '../../js/sources/pinterest.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseGalleryStagingRoot,
  findPreview,
  notifyGalleryDownloadCompleted,
  parseDumpJson,
} from '../../js/sources/gallery-source.js';

test('parseDumpJson parses a full gallery-dl document', () => {
  const raw = JSON.stringify([
    [
      2,
      {
        pin_id: 'directory',
      },
    ],
    [
      3,
      'https://cdn.example.com/image.jpg',
      {
        pin_id: '123',
        url: 'https://www.pinterest.com/pin/123/',
      },
    ],
  ]);

  const records = parseDumpJson(raw);

  assert.equal(records.length, 2);
  assert.equal(records[1].pin_id, '123');
  assert.equal(
    records[1].url,
    'https://cdn.example.com/image.jpg',
  );
  assert.equal(
    records[1]._galleryUrl,
    'https://cdn.example.com/image.jpg',
  );
  assert.equal(
    records[1]._metadataUrl,
    'https://www.pinterest.com/pin/123/',
  );
  assert.equal(records[0]._galleryType, 2);
  assert.equal(records[1]._galleryType, 3);
});

test('parseDumpJson parses one gallery-dl message', () => {
  const raw = JSON.stringify([
    3,
    'https://cdn.example.com/single.jpg',
    {
      pin_id: '456',
    },
  ]);

  const records = parseDumpJson(raw);

  assert.equal(records.length, 1);
  assert.equal(records[0].pin_id, '456');
  assert.equal(
    records[0]._galleryUrl,
    'https://cdn.example.com/single.jpg',
  );
});

test('parseDumpJson parses gallery-dl JSON-Lines', () => {
  const raw = [
    JSON.stringify([
      3,
      'https://cdn.example.com/1.jpg',
      { pin_id: '1' },
    ]),
    JSON.stringify([
      3,
      'https://cdn.example.com/2.jpg',
      { pin_id: '2' },
    ]),
  ].join('\n');

  const records = parseDumpJson(raw);

  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((record) => record.pin_id),
    ['1', '2'],
  );
});

test('parseDumpJson accepts a bare metadata object', () => {
  const records = parseDumpJson(
    JSON.stringify({
      pin_id: '789',
      title: 'Pinterest pin',
    }),
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].pin_id, '789');
});

test('findPreview reads Pinterest image variants', () => {
  const preview = findPreview({
    images: {
      orig: {
        url: 'https://i.pinimg.com/originals/image.jpg',
      },
      '236x': {
        url: 'https://i.pinimg.com/236x/image.jpg',
      },
      '474x': {
        url: 'https://i.pinimg.com/474x/image.jpg',
      },
    },
  });

  assert.equal(
    preview,
    'https://i.pinimg.com/236x/image.jpg',
  );
});

test('findPreview supports an array of previews', () => {
  const preview = findPreview({
    thumbnails: [
      {
        url: 'https://example.com/thumbnail.jpg',
      },
    ],
  });

  assert.equal(
    preview,
    'https://example.com/thumbnail.jpg',
  );
});

test('findPreview prefers an explicit thumbnail', () => {
  const preview = findPreview({
    thumbnail_url: 'https://example.com/thumbnail.jpg',
    images: {
      orig: {
        url: 'https://example.com/original.jpg',
      },
    },
    _galleryUrl: 'https://example.com/download.jpg',
  });

  assert.equal(
    preview,
    'https://example.com/thumbnail.jpg',
  );
});

test('findPreview falls back to gallery-dl media URL', () => {
  const preview = findPreview({
    _galleryUrl: 'https://example.com/media.jpg',
  });

  assert.equal(
    preview,
    'https://example.com/media.jpg',
  );
});

test('Pinterest groups media files into one carousel', () => {
  const posts = pinterestSource.assemble(
    [
      {
        _galleryType: 2,
        pin_id: '123',
        description: 'Pinterest carousel',
        images: {
          '236x': {
            url: 'https://i.pinimg.com/236x/cover.jpg',
          },
        },
      },
      {
        _galleryType: 3,
        pin_id: '123',
        num: 1,
        extension: 'jpg',
        _galleryUrl:
          'https://i.pinimg.com/originals/first.jpg',
      },
      {
        _galleryType: 3,
        pin_id: '123',
        num: 2,
        extension: 'jpg',
        _galleryUrl:
          'https://i.pinimg.com/originals/second.jpg',
      },
    ],
    {
      target: {
        id: 'allpins',
        name: 'Все пины',
      },
      accountUsername: 'nikitadoctor26',
    },
  );

  assert.equal(posts.length, 1);
  assert.equal(posts[0].type, 'Карусель');
  assert.equal(posts[0].componentCount, 2);
  assert.equal(posts[0].structure, '2 элем.');
  assert.equal(posts[0].components.length, 2);
  assert.equal(
    posts[0].previewUrl,
    'https://i.pinimg.com/236x/cover.jpg',
  );
  assert.deepEqual(
    posts[0].components.map(
      (component) => component.url,
    ),
    [
      'https://i.pinimg.com/originals/first.jpg',
      'https://i.pinimg.com/originals/second.jpg',
    ],
  );
});

test('Pinterest does not count Directory as a component', () => {
  const posts = pinterestSource.assemble(
    [
      {
        _galleryType: 2,
        pin_id: '456',
        description: 'Single pin',
      },
      {
        _galleryType: 3,
        pin_id: '456',
        num: 1,
        extension: 'jpg',
        _galleryUrl:
          'https://i.pinimg.com/originals/single.jpg',
      },
    ],
    {
      target: {
        id: 'allpins',
        name: 'Все пины',
      },
      accountUsername: 'nikitadoctor26',
    },
  );

  assert.equal(posts.length, 1);
  assert.equal(posts[0].type, 'Фото');
  assert.equal(posts[0].componentCount, 1);
  assert.equal(posts[0].structure, '1 элем.');
});

test('gallery download reuses recovery staging root', () => {
  assert.equal(
    chooseGalleryStagingRoot(
      '/existing/recovery/job',
      '/generated/new/job',
    ),
    '/existing/recovery/job',
  );
});

test('gallery download creates staging when recovery is absent', () => {
  assert.equal(
    chooseGalleryStagingRoot(
      '',
      '/generated/new/job',
    ),
    '/generated/new/job',
  );
});

test('gallery download reports every completed entry', async () => {
  const completed = [];

  const entry = {
    post: {
      postId: 'pinterest:123',
    },
    files: [
      '/staging/pinterest_123/1.jpg',
    ],
    error: null,
  };

  const notified =
    await notifyGalleryDownloadCompleted(
      async (value) => {
        completed.push(value);
      },
      entry,
    );

  assert.equal(notified, true);
  assert.deepEqual(completed, [entry]);
});

test('gallery download does not recover an empty result', async () => {
  let calls = 0;

  const notified =
    await notifyGalleryDownloadCompleted(
      async () => {
        calls += 1;
      },
      {
        post: {
          postId: 'pinterest:failed',
        },
        files: [],
        error: 'Download failed',
      },
    );

  assert.equal(notified, false);
  assert.equal(calls, 0);
});
