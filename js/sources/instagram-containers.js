/* ============================================================
   Instagram Saved Collections — GraphQL diagnostic

   Получает только список коллекций:
   - название;
   - collection_id;
   - количество публикаций;
   - обложки.

   Общая лента Saved при этом не сканируется.
   ============================================================ */

import {
  nodeApi,
} from '../node-bridge.js';

const GRAPHQL_HOST =
  'www.instagram.com';

const GRAPHQL_PATH =
  '/graphql/query';

const SAVED_COLLECTIONS_DOC_ID =
  '26523442937261068';

const FRIENDLY_NAME =
  'PolarisProfileSavedTabContentQuery';

const WEB_APP_ID =
  '1217981644879628';

const ASBD_ID =
  '359341';

const SERVER_REVISION =
  '1034642761';

function readInstagramCookies(cookieFile) {
  if (
    !nodeApi.available ||
    !cookieFile ||
    !nodeApi.fs.existsSync(cookieFile)
  ) {
    throw new Error(
      'Не найден временный файл авторизации Instagram',
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
        String(parts[0] || '')
          .toLowerCase();

      if (
        !domain.endsWith(
          'instagram.com',
        )
      ) {
        return;
      }

      const name =
        String(parts[5] || '').trim();

      const value =
        String(
          parts.slice(6).join('\t'),
        ).trim();

      if (name && value) {
        cookies.set(name, value);
      }
    });

  if (!cookies.get('sessionid')) {
    throw new Error(
      'В выбранном профиле отсутствует sessionid Instagram',
    );
  }

  if (!cookies.get('csrftoken')) {
    throw new Error(
      'В выбранном профиле отсутствует csrftoken Instagram',
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
  method,
  path,
  headers,
  body = '',
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
            hostname: GRAPHQL_HOST,
            path,
            method,
            headers,
          },
          (response) => {
            let responseBody = '';

            response.setEncoding('utf8');

            response.on(
              'data',
              (chunk) => {
                responseBody += chunk;
              },
            );

            response.on(
              'end',
              () => {
                finish(resolve, {
                  statusCode:
                    response.statusCode || 0,
                  headers:
                    response.headers || {},
                  body:
                    responseBody,
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
              'Instagram не ответил за 30 секунд',
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

      if (body) {
        request.write(body);
      }

      request.end();
    },
  );
}

function baseHeaders(
  cookies,
  wwwClaim = '0',
) {
  return {
    Accept: '*/*',

    Cookie:
      cookieHeader(cookies),

    Origin:
      'https://www.instagram.com',

    Referer:
      'https://www.instagram.com/',

    'User-Agent':
      browserUserAgent(),

    'X-CSRFToken':
      cookies.get('csrftoken'),

    'X-IG-App-ID':
      WEB_APP_ID,

    'X-ASBD-ID':
      ASBD_ID,

    'X-IG-WWW-Claim':
      wwwClaim || '0',

    'X-Instagram-AJAX':
      SERVER_REVISION,

    'X-Requested-With':
      'XMLHttpRequest',

    'Sec-Fetch-Dest':
      'empty',

    'Sec-Fetch-Mode':
      'cors',

    'Sec-Fetch-Site':
      'same-origin',
  };
}

async function warmUpSession({
  cookies,
  signal,
}) {
  const response =
    await requestText({
      method: 'GET',
      path:
        '/api/v1/web/fxcal/ig_sso_users/',
      headers:
        baseHeaders(cookies),
      signal,
    });

  return String(
    response.headers[
      'x-ig-set-www-claim'
    ] || '0',
  );
}

async function requestCollectionsPage({
  cookies,
  cursor,
  wwwClaim,
  signal,
}) {
  const variables = {
    collection_types: [
      'ALL_MEDIA_AUTO_COLLECTION',
      'MEDIA',
      'AUDIO_AUTO_COLLECTION',
    ],
    count: 20,
    get_cover_media_lists: true,
  };

  if (cursor) {
    variables.after = cursor;
  }

  const form =
    new URLSearchParams();

  form.set(
    'variables',
    JSON.stringify(variables),
  );

  form.set(
    'doc_id',
    SAVED_COLLECTIONS_DOC_ID,
  );

  form.set(
    'fb_api_caller_class',
    'RelayModern',
  );

  form.set(
    'server_timestamps',
    'true',
  );

  form.set(
    'fb_api_req_friendly_name',
    FRIENDLY_NAME,
  );

  const body = form.toString();

  const response =
    await requestText({
      method: 'POST',
      path: GRAPHQL_PATH,
      headers: {
        ...baseHeaders(
          cookies,
          wwwClaim,
        ),

        'Content-Type':
          'application/x-www-form-urlencoded',

        'Content-Length':
          String(
            Buffer.byteLength(body),
          ),
      },
      body,
      signal,
    });

  let payload = null;

  try {
    payload =
      JSON.parse(response.body);
  } catch (_) {
    /* Ниже будет понятная ошибка. */
  }

  if (
    response.statusCode < 200 ||
    response.statusCode >= 300
  ) {
    const detail =
      payload?.message ||
      payload?.error?.message ||
      response.body
        .slice(0, 200)
        .trim() ||
      'без описания';

    throw new Error(
      `Instagram GraphQL вернул код ` +
      `${response.statusCode}: ${detail}`,
    );
  }

  if (!payload) {
    throw new Error(
      'Instagram GraphQL вернул некорректный JSON',
    );
  }

  if (
    Array.isArray(payload.errors) &&
    payload.errors.length
  ) {
    throw new Error(
      payload.errors
        .map(
          (error) =>
            error?.message ||
            'GraphQL error',
        )
        .join('; '),
    );
  }

  return {
    payload,
    wwwClaim:
      String(
        response.headers[
          'x-ig-set-www-claim'
        ] ||
        wwwClaim ||
        '0',
      ),
  };
}

function findCollectionsConnection(
  payload,
) {
  const data =
    payload?.data || payload;

  if (
    !data ||
    typeof data !== 'object'
  ) {
    return null;
  }

  const exact =
    data[
      'xdt_api__v1__collections__list_graphql_connection'
    ];

  if (exact) {
    return exact;
  }

  return Object.values(data)
    .find(
      (value) =>
        value &&
        typeof value === 'object' &&
        Array.isArray(value.edges),
    ) || null;
}

function normalizeCollection(
  node,
  position,
) {
  const id =
    node?.collection_id ??
    node?.id ??
    node?.pk;

  if (
    id === undefined ||
    id === null
  ) {
    return null;
  }

  const name =
    String(
      node?.collection_name ??
      node?.name ??
      node?.title ??
      `Коллекция ${position}`,
    ).trim();

  const count =
    Number(
      node?.collection_media_count ??
      node?.media_count ??
      node?.items_count ??
      node?.count,
    );

  return {
    id: String(id),

    name:
      name ||
      `Коллекция ${position}`,

    type:
      String(
        node?.collection_type ??
        node?.type ??
        'MEDIA',
      ),

    mediaCount:
      Number.isFinite(count)
        ? count
        : null,

    position,

    coverMediaList:
      Array.isArray(
        node?.cover_media_list,
      )
        ? node.cover_media_list
        : [],
  };
}

export async function listInstagramCollections({
  cookieFile,
  signal,
  maximumPages = 100,
} = {}) {
  const cookies =
    readInstagramCookies(cookieFile);

  let wwwClaim = '0';

  try {
    wwwClaim =
      await warmUpSession({
        cookies,
        signal,
      });
  } catch (_) {
    /*
     * Warm-up вспомогательный.
     * GraphQL всё равно проверяем с claim=0.
     */
  }

  const collections = [];
  const knownIds = new Set();
  const knownCursors = new Set();

  let cursor = '';

  for (
    let page = 0;
    page < maximumPages;
    page += 1
  ) {
    const response =
      await requestCollectionsPage({
        cookies,
        cursor,
        wwwClaim,
        signal,
      });

    wwwClaim =
      response.wwwClaim;

    const connection =
      findCollectionsConnection(
        response.payload,
      );

    if (!connection) {
      const keys =
        Object.keys(
          response.payload?.data ||
          response.payload ||
          {},
        ).join(', ');

      throw new Error(
        'Instagram GraphQL не вернул список коллекций' +
        (keys
          ? `. Получены поля: ${keys}`
          : ''),
      );
    }

    const edges =
      Array.isArray(connection.edges)
        ? connection.edges
        : [];

    edges.forEach(
      (edge) => {
        const node =
          edge?.node || edge;

        const collection =
          normalizeCollection(
            node,
            collections.length + 1,
          );

        if (
          !collection ||
          knownIds.has(collection.id)
        ) {
          return;
        }

        knownIds.add(collection.id);
        collections.push(collection);
      },
    );

    const pageInfo =
      connection.page_info || {};

    if (!pageInfo.has_next_page) {
      break;
    }

    const nextCursor =
      String(
        pageInfo.end_cursor || '',
      ).trim();

    if (
      !nextCursor ||
      knownCursors.has(nextCursor)
    ) {
      break;
    }

    knownCursors.add(nextCursor);
    cursor = nextCursor;
  }

  if (!collections.length) {
    throw new Error(
      'Instagram GraphQL вернул пустой список коллекций',
    );
  }

  return collections;
}
