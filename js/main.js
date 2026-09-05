/* ============================================================
   ReferenceSync — точка входа плагина Eagle

   Собирает интерфейс из panels.js, связывает его с движком
   Instagram (instagram.js) и импортом в Eagle (eagle-import.js).
   ============================================================ */

import { el, clear, createCheckbox, createEditButton } from './ui.js';
import {
  checkboxRange,
  applyShiftSelection,
  createCheckboxGestureState,
} from './checkbox-selection.js';

import {
  groupPostsByCollection,
  collectionSelectionState,
  collectionSelectionChanges,
} from './collection-table.js';

import {
  loadIcons, buildHeader, buildSocial, buildSettings,
  buildStatus, buildResults, buildNaming, buildFooter, buildLog,
  buildCollectionModal, buildMessageModal, buildCarouselModal,
} from './panels.js';

import {
  availableComponentPositions,
  carouselSelectionState,
  importedComponentPositions,
  normalizeSelection,
  resetSelectionsAfterImport,
  selectedDownloadedFiles,
} from './carousel-selection.js';

import {
  state,
  loadSettings,
  setSetting,
  numberingCounters,
  visiblePosts,
  cellValue,
  isEdited,
  applyEdit,
  removeEdit,
  undoEdit,
  redoEdit,
  resetAllEdits,
  hasEdits,
  recordSelectionChange,
} from './state.js';

import {
  discoverSaved,
  downloadPosts,
  verifyInstagramSession,
  removeInstagramCookieSnapshot,
  SEARCH_MODES,
  redact,
} from './instagram.js';

import {
  getSource,
} from './sources/index.js';

import {
  checkEagle,
  importToEagle,
  buildNames,
  normalizeNumberingCounters,
  listFolders,
  findEagleItemsByIds,
  orderImportItemsOldestFirst,
  orderPostsOldestFirst,
  resolveComponentName,
} from './eagle-import.js';

import {
  loadImportRecords,
  reconcileImportRecords,
  recordCreatedEagleItems,
  saveImportRecords,
  selectImportablePosts,
} from './import-registry.js';

import {
  counterHistorySeeds,
  loadCounterHistoryRecords,
  rememberCounterHistory,
  saveCounterHistoryRecords,
} from './numbering-history.js';

import {
  allPostsImported,
  buildImportSummary,
} from './import-summary.js';

import { nodeApi, eagleApi } from './node-bridge.js';

import {
  discoverBrowserProfiles,
} from './browser-profiles.js';

import {
  toolchain, detectToolchain, installToolchain, updateToolchain,
  versionString, describeToolchainError,
} from './toolchain.js';

import {
  createJobControl,
  INSTAGRAM_RATE_LIMITED,
  STOPPED,
  throwIfAborted,
} from './job-control.js';

import {
  cleanupOrphanedStaging,
  clearRecoveryState,
  loadRecoveryState,
  saveRecoveryState,
  shouldRecoverJob,
  stagingExists,
} from './job-recovery.js';

/* Текущая фаза: idle | searching | ready | importing */
let phase = 'idle';

let ui = {};

/* Управление текущей длительной задачей (пауза/стоп/связь) */
let control = null;

/* Последнее сохранённое состояние аварийного восстановления */
let recoveryState = null;

/* Скачанные файлы, восстановленные после аварии */
let recoveredDownloaded = null;

/*
 * История независимых глобальных и авторских
 * счётчиков версии 2.
 */
let counterHistoryRecords = new Map();

/*
 * Свёрнутые ветки дерева коллекций.
 * Это состояние интерфейса, поэтому в настройки не записывается.
 */
const collapsedCollectionIds = new Set();

/*
 * Версия последнего вызова renderTable().
 * Не позволяет устаревшему рендеру перестроить новую таблицу.
 */
let collectionTableRenderVersion = 0;

/* Штатное закрытие не должно восстанавливаться как авария */
let closingGracefully = false;

const BROWSER_DISPLAY_NAMES = {
  chrome: 'Chrome',
  yandex: 'Yandex',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
};

function browserDisplayName(browser) {
  const key = String(browser || '').trim().toLowerCase();
  return BROWSER_DISPLAY_NAMES[key] || browser || 'браузера';
}

function activeNumberingCounters(
  settings = state.settings,
) {
  if (settings.numberingEnabled !== true) {
    return [];
  }

  return normalizeNumberingCounters(
    numberingCounters(settings),
    {
      startNumber:
        settings.numberingStart,
    },
  );
}

function currentNumberingContext(
  settings = state.settings,
) {
  const counters =
    activeNumberingCounters(settings);

  return {
    counters,
    counterSeeds:
      counterHistorySeeds({
        records:
          counterHistoryRecords,
        platform:
          settings.platform,
        counters,
      }),
  };
}

function selectedVisiblePostIds() {
  return new Set(
    visiblePosts()
      .filter((post) =>
        state.selected.has(post.postId))
      .map((post) => post.postId),
  );
}

function rememberImportedCounterHistory(
  settings,
  importedPostIds,
  counters,
) {
  if (
    settings.numberingEnabled !== true ||
    !importedPostIds?.size ||
    !counters?.length
  ) {
    return false;
  }

  counterHistoryRecords =
    rememberCounterHistory({
      records:
        counterHistoryRecords,
      platform:
        settings.platform,
      counters,
      posts:
        state.posts,
      generated:
        state.generated,
      importedPostIds,
    });

  return saveCounterHistoryRecords(
    counterHistoryRecords,
  );
}

async function refreshImportRegistry() {
  const eagleIds = [];

  for (const record of state.importRecords.values()) {
    for (const eagleId of record.components.values()) {
      if (eagleId) eagleIds.push(eagleId);
    }
  }

  if (!eagleIds.length) {
    state.knownPostIds = new Set();
    state.missingComponents = new Map();
    saveImportRecords(state.importRecords);
    return;
  }

  const eagleItems = await findEagleItemsByIds(eagleIds);

  const reconciled = reconcileImportRecords(
    state.importRecords,
    eagleItems,
  );

  state.importRecords = reconciled.records;
  state.knownPostIds = reconciled.knownPostIds;
  state.missingComponents = reconciled.missingComponents;

  saveImportRecords(state.importRecords);

  if (reconciled.missingComponents.size) {
    ui.log?.add(
      `Удалённых публикаций или компонентов найдено: ` +
      `${reconciled.missingComponents.size}`,
      'warn',
    );
  }
}

function recoveryDownloadSnapshot(downloaded) {
  return (downloaded || []).map((entry) => ({
    postId: entry.post.postId,
    files: [...entry.files],
  }));
}

function restoreDownloadedEntries(snapshot) {
  if (
    !nodeApi.available ||
    !Array.isArray(snapshot) ||
    !snapshot.length
  ) {
    return null;
  }

  const postsById = new Map(
    state.posts.map((post) => [post.postId, post]),
  );

  const restored = [];

  for (const entry of snapshot) {
    const post = postsById.get(entry.postId);
    const files = Array.isArray(entry.files)
      ? entry.files
      : [];

    if (
      !post ||
      !files.length ||
      files.some((file) => !nodeApi.fs.existsSync(file))
    ) {
      return null;
    }

    restored.push({
      post,
      files,
      error: null,
    });
  }

  return restored;
}

function checkpointRecovery(phaseName, extra = {}) {
  if (closingGracefully) return;

  const previous = recoveryState || {};

  recoveryState = {
    ...previous,
    version: 1,
    jobId:
      previous.jobId ||
      `job-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
    phase: phaseName,
    settings: { ...state.settings },
    posts: state.posts,
    selectedPostIds: [...state.selected],
    completedPostIds: [...state.knownPostIds],
    stagingRoot:
      extra.stagingRoot ??
      previous.stagingRoot ??
      '',
    downloaded:
      extra.downloaded ??
      previous.downloaded ??
      [],
    createdEagleItems:
      extra.createdEagleItems ??
      previous.createdEagleItems ??
      [],
    startedAt:
      previous.startedAt ||
      Date.now(),
    ...extra,
  };

  saveRecoveryState(recoveryState);
}

function discardRecovery() {
  const stagingRoot =
    recoveryState?.stagingRoot || '';

  clearRecoveryState({
    stagingRoot,
    removeStaging: true,
  });

  recoveryState = null;
  recoveredDownloaded = null;
}

async function restoreInterruptedJob() {
  const stored = loadRecoveryState();

  const recoverable = shouldRecoverJob(stored, {
    stagingExists: stored?.stagingRoot
      ? stagingExists(stored.stagingRoot)
      : false,
    closedGracefully: false,
  });

  cleanupOrphanedStaging({
    activeStagingRoot:
      recoverable
        ? stored?.stagingRoot || ''
        : '',
  });

  if (!recoverable) {
    if (stored) {
      clearRecoveryState({
        stagingRoot: stored.stagingRoot,
        removeStaging: true,
      });
    }
    return false;
  }

  recoveryState = stored;

  if (
    stored.settings &&
    typeof stored.settings === 'object'
  ) {
    Object.assign(
      state.settings,
      stored.settings,
    );
  }

  if (Array.isArray(stored.posts)) {
    state.posts = stored.posts;
  }

  state.selected = new Set(
    stored.selectedPostIds || [],
  );


  if (state.posts.length) {
    resetAllEdits();
    refreshNames();
    renderTable();

    recoveredDownloaded = restoreDownloadedEntries(
      stored.downloaded,
    );

    phase = 'ready';

    ui.footer.action.setLabel(
      'Скачать и добавить в Eagle',
    );

    ui.status.set(
      'Восстановлено незавершённое задание',
      recoveredDownloaded
        ? 'Скачанные файлы сохранены — можно продолжить импорт'
        : 'Результаты поиска восстановлены — можно продолжить',
    );

    ui.log.add(
      recoveredDownloaded
        ? 'После аварии восстановлены таблица и скачанные файлы.'
        : 'После аварии восстановены найденные публикации.',
      'warn',
    );

    return true;
  }

  /* Оборванный discovery нельзя продолжить с сетевого байта.
     Параметры сохраняются, но сам поиск запускается заново. */
  phase = 'idle';

  ui.footer.action.setLabel('Начать поиск');

  ui.status.set(
    'Предыдущий поиск был прерван',
    'Параметры сохранены — нажмите «Начать поиск» ещё раз',
  );

  ui.log.add(
    'Оборванный поиск можно безопасно запустить повторно.',
    'warn',
  );

  return true;
}

function prepareGracefulClose() {
  closingGracefully = true;

  if (state.abortController) {
    state.abortController.abort();
  }

  if (control) {
    control.stop();
  }

  discardRecovery();
}

async function closeGracefully() {
  prepareGracefulClose();

  if (eagleApi?.window?.hide) {
    await eagleApi.window.hide();
  } else {
    window.close();
  }
}

function bindCloseLifecycle() {
  eagleApi?.onPluginBeforeExit?.(() => {
    prepareGracefulClose();
  });

  window.addEventListener(
    'beforeunload',
    prepareGracefulClose,
  );
}

/* ------------------------------------------------------------
   Запуск
   ------------------------------------------------------------ */
async function boot() {
  bindCloseLifecycle();
  loadSettings();
  state.importRecords = loadImportRecords();

  counterHistoryRecords =
  loadCounterHistoryRecords();
  await loadIcons();

  const app = el('div', 'rs-app');
  app.id = 'reference-sync';

  ui.header = buildHeader({
    onLanguage: (code) => {
      setSetting('language', code);
      ui.log.add(`Язык интерфейса: ${code}. Перевод строк подключим позже.`, 'warn');
    },
  });

  ui.social = buildSocial({
    onSelect: (platform) => {
      setSetting('platform', platform);
      ui.log.add(`Выбрана платформа: ${platform}`);
    },
  });

  ui.settings = buildSettings({
    onChange: (key) => {
      if (key === 'browser') {
        refreshBrowserProfiles();
      }

      if (key === 'extraFilters' || key.startsWith('filter') ||
          key.startsWith('author')) {
        renderTable();
      }
    },
  });

  ui.status = buildStatus({
    onCommand: (name) =>
      handleProgressCommand(name),
  });

  ui.results = buildResults({
    onInstall: () => prepareToolchain(),
    onClear: () => clearResults(),
    onToggleAll: (value) => toggleAll(value),
    onThumbnails: () => {
      syncTableThumbnailVisibility();
    },
    onResetAll: () => {
      resetAllEdits();
      refreshNames();
      renderTable();
      ui.log.add('Все правки сброшены');
    },
  });

  ui.naming = buildNaming({
    onChange: () => {
      refreshNames();
      renderTable();
    },
  });

  ui.log = buildLog();

  ui.footer = buildFooter({
    onLog: () => {
      const open = ui.log.toggle();
      ui.footer.logButton.setLabel(open
        ? 'Скрыть технический журнал'
        : 'Показать технический журнал');
    },
    onAction: () => runAction(),
  });

  ui.modal = buildCollectionModal({
    onConfirm: () => confirmCollections(),
    onCancel: () => closeCollectionModal(true),
  });

  ui.messageModal = buildMessageModal();

  /* Carousel modal */
  ui.carouselModal = buildCarouselModal();
  app.appendChild(ui.carouselModal.node);

  /* Рабочая область: левая панель + правая колонка */
  const work = el('div', 'rs-work');
  const right = el('div', 'rs-right');
  right.append(ui.status.node, ui.results.node, ui.naming.node);
  work.append(ui.settings.node, right);

  app.append(
    ui.header,
    ui.social,
    work,
    ui.footer.node,
    ui.log.node,
    ui.modal.node,
    ui.messageModal.node,
  );

  document.body.appendChild(app);

  renderTable();
  bindShortcuts();
  refreshBrowserProfiles();
  await detectEnvironment();

  if (state.eagleAvailable) {
    await refreshImportRegistry();
  }

  await restoreInterruptedJob();
}

/* ------------------------------------------------------------
   Профили выбранного браузера
   ------------------------------------------------------------ */
function refreshBrowserProfiles() {
  const browser = state.settings.browser;
  const profiles = discoverBrowserProfiles(browser);

  let selectedId = state.settings.browserProfile;

  if (!profiles.some((profile) => profile.id === selectedId)) {
    selectedId = profiles[0]?.id || '';
  }

  setSetting('browserProfile', selectedId);
  ui.settings.setBrowserProfiles(profiles, selectedId);

  if (!profiles.length) {
    ui.log?.add(
      `Профили браузера ${browser} не обнаружены — ` +
      'будет использован стандартный профиль.',
      'warn',
    );
    return;
  }

  const selected = profiles.find(
    (profile) => profile.id === selectedId,
  );

  if (profiles.length === 1) {
    ui.log?.add(
      `Автоматически выбран профиль браузера: ${selected?.label}`,
    );
    return;
  }

  ui.log?.add(
    `Найдено профилей браузера: ${profiles.length}. ` +
    `Выбран: ${selected?.label}`,
  );
}

/* ------------------------------------------------------------
   Проверка окружения: Eagle и gallery-dl
   ------------------------------------------------------------ */
async function detectEnvironment() {
  if (!nodeApi.available) {
    ui.status.set('Демонстрационный режим',
      'Плагин открыт вне Eagle — поиск и импорт недоступны');
    ui.results.engine.setState('error', 'Движок загрузки недоступен вне Eagle');
    ui.log.add(
      'Node.js API недоступен. Интерфейс работает в режиме просмотра дизайна.',
      'warn');
    return;
  }

  const eagle = await checkEagle();
  state.eagleAvailable = eagle.available;

  if (eagle.available) {
    ui.log.add(`Eagle доступен (${eagle.source}, версия ${eagle.version})`, 'ok');
    ui.status.set('Готов к работе', 'Заполните шаг 1 и нажмите «Начать поиск»');
  } else {
    ui.log.add('Eagle не отвечает. Запустите приложение Eagle.', 'err');
    ui.status.set('Eagle не найден', 'Запустите Eagle и переоткройте плагин');
  }

  await checkToolchain();
}

/* ------------------------------------------------------------
   Движок загрузки (gallery-dl)

   Плагин находит его сам в 6 местах, а если не находит —
   ставит в свою папку по нажатию одной кнопки.
   Пользователь никогда не открывает терминал.
   ------------------------------------------------------------ */
async function checkToolchain() {
  ui.results.engine.setState('checking', 'Движок загрузки: проверяем…',
    { progress: null });

  await detectToolchain({
    onLog: (line, kind) => ui.log.add(line, kind),
  });

  if (toolchain.ready) {
    ui.results.engine.setState('ready',
      `Движок загрузки готов · gallery-dl ${versionString(toolchain.version)}`,
      { button: 'Обновить' });
    return true;
  }

  ui.results.engine.setState(
    'missing',
    'Движок загрузки не готов',
    {
      detail:
        'Для начала работы вам необходимо скачать Gallery-DL. ' +
        'Нажмите кнопку «Скачать» ниже.',
      button: 'Скачать',
    },
  );
  ui.log.add('Движок не найден. Нажмите «Подготовить движок».', 'warn');
  return false;
}

/* Установка/обновление по кнопке */
let toolchainBusy = false;

async function prepareToolchain() {
  if (toolchainBusy) return false;
  toolchainBusy = true;

  const isUpdate = toolchain.ready;
  ui.results.engine.setState('working',
    isUpdate ? 'Обновляем движок загрузки…' : 'Готовим движок загрузки…',
    { detail: 'Идёт загрузка из репозитория PyPI', progress: 5 });

  try {
    const run = isUpdate ? updateToolchain : installToolchain;
    await run({
      onLog: (line, kind) => ui.log.add(line, kind),
      onProgress: ({ percent }) => {
        if (typeof percent === 'number') ui.results.engine.setProgress(percent);
      },
    });

    ui.results.engine.setState('ready',
      `Движок загрузки готов · gallery-dl ${versionString(toolchain.version)}`,
      { button: 'Обновить', progress: 100 });
    ui.log.add('Движок готов к работе.', 'ok');

    /* Если пользователь нажимал «Начать поиск» до установки —
       статус возвращается к обычной подсказке. */
    if (phase === 'idle') {
      ui.status.set('Готов к работе', 'Заполните шаг 1 и нажмите «Начать поиск»');
    }
    return true;
  } catch (error) {
    const info = describeToolchainError(error);
    ui.results.engine.setState('error', info.title, {
      detail: info.text,
      button: info.action === 'install' ? 'Подготовить движок' : 'Повторить',
    });
    ui.log.add(`${info.title}: ${info.text}`, 'err');
    return false;
  } finally {
    toolchainBusy = false;
  }
}

/* Гарантия готовности перед действием, требующим движок */
async function ensureToolchain() {
  if (toolchain.ready) return true;

  ui.log.add('Движок загрузки не подготовлен — проверяем ещё раз…', 'warn');
  if (await checkToolchain()) return true;

  ui.status.set('Движок не подготовлен',
    'Нажмите «Подготовить движок» в блоке состояния');
  return false;
}

/* ------------------------------------------------------------
   Главная кнопка: поиск → импорт
   ------------------------------------------------------------ */
async function runAction() {
  if (phase === 'searching' || phase === 'importing') {
    state.abortController?.abort();
    ui.log.add('Остановка по запросу пользователя', 'warn');
    return;
  }

  if (phase === 'ready') {
    if (!state.selected.size) return;

    await runImport();
    return;
  }

  await runSearch();
}

/* ------------------------------------------------------------
   Кнопки плеера в прогресс-баре

   Логика из Instruction:
     pause → состояние 3 (прогресс замирает там, где остановился);
     play  → возврат в состояние 1 и продолжение очереди;
     stop  → состояние 4 (процент исчезает, остаётся визуал).
   ------------------------------------------------------------ */
function handleProgressCommand(name) {
  if (!control) return;

  if (name === 'pause') {
    control.pause();
    ui.status.progress.update({
      mode: 'paused',
      lead: 'Загрузка приостановлена',
      trail: 'Нажмите «Продолжить»',
    });
    ui.log.add('Загрузка приостановлена пользователем.', 'warn');
    return;
  }

  if (name === 'play') {
    control.resume();
    ui.status.progress.update({
      mode: 'downloading',
      lead: lastProgressLead,
      trail: lastProgressTrail,
    });
    ui.log.add('Загрузка продолжена.');
    return;
  }

  if (name === 'stop') {
    control.stop();
    if (state.abortController) state.abortController.abort();
    ui.status.progress.update({
      mode: 'stopped',
      lead: 'Процесс остановлен',
      trail: 'Часть файлов уже скачана',
    });
    ui.log.add('Процесс остановлен пользователем.', 'warn');
  }
}

/* Последние подписи состояния 1 — нужны, чтобы вернуть их
   без изменений после снятия паузы */
let lastProgressLead = '';
let lastProgressTrail = '';

/* Подписи блока Publication info — общие для состояний 1, 3, 4, 5 */
function publicationInfo() {
  const visible = visiblePosts();
  return {
    found: `Найдено: ${state.posts.length}`,
    displayed: `Показано: ${visible.length}`,
    selected: `Выбрано: ${state.selected.size}`,
  };
}

async function requireMatchingInstagramSession(settings, signal) {
  const browserName = browserDisplayName(settings.browser);

  ui.status.set(
    'Проверка аккаунта Instagram…',
    'ReferenceSync проверяет выбранный профиль браузера',
  );

  const stopSessionMessages =
    startProgressMessageRotation({
      mode:
        phase === 'importing'
          ? 'downloading'
          : 'search',
      messages: [
        'Проверяем профиль браузера',
        'Подготавливаем данные авторизации',
        'Проверяем соединение с Instagram',
      ],
      trail: `Браузер: ${browserName}`,
      interval: 900,
    });

  let session;

  try {
    session = await verifyInstagramSession({
      browser: settings.browser,
      browserProfile:
        settings.browserProfile,
      signal,
      onLog: (line) => ui.log.add(line),
      keepCookieFile: true,
    });
  } finally {
    stopSessionMessages();
  }
  try{
    throwIfAborted(signal);

    ui.settings.setInstagramProfileHint(
      session.username,
      browserName,
    );

    if (!session.authenticated) {
      const error = new Error(
        session.error ||
        `В выбранном профиле ${browserName} вход в Instagram не выполнен.`,
      );

      error.code = 'INSTAGRAM_SESSION_INVALID';
      throw error;
    }

    const expected = String(settings.username || '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();

    const actual = String(session.username || '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();

    if (expected && actual !== expected) {
      const profiles = discoverBrowserProfiles(settings.browser);
      const selected = profiles.find(
        (profile) => profile.id === settings.browserProfile,
      );

      const selectedName = selected?.label
        ? ` «${selected.label}»`
        : '';

      const error = new Error(
        `В профиле ${browserName}${selectedName} в Instagram авторизован ` +
        `@${session.username}, а для поиска указан @${expected}. ` +
        'Выберите профиль браузера с нужным аккаунтом Instagram ' +
        'либо войдите в нужный аккаунт и повторите проверку.',
      );

      error.code = 'INSTAGRAM_ACCOUNT_MISMATCH';
      throw error;
    }

    ui.status.progress.update({
      lead: 'Вход в Instagram подтверждён',
      trail: 'Запускаем следующий этап',
    });

    ui.log.add(
      `Проверен Instagram-аккаунт: @${session.username}`,
    );

    return session;
  } catch (error) {
    removeInstagramCookieSnapshot(session.cookieFile);
    throw error;
  }
}

/* ---------- Поиск ---------- */
async function runSearch() {
  /* Настройки фиксируются на момент нажатия «Поиск».
   Изменения формы во время операции не должны менять уже
   запущенный профиль браузера или лимит. */
  await refreshImportRegistry();
  const s = { ...state.settings };


  if (s.platform !== 'instagram') {
    ui.log.add(`Платформа ${s.platform} ещё не подключена.`, 'warn');
    ui.status.set('Платформа недоступна', 'Пока работает только Instagram');
    return;
  }

  if (s.source === 'meta') {
    ui.log.add('Разбор архива Meta пока не реализован.', 'warn');
    ui.status.set('Источник недоступен', 'Выберите «Через авторизованный браузер»');
    return;
  }

  if (!s.username.trim()) {
    ui.status.set('Не указан аккаунт', 'Введите Instagram-никнейм в шаге 1');
    ui.log.add('Поиск невозможен: не заполнено имя аккаунта.', 'err');
    return;
  }

  if (!nodeApi.available) {
    ui.log.add('Поиск доступен только внутри Eagle.', 'err');
    return;
  }

  /* Движок обязателен: если его нет — предлагаем подготовить */
  if (!await ensureToolchain()) return;

  phase = 'searching';
  state.abortController = new AbortController();
  recoveryState = null;
  recoveredDownloaded = null;
  checkpointRecovery('searching');
  control = createJobControl();
  const operationController = state.abortController;
  ui.footer.action.setLabel('Остановить');
  ui.status.set('Поиск публикаций…', 'Идёт обращение к Instagram', true);
  ui.log.add(`Поиск: @${s.username}, режим ${s.searchMode}`);

  /* Состояние 6 — «Search for Publications»: бегущая полоса
     из начала в конец, пока идёт обращение к Eagle и браузеру */
  ui.status.showProgress(true);
  ui.status.progress.update({
    mode: 'search',
    lead: 'Поиск в Eagle и в браузере',
    trail: 'Найдено: 0',
  });

  try {
    const session = await requireMatchingInstagramSession(
      s,
      operationController.signal,
    );

    let discoveryResult;

    try {
      if (s.folderSearch) {
        const source =
          getSource(s.platform);

        if (
          typeof source.listContainers !==
          'function'
        ) {
          throw new Error(
            `Источник ${source.title} не поддерживает выбор папок`,
          );
        }

        ui.status.set(
          'Получаем список коллекций…',
          `Источник: ${source.title}`,
          true,
        );

        ui.status.progress.update({
          mode: 'search',
          lead:
            'Получаем список коллекций',
          trail:
            `Источник: ${source.title}`,
        });

        const collections =
          await source.listContainers({
            cookieFile:
              session.cookieFile,
            signal:
              operationController.signal,
          });

        collections.forEach(
          (collection) => {
            const covers =
              Array.isArray(
                collection.coverMediaList,
              )
                ? collection.coverMediaList
                : [];

            const firstCover =
              covers[0];

            let fields = 'нет';

            if (
              firstCover &&
              typeof firstCover === 'object'
            ) {
              fields =
                Object.entries(firstCover)
                  .map(
                    ([key, value]) => {
                      if (Array.isArray(value)) {
                        return (
                          `${key}[${value.length}]`
                        );
                      }

                      if (
                        value &&
                        typeof value === 'object'
                      ) {
                        return (
                          `${key}{` +
                          Object.keys(value)
                            .join('|') +
                          '}'
                        );
                      }

                      return key;
                    },
                  )
                  .join(', ');
            }

            ui.log.add(
              `[GraphQL collections] ` +
              `${collection.name}: ` +
              `всего ${collection.mediaCount ?? '?'}, ` +
              `обложек ${covers.length}, ` +
              `поля: ${fields}`,
            );
          },
        );

        const selectedCollections =
          await openCollectionModal(
            collections,
          );

        if (!selectedCollections) {
          const cancelled =
            new Error(
              'Выбор коллекций отменён',
            );

          cancelled.code = STOPPED;
          throw cancelled;
        }

        if (!selectedCollections.length) {
          throw new Error(
            'Не выбрана ни одна коллекция',
          );
        }
      } else {
        state.collections = [];
      }

      discoveryResult =
        await discoverSaved({
        username: s.username,
        browser: s.browser,
        browserProfile: s.browserProfile,
        cookieFile: session.cookieFile,
        searchMode: s.searchMode,
        limit: s.recentLimit,
        speedProfile: s.speed,
        collections: s.folderSearch
        ? state.collections
          : [],
        knownPostIds: state.knownPostIds,
        signal: operationController.signal,
        onProgress: (progress) => {
          if (progress.stage === 'discover') {
            ui.status.set(
              `Поиск публикаций… найдено ~${progress.approximate}`,
              `Коллекция: ${progress.collection}`,
              true,
            );

            /* Число найденных обновляется на ходу — как просил
            Instruction/Scale Reviewing for Publications */
            ui.status.progress.update({
              trail: `Найдено: ${progress.approximate}`,
            });
          }
        },
        onLog: (line) => ui.log.add(redact(line)),
      });
    } finally {
      removeInstagramCookieSnapshot(session.cookieFile);
    }

    const { posts, stoppedEarly } = discoveryResult;

    /* Состояние 7 — «Reviewing Publications»: полоса идёт
       из конца в начало, пока список нормализуется */
    ui.status.progress.update({
      mode: 'reviewing',
      lead: 'Обработка найденных публикаций',
      trail: `Найдено: ${posts.length}`,
    });
    await nextFrames(2);

    state.posts = posts;
    state.selected = new Set(
      posts.map((post) => post.postId),
    );

    checkpointRecovery('ready');
    resetAllEdits();
    refreshNames();
    renderTable();

    if (!posts.length) {
      phase = 'idle';
      ui.footer.action.setLabel('Начать поиск');
      ui.status.showProgress(false);
      ui.status.set(
        'Новых публикаций для импорта нет',
        'Все найденные публикации уже добавлены в Eagle',
      );

      ui.log.add(
        'Все найденные публикации уже добавлены в Eagle.',
        'ok',
      );
      discardRecovery();
      return;
    }

    phase = 'ready';
    ui.footer.action.setLabel('Скачать и добавить в Eagle');
    ui.status.showProgress(false);
    ui.status.set(`Найдено публикаций: ${posts.length}`,
      stoppedEarly
        ? 'Остановлено на границе прошлой синхронизации'
        : 'Проверьте выбор и нажмите «Скачать и добавить в Eagle»');
    ui.log.add(`Поиск завершён: ${posts.length} публикаций.`, 'ok');
  } catch (error) {
    phase = 'idle';
    ui.footer.action.setLabel('Начать поиск');

    if (error?.code === INSTAGRAM_RATE_LIMITED) {
      discardRecovery();

      ui.status.showProgress(true);

      ui.status.set(
        'Instagram ограничил запросы',
        'Поиск остановлен. Подождите некоторое время и повторите.',
      );

      ui.status.progress.update({
        mode: 'stopped',
        lead: 'Поиск остановлен',
        trail: 'Instagram временно ограничил запросы',
      });

      ui.log.add(
        `Поиск остановлен: ${error.message}`,
        'err',
      );
    } else if (
      operationController.signal.aborted ||
      error?.code === STOPPED
    ) {
      discardRecovery();

      ui.status.showProgress(true);

      ui.status.set(
        'Поиск остановлен',
        'Можно изменить параметры и запустить поиск снова',
      );

      ui.status.progress.update({
        mode: 'stopped',
        lead: 'Процесс остановлен',
        trail: 'Поиск публикаций отменён',
      });

      ui.log.add(
        'Поиск остановлен пользователем.',
        'warn',
      );
    } else {
      discardRecovery();
      ui.status.showProgress(false);
      reportRunError('Ошибка поиска', error);
    }
  } finally {

    if (state.abortController === operationController) {
      state.abortController = null;
    }

   control = null;
  }
}

/* Отдать браузеру пару кадров — чтобы состояние прогресс-бара
   успело отрисоваться перед следующим шагом */
function nextFrames(count = 1) {
  return new Promise((resolve) => {
    let left = count;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function startProgressMessageRotation({
  mode,
  messages,
  trail = '',
  interval = 900,
}) {
  let index = 0;

  function showMessage() {
    ui.status.progress.update({
      mode,
      lead: messages[index],
      trail,
    });

    index = (index + 1) % messages.length;
  }

  showMessage();

  const timer = setInterval(
    showMessage,
    interval,
  );

  return () => {
    clearInterval(timer);
  };
}

/* ---------- Скачивание и импорт ---------- */
async function runImport() {
  const s = { ...state.settings };

  const {
    counters: importCounters,
    counterSeeds: importCounterSeeds,
  } = currentNumberingContext(s);

  await refreshImportRegistry();

  const chosen = orderPostsOldestFirst(
    selectImportablePosts(
      visiblePosts(),
      state.selected,
      state.knownPostIds,
    ),
  );



  if (!chosen.length) {
    ui.status.set('Нечего импортировать', 'Отметьте публикации в таблице');
    return;
  }

  if (!await ensureToolchain()) return;

  phase = 'importing';
  state.abortController = new AbortController();
  let sessionCookieFile = '';
  checkpointRecovery('importing');
  control = createJobControl();
  ui.footer.action.setLabel('Остановить');
  ui.status.set('Скачивание файлов…', `0 из ${chosen.length}`, true);
  ui.log.add(`Скачивание ${chosen.length} публикаций…`);

  /* Состояние 1 — «Downloading a file». Прогресс считается по
     двум этапам: скачивание (0…70%) и импорт в Eagle (70…100%),
     потому что оба видны пользователю как один процесс. */
  const DOWNLOAD_SHARE = 0.7;
  lastProgressLead = 'Подготовка очереди';
  lastProgressTrail = `Всего: ${chosen.length}`;

  ui.status.showProgress(true);
  ui.status.progress.jumpTo(0);
  ui.status.progress.update({
    mode: 'downloading',
    lead: lastProgressLead,
    trail: lastProgressTrail,
    ...publicationInfo(),
  });

  try {
    const session = await requireMatchingInstagramSession(
      s,
      state.abortController.signal,
    );

    sessionCookieFile = session.cookieFile;

    const restoredResults = Array.isArray(recoveredDownloaded)
      ? recoveredDownloaded
      : [];

    const restoredPostIds = new Set(
      restoredResults
        .map((entry) => String(entry?.post?.postId || ''))
        .filter(Boolean),
    );

    const postsToDownload = chosen.filter(
      (post) => !restoredPostIds.has(String(post.postId)),
    );

    const completedDownloads = [...restoredResults];

    const {
      results: newResults,
      stopReason: downloadStopReason,
    } = await downloadPosts({
      posts: postsToDownload,
      stagingRoot: recoveryState?.stagingRoot || '',
      browser: s.browser,
      browserProfile: s.browserProfile,
      cookieFile: sessionCookieFile,
      speedProfile: s.speed,
      signal: state.abortController.signal,
      control,
      onProgress: (progress) => {
        ui.status.set('Скачивание файлов…',
          `${progress.current} из ${progress.total} — ${progress.post.username}`,
          true);

        lastProgressLead = `Текущий файл: ${progress.post.username}`;
        lastProgressTrail = `${progress.current} из ${progress.total}`;
        ui.status.progress.update({
          mode: 'downloading',
          lead: lastProgressLead,
          trail: lastProgressTrail,
          progress: (progress.current / progress.total) * DOWNLOAD_SHARE,
          ...publicationInfo(),
        });
      },
      /* Обрыв связи — состояние 5 с отсчётом до попытки */
      onOffline: (secondsLeft, post) => {
        ui.status.progress.update({
          mode: 'offline',
          lead: `Не удаётся скачать: ${post.username}`,
          trail: 'Связь потеряна',
          interest: `${secondsLeft} С`,
          ...publicationInfo(),
        });
        ui.status.set('Нет связи с Instagram',
          `Повторная попытка через ${secondsLeft} с`, true);
      },
      onLog: (line) => ui.log.add(redact(line)),
      onStagingReady: (stagingRoot) => {
        checkpointRecovery('downloading', { stagingRoot });
      },
      onCompleted: (completedEntry) => {
        completedDownloads.push(completedEntry);

        checkpointRecovery('downloading', {
          downloaded: recoveryDownloadSnapshot(completedDownloads),
        });
      },
    });

        const results = [
      ...restoredResults,
      ...newResults,
    ];

    recoveredDownloaded = null;

    checkpointRecovery('downloaded', {
      downloaded: recoveryDownloadSnapshot(results),
    });

    const downloaded = results.filter((entry) => entry.files.length);
    const failedDownloads = results.filter((entry) => !entry.files.length);

    failedDownloads.forEach((entry) => {
      ui.log.add(`Не скачано: ${entry.post.url} — ${entry.error}`, 'err');
    });

    if (!downloaded.length) {
      if (
        downloadStopReason === INSTAGRAM_RATE_LIMITED
      ) {
        const rateLimitError = new Error(
          'Instagram временно ограничил запросы. ' +
          'Очередь остановлена без повторных попыток.',
        );

        rateLimitError.code = INSTAGRAM_RATE_LIMITED;
        throw rateLimitError;
      }

      throw new Error('Ни один файл не удалось скачать');
    }


    /* Формируем элементы для Eagle: карусель даёт несколько файлов,
       каждый становится отдельным элементом со своим номером. */
    const items = [];

    downloaded.forEach((entry) => {
      const names = state.generated.get(entry.post.postId);
      const nameOverride =
        state.edits.get(entry.post.postId)?.name;
      const descOverride =
        state.edits.get(entry.post.postId)?.description;

      const annotation =
        descOverride ?? names?.description ?? '';
      const componentNames =
        names?.componentNames || [];

      const componentDescriptions =
        names?.componentDescriptions || [];

      const missingComponents = state.missingComponents.get(
        entry.post.postId,
      );

      const selection = Array.isArray(entry.post.selectedComponents)
        ? entry.post.selectedComponents
        : undefined;

      const selectedFiles = selectedDownloadedFiles(entry, selection);

      selectedFiles.forEach(({
        file,
        componentIndex,
      }) => {
        /* Если запись уже существует, повторно разрешены только
           компоненты, которые действительно удалены из Eagle. */
        if (
          missingComponents &&
          !missingComponents.has(String(componentIndex))
        ) {
          return;
        }

        items.push({
          path: file,
          name: resolveComponentName({
            nameOverride,
            generatedName: names?.name,
            componentNames,
            componentIndex,
            fallback: entry.post.username,
          }),
          website: entry.post.url,
          annotation:
            descOverride ??
            componentDescriptions[componentIndex] ??
            annotation,
          tags: [
            s.platform,
          ].filter(Boolean),
          postId: entry.post.postId,
          component: String(componentIndex),
          componentCount:
            entry.post.componentCount || entry.files.length,
        });
      });
    });

    if (!items.length) {
      throw new Error(
        'В выбранных публикациях нет компонентов для импорта',
      );
    }

    ui.status.set('Импорт в Eagle…', `0 из ${items.length}`, true);

    const {
      created, 
      failed, 
      stopReason: eagleStopReason,
    } = await importToEagle({
      items: orderImportItemsOldestFirst(
        items,
        state.posts,
      ),
      signal: state.abortController.signal,
      onProgress: (progress) => {
        ui.status.set('Импорт в Eagle…',
          `${progress.current} из ${progress.total} — ${progress.item.name}`,
          true);

        lastProgressLead = `Импорт: ${progress.item.name}`;
        lastProgressTrail = `${progress.current} из ${progress.total}`;
        ui.status.progress.update({
          mode: 'downloading',
          lead: lastProgressLead,
          trail: lastProgressTrail,
          progress: DOWNLOAD_SHARE
            + (progress.current / progress.total) * (1 - DOWNLOAD_SHARE),
          ...publicationInfo(),
        });
      },
      onLog: (line) => ui.log.add(line),
      onCreated: async (createdEntry) => {
        state.importRecords = recordCreatedEagleItems(
          state.importRecords,
          [createdEntry],
        );

        saveImportRecords(state.importRecords);

        checkpointRecovery('importing', {
          createdEagleItems: [
            ...(recoveryState?.createdEagleItems || []),
            createdEntry,
          ],
        });
      },
    });

    const stopReason =
      downloadStopReason === INSTAGRAM_RATE_LIMITED
        ? (
          'Instagram временно ограничил запросы. ' +
          'Очередь остановлена; уже скачанные файлы добавлены в Eagle. ' +
          'Подождите и продолжите синхронизацию позже.'
        )
        : eagleStopReason;

    const knownBeforeImport = new Set(
      state.knownPostIds,
    );

    state.importRecords = recordCreatedEagleItems(
      state.importRecords,
      created,
    );

    await refreshImportRegistry();

    const importedPostIds = new Set(
      [...state.knownPostIds].filter(
        (postId) => !knownBeforeImport.has(postId),
      ),
    );

    const {
      counters: importedCounters,
    } = currentNumberingContext(s);

    rememberImportedCounterHistory(
      s,
      importedPostIds,
      importedCounters,
    );

    if (created.length) {
      resetSelectionsAfterImport(
        state.posts,
        state.selected,
      );

      checkpointRecovery('importing');
      refreshNames();
      renderTable();


      ui.log.add(
        `Создано элементов Eagle: ${created.length}. ` +
        `Полностью импортировано публикаций: ` +
        `${importedPostIds.size}`,
        'ok',
      );
    }


    const importSummary = buildImportSummary({
      postCount: importedPostIds.size,
      elementCount: created.length,
    });

    const currentSearchCompleted = allPostsImported(
      state.posts,
      state.knownPostIds,
    );

    phase = 'ready';

    ui.footer.action.setLabel(
      'Скачать и добавить в Eagle',
    );

    syncFooterActionAvailability();

    if (stopReason) {
      ui.status.set(`Импортировано: ${created.length}`, stopReason);
      /* Состояние 4 — процесс остановлен, процент убран */
      ui.status.progress.update({
        mode: 'stopped',
        lead: 'Процесс остановлен',
        trail: `Файлов добавлено: ${created.length}`,
        ...publicationInfo(),
      });
      ui.log.add(stopReason, 'err');
    } else {
      ui.status.set(
        importSummary.status,
        failed.length
          ? `${importSummary.detail} · Не удалось: ${failed.length}`
          : importSummary.detail,
      );

      /* Состояние 2 — зелёная шкала, только когда импорт
         в Eagle действительно завершён */
      ui.status.progress.update({
        mode: 'complete',
        lead: 'Импорт завершён',
        trail: importSummary.trail,
        interest: importSummary.interest,
      });

      ui.log.add(
        `Импорт завершён: ${importSummary.detail}.`,
        'ok',
      );
    }
    if (!stopReason) {
      discardRecovery();
    }

  } catch (error) {
    phase = 'ready';
    ui.footer.action.setLabel('Скачать и добавить в Eagle');

    if (error?.code === INSTAGRAM_RATE_LIMITED) {
      phase = 'ready';

      ui.footer.action.setLabel(
        'Скачать и добавить в Eagle',
      );

     ui.footer.action.setDisabled(
        state.selected.size === 0,
      );

      ui.status.set(
        'Instagram ограничил запросы',
        'Очередь остановлена. Подождите и повторите синхронизацию позже.',
      );

      ui.status.progress.update({
        mode: 'stopped',
        lead: 'Instagram ограничил запросы',
        trail: 'Файлов добавлено: 0',
        ...publicationInfo(),
      });

      ui.log.add(
        'Instagram временно ограничил запросы. ' +
        'Повторные попытки остановлены.',
        'err',
      );

      return;
    }

    /* Остановка по кнопке «стоп» — не ошибка, а состояние 4 */
    if (error?.code === STOPPED) {
      discardRecovery();
      ui.status.set('Процесс остановлен', 'Часть файлов уже скачана');
      ui.status.progress.update({
        mode: 'stopped',
        lead: 'Процесс остановлен',
        trail: 'Часть файлов уже скачана',
        ...publicationInfo(),
      });
    } else {
      ui.status.showProgress(false);
      reportRunError('Ошибка импорта', error);
    }
  } finally {
    if (sessionCookieFile) {
      removeInstagramCookieSnapshot(sessionCookieFile);
      sessionCookieFile = '';
    }
    state.abortController = null;
    control = null;
  }
}

/* Единая подача ошибок выполнения.
   Отсутствие движка показывается как понятная подсказка
   с кнопкой, а не как технический текст. */
function reportRunError(title, error) {
    if (
    error?.code === 'INSTAGRAM_ACCOUNT_MISMATCH' ||
    error?.code === 'INSTAGRAM_SESSION_INVALID'
  ) {
    const modalTitle = error.code === 'INSTAGRAM_ACCOUNT_MISMATCH'
      ? 'Выбран другой Instagram-аккаунт'
      : 'Необходимо войти в Instagram';

    /* В статусе оставляем только короткий текст — длинное
       объяснение находится в отдельном окне. */
    ui.status.set(
      modalTitle,
      'Поиск публикаций не запущен',
    );

    ui.messageModal.open({
      title: modalTitle,
      text: error.message,
    });

    ui.log.add(`Ошибка: ${error.message}`, 'err');
    return;
  }
  if (error?.code === 'TOOLCHAIN_MISSING' ||
      error?.message === 'TOOLCHAIN_MISSING') {
    const info = describeToolchainError(error);
    ui.status.set(info.title, info.text);
    ui.results.engine.setState('missing', info.title, {
      detail: info.text,
      button: 'Подготовить движок',
    });
    ui.log.add(`${info.title}: ${info.text}`, 'err');
    return;
  }
  ui.status.set(title, error.message);
  ui.log.add(`Ошибка: ${error.message}`, 'err');
}

/* ------------------------------------------------------------
   Коллекции Instagram
   ------------------------------------------------------------ */
let collectionModalResolve = null;

function openCollectionModal(
  collections,
) {
  const list = ui.modal.list;
  clear(list);

  ui.modal.title.textContent =
    'Выберите коллекции';

  const boxes = new Map();

  collections.forEach(
    (collection) => {
      const countText =
        collection.mediaCount === null
          ? ''
          : ` — ${collection.mediaCount}`;

      const box = createCheckbox({
        checked:
          state.collections.some(
            (entry) =>
              entry.id === collection.id,
          ),
        label:
          `${collection.name}${countText}`,
        onChange: () => {
          const selected =
            [...boxes.values()].some(
              (entry) =>
                entry.box.value,
            );

          ui.modal.confirm.setDisabled(
            !selected,
          );
        },
      });

      boxes.set(
        collection.id,
        {
          box,
          collection,
        },
      );

      list.appendChild(box.row);
    },
  );

  if (!collections.length) {
    list.appendChild(
      el(
        'div',
        'rs-hint',
        'Доступные коллекции не найдены.',
      ),
    );
  }

  const syncConfirm = () => {
    const selected =
      [...boxes.values()].some(
        (entry) =>
          entry.box.value,
      );

    ui.modal.confirm.setDisabled(
      !selected,
    );
  };

  ui.modal.confirmHandler = () => {
    state.collections =
      [...boxes.values()]
        .filter(
          (entry) =>
            entry.box.value,
        )
        .map((entry) => ({
          id: entry.collection.id,
          name: entry.collection.name,
          type: entry.collection.type,
          mediaCount:
            entry.collection.mediaCount,
        }));

    ui.log.add(
      `Выбрано коллекций: ${state.collections.length}`,
    );
  };

  syncConfirm();

  ui.modal.node.classList.add(
    'is-open',
  );

  return new Promise((resolve) => {
    collectionModalResolve = resolve;
  });
}

function confirmCollections() {
  if (ui.modal.confirmHandler) {
    ui.modal.confirmHandler();
  }

  const resolve =
    collectionModalResolve;

  collectionModalResolve = null;
  ui.modal.confirmHandler = null;

  ui.modal.node.classList.remove(
    'is-open',
  );

  if (resolve) {
    resolve([
      ...state.collections,
    ]);
  }
}

function closeCollectionModal(cancelled) {
  ui.modal.node.classList.remove(
    'is-open',
  );

  ui.modal.confirmHandler = null;

  const resolve =
    collectionModalResolve;

  collectionModalResolve = null;

  if (cancelled && resolve) {
    resolve(null);

    ui.log.add(
      'Выбор коллекций отменён',
      'warn',
    );
  }
}

/* ------------------------------------------------------------
   Имена и описания
   ------------------------------------------------------------ */
function refreshNames() {
  const s = state.settings;

  const {
    counters,
    counterSeeds,
  } = currentNumberingContext(s);

  state.generated = buildNames({
    posts: state.posts,

    /*
     * В нумерацию текущей очереди входят
     * только выбранные и видимые строки.
     * Скрытые выделения сохраняются в state,
     * но не занимают номера.
     */
    selected:
      selectedVisiblePostIds(),

    numberingEnabled:
      s.numberingEnabled,

    marker:
      s.numberingMarker,

    /*
     * Оставлено только для совместимости
     * со старым API buildNames().
     */
    startNumber:
      s.numberingStart,

    counters,
    counterSeeds,

    destination:
      s.numberingDestination,

    descriptionEnabled:
      s.descriptionEnabled,

    descriptionDestination:
      s.descriptionDestination,

    descriptionPlacement:
      s.descriptionPlacement,

    extraDescription:
      s.extraDescription,
  });
}

function componentNumbersFromPositions(post, positions) {
  return [...positions]
    .sort((left, right) => left - right)
    .map((position) => {
      const component = post.components?.[position];
      const componentNumber = Number(component?.index);

      return Number.isInteger(componentNumber) &&
        componentNumber > 0
        ? componentNumber
        : position + 1;
    });
}

function currentCarouselState(post) {
  if (
    Number(post?.componentCount) <= 1 ||
    !Array.isArray(post?.components)
  ) {
    return null;
  }

  const record = state.importRecords.get(post.postId);
  const imported = importedComponentPositions(record);

  const saved = Array.isArray(post.selectedComponents)
    ? post.selectedComponents
    : undefined;

  return carouselSelectionState(
    post,
    saved,
    imported,
  );
}

function setCarouselPositions(post, positions) {
  post.selectedComponents = componentNumbersFromPositions(
    post,
    positions,
  );
}

/* ------------------------------------------------------------
   Таблица результатов
   ------------------------------------------------------------ */
const tableSelectionGesture =
  createCheckboxGestureState();

const tableCheckboxes = new Map();

const tableRangePreviewIds = new Set();

let tableSelectionChanged = false;

let tableSelectionHistoryChanges = null;

function tablePostSelectionSnapshot(post) {
  return {
    selected:
      state.selected.has(post.postId),

    components:
      Array.isArray(post.selectedComponents)
        ? [...post.selectedComponents]
        : undefined,
  };
}

function sameSelectionSnapshot(
  first,
  second,
) {
  if (
    first.selected !== second.selected
  ) {
    return false;
  }

  if (
    first.components === undefined &&
    second.components === undefined
  ) {
    return true;
  }

  if (
    !Array.isArray(first.components) ||
    !Array.isArray(second.components) ||
    first.components.length !==
      second.components.length
  ) {
    return false;
  }

  return first.components.every(
    (value, index) =>
      value === second.components[index],
  );
}

function beginTableSelectionHistory() {
  if (!tableSelectionHistoryChanges) {
    tableSelectionHistoryChanges =
      new Map();
  }
}

function captureTableSelectionHistory(
  post,
  before,
) {
  if (!tableSelectionHistoryChanges) {
    return;
  }

  const previous =
    tableSelectionHistoryChanges.get(
      post.postId,
    );

  tableSelectionHistoryChanges.set(
    post.postId,
    {
      postId: post.postId,
      before:
        previous?.before || before,
      after:
        tablePostSelectionSnapshot(post),
    },
  );
}

function finishTableSelectionHistory() {
  if (!tableSelectionHistoryChanges) {
    return false;
  }

  const changes = [
    ...tableSelectionHistoryChanges.values(),
  ].filter((change) =>
    !sameSelectionSnapshot(
      change.before,
      change.after,
    ),
  );

  tableSelectionHistoryChanges = null;

  return recordSelectionChange(changes);
}

let tableAutoScrollFrame = null;
let tablePointerX = 0;
let tablePointerY = 0;

const TABLE_SCROLL_EDGE = 48;
const TABLE_SCROLL_MAX_SPEED = 18;

function stopTableAutoScroll() {
  if (tableAutoScrollFrame !== null) {
    cancelAnimationFrame(tableAutoScrollFrame);
    tableAutoScrollFrame = null;
  }
}

function visitTablePostDuringDrag(post) {
  if (
    !post ||
    state.knownPostIds.has(post.postId) ||
    !tableSelectionGesture.isDragging()
  ) {
    return false;
  }

  const action =
    tableSelectionGesture.visitDrag(
      post.postId,
    );

  if (!action) {
    return false;
  }

  setTablePostChecked(
    post,
    action.checked,
  );

  syncTablePostCheckbox(post);

  tableSelectionChanged = true;

  return true;
}

function tablePostAtPointer() {
  const body = ui.results?.body;

  if (!body) {
    return null;
  }

  const rect = body.getBoundingClientRect();

  const sampleX = Math.min(
    rect.right - 1,
    Math.max(rect.left + 1, tablePointerX),
  );

  const sampleY = Math.min(
    rect.bottom - 1,
    Math.max(rect.top + 1, tablePointerY),
  );

  const target = document.elementFromPoint(
    sampleX,
    sampleY,
  );

  const row = target?.closest?.(
    '[data-table-post-id]',
  );

  if (!row || !body.contains(row)) {
    return null;
  }

  return tableCheckboxes.get(
    row.dataset.tablePostId,
  )?.post || null;
}

function runTableAutoScroll() {
  tableAutoScrollFrame = null;

  if (!tableSelectionGesture.isDragging()) {
    return;
  }

  const body = ui.results?.body;

  if (!body) {
    return;
  }

  const rect = body.getBoundingClientRect();

  const insideHorizontal =
    tablePointerX >= rect.left &&
    tablePointerX <= rect.right;

  const insideVertical =
    tablePointerY >= rect.top - TABLE_SCROLL_EDGE &&
    tablePointerY <= rect.bottom + TABLE_SCROLL_EDGE;

  if (!insideHorizontal || !insideVertical) {
    return;
  }

  let speed = 0;

  if (
    tablePointerY <
    rect.top + TABLE_SCROLL_EDGE
  ) {
    const strength = Math.min(
      1,
      (
        rect.top +
        TABLE_SCROLL_EDGE -
        tablePointerY
      ) / TABLE_SCROLL_EDGE,
    );

    speed =
      -TABLE_SCROLL_MAX_SPEED * strength;
  } else if (
    tablePointerY >
    rect.bottom - TABLE_SCROLL_EDGE
  ) {
    const strength = Math.min(
      1,
      (
        tablePointerY -
        (
          rect.bottom -
          TABLE_SCROLL_EDGE
        )
      ) / TABLE_SCROLL_EDGE,
    );

    speed =
      TABLE_SCROLL_MAX_SPEED * strength;
  }

  if (speed === 0) {
    return;
  }

  const previousScrollTop =
    body.scrollTop;

  body.scrollTop += speed;

  visitTablePostDuringDrag(
    tablePostAtPointer(),
  );

  if (
    body.scrollTop !== previousScrollTop &&
    tableSelectionGesture.isDragging()
  ) {
    tableAutoScrollFrame =
      requestAnimationFrame(
        runTableAutoScroll,
      );
  }
}

function startTableAutoScroll() {
  if (
    tableAutoScrollFrame !== null ||
    !tableSelectionGesture.isDragging()
  ) {
    return;
  }

  tableAutoScrollFrame =
    requestAnimationFrame(
      runTableAutoScroll,
    );
}

function updateTableDragPointer(event) {
  if (!tableSelectionGesture.isDragging()) {
    return;
  }

  if ((event.buttons & 1) !== 1) {
    finishTableSelectionGesture();
    return;
  }

  tablePointerX = event.clientX;
  tablePointerY = event.clientY;

  startTableAutoScroll();
}

function tablePostVisualState(post) {
  const isKnown =
    state.knownPostIds.has(post.postId);

  const carouselState =
    currentCarouselState(post);

  const selected =
    !isKnown &&
    state.selected.has(post.postId) &&
    (
      !carouselState ||
      carouselState.selectedCount > 0
    );

  return {
    selected,

    checked: carouselState
      ? selected && carouselState.checked
      : selected,

    mixed: Boolean(
      carouselState &&
      selected &&
      carouselState.mixed
    ),

    carouselState,
  };
}

function nextTablePostState(post) {
  const current = tablePostVisualState(post);
  const carouselState = current.carouselState;

  if (!carouselState) {
    return !current.selected;
  }

  if (current.mixed) {
    const allAvailableSelected =
      carouselState.availableCount > 0 &&
      carouselState.selectedCount ===
        carouselState.availableCount;

    return !allAvailableSelected;
  }

  return !current.checked;
}

function setTablePostChecked(post, checked) {
  if (
    !post ||
    state.knownPostIds.has(post.postId)
  ) {
    return;
  }

  const before =
    tablePostSelectionSnapshot(post);

  const carouselState =
    currentCarouselState(post);

  if (carouselState) {
    setCarouselPositions(
      post,
      checked
        ? carouselState.available
        : new Set(),
    );

    if (
      checked &&
      carouselState.availableCount > 0
    ) {
      state.selected.add(post.postId);
    } else {
      state.selected.delete(post.postId);
    }

    captureTableSelectionHistory(
      post,
      before,
    );

    return;
  }

  if (checked) {
    state.selected.add(post.postId);
  } else {
    state.selected.delete(post.postId);
  }

  captureTableSelectionHistory(
    post,
    before,
  );
}

function syncTablePostCheckbox(post) {
  const entry =
    tableCheckboxes.get(post.postId);

  if (!entry) return;

  const visual =
    tablePostVisualState(post);

  entry.checkbox.set(
    visual.checked,
    true,
  );

  entry.checkbox.setMixed(
    visual.mixed,
  );

  entry.row.classList.toggle(
    'is-selected',
    visual.selected,
  );
}

function pressTableRange(
  affectedIds,
  pressedState,
) {
  const anchorId =
    tableSelectionGesture.getAnchor();

  for (const postId of affectedIds) {
    /*
     * Anchor уже был переключён первым кликом.
     * При последующем Shift-click он не должен
     * получать временное Pressed-состояние.
     */
    if (postId === anchorId) {
      continue;
    }

    const entry = tableCheckboxes.get(postId);

    if (
      !entry ||
      state.knownPostIds.has(postId)
    ) {
      continue;
    }

    entry.checkbox.setPressedFrom(
      pressedState,
    );
  }
}

function clearTableRangePreview() {
  for (
    const postId
    of tableRangePreviewIds
  ) {
    tableCheckboxes
      .get(postId)
      ?.checkbox.node.classList.remove(
        'is-range-preview',
      );
  }

  tableRangePreviewIds.clear();
}

function previewTableRange(targetPostId) {
  const anchorPostId =
    tableSelectionGesture.getAnchor();

  if (
    !anchorPostId ||
    !targetPostId
  ) {
    clearTableRangePreview();
    return;
  }

  const orderedPostIds = [
    ...tableCheckboxes.keys(),
  ];

  const range = checkboxRange(
    orderedPostIds,
    anchorPostId,
    targetPostId,
  );

  clearTableRangePreview();

  for (const postId of range) {
    if (
      postId === tableSelectionGesture.getAnchor()
    ) {
      continue;
    }
    
    const entry =
      tableCheckboxes.get(postId);

    if (
      !entry ||
      state.knownPostIds.has(postId)
    ) {
      continue;
    }

    entry.checkbox.node.classList.add(
      'is-range-preview',
    );

    tableRangePreviewIds.add(postId);
  }
}

const TABLE_SELECTION_BATCH_SIZE = 100;

let tableSelectionSyncFrame = null;
let tableSelectionSyncVersion = 0;

let tableSelectionTitleFrame = null;
let tableSelectionTitleNextFrame = null;

function selectedVisiblePostCount(posts) {
  let count = 0;

  for (const post of posts) {
    if (state.selected.has(post.postId)) {
      count += 1;
    }
  }

  return count;
}

function selectedImportablePostCount() {
  return selectImportablePosts(
    visiblePosts(),
    state.selected,
    state.knownPostIds,
  ).length;
}

function syncFooterActionAvailability() {
  if (phase !== 'ready') {
    return;
  }

  ui.footer.action.setDisabled(
    selectedImportablePostCount() === 0,
  );
}

function updateTableSelectionTitle(
  posts = visiblePosts(),
) {
  ui.results.setTitle(
    selectedVisiblePostCount(posts),
    posts.length,
  );

  syncFooterActionAvailability();
}

function scheduleTableSelectionTitleUpdate() {
  if (
    tableSelectionTitleFrame !== null ||
    tableSelectionTitleNextFrame !== null
  ) {
    return;
  }

  /*
   * Первый кадр отображает состояние чекбокса.
   * Во втором обновляется общий счётчик таблицы.
   *
   * Это не даёт заголовку большой таблицы задерживать
   * визуальную реакцию одиночного чекбокса.
   */
  tableSelectionTitleFrame =
    requestAnimationFrame(() => {
      tableSelectionTitleFrame = null;

      tableSelectionTitleNextFrame =
        requestAnimationFrame(() => {
          tableSelectionTitleNextFrame = null;
          updateTableSelectionTitle();
        });
    });
}

function stopTableSelectionTitleUpdate() {
  if (tableSelectionTitleFrame !== null) {
    cancelAnimationFrame(
      tableSelectionTitleFrame,
    );

    tableSelectionTitleFrame = null;
  }

  if (
    tableSelectionTitleNextFrame !== null
  ) {
    cancelAnimationFrame(
      tableSelectionTitleNextFrame,
    );

    tableSelectionTitleNextFrame = null;
  }
}

function stopTableSelectionSync() {
  tableSelectionSyncVersion += 1;

  if (tableSelectionSyncFrame !== null) {
    cancelAnimationFrame(
      tableSelectionSyncFrame,
    );

    tableSelectionSyncFrame = null;
  }
}

function syncTableSelectionInBatches() {
  stopTableSelectionSync();

  const version =
    tableSelectionSyncVersion;

  const posts = [
    ...tableCheckboxes.values(),
  ]
    .map((entry) => entry.post)
    .filter(Boolean);

  let position = 0;

  function syncBatch() {
    if (
      version !==
      tableSelectionSyncVersion
    ) {
      return;
    }

    const end = Math.min(
      position +
        TABLE_SELECTION_BATCH_SIZE,
      posts.length,
    );

    while (position < end) {
      syncTablePostCheckbox(
        posts[position],
      );

      position += 1;
    }

    if (position < posts.length) {
      tableSelectionSyncFrame =
        requestAnimationFrame(
          syncBatch,
        );

      return;
    }

    tableSelectionSyncFrame = null;
  }

  syncBatch();
}

function applyTableShiftSelection(
  targetPost,
  checked,
) {
  const posts = visiblePosts();

  const result = applyShiftSelection({
    orderedIds: posts.map(
      (post) => post.postId,
    ),

    selectedIds: state.selected,

    anchorId:
      tableSelectionGesture.getAnchor(),

    targetId: targetPost.postId,
    checked,

    disabledIds: new Set(
      posts
        .filter((post) =>
          state.knownPostIds.has(post.postId))
        .map((post) => post.postId),
    ),
  });

  const postsById = new Map(
    posts.map((post) => [
      post.postId,
      post,
    ]),
  );

  result.affectedIds.forEach((postId) => {
    const post = postsById.get(postId);

    if (
      !post ||
      state.knownPostIds.has(postId)
    ) {
      return;
    }

    setTablePostChecked(post, checked);
    syncTablePostCheckbox(post);
  });

  tableSelectionGesture.setAnchor(
    result.anchorId,
  );

  tableSelectionChanged = true;
  return result;
}

function finishTableSelectionGesture() {
  stopTableAutoScroll();
  tableSelectionGesture.endDrag();
  finishTableSelectionHistory();

  if (!tableSelectionChanged) {
    return;
  }

  tableSelectionChanged = false;

  scheduleTableSelectionTitleUpdate();
}

window.addEventListener(
  'pointermove',
  updateTableDragPointer,
);

window.addEventListener(
  'pointerup',
  finishTableSelectionGesture,
);

window.addEventListener(
  'keyup',
  (event) => {
    if (event.key === 'Shift') {
      clearTableRangePreview();
    }
  },
);

window.addEventListener(
  'blur',
  clearTableRangePreview,
);

window.addEventListener(
  'pointercancel',
  finishTableSelectionGesture,
);

window.addEventListener(
  'blur',
  finishTableSelectionGesture,
);

function syncTableThumbnailVisibility() {
  ui.results?.node?.classList.toggle(
    'is-thumbnails-hidden',
    !state.settings.thumbnails,
  );
}

function collectionPostSelectable(post) {
  /*
   * Здесь намеренно используется тот же источник истины,
   * что и в существующей таблице: публикация выбирается
   * через state.selected.
   *
   * Уже импортированную публикацию можно повторно выбрать,
   * только если в Eagle отсутствует хотя бы один компонент.
   */
  const imported =
    state.knownPostIds.has(post.postId);

  const hasMissingComponents =
    state.missingComponents.has(
      post.postId,
    );

  return (
    !imported ||
    hasMissingComponents
  );
}

function applyCollectionSelectionChanges(
  changes,
) {
  if (!Array.isArray(changes)) {
    return;
  }

  const effectiveChanges =
    changes.filter((change) => {
      const post =
        state.posts.find(
          (item) =>
            item.postId ===
              change.postId,
        );

      return (
        post &&
        collectionPostSelectable(post)
      );
    });

  if (!effectiveChanges.length) {
    return;
  }

  for (
    const change of
      effectiveChanges
  ) {
    if (change.after.selected) {
      state.selected.add(
        change.postId,
      );
    } else {
      state.selected.delete(
        change.postId,
      );
    }
  }

  recordSelectionChange(
    effectiveChanges,
  );

  refreshNames();
  renderTable();
}

function createCollectionFolderIcon() {
  const icon =
    el(
      'span',
      'rs-collection__folder',
    );

  icon.setAttribute(
    'aria-hidden',
    'true',
  );

  return icon;
}

function createCollectionChevron(
  expanded,
) {
  const chevron =
    el(
      'span',
      'rs-collection__chevron',
    );

  chevron.setAttribute(
    'aria-hidden',
    'true',
  );

  chevron.classList.toggle(
    'is-expanded',
    expanded,
  );

  return chevron;
}

function createCollectionHeader(
  group,
) {
  const collapsed =
    collapsedCollectionIds.has(
      group.id,
    );

  const selection =
    collectionSelectionState(
      group.posts,
      state.selected,
      collectionPostSelectable,
    );

  const root =
    el(
      'div',
      'rs-collection__head',
    );

  root.classList.toggle(
    'is-selected',
    selection.selectedCount > 0,
  );

  root.setAttribute(
    'role',
    'button',
  );

  root.setAttribute(
    'tabindex',
    '0',
  );

  root.setAttribute(
    'aria-expanded',
    String(!collapsed),
  );

  const checkbox =
    createCheckbox({
      checked:
        selection.checked,

      mixed:
        selection.mixed,

      disabled:
        selection.disabled,

      onChange() {
        const changes =
          collectionSelectionChanges(
            group.posts,
            state.selected,
            collectionPostSelectable,
          );

        applyCollectionSelectionChanges(
          changes,
        );
      },
    });

  /*
   * Нажатие checkbox не должно одновременно сворачивать папку.
   */
  checkbox.node.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();
    },
  );

  checkbox.node.addEventListener(
    'keydown',
    (event) => {
      event.stopPropagation();
    },
  );

  const identity =
    el(
      'div',
      'rs-collection__identity',
    );

  const name =
    el(
      'span',
      'rs-collection__name',
      group.name,
    );

  const count =
    el(
      'span',
      'rs-collection__count',
      String(group.posts.length),
    );

  identity.append(
    createCollectionFolderIcon(),
    name,
    count,
  );

  const chevron =
    createCollectionChevron(
      !collapsed,
    );

  const toggle = () => {
    if (
      collapsedCollectionIds.has(
        group.id,
      )
    ) {
      collapsedCollectionIds.delete(
        group.id,
      );
    } else {
      collapsedCollectionIds.add(
        group.id,
      );
    }

    renderTable();
  };

  root.addEventListener(
    'click',
    toggle,
  );

  root.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !== 'Enter' &&
        event.key !== ' '
      ) {
        return;
      }

      event.preventDefault();
      toggle();
    },
  );

  root.append(
    checkbox.node,
    identity,
    chevron,
  );

  return root;
}

function renderCollectionGroups({
  container,
  groups,
  createPostRow,
}) {
  for (const group of groups) {
    const collection =
      el(
        'section',
        'rs-collection',
      );

    const header =
      createCollectionHeader(
        group,
      );

    const children =
      el(
        'div',
        'rs-collection__children',
      );

    const collapsed =
      collapsedCollectionIds.has(
        group.id,
      );

    collection.classList.toggle(
      'is-collapsed',
      collapsed,
    );

    for (const post of group.posts) {
      const wrapper =
        el(
          'div',
          'rs-collection__post',
        );

      wrapper.classList.toggle(
        'is-selected',
        state.selected.has(
          post.postId,
        ),
      );

      const branch =
        el(
          'span',
          'rs-collection__branch',
        );

      branch.setAttribute(
        'aria-hidden',
        'true',
      );

      wrapper.append(
        branch,
        createPostRow(post),
      );

      children.appendChild(
        wrapper,
      );
    }

    collection.append(
      header,
      children,
    );

    container.appendChild(
      collection,
    );
  }
}

function renderTable() {
  syncTableThumbnailVisibility();

  stopTableSelectionSync();
  stopTableSelectionTitleUpdate();
  clearTableRangePreview();

  const body = ui.results.body;
  clear(body);
  tableCheckboxes.clear();

  const posts = visiblePosts();
  const folderTableEnabled =
    state.settings.folderSearch === true &&
    state.collections.length > 0;

  const collectionGroups =
    groupPostsByCollection(
      posts,
      state.collections,
      folderTableEnabled,
    );

  const tableRenderVersion =
    ++collectionTableRenderVersion;

  /*
   * Существующий код renderTable() ниже самостоятельно создаёт
   * рабочие строки публикаций со всеми обработчиками.
   *
   * После завершения синхронного рендера забираем эти готовые
   * строки и помещаем их внутрь веток коллекций.
   */
  if (
    folderTableEnabled &&
    collectionGroups.length > 0 &&
    posts.length > 0
  ) {
    Promise.resolve().then(() => {
      /*
       * Если renderTable() уже запускался повторно,
       * этот результат использовать нельзя.
       */
      if (
        tableRenderVersion !==
        collectionTableRenderVersion
      ) {
        return;
      }

      const renderedRows =
        Array.from(
          ui.results.body.children,
        );

      /*
       * Защитный режим: если штатный рендер создал другое
       * количество элементов, оставляем плоскую таблицу.
       */
      if (
        renderedRows.length !==
        posts.length
      ) {
        return;
      }

      const rowsByPostId =
        new Map();

      posts.forEach(
        (post, index) => {
          rowsByPostId.set(
            String(post.postId),
            renderedRows[index],
          );
        },
      );

      const allRowsAvailable =
        collectionGroups.every(
          (group) =>
            group.posts.every(
              (post) =>
                rowsByPostId.has(
                  String(post.postId),
                ),
            ),
        );

      if (!allRowsAvailable) {
        return;
      }

      renderCollectionGroups({
        container:
          ui.results.body,

        groups:
          collectionGroups,

        createPostRow:
          (post) =>
            rowsByPostId.get(
              String(post.postId),
            ),
      });
    });
  }
  updateTableSelectionTitle(posts);
  ui.results.clearButton.setDisabled(!posts.length);
  if (phase === 'ready') {
    ui.footer.action.setDisabled(
      state.selected.size === 0,
    );
  }
  ui.results.resetAllButton.node.style.display = hasEdits() ? '' : 'none';

  /* Состояние чекбокса «Выбрать всё» */
  const selectedVisible = posts.filter((post) => state.selected.has(post.postId));
  if (!posts.length) ui.results.selectAll.set(false, true);
  else if (selectedVisible.length === posts.length) ui.results.selectAll.set(true, true);
  else if (selectedVisible.length) ui.results.selectAll.setMixed(true);
  else ui.results.selectAll.set(false, true);

  if (!posts.length) {
    const empty = el('div', 'rs-empty');
    empty.append(
      el('div', 'rs-empty__title', 'Список пуст'),
      el('div', 'rs-empty__text',
        state.posts.length
          ? 'Все публикации скрыты фильтрами. Измените условия в шаге 2.'
          : 'Заполните шаг 1, выберите режим поиска и нажмите «Начать поиск».'),
    );
    body.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  posts.forEach((post) => fragment.appendChild(renderRow(post)));
  body.appendChild(fragment);
}

function renderRow(post) {
  const row = el('div', 'rs-row');
  const isKnown = state.knownPostIds.has(post.postId);

  row.classList.toggle('is-imported', isKnown);

  if (isKnown) {
    row.title = 'Эта публикация уже добавлена в Eagle';
  }
const grid = el('div', 'rs-table__grid');
const carouselState = currentCarouselState(post);
const isCarousel = carouselState !== null;

const isSelected =
  !isKnown &&
  state.selected.has(post.postId) &&
  (!isCarousel || carouselState.selectedCount > 0);

const parentChecked = isCarousel
  ? isSelected && carouselState.checked
  : isSelected;

const parentMixed = Boolean(
  isCarousel &&
  isSelected &&
  carouselState.mixed,
);

row.classList.toggle('is-selected', isSelected);

/* 1 колонка: чекбокс + миниатюра */
const lead = el('div', 'rs-row__lead');

const checkbox = createCheckbox({
  checked: parentChecked,
  mixed: parentMixed,
  disabled: isKnown,

  onChange: (value, event) => {
    beginTableSelectionHistory();
    const checked = parentMixed
      ? nextTablePostState(post)
      : value;

    if (event?.shiftKey) {
      clearTableRangePreview();
      applyTableShiftSelection(
        post,
        checked,
      );
    } else {
      setTablePostChecked(
        post,
        checked,
      );

      tableSelectionGesture.setAnchor(
        post.postId,
      );

      syncTablePostCheckbox(post);
    }

    finishTableSelectionHistory();
    scheduleTableSelectionTitleUpdate();
  },

  onPointerDown: (event) => {
    if (isKnown) {
      return false;
    }

    beginTableSelectionHistory();

    const checked =
      nextTablePostState(post);

    if (event.shiftKey) {
      clearTableRangePreview();

      const result = applyTableShiftSelection(
        post,
        checked,
      );

      pressTableRange(
        result?.affectedIds || [post.postId],
        checked ? 'off' : 'on',
      );

      return true;
    }

    clearTableRangePreview();

    tableSelectionGesture.beginDrag(
      post.postId,
      checked,
    );

    updateTableDragPointer(event);

    setTablePostChecked(
      post,
      checked,
    );

    syncTablePostCheckbox(post);

    tableSelectionChanged = true;

    return true;
  },

  onPointerEnter: (event) => {
    if (
      isKnown ||
      !tableSelectionGesture.isDragging()
    ) {
      return false;
    }

    updateTableDragPointer(event);

    return visitTablePostDuringDrag(post);
  },
});

row.dataset.tablePostId =
  post.postId;

tableCheckboxes.set(
  post.postId,
  {
    checkbox,
    row,
    post,
  },
);

row.addEventListener(
  'pointerenter',
  (event) => {
    /*
     * M1-T08H:
     * во время протягивания достаточно пересечь
     * любую часть строки, а не сам чекбокс.
     */
    if (
      tableSelectionGesture.isDragging()
    ) {
      updateTableDragPointer(event);
      visitTablePostDuringDrag(post);
      return;
    }

    /*
     * M1-T08G:
     * Shift без нажатой кнопки мыши показывает
     * диапазон, который применится по клику.
     */
    if (event.shiftKey) {
      previewTableRange(post.postId);
    }
  },
);

if (isKnown) {
  checkbox.node.classList.add('is-disabled');
  checkbox.node.setAttribute('aria-disabled', 'true');
  checkbox.node.setAttribute('tabindex', '-1');
}

  const thumb = el('div', 'rs-thumb');
  if (state.settings.thumbnails && post.previewUrl) {
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.src = post.previewUrl;
    image.alt = '';
    image.addEventListener('error', () => {
      thumb.classList.add('is-empty');
      thumb.removeChild(image);
    });
    thumb.appendChild(image);
  } else {
    thumb.classList.add('is-empty');
  }

  lead.append(checkbox.node, thumb);

  /* Текстовые колонки */
  const author = el('div', 'rs-cell rs-cell--author', post.username);
  author.title = post.url;
  const type = el('div', 'rs-cell', post.type);

  const structure = el(
    'div',
    carouselState
    ? 'rs-cell rs-cell--carousel'
    : 'rs-cell',
  );

  if (carouselState) {
    const carouselButton = el(
      'div',
      'rs-carousel-button',
    );

    const carouselDisabled =
      isKnown ||
      carouselState.disabled;

    carouselButton.classList.toggle(
      'is-disabled',
      carouselDisabled,
    );

    carouselButton.setAttribute(
      'aria-disabled',
      String(carouselDisabled),
    );

    const carouselLabel = el(
      'span',
      'rs-carousel-button__label',
      post.type,
    );

    const carouselCount = el(
      'span',
      'rs-carousel-button__count',
      `${carouselState.selectedCount}/${carouselState.total}`,
    );

    carouselButton.append(
      carouselLabel,
      carouselCount,
    );

    structure.appendChild(carouselButton);
  } else {
    structure.textContent = post.type;
  }

  if (
    post.componentCount > 1 &&
    !isKnown &&
    !carouselState?.disabled
  ) {
    structure.classList.add('is-clickable');
    structure.title = 'Настроить компоненты публикации';

    structure.addEventListener('click', () => {
      const latestState = currentCarouselState(post);

      ui.carouselModal.open({
        post,
        selection: latestState?.selected || new Set(),
      thumbnails: state.settings.thumbnails,
      importedPositions:
        latestState?.imported || new Set(),

      onConfirm: (selection) => {
        const available =
          latestState?.available ||
          availableComponentPositions(post);

        const selectedPositions = new Set(
          [...selection]
            .map(Number)
            .filter((position) => (
              Number.isInteger(position) &&
              available.has(position)
            )),
          );

          setCarouselPositions(
            post,
            selectedPositions,
          );

          if (selectedPositions.size) {
            state.selected.add(post.postId);
          } else {
            state.selected.delete(post.postId);
          }

          refreshNames();
          renderTable();
        },

        onCancel: () => {},
      });
    });
  }

  /* Название редактируется только до полного импорта */
const nameCell = el(
  'div',
  'rs-cell rs-cell--name',
);

const nameText = el(
  'div',
  'rs-cell__text',
);

nameCell.classList.toggle(
  'is-edited',
  !isKnown &&
    isEdited(post.postId, 'name'),
);

nameCell.classList.toggle(
  'is-disabled',
  isKnown,
);

nameText.textContent = cellValue(
  post.postId,
  'name',
);

nameCell.appendChild(nameText);

if (!isKnown) {
  const openNameEditor = () => {
    startEdit(
      nameText,
      post.postId,
      'name',
      true,
    );
  };

  const nameEditButton =
    createEditButton(openNameEditor);

  nameCell.appendChild(
    nameEditButton,
  );

  nameCell.title =
    'Двойной щелчок — редактировать';

    nameCell.addEventListener(
    'dblclick',
    (event) => {
      /*
       * Двойной клик работает по всей площади ячейки,
       * но не запускает второй редактор поверх открытого.
       */
      if (
        event.target.closest?.(
          '.rs-edit, .rs-editable',
        )
      ) {
        return;
      }

      openNameEditor();
    },
  );
} else {
  nameCell.setAttribute(
    'aria-disabled',
    'true',
  );
}

  /* Описание редактируется только до полного импорта */
  const descCell = el(
    'div',
    'rs-cell rs-cell--desc',
  );

  const isIndependentCellTarget = (target) =>
  Boolean(
    target.closest?.(
      [
        '.rs-cell--name',
        '.rs-cell--desc',
        '.rs-edit',
        '.rs-editable',
        '.rs-cell.is-clickable',
        '.rs-check',
      ].join(','),
    ),
  );

  let suppressNextRowClick = false;

  row.addEventListener(
    'click',
    (event) => {
      /*
      * Shift-действие уже выполнено на pointerdown.
      * Последующий click не должен повторно менять выбор.
      */
      if (suppressNextRowClick) {
        suppressNextRowClick = false;

        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (
        isKnown ||
        isIndependentCellTarget(event.target)
      ) {
        return;
      }

      /*
      * Защитный fallback: Shift обрабатывается только
      * pointerdown-веткой ниже.
      */
      if (event.shiftKey) {
        event.preventDefault();
        return;
      }

      const checked =
        !state.selected.has(post.postId);

      checkbox.set(checked);

      event.preventDefault();
    },
  );

  const clearRowPressed = () => {
    row.classList.remove('is-row-pressed');
  };

  row.addEventListener(
    'pointerdown',
    (event) => {
      if (
        event.button !== 0 ||
        isKnown ||
        isIndependentCellTarget(event.target)
      ) {
        return;
      }

      row.classList.add('is-row-pressed');

      window.addEventListener(
        'pointerup',
        clearRowPressed,
        { once: true },
      );

      window.addEventListener(
        'pointercancel',
        () => {
          suppressNextRowClick = false;
          clearRowPressed();
        },
        { once: true },
      );

      window.addEventListener(
        'blur',
        () => {
          suppressNextRowClick = false;
          clearRowPressed();
        },
        { once: true },
      );

      if (!event.shiftKey) {
        return;
      }

      const checked =
        !state.selected.has(post.postId);

      clearTableRangePreview();

      const result = applyTableShiftSelection(
        post,
        checked,
      );

      pressTableRange(
        result?.affectedIds || [post.postId],
        checked ? 'off' : 'on',
      );

      /*
      * Не позволяем следующему click повторно
      * переключить строку после pointerup.
      */
      suppressNextRowClick = true;

      event.preventDefault();
      event.stopPropagation();
    },
  );

  const descText = el(
    'div',
    'rs-desc__text rs-cell__text',
    cellValue(post.postId, 'description'),
  );

  descCell.classList.toggle(
    'is-edited',
    !isKnown &&
    isEdited(post.postId, 'description'),
  );

  descCell.classList.toggle(
    'is-disabled',
    isKnown,
  );

  descCell.appendChild(descText);

  if (isKnown) {
    descCell.setAttribute(
      'aria-disabled',
      'true',
    );
  } else {
    const openDescriptionEditor = () => {
      startEdit(
        descText,
        post.postId,
        'description',
        true,
      );
    };

    const descEditButton =
      createEditButton(
        openDescriptionEditor,
      );

    descCell.appendChild(
      descEditButton,
    );

    descCell.title =
      'Двойной щелчок — редактировать';

    descCell.addEventListener(
      'dblclick',
      (event) => {
        /*
         * Двойной клик работает по всей площади ячейки,
         * но не создаёт новый редактор внутри открытого.
         */
        if (
          event.target.closest?.(
            '.rs-edit, .rs-editable',
          )
        ) {
          return;
        }

        openDescriptionEditor();
      },
    );
  }

  grid.append(lead, author, type, structure, nameCell, descCell);
  row.appendChild(grid);
  return row;
}

/* Редактирование ячейки на месте */
function startEdit(node, postId, field, multiline = false) {
  if (
    node.querySelector(
      '.rs-editable',
    )
  ) {
    return;
  }

  const current = cellValue(postId, field);

  const editor = document.createElement(multiline ? 'textarea' : 'input');
  editor.className = 'rs-editable';
  editor.value = current;

  node.replaceChildren(editor);
  editor.focus();
  editor.select();

    /*
   * Локальная посимвольная история открытого редактора.
   * В Eagle нельзя полагаться на системный Undo textarea.
   */
  const EDITOR_HISTORY_LIMIT = 100;
  const editorHistory = [editor.value];
  let editorHistoryIndex = 0;
  let restoringEditorHistory = false;

  const restoreEditorValue = (nextIndex) => {
    if (
      nextIndex < 0 ||
      nextIndex >= editorHistory.length
    ) {
      return false;
    }

    restoringEditorHistory = true;
    editorHistoryIndex = nextIndex;
    editor.value =
      editorHistory[editorHistoryIndex];

    const caret = editor.value.length;

    editor.setSelectionRange(
      caret,
      caret,
    );

    restoringEditorHistory = false;
    return true;
  };

  editor.addEventListener(
    'input',
    () => {
      if (restoringEditorHistory) {
        return;
      }

      const value = editor.value;

      if (
        editorHistory[editorHistoryIndex] ===
        value
      ) {
        return;
      }

      editorHistory.splice(
        editorHistoryIndex + 1,
      );

      editorHistory.push(value);
      editorHistoryIndex += 1;

      if (
        editorHistory.length >
        EDITOR_HISTORY_LIMIT
      ) {
        const removeCount =
          editorHistory.length -
          EDITOR_HISTORY_LIMIT;

        editorHistory.splice(0, removeCount);
        editorHistoryIndex -= removeCount;
      }
    },
  );

  const commit = () => {
    const value = editor.value;
    if (value !== current) applyEdit(postId, field, value);
    refreshNames();
    renderTable();
  };

  editor.addEventListener('blur', commit);
  editor.addEventListener('keydown', (event) => {
        const modifier =
      event.ctrlKey ||
      event.metaKey;

    const key =
      String(event.key || '')
        .toLowerCase();

    if (
      modifier &&
      key === 'z'
    ) {
      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) {
        restoreEditorValue(
          editorHistoryIndex + 1,
        );
      } else {
        restoreEditorValue(
          editorHistoryIndex - 1,
        );
      }

      return;
    }

    if (
      modifier &&
      !event.shiftKey &&
      key === 'y'
    ) {
      event.preventDefault();
      event.stopPropagation();

      restoreEditorValue(
        editorHistoryIndex + 1,
      );

      return;
    }
    /* Escape фиксирует правку, как в Python-версии */
    if (event.key === 'Escape' || (event.key === 'Enter' && !multiline)) {
      event.preventDefault();
      editor.blur();
    }
    if (event.key === 'Enter' && multiline && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      editor.blur();
    }
  });
}

function toggleAll(value) {
  tableSelectionGesture.reset();
  beginTableSelectionHistory();
  stopTableAutoScroll();
  stopTableSelectionSync();

  const posts = visiblePosts();

  posts.forEach((post) => {
    setTablePostChecked(
      post,
      value,
    );
  });

  finishTableSelectionHistory();

  updateTableSelectionTitle();
  syncTableSelectionInBatches();
}

function clearResults() {
  state.posts = [];
  state.selected.clear();
  state.generated.clear();
  resetAllEdits();
  phase = 'idle';
  ui.footer.action.setLabel('Начать поиск');
  ui.footer.action.setDisabled(false);
  ui.status.set('Список очищен', 'Заполните шаг 1 и нажмите «Начать поиск»');
  renderTable();
}

/* ------------------------------------------------------------
   Горячие клавиши: Undo / Redo правок
   ------------------------------------------------------------ */
function bindShortcuts() {

  window.addEventListener('keydown', (event) => {
    const modifier =
      event.ctrlKey ||
      event.metaKey;

    if (!modifier) return;

    const key =
      String(event.key || '')
        .toLowerCase();

    const target = event.target;

    const isEditableInput =
      target instanceof HTMLTextAreaElement ||
      (
        target instanceof HTMLInputElement &&
        !target.readOnly &&
        !target.disabled
      ) ||
      target?.isContentEditable === true;

    /*
     * Внутри текстовых полей работает локальная
     * посимвольная история редактора.
     */
    if (isEditableInput) {
      return;
    }

    const wantsUndo =
      key === 'z' &&
      !event.shiftKey;

    const wantsRedo =
      (
        key === 'z' &&
        event.shiftKey
      ) ||
      key === 'y';

    if (!wantsUndo && !wantsRedo) {
      return;
    }

    event.preventDefault();

    const changed =
      wantsRedo
        ? redoEdit()
        : undoEdit();

    if (!changed) return;

    /*
     * Возвращаем визуальное состояние всех настроек.
     * Методы sync не создают новые записи истории.
     */
    ui.settings?.sync?.(state.settings);
    ui.naming?.sync?.(state.settings);

    refreshNames();
    renderTable();
  });
}

/* ------------------------------------------------------------
   Отладочный хук: позволяет наполнить таблицу тестовыми данными
   при проверке дизайна вне Eagle (tools/shot.mjs).
   ------------------------------------------------------------ */
if (typeof window !== 'undefined') {
  window.__rs = {
    setPosts(posts) {
      state.posts = posts;
      state.selected = new Set(posts.map((post) => post.postId));
      resetAllEdits();
      refreshNames();
      renderTable();
      phase = 'ready';
      ui.footer.action.setLabel('Скачать и добавить в Eagle');
      ui.status.set(`Найдено публикаций: ${posts.length}`,
        'Проверьте выбор и нажмите «Скачать и добавить в Eagle»');
    },
    state,
    ui,
    toolchain,
    checkToolchain,
    prepareToolchain,
  };
}

/* Eagle вызывает onPluginCreate; в браузере просто ждём DOM */
if (typeof eagle !== 'undefined' && eagle?.onPluginCreate) {
  eagle.onPluginCreate(() => { boot(); });
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
