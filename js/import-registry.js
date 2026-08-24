/* ============================================================
   ReferenceSync — реестр импортированных публикаций

   postId сохраняются отдельно от настроек. Публикация считается
   импортированной только после создания всех её элементов Eagle.
   ============================================================ */

const STORAGE_KEY = 'reference-sync.known-post-ids.v1';
const RECORDS_STORAGE_KEY =
  'reference-sync.import-records.v2';

function normalizePostId(value) {
  return String(value ?? '').trim();
}

function storageOrNull(storage) {
  if (storage) return storage;

  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}

export function parseKnownPostIds(serialized) {
  try {
    const parsed = JSON.parse(String(serialized || ''));

    if (!Array.isArray(parsed)) return new Set();

    return new Set(
      parsed
        .map(normalizePostId)
        .filter(Boolean),
    );
  } catch (_) {
    return new Set();
  }
}

export function serializeKnownPostIds(postIds) {
  const normalized = new Set();

  for (const value of postIds || []) {
    const postId = normalizePostId(value);
    if (postId) normalized.add(postId);
  }

  return JSON.stringify(
    [...normalized].sort((left, right) =>
      left.localeCompare(right)),
  );
}

export function loadKnownPostIds(storage = null) {
  const target = storageOrNull(storage);
  if (!target) return new Set();

  try {
    return parseKnownPostIds(target.getItem(STORAGE_KEY));
  } catch (_) {
    return new Set();
  }
}

export function saveKnownPostIds(postIds, storage = null) {
  const target = storageOrNull(storage);
  if (!target) return false;

  try {
    target.setItem(
      STORAGE_KEY,
      serializeKnownPostIds(postIds),
    );
    return true;
  } catch (_) {
    return false;
  }
}

export function fullyImportedPostIds(items, created) {
  const expectedByPost = new Map();

  for (const item of items || []) {
    const postId = normalizePostId(item?.postId);
    if (!postId) continue;

    const expected = expectedByPost.get(postId) || [];
    expected.push(item);
    expectedByPost.set(postId, expected);
  }

  const createdItems = new Set(
    (created || [])
      .filter((entry) => entry?.id && entry?.item)
      .map((entry) => entry.item),
  );

  const imported = new Set();

  expectedByPost.forEach((expectedItems, postId) => {
    if (
      expectedItems.length &&
      expectedItems.every((item) => createdItems.has(item))
    ) {
      imported.add(postId);
    }
  });

  return imported;
}

export function selectImportablePosts(
  posts,
  selectedPostIds,
  knownPostIds,
) {
  const selected = selectedPostIds || new Set();
  const known = knownPostIds || new Set();

  return (posts || []).filter((post) => {
    const postId = normalizePostId(post?.postId);

    return Boolean(
      postId &&
      selected.has(postId) &&
      !known.has(postId)
    );
  });
}

/* ------------------------------------------------------------
   Реестр версии 2: postId → компоненты публикации → Eagle ID
   ------------------------------------------------------------ */

export function serializeImportRecords(records) {
  const posts = [...(records || new Map()).entries()]
    .map(([postId, record]) => ({
      postId: String(postId),
      componentCount: Number(record?.componentCount) || 0,
      components: [...(record?.components || new Map()).entries()]
        .map(([component, eagleId]) => [
          String(component),
          String(eagleId),
        ])
        .sort(([left], [right]) => left.localeCompare(right)),
    }))
    .sort((left, right) =>
      left.postId.localeCompare(right.postId));

  return JSON.stringify({
    version: 2,
    posts,
  });
}

export function parseImportRecords(serialized) {
  try {
    const parsed = JSON.parse(String(serialized || ''));

    if (parsed?.version !== 2 || !Array.isArray(parsed.posts)) {
      return new Map();
    }

    const records = new Map();

    parsed.posts.forEach((post) => {
      const postId = String(post?.postId || '').trim();
      const componentCount = Number(post?.componentCount) || 0;

      if (!postId || componentCount < 1) return;

      const components = new Map();

      if (Array.isArray(post.components)) {
        post.components.forEach(([component, eagleId]) => {
          const key = String(component ?? '').trim();
          const id = String(eagleId ?? '').trim();

          if (key && id) components.set(key, id);
        });
      }

      records.set(postId, {
        componentCount,
        components,
      });
    });

    return records;
  } catch (_) {
    return new Map();
  }
}

export function reconcileImportRecords(records, eagleItems) {
  const existingIds = new Set(
    (eagleItems || [])
      .filter((item) => item?.id && item.isDeleted !== true)
      .map((item) => String(item.id)),
  );

  const reconciledRecords = new Map();
  const knownPostIds = new Set();
  const missingComponents = new Map();

  for (const [postId, record] of records || []) {
    const componentCount = Number(record?.componentCount) || 0;
    if (!postId || componentCount < 1) continue;

    const components = new Map();

    for (const [component, eagleId] of record.components || []) {
      if (existingIds.has(String(eagleId))) {
        components.set(String(component), String(eagleId));
      }
    }

    const missing = new Set();

    for (let index = 0; index < componentCount; index += 1) {
      const component = String(index);

      if (!components.has(component)) {
        missing.add(component);
      }
    }

    reconciledRecords.set(postId, {
      componentCount,
      components,
    });

    if (missing.size) {
      missingComponents.set(postId, missing);
    } else {
      knownPostIds.add(postId);
    }
  }

  return {
    records: reconciledRecords,
    knownPostIds,
    missingComponents,
  };
}

export function loadImportRecords(storage = null) {
  const target = storageOrNull(storage);
  if (!target) return new Map();

  try {
    return parseImportRecords(
      target.getItem(RECORDS_STORAGE_KEY),
    );
  } catch (_) {
    return new Map();
  }
}

export function saveImportRecords(records, storage = null) {
  const target = storageOrNull(storage);
  if (!target) return false;

  try {
    target.setItem(
      RECORDS_STORAGE_KEY,
      serializeImportRecords(records),
    );

    /* Старый реестр содержал только postId и не позволял
       проверить, существует ли соответствующий файл в Eagle. */
    target.removeItem(STORAGE_KEY);

    return true;
  } catch (_) {
    return false;
  }
}

export function recordCreatedEagleItems(records, created) {
  const updated = new Map();

  for (const [postId, record] of records || []) {
    updated.set(postId, {
      componentCount: record.componentCount,
      components: new Map(record.components),
    });
  }

  for (const entry of created || []) {
    const postId = String(entry?.item?.postId || '').trim();
    const eagleId = String(entry?.id || '').trim();

    if (!postId || !eagleId) continue;

    const component = String(
      entry.item.component ?? 0,
    );

    const requestedCount =
      Number(entry.item.componentCount) || 1;

    const existing = updated.get(postId);

    const record = existing || {
      componentCount: requestedCount,
      components: new Map(),
    };

    record.componentCount = Math.max(
      record.componentCount,
      requestedCount,
    );

    record.components.set(component, eagleId);
    updated.set(postId, record);
  }

  return updated;
}
