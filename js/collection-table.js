/* ============================================================
   ReferenceSync — дерево публикаций по коллекциям (occurrence-модель)

   Модель: одна публикация (postId) выбирается один раз, но
   отображается строкой в каждой папке, где она сохранена.
   Выбранное "вхождение" (occurrenceId) задаёт папку-назначение.

   state.selected            — Set(postId) выбранных публикаций;
   state.selectedOccurrences — Map(postId → occurrenceId) активной папки.
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

export function occurrenceIdOf(postId, collectionId) {
  return `${
    clean(collectionId) || FALLBACK_COLLECTION_ID
  }:${clean(postId)}`;
}

/*
 * Вхождения публикации в папки. discoverSaved (instagram.js)
 * заполняет post.collectionOccurrences. Для старых результатов
 * синтезируем единственное вхождение из collectionId.
 */
function normalizedOccurrences(post) {
  const source =
    Array.isArray(post?.collectionOccurrences)
      ? post.collectionOccurrences
      : [];

  const fallback = {
    collectionId: normalizeCollectionKey(post),

    collectionName:
      clean(post?.collectionName) ||
      FALLBACK_COLLECTION_NAME,

    collectionType:
      clean(post?.collectionType),

    parentId:
      clean(post?.collectionParentId),

    parentName:
      clean(post?.collectionParentName),

    isDuplicate: false,
  };

  const input = source.length > 0 ? source : [fallback];

  const result = [];
  const seenCollections = new Set();

  for (const item of input) {
    const collectionId =
      clean(item?.collectionId) || fallback.collectionId;

    if (!collectionId || seenCollections.has(collectionId)) {
      continue;
    }

    seenCollections.add(collectionId);

    result.push({
      occurrenceId:
        clean(item?.occurrenceId) ||
        occurrenceIdOf(post?.postId, collectionId),

      collectionId,

      collectionName:
        clean(item?.collectionName) ||
        fallback.collectionName,

      collectionType:
        clean(item?.collectionType) ||
        fallback.collectionType,

      parentId:
        clean(item?.parentId) ||
        fallback.parentId,

      parentName:
        clean(item?.parentName) ||
        fallback.parentName,

      isDuplicate:
        item?.isDuplicate === true,
    });
  }

  return result;
}

/*
 * Вхождение по умолчанию: первая копия после оригинала
 * (первый isDuplicate === true), иначе первое вхождение.
 * Это папка, в которую пойдёт импорт, пока пользователь
 * не выбрал вручную другую строку той же публикации.
 */
export function preferredOccurrence(post) {
  const occurrences = normalizedOccurrences(post);

  return (
    occurrences.find((occurrence) => occurrence.isDuplicate) ||
    occurrences[0] ||
    null
  );
}

/*
 * occurrenceId для строки дерева. main.js кладёт активный
 * occurrenceId на сам объект post перед рендером группы,
 * поэтому сначала читаем его, затем — вхождение по умолчанию.
 */
export function occurrenceIdForRow(row) {
  return (
    clean(row?.occurrenceId) ||
    preferredOccurrence(row)?.occurrenceId ||
    occurrenceIdOf(row?.postId, normalizeCollectionKey(row))
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
      children: [],
      flat: true,
    }];
  }

  const collections =
    Array.isArray(selectedCollections)
      ? selectedCollections
      : [];

  const allowedIds =
    new Set(
      collections
        .map((collection) =>
          clean(collection?.id))
        .filter(Boolean),
    );

  const groupsById = new Map();
  const groups = [];

  function ensureGroup(
    id,
    name,
    {
      type = '',
      parentId = '',
      parentName = '',
    } = {},
  ) {
    const collectionId =
      clean(id) ||
      FALLBACK_COLLECTION_ID;

    const existing =
      groupsById.get(collectionId);

    if (existing) {
      if (!existing.type) {
        existing.type =
          clean(type);
      }

      if (!existing.parentId) {
        existing.parentId =
          clean(parentId);
      }

      if (!existing.parentName) {
        existing.parentName =
          clean(parentName);
      }

      return existing;
    }

    const group = {
      id:
        collectionId,

      name:
        clean(name) ||
        (
          collectionId ===
          FALLBACK_COLLECTION_ID
            ? FALLBACK_COLLECTION_NAME
            : collectionId
        ),

      type:
        clean(type),

      parentId:
        clean(parentId),

      parentName:
        clean(parentName),

      posts: [],
      postIds: new Set(),
      children: [],
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
   * Сначала создаём все выбранные контейнеры.
   * Это важно для пустой родительской доски:
   * у неё могут отсутствовать прямые публикации,
   * но внутри могут находиться разделы.
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
      {
        type:
          collection?.type,

        parentId:
          collection?.parentId,

        parentName:
          collection?.parentName,
      },
    );
  }

  /*
   * Раскладываем публикации по всем их вхождениям.
   */
  for (const post of sourcePosts) {
    const postId =
      clean(post?.postId);

    for (
      const occurrence
      of normalizedOccurrences(post)
    ) {
      if (
        allowedIds.size > 0 &&
        !allowedIds.has(
          occurrence.collectionId,
        )
      ) {
        continue;
      }

      const group =
        ensureGroup(
          occurrence.collectionId,
          occurrence.collectionName,
          {
            type:
              occurrence.collectionType,

            parentId:
              occurrence.parentId,

            parentName:
              occurrence.parentName,
          },
        );

      /*
       * Если в selectedCollections не было родителя,
       * но SECTION содержит parentId, создаём технический
       * родительский узел для правильного отображения дерева.
       */
      if (
        group.parentId &&
        !groupsById.has(group.parentId)
      ) {
        ensureGroup(
          group.parentId,
          group.parentName,
          {
            type: 'BOARD',
          },
        );
      }

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
       * Сохраняется тот же объект post:
       * выбор, редактирование и карусель общие
       * для всех папочных представлений.
       */
      group.posts.push(post);
    }
  }

  /*
   * Соединяем SECTION с его BOARD.
   */
  const childGroupIds = new Set();

  for (const group of groups) {
    if (
      !group.parentId ||
      group.parentId === group.id
    ) {
      continue;
    }

    const parent =
      groupsById.get(group.parentId);

    if (!parent) {
      continue;
    }

    if (
      !parent.children.some(
        (child) =>
          child.id === group.id,
      )
    ) {
      parent.children.push(group);
    }

    childGroupIds.add(group.id);
  }

  const roots =
    groups.filter(
      (group) =>
        !childGroupIds.has(group.id),
    );

  /*
   * Пин, найденный и через BOARD, и через SECTION,
   * должен отображаться только внутри SECTION.
   *
   * Поэтому убираем из прямого списка родителя все
   * публикации, присутствующие в дочерних ветках.
   */
  function removeNestedPosts(group) {
    for (const child of group.children) {
      removeNestedPosts(child);
    }

    const nestedPostIds =
      new Set();

    function collectChildPostIds(child) {
      for (const post of child.posts) {
        const postId =
          clean(post?.postId);

        if (postId) {
          nestedPostIds.add(postId);
        }
      }

      for (const nested of child.children) {
        collectChildPostIds(nested);
      }
    }

    for (const child of group.children) {
      collectChildPostIds(child);
    }

    if (nestedPostIds.size) {
      group.posts =
        group.posts.filter(
          (post) =>
            !nestedPostIds.has(
              clean(post?.postId),
            ),
        );
    }
  }

  for (const root of roots) {
    removeNestedPosts(root);
  }

  /*
   * Удаляем пустые ветки и внутренние Set перед возвратом.
   */
  function finalize(group) {
    const children =
      group.children
        .map(finalize)
        .filter(Boolean);

    if (
      group.posts.length === 0 &&
      children.length === 0
    ) {
      return null;
    }

    const {
      postIds,
      ...result
    } = group;

    return {
      ...result,
      children,
    };
  }

  return roots
    .map(finalize)
    .filter(Boolean);
}

/* ------------------------------------------------------------
   Выбор вхождений
   ------------------------------------------------------------ */

/*
 * Проставляет вхождение по умолчанию каждой выбранной публикации,
 * сохраняя ранее сделанный вручную выбор. Возвращает НОВЫЙ
 * Map(postId → occurrenceId); записи снятых постов удаляются.
 */
export function ensureDefaultOccurrences(
  posts,
  selectedPostIds,
  selectedOccurrences,
) {
  const selected =
    selectedPostIds instanceof Set
      ? selectedPostIds
      : new Set(selectedPostIds || []);

  const previous =
    selectedOccurrences instanceof Map
      ? selectedOccurrences
      : new Map();

  const next = new Map();

  for (const post of Array.isArray(posts) ? posts : []) {
    if (!selected.has(post?.postId)) {
      continue;
    }

    const occurrences = normalizedOccurrences(post);
    const existing = previous.get(post.postId);

    const stillValid =
      existing &&
      occurrences.some(
        (occurrence) => occurrence.occurrenceId === existing,
      );

    next.set(
      post.postId,
      stillValid
        ? existing
        : preferredOccurrence(post)?.occurrenceId || '',
    );
  }

  return next;
}

/*
 * Выбран ли именно этот ряд: публикация выбрана И её активное
 * вхождение совпадает с occurrenceId ряда. Если вхождение для
 * поста ещё не зафиксировано, активным считается вхождение
 * по умолчанию.
 */
export function occurrenceSelected(
  row,
  selectedPostIds,
  selectedOccurrences,
) {
  const selected =
    selectedPostIds instanceof Set
      ? selectedPostIds
      : new Set(selectedPostIds || []);

  if (!selected.has(row?.postId)) {
    return false;
  }

  const previous =
    selectedOccurrences instanceof Map
      ? selectedOccurrences
      : new Map();

  const active =
    previous.get(row.postId) ||
    preferredOccurrence(row)?.occurrenceId ||
    '';

  const rowOccurrenceId =
    clean(row?.occurrenceId) ||
    preferredOccurrence(row)?.occurrenceId ||
    '';

  return Boolean(active) && active === rowOccurrenceId;
}

/*
 * Переключает выбор ряда. Возвращает НОВЫЕ
 * { selectedPostIds: Set, selectedOccurrences: Map }.
 *
 * Сценарий A: выбор другой строки той же публикации переносит
 * папку-назначение, не создавая второй выбор.
 */
export function selectOccurrence({
  row,
  selectedPostIds,
  selectedOccurrences,
  selected,
}) {
  const nextSelectedPostIds = new Set(
    selectedPostIds instanceof Set
      ? selectedPostIds
      : selectedPostIds || [],
  );

  const nextSelectedOccurrences = new Map(
    selectedOccurrences instanceof Map
      ? selectedOccurrences
      : selectedOccurrences || [],
  );

  const postId = clean(row?.postId);
  const occurrenceId =
    clean(row?.occurrenceId) ||
    preferredOccurrence(row)?.occurrenceId ||
    '';

  if (!postId || !occurrenceId) {
    return {
      selectedPostIds: nextSelectedPostIds,
      selectedOccurrences: nextSelectedOccurrences,
    };
  }

  if (selected) {
    nextSelectedPostIds.add(postId);
    nextSelectedOccurrences.set(postId, occurrenceId);
  } else {
    const active = nextSelectedOccurrences.get(postId);
    /* Снятие срабатывает только для активной строки публикации. */
    if (active === undefined || active === occurrenceId) {
      nextSelectedPostIds.delete(postId);
      nextSelectedOccurrences.delete(postId);
    }
  }

  return {
    selectedPostIds: nextSelectedPostIds,
    selectedOccurrences: nextSelectedOccurrences,
  };
}

/* ------------------------------------------------------------
   Состояние checkbox папки
   ------------------------------------------------------------ */

function selectableRows(rows, selectablePredicate) {
  const predicate =
    typeof selectablePredicate === 'function'
      ? selectablePredicate
      : () => true;

  return (Array.isArray(rows) ? rows : []).filter((row) =>
    predicate(row),
  );
}

/*
 * Состояние галочки папки. Если передан selectedOccurrences —
 * считаем по активным вхождениям (occurrenceSelected); если он
 * опущен (простой кейс/плоский список) — считаем по postId.
 */
export function collectionSelectionState(
  rows,
  selectedPostIds,
  selectedOccurrences,
  selectablePredicate = () => true,
) {
  const predicate =
    typeof selectedOccurrences === 'function'
      ? selectedOccurrences
      : selectablePredicate;

  const occurrences =
    selectedOccurrences instanceof Map ? selectedOccurrences : null;

  const usable = selectableRows(rows, predicate);

  const selected =
    selectedPostIds instanceof Set
      ? selectedPostIds
      : new Set(selectedPostIds || []);

  let selectedCount = 0;

  for (const row of usable) {
    const isSelected = occurrences
      ? occurrenceSelected(row, selected, occurrences)
      : selected.has(row?.postId);

    if (isSelected) {
      selectedCount += 1;
    }
  }

  const total = usable.length;

  return {
    total,
    selectedCount,
    checked: total > 0 && selectedCount === total,
    mixed: selectedCount > 0 && selectedCount < total,
    disabled: total === 0,
  };
}

/*
 * Изменения для клика по галочке папки.
 * Сценарий B: если папка выбрана не полностью — выбираем только
 * ещё не выбранные publikacii (уже выбранные в другой папке не
 * трогаем). Если выбрана полностью — снимаем её активные строки.
 * Возвращает список { postId, before, after } с occurrenceId.
 */
export function collectionSelectionChanges(
  rows,
  selectedPostIds,
  selectedOccurrences,
  selectablePredicate = () => true,
) {
  const predicate =
    typeof selectedOccurrences === 'function'
      ? selectedOccurrences
      : selectablePredicate;

  const occurrences =
    selectedOccurrences instanceof Map ? selectedOccurrences : new Map();

  const selected =
    selectedPostIds instanceof Set
      ? selectedPostIds
      : new Set(selectedPostIds || []);

  const usableAll = selectableRows(rows, predicate);

  /* Внутри одной папки на postId — одна строка. */
  const usable = [];
  const seen = new Set();
  for (const row of usableAll) {
    const postId = clean(row?.postId);
    if (postId && seen.has(postId)) {
      continue;
    }
    if (postId) {
      seen.add(postId);
    }
    usable.push(row);
  }

  const state = collectionSelectionState(
    usable,
    selected,
    occurrences,
    () => true,
  );

  const changes = [];

  if (!state.checked) {
    /* Сценарий B: выбираем только ещё не выбранные postId. */
    for (const row of usable) {
      if (selected.has(row?.postId)) {
        continue;
      }

      changes.push({
        postId: row.postId,
        before: {
          selected: false,
          occurrenceId: occurrences.get(row.postId) || null,
        },
        after: {
          selected: true,
          occurrenceId: occurrenceIdForRow(row),
        },
      });
    }

    return changes;
  }

  /* Снимаем только строки, выбранные именно в этой папке. */
  for (const row of usable) {
    if (!occurrenceSelected(row, selected, occurrences)) {
      continue;
    }

    changes.push({
      postId: row.postId,
      before: {
        selected: true,
        occurrenceId: occurrences.get(row.postId) || null,
      },
      after: {
        selected: false,
        occurrenceId: null,
      },
    });
  }

  return changes;
}
