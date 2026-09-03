import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatAuthorFilterValue,
  normalizeAuthorFilterValue,
  parseAuthorFilter,
} from '../../js/state.js';

test('author filter inserts visual at-signs after commas', () => {
  assert.equal(
    formatAuthorFilterValue('first,second, third'),
    'first, @second, @third',
  );
});

test('author filter keeps a trailing visual at-sign', () => {
  assert.equal(
    formatAuthorFilterValue('first,'),
    'first, @',
  );
});

test('author filter removes an at-sign duplicated by the field prefix', () => {
  assert.equal(
    formatAuthorFilterValue('@first, @second'),
    'first, @second',
  );
});

test('author filter parser ignores visual at-signs', () => {
  assert.deepEqual(
    parseAuthorFilter('first, @second, @third'),
    ['first', 'second', 'third'],
  );
});

test('author filter parser ignores an unfinished trailing at-sign', () => {
  assert.deepEqual(
    parseAuthorFilter('first, @'),
    ['first'],
  );
});

test('author filter converts spaces into author separators', () => {
  assert.equal(
    formatAuthorFilterValue('first second third'),
    'first, @second, @third',
  );
});

test('author filter shows a new author prefix after a trailing space', () => {
  assert.equal(
    formatAuthorFilterValue('first '),
    'first, @',
  );
});

test('author filter removes an unfinished trailing author on commit', () => {
  assert.equal(
    normalizeAuthorFilterValue('first, @'),
    'first',
  );
});

test('author filter removes a trailing separator on commit', () => {
  assert.equal(
    normalizeAuthorFilterValue('first,'),
    'first',
  );
});

test('author filter keeps completed authors on commit', () => {
  assert.equal(
    normalizeAuthorFilterValue(
      'first, @second, @third',
    ),
    'first, @second, @third',
  );
});
