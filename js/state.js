/* ============================================================
   ReferenceSync — состояние приложения и хранение настроек
   ============================================================ */

import { SEARCH_MODES } from './instagram.js';

const STORAGE_KEY = 'reference-sync.settings.v1';

export const defaultSettings = {
  platform: 'instagram',
  source: 'browser',          // browser | meta
  username: '',
  browser: 'chrome',
  browserProfile: '',
  speed: 'safe',
  searchMode: SEARCH_MODES.SMART,
  recentLimit: 50,
  folderSearch: false,
  extraFilters: false,
  filterPhoto: true,
  filterVideo: true,
  filterCarousel: true,
  authorInclude: '',
  authorExclude: '',
  thumbnails: true,
  numberingEnabled: true,
  numberingDestination: 'name',
  numberingMarker: 'instpoporder-',

  /*
  * Старое поле временно сохраняется для миграции
  * настроек и истории версии 1.
  */
  numberingStart: 1,

  counterOne: 'global',
  counterOneStart: 1,
  counterOnePlacement: 'end',

  counterTwo: 'carousel',
  counterTwoStart: 1,
  counterTwoPlacement: 'end',
  descriptionEnabled: true,
  descriptionDestination: 'description',
  descriptionPlacement: 'start',
  extraDescription: '',
  language: 'ru',
};

export const state = {
  settings: { ...defaultSettings },
  /* Найденные публикации */
  posts: [],
  /* Выбранные postId */
  selected: new Set(),
  /* Правки пользователя: postId → { name, description } */
  edits: new Map(),
  /* Сгенерированные имена: postId → { name, description, ... } */
  generated: new Map(),
  /* История правок для Cmd/Ctrl+Z */
  undoStack: [],
  redoStack: [],
  /* Коллекции Instagram, выбранные пользователем */
  collections: [],
  /* Уже импортированные ранее publikacii (для режима «только новые») */
  knownPostIds: new Set(),
  /* postId → componentCount и Eagle ID компонентов */
  importRecords: new Map(),
  /* Компоненты, удалённые из Eagle и доступные повторно */
  missingComponents: new Map(),
  /* Текущая операция */
  busy: false,
  abortController: null,
  eagleAvailable: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    Object.keys(defaultSettings).forEach((key) => {
      if (parsed[key] !== undefined) state.settings[key] = parsed[key];
    });

    /*
    * Пользовательские настройки до M1-T09D
    * содержали одно общее поле numberingStart.
    * Переносим его в первый счётчик.
    */
    if (
      parsed.counterOneStart === undefined &&
      parsed.numberingStart !== undefined
    ) {
      state.settings.counterOneStart =
        parsed.numberingStart;
    }
  } catch (_) { /* настройки повреждены — используем значения по умолчанию */ }
}

export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  } catch (_) { /* локальное хранилище недоступно */ }
}

export function setSetting(key, value) {
  state.settings[key] = value;
  saveSettings();
}

function positiveInteger(value, fallback = 1) {
  const number = Math.trunc(Number(value));

  return Number.isInteger(number) &&
    number > 0
    ? number
    : fallback;
}

export function numberingCounters(
  settings = state.settings,
) {
  return [
    {
      id: 'counter-1',
      mode:
        String(
          settings.counterOne ||
          'global',
        ),
      start: positiveInteger(
        settings.counterOneStart,
        positiveInteger(
          settings.numberingStart,
          1,
        ),
      ),
      placement:
        settings.counterOnePlacement ===
        'start'
          ? 'start'
          : 'end',
    },
    {
      id: 'counter-2',
      mode:
        String(
          settings.counterTwo ||
          'none',
        ),
      start: positiveInteger(
        settings.counterTwoStart,
        1,
      ),
      placement:
        settings.counterTwoPlacement ===
        'start'
          ? 'start'
          : 'end',
    },
  ];
}

export function formatAuthorFilterValue(value) {
  const text = String(value || '')
    .trimStart()
    .replace(/^@+\s*/, '');

  const hasTrailingSeparator =
    /(?:,\s*@*|\s+)$/.test(text);

  const names = text
    .split(/[,\s]+/)
    .map((name) => name.replace(/^@+/, ''))
    .filter(Boolean);

  let formatted = names.join(', @');

  if (
    hasTrailingSeparator &&
    names.length
  ) {
    formatted += ', @';
  }

  return formatted;
}

export function normalizeAuthorFilterValue(value) {
  return parseAuthorFilter(value)
    .join(', @');
}

export function parseAuthorFilter(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(/[,\s]+/)
    .map((name) => name.replace(/^@+/, ''))
    .filter(Boolean);
}

/* Список публикаций после применения фильтров */
export function visiblePosts() {
  const s = state.settings;
  if (!s.extraFilters) return state.posts;

  const include = parseAuthorFilter(
    s.authorInclude,
  );

  const exclude = parseAuthorFilter(
    s.authorExclude,
  );

  return state.posts.filter((post) => {
    const isVideo = post.type.toLowerCase().includes('видео');
    const isCarousel = post.componentCount > 1;
    const isPhoto = !isVideo && !isCarousel;

    if (isPhoto && !s.filterPhoto) return false;
    if (isVideo && !s.filterVideo) return false;
    if (isCarousel && !s.filterCarousel) return false;

    const author = post.plainUsername.toLowerCase();
    if (
      include.length &&
      !include.some((name) => author.includes(name))
    ) {
      return false;
    }

    if (
      exclude.length &&
      exclude.some((name) => author.includes(name))
    ) {
      return false;
    }

    return true;
  });
}

/* Значение ячейки с учётом правок пользователя */
export function cellValue(postId, field) {
  const edit = state.edits.get(postId);
  if (edit && edit[field] !== undefined) return edit[field];
  return state.generated.get(postId)?.[field] ?? '';
}

export function isEdited(postId, field) {
  const edit = state.edits.get(postId);
  return Boolean(edit && edit[field] !== undefined);
}

/* Правка ячейки с записью в историю (для Undo/Redo) */
export function applyEdit(postId, field, value) {
  const previous = state.edits.get(postId)?.[field];
  const generated = state.generated.get(postId)?.[field] ?? '';

  /* Возврат к сгенерированному значению снимает правку */
  if (value === generated) {
    removeEdit(postId, field, { record: true, previous });
    return;
  }

  const edit = state.edits.get(postId) || {};
  edit[field] = value;
  state.edits.set(postId, edit);

  state.undoStack.push({ postId, field, from: previous, to: value });
  state.redoStack.length = 0;
}

export function removeEdit(postId, field, { record = true, previous } = {}) {
  const edit = state.edits.get(postId);
  if (!edit) return;
  const from = previous !== undefined ? previous : edit[field];
  delete edit[field];
  if (!Object.keys(edit).length) state.edits.delete(postId);
  if (record) {
    state.undoStack.push({ postId, field, from, to: undefined });
    state.redoStack.length = 0;
  }
}

function setRaw(postId, field, value) {
  if (value === undefined) {
    const edit = state.edits.get(postId);
    if (edit) {
      delete edit[field];
      if (!Object.keys(edit).length) state.edits.delete(postId);
    }
    return;
  }
  const edit = state.edits.get(postId) || {};
  edit[field] = value;
  state.edits.set(postId, edit);
}

export function undoEdit() {
  const action = state.undoStack.pop();
  if (!action) return false;
  setRaw(action.postId, action.field, action.from);
  state.redoStack.push(action);
  return true;
}

export function redoEdit() {
  const action = state.redoStack.pop();
  if (!action) return false;
  setRaw(action.postId, action.field, action.to);
  state.undoStack.push(action);
  return true;
}

export function resetAllEdits() {
  state.edits.clear();
  state.undoStack.length = 0;
  state.redoStack.length = 0;
}

export function hasEdits() {
  return state.edits.size > 0;
}
