import { throwIfAborted, makeStopError } from './job-control.js';

export function pacingMilliseconds(range, random = Math.random) {
  const [low, upper] = String(range || '0').split('-').map(Number);
  const high = upper ?? low;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < low) return 0;
  const sample = Math.max(0, Math.min(0.999999999, random()));
  return (Math.floor(sample * (high - low + 1)) + low) * 1000;
}

export function waitForPacing(milliseconds, signal) {
  throwIfAborted(signal);
  if (!milliseconds) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(makeStopError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
