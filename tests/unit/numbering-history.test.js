import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNumberingRecord,
  extractPublicationNumber,
  numberingSettingsMatch,
  parseNumberingRecords,
  resolveContinuedStart,
  serializeNumberingRecords,
} from '../../js/numbering-history.js';

function settings(overrides = {}) {
  return {
    platform: 'instagram',
    numberingEnabled: true,
    numberingDestination: 'name',
    numberingMarker: 'instpoporder-',
    numberingStart: 1,
    ...overrides,
  };
}

test('unchanged numbering settings match the last import', () => {
  const current = settings();

  const record = createNumberingRecord({
    settings: current,
    lastNumber: 250,
    itemIds: ['eagle-1'],
  });

  assert.equal(
    numberingSettingsMatch(record, current),
    true,
  );
});

test('changed marker disables automatic continuation', () => {
  const record = createNumberingRecord({
    settings: settings(),
    lastNumber: 250,
    itemIds: ['eagle-1'],
  });

  assert.equal(
    numberingSettingsMatch(
      record,
      settings({
        numberingMarker: 'another-series-',
      }),
    ),
    false,
  );
});

test('changed manual start disables automatic continuation', () => {
  const record = createNumberingRecord({
    settings: settings(),
    lastNumber: 250,
    itemIds: ['eagle-1'],
  });

  assert.equal(
    numberingSettingsMatch(
      record,
      settings({
        numberingStart: 500,
      }),
    ),
    false,
  );
});

test('extracts publication number from arbitrary marker', () => {
  const number = extractPublicationNumber(
    {
      name: '@author summer.2026-(set)+250-3',
    },
    {
      destination: 'name',
      marker: 'summer.2026-(set)+',
    },
  );

  assert.equal(number, 250);
});

test('extracts pure numbering from Eagle item name', () => {
  const number = extractPublicationNumber(
    {
      name: '@author 250-2',
    },
    {
      destination: 'name',
      marker: '',
    },
  );

  assert.equal(number, 250);
});

test('extracts pure numbering from first annotation line', () => {
  const number = extractPublicationNumber(
    {
      name: '@author',
      annotation: '250-3\n\nDescription from post 9999',
    },
    {
      destination: 'description',
      marker: '',
    },
  );

  assert.equal(number, 250);
});

test('continues from actual last Eagle publication number', () => {
  const current = settings({
    numberingMarker: '',
    numberingStart: 1,
  });

  const record = createNumberingRecord({
    settings: current,
    lastNumber: 250,
    itemIds: [
      'eagle-1',
      'eagle-2',
    ],
  });

  const next = resolveContinuedStart({
    record,
    settings: current,
    items: [
      {
        id: 'eagle-1',
        name: '@author 250-1',
      },
      {
        id: 'eagle-2',
        name: '@author 250-2',
      },
    ],
  });

  assert.equal(next, 251);
});

test('numbering records survive serialization', () => {
  const record = createNumberingRecord({
    settings: settings(),
    lastNumber: 250,
    itemIds: [
      'eagle-2',
      'eagle-1',
      'eagle-2',
    ],
  });

  const serialized = serializeNumberingRecords(
    new Map([
      ['instagram', record],
    ]),
  );

  const restored = parseNumberingRecords(
    serialized,
  );

  assert.deepEqual(
    restored.get('instagram'),
    {
      platform: 'instagram',
      enabled: true,
      destination: 'name',
      marker: 'instpoporder-',
      startNumber: 1,
      lastNumber: 250,
      itemIds: [
        'eagle-2',
        'eagle-1',
      ],
    },
  );
});
