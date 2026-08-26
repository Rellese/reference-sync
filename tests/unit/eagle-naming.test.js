import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNames } from '../../js/eagle-import.js';

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
