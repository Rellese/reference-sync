import test from 'node:test';
import assert from 'node:assert/strict';

import {
  numberingCounters,
} from '../../js/state.js';

test('numbering settings create two independent counters', () => {
  assert.deepEqual(
    numberingCounters({
      counterOne: 'author',
      counterOneStart: 10,
      counterOnePlacement: 'end',

      counterTwo: 'carousel',
      counterTwoStart: 100,
      counterTwoPlacement: 'start',
    }),
    [
      {
        id: 'counter-1',
        mode: 'author',
        start: 10,
        placement: 'end',
      },
      {
        id: 'counter-2',
        mode: 'carousel',
        start: 100,
        placement: 'start',
      },
    ],
  );
});

test('first counter falls back to the legacy start number', () => {
  assert.deepEqual(
    numberingCounters({
      counterOne: 'global',
      numberingStart: 50,
      counterTwo: 'none',
      counterTwoStart: 1,
    }),
    [
      {
        id: 'counter-1',
        mode: 'global',
        start: 50,
        placement: 'end',
      },
      {
        id: 'counter-2',
        mode: 'none',
        start: 1,
        placement: 'end',
      },
    ],
  );
});

test('each invalid start number falls back independently', () => {
  const counters = numberingCounters({
    counterOne: 'batch',
    counterOneStart: 0,
    numberingStart: 20,

    counterTwo: 'type',
    counterTwoStart: -5,
  });

  assert.equal(
    counters[0].start,
    20,
  );

  assert.equal(
    counters[1].start,
    1,
  );
});
