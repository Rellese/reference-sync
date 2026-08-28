/* ============================================================
   ReferenceSync — движок Instagram

   Перенос с Python:
     app/instagram_discover.py         → discoverSaved()
     app/instagram_normalize.py        → normalizePost()
     app/instagram_download_staging.py → downloadPosts()
     app/browser_cookie_source.py      → browserCookieSpec()

   Как в Python-версии, добычей данных занимается gallery-dl:
   плагин вызывает его как внешний процесс и разбирает
   --dump-json. Cookies берутся из браузера, где выполнен вход
   (--cookies-from-browser), пароль Instagram нигде не хранится.
   ============================================================ */

import {
  nodeApi,
  ensureDir,
  workRoot,
} from './node-bridge.js';
import {
  browserCookieSpecForProfile,
} from './browser-profiles.js';
import {
  runGallery as runGalleryOnce,
  requireToolchain,
} from './toolchain.js';
import {
  looksInstagramRateLimited,
  looksOffline,
  makeInstagramRateLimitError,
  RETRY_STEPS,
  runPublicationQueue,
  STOPPED,
  throwIfAborted,
} from './job-control.js';

/* Максимум попыток на одну публикацию при обрыве связи —
   ровно столько, сколько ступеней в лестнице пауз (5…30 с) */
const RETRY_STEPS_COUNT = RETRY_STEPS.length + 1;

const IMAGE_EXTENSIONS = new Set(
  ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic'],
);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'm4v']);

/* Режимы поиска — совпадают с Python (recent / smart / full) */
export const SEARCH_MODES = {
  SMART: 'smart',
  FULL: 'full',
  RECENT: 'recent',
};

/* Профили скорости — app/instagram_download_staging.py */
const SPEED_PROFILES = {
  safe: { sleepRequest: '2.0-4.0', retries: 3 },
  balanced: { sleepRequest: '1.0-2.0', retries: 2 },
  /* «Молния» — без задержек между запросами. Instagram может
     ответить блокировкой, поэтому режим выбирается вручную. */
  lightning: { sleepRequest: '0', retries: 1 },
};

/* Задержка добавляется только если профиль её задаёт */
function paceArgs(profile) {
  return profile.sleepRequest
    ? ['--sleep-request', profile.sleepRequest]
    : [];
}

export function buildSmartStopFilter(knownPostIds) {
  const source = knownPostIds instanceof Set
    ? [...knownPostIds]
    : Array.isArray(knownPostIds)
      ? knownPostIds
      : [];

  const values = [...new Set(
    source
      .map((value) => String(value || '').trim())
      .filter((value) => /^\d+$/.test(value)),
  )].sort();

  if (!values.length) return null;

  const tuple = values
    .map((value) => JSON.stringify(value))
    .join(',');

  return (
    `str(post_id) not in (${tuple},) ` +
    'or abort()'
  );
}

/* Cookies всегда берутся из явно выбранного профиля.
   При пустом profileId сохраняется совместимость с браузерами,
   где отдельный профиль не обнаружен. */
export function browserCookieSpec(browser, profileId = '') {
  return browserCookieSpecForProfile(browser, profileId);
}

/* ------------------------------------------------------------
   Проверка Instagram-аккаунта выбранного браузерного профиля

   gallery-dl временно экспортирует cookies в служебный файл.
   Из него читается только ds_user_id и наличие sessionid.
   Файл удаляется в finally и никогда не сохраняется в настройках.
   ------------------------------------------------------------ */

export function parseInstagramCookieExport(
  text,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  let userId = '';
  let hasValidSession = false;

  String(text || '').split(/\r?\n/).forEach((sourceLine) => {
    let line = sourceLine.trim();
    if (!line) return;

    /* Netscape сохраняет HttpOnly-cookie с таким префиксом.
       Это cookie-строка, а не обычный комментарий. */
    if (line.startsWith('#HttpOnly_')) {
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#')) {
      return;
    }

    const columns = line.split('\t');
    if (columns.length < 7) return;

    const domain = String(columns[0] || '').toLowerCase();
    if (!domain.endsWith('instagram.com')) return;

    const expires = Number(columns[4] || 0);
    const name = String(columns[5] || '').trim();
    const value = String(columns[6] || '').trim();

    if (name === 'ds_user_id') userId = value;

    if (name === 'sessionid' && value) {
      /* Значение 0 означает session-cookie без фиксированной даты.
         Остальные cookies должны иметь будущий срок действия. */
      const isValid = !Number.isFinite(expires) ||
        expires === 0 ||
        expires > nowSeconds;

      if (isValid) hasValidSession = true;
    }
  });

  return {
    authenticated: Boolean(hasValidSession && userId),
    userId: hasValidSession ? userId : '',
  };
}

export function isTransientCookieReadError(value) {
  const text = String(value || '').toLowerCase();

  return (
    text.includes('database disk image is malformed') ||
    text.includes('database is locked') ||
    text.includes('database is busy') ||
    text.includes('unable to open database file')
  );
}

async function runGallery(args, options = {}) {
  const firstResult = await runGalleryOnce(
    args,
    options,
  );

  const output = [
    firstResult.stdout,
    firstResult.stderr,
  ].join('\n');

  if (
    firstResult.code === 0 ||
    !isTransientCookieReadError(output)
  ) {
    return firstResult;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, 750);
  });

  throwIfAborted(options.signal);

  return runGalleryOnce(
    args,
    options,
  );
}

export function findInstagramUsername(value, userId) {
  const expectedId = String(userId || '').trim();
  if (!expectedId) return '';

  if (Array.isArray(value)) {
    for (const child of value) {
      const username = findInstagramUsername(child, expectedId);
      if (username) return username;
    }
    return '';
  }

  if (!value || typeof value !== 'object') return '';

  const candidateId = String(
    value.pk ?? value.id ?? value.user_id ?? '',
  ).trim();

  const candidateUsername = String(
    value.username ?? '',
  ).trim().replace(/^@/, '');

  if (
    candidateId === expectedId &&
    candidateUsername &&
    /^[A-Za-z0-9._]+$/.test(candidateUsername)
  ) {
    return candidateUsername;
  }

  for (const child of Object.values(value)) {
    const username = findInstagramUsername(child, expectedId);
    if (username) return username;
  }

  return '';
}

function removeTemporaryFile(file) {
  if (!nodeApi.available || !file) return;

  try {
    if (nodeApi.fs.existsSync(file)) {
      nodeApi.fs.unlinkSync(file);
    }
  } catch (_) {
    /* Временный файл также находится внутри workRoot,
       но ошибка удаления не должна скрывать основной результат. */
  }
}

export function removeInstagramCookieSnapshot(file) {
  removeTemporaryFile(file);
}

async function createBrowserCookieSnapshot({
  browser,
  browserProfile,
  signal,
  onLog,
}) {
  const cookieSpec = browserCookieSpec(
    browser,
    browserProfile,
  );

  const snapshotRoot = ensureDir(
    nodeApi.path.join(workRoot(), 'cookie-snapshots'),
  );

  const cookieFile = nodeApi.path.join(
    snapshotRoot,
    `cookies-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.txt`,
  );

  try {
    throwIfAborted(signal);

    const exportResult = await runGallery([
      '--config-ignore',
      '--no-input',
      '--cookies-from-browser', cookieSpec,
      '--cookies-export', cookieFile,
      '--no-download',
      'http://0/file.jpg',
    ], {
      signal,
      onStderr: (chunk) => {
        const line = redact(chunk).trim();
        if (line && onLog) onLog(line);
      },
    });

    throwIfAborted(signal);

    if (
      exportResult.code !== 0 ||
      !nodeApi.fs.existsSync(cookieFile)
    ) {
      throw new Error(
        'Не удалось создать временный snapshot cookies браузера.',
      );
    }

    try {
      nodeApi.fs.chmodSync(cookieFile, 0o600);
    } catch (_) {
      /* chmod может быть недоступен на некоторых системах. */
    }

    return cookieFile;
  } catch (error) {
    removeTemporaryFile(cookieFile);
    throw error;
  }
}

export async function verifyInstagramSession({
  browser = 'chrome',
  browserProfile = '',
  signal,
  onLog,
  keepCookieFile = false,
} = {}) {
  if (!nodeApi.available) {
    throw new Error(
      'Проверка Instagram доступна только внутри Eagle',
    );
  }

  requireToolchain();

  throwIfAborted(signal);

  const cookieSpec = browserCookieSpec(
    browser,
    browserProfile,
  );

  const sessionRoot = ensureDir(
    nodeApi.path.join(workRoot(), 'session-check'),
  );

  const cookieFile = nodeApi.path.join(
    sessionRoot,
    `cookies-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.txt`,
  );

  let preserveCookieFile = false;

  try {
    throwIfAborted(signal);

    /* Сначала gallery-dl безопасно расшифровывает cookies
       выбранного профиля штатным браузерным адаптером. */
    const exportResult = await runGallery([
      '--config-ignore',
      '--no-input',
      '--cookies-from-browser', cookieSpec,
      '--cookies-export', cookieFile,
      '--no-download',
      'http://0/file.jpg',
    ], {
      signal,
      onStderr: (chunk) => {
        const line = redact(chunk).trim();
        if (line && onLog) onLog(line);
      },
    });

    throwIfAborted(signal);

    if (
      exportResult.code !== 0 ||
      !nodeApi.fs.existsSync(cookieFile)
    ) {
      return {
        authenticated: false,
        username: '',
        userId: '',
        error:
          'Не удалось прочитать cookies выбранного профиля браузера.',
      };
    }

    /* Ограничиваем доступ к временному файлу текущим пользователем. */
    try {
      nodeApi.fs.chmodSync(cookieFile, 0o600);
    } catch (_) {
      /* На некоторых системах chmod для этого файла недоступен. */
    }

    const cookieText = nodeApi.fs.readFileSync(
      cookieFile,
      'utf8',
    );

    const session = parseInstagramCookieExport(cookieText);

    if (!session.authenticated) {
      return {
        authenticated: false,
        username: '',
        userId: '',
        error:
          'В выбранном профиле браузера вход в Instagram не выполнен.',
      };
    }

    /* Запрашиваем информацию именно по ds_user_id из cookies.
       Поэтому нельзя случайно принять имя автора Saved-публикации
       за имя владельца текущей сессии. */
    const infoUrl =
      `https://www.instagram.com/id:${session.userId}/info/`;

    let buffer = '';

    const infoResult = await runGallery([
      '--config-ignore',
      '--no-input',
      '--cookies', cookieFile,
      '--simulate',
      '--dump-json',
      '-o', 'extractor.instagram.metadata=true',
      '--retries', '1',
      '--http-timeout', '30',
      infoUrl,
    ], {
      signal,
      onStdout: (chunk) => {
        buffer += chunk;
      },
      onStderr: (chunk) => {
        const line = redact(chunk).trim();
        if (line && onLog) onLog(line);
      },
    });

    throwIfAborted(signal);

    const values = parseJsonStream(buffer);
    const username = findInstagramUsername(
      values,
      session.userId,
    );

    if (infoResult.code !== 0 || !username) {
      return {
        authenticated: false,
        username: '',
        userId: session.userId,
        error:
          'Instagram-сессия найдена, но имя аккаунта определить не удалось. ' +
          'Откройте Instagram в выбранном профиле и обновите страницу.',
      };
    }

    preserveCookieFile = keepCookieFile;

    return {
      authenticated: true,
      username,
      userId: session.userId,
      error: '',
      cookieFile: preserveCookieFile ? cookieFile : '',
    };
  } finally {
    if (!preserveCookieFile) {
      removeTemporaryFile(cookieFile);
    }
  }
}

/* ------------------------------------------------------------
   Разбор потока JSON от gallery-dl.
   Перенос parse_json_stream() + collect_metadata():
   вывод может быть одним документом, потоком значений или JSONL.
   ------------------------------------------------------------ */
export function parseJsonStream(text) {
  const values = [];
  let position = 0;

  while (position < text.length) {
    while (position < text.length && /\s/.test(text[position])) position += 1;
    if (position >= text.length) break;

    const char = text[position];
    if (char !== '{' && char !== '[') {
      const newline = text.indexOf('\n', position);
      if (newline === -1) break;
      position = newline + 1;
      continue;
    }

    const end = matchBracket(text, position);
    if (end === -1) break;

    try {
      values.push(JSON.parse(text.slice(position, end + 1)));
    } catch (_) { /* повреждённый фрагмент пропускаем */ }
    position = end + 1;
  }

  return values;
}

/* Поиск закрывающей скобки с учётом строк и экранирования */
function matchBracket(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/* Рекурсивно собирает записи постов из любой вложенности */
export function collectPostRecords(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((child) => collectPostRecords(child, output));
    return output;
  }

  if (value && typeof value === 'object') {
    if (value.post_id || value.post_shortcode) {
      output.push(value);
    }

    Object.values(value).forEach((child) =>
      collectPostRecords(child, output));
  }

  return output;
}

/* Объединяет отдельные записи компонентов gallery-dl
   в одну публикацию. Порядок первого появления сохраняется. */
export function buildPostRecords(records) {
  const groups = new Map();

  records.forEach((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return;

    const postId = textValue(record.post_id, record.external_id);
    if (!postId) return;

    let group = groups.get(postId);

    if (!group) {
      group = {
        base: { ...record, post_id: postId },
        components: [],
        mediaIds: new Set(),
      };
      groups.set(postId, group);
    } else {
      Object.entries(record).forEach(([key, value]) => {
        const current = group.base[key];

        if (
          (current === undefined || current === null || current === '') &&
          value !== undefined &&
          value !== null &&
          value !== ''
        ) {
          group.base[key] = value;
        }
      });
    }

    const mediaId = textValue(record.media_id);
    const extension = textValue(record.extension)
      .toLowerCase()
      .replace(/^\./, '');

    if (!mediaId || !extension || group.mediaIds.has(mediaId)) return;

    group.mediaIds.add(mediaId);

    const requestedIndex = Number.parseInt(
      record.num ?? record.component_index,
      10,
    );

    const componentIndex = requestedIndex > 0
      ? requestedIndex
      : group.components.length + 1;

    let mediaType = 'unknown';
    if (VIDEO_EXTENSIONS.has(extension)) mediaType = 'video';
    else if (IMAGE_EXTENSIONS.has(extension)) mediaType = 'image';

    group.components.push({
      media_id: mediaId,
      component_index: componentIndex,
      media_type: mediaType,
      extension,
      preview_url: smallestPreview(record),
      source_url: textValue(
        record.video_url,
        record.display_url,
        record.url,
      ),
      preview_width: record.width ?? null,
      preview_height: record.height ?? null,
    });
  });

  return Array.from(groups.values()).map((group) => {
    const result = { ...group.base };

    const hasEmbeddedComponents =
      Array.isArray(result.component_items) ||
      Array.isArray(result.components) ||
      Array.isArray(result.carousel_media);

    if (!hasEmbeddedComponents && group.components.length) {
      result.component_items = group.components;
    }

    return result;
  });
}

/* ------------------------------------------------------------
   Нормализация. Перенос instagram_normalize.py
   ------------------------------------------------------------ */
function textValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const result = String(value).trim();
    if (result) return result;
  }
  return '';
}

function mediaTypeOf(component) {
  const extension = textValue(component.extension)
    .toLowerCase()
    .replace(/^\./, '');

  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';

  const declared = textValue(
    component.media_type,
    component.type,
  ).toLowerCase();

  if (declared.includes('video')) return 'video';

  if (
    declared.includes('image') ||
    declared.includes('photo')
  ) {
    return 'image';
  }

  return 'unknown';
}

export function canonicalUrl(postId, shortcode, url) {
  const normalized = textValue(url);

  if (normalized) {
    return `${normalized.replace(/\/+$/, '')}/`;
  }

  if (shortcode) {
    return `https://www.instagram.com/p/${shortcode}/`;
  }

  return '';
}

/* Достаёт самый маленький превью-кадр из метаданных Instagram.
   Перенос gallery_dl_extractors/instagram_small_preview.py —
   превью не скачивается отдельно, берётся уже готовый URL. */
function smallestPreview(record) {
  const versions = record.image_versions2;
  const candidates = versions?.candidates;
  if (!Array.isArray(candidates)) {
    return textValue(record.preview_url, record.display_url, record.thumbnail);
  }

  const valid = candidates
    .filter((item) => item && item.url && item.width > 0 && item.height > 0)
    .sort((a, b) => (a.width * a.height) - (b.width * b.height));

  return valid.length ? valid[0].url
    : textValue(record.preview_url, record.display_url);
}

/* Собирает компоненты карусели */
function normalizeComponents(record, postId) {
  let raw = record.component_items;
  if (!Array.isArray(raw)) raw = record.components;

  /* Карусель Instagram приходит как carousel_media */
  if (!Array.isArray(raw) && Array.isArray(record.carousel_media)) {
    raw = record.carousel_media.map((item, index) => ({
      media_id: textValue(item.id, item.pk, `${postId}:${index + 1}`),
      component_index: index + 1,
      media_type: item.video_versions ? 'video' : 'image',
      extension: item.video_versions ? 'mp4' : 'jpg',
      preview_url: smallestPreview(item),
      source_url: item.video_versions?.[0]?.url ||
        item.image_versions2?.candidates?.[0]?.url,
    }));
  }

  const mediaIds = Array.isArray(record.media_ids) ? record.media_ids : [];

  if (!Array.isArray(raw) || !raw.length) {
    if (mediaIds.length) {
      raw = mediaIds.map((mediaId, index) => ({
        media_id: mediaId,
        component_index: index + 1,
      }));
    } else {
      /* Одиночная публикация */
      raw = [{
        media_id: textValue(record.media_id, record.pk, `${postId}:1`),
        component_index: 1,
        media_type: record.video_versions || record.video_url ? 'video' : 'image',
        extension: textValue(record.extension) ||
          (record.video_versions || record.video_url ? 'mp4' : 'jpg'),
        preview_url: smallestPreview(record),
        source_url: textValue(
          record.video_versions?.[0]?.url,
          record.video_url,
          record.display_url,
          record.url,
        ),
      }];
    }
  }

  const seen = new Set();
  const normalized = [];

  raw.forEach((component, fallbackIndex) => {
    if (!component || typeof component !== 'object') return;

    const index = Number.parseInt(component.component_index, 10) > 0
      ? Number.parseInt(component.component_index, 10)
      : fallbackIndex + 1;

    const mediaId = textValue(
      component.media_id,
      mediaIds[index - 1],
      `${postId}:${index}`,
    );

    const identity = `${mediaId}#${index}`;
    if (seen.has(identity)) return;
    seen.add(identity);

    const extension = textValue(component.extension)
      .toLowerCase().replace(/^\./, '') || null;

    normalized.push({
      sourceMediaId: mediaId,
      index,
      mediaType: mediaTypeOf(component),
      url: textValue(component.source_url, component.preview_url, component.url) || null,
      previewUrl: textValue(component.preview_url, component.url) || null,
      extension,
      width: component.preview_width ?? component.width ?? null,
      height: component.preview_height ?? component.height ?? null,
    });
  });

  normalized.sort((a, b) => a.index - b.index ||
    String(a.sourceMediaId).localeCompare(String(b.sourceMediaId)));

  return normalized;
}

/* Итоговая нормализованная публикация для интерфейса */
export function normalizePost(record, options = {}) {
  const {
    accountUsername = '',
    collectionId = 'saved',
    collectionName = 'Saved',
  } = options;

  const postId = textValue(
    record.post_id,
    record.external_id,
  );
  if (!postId) return null;

  const username = textValue(
    record.username, record.owner_username,
    record.user?.username, record.owner?.username,
    accountUsername,
  ).replace(/^@/, '');

  const shortcode = textValue(record.post_shortcode, record.shortcode, record.code);
  const url = canonicalUrl(postId, shortcode,
    textValue(record.post_url, record.canonical_url));
    if (!url) return null;


  const components = normalizeComponents(record, postId);
  const videoCount = components.filter((item) => item.mediaType === 'video').length;

  /* Тип публикации для таблицы */
  let type = 'Фото';
  if (components.length > 1) type = videoCount ? 'Карусель, видео' : 'Карусель';
  else if (videoCount) type = 'Видео';

  const description = textValue(
    record.description,
    record.caption?.text,
    typeof record.caption === 'string' ? record.caption : '',
    record.title,
  );

  const takenAt = Number(
    record.taken_at ?? record.taken_at_timestamp ?? record.date ?? 0,
  ) || null;

  return {
    postId,
    shortcode,
    url,
    username: username ? `@${username}` : '@unknown',
    plainUsername: username,
    type,
    componentCount: components.length,
    structure: components.length > 1
      ? `${components.length} элем.`
      : '1 элем.',
    components,
    selectedComponents: components.map((item) => item.index),
    description,
    previewUrl: components[0]?.previewUrl || smallestPreview(record) || '',
    takenAt,
    collectionId,
    collectionName,
    containers: [{
      platform: 'instagram',
      kind: 'COLLECTION',
      id: collectionId,
      name: collectionName,
    }],
  };
}

/* ------------------------------------------------------------
   Поиск сохранённых публикаций.
   Перенос instagram_discover.py: тот же набор аргументов
   gallery-dl, включая --simulate --dump-json и --post-range
   только для режима «последние N».
   ------------------------------------------------------------ */
export async function discoverSaved({
  username,
  browser = 'chrome',
  browserProfile = '',
  cookieFile = '',
  searchMode = SEARCH_MODES.SMART,
  limit = 50,
  speedProfile = 'safe',
  collections = [],
  knownPostIds = new Set(),
  onProgress,
  onLog,
  signal,
} = {}) {
  const cleanUser = String(username || '').trim().replace(/^@/, '');
  if (!cleanUser) throw new Error('Не указан Instagram-аккаунт');
  if (!/^[A-Za-z0-9._]+$/.test(cleanUser)) {
    throw new Error(`Некорректное имя аккаунта: ${cleanUser}`);
  }

  /* Движок ищется и при необходимости ставится плагином,
     см. js/toolchain.js. Пользователь терминал не открывает. */
  requireToolchain();
  throwIfAborted(signal);

  const cookieArgs = cookieFile
    ? ['--cookies', cookieFile]
    : [
        '--cookies-from-browser',
        browserCookieSpec(browser, browserProfile),
      ];
  const profile = SPEED_PROFILES[speedProfile] || SPEED_PROFILES.safe;

  /* Целевые адреса: общая лента или выбранные коллекции.
     Контракт из docs/CONTEXT.md сохранён. */
  const savedUrl = `https://www.instagram.com/${cleanUser}/saved/all-posts/`;
  const targets = collections.length
    ? collections.map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      url: entry.id === 'ALL_MEDIA_AUTO_COLLECTION'
        ? savedUrl
        : `https://www.instagram.com/${cleanUser}/saved/collection/${entry.id}/`,
    }))
    : [{ id: 'saved', name: 'Saved', url: savedUrl }];

  const posts = [];
  const seenIds = new Set();
  let stoppedEarly = false;

  for (const target of targets) {
    throwIfAborted(signal);

    const args = [
      '--config-ignore',
      '--no-input',
      ...cookieArgs,
      '--simulate',
      '--dump-json',
      '--retries', String(profile.retries),
      '--http-timeout', '30',
      ...paceArgs(profile),
    ];

    /* Только режим «последние N» ограничивает выборку.
       smart и full используют курсорную пагинацию gallery-dl. */
    if (searchMode === SEARCH_MODES.RECENT && limit > 0) {
      args.push('--post-range', `1-${limit}`);
    }

    if (searchMode === SEARCH_MODES.SMART) {
      const smartFilter = buildSmartStopFilter(
        knownPostIds,
      );

      if (smartFilter) {
        args.push('--filter', smartFilter);
      }
    }

    args.push(target.url);

    if (onLog) {
      onLog(`gallery-dl: ${target.name} (${target.url})`);
    }

    let buffer = '';
    let discovered = 0;

    const result = await runGallery(args, {
      signal,
      onStdout: (chunk) => {
        buffer += chunk;
        /* Прогресс по мере поступления записей */
        const matches = chunk.match(/"post_id"|"post_shortcode"/g);
        if (matches && onProgress) {
          discovered += matches.length;
          onProgress({
            stage: 'discover',
            collection: target.name,
            approximate: discovered,
          });
        }
      },
      onStderr: (chunk) => {
        const line = redact(chunk).trim();
        if (line && onLog) onLog(line);
      },
    });
    throwIfAborted(signal);

   const records = buildPostRecords(
      collectPostRecords(parseJsonStream(buffer)),
    );


    for (const record of records) {
      const post = normalizePost(record, {
        accountUsername: cleanUser,
        collectionId: target.id,
        collectionName: target.name,
      });
      if (!post) continue;
      if (seenIds.has(post.postId)) continue;

      /* Режим «только новые»: останавливаемся на первой
         уже известной публикации (перенос smart-логики). */
      if (knownPostIds.has(post.postId)) {
        if (searchMode === SEARCH_MODES.SMART) {
          stoppedEarly = true;
          break;
        }

        /* В Recent и Full известная публикация пропускается,
        но не останавливает просмотр следующих результатов. */
        continue;
      }
      
      seenIds.add(post.postId);
      posts.push(post);
    }

    if (result.code !== 0 && !posts.length) {
      throw new Error(classifyFailure(result, browser));
    }
    if (stoppedEarly) break;
  }

  const outputPosts =
    searchMode === SEARCH_MODES.RECENT && limit > 0
      ? posts.slice(0, limit)
      : posts;

  return { posts: outputPosts, stoppedEarly, savedUrl };
}

/* Диагностика ошибок. Перенос classify_failure() */
function classifyFailure(result, browser) {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (text.includes('could not find') && text.includes('cookies')) {
    return `Не удалось прочитать cookies из браузера «${browser}». ` +
      'Убедитесь, что в нём выполнен вход в Instagram.';
  }
  if (text.includes('database is locked') || text.includes('permissionerror')) {
    return `Файл cookies занят браузером «${browser}». Закройте браузер и повторите.`;
  }
  if (text.includes('login required') || text.includes('checkpoint') ||
      text.includes('challenge')) {
    return 'Instagram требует повторный вход. Откройте instagram.com в браузере, ' +
      'войдите в аккаунт и повторите поиск.';
  }
  if (text.includes('429') || text.includes('rate limit')) {
    return 'Instagram ограничил частоту запросов. Подождите и включите ' +
      'безопасный режим скорости.';
  }
  return `gallery-dl завершился с кодом ${result.code}. ` +
    'Подробности в техническом журнале.';
}

/* Убирает секреты из логов. Перенос redact() */
export function redact(text) {
  return String(text)
    .replace(/(sessionid\s*[=:]\s*)[^;\s,"']+/gi, '$1<REDACTED>')
    .replace(/(csrftoken\s*[=:]\s*)[^;\s,"']+/gi, '$1<REDACTED>')
    .replace(/(ds_user_id\s*[=:]\s*)[^;\s,"']+/gi, '$1<REDACTED>');
}

/* ------------------------------------------------------------
   Скачивание выбранных публикаций во временную папку.
   Перенос instagram_download_staging.py: файлы сначала
   складываются на диск, и только потом отдаются в Eagle.
   ------------------------------------------------------------ */
export async function downloadPosts({
  posts,
  browser = 'chrome',
  browserProfile = '',
  stagingRoot: existingStagingRoot = '',
  speedProfile = 'safe',
  onProgress,
  onLog,
  signal,
  onStagingReady,
  onCompleted,
  /* Управление паузой/остановкой и ожиданием связи.
     Передаётся из main.js, см. js/job-control.js */
  control = null,
  onOffline = null,
} = {}) {
  if (!nodeApi.available) {
    throw new Error('Скачивание доступно только внутри Eagle');
  }

  requireToolchain();

  const { path, fs } = nodeApi;
  const stagingRoot = existingStagingRoot
    ? ensureDir(existingStagingRoot)
    : ensureDir(nodeApi.path.join(
      workRoot(),
      'staging',
      `job-${Date.now()}`,
    ));

    if (onStagingReady) {
      onStagingReady(stagingRoot);
    }
  const cookieFile = await createBrowserCookieSnapshot({
    browser, 
    browserProfile, 
    signal, 
    onLog,
  });
  const profile = SPEED_PROFILES[speedProfile] || SPEED_PROFILES.safe;
  

  const queue = await runPublicationQueue(
    posts,
    async (post, index) => {

    /* Пауза/остановка проверяются между публикациями: очередь
       не ломается, текущий файл всегда докачивается целиком */
    if (control) await control.checkpoint();

    const postDir = ensureDir(path.join(stagingRoot, post.postId));

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
      '--cookies', cookieFile,
      '--retries', String(profile.retries),
      '--http-timeout', '60',
      ...paceArgs(profile),
      '--dest', postDir,
      '--filename', '{num}.{extension}',
      '--directory', '',
      post.url,
    ];

    /* Попытки: при обрыве связи ждём по лестнице 5→30 сек
       и повторяем ту же публикацию, не сдвигая очередь */
    let error = null;
    let attempts = 0;
    const maxAttempts = control ? RETRY_STEPS_COUNT : 1;

    for (;;) {
      attempts += 1;
      error = null;
      let raw = '';
      try {
        const result = await runGallery(args, {
          signal,
          onStderr: (chunk) => {
            raw += chunk;
            const line = redact(chunk).trim();
            if (line && onLog) onLog(line);
          },
        });
        raw += `\n${result.stdout || ''}\n${result.stderr || ''}`;
        if (result.code !== 0) error = classifyFailure(result, browser);
      } catch (runError) {
        raw += `\n${runError.message}`;
        error = runError.message;
      }

      /* Файлы появились — связь есть, лестницу сбрасываем */
      if (!error) {
        if (control) control.resetRetries();
        break;
      }
      if (!control || attempts >= maxAttempts) break;
      if (!looksOffline(raw)) break;

      /* Состояние 5: ждём восстановления соединения */
      if (onLog) onLog(`Обрыв связи. Ожидание ${control.retryStep} с…`);
      await control.waitForConnection({
        onTick: (left) => { if (onOffline) onOffline(left, post); },
      });
      await control.checkpoint();
    }

    /* Собираем скачанные файлы в порядке компонентов */
    let files = [];
    try {
      files = fs.readdirSync(postDir)
        .filter((name) => !name.startsWith('.'))
        .map((name) => path.join(postDir, name))
        .filter((file) => {
          try { return fs.statSync(file).size > 0; }
          catch (_) { return false; }
        })
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (_) { /* папка пуста */ }

    if (!files.length && !error) {
      error = 'gallery-dl не вернул файлов для этой публикации';
    }

    if (error && looksInstagramRateLimited(raw)) {
      const rateLimitError = makeInstagramRateLimitError(error);
      rateLimitError.files = files;
      throw rateLimitError;
    }

    if (error) {
      if (onLog) onLog(`Ошибка: ${post.url} — ${error}`);

      const postError = new Error(error);
      postError.files = files;
      throw postError;
    }

const completedEntry = {
  post,
  files,
  error: null,
};

if (onCompleted) {
  onCompleted(completedEntry);
}

return completedEntry;
  },
  { signal },
).finally(() => {
  removeTemporaryFile(cookieFile);
});

if (
  queue.stopped &&
  queue.stopReason === STOPPED
) {
  const stopError = new Error('Процесс остановлен пользователем');
  stopError.code = STOPPED;
  throw stopError;
}

const completed = queue.completed.map((entry) => entry.value);

const failed = queue.failed.map((entry) => ({
  post: entry.item,
  files: Array.isArray(entry.cause?.files)
    ? entry.cause.files
    : [],
  error: entry.error,
}));

const resultByPost = new Map();

completed.forEach((result) => {
  resultByPost.set(result.post, result);
});

failed.forEach((result) => {
  resultByPost.set(result.post, result);
});

const results = posts
  .map((post) => resultByPost.get(post))
  .filter(Boolean);

return {
  stagingRoot,
  results,
  completed,
  failed,
  stopped: queue.stopped,
  stopReason: queue.stopReason,
};
}
