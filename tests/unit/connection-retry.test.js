import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobControl, STOPPED } from '../../js/job-control.js';

test('stopping during reconnection resolves its pending wait immediately', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const control = createJobControl();
  const pending = control.waitForConnection();
  await Promise.resolve();
  assert.equal(control.isOffline, true);
  control.stop();
  await assert.rejects(pending, { code: STOPPED });
  assert.equal(control.isOffline, false);
});
test('reconnection waits grow from 5 to 30 seconds and reset after recovery', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const control = createJobControl();
  for (const seconds of [5, 10, 15, 20, 25, 30, 30]) {
    const ticks = [];
    const pending = control.waitForConnection({ onTick: n => ticks.push(n) });
    await Promise.resolve();
    for (let i = 0; i < seconds; i++) t.mock.timers.tick(1000);
    assert.equal(await pending, seconds);
    assert.equal(ticks[0], seconds);
    assert.equal(ticks.at(-1), 0);
  }
  control.resetRetries();
  assert.equal(control.retryStep, 5);
});
test('a stopped queue cannot enter reconnection again', async () => {
  const control = createJobControl();
  control.stop();
  await assert.rejects(control.waitForConnection(), { code: STOPPED });
});
