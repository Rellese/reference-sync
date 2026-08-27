import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNames,
  orderImportItemsOldestFirst,
  resolveComponentName,
} from '../../js/eagle-import.js';

function makeCarousel(selectedComponents) {
  return {
    postId: 'carousel-1',
    username: '@author',
    description: 'Original description',
    componentCount: 6,
    components: Array.from(
      { length: 6 },
      (_, index) => ({
        index: index + 1,
      }),
    ),
    selectedComponents,
  };
}

test('partial carousel names preserve original component numbers', () => {
  const post = makeCarousel([1, 3]);

  const generated = buildNames({
    posts: [post],
    selected: new Set([post.postId]),
    numberingEnabled: true,
    marker: 'instpoporder-',
    startNumber: 1,
    destination: 'name',
  }).get(post.postId);

  assert.equal(
    generated.componentNames[0],
    '@author instpoporder-1-1',
  );

  assert.equal(
    generated.componentNames[2],
    '@author instpoporder-1-3',
  );

  assert.equal(
    generated.componentNames[1],
    undefined,
  );
});

test('partial carousel descriptions preserve original component numbers', () => {
  const post = makeCarousel([1, 3]);

  const generated = buildNames({
    posts: [post],
    selected: new Set([post.postId]),
    numberingEnabled: true,
    marker: 'instpoporder-',
    startNumber: 1,
    destination: 'description',
  }).get(post.postId);

  assert.match(
    generated.componentDescriptions[0],
    /instpoporder-1-1/,
  );

  assert.match(
    generated.componentDescriptions[2],
    /instpoporder-1-3/,
  );

  assert.doesNotMatch(
    generated.componentDescriptions[2],
    /instpoporder-1-1/,
  );
});

test('empty carousel selection does not fall back to all components', () => {
  const post = makeCarousel([]);

  const generated = buildNames({
    posts: [post],
    selected: new Set([post.postId]),
    numberingEnabled: true,
    marker: 'instpoporder-',
    startNumber: 1,
    destination: 'name',
  }).get(post.postId);

  assert.deepEqual(
    generated.componentNames,
    [],
  );
});

test('edited carousel name overrides generated component names', () => {
  const name = resolveComponentName({
    nameOverride: 'Custom carousel name',
    generatedName: '@author instpoporder-1-2',
    componentNames: [
      '@author instpoporder-1-1',
      '@author instpoporder-1-2',
    ],
    componentIndex: 1,
    fallback: '@author',
  });

  assert.equal(name, 'Custom carousel name');
});

test('multiline edited names map to carousel components', () => {
  const name = resolveComponentName({
    nameOverride: 'First\nSecond\nThird',
    componentNames: [
      '@author instpoporder-1-1',
      '@author instpoporder-1-2',
      '@author instpoporder-1-3',
    ],
    componentIndex: 2,
    fallback: '@author',
  });

  assert.equal(name, 'Third');
});

test('generated component name remains when name is not edited', () => {
  const name = resolveComponentName({
    generatedName: '@author instpoporder-1-1',
    componentNames: [
      '@author instpoporder-1-1',
      '@author instpoporder-1-2',
    ],
    componentIndex: 1,
    fallback: '@author',
  });

  assert.equal(name, '@author instpoporder-1-2');
});

test('selected publications are numbered from oldest to newest', () => {
  const posts = ['newest', 'middle', 'oldest'].map((postId) => ({
    postId,
    username: '@author',
    description: '',
    componentCount: 2,
    components: [
      { index: 1 },
      { index: 2 },
    ],
    selectedComponents: [1, 2],
  }));

  const generated = buildNames({
    posts,
    selected: new Set([
      'newest',
      'middle',
      'oldest',
    ]),
    numberingEnabled: true,
    marker: 'instpoporder-',
    startNumber: 10,
    destination: 'name',
  });

  assert.equal(
    generated.get('oldest').componentNames[0],
    '@author instpoporder-10-1',
  );

  assert.equal(
    generated.get('middle').componentNames[0],
    '@author instpoporder-11-1',
  );

  assert.equal(
    generated.get('newest').componentNames[0],
    '@author instpoporder-12-1',
  );
});

test('Eagle import queue runs from oldest to newest', () => {
  const posts = [
    { postId: 'newest' },
    { postId: 'middle' },
    { postId: 'oldest' },
  ];

  const items = [
    {
      id: 'newest-1',
      postId: 'newest',
      component: '1',
    },
    {
      id: 'newest-2',
      postId: 'newest',
      component: '2',
    },
    {
      id: 'middle-1',
      postId: 'middle',
      component: '1',
    },
    {
      id: 'oldest-1',
      postId: 'oldest',
      component: '1',
    },
    {
      id: 'oldest-2',
      postId: 'oldest',
      component: '2',
    },
  ];

  const ordered = orderImportItemsOldestFirst(
    items,
    posts,
  );

  assert.deepEqual(
    ordered.map((item) => item.id),
    [
      'oldest-1',
      'oldest-2',
      'middle-1',
      'newest-1',
      'newest-2',
    ],
  );
});
