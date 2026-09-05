/* ============================================================
   ReferenceSync — дерево публикаций по коллекциям
   ============================================================ */

export const FALLBACK_COLLECTION_ID =
  '__reference_sync_without_collection__';

export const FALLBACK_COLLECTION_NAME =
  'Без коллекции';

function clean(value) {
  return String(value ?? '').trim();
}

export function normalizeCollectionKey(post) {
  return (
    clean(post?.collectionId) ||
    FALLBACK_COLLECTION_ID
  );
}

export function occurrenceIdOf(
  postId,
  collectionId,
) {
  return `${
    clean(collectionId) ||
    FALLBACK_COLLECTION_ID
  }:${clean(postId)}`;
}

function normalizedOccurrences(post) {
  const source =
    Array.isArray(post?.collectionOccurrences)
      ? post.collectionOccurrences
      : [];

  const fallback = {
    collectionId:
      normalizeCollectionKey(post),

    collectionName:
      clean(post?.collectionName) ||
      FALLBACK_COLLECTION_NAME,

    isDuplicate: false,
  };

  const input =
    source.length > 0
      ? source
      : [fallback];

  const result = [];
  const seenCollections = new Set();

  for (const item of input) {
    const collectionId =
      clean(item?.collectionId) ||
      fallback.collectionId;

    if (
      !collectionId ||
      seenCollections.has(collectionId)
    ) {
      continue;
    }

    seenCollections.add(collectionId);

    result.push({
      occurrenceId:
        clean(item?.occurrenceId) ||
        occurrenceIdOf(
          post?.postId,
          collectionId,
        ),

      collectionId,

      collectionName:
        clean(item?.collectionName) ||
        fallback.collectionName,

      isDuplicate:
        item?.isDuplicate === true,
    });
  }

  return result;
}

export function preferredOccurrence(post) {
  const occurrences =
    normalizedOccurrences(post);

  /*
   * Оригинал — строка общей папки.
   * По умолчанию выбирается первая копия после него.
   */
  return (
    occurrences.find(
      (occurrence) =>
        occurrence.isDuplicate,
    ) ||
    occurrences[0] ||
    null
  );
}

export function groupPostsByCollection(
  posts,
  selectedCollections = [],
  folderMode = false,
) {
  const sourcePosts =
    Array.isArray(posts)
      ? posts
      : [];

  if (!folderMode) {
    return [{
      id: '',
      name: '',
      posts: [...sourcePosts],
      flat: true,
    }];
  }

  const collections =
    Array.isArray(selectedCollections)
      ? selectedCollections
      : [];

  const allowedIds = new Set(
    collections
      .map((collection) =>
        clean(collection?.id))
      .filter(Boolean),
  );

  const groupsById = new Map();
  const groups = [];

  function ensureGroup(id, name) {
    const collectionId =
      clean(id) ||
      FALLBACK_COLLECTION_ID;

    const existing =
      groupsById.get(collectionId);

    if (existing) {
      return existing;
    }

    const group = {
      id: collectionId,

      name:
        clean(name) ||
        (
          collectionId ===
          FALLBACK_COLLECTION_ID
            ? FALLBACK_COLLECTION_NAME
            : collectionId
        ),

      posts: [],
      rowIds: new Set(),
      flat: false,
    };

    groupsById.set(
      collectionId,
      group,
    );

    groups.push(group);

    return group;
  }

  /*
   * Порядок папок совпадает с порядком выбора.
   */
  for (const collection of collections) {
    const collectionId =
      clean(collection?.id);

    if (!collectionId) {
      continue;
    }

    ensureGroup(
      collectionId,
      collection?.name,
    );
  }

  for (const post of sourcePosts) {
    for (
      const occurrence of
      normalizedOccurrences(post)
    ) {
      if (
        allowedIds.size > 0 &&
        !allowedIds.has(
          occurrence.collectionId,
        )
      ) {
        continue;
      }

      const group = ensureGroup(
        occurrence.collectionId,
        occurrence.collectionName,
      );

      if (
        group.rowIds.has(
          occurrence.occurrenceId,
        )
      ) {
        continue;
      }

      group.rowIds.add(
        occurrence.occurrenceId,
      );

      /*
       * Это отдельная строка таблицы,
       * но sourcePost остаётся общей публикацией.
       */
      group.posts.push({
        ...post,

        rowId:
          occurrence.occurrenceId,

        occurrenceId:
          occurrence.occurrenceId,

        collectionId:
          occurrence.collectionId,

        collectionName:
          occurrence.collectionName,

        isDuplicateOccurrence:
          occurrence.isDuplicate,

        sourcePost:
          post,
      });
    }
  }

  return groups
    .filter(
      (group) =>
        group.posts.length > 0,
    )
    .map((group) => {
      const {
        rowIds,
        ...result
      } = group;

      return result;
    });
}

export function rowIsSelected(
  row,
  selectedPostIds,
  selectedRows,
) {
  const selected =
    selectedPostIds instanceof Set
      ? selectedPostIds
      : new Set(selectedPostIds || []);

  const rows =
    selectedRows instanceof Map
      ? selectedRows
      : new Map();

  if (!selected.has(row?.postId)) {
    return false;
  }

  if (!row?.rowId) {
    return true;
  }

  return (
    rows.get(row.postId) ===
    row.rowId
  );
}

export function initializeSelectedRows(
  posts,
  selectedPostIds,
  selectedRows,
) {
  const selected =
    selectedPostIds instanceof Set
      ? selectedPostIds
      : new Set(selectedPostIds || []);

  const result =
    selectedRows instanceof Map
      ? new Map(selectedRows)
      : new Map();

  for (
    const post of
    Array.isArray(posts) ? posts : []
  ) {
    if (!selected.has(post.postId)) {
      result.delete(post.postId);
      continue;
    }

    if (result.has(post.postId)) {
      continue;
    }

    const occurrence =
      preferredOccurrence(post);

    if (occurrence) {
      result.set(
        post.postId,
        occurrence.occurrenceId,
      );
    }
  }

  return result;
}

export function setSelectedRow(
  row,
  checked,
  selectedPostIds,
  selectedRows,
) {
  const selected =
    selectedPostIds instanceof Set
      ? new Set(selectedPostIds)
      : new Set(selectedPostIds || []);

  const rows =
    selectedRows instanceof Map
      ? new Map(selectedRows)
      : new Map();

  const postId =
    clean(row?.postId);

  const rowId =
    clean(row?.rowId);

  if (!postId) {
    return {
      selected,
      selectedRows: rows,
    };
  }

  if (checked) {
    selected.add(postId);

    if (rowId) {
      /*
       * Сценарий A:
       * новое вхождение заменяет старое.
       */
      rows.set(postId, rowId);
    }
  } else if (
    !rowId ||
    rows.get(postId) === rowId
  ) {
    selected.delete(postId);
    rows.delete(postId);
  }

  return {
    selected,
    selectedRows: rows,
  };
}

export function collectionSelectionState(
  posts,
  selectedPostIds,
  selectedRows = new Map(),
  selectablePredicate = () => true,
) {
  const rows = (
    Array.isArray(posts)
      ? posts
      : []
  ).filter(selectablePredicate);

  let selectedCount = 0;

  for (const row of rows) {
    if (
      rowIsSelected(
        row,
        selectedPostIds,
        selectedRows,
      )
    ) {
      selectedCount += 1;
    }
  }

  return {
    total:
      rows.length,

    selectedCount,

    checked:
      rows.length > 0 &&
      selectedCount === rows.length,

    mixed:
      selectedCount > 0 &&
      selectedCount < rows.length,

    disabled:
      rows.length === 0,
  };
}

export function collectionSelectionChanges(
  posts,
  selectedPostIds,
  selectedRows = new Map(),
  selectablePredicate = () => true,
) {
  const selected =
    selectedPostIds instanceof Set
      ? selectedPostIds
      : new Set(selectedPostIds || []);

  const rowsMap =
    selectedRows instanceof Map
      ? selectedRows
      : new Map();

  const rows = (
    Array.isArray(posts)
      ? posts
      : []
  ).filter(selectablePredicate);

  const state =
    collectionSelectionState(
      rows,
      selected,
      rowsMap,
      () => true,
    );

  if (!state.checked) {
    /*
     * Сценарий B:
     * выбираем только ещё не выбранные postId.
     * Выбор из другой папки не переносим.
     */
    return rows
      .filter(
        (row) =>
          !selected.has(row.postId),
      )
      .map((row) => ({
        postId:
          row.postId,

        rowId:
          row.rowId,

        collectionId:
          row.collectionId,

        collectionName:
          row.collectionName,

        checked: true,
      }));
  }

  /*
   * При снятии checkbox папки снимаются только
   * строки, выбранные именно в этой папке.
   */
  return rows
    .filter(
      (row) =>
        rowIsSelected(
          row,
          selected,
          rowsMap,
        ),
    )
    .map((row) => ({
      postId:
        row.postId,

      rowId:
        row.rowId,

      collectionId:
        row.collectionId,

      collectionName:
        row.collectionName,

      checked: false,
    }));
}
