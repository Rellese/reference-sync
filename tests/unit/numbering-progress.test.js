import test from 'node:test';
import assert from 'node:assert/strict';
import { createNumberingProgress } from '../../js/numbering-progress.js';
const settings = () => ({ numberingEnabled: true, counters: [{ id: 'counter-1', mode: 'global', start: 2, marker: 'ref' }] });
const generated = () => new Map(Array.from({ length: 10 }, (_, i) => [String(i), { counterValues: { 'counter-1': i + 2 } }]));

test('global number advances 2 to 12 after ten confirmed publications and resumes from 12', () => {
  let s = settings(); const advance = createNumberingProgress(s, generated());
  for (let i = 0; i < 10; i++) s = { ...s, ...advance(s, String(i)) };
  assert.equal(s.counters[0].start, 12);
  const reopened = JSON.parse(JSON.stringify(s));
  reopened.numberingEnabled = false; reopened.numberingEnabled = true;
  const next = createNumberingProgress(reopened, new Map([['new', { counterValues: { 'counter-1': 12 } }]]));
  assert.equal(next(reopened, 'new').counters[0].start, 13);
});
test('partial import advances only confirmed values; carousel callbacks do not double count', () => {
  let s = settings(); const advance = createNumberingProgress(s, generated());
  s = { ...s, ...advance(s, '0') }; assert.equal(s.counters[0].start, 3);
  assert.deepEqual(advance(s, '0'), {});
  assert.equal(JSON.parse(JSON.stringify(s)).counters[0].start, 3);
});
test('manual reset and unrelated counter modes are preserved', () => {
  const s = settings(); const advance = createNumberingProgress(s, generated());
  s.counters[0].start = 100;
  assert.deepEqual(advance(s, '0'), {});
  const disabled = settings(); disabled.numberingEnabled = false;
  assert.deepEqual(createNumberingProgress(disabled, generated())(disabled, '0'), {});
});
test('legacy settings advance without changing counter representation', () => {
  const s = { numberingEnabled: true, counterOne: 'global', counterOneStart: 2 };
  const advance = createNumberingProgress(s, generated());
  assert.deepEqual(advance(s, '0'), { counterOneStart: 3, numberingStart: 3 });
});
