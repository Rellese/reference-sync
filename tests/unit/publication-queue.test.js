import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INSTAGRAM_RATE_LIMITED,
  looksInstagramRateLimited,
  makeInstagramRateLimitError,
  runPublicationQueue,
  STOPPED,
} from '../../js/job-control.js';

test('publication queue continues after one item fails', async () => {
  const visited = [];

  const result = await runPublicationQueue(
    [
      { postId: 'first' },
      { postId: 'broken' },
      { postId: 'last' },
    ],
    async (post) => {
      visited.push(post.postId);

      if (post.postId === 'broken') {
        throw new Error('400 Bad Request');
      }

      return `${post.postId}-downloaded`;
    },
  );

  assert.deepEqual(visited, ['first', 'broken', 'last']);

  assert.deepEqual(
    result.completed.map((entry) => entry.item.postId),
    ['first', 'last'],
  );

  assert.deepEqual(
    result.failed.map((entry) => entry.item.postId),
    ['broken'],
  );

  assert.equal(result.failed[0].error, '400 Bad Request');
});

test('publication queue stops before the next item after user cancellation', async () => {
  const controller = new AbortController();
  const visited = [];

  const result = await runPublicationQueue(
    [
      { postId: 'first' },
      { postId: 'second' },
      { postId: 'third' },
    ],
    async (post) => {
      visited.push(post.postId);

      if (post.postId === 'first') {
        controller.abort();
      }

      return `${post.postId}-downloaded`;
    },
    { signal: controller.signal },
  );

  assert.deepEqual(visited, ['first']);
  assert.equal(result.stopped, true);
  assert.equal(result.completed.length, 1);
  assert.equal(result.failed.length, 0);
});

test('publication queue treats job-control stop as full cancellation', async () => {
  const visited = [];

  const result = await runPublicationQueue(
    [
      { postId: 'first' },
      { postId: 'second' },
      { postId: 'third' },
    ],
    async (post) => {
      visited.push(post.postId);

      if (post.postId === 'second') {
        const error = new Error('Процесс остановлен пользователем');
        error.code = STOPPED;
        throw error;
      }

      return `${post.postId}-downloaded`;
    },
  );

  assert.deepEqual(visited, ['first', 'second']);
  assert.equal(result.stopped, true);
  assert.equal(result.completed.length, 1);
  assert.equal(result.failed.length, 0);
});

test('recognizes Instagram rate-limit responses', () => {
  assert.equal(
    looksInstagramRateLimited('429 Too Many Requests'),
    true,
  );

  assert.equal(
    looksInstagramRateLimited(
      'Instagram API error: feedback_required',
    ),
    true,
  );

  assert.equal(
    looksInstagramRateLimited(
      'Please wait a few minutes before you try again',
    ),
    true,
  );

  assert.equal(
    looksInstagramRateLimited('challenge_required'),
    true,
  );

  assert.equal(
    looksInstagramRateLimited('connection timed out'),
    false,
  );

  assert.equal(
    looksInstagramRateLimited('login required'),
    false,
  );
});

test('publication queue stops at Instagram rate limit', async () => {
  const visited = [];

  const result = await runPublicationQueue(
    [
      { postId: 'first' },
      { postId: 'limited' },
      { postId: 'must-not-start' },
    ],
    async (post) => {
      visited.push(post.postId);

      if (post.postId === 'limited') {
        throw makeInstagramRateLimitError(
          '429 Too Many Requests',
        );
      }

      return `${post.postId}-downloaded`;
    },
  );

  assert.deepEqual(
    visited,
    ['first', 'limited'],
  );

  assert.equal(result.stopped, true);
  assert.equal(
    result.stopReason,
    INSTAGRAM_RATE_LIMITED,
  );

  assert.deepEqual(
    result.completed.map((entry) => entry.item.postId),
    ['first'],
  );

  assert.deepEqual(
    result.failed.map((entry) => entry.item.postId),
    ['limited'],
  );

  assert.equal(
    result.failed[0].cause.code,
    INSTAGRAM_RATE_LIMITED,
  );
});
