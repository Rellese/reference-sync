/* ============================================================
   ReferenceSync — представление результатов по коллекциям

   Модуль не выполняет сетевых запросов и не изменяет state.
   Он только группирует уже найденные публикации и вычисляет
   состояние checkbox коллекции.
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

function selectedCollectionEntries(
  selectedCollections,
) {
  return Array.isArray(selectedCollections)
    ? selectedCollections
    : [];
}

function postCollectionOccurrences(post) {
  const occurrences =
    Array.isArray(post?.collectionOccurrences)
      ? post.collectionOccurrences
      : [];

  if (occurrences.length > 0) {
    return occurrences
      .map((occurrence) => ({
        collectionId:
          clean(occurrence?.collectionId),

        collectionName:
          clean(occurrence?.collectionName),
      }))
      .filter(
        (occurrence) =>
          Boolean(occurrence.collectionId),
      );
  }

  /*
   * Совместимость со старыми результатами,
   * где collectionOccurrences ещё отсутствует.
   */
  return [{
    collectionId:
      normalizeCollectionKey(post),

    collectionName:
      clean(post?.collectionName) ||
      FALLBACK_COLLECTION_NAME,
  }];
}

function uniqueSelectablePosts(
  posts,
  selectablePredicate,
) {
  const result = [];
  const seenPostIds = new Set();

  for (
    const post of
    Array.isArray(posts) ? posts : []
  ) {
    if (!selectablePredicate(post)) {
      continue;
    }

    const postId =
      clean(post?.postId);

    if (
      postId &&
      seenPostIds.has(postId)
    ) {
      continue;
    }

    if (postId) {
      seenPostIds.add(postId);
    }

    result.push(post);
  }

  return result;
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

  const selectedEntries =
    selectedCollectionEntries(
      selectedCollections,
    );

  const selectedIds = new Set(
    selectedEntries
      .map((collection) =>
        clean(collection?.id))
      .filter(Boolean),
  );

  const groupsById = new Map();
  const orderedGroups = [];

  const ensureGroup = (
    id,
    name,
  ) => {
    const normalizedId =
      clean(id) ||
      FALLBACK_COLLECTION_ID;

    const existing =
      groupsById.get(normalizedId);

    if (existing) {
      const normalizedName =
        clean(name);

      if (
        existing.name ===
          FALLBACK_COLLECTION_NAME &&
        normalizedName
      ) {
        existing.name =
          normalizedName;
      }

      return existing;
    }

    const group = {
      id: normalizedId,

      name:
        clean(name) ||
        (
          normalizedId ===
          FALLBACK_COLLECTION_ID
            ? FALLBACK_COLLECTION_NAME
            : normalizedId
        ),

      posts: [],
      postIds: new Set(),
      flat: false,
    };

    groupsById.set(
      normalizedId,
      group,
    );

    orderedGroups.push(group);

    return group;
  };

  /*
   * Сначала создаём группы в порядке,
   * в котором пользователь выбрал папки.
   */
  for (const collection of selectedEntries) {
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
    const occurrences =
      postCollectionOccurrences(post);

    for (const occurrence of occurrences) {
      const collectionId =
        occurrence.collectionId ||
        FALLBACK_COLLECTION_ID;

      /*
       * Если пользователь выбрал конкретные папки,
       * в таблицу не должны попадать другие папки.
       */
      if (
        selectedIds.size > 0 &&
        !selectedIds.has(collectionId)
      ) {
        continue;
      }

      const group = ensureGroup(
        collectionId,
        occurrence.collectionName,
      );

      const postId =
        clean(post?.postId);

      /*
       * Публикация может появляться в разных папках,
       * но внутри одной папки строка должна быть одна.
       */
      if (
        postId &&
        group.postIds.has(postId)
      ) {
        continue;
      }

      if (postId) {
        group.postIds.add(postId);
      }

      /*
       * В папки помещается один и тот же объект post.
       * Поэтому checkbox синхронизирован во всех строках.
       */
      group.posts.push(post);
    }
  }

  return orderedGroups
    .filter(
      (group) =>
        group.posts.length > 0,
    )
    .map((group) => {
      const {
        postIds,
        ...publicGroup
      } = group;

      return publicGroup;
    });
}

export function collectionSelectionState(
  posts,
  selectedPostIds,
  selectablePredicate = () => true,
) {
  const selected =
    selectedPostIds instanceof Set
      ? selectedPostIds
      : new Set(
        Array.isArray(selectedPostIds)
          ? selectedPostIds
          : [],
      );

  /*
   * Одна публикация может присутствовать
   * в нескольких папках. Для состояния checkbox
   * считаем каждый postId только один раз.
   */
  const selectablePosts =
    uniqueSelectablePosts(
      posts,
      selectablePredicate,
    );

  const selectedCount =
    selectablePosts.reduce(
      (total, post) =>
        total +
        (
          selected.has(post.postId)
            ? 1
            : 0
        ),
      0,
    );

  const total =
    selectablePosts.length;

  return {
    total,
    selectedCount,

    checked:
      total > 0 &&
      selectedCount === total,

    mixed:
      selectedCount > 0 &&
      selectedCount < total,

    disabled:
      total === 0,
  };
}

export function collectionSelectionChanges(
  posts,
  selectedPostIds,
  selectablePredicate = () => true,
) {
  const selected =
    selectedPostIds instanceof Set
      ? selectedPostIds
      : new Set(
        Array.isArray(selectedPostIds)
          ? selectedPostIds
          : [],
      );

  const selectablePosts =
    uniqueSelectablePosts(
      posts,
      selectablePredicate,
    );

  const selection =
    collectionSelectionState(
      selectablePosts,
      selected,
      () => true,
    );

  /*
   * Если выбраны все — снимаем выбор.
   * Если выбрана часть или ничего — выбираем всё.
   */
  const nextSelected =
    !selection.checked;

  return selectablePosts
    .filter(
      (post) =>
        selected.has(post.postId) !==
        nextSelected,
    )
    .map((post) => ({
      postId: post.postId,

      before: {
        selected:
          selected.has(post.postId),

        components:
          Array.isArray(
            post.selectedComponents,
          )
            ? [
              ...post.selectedComponents,
            ]
            : undefined,
      },

      after: {
        selected:
          nextSelected,

        components:
          Array.isArray(
            post.selectedComponents,
          )
            ? [
              ...post.selectedComponents,
            ]
            : undefined,
      },
    }));
}
