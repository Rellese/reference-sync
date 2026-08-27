/* ============================================================
   ReferenceSync — продолжение нумерации между импортами

   Хранит только последнюю успешно импортированную публикацию
   для каждой платформы. Полная библиотека Eagle не сканируется.
   ============================================================ */

const STORAGE_KEY = 'reference-sync.last-numbering.v1';

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

  const numbers = (items || [])
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
