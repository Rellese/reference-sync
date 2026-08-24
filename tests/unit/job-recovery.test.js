import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRecoveryState,
  shouldRecoverJob,
} from '../../js/job-recovery.js';

test('active job survives an unexpected shutdown', () => {
  const recovery = normalizeRecoveryState({
    version: 1,
    jobId: 'job-1',
    phase: 'importing',
    stagingRoot: '/tmp/reference-sync/job-1',
    selectedPostIds: ['post-2', 'post-1', 'post-2'],
    completedPostIds: ['post-1'],
  });

  assert.deepEqual(recovery, {
    version: 1,
    jobId: 'job-1',
    phase: 'importing',
    stagingRoot: '/tmp/reference-sync/job-1',
    selectedPostIds: ['post-1', 'post-2'],
    completedPostIds: ['post-1'],
  });

  assert.equal(
    shouldRecoverJob(recovery, {
      stagingExists: true,
      closedGracefully: false,
    }),
    true,
  );
});

test('graceful shutdown never restores temporary work', () => {
  const recovery = normalizeRecoveryState({
    version: 1,
    jobId: 'job-1',
    phase: 'importing',
    stagingRoot: '/tmp/reference-sync/job-1',
    selectedPostIds: ['post-1'],
    completedPostIds: [],
  });

  assert.equal(
    shouldRecoverJob(recovery, {
      stagingExists: true,
      closedGracefully: true,
    }),
    false,
  );
});

test('completed download staging survives an unexpected shutdown', () => {
  const recovery = normalizeRecoveryState({
    jobId: 'job-downloaded',
    phase: 'downloaded',
    stagingRoot: '/tmp/reference-sync/job-downloaded',
    selectedPostIds: ['post-1'],
    completedPostIds: [],
    downloaded: [{
      postId: 'post-1',
      files: ['/tmp/reference-sync/job-downloaded/post-1/1.jpg'],
    }],
  });

  assert.equal(
    shouldRecoverJob(recovery, {
      stagingExists: true,
      closedGracefully: false,
    }),
    true,
  );
});
