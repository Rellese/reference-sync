import test from 'node:test';
import assert from 'node:assert/strict';
import { pacingMilliseconds, waitForPacing } from '../../js/request-pacing.js';

test('safe pacing samples 3, 4 and 5 seconds independently rather than cycling', () => {
  assert.deepEqual([0.99, 0.01, 0.8, 0.4, 0.01].map(value => pacingMilliseconds('3-5', () => value)), [5000, 3000, 5000, 4000, 3000]);
  assert.equal(pacingMilliseconds('0'), 0);
});
test('Stop interrupts a pacing wait immediately', async () => {
  const controller = new AbortController();
  const pending = waitForPacing(5000, controller.signal);
  controller.abort();
  await assert.rejects(pending, { code: 'JOB_STOPPED' });
});
