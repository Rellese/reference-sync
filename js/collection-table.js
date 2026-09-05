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
      if (
        existing.name ===
          FALLBACK_COLLECTION_NAME &&
        clean(name)
      ) {
        existing.name = clean(name);
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
   * Сначала создаём группы в том порядке, в котором
   * пользователь выбрал коллекции.
   */
  for (
    const collection of
      selectedCollectionEntries(
        selectedCollections,
      )
  ) {
    const id =
      clean(collection?.id);

    if (!id) continue;

    ensureGroup(
      id,
      collection?.name,
    );
  }

  /*
   * Одна публикация должна появиться в таблице только один раз,
   * даже если повреждённые/старые данные содержат дубликаты.
   */
  const renderedPostIds = new Set();

  for (const post of sourcePosts) {
    const postId =
      clean(post?.postId);

    if (
      postId &&
      renderedPostIds.has(postId)
    ) {
      continue;
    }

    if (postId) {
      renderedPostIds.add(postId);
    }

    const collectionId =
      normalizeCollectionKey(post);

    const group =
      ensureGroup(
        collectionId,
        post?.collectionName,
      );

    group.posts.push(post);
  }

  /*
   * Пустые выбранные коллекции не нужны в таблице результатов:
   * пользователь видит только папки, где что-то было найдено.
   */
  return orderedGroups.filter(
    (group) =>
      group.posts.length > 0,
  );
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

  const selectablePosts =
    (Array.isArray(posts) ? posts : [])
      .filter((post) =>
        selectablePredicate(post));

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
    (Array.isArray(posts) ? posts : [])
      .filter((post) =>
        selectablePredicate(post));

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
    .filter((post) =>
      selected.has(post.postId) !==
        nextSelected)
    .map((post) => ({
      postId: post.postId,

      before: {
        selected:
          selected.has(post.postId),

        components:
          Array.isArray(
            post.selectedComponents,
          )
            ? [...post.selectedComponents]
            : undefined,
      },

      after: {
        selected:
          nextSelected,

        components:
          Array.isArray(
            post.selectedComponents,
          )
            ? [...post.selectedComponents]
            : undefined,
      },
    }));
}
