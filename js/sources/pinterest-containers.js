/* ============================================================
   Pinterest — список досок и вложенных разделов

   Использует авторизацию из временного cookie-файла.
   Никакие cookies не сохраняются в настройках плагина.
   ============================================================ */

import {
  ensureDir,
  nodeApi,
  workRoot,
} from '../node-bridge.js';

import {
  browserCookieSpecForProfile,
} from '../browser-profiles.js';

import {
  runGallery,
} from '../toolchain.js';

const HOST = 'www.pinterest.com';

const ROOT =
  'https://www.pinterest.com';

function pinterestCookieSnapshotPath() {
  if (!nodeApi.available) {
    return '';
  }

  const directory =
    ensureDir(
      nodeApi.path.join(
        workRoot(),
        'cookie-cache',
      ),
    );

  return nodeApi.path.join(
    directory,
    `pinterest-${Date.now()}-${
      Math.random()
        .toString(16)
        .slice(2)
    }.txt`,
  );
}

function removePinterestCookieSnapshot(
  cookieFile,
) {
  if (
    !nodeApi.available ||
    !cookieFile
  ) {
    return;
  }

  try {
    nodeApi.fs.unlinkSync(cookieFile);
  } catch (_) {
    /* Файл уже удалён или не был создан. */
  }
}

export function pinterestCookieExportArgs({
  username,
  browserCookieSpec,
  cookieFile,
}) {
  const cleanUsername =
    String(username ?? '')
      .trim()
      .replace(/^@+/, '');

  return [
    '--cookies-from-browser',
    browserCookieSpec,

    '--cookies-export',
    cookieFile,

    '--simulate',
    '--range',
    '1',

    `https://www.pinterest.com/${
      cleanUsername
    }/pins/`,
  ];
}

async function createPinterestCookieSnapshot({
  username,
  browser,
  browserProfile,
  signal,
}) {
  const cookieFile =
    pinterestCookieSnapshotPath();

  if (!cookieFile) {
    throw new Error(
      'Не удалось создать временный файл cookies Pinterest',
    );
  }

  const browserCookieSpec =
    browserCookieSpecForProfile(
      browser,
      browserProfile,
    );

  const args =
    pinterestCookieExportArgs({
      username,
      browserCookieSpec,
      cookieFile,
    });

  let result;

  try {
    result =
      await runGallery(
        args,
        {
          signal,
          timeout: 120000,
        },
      );
  } catch (error) {
    removePinterestCookieSnapshot(
      cookieFile,
    );

    throw error;
  }

  const created =
    nodeApi.fs.existsSync(cookieFile);

  const hasContent =
    created &&
    nodeApi.fs.statSync(cookieFile).size > 0;

  if (
    result.code !== 0 ||
    !hasContent
  ) {
    removePinterestCookieSnapshot(
      cookieFile,
    );

    const diagnostic =
      String(
        result.stderr ||
        result.stdout ||
        '',
      )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-3)
        .join(' ');

    throw new Error(
      'Не удалось получить авторизацию Pinterest ' +
      `из браузера «${browser}»` +
      (
        diagnostic
          ? `: ${diagnostic}`
          : ''
      ),
    );
  }

  return cookieFile;
}

function clean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'bigint'
  ) {
    return '';
  }

  return String(value).trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = clean(value);

    if (text) {
      return text;
    }
  }

  return '';
}

function objectValue(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
    ? value
    : null;
}

export function unwrapPinterestBoard(record) {
  const source =
    objectValue(record?.board) ||
    objectValue(record?.node) ||
    objectValue(record?.data?.board) ||
    objectValue(record);

  return source || {};
}

function absoluteUrl(value) {
  const text = clean(value);

  if (!text) {
    return '';
  }

  const url = /^https?:\/\//i.test(text)
    ? text
    : `${ROOT}/${text.replace(/^\/+/, '')}`;

  return url.endsWith('/')
    ? url
    : `${url}/`;
}

export function readPinterestCookies(cookieFile) {
  if (
    !nodeApi.available ||
    !cookieFile ||
    !nodeApi.fs.existsSync(cookieFile)
  ) {
    throw new Error(
      'Не найден временный файл авторизации Pinterest',
    );
  }

  const cookies = new Map();

  nodeApi.fs
    .readFileSync(cookieFile, 'utf8')
    .split(/\r?\n/)
    .forEach((sourceLine) => {
      let line =
        String(sourceLine || '').trim();

      if (line.startsWith('#HttpOnly_')) {
        line =
          line.slice('#HttpOnly_'.length);
      } else if (
        !line ||
        line.startsWith('#')
      ) {
        return;
      }

      const parts = line.split('\t');

      if (parts.length < 7) {
        return;
      }

      const domain =
        clean(parts[0]).toLowerCase();

      if (!domain.endsWith('pinterest.com')) {
        return;
      }

      const name =
        clean(parts[5]);

      const value =
        clean(parts.slice(6).join('\t'));

      if (name && value) {
        cookies.set(name, value);
      }
    });

  if (!cookies.size) {
    throw new Error(
      'В выбранном профиле нет cookies Pinterest',
    );
  }

  return cookies;
}

function cookieHeader(cookies) {
  return [...cookies.entries()]
    .map(
      ([name, value]) =>
        `${name}=${value}`,
    )
    .join('; ');
}

function browserUserAgent() {
  if (
    typeof navigator !== 'undefined' &&
    navigator.userAgent
  ) {
    return navigator.userAgent;
  }

  return (
    'Mozilla/5.0 ' +
    'AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) ' +
    'Chrome/142.0.0.0 Safari/537.36'
  );
}

function requestText({
  path,
  headers,
  signal,
}) {
  return new Promise(
    (resolve, reject) => {
      let settled = false;
      let abortHandler = null;

      const finish = (
        callback,
        value,
      ) => {
        if (settled) return;

        settled = true;

        if (
          signal &&
          abortHandler
        ) {
          signal.removeEventListener(
            'abort',
            abortHandler,
          );
        }

        callback(value);
      };

      const request =
        nodeApi.https.request(
          {
            protocol: 'https:',
            hostname: HOST,
            path,
            method: 'GET',
            headers,
          },
          (response) => {
            let body = '';

            response.setEncoding('utf8');

            response.on(
              'data',
              (chunk) => {
                body += chunk;
              },
            );

            response.on(
              'end',
              () => {
                finish(resolve, {
                  statusCode:
                    response.statusCode || 0,

                  body,
                });
              },
            );
          },
        );

      request.setTimeout(
        30000,
        () => {
          request.destroy(
            new Error(
              'Pinterest не ответил за 30 секунд',
            ),
          );
        },
      );

      request.on(
        'error',
        (error) => {
          finish(reject, error);
        },
      );

      abortHandler = () => {
        request.destroy(
          new Error('Операция остановлена'),
        );
      };

      if (signal) {
        if (signal.aborted) {
          abortHandler();
          return;
        }

        signal.addEventListener(
          'abort',
          abortHandler,
          { once: true },
        );
      }

      request.end();
    },
  );
}

function requestHeaders({
  cookies,
  username,
  sourceUrl,
}) {
  return {
    Accept:
      'application/json, text/javascript, */*; q=0.01',

    Cookie:
      cookieHeader(cookies),

    Referer:
      `${ROOT}/`,

    'User-Agent':
      browserUserAgent(),

    'X-Requested-With':
      'XMLHttpRequest',

    'X-Pinterest-AppState':
      'active',

    'X-Pinterest-Source-Url':
      sourceUrl || '/',

    'X-Pinterest-PWS-Handler':
      `www/${username || '[username]'}.js`,

    'Sec-Fetch-Dest':
      'empty',

    'Sec-Fetch-Mode':
      'cors',

    'Sec-Fetch-Site':
      'same-origin',
  };
}

async function requestResource({
  resource,
  options,
  cookies,
  username,
  sourceUrl,
  signal,
}) {
  const query =
    new URLSearchParams();

  query.set(
    'data',
    JSON.stringify({ options }),
  );

  query.set(
    'source_url',
    sourceUrl || '',
  );

  const response =
    await requestText({
      path:
        `/resource/${resource}Resource/get/?${query}`,

      headers:
        requestHeaders({
          cookies,
          username,
          sourceUrl,
        }),

      signal,
    });

  let payload = null;

  try {
    payload =
      JSON.parse(response.body);
  } catch (_) {
    /* Понятная ошибка формируется ниже. */
  }

  if (
    response.statusCode < 200 ||
    response.statusCode >= 300
  ) {
    const detail =
      payload?.message ||
      payload?.resource_response?.error?.message ||
      response.body.slice(0, 200).trim() ||
      'без описания';

    throw new Error(
      `Pinterest вернул код ` +
      `${response.statusCode}: ${detail}`,
    );
  }

  if (!payload) {
    throw new Error(
      'Pinterest вернул некорректный JSON',
    );
  }

  if (
    payload?.resource_response?.error
  ) {
    const error =
      payload.resource_response.error;

    throw new Error(
      firstText(
        error.message,
        error.name,
        'Pinterest не вернул данные',
      ),
    );
  }

  return payload;
}

function resourceItems(payload) {
  const data =
    payload?.resource_response?.data;

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.results)) {
    return data.results;
  }

  return [];
}

function nextBookmarks(payload) {
  const bookmarks =
    payload?.resource?.options?.bookmarks;

  if (!Array.isArray(bookmarks)) {
    return [];
  }

  return bookmarks
    .map(clean)
    .filter(Boolean);
}

function paginationFinished(bookmarks) {
  return (
    !bookmarks.length ||
    bookmarks[0] === '-end-' ||
    bookmarks[0].startsWith('Y2JOb25lO')
  );
}

async function requestAllPages({
  resource,
  options,
  cookies,
  username,
  sourceUrl,
  signal,
  maximumPages = 100,
}) {
  const records = [];
  const knownIds = new Set();
  const knownBookmarks = new Set();

  let bookmarks = null;

  for (
    let page = 0;
    page < maximumPages;
    page += 1
  ) {
    const pageOptions = {
      ...options,
    };

    if (bookmarks) {
      pageOptions.bookmarks = bookmarks;
    }

    const payload =
      await requestResource({
        resource,
        options: pageOptions,
        cookies,
        username,
        sourceUrl,
        signal,
      });

    resourceItems(payload)
      .forEach(
        (record) => {
          if (
            !record ||
            typeof record !== 'object'
          ) {
            return;
          }

          const identity =
            firstText(
              record.id,
              record.url,
              record.slug,
              record.name,
              record.title,
            );

          if (
            !identity ||
            knownIds.has(identity)
          ) {
            return;
          }

          knownIds.add(identity);
          records.push(record);
        },
      );

    const next =
      nextBookmarks(payload);

    if (paginationFinished(next)) {
      break;
    }

    const bookmarkKey =
      JSON.stringify(next);

    if (knownBookmarks.has(bookmarkKey)) {
      break;
    }

    knownBookmarks.add(bookmarkKey);
    bookmarks = next;
  }

  return records;
}

export function normalizePinterestBoard(
  rawBoard,
  username,
  position,
) {
  const board =
    unwrapPinterestBoard(rawBoard);

  const id =
    firstText(
      board.id,
      board.board_id,
      rawBoard?.board_id,
      rawBoard?.id,
    );

  if (!id) {
    return null;
  }

  const rawUrl =
    firstText(
      board.url,
      board.board_url,
      rawBoard?.url,
      rawBoard?.board_url,
    );

  const rawSlug =
    firstText(
      board.slug,
      board.board_slug,
      rawBoard?.slug,
      rawBoard?.board_slug,
    );

  const rawName =
    firstText(
      board.name,
      board.title,
      board.board_name,
      rawBoard?.title,
      rawBoard?.board_name,
    );

  const fallbackSlug =
    rawUrl
      .split('/')
      .filter(Boolean)
      .pop() || '';

  const slug =
    firstText(
      rawSlug,
      fallbackSlug,
    );

  const name =
    firstText(
      rawName,
      slug,
      `Доска ${position}`,
    );

  const url =
    absoluteUrl(
      rawUrl ||
      (
        slug
          ? `${username}/${slug}`
          : ''
      ),
    );

  if (!url) {
    return null;
  }

  const rawPinCount =
    firstText(
      board.pin_count,
      board.pins_count,
      rawBoard?.pin_count,
      rawBoard?.pins_count,
    );

  const rawSectionCount =
    firstText(
      board.section_count,
      board.sections_count,
      rawBoard?.section_count,
      rawBoard?.sections_count,
    );

  const pinCount =
    rawPinCount === ''
      ? null
      : Number(rawPinCount);

  const sectionCount =
    rawSectionCount === ''
      ? null
      : Number(rawSectionCount);

  return {
    id,
    name,
    type: 'BOARD',
    parentId: '',
    slug,
    url,

    pinCount:
      Number.isFinite(pinCount)
        ? pinCount
        : null,

    sectionCount:
      Number.isFinite(sectionCount)
        ? sectionCount
        : null,

    position,
  };
}

export function normalizePinterestSection(
  rawSection,
  board,
  position,
) {
  const section =
    objectValue(rawSection?.section) ||
    objectValue(rawSection?.node) ||
    objectValue(rawSection);

  const id =
    firstText(
      section?.id,
      section?.section_id,
      rawSection?.section_id,
      rawSection?.id,
    );

  if (!id) {
    return null;
  }

  const name =
    firstText(
      section?.title,
      section?.name,
      section?.section_name,
      rawSection?.title,
      rawSection?.section_name,
      `Раздел ${position}`,
    );

  const boardUrl =
    absoluteUrl(board?.url);

  const suppliedUrl =
    firstText(
      section?.url,
      section?.section_url,
      rawSection?.url,
      rawSection?.section_url,
    );

  const url =
    absoluteUrl(suppliedUrl) ||
    (
      boardUrl
        ? `${boardUrl}id:${
          encodeURIComponent(id)
        }/`
        : ''
    );

  const rawPinCount =
    firstText(
      section?.pin_count,
      section?.pins_count,
      rawSection?.pin_count,
      rawSection?.pins_count,
    );

  const pinCount =
    rawPinCount === ''
      ? null
      : Number(rawPinCount);

  return {
    id,
    name,
    type: 'SECTION',

    parentId:
      clean(board?.id),

    parentName:
      clean(board?.name),

    boardUrl,

    boardSlug:
      clean(board?.slug),

    slug:
      firstText(
        section?.slug,
        section?.section_slug,
        rawSection?.slug,
        rawSection?.section_slug,
      ),

    url,

    pinCount:
      Number.isFinite(pinCount)
        ? pinCount
        : null,

    position,
  };
}

export async function listPinterestContainers({
  cookieFile,
  username,
  browser = 'chrome',
  browserProfile = '',
  signal,
  maximumPages = 100,
  onProgress,
} = {}) {
  const cleanUsername =
    clean(username).replace(/^@+/, '');

  if (!cleanUsername) {
    throw new Error(
      'Введите имя пользователя Pinterest',
    );
  }

  let temporaryCookieFile = '';

  const activeCookieFile =
    cookieFile ||
    await createPinterestCookieSnapshot({
      username: cleanUsername,
      browser,
      browserProfile,
      signal,
    });

  if (!cookieFile) {
    temporaryCookieFile =
      activeCookieFile;
  }

  const cookies =
    readPinterestCookies(
      activeCookieFile,
    );

  const profilePath =
    `/${cleanUsername}/`;

  const rawBoards =
    await requestAllPages({
      resource: 'Boards',

      options: {
        sort: 'last_pinned_to',
        field_set_key: 'profile_grid_item',
        filter_stories: false,
        username: cleanUsername,
        page_size: 25,
        include_archived: true,
      },

      cookies,
      username: cleanUsername,
      sourceUrl: profilePath,
      signal,
      maximumPages,
    });

  const boards =
    rawBoards
      .map(
        (board, index) =>
          normalizePinterestBoard(
            board,
            cleanUsername,
            index + 1,
          ),
      )
      .filter(Boolean);

  if (!boards.length) {
    throw new Error(
      'Pinterest не вернул список досок. ' +
      'Проверьте профиль браузера и имя пользователя.',
    );
  }

  const containers = [];

  for (
    let index = 0;
    index < boards.length;
    index += 1
  ) {
    const board =
      boards[index];

    containers.push(board);

    if (onProgress) {
      onProgress({
        stage: 'sections',
        current: index + 1,
        total: boards.length,
        board,
      });
    }

    if (board.sectionCount === 0) {
      continue;
    }

    let rawSections;

    try {
      rawSections =
        await requestAllPages({
          resource: 'BoardSections',

          options: {
            board_id: board.id,
          },

          cookies,
          username: cleanUsername,

          sourceUrl:
            new URL(board.url).pathname,

          signal,
          maximumPages,
        });
    } catch (error) {
      throw new Error(
        `Не удалось получить разделы доски ` +
        `«${board.name}»: ${error.message}`,
      );
    }

    rawSections
      .map(
        (section, sectionIndex) =>
          normalizePinterestSection(
            section,
            board,
            sectionIndex + 1,
          ),
      )
      .filter(Boolean)
      .forEach(
        (section) => {
          containers.push(section);
        },
      );
  }

  removePinterestCookieSnapshot(
    temporaryCookieFile,
  );

  return containers;
}
