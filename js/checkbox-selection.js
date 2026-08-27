/* ============================================================
   AE-style checkbox selection

   Независимая от DOM модель:

   - обычный клик устанавливает якорь;
   - Shift-click изменяет диапазон;
   - pointer drag изменяет каждый затронутый элемент один раз;
   - disabled-элементы пропускаются.

   Автопрокрутка сюда не входит — это задача M1-T07N.
   ============================================================ */

function asSet(values) {
  return values instanceof Set
    ? new Set(values)
    : new Set(values || []);
}

function uniqueOrder(orderedIds) {
  const result = [];
  const seen = new Set();

  for (const id of orderedIds || []) {
    if (id === undefined || id === null || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);
  }

  return result;
}

/**
 * Возвращает диапазон между anchorId и targetId включительно.
 *
 * Порядок диапазона всегда соответствует визуальному порядку
 * orderedIds, даже если пользователь выбирает снизу вверх.
 */
export function checkboxRange(
  orderedIds,
  anchorId,
  targetId,
) {
  const order = uniqueOrder(orderedIds);
  const anchorIndex = order.indexOf(anchorId);
  const targetIndex = order.indexOf(targetId);

  if (anchorIndex < 0 || targetIndex < 0) {
    return [];
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);

  return order.slice(start, end + 1);
}

/**
 * Применяет одно состояние к переданным элементам.
 *
 * checked=true  — добавить элементы в selection.
 * checked=false — удалить элементы из selection.
 */
export function applyCheckboxState({
  selectedIds,
  ids,
  checked,
  disabledIds,
}) {
  const selection = asSet(selectedIds);
  const disabled = asSet(disabledIds);
  const changedIds = [];

  for (const id of uniqueOrder(ids)) {
    if (disabled.has(id)) {
      continue;
    }

    const wasChecked = selection.has(id);

    if (checked) {
      selection.add(id);
    } else {
      selection.delete(id);
    }

    if (wasChecked !== Boolean(checked)) {
      changedIds.push(id);
    }
  }

  return {
    selectedIds: selection,
    changedIds,
  };
}

/**
 * Применяет Shift-click.
 *
 * Если предыдущий якорь существует в текущем визуальном списке,
 * изменяется весь диапазон.
 *
 * Если якорь исчез после фильтрации или нового поиска,
 * изменяется только targetId, а он становится новым якорем.
 */
export function applyShiftSelection({
  orderedIds,
  selectedIds,
  anchorId,
  targetId,
  checked,
  disabledIds,
}) {
  const order = uniqueOrder(orderedIds);

  if (!order.includes(targetId)) {
    return {
      selectedIds: asSet(selectedIds),
      changedIds: [],
      affectedIds: [],
      anchorId,
      usedRange: false,
    };
  }

  const hasValidAnchor = order.includes(anchorId);

  const affectedIds = hasValidAnchor
    ? checkboxRange(order, anchorId, targetId)
    : [targetId];

  const result = applyCheckboxState({
    selectedIds,
    ids: affectedIds,
    checked,
    disabledIds,
  });

  return {
    ...result,
    affectedIds,
    anchorId: hasValidAnchor ? anchorId : targetId,
    usedRange: hasValidAnchor,
  };
}

/**
 * Хранит временное состояние протягивания.
 *
 * Модель не работает с DOM самостоятельно. Интерфейс передаёт
 * идентификатор каждого чекбокса, над которым проходит указатель,
 * а модель возвращает требуемое действие.
 */
export function createCheckboxGestureState() {
  let anchorId = null;
  let drag = null;

  return {
    getAnchor() {
      return anchorId;
    },

    setAnchor(id) {
      anchorId = id;
    },

    resetAnchor() {
      anchorId = null;
    },

    beginDrag(id, checked) {
      if (id === undefined || id === null) {
        return null;
      }

      anchorId = id;

      drag = {
        checked: Boolean(checked),
        visitedIds: new Set([id]),
      };

      return {
        id,
        checked: drag.checked,
      };
    },

    visitDrag(id) {
      if (
        !drag ||
        id === undefined ||
        id === null ||
        drag.visitedIds.has(id)
      ) {
        return null;
      }

      drag.visitedIds.add(id);

      return {
        id,
        checked: drag.checked,
      };
    },

    endDrag() {
      const wasActive = Boolean(drag);
      drag = null;
      return wasActive;
    },

    isDragging() {
      return Boolean(drag);
    },

    dragTargetState() {
      return drag?.checked ?? null;
    },

    reset() {
      anchorId = null;
      drag = null;
    },
  };
}
