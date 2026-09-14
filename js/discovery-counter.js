/* ============================================================
   Потоковый счётчик найденных публикаций.

   Движок считает каждый уникальный ID сразу после появления
   в stdout gallery-dl, но уведомляет интерфейс не чаще одного
   раза в updateInterval миллисекунд.

   Остаток конца chunk сохраняется, поэтому идентификатор не
   теряется, если JSON был разделён между двумя chunk.
   ============================================================ */

function escapeRegExp(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch (_) {
    return value;
  }
}

export function createDiscoveryCounter({
  idField,
  onProgress,
  updateInterval = 100,
} = {}) {
  const field = String(idField || '').trim();

  if (!field) {
    throw new Error(
      'Для счётчика поиска не указано поле ID публикации',
    );
  }

  const pattern = new RegExp(
    `"${escapeRegExp(field)}"\\s*:\\s*` +
    `(?:"((?:\\\\.|[^"\\\\])*)"|(-?\\d+))`,
    'g',
  );

  const foundIds = new Set();

  let carry = '';
  let timer = null;
  let lastReported = 0;
  let lastContext = {};
  let disposed = false;

  function report() {
    timer = null;

    if (
      disposed ||
      typeof onProgress !== 'function' ||
      foundIds.size === lastReported
    ) {
      return;
    }

    lastReported = foundIds.size;

    onProgress({
      stage: 'discover',
      found: foundIds.size,
      ...lastContext,
    });
  }

  function scheduleReport() {
    if (
      disposed ||
      timer !== null ||
      typeof onProgress !== 'function'
    ) {
      return;
    }

    timer = setTimeout(
      report,
      updateInterval,
    );
  }

  function push(chunk, context = {}) {
    if (disposed) return foundIds.size;

    const input =
      carry + String(chunk || '');

    /*
     * Хвоста 1024 символа достаточно для обычной пары
     * "publication_id": "value". Повторно найденный ID
     * безопасно отсеивается через Set.
     */
    carry = input.slice(-1024);
    lastContext = context;

    pattern.lastIndex = 0;

    let match;
    let changed = false;

    while ((match = pattern.exec(input)) !== null) {
      const rawValue =
        match[1] !== undefined
          ? decodeJsonString(match[1])
          : match[2];

      const id = String(rawValue || '').trim();

      if (!id || foundIds.has(id)) {
        continue;
      }

      foundIds.add(id);
      changed = true;
    }

    if (changed) {
      scheduleReport();
    }

    return foundIds.size;
  }

  function flush(context = lastContext) {
    if (disposed) return foundIds.size;

    lastContext = context;

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    report();

    return foundIds.size;
  }

  function dispose() {
    disposed = true;

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    carry = '';
  }

  return {
    push,
    flush,
    dispose,

    get count() {
      return foundIds.size;
    },
  };
}
