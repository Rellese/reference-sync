import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allPostsImported,
  buildImportSummary,
} from '../../js/import-summary.js';

test('import summary displays publications and Eagle elements', () => {
  const summary = buildImportSummary({
    postCount: 3,
    elementCount: 5,
  });

  assert.equal(
    summary.status,
    'Импортировано в Eagle: 5 элементов',
  );

  assert.equal(
    summary.detail,
    '3 публикации / 5 элементов',
  );

  assert.equal(
    summary.interest,
    '3 ПУБ. / 5 ЭЛ.',
  );
});

test('import summary uses singular words', () => {
  const summary = buildImportSummary({
    postCount: 1,
    elementCount: 1,
  });

  assert.equal(
    summary.status,
    'Импортировано в Eagle: 1 элемент',
  );

  assert.equal(
    summary.detail,
    '1 публикация / 1 элемент',
  );
});

test('all publications must be imported before starting another search', () => {
  const posts = [
    { postId: 'post-1' },
    { postId: 'post-2' },
  ];

  assert.equal(
    allPostsImported(
      posts,
      new Set(['post-1', 'post-2']),
    ),
    true,
  );

  assert.equal(
    allPostsImported(
      posts,
      new Set(['post-1']),
    ),
    false,
  );
});
