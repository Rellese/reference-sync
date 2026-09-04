/*
 * Ограниченная Undo/Redo-история.
 *
 * История существует только в оперативной памяти:
 * она не сохраняется в localStorage и исчезает после закрытия.
 */

export function createHistory({
  limit = 100,
  apply,
} = {}) {
  if (typeof apply !== 'function') {
    throw new TypeError(
      'History requires an apply function',
    );
  }

  const historyLimit =
    Number.isInteger(limit) && limit > 0
      ? limit
      : 100;

  const undoStack = [];
  const redoStack = [];

  let pendingGroup = null;
  let restoring = false;

  function trimUndoStack() {
    if (undoStack.length <= historyLimit) {
      return;
    }

    undoStack.splice(
      0,
      undoStack.length - historyLimit,
    );
  }

  function pushUndo(action) {
    undoStack.push(action);
    trimUndoStack();
    redoStack.length = 0;
  }

  function mergeAction(target, action) {
    if (!action.mergeKey || !target.length) {
      return false;
    }

    const previous = target[target.length - 1];

    if (
      previous.type !== action.type ||
      previous.mergeKey !== action.mergeKey ||
      Array.isArray(previous.actions)
    ) {
      return false;
    }

    target[target.length - 1] = {
      ...action,
      before: previous.before,
    };

    return true;
  }

  function record(action) {
    if (
      restoring ||
      !action ||
      typeof action !== 'object'
    ) {
      return false;
    }

    if (pendingGroup) {
      if (
        !mergeAction(
          pendingGroup.actions,
          action,
        )
      ) {
        pendingGroup.actions.push(action);
      }

      return true;
    }

    if (!mergeAction(undoStack, action)) {
      undoStack.push(action);
      trimUndoStack();
    }

    redoStack.length = 0;
    return true;
  }

  function beginGroup(label = '') {
    if (pendingGroup) {
      return false;
    }

    pendingGroup = {
      type: 'group',
      label,
      actions: [],
    };

    return true;
  }

  function endGroup() {
    if (!pendingGroup) {
      return false;
    }

    const group = pendingGroup;
    pendingGroup = null;

    if (!group.actions.length) {
      return false;
    }

    if (group.actions.length === 1) {
      pushUndo(group.actions[0]);
    } else {
      pushUndo(group);
    }

    return true;
  }

  function cancelGroup() {
    const existed = Boolean(pendingGroup);
    pendingGroup = null;
    return existed;
  }

  function applyAction(action, direction) {
    if (Array.isArray(action.actions)) {
      const actions =
        direction === 'undo'
          ? [...action.actions].reverse()
          : action.actions;

      for (const child of actions) {
        applyAction(child, direction);
      }

      return;
    }

    apply(action, direction);
  }

  function undo() {
    const action = undoStack.pop();

    if (!action) {
      return false;
    }

    restoring = true;

    try {
      applyAction(action, 'undo');
    } catch (error) {
      undoStack.push(action);
      throw error;
    } finally {
      restoring = false;
    }

    redoStack.push(action);
    return true;
  }

  function redo() {
    const action = redoStack.pop();

    if (!action) {
      return false;
    }

    restoring = true;

    try {
      applyAction(action, 'redo');
    } catch (error) {
      redoStack.push(action);
      throw error;
    } finally {
      restoring = false;
    }

    undoStack.push(action);
    trimUndoStack();

    return true;
  }

  function clear() {
    undoStack.length = 0;
    redoStack.length = 0;
    pendingGroup = null;
  }

  return {
    record,
    beginGroup,
    endGroup,
    cancelGroup,
    undo,
    redo,
    clear,

    canUndo() {
      return undoStack.length > 0;
    },

    canRedo() {
      return redoStack.length > 0;
    },

    undoCount() {
      return undoStack.length;
    },

    redoCount() {
      return redoStack.length;
    },

    isRestoring() {
      return restoring;
    },
  };
}
