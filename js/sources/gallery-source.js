/* ============================================================
   Универсальный источник на базе gallery-dl

   Зачем: gallery-dl умеет 300+ сайтов, и все они отдают
   --dump-json в одинаковом виде. Поэтому подключение новой
   соцсети сводится к описанию:

     • как собрать целевой адрес из ника/коллекции;
     • какие поля json считать id, автором, описанием;
     • нужны ли cookies браузера.

   Всё остальное — обход страниц, нормализация, скачивание в
   staging, прогресс, обработка ошибок — общий код ниже. Он же
   используется для Instagram (js/instagram.js оставлен как
   специализированная реализация со своей логикой коллекций).

   Так выполняется требование масштабируемости: 6 и больше
   соцсетей добавляются модулями, ничего не ломая.
   ============================================================ */

import { nodeApi, ensureDir, workRoot } from '../node-bridge.js';
import { runGallery, requireToolchain } from '../toolchain.js';
import { looksOffline, RETRY_STEPS } from '../job-control.js';

/* Копируем базу кук Chrome во временную папку.
   gallery-dl не может читать живую базу запущенного браузера
   (файл заблокирован — процесс виснет). Копию читать можно:
   замка нет, а ключ расшифровки gallery-dl берёт из Keychain сам. */
function stageCookieDb(browser, profile) {
  if (!nodeApi.available) return null;
  const { path, os, fs } = nodeApi;
  const home = os.homedir();
  const name = String(browser || 'chrome').toLowerCase();

  /* Пути к папке профиля Chrome/Chromium/Edge/Brave на macOS.
     На Windows/Linux — свои, добавлены ниже. */
  const prof = String(profile || 'Default').trim() || 'Default';
  const roots = [];
  if (process.platform === 'darwin') {
    const app = path.join(home, 'Library', 'Application Support');
    const map = {
      chrome: path.join(app, 'Google', 'Chrome'),
      chromium: path.join(app, 'Chromium'),
      edge: path.join(app, 'Microsoft Edge'),
      brave: path.join(app, 'BraveSoftware', 'Brave-Browser'),
      vivaldi: path.join(app, 'Vivaldi'),
    };
    if (map[name]) roots.push(map[name]);
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const map = {
      chrome: path.join(local, 'Google', 'Chrome', 'User Data'),
      edge: path.join(local, 'Microsoft', 'Edge', 'User Data'),
      brave: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    };
    if (map[name]) roots.push(map[name]);
  } else {
    const cfg = path.join(home, '.config');
    const map = {
      chrome: path.join(cfg, 'google-chrome'),
      chromium: path.join(cfg, 'chromium'),
      edge: path.join(cfg, 'microsoft-edge'),
      brave: path.join(cfg, 'BraveSoftware', 'Brave-Browser'),
    };
    if (map[name]) roots.push(map[name]);
  }

  /* В новых Chrome база кук лежит в подпапке Network, в старых — в корне профиля */
  for (const root of roots) {
    for (const rel of [
      path.join(prof, 'Network', 'Cookies'),
      path.join(prof, 'Cookies'),
    ]) {
      const src = path.join(root, rel);
      try {
        if (!fs.existsSync(src)) continue;
        const dstDir = ensureDir(path.join(workRoot(), 'cookie-cache'));
        const dst = path.join(dstDir, `Cookies-${Date.now()}`);
        fs.copyFileSync(src, dst);
        /* WAL-файл: без него часть свежих кук может отсутствовать в копии */
        for (const suf of ['-wal', '-shm']) {
          try { if (fs.existsSync(src + suf)) fs.copyFileSync(src + suf, dst + suf); }
          catch (_) { /* необязательно */ }
        }
        return dst;
      } catch (_) { /* пробуем следующий путь */ }
    }
  }
  return null;
}

/* Удаляет скопированную базу кук и её спутники (-wal, -shm) */
function cleanupCookieDb(dbFile) {
  if (!dbFile || !nodeApi.available) return;
  for (const suf of ['', '-wal', '-shm']) {
    try { nodeApi.fs.unlinkSync(dbFile + suf); } catch (_) { /* уже нет — и ладно */ }
  }
}

const IMAGE_EXTENSIONS = new Set(
  ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'bmp', 'tiff'],
);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi']);

/* Профили скорости — те же три режима, что в блоке 1 */
const SPEED_PROFILES = {
  safe: { sleepRequest: '2.0-4.0', retries: 3 },
  balanced: { sleepRequest: '1.0-2.0', retries: 2 },
  lightning: { sleepRequest: null, retries: 1 },
};

function paceArgs(profile) {
  return profile.sleepRequest ? ['--sleep-request', profile.sleepRequest] : [];
}

/* Убирает секреты из логов — общий для всех источников */
export function redactCommon(text) {
  return String(text)
    .replace(/(sessionid\s*[=:]\s*)[^;\s,"']+/gi, '$1<REDACTED>')
    .replace(/(csrftoken\s*[=:]\s*)[^;\s,"']+/gi, '$1<REDACTED>')
    .replace(/(ds_user_id\s*[=:]\s*)[^;\s,"']+/gi, '$1<REDACTED>')
    .replace(/(auth_token\s*[=:]\s*)[^;\s,"']+/gi, '$1<REDACTED>')
    .replace(/(access_token\s*[=:]\s*)[^;\s,"']+/gi, '$1<REDACTED>')
    .replace(/(_pinterest_sess\s*[=:]\s*)[^;\s,"']+/gi, '$1<REDACTED>');
}

function textValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/* Достаёт первую пригодную превью-ссылку из записи json */
function findPreview(record) {
  const candidates = [
    record.thumbnail, record.thumbnail_url, record.preview,
    record.preview_url, record.image, record.image_url,
    record.display_url, record.url, record.src,
  ];
  for (const value of candidates) {
    const text = textValue(value);
    if (text.startsWith('http')) return text;
  }
  /* Иногда превью лежат массивом разных размеров */
  const list = record.images || record.thumbnails || record.previews;
  if (Array.isArray(list) && list.length) {
    const first = list[0];
    const text = textValue(typeof first === 'string' ? first : first?.url);
    if (text.startsWith('http')) return text;
  }
  return '';
}

function guessMediaType(record) {
  const ext = textValue(record.extension, record.ext).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';

  const url = textValue(record.url, record.video_url, record.image_url);
  const tail = url.split('?')[0].split('.').pop().toLowerCase();
  if (VIDEO_EXTENSIONS.has(tail)) return 'video';
  if (record.video_url || record.is_video) return 'video';
  return 'image';
}

/* ------------------------------------------------------------
   Разбор потока --dump-json.
   gallery-dl печатает либо по одному объекту на строку,
   либо массивы [тип, url, метаданные]. Поддерживаем оба.
   ------------------------------------------------------------ */
export function parseDumpJson(text) {
  const records = [];
  const raw = String(text).trim();
  if (!raw) return records;

  /* Достаёт запись из одного элемента gallery-dl.
     Форматы: [тип, url, meta] / [тип, meta] / голый объект. */
  const take = (item) => {
    if (Array.isArray(item)) {
      const meta = item.find((x) => x && typeof x === 'object' && !Array.isArray(x));
      const url = item.find((x) => typeof x === 'string' && x.startsWith('http'));
      if (meta) records.push(url ? { ...meta, url } : meta);
    } else if (item && typeof item === 'object') {
      records.push(item);
    }
  };

  /* gallery-dl --dump-json отдаёт ОДИН валидный JSON-массив целиком.
     Парсим его за один раз — надёжно, без счёта скобок вручную. */
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      /* Массив элементов вида [тип, url, meta] */
      parsed.forEach((item) => take(item));
    } else {
      take(parsed);
    }
    return records;
  } catch (_) { /* не единый JSON — пробуем построчно ниже */ }

  /* Резерв: формат JSON-Lines (по объекту на строку) */
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      take(JSON.parse(trimmed));
    } catch (_) { /* битая строка — пропускаем */ }
  }
  return records;
}

/* ------------------------------------------------------------
   Фабрика источника на базе gallery-dl.

   spec:
     code, title, icon
     containerTypes, containerLabels
     buildTargets({ username, collections })
         → [{ id, name, url }]
     idFields      — поля json, где искать id публикации
     authorFields  — поля с автором
     captionFields — поля с описанием
     cookies       — нужны ли cookies браузера (true/false)
     urlPattern    — RegExp для распознавания ссылок
     canonicalUrl(record, id) — как собрать ссылку на публикацию
     groupBy       — 'post' (объединять компоненты карусели)
                     или 'file' (каждый файл — своя публикация)
   ------------------------------------------------------------ */
export function createGallerySource(spec) {
  const {
    code,
    title,
    icon = code,
    ready = true,
    containerTypes = ['ROOT', 'ACCOUNT', 'COLLECTION'],
    containerLabels,
    sourceModes = ['browser'],
    needsAccount = true,
    cookies = true,
    defaultTags = [title],
    nameMarker = `${code}order`,
    jobPrefix = code,
    urlPattern = null,
    notReadyReason,
    buildTargets,
    idFields = ['post_id', 'id', 'pk', 'shortcode', 'code'],
    authorFields = ['username', 'owner_username', 'author', 'user'],
    captionFields = ['description', 'caption', 'title', 'text'],
    canonicalUrl = null,
    groupBy = 'post',
    extraDiscoverArgs = [],
    extraDownloadArgs = [],
  } = spec;

  /* -------- Нормализация одной записи -------- */
  function normalize(record, { target, accountUsername }) {
    const rawId = textValue(...idFields.map((field) => record[field]));
    if (!rawId) return null;

    let author = '';
    for (const field of authorFields) {
      const value = record[field];
      author = textValue(
        typeof value === 'object' ? (value?.username || value?.name) : value,
      );
      if (author) break;
    }
    author = (author || accountUsername || 'unknown').replace(/^@/, '');

    let caption = '';
    for (const field of captionFields) {
      const value = record[field];
      caption = textValue(
        typeof value === 'object' ? value?.text : value,
      );
      if (caption) break;
    }

    const url = canonicalUrl
      ? canonicalUrl(record, rawId)
      : textValue(record.post_url, record.canonical_url, record.webpage_url,
        record.url);

    const mediaType = guessMediaType(record);
    const preview = findPreview(record);
    const num = Number(record.num ?? record.number ?? 1) || 1;

    return {
      postId: `${code}:${rawId}`,
      externalId: rawId,
      url,
      username: `@${author}`,
      plainUsername: author,
      mediaType,
      previewUrl: preview,
      description: caption,
      num,
      takenAt: Number(record.date ?? record.taken_at ?? 0) || null,
      collectionId: target.id,
      collectionName: target.name,
      source: code,
      raw: record,
    };
  }

  /* -------- Сборка публикаций из записей -------- */
  function assemble(records, context) {
    const normalized = records
      .map((record) => normalize(record, context))
      .filter(Boolean);

    if (groupBy === 'file') {
      /* Pinterest, Dribbble и т.п.: один файл = одна публикация */
      return normalized.map((entry) => finishPost(entry, [entry]));
    }

    /* Карусели: записи с одним externalId — компоненты одного поста */
    const groups = new Map();
    normalized.forEach((entry) => {
      const list = groups.get(entry.externalId) || [];
      list.push(entry);
      groups.set(entry.externalId, list);
    });

    return [...groups.values()].map((list) => {
      list.sort((a, b) => a.num - b.num);
      return finishPost(list[0], list);
    });
  }

  function finishPost(head, parts) {
    const components = parts.map((entry, index) => ({
      index: index + 1,
      mediaType: entry.mediaType,
      previewUrl: entry.previewUrl,
      url: entry.url,
    }));
    const videoCount = components.filter((c) => c.mediaType === 'video').length;

    let type = 'Фото';
    if (components.length > 1) type = videoCount ? 'Карусель, видео' : 'Карусель';
    else if (videoCount) type = 'Видео';

    return {
      postId: head.postId,
      externalId: head.externalId,
      shortcode: head.externalId,
      url: head.url,
      username: head.username,
      plainUsername: head.plainUsername,
      type,
      componentCount: components.length,
      structure: components.length > 1
        ? `${components.length} элем.`
        : '1 элем.',
      components,
      selectedComponents: components.map((c) => c.index),
      description: head.description,
      previewUrl: head.previewUrl,
      takenAt: head.takenAt,
      collectionId: head.collectionId,
      collectionName: head.collectionName,
      source: code,
      containers: [{
        platform: code,
        kind: containerTypes[containerTypes.length - 1],
        id: head.collectionId,
        name: head.collectionName,
      }],
    };
  }

  /* -------- Поиск -------- */
  async function discover({
    username,
    browser = 'chrome',
    browserProfile = '',
    searchMode = 'smart',
    limit = 50,
    speedProfile = 'safe',
    collections = [],
    knownPostIds = new Set(),
    onProgress,
    onLog,
    signal,
  } = {}) {
    requireToolchain();

    let cookieDb = null;
    if (cookies) {
      cookieDb = stageCookieDb(browser, browserProfile);
      if (cookieDb && onLog) onLog('Куки Chrome скопированы для чтения (браузер закрывать не нужно)');
      else if (!cookieDb && onLog) onLog('Не нашёл базу кук — читаю напрямую (закройте Chrome, если зависнет)');
    }

    try {

    const cleanUser = String(username || '').trim().replace(/^@/, '');
    if (needsAccount && !cleanUser) {
      throw new Error(`Не указан аккаунт для ${title}`);
    }

    const profile = SPEED_PROFILES[speedProfile] || SPEED_PROFILES.safe;
    const targets = buildTargets({ username: cleanUser, collections });
    if (!targets.length) {
      throw new Error(`${title}: не удалось определить, где искать`);
    }

    const posts = [];
    const seen = new Set();
    let stoppedEarly = false;

    for (const target of targets) {
      if (signal?.aborted) break;

      const args = [
        '--config-ignore',
        '--no-input',
        '--simulate',
        '--dump-json',
        '--retries', String(profile.retries),
        '--http-timeout', '30',
        ...paceArgs(profile),
        ...extraDiscoverArgs,
      ];
      /* Лимит на стороне gallery-dl: берём только первые N постов и
         СРАЗУ останавливаемся. gallery-dl отдаёт валидный JSON целиком,
         в отличие от обрыва процесса на середине (тот портил JSON → пустая
         таблица). Проверено: Pinterest allpins --post-range поддерживает. */
      if (limit && limit > 0) {
        args.push('--post-range', `1-${limit}`);
      }
      if (cookies) {
        args.push(
          '--cookies-from-browser',
          browserCookieSpec(browser, browserProfile, cookieDb),
        );
      }
      /* Pinterest allpins не переносит --post-range (даёт пустую
         выдачу). Лимит применяется после сбора, на стороне main.js. */
      args.push(target.url);

      if (onLog) onLog(`gallery-dl: ${target.name} (${target.url})`);

      let buffer = '';
      let counted = 0;

      const result = await runGallery(args, {
        signal,
        onStdout: (chunk) => {
          buffer += chunk;
          const hits = chunk.match(/"(?:post_id|shortcode|pk|id)"/g);
          if (hits && onProgress) {
            counted += hits.length;
            onProgress({
              stage: 'discover',
              collection: target.name,
              approximate: counted,
            });
          }
        },
        onStderr: (chunk) => {
          const line = redactCommon(chunk).trim();
          if (line && onLog) onLog(line);
        },
      });

      if (result.code !== 0 && !buffer.trim()) {
        throw new Error(describeFailure(result, browser, title));
      }

      const found = assemble(parseDumpJson(buffer), {
        target,
        accountUsername: cleanUser,
      });

      for (const post of found) {
        if (seen.has(post.postId)) continue;
        if (searchMode === 'smart' && knownPostIds.has(post.postId)) {
          stoppedEarly = true;
          break;
        }
        seen.add(post.postId);
        posts.push(post);
        /* Ровно N и не больше — режим «Проверить N постов» */
        if (limit && posts.length >= limit) {
          stoppedEarly = true;
          break;
        }
      }
      if (stoppedEarly) break;
    }

      return { posts, stoppedEarly };
    } finally {
      cleanupCookieDb(cookieDb);
    }
  }

  /* -------- Скачивание -------- */
  async function download({
    posts,
    browser = 'chrome',
    browserProfile = '',
    speedProfile = 'safe',
    onProgress,
    onLog,
    signal,
    control = null,
    onOffline = null,
  } = {}) {
    if (!nodeApi.available) {
      throw new Error('Скачивание доступно только внутри Eagle');
    }
    requireToolchain();

    let cookieDb = null;
    if (cookies) {
      cookieDb = stageCookieDb(browser, browserProfile);
      if (cookieDb && onLog) {
        onLog('Куки браузера скопированы для чтения (браузер закрывать не нужно)');
      } else if (!cookieDb && onLog) {
        onLog('Не нашёл базу кук — читаю напрямую (закройте браузер, если зависнет)');
      }
    }

    try {

    const { path, fs } = nodeApi;
    const stagingRoot = ensureDir(path.join(workRoot(), 'staging',
      `${jobPrefix}-${Date.now()}`));
    const profile = SPEED_PROFILES[speedProfile] || SPEED_PROFILES.safe;
    const maxAttempts = control ? RETRY_STEPS.length + 1 : 1;
    const results = [];

    for (let index = 0; index < posts.length; index += 1) {
      if (signal?.aborted) break;
      if (control) await control.checkpoint();

      const post = posts[index];
      const postDir = ensureDir(path.join(stagingRoot,
        String(post.postId).replace(/[^\w.-]+/g, '_')));

      if (onProgress) {
        onProgress({
          stage: 'download',
          current: index + 1,
          total: posts.length,
          post,
        });
      }

      const args = [
        '--config-ignore',
        '--no-input',
        '--retries', String(profile.retries),
        '--http-timeout', '60',
        ...paceArgs(profile),
        ...extraDownloadArgs,
        '--dest', postDir,
        '--filename', '{num}.{extension}',
        '--directory', '',
      ];
      if (cookies) {
        args.push(
          '--cookies-from-browser',
          browserCookieSpec(browser, browserProfile, cookieDb),
        );
      }
      args.push(post.url);

      let error = null;
      let attempts = 0;

      for (;;) {
        attempts += 1;
        error = null;
        let raw = '';
        try {
          const result = await runGallery(args, {
            signal,
            onStderr: (chunk) => {
              raw += chunk;
              const line = redactCommon(chunk).trim();
              if (line && onLog) onLog(line);
            },
          });
          raw += `\n${result.stdout || ''}\n${result.stderr || ''}`;
          if (result.code !== 0) error = describeFailure(result, browser, title);
        } catch (runError) {
          raw += `\n${runError.message}`;
          error = runError.message;
        }

        if (!error) {
          if (control) control.resetRetries();
          break;
        }
        if (!control || attempts >= maxAttempts) break;
        if (!looksOffline(raw)) break;

        if (onLog) onLog(`Обрыв связи. Ожидание ${control.retryStep} с…`);
        await control.waitForConnection({
          onTick: (left) => { if (onOffline) onOffline(left, post); },
        });
        await control.checkpoint();
      }

      let files = [];
      try {
        files = fs.readdirSync(postDir)
          .filter((name) => !name.startsWith('.'))
          .map((name) => path.join(postDir, name))
          .filter((file) => {
            try { return fs.statSync(file).size > 0; } catch (_) { return false; }
          })
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      } catch (_) { /* пусто */ }

      if (!files.length && !error) {
        error = `${title}: файлы не получены для этой публикации`;
      }

      results.push({ post, files, error });
      if (error && onLog) onLog(`Ошибка: ${post.url} — ${error}`);
    }

    return { stagingRoot, results };
    } finally {
      cleanupCookieDb(cookieDb);
    }
  }

  return {
    code,
    title,
    icon,
    ready,
    containerTypes,
    containerLabels,
    sourceModes,
    needsAccount,
    needsBrowser: cookies,
    defaultTags,
    nameMarker,
    jobPrefix,
    urlPattern,
    notReadyReason,
    discover,
    download,
    /* Открыты для тестов и переиспользования */
    normalize,
    assemble,
  };
}

/* Cookies браузера — общий формат gallery-dl */
export function browserCookieSpec(browser, browserProfile = '', dbFile = '') {
  const known = new Set(['chrome', 'chromium', 'edge', 'firefox', 'safari',
    'brave', 'opera', 'vivaldi']);
  const name = String(browser || 'chrome').trim().toLowerCase();
  const base = known.has(name) ? name : 'chrome';

  const profile = String(browserProfile || '').trim();
  const file = String(dbFile || '').trim();

  /* Формат gallery-dl: browser[:profile][::file].
     Если есть путь к скопированной базе — добавляем через "::". */
  let spec = base;
  if (profile) spec += `:${profile}`;
  if (file) spec += `::${file}`;
  return spec;
}

/* Человеческое объяснение неудачи вместо кода выхода */
export function describeFailure(result, browser, title) {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (text.includes('could not find') && text.includes('cookies')) {
    return `Не удалось прочитать cookies из браузера «${browser}». ` +
      `Убедитесь, что в нём выполнен вход в ${title}.`;
  }
  if (text.includes('database is locked') || text.includes('permissionerror')) {
    return `Файл cookies занят браузером «${browser}». Закройте браузер и повторите.`;
  }
  if (text.includes('login required') || text.includes('checkpoint') ||
      text.includes('challenge') || text.includes('unauthorized')) {
    return `${title} требует повторный вход. Откройте сайт в браузере, ` +
      'войдите в аккаунт и повторите поиск.';
  }
  if (text.includes('429') || text.includes('rate limit')) {
    return `${title} ограничил частоту запросов. Подождите и включите ` +
      'безопасный режим скорости.';
  }
  if (text.includes('no suitable extractor') || text.includes('unsupported url')) {
    return `${title}: этот адрес движок загрузки не поддерживает.`;
  }
  return `Движок загрузки завершился с кодом ${result.code}. ` +
    'Подробности в техническом журнале.';
}
