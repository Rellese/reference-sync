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
