import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNames } from '../../js/eagle-import.js';
const posts = ['new', 'old'].map(postId => ({ postId, username: '@author', description: 'original', componentCount: 1, components: [{ index: 1 }] }));
test('independent counters have separate destinations, prefixes, direction and disabled state', () => {
  const result = buildNames({ posts, selected: ['new', 'old'], counters: [
    { id: 'off', mode: 'none', independent: true },
    { id: 'a', mode: 'batch', start: 10, direction: 'start', destination: 'name', marker: 'A', independent: true },
    { id: 'b', mode: 'batch', start: 20, direction: 'end', destination: 'description', marker: 'B', independent: true },
  ] });
  assert.equal(result.get('new').name, '@author A10');
  assert.equal(result.get('old').name, '@author A11');
  assert.equal(result.get('new').description, 'original\n\nB21');
  assert.equal(result.get('old').description, 'original\n\nB20');
});
test('multiple descriptions preserve numbering, destination and placement', () => {
  const result = buildNames({ posts, selected: new Set(['new']), descriptions: [
    { text: 'before', placement: 'start', destination: 'both' },
    { text: 'after', placement: 'end', destination: 'description' },
  ] });
  assert.equal(result.get('new').name, 'before @author instpoporder-1');
  assert.match(result.get('new').description, /^before\n\noriginal\n\nafter$/);
});
test('carousel counters preserve original component positions and can count backwards', () => {
  const result = buildNames({ posts: [{ ...posts[0], componentCount: 3, selectedComponents: [1, 3] }], selected: ['new'], counters: [
    { id: 'c', mode: 'carousel', start: 7, direction: 'end', destination: 'both', marker: 'C', independent: true },
  ] });
  assert.deepEqual(result.get('new').componentNames, ['@author C9', , '@author C7']);
  assert.equal(result.get('new').counterValuesByComponent[2].c, 7);
});
