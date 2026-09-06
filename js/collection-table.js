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
      clean(post?.collectionName) || FALLBACK_COLLECTION_NAME,
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
        clean(item?.collectionName) || fallback.collectionName,
      isDuplicate: item?.isDuplicate === true,
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
  const sourcePosts = Array.isArray(posts) ? posts : [];

  if (!folderMode) {
    return [{
      id: '',
      name: '',
      posts: [...sourcePosts],
      flat: true,
    }];
  }

  const collections = Array.isArray(selectedCollections)
    ? selectedCollections
    : [];

  const allowedIds = new Set(
    collections
      .map((collection) => clean(collection?.id))
      .filter(Boolean),
  );

  const groupsById = new Map();
  const groups = [];

  function ensureGroup(id, name) {
    const collectionId = clean(id) || FALLBACK_COLLECTION_ID;
    const existing = groupsById.get(collectionId);

    if (existing) {
      return existing;
    }

    const group = {
      id: collectionId,
      name:
        clean(name) ||
        (collectionId === FALLBACK_COLLECTION_ID
          ? FALLBACK_COLLECTION_NAME
          : collectionId),
      posts: [],
      postIds: new Set(),
      flat: false,
    };

    groupsById.set(collectionId, group);
    groups.push(group);
    return group;
  }

  /* Порядок папок совпадает с порядком их выбора пользователем. */
  for (const collection of collections) {
    const collectionId = clean(collection?.id);
    if (collectionId) {
      ensureGroup(collectionId, collection?.name);
    }
  }

  for (const post of sourcePosts) {
    for (const occurrence of normalizedOccurrences(post)) {
      if (
        allowedIds.size > 0 &&
        !allowedIds.has(occurrence.collectionId)
      ) {
        continue;
      }

      const group = ensureGroup(
        occurrence.collectionId,
        occurrence.collectionName,
      );

      /* Внутри одной папки публикация показывается одной строкой. */
      if (group.postIds.has(clean(post?.postId))) {
        continue;
      }

      group.postIds.add(clean(post?.postId));

      /*
       * В группу кладётся ТОТ ЖЕ объект post (важно: выбор,
       * карусель и правки остаются общими для всех папок).
       * Активные occurrenceId/collectionId для конкретной строки
       * main.js читает из dataset, проставляя их перед рендером.
       */
      group.posts.push(post);
    }
  }

  return groups
    .filter((group) => group.posts.length > 0)
    .map((group) => {
      const { postIds, ...result } = group;
      return result;
    });
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
