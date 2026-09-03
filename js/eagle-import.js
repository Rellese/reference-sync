/* ============================================================
   ReferenceSync — импорт в Eagle

   Перенос с Python: app/eagle_import_staging.py
   Приоритет отдаётся встроенному API плагина (eagle.item.addFromPath).
   Если плагин открыт вне Eagle, используется локальный HTTP API
   http://localhost:41595 — тот же адрес, что и в Python-версии.

   Главные правила, сохранённые из Python:
     1. Публикации импортируются по одной, строго по порядку —
        это задаёт хронологию в библиотеке Eagle.
     2. Неоднозначная ошибка записи не повторяется автоматически,
        чтобы не создать дубликаты.
     3. После добавления выполняется проверка чтением.
   ============================================================ */

import { eagleApi, nodeApi } from './node-bridge.js';

const API_URL = 'http://localhost:41595';

/* ------------------------------------------------------------
   Проверка доступности Eagle
   ------------------------------------------------------------ */
export async function checkEagle() {
  if (eagleApi?.app) {
    try {
      const version = await eagleApi.app.version;
      return { available: true, source: 'plugin', version };
    } catch (_) { /* пробуем HTTP */ }
  }

  for (const endpoint of ['/api/v2/application/info', '/api/application/info']) {
    try {
      const response = await fetch(`${API_URL}${endpoint}`);
      if (!response.ok) continue;
      const payload = await response.json();
      return {
        available: true,
        source: 'http',
        version: payload?.data?.version || 'unknown',
      };
    } catch (_) { /* следующий адрес */ }
  }

  return { available: false, source: null, version: null };
}

/* ------------------------------------------------------------
   Проверка только тех Eagle ID, которые записал ReferenceSync.
   Полная библиотека не сканируется.
   ------------------------------------------------------------ */
function compactEagleItem(item) {
  if (!item?.id) return null;

  return {
    id: String(item.id),
    name: String(item.name || ''),
    annotation: String(item.annotation || ''),
    tags: Array.isArray(item.tags)
      ? item.tags.map((tag) => String(tag))
      : [],
    isDeleted: item.isDeleted === true,
  };
}

export async function findEagleItemsByIds(itemIds) {
  const ids = [...new Set(
    (itemIds || [])
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  )];

  if (!ids.length) return [];

  if (eagleApi?.item?.get) {
    try {
      const items = await eagleApi.item.get({
        ids,
        fields: [
          'id',
          'name',
          'annotation',
          'tags',
          'isDeleted',
        ],
      });

      return (items || [])
        .map(compactEagleItem)
        .filter(Boolean);
    } catch (_) {
      /* Пробуем следующий API Eagle. */
    }
  }

  if (eagleApi?.item?.getByIds) {
    try {
      const items = await eagleApi.item.getByIds(ids);

      return (items || [])
        .map(compactEagleItem)
        .filter(Boolean);
    } catch (_) {
      /* Пробуем HTTP API. */
    }
  }

  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const response = await fetch(
          `${API_URL}/api/item/info?id=${encodeURIComponent(id)}`,
        );

        if (!response.ok) return null;

        const payload = await response.json();
        const item = payload?.data;

        if (payload?.status !== 'success') {
          return null;
        }

        return compactEagleItem(item);
      } catch (_) {
        return null;
      }
    }),
  );

  return results.filter(Boolean);
}

/* ------------------------------------------------------------
   Список папок библиотеки
   ------------------------------------------------------------ */
export async function listFolders() {
  if (eagleApi?.folder?.getAll) {
    try {
      const folders = await eagleApi.folder.getAll();
      return folders.map((folder) => ({ id: folder.id, name: folder.name }));
    } catch (_) { /* пробуем HTTP */ }
  }
  try {
    const response = await fetch(`${API_URL}/api/v2/folder/list`);
    const payload = await response.json();
    const flatten = (nodes, output = []) => {
      (nodes || []).forEach((node) => {
        output.push({ id: node.id, name: node.name });
        if (node.children) flatten(node.children, output);
      });
      return output;
    };
    return flatten(payload?.data);
  } catch (_) {
    return [];
  }
}

/* ------------------------------------------------------------
   Добавление одного файла
   ------------------------------------------------------------ */
async function addItem({ path, name, website, annotation, tags, folders }) {
  /* Способ 1 — API плагина Eagle */
  if (eagleApi?.item?.addFromPath) {
    const item = await eagleApi.item.addFromPath(path, {
      name,
      website,
      annotation,
      tags: tags || [],
      folders: folders || [],
    });
    /* Возвращается либо id строкой, либо объект */
    const id = typeof item === 'string' ? item : item?.id;
    if (!id) throw new Error('Eagle не вернул идентификатор элемента');
    return id;
  }

  /* Способ 2 — локальный HTTP API */
  const response = await fetch(`${API_URL}/api/v2/item/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      name,
      website,
      annotation,
      tags: tags || [],
      folders: folders || [],
    }),
  });

  if (!response.ok) {
    throw new Error(`Eagle ответил кодом ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.status !== 'success') {
    throw new Error(`Eagle отклонил элемент: ${JSON.stringify(payload)}`);
  }

  const id = findCreatedId(payload);
  if (!id) throw new Error('Eagle сообщил об успехе, но не вернул ID');
  return id;
}

/* Перенос find_created_id() — ID может лежать на разных уровнях */
function findCreatedId(payload) {
  const data = payload?.data;
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) {
    const first = data[0];
    return typeof first === 'string' ? first : first?.id || null;
  }
  return data?.id || null;
}

export function orderPostsOldestFirst(posts) {
  return [...(posts || [])].reverse();
}

export function orderImportItemsOldestFirst(
  items,
  posts,
) {
  const publicationOrder = new Map(
    orderPostsOldestFirst(posts)
      .map((post,index) => [
        String(post.postId),
        index,
      ]),
    );

  return [...(items || [])].sort(
    (left, right) => {
      const leftOrder = publicationOrder.get(
        String(left?.postId || ''),
      );

      const rightOrder = publicationOrder.get(
        String(right?.postId || ''),
      );

      const normalizedLeft =
        leftOrder ?? Number.MAX_SAFE_INTEGER;

      const normalizedRight =
        rightOrder ?? Number.MAX_SAFE_INTEGER;

      return normalizedLeft - normalizedRight;
    },
  );
}

/* ------------------------------------------------------------
   Пакетный импорт скачанных публикаций.
   Порядок следования массива определяет порядок в Eagle.
   ------------------------------------------------------------ */
export async function importToEagle({
  items,
  folderIds = [],
  onProgress,
  onLog,
  onCreated,
  signal,
} = {}) {
  const created = [];
  const failed = [];
  let stopReason = null;

  for (let index = 0; index < items.length; index += 1) {
    if (signal?.aborted) {
      stopReason = 'Импорт остановлен пользователем';
      break;
    }

    const item = items[index];

    if (onProgress) {
      onProgress({
        stage: 'import',
        current: index + 1,
        total: items.length,
        item,
      });
    }

    /* Файл должен существовать на момент записи */
    if (nodeApi.available && !nodeApi.fs.existsSync(item.path)) {
      failed.push({ item, error: 'Файл исчез до импорта' });
      continue;
    }

    try {
      const id = await addItem({
        path: item.path,
        name: item.name,
        website: item.website,
        annotation: item.annotation,
        tags: item.tags,
        folders: folderIds,
      });
      const createdEntry = { item, id };
      created.push(createdEntry);

      if (onCreated) {
        await onCreated(createdEntry, created.length);
      }
      if (onLog) onLog(`Добавлено в Eagle: ${item.name}`);
    } catch (error) {
      /* Неоднозначная ошибка записи: останавливаемся, чтобы не
         продублировать уже созданный элемент (правило из Python). */
      failed.push({ item, error: error.message });
      stopReason = `Импорт прерван: ${error.message}`;
      if (onLog) onLog(stopReason);
      break;
    }
  }

  return { created, failed, stopReason };
}

/* ------------------------------------------------------------
   Генерация имён и описаний.
   Перенос refresh_generated_names() из reference_sync_gui.py.

   Формат: "@user instpoporder-<N>" для одиночной публикации
   и "@user instpoporder-<N>-<K>" для элемента карусели.
   ------------------------------------------------------------ */
export function resolveComponentName({
  nameOverride,
  generatedName,
  componentNames = [],
  componentIndex = 0,
  fallback = '',
} = {}) {
  if (nameOverride !== undefined) {
    const editedLines = String(nameOverride).split('\n');

    return (
      editedLines[componentIndex] ||
      editedLines[0] ||
      fallback
    );
  }

  const generatedLines = String(
    generatedName ?? fallback,
  ).split('\n');

  return (
    componentNames[componentIndex] ||
    generatedLines[componentIndex] ||
    generatedLines[0] ||
    fallback
  );
}

export const NUMBERING_COUNTER_MODES = Object.freeze({
  GLOBAL: 'global',
  CAROUSEL: 'carousel',
  NONE: 'none',
  BATCH: 'batch',
  AUTHOR: 'author',
  TYPE: 'type',
});

const VALID_NUMBERING_COUNTER_MODES = new Set(
  Object.values(NUMBERING_COUNTER_MODES),
);

function normalizeCounterStart(value, fallback = 1) {
  const number = Math.trunc(Number(value));

  return Number.isInteger(number) && number > 0
    ? number
    : fallback;
}

function legacyNumberingCounters(startNumber) {
  return [
    {
      id: 'counter-1',
      mode: NUMBERING_COUNTER_MODES.GLOBAL,
      start: normalizeCounterStart(startNumber),
      placement: 'end',
    },
    {
      id: 'counter-2',
      mode: NUMBERING_COUNTER_MODES.CAROUSEL,
      start: 1,
      placement: 'end',
    },
  ];
}

export function normalizeNumberingCounters(
  counters,
  { startNumber = 1 } = {},
) {
  const source = Array.isArray(counters)
    ? counters
    : legacyNumberingCounters(startNumber);

  const normalized = [];

  for (
    let index = 0;
    index < source.length;
    index += 1
  ) {
    const counter = source[index] || {};
    const mode = String(
      counter.mode || '',
    ).trim().toLowerCase();

    if (
      !VALID_NUMBERING_COUNTER_MODES.has(mode) ||
      mode === NUMBERING_COUNTER_MODES.NONE
    ) {
      break;
    }

    normalized.push({
      id: String(
        counter.id || `counter-${index + 1}`,
      ),
      mode,
      start: normalizeCounterStart(
        counter.start,
      ),
      placement:
        counter.placement === 'start'
          ? 'start'
          : 'end',
    });
  }

  return normalized;
}

function normalizeAuthorKey(post) {
  return String(post?.username || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

function normalizePublicationType(post) {
  return String(post?.type || '')
    .trim()
    .toLowerCase() || 'unknown';
}

function buildPublicationCounterValues(
  counters,
  selectedPosts,
) {
  const values = new Map();

  counters.forEach((counter) => {
    const counterValues = new Map();

    if (
      counter.mode ===
        NUMBERING_COUNTER_MODES.GLOBAL ||
      counter.mode ===
        NUMBERING_COUNTER_MODES.BATCH
    ) {
      selectedPosts.forEach(
        (post, index) => {
          counterValues.set(
            post.postId,
            counter.start + index,
          );
        },
      );
    } else if (
      counter.mode ===
      NUMBERING_COUNTER_MODES.AUTHOR
    ) {
      const nextByAuthor = new Map();

      selectedPosts.forEach((post) => {
        const author = normalizeAuthorKey(post);
        const next =
          nextByAuthor.get(author) ??
          counter.start;

        counterValues.set(
          post.postId,
          next,
        );

        nextByAuthor.set(
          author,
          next + 1,
        );
      });
    } else if (
      counter.mode ===
      NUMBERING_COUNTER_MODES.TYPE
    ) {
      const nextByType = new Map();

      selectedPosts.forEach((post) => {
        const type =
          normalizePublicationType(post);

        const next =
          nextByType.get(type) ??
          counter.start;

        counterValues.set(
          post.postId,
          next,
        );

        nextByType.set(
          type,
          next + 1,
        );
      });
    }

    values.set(counter.id, counterValues);
  });

  return values;
}

function counterValueForComponent({
  counter,
  post,
  componentNumber,
  publicationCounterValues,
}) {
  if (
    counter.mode ===
    NUMBERING_COUNTER_MODES.CAROUSEL
  ) {
    if (post.componentCount <= 1) {
      return null;
    }

    return (
      counter.start +
      componentNumber -
      1
    );
  }

  return publicationCounterValues
    .get(counter.id)
    ?.get(post.postId) ?? null;
}

export function buildNames({
  posts,
  selected,
  numberingEnabled = true,
  marker = 'instpoporder-',
  startNumber = 1,
  counters,
  destination = 'name',
  extraDescription = '',
} = {}) {
  const result = new Map();
  const safePosts = Array.isArray(posts)
    ? posts
    : [];

  const safeSelected =
    selected instanceof Set
      ? selected
      : new Set();

  /*
   * Входной список хранится от новых публикаций
   * к старым. Нумерацию считаем от старых к новым.
   */
  const selectedPosts = safePosts
    .filter((post) =>
      safeSelected.has(post.postId))
    .reverse();

  const activeCounters = numberingEnabled
    ? normalizeNumberingCounters(
      counters,
      { startNumber },
    )
    : [];

  const publicationCounterValues =
    buildPublicationCounterValues(
      activeCounters,
      selectedPosts,
    );

  const globalCounter =
    activeCounters.find(
      (counter) =>
        counter.mode ===
        NUMBERING_COUNTER_MODES.GLOBAL,
    );

  safePosts.forEach((post) => {
    const isSelected =
      safeSelected.has(post.postId);

    /*
     * selectedComponents хранит исходные
     * 1-based позиции элементов карусели.
     */
    const components =
      Array.isArray(post.selectedComponents)
        ? post.selectedComponents
        : (post.components || []).map(
          (item) => item.index,
        );

    const componentNumbers = components
      .map(Number)
      .filter(
        (value) =>
          Number.isInteger(value) &&
          value > 0,
      );

    const numberingByComponent = new Map();
    const counterValuesByComponent = [];

    if (
      numberingEnabled &&
      isSelected &&
      activeCounters.length
    ) {
      const targetComponentNumbers =
        post.componentCount <= 1
          ? [1]
          : componentNumbers;

      targetComponentNumbers.forEach(
        (componentNumber) => {
          const values = [];
          const valuesByCounter = {};

          activeCounters.forEach(
            (counter) => {
              const value =
                counterValueForComponent({
                  counter,
                  post,
                  componentNumber,
                  publicationCounterValues,
                });

              if (
                Number.isInteger(value) &&
                value > 0
              ) {
                values.push(value);
                valuesByCounter[counter.id] =
                  value;
              }
            },
          );

          if (!values.length) {
            return;
          }

          numberingByComponent.set(
            componentNumber,
            `${marker}${values.join('-')}`,
          );

          counterValuesByComponent[
            componentNumber - 1
          ] = valuesByCounter;
        },
      );
    }

    const numberingParts = [
      ...numberingByComponent.values(),
    ];

    const baseDescription = [
      post.description,
      extraDescription,
    ]
      .map((part) =>
        String(part || '').trim())
      .filter(Boolean)
      .join('\n\n');

    let name = post.username;
    let description = baseDescription;

    if (numberingParts.length) {
      const numberingText =
        numberingParts.join('\n');

      if (destination === 'name') {
        name = numberingParts
          .map(
            (part) =>
              `${post.username} ${part}`,
          )
          .join('\n');
      } else if (
        destination === 'description'
      ) {
        description = [
          numberingText,
          baseDescription,
        ]
          .filter(Boolean)
          .join('\n\n');
      } else {
        name = numberingParts
          .map(
            (part) =>
              `${post.username} ${part}`,
          )
          .join('\n');

        description = [
          numberingText,
          baseDescription,
        ]
          .filter(Boolean)
          .join('\n\n');
      }
    }

    /*
     * Массивы сохраняют исходные позиции:
     * компонент №3 находится в позиции 2.
     */
    const componentNames = [];
    const componentDescriptions = [];

    if (post.componentCount <= 1) {
      componentNames[0] = name;
      componentDescriptions[0] =
        description;
    } else {
      componentNumbers.forEach(
        (componentNumber) => {
          const componentIndex =
            componentNumber - 1;

          const numberingPart =
            numberingByComponent.get(
              componentNumber,
            );

          componentNames[componentIndex] =
            numberingPart &&
            (
              destination === 'name' ||
              destination === 'both'
            )
              ? `${post.username} ${numberingPart}`
              : post.username;

          componentDescriptions[
            componentIndex
          ] =
            numberingPart &&
            (
              destination ===
                'description' ||
              destination === 'both'
            )
              ? [
                numberingPart,
                baseDescription,
              ]
                .filter(Boolean)
                .join('\n\n')
              : baseDescription;
        },
      );
    }

    /*
     * postNumber пока сохраняется для
     * совместимости с действующей историей
     * глобальной нумерации.
     */
    const postNumber =
      isSelected && globalCounter
        ? publicationCounterValues
          .get(globalCounter.id)
          ?.get(post.postId) ?? null
        : null;

    const publicationCounterValuesForPost =
      {};

    activeCounters.forEach((counter) => {
      if (
        counter.mode ===
        NUMBERING_COUNTER_MODES.CAROUSEL
      ) {
        return;
      }

      const value =
        publicationCounterValues
          .get(counter.id)
          ?.get(post.postId);

      if (
        Number.isInteger(value) &&
        value > 0
      ) {
        publicationCounterValuesForPost[
          counter.id
        ] = value;
      }
    });

    result.set(post.postId, {
      name,
      description,
      postNumber,
      counterValues:
        publicationCounterValuesForPost,
      counterValuesByComponent,
      componentNames,
      componentDescriptions,
    });
  });

  return result;
}
