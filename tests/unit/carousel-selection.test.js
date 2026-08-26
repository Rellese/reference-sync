import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSelection,
  selectAll,
  clearSelection,
  imagesOnly,
  videosOnly,
  componentDisplay,
  selectedDownloadedFiles,
  importedComponentPositions,
  availableComponentPositions,
  selectableSelection,
  carouselSelectionState,
} from '../../js/carousel-selection.js';

function makePost() {
  return {
    postId: 'carousel-1',
    componentCount: 3,
    components: [
      {
        index: 1,
        mediaType: 'image',
        extension: 'jpg',
      },
      {
        index: 2,
        mediaType: 'video',
        extension: 'mp4',
      },
      {
        index: 3,
        mediaType: 'image',
        extension: 'webp',
      },
    ],
  };
}

test('new carousel selects all component positions by default', () => {
  const selection = normalizeSelection(makePost());

  assert.deepEqual([...selection], [0, 1, 2]);
});

test('saved Instagram component numbers become zero-based UI positions', () => {
  const selection = normalizeSelection(
    makePost(),
    [1, 3],
  );

  assert.deepEqual([...selection], [0, 2]);
});

test('empty saved selection remains empty', () => {
  const selection = normalizeSelection(
    makePost(),
    [],
  );

  assert.equal(selection.size, 0);
});

test('carousel state converts saved numbers to UI positions once', () => {
  const selection = carouselSelectionState(
    makePost(),
    [1, 3],
  );

  assert.deepEqual(
    selection.selected,
    new Set([0, 2]),
  );
  assert.equal(selection.selectedCount, 2);
});

test('selection buttons return correct component positions', () => {
  const post = makePost();

  assert.deepEqual([...selectAll(post)], [0, 1, 2]);
  assert.equal(clearSelection().size, 0);
  assert.deepEqual([...imagesOnly(post)], [0, 2]);
  assert.deepEqual([...videosOnly(post)], [1]);
});

test('component display contains original number, type and format', () => {
  const post = makePost();

  assert.deepEqual(
    componentDisplay(post.components[1], 1),
    {
      number: 2,
      label: 'Видео · MP4',
    },
  );
});

test('download selection preserves original zero-based component indexes', () => {
  const entry = {
    post: makePost(),
    files: [
      '/tmp/first.jpg',
      '/tmp/second.mp4',
      '/tmp/third.webp',
    ],
  };

  const selected = selectedDownloadedFiles(
    entry,
    [2, 3],
  );

  assert.deepEqual(selected, [
    {
      file: '/tmp/second.mp4',
      componentIndex: 1,
    },
    {
      file: '/tmp/third.webp',
      componentIndex: 2,
    },
  ]);
});

test('empty carousel selection produces no import files', () => {
  const entry = {
    post: makePost(),
    files: [
      '/tmp/first.jpg',
      '/tmp/second.mp4',
      '/tmp/third.webp',
    ],
  };

  assert.deepEqual(
    selectedDownloadedFiles(entry, []),
    [],
  );
});

test('single publication is not affected by carousel selection', () => {
  const entry = {
    post: {
      postId: 'single-1',
      componentCount: 1,
      components: [
        {
          index: 1,
          mediaType: 'image',
          extension: 'jpg',
        },
      ],
    },
    files: ['/tmp/single.jpg'],
  };

  assert.deepEqual(
    selectedDownloadedFiles(entry, []),
    [
      {
        file: '/tmp/single.jpg',
        componentIndex: 0,
      },
    ],
  );
});

test('import registry keys become zero-based imported positions', () => {
  const record = {
    componentCount: 4,
    components: new Map([
      ['0', 'eagle-a'],
      ['2', 'eagle-c'],
    ]),
  };

  assert.deepEqual(
    importedComponentPositions(record),
    new Set([0, 2]),
  );
});

test('already imported components are removed from available positions', () => {
  const post = {
    componentCount: 4,
    components: [
      { index: 1 },
      { index: 2 },
      { index: 3 },
      { index: 4 },
    ],
  };

  assert.deepEqual(
    availableComponentPositions(
      post,
      new Set([0, 2]),
    ),
    new Set([1, 3]),
  );
});

test('already imported components cannot remain selected', () => {
  const post = {
    componentCount: 4,
    components: [
      { index: 1 },
      { index: 2 },
      { index: 3 },
      { index: 4 },
    ],
  };

  assert.deepEqual(
    selectableSelection(
      post,
      [1, 2, 3, 4],
      new Set([0, 2]),
    ),
    new Set([1, 3]),
  );
});

test('selecting all remaining components produces mixed parent state', () => {
  const post = {
    componentCount: 4,
    components: [
      { index: 1 },
      { index: 2 },
      { index: 3 },
      { index: 4 },
    ],
  };

  const selection = carouselSelectionState(
    post,
    [1, 2, 3, 4],
    new Set([0, 2]),
  );

  assert.equal(selection.total, 4);
  assert.equal(selection.importedCount, 2);
  assert.equal(selection.availableCount, 2);
  assert.equal(selection.selectedCount, 2);
  assert.equal(selection.checked, false);
  assert.equal(selection.mixed, true);
  assert.equal(selection.disabled, false);
  assert.deepEqual(selection.selected, new Set([1, 3]));
});
