/* ============================================================
   Потоковый счётчик найденных публикаций.

   gallery-dl с output.jsonl=true выводит каждое сообщение
   отдельной JSON-строкой:

     [тип, url, metadata]

   ID публикации читается только из корневого metadata-объекта.
   Вложенные id автора, изображения, видео и доски не считаются.
   ============================================================ */

function publicationMetadata(value) {
  if (
    !Array.isArray(value) ||
    typeof value[0] !== 'number'
  ) {
    return null;
  }

  const messageType = Number(value[0]);

  /*
   * gallery-dl:
   *   2 — Directory с метаданными публикации;
   *   3 — URL реального медиафайла.
   *
   * Queue и остальные служебные сообщения не считаем.
   */
  if (
    messageType !== 2 &&
    messageType !== 3
  ) {
    return null;
  }

  for (
    let index = value.length - 1;
    index >= 1;
    index -= 1
  ) {
    const candidate = value[index];

    if (
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

export function createDiscoveryCounter({
  idField,
  onProgress,
  updateInterval = 100,
} = {}) {
  const field =
    String(idField || '').trim();

  if (!field) {
    throw new Error(
      'Для счётчика поиска не указано поле ID публикации',
    );
  }

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

  function addMetadata(metadata) {
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata)
    ) {
      return false;
    }

    const id =
      String(metadata[field] ?? '').trim();

    if (
      !id ||
      foundIds.has(id)
    ) {
      return false;
    }

    foundIds.add(id);
    return true;
  }

  function collectFromValue(value) {
    if (Array.isArray(value)) {
      const metadata =
        publicationMetadata(value);

      if (metadata) {
        return addMetadata(metadata);
      }

      /*
       * Совместимость с обычным --dump-json:
       * один массив может содержать несколько сообщений.
       */
      let changed = false;

      for (const child of value) {
        if (collectFromValue(child)) {
          changed = true;
        }
      }

      return changed;
    }

    /*
     * Некоторые источники выводят сразу metadata-объект,
     * без обёртки [тип, url, metadata].
     */
    return addMetadata(value);
  }

  function processLine(line) {
    const text =
      String(line || '').trim();

    if (!text) {
      return false;
    }

    try {
      return collectFromValue(
        JSON.parse(text),
      );
    } catch (_) {
      return false;
    }
  }

  function push(chunk, context = {}) {
    if (disposed) {
      return foundIds.size;
    }

    carry += String(chunk || '');
    lastContext = context;

    const lines =
      carry.split(/\r?\n/);

    carry = lines.pop() || '';

    let changed = false;

    for (const line of lines) {
      if (processLine(line)) {
        changed = true;
      }
    }

    if (changed) {
      scheduleReport();
    }

    return foundIds.size;
  }

  function flush(context = lastContext) {
    if (disposed) {
      return foundIds.size;
    }

    lastContext = context;

    let changed = false;

    if (carry.trim()) {
      changed = processLine(carry);
      carry = '';
    }

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    if (
      changed ||
      foundIds.size !== lastReported
    ) {
      report();
    }

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
