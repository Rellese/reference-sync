/* ============================================================
   ReferenceSync — маршрутизация публикаций по папкам Eagle

   Обычный поиск:
     файл → папка социальной сети.

   Поиск по папкам:
     Instagram:
       папка социальной сети + выбранная коллекция.

     Pinterest:
       папка социальной сети + доска;
       либо папка социальной сети + раздел внутри доски.
   ============================================================ */

const FALLBACK_COLLECTION_ID =
  '__reference_sync_without_collection__';

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeType(value) {
  return clean(value).toUpperCase();
}

function occurrenceIdOf(
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
    occurrenceId:
      occurrenceIdOf(
        post?.postId,
        post?.collectionId,
      ),

    collectionId:
      clean(post?.collectionId),

    collectionName:
      clean(post?.collectionName),

    collectionType:
      clean(post?.collectionType),

    parentId:
      clean(post?.collectionParentId),

    parentName:
      clean(post?.collectionParentName),

    isDuplicate: false,
  };

  const input =
    source.length
      ? source
      : [fallback];

  const result = [];
  const seen = new Set();

  for (const item of input) {
    const collectionId =
      clean(item?.collectionId) ||
      fallback.collectionId;

    if (
      !collectionId ||
      collectionId ===
        FALLBACK_COLLECTION_ID ||
      seen.has(collectionId)
    ) {
      continue;
    }

    seen.add(collectionId);

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
        fallback.collectionName ||
        collectionId,

      collectionType:
        normalizeType(
          item?.collectionType ||
          fallback.collectionType,
        ),

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

export function selectedOccurrenceForPost({
  post,
  selectedOccurrenceId = '',
} = {}) {
  const occurrences =
    normalizedOccurrences(post);

  if (!occurrences.length) {
    return null;
  }

  const requestedId =
    clean(selectedOccurrenceId);

  if (requestedId) {
    const selected =
      occurrences.find(
        (occurrence) =>
          occurrence.occurrenceId ===
          requestedId,
      );

    if (selected) {
      return selected;
    }
  }

  return (
    occurrences.find(
      (occurrence) =>
        occurrence.isDuplicate === true,
    ) ||
    occurrences[0] ||
    null
  );
}

export function buildPostFolderRoute({
  post,
  platform,
  folderSearch = false,
  selectedOccurrenceId = '',
} = {}) {
  if (!folderSearch) {
    return [];
  }

  const occurrence =
    selectedOccurrenceForPost({
      post,
      selectedOccurrenceId,
    });

  if (!occurrence) {
    return [];
  }

  const platformCode =
    clean(platform).toLowerCase();

  if (platformCode === 'pinterest') {
    const type =
      normalizeType(
        occurrence.collectionType,
      );

    const isSection =
      type === 'SECTION' ||
      Boolean(occurrence.parentId);

    if (isSection) {
      const parentId =
        clean(occurrence.parentId);

      const parentName =
        clean(occurrence.parentName);

      const route = [];

      if (parentId || parentName) {
        route.push({
          sourceId:
            parentId ||
            `board:${parentName}`,

          name:
            parentName ||
            'Доска Pinterest',

          type: 'BOARD',
        });
      }

      route.push({
        sourceId:
          occurrence.collectionId,

        name:
          occurrence.collectionName,

        type: 'SECTION',
      });

      return route;
    }

    return [{
      sourceId:
        occurrence.collectionId,

      name:
        occurrence.collectionName,

      type: 'BOARD',
    }];
  }

  return [{
    sourceId:
      occurrence.collectionId,

    name:
      occurrence.collectionName,

    type:
      normalizeType(
        occurrence.collectionType,
      ) || 'COLLECTION',
  }];
}

export function platformFolderName(
  platform,
) {
  const code =
    clean(platform).toLowerCase();

  if (code === 'instagram') {
    return 'Instagram';
  }

  if (code === 'pinterest') {
    return 'Pinterest';
  }

  return (
    clean(platform) ||
    'ReferenceSync'
  );
}
