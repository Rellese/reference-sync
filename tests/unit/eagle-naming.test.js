import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNames,
  normalizeNumberingCounters,
  orderImportItemsOldestFirst,
  orderPostsOldestFirst,
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

test('download queue runs from oldest to newest', () => {
  const posts = [
    { postId: 'newest' },
    { postId: 'middle' },
    { postId: 'oldest' },
  ];

  const ordered = orderPostsOldestFirst(posts);

  assert.deepEqual(
    ordered.map((post) => post.postId),
    [
      'oldest',
      'middle',
      'newest',
    ],
  );
});

function makeNumberingPost({
  postId,
  username,
  type,
  componentCount = 1,
  selectedComponents,
}) {
  return {
    postId,
    username,
    type,
    description: '',
    componentCount,
    components: Array.from(
      { length: componentCount },
      (_, index) => ({
        index: index + 1,
      }),
    ),
    selectedComponents:
      selectedComponents ??
      Array.from(
        { length: componentCount },
        (_, index) => index + 1,
      ),
  };
}

test('batch counter uses its own start number', () => {
  const posts = [
    makeNumberingPost({
      postId: 'newest',
      username: '@anna',
      type: 'Фото',
    }),
    makeNumberingPost({
      postId: 'oldest',
      username: '@bob',
      type: 'Видео',
    }),
  ];

  const generated = buildNames({
    posts,
    selected: new Set([
      'newest',
      'oldest',
    ]),
    counters: [
      {
        id: 'counter-1',
        mode: 'batch',
        start: 10,
      },
    ],
  });

  assert.equal(
    generated.get('oldest').name,
    '@bob instpoporder-10',
  );

  assert.equal(
    generated.get('newest').name,
    '@anna instpoporder-11',
  );
});

test('carousel counter offsets original component positions', () => {
  const post = makeNumberingPost({
    postId: 'carousel',
    username: '@anna',
    type: 'Карусель',
    componentCount: 4,
    selectedComponents: [1, 3],
  });

  const generated = buildNames({
    posts: [post],
    selected: new Set(['carousel']),
    counters: [
      {
        id: 'counter-1',
        mode: 'carousel',
        start: 100,
      },
    ],
  }).get('carousel');

  assert.equal(
    generated.componentNames[0],
    '@anna instpoporder-100',
  );

  assert.equal(
    generated.componentNames[2],
    '@anna instpoporder-102',
  );

  assert.equal(
    generated.componentNames[1],
    undefined,
  );
});

test('author counter has an independent sequence per author', () => {
  const posts = [
    makeNumberingPost({
      postId: 'anna-new',
      username: '@anna',
      type: 'Фото',
    }),
    makeNumberingPost({
      postId: 'bob',
      username: '@bob',
      type: 'Видео',
    }),
    makeNumberingPost({
      postId: 'anna-old',
      username: '@anna',
      type: 'Карусель',
    }),
  ];

  const generated = buildNames({
    posts,
    selected: new Set([
      'anna-new',
      'bob',
      'anna-old',
    ]),
    counters: [
      {
        id: 'counter-1',
        mode: 'author',
        start: 20,
      },
    ],
  });

  assert.equal(
    generated.get('anna-old').name,
    '@anna instpoporder-20',
  );

  assert.equal(
    generated.get('bob').name,
    '@bob instpoporder-20',
  );

  assert.equal(
    generated.get('anna-new').name,
    '@anna instpoporder-21',
  );
});

test('type counter has an independent sequence per publication type', () => {
  const posts = [
    makeNumberingPost({
      postId: 'photo-new',
      username: '@anna',
      type: 'Фото',
    }),
    makeNumberingPost({
      postId: 'video',
      username: '@bob',
      type: 'Видео',
    }),
    makeNumberingPost({
      postId: 'photo-old',
      username: '@charlie',
      type: 'Фото',
    }),
  ];

  const generated = buildNames({
    posts,
    selected: new Set([
      'photo-new',
      'video',
      'photo-old',
    ]),
    counters: [
      {
        id: 'counter-1',
        mode: 'type',
        start: 5,
      },
    ],
  });

  assert.equal(
    generated.get('photo-old').name,
    '@charlie instpoporder-5',
  );

  assert.equal(
    generated.get('video').name,
    '@bob instpoporder-5',
  );

  assert.equal(
    generated.get('photo-new').name,
    '@anna instpoporder-6',
  );
});

test('multiple counters are joined in their configured order', () => {
  const posts = [
    makeNumberingPost({
      postId: 'newest',
      username: '@anna',
      type: 'Фото',
    }),
    makeNumberingPost({
      postId: 'oldest',
      username: '@anna',
      type: 'Фото',
    }),
  ];

  const generated = buildNames({
    posts,
    selected: new Set([
      'newest',
      'oldest',
    ]),
    counters: [
      {
        id: 'counter-1',
        mode: 'global',
        start: 10,
      },
      {
        id: 'counter-2',
        mode: 'author',
        start: 100,
      },
      {
        id: 'counter-3',
        mode: 'type',
        start: 1000,
      },
    ],
  });

  assert.equal(
    generated.get('oldest').name,
    '@anna instpoporder-10-100-1000',
  );

  assert.equal(
    generated.get('newest').name,
    '@anna instpoporder-11-101-1001',
  );
});

test('none mode disables itself and every following counter', () => {
  const counters = normalizeNumberingCounters([
    {
      id: 'counter-1',
      mode: 'batch',
      start: 1,
    },
    {
      id: 'counter-2',
      mode: 'none',
      start: 1,
    },
    {
      id: 'counter-3',
      mode: 'author',
      start: 100,
    },
  ]);

  assert.deepEqual(
    counters.map((counter) => counter.id),
    ['counter-1'],
  );
});

test('none in the first position disables all numbering counters', () => {
  const post = makeNumberingPost({
    postId: 'photo',
    username: '@anna',
    type: 'Фото',
  });

  const generated = buildNames({
    posts: [post],
    selected: new Set(['photo']),
    counters: [
      {
        id: 'counter-1',
        mode: 'none',
        start: 1,
      },
      {
        id: 'counter-2',
        mode: 'global',
        start: 100,
      },
    ],
  }).get('photo');

  assert.equal(
    generated.name,
    '@anna',
  );

  assert.equal(
    generated.postNumber,
    null,
  );
});
