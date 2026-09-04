import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHistory,
} from '../../js/history.js';

function createValueHistory(limit = 100) {
  const state = {
    value: '',
  };

  const history = createHistory({
    limit,

    apply(action, direction) {
      state.value =
        direction === 'undo'
          ? action.before
          : action.after;
    },
  });

  return {
    state,
    history,
  };
}

test('undo restores the previous value', () => {
  const { state, history } =
    createValueHistory();

  state.value = 'new';

  history.record({
    type: 'setting',
    before: 'old',
    after: 'new',
  });

  assert.equal(history.undo(), true);
  assert.equal(state.value, 'old');
});

test('redo restores the changed value', () => {
  const { state, history } =
    createValueHistory();

  state.value = 'new';

  history.record({
    type: 'setting',
    before: 'old',
    after: 'new',
  });

  history.undo();
  history.redo();

  assert.equal(state.value, 'new');
});

test('new action clears redo history', () => {
  const { history } =
    createValueHistory();

  history.record({
    type: 'setting',
    before: 'one',
    after: 'two',
  });

  history.undo();

  history.record({
    type: 'setting',
    before: 'one',
    after: 'three',
  });

  assert.equal(history.canRedo(), false);
});

test('history keeps only the configured limit', () => {
  const { history } =
    createValueHistory(2);

  history.record({
    type: 'setting',
    before: 'one',
    after: 'two',
  });

  history.record({
    type: 'setting',
    before: 'two',
    after: 'three',
  });

  history.record({
    type: 'setting',
    before: 'three',
    after: 'four',
  });

  assert.equal(history.undoCount(), 2);
});

test('matching merge keys become one action', () => {
  const { state, history } =
    createValueHistory();

  history.record({
    type: 'setting',
    mergeKey: 'recentLimit',
    before: 10,
    after: 20,
  });

  history.record({
    type: 'setting',
    mergeKey: 'recentLimit',
    before: 20,
    after: 30,
  });

  state.value = 30;

  assert.equal(history.undoCount(), 1);

  history.undo();

  assert.equal(state.value, 10);
});

test('group is undone in reverse order', () => {
  const values = [];

  const history = createHistory({
    apply(action, direction) {
      values.push(
        `${direction}:${action.id}`,
      );
    },
  });

  history.beginGroup('checkbox drag');

  history.record({
    type: 'selection',
    id: 'one',
  });

  history.record({
    type: 'selection',
    id: 'two',
  });

  history.endGroup();
  history.undo();

  assert.deepEqual(values, [
    'undo:two',
    'undo:one',
  ]);
});

test('empty group is not added to history', () => {
  const { history } =
    createValueHistory();

  history.beginGroup('empty');

  assert.equal(history.endGroup(), false);
  assert.equal(history.canUndo(), false);
});

test('clear removes undo and redo actions', () => {
  const { history } =
    createValueHistory();

  history.record({
    type: 'setting',
    before: 'old',
    after: 'new',
  });

  history.undo();
  history.clear();

  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
});
