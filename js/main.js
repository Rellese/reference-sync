/* ============================================================
   ReferenceSync — точка входа плагина Eagle

   Собирает интерфейс из panels.js, связывает его с движком
   Instagram (instagram.js) и импортом в Eagle (eagle-import.js).
   ============================================================ */

import { el, clear, createCheckbox, createEditButton } from './ui.js';
import {
  applyShiftSelection,
  createCheckboxGestureState,
} from './checkbox-selection.js';

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
  state, loadSettings, setSetting, visiblePosts, cellValue, isEdited,
  applyEdit, removeEdit, undoEdit, redoEdit, resetAllEdits, hasEdits,
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
  checkEagle,
  importToEagle,
  buildNames,
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
  createNumberingRecord,
  loadNumberingRecords,
  numberingSettingsMatch,
  resolveContinuedStart,
  saveNumberingRecords,
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

/* Последняя успешно импортированная нумерация по платформам */
let numberingRecords = new Map();

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

function normalizedPlatform(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

async function applyNumberingContinuation() {
  const platform = normalizedPlatform(
    state.settings.platform,
  );

  const record = numberingRecords.get(platform);

  if (
    !record ||
    !numberingSettingsMatch(
      record,
      state.settings,
    ) ||
    !record.itemIds.length
  ) {
    return false;
  }

  const items = await findEagleItemsByIds(
    record.itemIds,
  );

  const nextNumber = resolveContinuedStart({
    record,
    settings: state.settings,
    items,
  });

  if (!Number.isInteger(nextNumber)) {
    ui.log?.add(
      'Последний номер в Eagle определить не удалось — ' +
      'сохранено ручное начальное значение.',
      'warn',
    );

    return false;
  }

  setSetting(
    'numberingStart',
    nextNumber,
  );

  ui.naming?.setNumberingStart(
    nextNumber,
  );

  numberingRecords.set(platform, {
    ...record,
    startNumber: nextNumber,
  });

  saveNumberingRecords(
    numberingRecords,
  );

  ui.log?.add(
    `Нумерация продолжена с ${nextNumber}.`,
    'ok',
  );

  return true;
}

function rememberImportedNumbering(
  settings,
  importedPostIds,
) {
  if (
    settings.numberingEnabled !== true ||
    !importedPostIds?.size
  ) {
    return false;
  }

  let latest = null;

  for (const postId of importedPostIds) {
    const postNumber = Number(
      state.generated.get(postId)?.postNumber,
    );

    if (
      !Number.isInteger(postNumber) ||
      postNumber < 1
    ) {
      continue;
    }

    if (
      !latest ||
      postNumber > latest.postNumber
    ) {
      latest = {
        postId,
        postNumber,
      };
    }
  }

  if (!latest) {
    return false;
  }

  const importRecord = state.importRecords.get(
    latest.postId,
  );

  const itemIds = [
    ...(importRecord?.components?.values() || []),
  ];

  if (!itemIds.length) {
    return false;
  }

  const record = createNumberingRecord({
    settings,
    lastNumber: latest.postNumber,
    itemIds,
  });

  if (!record) {
    return false;
  }

  const platform = normalizedPlatform(
    settings.platform,
  );

  numberingRecords.set(
    platform,
    record,
  );

  saveNumberingRecords(
    numberingRecords,
  );

  return true;
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
  numberingRecords = loadNumberingRecords();
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
    onFolderSearch: () => openCollectionModal(),
  });

  ui.status = buildStatus({
    onInstall: () => prepareToolchain(),
    onCommand: (name) => handleProgressCommand(name),
  });

  ui.results = buildResults({
    onClear: () => clearResults(),
    onToggleAll: (value) => toggleAll(value),
    onThumbnails: () => renderTable(),
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
    ui.status.engine.setState('error', 'Движок загрузки недоступен вне Eagle');
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
  ui.status.engine.setState('checking', 'Движок загрузки: проверяем…',
    { progress: null });

  await detectToolchain({
    onLog: (line, kind) => ui.log.add(line, kind),
  });

  if (toolchain.ready) {
    ui.status.engine.setState('ready',
      `Движок загрузки готов · gallery-dl ${versionString(toolchain.version)}`,
      { button: 'Обновить' });
    return true;
  }

  ui.status.engine.setState('missing',
    'Движок загрузки не подготовлен',
    {
      detail: 'Плагин скачает всё необходимое сам — примерно 1 МБ. '
        + 'Терминал не потребуется.',
      button: 'Подготовить движок',
    });
  ui.log.add('Движок не найден. Нажмите «Подготовить движок».', 'warn');
  return false;
}

/* Установка/обновление по кнопке */
let toolchainBusy = false;

async function prepareToolchain() {
  if (toolchainBusy) return false;
  toolchainBusy = true;

  const isUpdate = toolchain.ready;
  ui.status.engine.setState('working',
    isUpdate ? 'Обновляем движок загрузки…' : 'Готовим движок загрузки…',
    { detail: 'Идёт загрузка из репозитория PyPI', progress: 5 });

  try {
    const run = isUpdate ? updateToolchain : installToolchain;
    await run({
      onLog: (line, kind) => ui.log.add(line, kind),
      onProgress: ({ percent }) => {
        if (typeof percent === 'number') ui.status.engine.setProgress(percent);
      },
    });

    ui.status.engine.setState('ready',
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
    ui.status.engine.setState('error', info.title, {
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

  const session = await verifyInstagramSession({
    browser: settings.browser,
    browserProfile: settings.browserProfile,
    signal,
    onLog: (line) => ui.log.add(line),
    keepCookieFile: true,
  });
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
  await applyNumberingContinuation();
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
      discoveryResult = await discoverSaved({
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
    state.selected = new Set(posts.map((post) => post.postId));
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

    if (
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
      ui.log.add('Поиск остановлен пользователем.', 'warn');
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

/* ---------- Скачивание и импорт ---------- */
async function runImport() {
  const s = { ...state.settings };

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
        const rateLinitError = new Error(
          'Instagram временно ограничил запросы. ' +
          'Очередь остановлена без повторных попыток.',
        );

        rareLimitError.code = INSTAGRAM_RATE_LIMITED;
        throw makeInstagramRateLimitError;
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

    rememberImportedNumbering(
      s,
      importedPostIds,
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

    ui.footer.action.setDisabled(
      currentSearchCompleted ||
      state.selected.size === 0,
    );

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
    ui.status.engine.setState('missing', info.title, {
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
async function openCollectionModal() {
  const list = ui.modal.list;
  clear(list);

  /* Реальный список коллекций требует отдельного запроса к
     Instagram; пока предлагаем общую ленту и ручной ввод ID. */
  const options = [
    { id: 'ALL_MEDIA_AUTO_COLLECTION', name: 'Все сохранённые (общая лента)' },
  ];

  const boxes = new Map();
  options.forEach((option) => {
    const box = createCheckbox({
      checked: state.collections.some((entry) => entry.id === option.id),
      label: option.name,
    });
    boxes.set(option.id, { box, option });
    list.appendChild(box.row);
  });

  const hint = el('div', 'rs-hint',
    'Список конкретных коллекций подключим вместе с разбором ' +
    'instagram.com/api/v1/collections/list. Пока доступна общая лента.');
  list.appendChild(hint);

  ui.modal.confirmHandler = () => {
    state.collections = [...boxes.values()]
      .filter((entry) => entry.box.value)
      .map((entry) => ({ id: entry.option.id, name: entry.option.name }));
    ui.log.add(`Выбрано коллекций: ${state.collections.length}`);
  };

  ui.modal.node.classList.add('is-open');
}

function confirmCollections() {
  if (ui.modal.confirmHandler) ui.modal.confirmHandler();
  closeCollectionModal(false);
}

function closeCollectionModal(cancelled) {
  ui.modal.node.classList.remove('is-open');
  if (cancelled && !state.collections.length) {
    /* Пользователь отказался — выключаем тумблер обратно */
    setSetting('folderSearch', false);
    ui.log.add('Поиск по папкам отменён');
  }
}

/* ------------------------------------------------------------
   Имена и описания
   ------------------------------------------------------------ */
function refreshNames() {
  const s = state.settings;
  state.generated = buildNames({
    posts: visiblePosts(),
    selected: state.selected,
    numberingEnabled: s.numberingEnabled,
    marker: s.numberingMarker,
    startNumber: s.numberingStart,
    destination: s.numberingDestination,
    extraDescription: s.descriptionEnabled ? s.extraDescription : '',
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

let tableSelectionChanged = false;

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

    return;
  }

  if (checked) {
    state.selected.add(post.postId);
  } else {
    state.selected.delete(post.postId);
  }
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
}

function finishTableSelectionGesture() {
  stopTableAutoScroll();
  tableSelectionGesture.endDrag();

  if (!tableSelectionChanged) {
    return;
  }

  tableSelectionChanged = false;

  refreshNames();
  renderTable();
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
  'pointercancel',
  finishTableSelectionGesture,
);

window.addEventListener(
  'blur',
  finishTableSelectionGesture,
);

function renderTable() {
  const body = ui.results.body;
  clear(body);
  tableCheckboxes.clear();

  const posts = visiblePosts();
  ui.results.setTitle(state.selected.size, posts.length);
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
    const checked = parentMixed
      ? nextTablePostState(post)
      : value;

    if (event?.shiftKey) {
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

    refreshNames();
    renderTable();
  },

  onPointerDown: (event) => {
    if (isKnown) {
      return false;
    }

    const checked =
      nextTablePostState(post);

    if (event.shiftKey) {
      applyTableShiftSelection(
        post,
        checked,
      );

      return true;
    }

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

  const structureText = carouselState
    ? `${carouselState.availableCount} элем. · ` +
      `выбрано ${carouselState.selectedCount}`
    : post.structure;

  const structure = el(
    'div',
    'rs-cell',
    structureText,
  );

  if (post.componentCount > 1) {
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
  const nameCell = el('div', 'rs-cell rs-cell--name');

  nameCell.classList.toggle(
    'is-edited',
    !isKnown && isEdited(post.postId, 'name')
  );

  nameCell.classList.toggle(
    'is-disabled',
    isKnown,
  );

  nameCell.textContent = cellValue(
    post.postId,
    'name',
  );

  if (isKnown) {
    nameCell.setAttribute(
      'aria-disabled',
      'true',
    );
  } else {
    nameCell.title =
      'Двойной щелчок — редактировать';

    nameCell.addEventListener(
      'dblclick',
      () => startEdit(
        nameCell,
        post.postId,
        'name',
      ),
    );
  }

  /* Описание редактируется только до полного импорта */
  const descCell = el(
    'div',
    'rs-cell rs-cell--desc',
  );

  const descText = el(
    'div',
    'rs-desc__text',
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

  if (
    !isKnown &&
    isEdited(post.postId, 'description')
  ) {
    descText.style.color =
      'var(--text-bright)';
  }

  descCell.appendChild(descText);

  if (isKnown) {
    descCell.setAttribute(
      'aria-disabled',
      'true',
    );
  } else {
    descCell.appendChild(
      createEditButton(() =>
        startEdit(
          descText,
          post.postId,
          'description',
          true,
        )),
    );

    descText.addEventListener(
      'dblclick',
      () => startEdit(
        descText,
        post.postId,
        'description',
        true,
      ),
    );
  }

  grid.append(lead, author, type, structure, nameCell, descCell);
  row.appendChild(grid);
  return row;
}

/* Редактирование ячейки на месте */
function startEdit(node, postId, field, multiline = false) {
  const current = cellValue(postId, field);

  const editor = document.createElement(multiline ? 'textarea' : 'input');
  editor.className = 'rs-editable';
  editor.value = current;
  if (multiline) editor.style.height = '48px';

  node.replaceChildren(editor);
  editor.focus();
  editor.select();

  const commit = () => {
    const value = editor.value;
    if (value !== current) applyEdit(postId, field, value);
    refreshNames();
    renderTable();
  };

  editor.addEventListener('blur', commit);
  editor.addEventListener('keydown', (event) => {
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
  const posts = visiblePosts();

  posts.forEach((post) => {
    if (state.knownPostIds.has(post.postId)) {
      state.selected.delete(post.postId);
      return;
    }

    const carouselState = currentCarouselState(post);

    if (!value) {
      state.selected.delete(post.postId);

      if (carouselState) {
        setCarouselPositions(post, new Set());
      }

      return;
    }

    if (carouselState) {
      setCarouselPositions(
        post,
        carouselState.available,
      );

      if (carouselState.availableCount) {
        state.selected.add(post.postId);
      } else {
        state.selected.delete(post.postId);
      }

      return;
    }

    state.selected.add(post.postId);
  });

  refreshNames();
  renderTable();
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
  document.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey;
    if (!meta || event.key.toLowerCase() !== 'z') return;

    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    event.preventDefault();
    const done = event.shiftKey ? redoEdit() : undoEdit();
    if (done) {
      renderTable();
      ui.log.add(event.shiftKey ? 'Правка возвращена' : 'Правка отменена');
    }
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
