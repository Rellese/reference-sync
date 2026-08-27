import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkboxRange,
  applyCheckboxState,
  applyShiftSelection,
  createCheckboxGestureState,
} from '../../js/checkbox-selection.js';

test('checkbox range follows visual order from top to bottom', () => {
  assert.deepEqual(
    checkboxRange(
      ['post-1', 'post-2', 'post-3', 'post-4'],
      'post-2',
      'post-4',
    ),
    ['post-2', 'post-3', 'post-4'],
  );
});

test('checkbox range follows visual order from bottom to top', () => {
  assert.deepEqual(
    checkboxRange(
      ['post-1', 'post-2', 'post-3', 'post-4'],
      'post-4',
      'post-2',
    ),
    ['post-2', 'post-3', 'post-4'],
  );
});

test('checkbox range includes both boundary items', () => {
  assert.deepEqual(
    checkboxRange(
      ['post-1', 'post-2', 'post-3'],
      'post-2',
      'post-2',
    ),
    ['post-2'],
  );
});

test('checkbox range is empty when anchor is not visible', () => {
  assert.deepEqual(
    checkboxRange(
      ['post-1', 'post-2', 'post-3'],
      'hidden-post',
      'post-3',
    ),
    [],
  );
});

test('applying checked state selects the whole range', () => {
  const result = applyCheckboxState({
    selectedIds: new Set(['post-1']),
    ids: ['post-2', 'post-3', 'post-4'],
    checked: true,
  });

  assert.deepEqual(
    [...result.selectedIds],
    ['post-1', 'post-2', 'post-3', 'post-4'],
  );

  assert.deepEqual(
    result.changedIds,
    ['post-2', 'post-3', 'post-4'],
  );
});

test('applying unchecked state clears the whole range', () => {
  const result = applyCheckboxState({
    selectedIds: new Set([
      'post-1',
      'post-2',
      'post-3',
      'post-4',
    ]),
    ids: ['post-2', 'post-3', 'post-4'],
    checked: false,
  });

  assert.deepEqual(
    [...result.selectedIds],
    ['post-1'],
  );

  assert.deepEqual(
    result.changedIds,
    ['post-2', 'post-3', 'post-4'],
  );
});

test('disabled items are skipped', () => {
  const result = applyCheckboxState({
    selectedIds: new Set(),
    ids: ['post-1', 'post-2', 'post-3'],
    checked: true,
    disabledIds: new Set(['post-2']),
  });

  assert.deepEqual(
    [...result.selectedIds],
    ['post-1', 'post-3'],
  );

  assert.deepEqual(
    result.changedIds,
    ['post-1', 'post-3'],
  );
});

test('Shift-click selects the range from the saved anchor', () => {
  const result = applyShiftSelection({
    orderedIds: [
      'post-1',
      'post-2',
      'post-3',
      'post-4',
    ],
    selectedIds: new Set(),
    anchorId: 'post-1',
    targetId: 'post-4',
    checked: true,
  });

  assert.equal(result.usedRange, true);
  assert.equal(result.anchorId, 'post-1');

  assert.deepEqual(
    [...result.selectedIds],
    ['post-1', 'post-2', 'post-3', 'post-4'],
  );
});

test('Shift-click can clear a range', () => {
  const result = applyShiftSelection({
    orderedIds: [
      'post-1',
      'post-2',
      'post-3',
      'post-4',
    ],
    selectedIds: new Set([
      'post-1',
      'post-2',
      'post-3',
      'post-4',
    ]),
    anchorId: 'post-1',
    targetId: 'post-3',
    checked: false,
  });

  assert.deepEqual(
    [...result.selectedIds],
    ['post-4'],
  );
});

test('Shift-click skips disabled items inside the range', () => {
  const result = applyShiftSelection({
    orderedIds: [
      'post-1',
      'post-2',
      'post-3',
      'post-4',
    ],
    selectedIds: new Set(),
    anchorId: 'post-1',
    targetId: 'post-4',
    checked: true,
    disabledIds: new Set(['post-2', 'post-3']),
  });

  assert.deepEqual(
    [...result.selectedIds],
    ['post-1', 'post-4'],
  );
});

test('missing anchor makes target the new anchor', () => {
  const result = applyShiftSelection({
    orderedIds: ['post-1', 'post-2', 'post-3'],
    selectedIds: new Set(),
    anchorId: 'filtered-post',
    targetId: 'post-2',
    checked: true,
  });

  assert.equal(result.usedRange, false);
  assert.equal(result.anchorId, 'post-2');
  assert.deepEqual([...result.selectedIds], ['post-2']);
});

test('target outside current order does not change selection', () => {
  const result = applyShiftSelection({
    orderedIds: ['post-1', 'post-2'],
    selectedIds: new Set(['post-1']),
    anchorId: 'post-1',
    targetId: 'hidden-post',
    checked: true,
  });

  assert.equal(result.usedRange, false);
  assert.deepEqual([...result.selectedIds], ['post-1']);
  assert.deepEqual(result.changedIds, []);
});

test('drag gesture uses one target state', () => {
  const gesture = createCheckboxGestureState();

  assert.deepEqual(
    gesture.beginDrag('post-1', true),
    {
      id: 'post-1',
      checked: true,
    },
  );

  assert.deepEqual(
    gesture.visitDrag('post-2'),
    {
      id: 'post-2',
      checked: true,
    },
  );

  assert.deepEqual(
    gesture.visitDrag('post-3'),
    {
      id: 'post-3',
      checked: true,
    },
  );

  assert.equal(gesture.dragTargetState(), true);
});

test('drag gesture processes each item only once', () => {
  const gesture = createCheckboxGestureState();

  gesture.beginDrag('post-1', false);

  assert.deepEqual(
    gesture.visitDrag('post-2'),
    {
      id: 'post-2',
      checked: false,
    },
  );

  assert.equal(
    gesture.visitDrag('post-2'),
    null,
  );
});

test('ending drag prevents further visits', () => {
  const gesture = createCheckboxGestureState();

  gesture.beginDrag('post-1', true);

  assert.equal(gesture.isDragging(), true);
  assert.equal(gesture.endDrag(), true);
  assert.equal(gesture.isDragging(), false);
  assert.equal(gesture.visitDrag('post-2'), null);
});

test('ordinary selection can replace the Shift anchor', () => {
  const gesture = createCheckboxGestureState();

  gesture.setAnchor('post-1');
  assert.equal(gesture.getAnchor(), 'post-1');

  gesture.setAnchor('post-5');
  assert.equal(gesture.getAnchor(), 'post-5');

  gesture.resetAnchor();
  assert.equal(gesture.getAnchor(), null);
});

test('reset clears anchor and active drag', () => {
  const gesture = createCheckboxGestureState();

  gesture.setAnchor('post-1');
  gesture.beginDrag('post-2', true);
  gesture.reset();

  assert.equal(gesture.getAnchor(), null);
  assert.equal(gesture.isDragging(), false);
  assert.equal(gesture.visitDrag('post-3'), null);
});
