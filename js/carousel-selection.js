/* ============================================================
   Carousel component selection

   В интерфейсе используются позиции компонентов с нуля:
   0, 1, 2...

   В post.selectedComponents сохраняются номера Instagram:
   1, 2, 3...
   ============================================================ */

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'webm',
  'mkv',
  'm4v',
]);

function componentNumber(component, position) {
  const value = Number(component?.index);

  return Number.isInteger(value) && value > 0
    ? value
    : position + 1;
}

function componentExtension(component) {
  const explicit = String(
    component?.extension ||
    component?.ext ||
    '',
  )
    .trim()
    .replace(/^\./, '')
    .toLowerCase();

  if (explicit) {
    return explicit;
  }

  const source = String(
    component?.filename ||
    component?.url ||
    component?.previewUrl ||
    '',
  );

  const match = source.match(/\.([a-z0-9]+)(?:[?#]|$)/i);

  return match ? match[1].toLowerCase() : '';
}

function isVideoComponent(component) {
  const type = String(
    component?.mediaType ||
    component?.media_type ||
    component?.type ||
    '',
  ).toLowerCase();

  if (type.includes('video')) {
    return true;
  }

  if (type.includes('image') || type.includes('photo')) {
    return false;
  }

  return VIDEO_EXTENSIONS.has(componentExtension(component));
}

export function normalizeSelection(post, selection) {
  const components = Array.isArray(post?.components)
    ? post.components
    : [];

  if (components.length <= 1) {
    return new Set();
  }

  if (selection === undefined || selection === null) {
    return new Set(
      components.map((_, position) => position),
    );
  }

  const values = selection instanceof Set
    ? [...selection]
    : Array.isArray(selection)
      ? selection
      : [selection];

  const selectedNumbers = new Set(
    values
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0),
  );

  const normalized = new Set();

  components.forEach((component, position) => {
    if (
      selectedNumbers.has(
        componentNumber(component, position),
      )
    ) {
      normalized.add(position);
    }
  });

  return normalized;
}

export function selectAll(post) {
  const components = Array.isArray(post?.components)
    ? post.components
    : [];

  return new Set(
    components.map((_, position) => position),
  );
}

export function clearSelection() {
  return new Set();
}

export function imagesOnly(post) {
  const components = Array.isArray(post?.components)
    ? post.components
    : [];

  const selected = new Set();

  components.forEach((component, position) => {
    if (!isVideoComponent(component)) {
      selected.add(position);
    }
  });

  return selected;
}

export function videosOnly(post) {
  const components = Array.isArray(post?.components)
    ? post.components
    : [];

  const selected = new Set();

  components.forEach((component, position) => {
    if (isVideoComponent(component)) {
      selected.add(position);
    }
  });

  return selected;
}

export function componentDisplay(component, position) {
  const number = componentNumber(component, position);
  const extension = componentExtension(component);
  const mediaType = isVideoComponent(component)
    ? 'Видео'
    : 'Изображение';

  return {
    number,
    label: extension
      ? `${mediaType} · ${extension.toUpperCase()}`
      : mediaType,
  };
}

/* ------------------------------------------------------------
   Состояние компонентов частично импортированной карусели

   Реестр Eagle хранит компоненты как нулевые позиции:
   "0", "1", "2"...
   ------------------------------------------------------------ */

function normalizePositions(values) {
  const source = values instanceof Set
    ? [...values]
    : Array.isArray(values)
      ? values
      : values
        ? [...values]
        : [];

  return new Set(
    source
      .map(Number)
      .filter((value) => (
        Number.isInteger(value) &&
        value >= 0
      )),
  );
}

export function importedComponentPositions(record) {
  if (!(record?.components instanceof Map)) {
    return new Set();
  }

  return normalizePositions(
    record.components.keys(),
  );
}

export function availableComponentPositions(
  post,
  importedPositions = new Set(),
) {
  const available = selectAll(post);
  const imported = normalizePositions(importedPositions);

  imported.forEach((position) => {
    available.delete(position);
  });

  return available;
}

export function selectableSelection(
  post,
  selection,
  importedPositions = new Set(),
) {
  const selected = normalizeSelection(post, selection);
  const imported = normalizePositions(importedPositions);

  imported.forEach((position) => {
    selected.delete(position);
  });

  return selected;
}

export function carouselSelectionState(
  post,
  selection,
  importedPositions = new Set(),
) {
  const all = selectAll(post);

  const imported = new Set(
    [...normalizePositions(importedPositions)]
      .filter((position) => all.has(position)),
  );

  const available = availableComponentPositions(
    post,
    imported,
  );

  const selected = selectableSelection(
    post,
    selection,
    imported,
  );

  const total = all.size;
  const selectedCount = selected.size;

  return {
    total,
    imported,
    importedCount: imported.size,
    available,
    availableCount: available.size,
    selected,
    selectedCount,

    /* Если часть исходной карусели уже находится в Eagle,
       выбор всех оставшихся компонентов остаётся mixed. */
    checked:
      total > 0 &&
      selectedCount === total,

    mixed:
      selectedCount > 0 &&
      selectedCount < total,

    disabled:
      available.size === 0,
  };
}

export function selectedDownloadedFiles(entry, selection) {
  if (!entry || !Array.isArray(entry.files)) {
    return [];
  }

  const componentCount = Number(
    entry.post?.componentCount,
  );

  if (componentCount <= 1) {
    return entry.files
      .map((file, componentIndex) => ({
        file,
        componentIndex,
      }))
      .filter(({ file }) => Boolean(file));
  }

  const selectedPositions = normalizeSelection(
    entry.post,
    selection,
  );

  return entry.files
    .map((file, componentIndex) => ({
      file,
      componentIndex,
    }))
    .filter((item) => (
      Boolean(item.file) &&
      selectedPositions.has(item.componentIndex)
    ));
}
