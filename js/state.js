/* ============================================================
   ReferenceSync — состояние приложения и хранение настроек
   ============================================================ */

import { SEARCH_MODES } from './instagram.js';
import { createHistory } from './history.js';

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
    /*
   * postId → rowId выбранного вхождения.
   * В state.selected по-прежнему хранятся
   * уникальные Instagram postId.
   */
  selectedRows: new Map(),
    /*
   * postId → occurrenceId.
   *
   * state.selected хранит уникальные публикации,
   * selectedOccurrences — конкретную строку/папку,
   * выбранную для каждой публикации.
   */
  selectedOccurrences: new Map(),
  /* Правки пользователя: postId → { name, description } */
  edits: new Map(),
  /* Сгенерированные имена: postId → { name, description, ... } */
  generated: new Map(),
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

export const appHistory = createHistory({
  limit: 100,

  apply(action, direction) {
    const value =
      direction === 'undo'
        ? action.before
        : action.after;

    if (action.type === 'edit') {
      setRaw(
        action.postId,
        action.field,
        value,
      );

      return;
    }

    if (action.type === 'setting') {
      state.settings[action.key] = value;
      saveSettings();
    }
    if (action.type === 'selection') {
      for (const change of action.changes) {
        const next =
          direction === 'undo'
            ? change.before
            : change.after;

        if (next.selected) {
          state.selected.add(change.postId);
        } else {
          state.selected.delete(change.postId);
        }

        const post = state.posts.find(
          (item) =>
            item.postId === change.postId,
        );

        if (!post) {
      continue;
        }

        if (next.components === undefined) {
          delete post.selectedComponents;
        } else {
          post.selectedComponents = [
            ...next.components,
          ];
        }
      }
    }
  },
});

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

export function setSetting(
  key,
  value,
  { record = true } = {},
) {
  const previous = state.settings[key];

  if (Object.is(previous, value)) {
    return false;
  }

  state.settings[key] = value;
  saveSettings();

  if (record) {
    appHistory.record({
      type: 'setting',
      key,
      before: previous,
      after: value,
    });
  }

  return true;
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

  appHistory.record({
    type: 'edit',
    postId,
    field,
    before: previous,
    after: value,
  });
}

export function removeEdit(postId, field, { record = true, previous } = {}) {
  const edit = state.edits.get(postId);
  if (!edit) return;
  const from = previous !== undefined ? previous : edit[field];
  delete edit[field];
  if (!Object.keys(edit).length) state.edits.delete(postId);
  if (record) {
    appHistory.record({
      type: 'edit',
      postId,
      field,
      before: from,
      after: undefined,
    });
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
  return appHistory.undo();
}

export function redoEdit() {
  return appHistory.redo();
}

export function resetAllEdits() {
  state.edits.clear();
  appHistory.clear();
}

export function hasEdits() {
  return state.edits.size > 0;
}

export function recordSelectionChange(
  changes,
) {
  const normalized = (changes || [])
    .filter((change) => {
      if (
        !change ||
        change.postId === undefined ||
        !change.before ||
        !change.after
      ) {
        return false;
      }

      const beforeComponents =
        change.before.components;

      const afterComponents =
        change.after.components;

      const sameComponents =
        beforeComponents === undefined &&
        afterComponents === undefined
          ? true
          : Array.isArray(beforeComponents) &&
            Array.isArray(afterComponents) &&
            beforeComponents.length ===
              afterComponents.length &&
            beforeComponents.every(
              (value, index) =>
                value ===
                afterComponents[index],
            );

      return (
        change.before.selected !==
          change.after.selected ||
        !sameComponents
      );
    })
    .map((change) => ({
      postId: change.postId,

      before: {
        selected:
          Boolean(change.before.selected),

        components:
          Array.isArray(
            change.before.components,
          )
            ? [...change.before.components]
            : undefined,
      },

      after: {
        selected:
          Boolean(change.after.selected),

        components:
          Array.isArray(
            change.after.components,
          )
            ? [...change.after.components]
            : undefined,
      },
    }));

  if (!normalized.length) {
    return false;
  }

  return appHistory.record({
    type: 'selection',
    changes: normalized,
  });
}