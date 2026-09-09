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

export function chooseGalleryStagingRoot(
  existingRoot,
  generatedRoot,
) {
  const existing =
    String(existingRoot || '').trim();

  return existing || generatedRoot;
}

export async function notifyGalleryDownloadCompleted(
  onCompleted,
  entry,
) {
  if (
    typeof onCompleted !== 'function' ||
    !Array.isArray(entry?.files) ||
    !entry.files.length
  ) {
    return false;
  }

  await onCompleted(entry);
  return true;
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

/* Достаёт HTTP-превью из строки, объекта или массива вариантов. */
function previewValue(value, seen = new Set()) {
  if (typeof value === 'string') {
    const url = value.trim();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  if (seen.has(value)) {
    return '';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = previewValue(item, seen);
      if (url) return url;
    }
    return '';
  }

  /*
   * Pinterest хранит размеры изображения в объекте:
   * images: { "236x": {...}, "474x": {...}, orig: {...} }
   *
   * Для таблицы сначала выбираем средний размер, затем оригинал.
   */
  const preferredKeys = [
    '236x',
    '170x',
    '474x',
    '564x',
    '736x',
    'orig',
    'originals',
  ];

  for (const key of preferredKeys) {
    if (!(key in value)) continue;

    const url = previewValue(value[key], seen);
    if (url) return url;
  }

  const direct = textValue(
    value.url,
    value.src,
    value.image_url,
    value.thumbnail_url,
    value.preview_url,
  );

  if (/^https?:\/\//i.test(direct)) {
    return direct;
  }

  for (const nested of Object.values(value)) {
    const url = previewValue(nested, seen);
    if (url) return url;
  }

  return '';
}

/* Достаёт первую пригодную превью-ссылку из записи JSON. */
export function findPreview(record = {}) {
  /*
   * Явные поля превью имеют приоритет перед оригинальным
   * файлом: они обычно меньше и быстрее загружаются в таблице.
   */
  const explicit = [
    record.thumbnail,
    record.thumbnail_url,
    record.preview,
    record.preview_url,
    record.display_url,
  ];

  for (const value of explicit) {
    const url = previewValue(value);
    if (url) return url;
  }

  /*
   * Pinterest и некоторые другие источники передают варианты
   * изображения объектом или массивом.
   */
  const collections = [
    record.images,
    record.thumbnails,
    record.previews,
    record.image,
  ];

  for (const value of collections) {
    const url = previewValue(value);
    if (url) return url;
  }

  /*
   * Последний fallback — URL медиафайла из сообщения gallery-dl.
   */
  const media = [
    record.image_url,
    record._galleryUrl,
    record.url,
    record.src,
  ];

  for (const value of media) {
    const url = previewValue(value);
    if (url) return url;
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
  const raw = String(text || '').trim();

  if (!raw) return records;

  /*
   * Одно сообщение gallery-dl:
   * [тип, url, metadata] или [тип, metadata].
   */
  const isMessage = (value) =>
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    value.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item),
    );

  const takeMessage = (item) => {
    if (Array.isArray(item)) {
      const metadata = item.find(
        (value) =>
          value &&
          typeof value === 'object' &&
          !Array.isArray(value),
      );

      if (!metadata) return;

      const galleryUrl = item.find(
        (value) =>
          typeof value === 'string' &&
          /^https?:\/\//i.test(value),
      );

      const record = { ...metadata };
      record._galleryType = item[0];

      /*
       * metadata.url и URL сообщения могут означать разные вещи:
       * страницу публикации и непосредственно медиафайл.
       * Сохраняем оба значения.
       */
      if (
        galleryUrl &&
        typeof metadata.url === 'string' &&
        metadata.url !== galleryUrl
      ) {
        record._metadataUrl = metadata.url;
      }

      if (galleryUrl) {
        record._galleryUrl = galleryUrl;

        /*
         * Оставляем совместимость с текущими findPreview()
         * и guessMediaType(). Разделим URL окончательно
         * на следующем шаге.
         */
        record.url = galleryUrl;
      }

      records.push(record);
      return;
    }

    if (item && typeof item === 'object') {
      records.push({ ...item });
    }
  };

  const takeDocument = (value) => {
    if (isMessage(value)) {
      takeMessage(value);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => takeMessage(item));
      return;
    }

    takeMessage(value);
  };

  /*
   * Обычный --dump-json: единый JSON-массив
   * со всеми сообщениями.
   */
  try {
    takeDocument(JSON.parse(raw));
    return records;
  } catch (_) {
    /* Если это не единый JSON, пробуем JSON-Lines. */
  }

  /*
   * JSON-Lines: по одному сообщению или объекту на строку.
   */
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    try {
      takeDocument(JSON.parse(trimmed));
    } catch (_) {
      /* Повреждённую или служебную строку пропускаем. */
    }
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
    /*
     * gallery-dl сначала отдаёт Directory-сообщение с общими
     * метаданными, затем Url-сообщения отдельных файлов.
     *
     * Directory имеет тип 2 и не является компонентом.
     * Url имеет тип 3 и соответствует реальному файлу.
     */
    const urlParts = parts.filter(
      (entry) =>
        Number(entry.raw?._galleryType) === 3,
    );

    /*
     * Совместимость с источниками, которые возвращают
     * голые metadata-объекты без типа сообщения.
     */
    const untypedParts = parts.filter(
      (entry) =>
        entry.raw?._galleryType === undefined ||
        entry.raw?._galleryType === null,
    );

    const componentParts = urlParts.length
      ? urlParts
      : untypedParts.length
        ? untypedParts
        : parts.filter(
            (entry) =>
              Number(entry.raw?._galleryType) !== 2,
          );

    /*
     * Даже при необычном выводе не создаём публикацию
     * с пустым списком компонентов.
     */
    const usableParts = componentParts.length
      ? componentParts
      : [head];

    const components = usableParts.map(
      (entry, index) => ({
        index: index + 1,
        mediaType: entry.mediaType,
        previewUrl: entry.previewUrl,
        /*
         * Для компонента нужен URL файла, а не страница пина.
         */
        url:
          entry.raw?._galleryUrl ||
          entry.previewUrl ||
          entry.url,
      }),
    );

    const videoCount = components.filter(
      (component) =>
        component.mediaType === 'video',
    ).length;

    let type = 'Фото';

    if (components.length > 1) {
      type = videoCount
        ? 'Карусель, видео'
        : 'Карусель';
    } else if (videoCount) {
      type = 'Видео';
    }

    const cover =
      head.previewUrl ||
      components.find(
        (component) =>
          component.mediaType === 'image' &&
          component.previewUrl,
      )?.previewUrl ||
      components.find(
        (component) =>
          component.previewUrl,
      )?.previewUrl ||
      '';

    return {
      postId: head.postId,
      externalId: head.externalId,
      shortcode: head.externalId,
      url: head.url,
      username: head.username,
      plainUsername: head.plainUsername,
      type,
      componentCount: components.length,
      structure:
        components.length > 1
          ? `${components.length} элем.`
          : '1 элем.',
      components,
      selectedComponents:
        components.map(
          (component) => component.index,
        ),
      description: head.description,
      previewUrl: cover,
      takenAt: head.takenAt,
      collectionId: head.collectionId,
      collectionName: head.collectionName,
      source: code,
      containers: [{
        platform: code,
        kind:
          containerTypes[
            containerTypes.length - 1
          ],
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
    cookieFile = '',
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

    if (cookies && !cookieFile) {
      cookieDb =
        stageCookieDb(
          browser,
          browserProfile,
        );

      if (cookieDb && onLog) {
        onLog(
          'Куки браузера скопированы для чтения ' +
          '(браузер закрывать не нужно)',
        );
      } else if (onLog) {
        onLog(
          'Не нашёл базу кук — читаю напрямую ' +
          '(закройте браузер, если зависнет)',
        );
      }
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
    const postsById = new Map();
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
        if (cookieFile) {
          args.push(
            '--cookies',
            cookieFile,
          );
        } else {
          args.push(
            '--cookies-from-browser',
            browserCookieSpec(
              browser,
              browserProfile,
              cookieDb,
            ),
          );
        }
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

      let targetAccepted = 0;

      for (const post of found) {
        /*
        * Граница известной публикации применяется отдельно
        * к каждой выбранной папке.
        */
        if (
          (
            searchMode === 'recent' ||
            searchMode === 'smart'
          ) &&
          knownPostIds.has(post.postId)
        ) {
          stoppedEarly = true;
          break;
        }

        /*
        * Лимит считается отдельно для текущей папки,
        * а не по общему массиву posts.
        */
        if (
          limit &&
          limit > 0 &&
          targetAccepted >= limit
        ) {
          break;
        }

        targetAccepted += 1;

        const existing =
          postsById.get(post.postId);

        if (existing) {
          /*
          * Один Pinterest-пин может находиться в нескольких
          * выбранных папках. Не создаём дубликат строки,
          * но сохраняем обе папочные привязки.
          */
          const existingContainers =
            Array.isArray(existing.containers)
              ? existing.containers
              : [];

          const incomingContainers =
            Array.isArray(post.containers)
              ? post.containers
              : [];

          for (const container of incomingContainers) {
            const duplicate =
              existingContainers.some(
                (entry) =>
                  entry.platform === container.platform &&
                  entry.kind === container.kind &&
                  String(entry.id) === String(container.id),
              );

            if (!duplicate) {
              existingContainers.push(container);
            }
          }

          existing.containers =
            existingContainers;

          continue;
        }

        postsById.set(
          post.postId,
          post,
        );

        posts.push(post);
      }
    }

      return { posts, stoppedEarly };
    } finally {
      cleanupCookieDb(cookieDb);
    }
  }

  /* -------- Скачивание -------- */
  async function download({
    posts,
    stagingRoot: existingStagingRoot = '',
    browser = 'chrome',
    browserProfile = '',
    cookieFile = '',
    speedProfile = 'safe',
    onProgress,
    onLog,
    signal,
    control = null,
    onOffline = null,
    onStagingReady = null,
    onCompleted = null,
  } = {}) {
    if (!nodeApi.available) {
      throw new Error('Скачивание доступно только внутри Eagle');
    }
    requireToolchain();

    let cookieDb = null;

    if (cookies && !cookieFile) {
      cookieDb =
        stageCookieDb(
          browser,
          browserProfile,
        );

      if (cookieDb && onLog) {
        onLog(
          'Куки браузера скопированы для чтения ' +
          '(браузер закрывать не нужно)',
        );
      } else if (onLog) {
        onLog(
          'Не нашёл базу кук — читаю напрямую ' +
          '(закройте браузер, если зависнет)',
        );
      }
    }

    try {

    const { path, fs } = nodeApi;

    const generatedStagingRoot =
      path.join(
        workRoot(),
        'staging',
        `${jobPrefix}-${Date.now()}`,
      );

    const stagingRoot = ensureDir(
      chooseGalleryStagingRoot(
        existingStagingRoot,
        generatedStagingRoot,
      ),
    );

    if (typeof onStagingReady === 'function') {
      await onStagingReady(stagingRoot);
    }

    const profile =
      SPEED_PROFILES[speedProfile] ||
      SPEED_PROFILES.safe;
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
        if (cookieFile) {
          args.push(
            '--cookies',
            cookieFile,
          );
        } else {
          args.push(
            '--cookies-from-browser',
            browserCookieSpec(
              browser,
              browserProfile,
              cookieDb,
            ),
          );
        }
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

      const completedEntry = {
        post,
        files,
        error,
      };

      results.push(completedEntry);

      await notifyGalleryDownloadCompleted(
        onCompleted,
        completedEntry,
      );

      if (error && onLog) {
        onLog(
          `Ошибка: ${post.url} — ${error}`,
        );
      }
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
