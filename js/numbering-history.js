/* ============================================================
   ReferenceSync — продолжение нумерации между импортами

   Хранит только последнюю успешно импортированную публикацию
   для каждой платформы. Полная библиотека Eagle не сканируется.
   ============================================================ */

const STORAGE_KEY = 'reference-sync.last-numbering.v1';

const COUNTER_STORAGE_KEY =
  'reference-sync.counter-numbering.v2';

const PERSISTENT_COUNTER_MODES =
  new Set([
    'global',
    'author',
  ]);

function storageOrNull(storage) {
  if (storage) return storage;

  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}

function normalizePlatform(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeNumber(value, fallback = 1) {
  const number = Math.trunc(Number(value));

  return Number.isInteger(number) && number > 0
    ? number
    : fallback;
}

function normalizeDestination(value) {
  const destination = String(value || '');

  return ['name', 'description', 'both'].includes(destination)
    ? destination
    : 'name';
}

function escapeRegExp(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
}

function uniqueItemIds(values) {
  return [...new Set(
    (values || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
}

export function numberingSettingsSnapshot(settings = {}) {
  return {
    platform: normalizePlatform(settings.platform),
    enabled: settings.numberingEnabled === true,
    destination: normalizeDestination(
      settings.numberingDestination,
    ),
    marker: String(settings.numberingMarker ?? ''),
    startNumber: normalizeNumber(
      settings.numberingStart,
    ),
  };
}

export function createNumberingRecord({
  settings,
  lastNumber,
  itemIds,
} = {}) {
  const snapshot = numberingSettingsSnapshot(settings);
  const normalizedLastNumber = normalizeNumber(
    lastNumber,
    0,
  );

  if (
    !snapshot.platform ||
    !snapshot.enabled ||
    normalizedLastNumber < 1
  ) {
    return null;
  }

  return {
    ...snapshot,
    lastNumber: normalizedLastNumber,
    itemIds: uniqueItemIds(itemIds),
  };
}

export function numberingSettingsMatch(
  record,
  settings,
) {
  if (!record) return false;

  const current = numberingSettingsSnapshot(settings);

  return Boolean(
    current.enabled &&
    record.enabled === true &&
    record.platform === current.platform &&
    record.destination === current.destination &&
    record.marker === current.marker &&
    record.startNumber === current.startNumber
  );
}

function parseNumberFromLine(
  line,
  marker,
  field,
) {
  const text = String(line || '').trim();
  if (!text) return null;

  let pattern;

  if (marker) {
    pattern = new RegExp(
      `${escapeRegExp(marker)}(\\d+)(?:-\\d+)?$`,
    );
  } else if (field === 'annotation') {
    pattern = /^(\d+)(?:-\d+)?$/;
  } else {
    pattern = /(?:^|\s)(\d+)(?:-\d+)?$/;
  }

  const match = text.match(pattern);
  if (!match) return null;

  const number = Number(match[1]);

  return Number.isInteger(number) && number > 0
    ? number
    : null;
}

function firstNonEmptyLine(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
}

export function extractPublicationNumber(
  item,
  {
    destination = 'name',
    marker = '',
  } = {},
) {
  if (!item || item.isDeleted === true) {
    return null;
  }

  const normalizedDestination =
    normalizeDestination(destination);

  const candidates = [];

  if (
    normalizedDestination === 'name' ||
    normalizedDestination === 'both'
  ) {
    candidates.push(
      parseNumberFromLine(
        item.name,
        String(marker ?? ''),
        'name',
      ),
    );
  }

  if (
    normalizedDestination === 'description' ||
    normalizedDestination === 'both'
  ) {
    candidates.push(
      parseNumberFromLine(
        firstNonEmptyLine(item.annotation),
        String(marker ?? ''),
        'annotation',
      ),
    );
  }

  const numbers = candidates.filter(
    (value) => Number.isInteger(value) && value > 0,
  );

  return numbers.length
    ? Math.max(...numbers)
    : null;
}

export function resolveContinuedStart({
  record,
  settings,
  items,
} = {}) {
  if (!numberingSettingsMatch(record, settings)) {
    return null;
  }

  const platform = normalizePlatform(record.platform);

  const numbers = (items || [])
    .filter((item) => {
        const tags = Array.isArray(item?.tags)
            ? item.tags
            : [];

        return tags.some(
            (tag) => normalizePlatform(tag) === platform,
        );
    })
     .map((item) => extractPublicationNumber(item, {
         destination: record.destination,
         marker: record.marker,
        }))
    .filter(
      (value) => Number.isInteger(value) && value > 0,
    );

  if (!numbers.length) {
    return null;
  }

  return Math.max(...numbers) + 1;
}

export function serializeNumberingRecords(records) {
  const platforms = {};

  for (const [platform, record] of records || []) {
    const key = normalizePlatform(platform);

    if (!key || !record) continue;

    platforms[key] = {
      platform: key,
      enabled: record.enabled === true,
      destination: normalizeDestination(
        record.destination,
      ),
      marker: String(record.marker ?? ''),
      startNumber: normalizeNumber(
        record.startNumber,
      ),
      lastNumber: normalizeNumber(
        record.lastNumber,
      ),
      itemIds: uniqueItemIds(record.itemIds),
    };
  }

  return JSON.stringify({
    version: 1,
    platforms,
  });
}

export function parseNumberingRecords(serialized) {
  try {
    const parsed = JSON.parse(
      String(serialized || ''),
    );

    if (
      parsed?.version !== 1 ||
      !parsed.platforms ||
      typeof parsed.platforms !== 'object'
    ) {
      return new Map();
    }

    const records = new Map();

    Object.entries(parsed.platforms).forEach(
      ([platform, record]) => {
        const key = normalizePlatform(platform);

        if (!key || !record) return;

        records.set(key, {
          platform: key,
          enabled: record.enabled === true,
          destination: normalizeDestination(
            record.destination,
          ),
          marker: String(record.marker ?? ''),
          startNumber: normalizeNumber(
            record.startNumber,
          ),
          lastNumber: normalizeNumber(
            record.lastNumber,
          ),
          itemIds: uniqueItemIds(record.itemIds),
        });
      },
    );

    return records;
  } catch (_) {
    return new Map();
  }
}

export function loadNumberingRecords(
  storage = null,
) {
  const target = storageOrNull(storage);
  if (!target) return new Map();

  try {
    return parseNumberingRecords(
      target.getItem(STORAGE_KEY),
    );
  } catch (_) {
    return new Map();
  }
}

export function saveNumberingRecords(
  records,
  storage = null,
) {
  const target = storageOrNull(storage);
  if (!target) return false;

  try {
    target.setItem(
      STORAGE_KEY,
      serializeNumberingRecords(records),
    );

    return true;
  } catch (_) {
    return false;
  }
}

function normalizeCounterId(value) {
  return String(value || '').trim();
}

function normalizeCounterMode(value) {
  const mode = String(value || '')
    .trim()
    .toLowerCase();

  return PERSISTENT_COUNTER_MODES.has(mode)
    ? mode
    : '';
}

function normalizeAuthor(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

function normalizeSeenPostIds(values) {
  return [...new Set(
    (values || [])
      .map((value) =>
        String(value || '').trim())
      .filter(Boolean),
  )];
}

function normalizeAuthorNumbers(values) {
  const result = {};

  if (!values || typeof values !== 'object') {
    return result;
  }

  Object.entries(values).forEach(
    ([authorValue, numberValue]) => {
      const author =
        normalizeAuthor(authorValue);

      const number =
        normalizeNumber(
          numberValue,
          0,
        );

      if (author && number > 0) {
        result[author] = number;
      }
    },
  );

  return result;
}

export function counterNumberingSeriesKey({
  platform,
  counterId,
  mode,
  start,
} = {}) {
  const normalizedPlatform =
    normalizePlatform(platform);

  const normalizedCounterId =
    normalizeCounterId(counterId);

  const normalizedMode =
    normalizeCounterMode(mode);

  const normalizedStart =
    normalizeNumber(start);

  if (
    !normalizedPlatform ||
    !normalizedCounterId ||
    !normalizedMode
  ) {
    return '';
  }

  return [
    normalizedPlatform,
    normalizedCounterId,
    normalizedMode,
    normalizedStart,
  ].join('::');
}

function normalizeCounterHistoryRecord(record) {
  if (!record) return null;

  const platform =
    normalizePlatform(record.platform);

  const counterId =
    normalizeCounterId(record.counterId);

  const mode =
    normalizeCounterMode(record.mode);

  const start =
    normalizeNumber(record.start);

  if (
    !platform ||
    !counterId ||
    !mode
  ) {
    return null;
  }

  const normalized = {
    platform,
    counterId,
    mode,
    start,
    seenPostIds:
      normalizeSeenPostIds(
        record.seenPostIds,
      ),
  };

  if (mode === 'global') {
    normalized.nextNumber =
      normalizeNumber(
        record.nextNumber,
        start,
      );
  }

  if (mode === 'author') {
    normalized.authors =
      normalizeAuthorNumbers(
        record.authors,
      );
  }

  return normalized;
}

export function serializeCounterHistoryRecords(
  records,
) {
  const series = {};

  for (
    const [recordKey, sourceRecord]
    of records || []
  ) {
    const record =
      normalizeCounterHistoryRecord(
        sourceRecord,
      );

    if (!record) continue;

    const key =
      counterNumberingSeriesKey(record);

    if (!key || key !== recordKey) {
      continue;
    }

    series[key] = record;
  }

  return JSON.stringify({
    version: 2,
    series,
  });
}

export function parseCounterHistoryRecords(
  serialized,
) {
  try {
    const parsed = JSON.parse(
      String(serialized || ''),
    );

    if (
      parsed?.version !== 2 ||
      !parsed.series ||
      typeof parsed.series !== 'object'
    ) {
      return new Map();
    }

    const records = new Map();

    Object.entries(parsed.series).forEach(
      ([storedKey, sourceRecord]) => {
        const record =
          normalizeCounterHistoryRecord(
            sourceRecord,
          );

        if (!record) return;

        const key =
          counterNumberingSeriesKey(
            record,
          );

        if (!key || key !== storedKey) {
          return;
        }

        records.set(key, record);
      },
    );

    return records;
  } catch (_) {
    return new Map();
  }
}

export function loadCounterHistoryRecords(
  storage = null,
) {
  const target = storageOrNull(storage);
  if (!target) return new Map();

  try {
    return parseCounterHistoryRecords(
      target.getItem(
        COUNTER_STORAGE_KEY,
      ),
    );
  } catch (_) {
    return new Map();
  }
}

export function saveCounterHistoryRecords(
  records,
  storage = null,
) {
  const target = storageOrNull(storage);
  if (!target) return false;

  try {
    target.setItem(
      COUNTER_STORAGE_KEY,
      serializeCounterHistoryRecords(
        records,
      ),
    );

    return true;
  } catch (_) {
    return false;
  }
}

export function counterHistorySeeds({
  records,
  platform,
  counters,
} = {}) {
  const seeds = {};

  for (const counter of counters || []) {
    const mode =
      normalizeCounterMode(
        counter?.mode,
      );

    if (!mode) continue;

    const key =
      counterNumberingSeriesKey({
        platform,
        counterId: counter.id,
        mode,
        start: counter.start,
      });

    const record =
      records?.get(key);

    if (!record) continue;

    if (mode === 'global') {
      seeds[counter.id] = {
        nextNumber:
          normalizeNumber(
            record.nextNumber,
            counter.start,
          ),
      };
    }

    if (mode === 'author') {
      seeds[counter.id] = {
        authors:
          normalizeAuthorNumbers(
            record.authors,
          ),
      };
    }
  }

  return seeds;
}

export function rememberCounterHistory({
  records,
  platform,
  counters,
  posts,
  generated,
  importedPostIds,
} = {}) {
  const updated = new Map(
    records || [],
  );

  const postsById = new Map(
    (posts || []).map(
      (post) => [
        String(post.postId),
        post,
      ],
    ),
  );

  const successfulPostIds =
    [...new Set(
      [...(importedPostIds || [])]
        .map((value) =>
          String(value || '').trim())
        .filter(Boolean),
    )];

  if (!successfulPostIds.length) {
    return updated;
  }

  for (const counter of counters || []) {
    const mode =
      normalizeCounterMode(
        counter?.mode,
      );

    if (!mode) continue;

    const start =
      normalizeNumber(counter.start);

    const key =
      counterNumberingSeriesKey({
        platform,
        counterId: counter.id,
        mode,
        start,
      });

    if (!key) continue;

    const existing =
      normalizeCounterHistoryRecord(
        updated.get(key),
      );

    const record = existing || {
      platform:
        normalizePlatform(platform),
      counterId:
        normalizeCounterId(
          counter.id,
        ),
      mode,
      start,
      seenPostIds: [],
      ...(mode === 'global'
        ? {
          nextNumber: start,
        }
        : {
          authors: {},
        }),
    };

    const seen = new Set(
      record.seenPostIds,
    );

    let changed = false;

    successfulPostIds.forEach(
      (postId) => {
        if (seen.has(postId)) {
          return;
        }

        const value = Number(
          generated
            ?.get(postId)
            ?.counterValues
            ?.[counter.id],
        );

        if (
          !Number.isInteger(value) ||
          value < 1
        ) {
          return;
        }

        if (mode === 'global') {
          record.nextNumber = Math.max(
            normalizeNumber(
              record.nextNumber,
              start,
            ),
            value + 1,
          );
        }

        if (mode === 'author') {
          const post =
            postsById.get(postId);

          const author =
            normalizeAuthor(
              post?.username,
            );

          if (!author) {
            return;
          }

          record.authors[author] =
            Math.max(
              normalizeNumber(
                record.authors[author],
                start,
              ),
              value + 1,
            );
        }

        seen.add(postId);
        changed = true;
      },
    );

    if (!changed && !existing) {
      continue;
    }

    record.seenPostIds = [...seen];
    updated.set(key, record);
  }

  return updated;
}
