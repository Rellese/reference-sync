import { numberingCounters } from './state.js';

// Advance only after Eagle confirms an item. Ordinary carousel files share a
// publication number; a Behance case and separate blocks have item counters.
// Both kinds retain the values assigned before dispatch to Eagle.
export function createNumberingProgress(initial, generated) {
  const expected = new Map(numberingCounters(initial)
    .filter(counter => initial.numberingEnabled && counter.mode === 'global')
    .map(counter => [counter.id, Number(counter.start)]));
  const values = new Map([...generated].map(([id, entry]) => [String(id), { ...entry.counterValues }]));
  const seen = new Set();
  return (settings, target) => {
    const item=typeof target==='object' ? target : null;
    const postId=item?.sourcePostId || item?.postId || target;
    const id = item?.numberingValues ? `${item.postId}#${item.component}` : String(postId);
    if (seen.has(id)) return {};
    seen.add(id);
    const next = numberingCounters(settings).map(counter => {
      const value = Number((item?.numberingValues || values.get(String(postId)))?.[counter.id]);
      // A manual edit while importing wins over automatic advancement.
      if (counter.mode !== 'global' || !expected.has(counter.id) ||
          Number(counter.start) !== expected.get(counter.id) ||
          !Number.isSafeInteger(value) || value < 1) return counter;
      const start = Math.max(Number(counter.start), value + 1);
      expected.set(counter.id, start);
      return { ...counter, start };
    });
    const before = numberingCounters(settings);
    if (next.every((counter, i) => counter.start === before[i].start)) return {};
    if (Array.isArray(settings.counters)) return { counters: next };
    const patch = {};
    for (const [i, key] of ['counterOneStart', 'counterTwoStart', 'counterThreeStart'].entries()) {
      if (next[i] && next[i].start !== before[i].start) patch[key] = next[i].start;
    }
    if (patch.counterOneStart !== undefined) patch.numberingStart = patch.counterOneStart;
    return patch;
  };
}
