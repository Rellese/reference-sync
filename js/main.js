/* ============================================================
   ReferenceSync — точка входа плагина Eagle

   Собирает интерфейс из panels.js, связывает его с движком
   Instagram (instagram.js) и импортом в Eagle (eagle-import.js).
   ============================================================ */

import { el, clear, createCheckbox, createEditButton } from './ui.js';
import {
  loadIcons, buildTitlebar, buildHeader, buildSocial, buildSettings,
  buildStatus, buildResults, buildNaming, buildFooter, buildLog,
  buildCollectionModal, buildMessageModal,
} from './panels.js';

import {
  state, loadSettings, setSetting, visiblePosts, cellValue, isEdited,
  applyEdit, removeEdit, undoEdit, redoEdit, resetAllEdits, hasEdits,
} from './state.js';

import {
  discoverSaved,
  downloadPosts,
  verifyInstagramSession,
  SEARCH_MODES,
  redact,
} from './instagram.js';

import {
  checkEagle, importToEagle, buildNames, listFolders,
} from './eagle-import.js';

import { nodeApi, eagleApi } from './node-bridge.js';

import {
  discoverBrowserProfiles,
} from './browser-profiles.js';

import {
  toolchain, detectToolchain, installToolchain, updateToolchain,
  versionString, describeToolchainError,
} from './toolchain.js';

import { createJobControl, STOPPED } from './job-control.js';

/* Текущая фаза: idle | searching | ready | importing */
let phase = 'idle';

let ui = {};

/* Управление текущей длительной задачей (пауза/стоп/связь) */
let control = null;

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

/* ------------------------------------------------------------
   Запуск
   ------------------------------------------------------------ */
async function boot() {
  loadSettings();
  await loadIcons();

  const app = el('div', 'rs-app');
  app.id = 'reference-sync';

  ui.titlebar = buildTitlebar({
    onClose: () => {
      if (eagleApi?.window?.hide) eagleApi.window.hide();
      else window.close();
    },
  });

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

  /* Рабочая область: левая панель + правая колонка */
  const work = el('div', 'rs-work');
  const right = el('div', 'rs-right');
  right.append(ui.status.node, ui.results.node, ui.naming.node);
  work.append(ui.settings.node, right);

  app.append(
    ui.titlebar,
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

  if (phase === 'ready' && state.selected.size) {
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

async function requireMatchingInstagramSession(settings) {
  const browserName = browserDisplayName(settings.browser);

  ui.status.set(
    'Проверка аккаунта Instagram…',
    'ReferenceSync проверяет выбранный профиль браузера',
  );

  const session = await verifyInstagramSession({
    browser: settings.browser,
    browserProfile: settings.browserProfile,
    signal: control?.signal,
    onLog: (line) => ui.log.add(line),
  });

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
}

/* ---------- Поиск ---------- */
async function runSearch() {
  const s = state.settings;

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
    await requireMatchingInstagramSession(s);
    const { posts, stoppedEarly } = await discoverSaved({
      username: s.username,
      browser: s.browser,
      browserProfile: s.browserProfile,
      searchMode: s.searchMode,
      limit: s.recentLimit,
      speedProfile: s.speed,
      collections: s.folderSearch ? state.collections : [],
      knownPostIds: state.knownPostIds,
      signal: state.abortController.signal,
      onProgress: (progress) => {
        if (progress.stage === 'discover') {
          ui.status.set(
            `Поиск публикаций… найдено ~${progress.approximate}`,
            `Коллекция: ${progress.collection}`,
            true);
          /* Число найденных обновляется на ходу — как просил
             Instruction/Scale Reviewing for Publications */
          ui.status.progress.update({
            trail: `Найдено: ${progress.approximate}`,
          });
        }
      },
      onLog: (line) => ui.log.add(redact(line)),
    });

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
    resetAllEdits();
    refreshNames();
    renderTable();

    if (!posts.length) {
      phase = 'idle';
      ui.footer.action.setLabel('Начать поиск');
      ui.status.showProgress(false);
      ui.status.set('Ничего не найдено',
        'Проверьте вход в Instagram в выбранном браузере');
      ui.log.add('Публикаций не найдено.', 'warn');
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
    ui.status.showProgress(false);
    reportRunError('Ошибка поиска', error);
  } finally {
    state.abortController = null;
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
  const s = state.settings;
  const chosen = visiblePosts().filter((post) => state.selected.has(post.postId));

  if (!chosen.length) {
    ui.status.set('Нечего импортировать', 'Отметьте публикации в таблице');
    return;
  }

  if (!await ensureToolchain()) return;

  phase = 'importing';
  state.abortController = new AbortController();
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
    const { results } = await downloadPosts({
      posts: chosen,
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
    });

    const downloaded = results.filter((entry) => entry.files.length);
    const failedDownloads = results.filter((entry) => !entry.files.length);

    failedDownloads.forEach((entry) => {
      ui.log.add(`Не скачано: ${entry.post.url} — ${entry.error}`, 'err');
    });

    if (!downloaded.length) {
      throw new Error('Ни один файл не удалось скачать');
    }

    /* Формируем элементы для Eagle: карусель даёт несколько файлов,
       каждый становится отдельным элементом со своим номером. */
    const items = [];
    downloaded.forEach((entry) => {
      const names = state.generated.get(entry.post.postId);
      const nameOverride = state.edits.get(entry.post.postId)?.name;
      const descOverride = state.edits.get(entry.post.postId)?.description;

      const baseName = nameOverride ?? names?.name ?? entry.post.username;
      const annotation = descOverride ?? names?.description ?? '';
      const componentNames = names?.componentNames || [baseName];

      entry.files.forEach((file, index) => {
        const lines = String(baseName).split('\n');
        items.push({
          path: file,
          name: componentNames[index] || lines[index] || lines[0] || baseName,
          website: entry.post.url,
          annotation,
          tags: ['instagram', entry.post.plainUsername].filter(Boolean),
          postId: entry.post.postId,
        });
      });
    });

    ui.status.set('Импорт в Eagle…', `0 из ${items.length}`, true);

    const { created, failed, stopReason } = await importToEagle({
      items,
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
    });

    created.forEach((entry) => state.knownPostIds.add(entry.item.postId));

    phase = 'ready';
    ui.footer.action.setLabel('Скачать и добавить в Eagle');

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
      ui.status.set(`Импортировано в Eagle: ${created.length}`,
        failed.length ? `Не удалось: ${failed.length}` : 'Готово');
      /* Состояние 2 — зелёная шкала, только когда импорт
         в Eagle действительно завершён */
      ui.status.progress.update({
        mode: 'complete',
        lead: 'Импорт завершён',
        trail: `Всего добавлено: ${created.length}`,
        interest: `${created.length} ЭЛ.`,
      });
      ui.log.add(`Импорт завершён: ${created.length} элементов.`, 'ok');
    }
  } catch (error) {
    phase = 'ready';
    ui.footer.action.setLabel('Скачать и добавить в Eagle');

    /* Остановка по кнопке «стоп» — не ошибка, а состояние 4 */
    if (error?.code === STOPPED) {
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

/* ------------------------------------------------------------
   Таблица результатов
   ------------------------------------------------------------ */
function renderTable() {
  const body = ui.results.body;
  clear(body);

  const posts = visiblePosts();
  ui.results.setTitle(state.selected.size, posts.length);
  ui.results.clearButton.setDisabled(!posts.length);
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
  const grid = el('div', 'rs-table__grid');
  const isSelected = state.selected.has(post.postId);
  row.classList.toggle('is-selected', isSelected);

  /* 1 колонка: чекбокс + миниатюра */
  const lead = el('div', 'rs-row__lead');
  const checkbox = createCheckbox({
    checked: isSelected,
    onChange: (value) => {
      if (value) state.selected.add(post.postId);
      else state.selected.delete(post.postId);
      row.classList.toggle('is-selected', value);
      /* Нумерация зависит от набора выбранных строк */
      refreshNames();
      renderTable();
    },
  });

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
  const structure = el('div', 'rs-cell', post.structure);

  /* Название — редактируемое */
  const nameCell = el('div', 'rs-cell rs-cell--name');
  nameCell.classList.toggle('is-edited', isEdited(post.postId, 'name'));
  nameCell.textContent = cellValue(post.postId, 'name');
  nameCell.title = 'Двойной щелчок — редактировать';
  nameCell.addEventListener('dblclick', () =>
    startEdit(nameCell, post.postId, 'name'));

  /* Описание — прокручиваемая ячейка с кнопкой правки */
  const descCell = el('div', 'rs-cell rs-cell--desc');
  const descText = el('div', 'rs-desc__text',
    cellValue(post.postId, 'description'));
  if (isEdited(post.postId, 'description')) {
    descText.style.color = 'var(--text-bright)';
  }
  descCell.appendChild(descText);
  descCell.appendChild(createEditButton(() =>
    startEdit(descText, post.postId, 'description', true)));
  descText.addEventListener('dblclick', () =>
    startEdit(descText, post.postId, 'description', true));

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
  const posts = visiblePosts();
  if (value) posts.forEach((post) => state.selected.add(post.postId));
  else posts.forEach((post) => state.selected.delete(post.postId));
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
