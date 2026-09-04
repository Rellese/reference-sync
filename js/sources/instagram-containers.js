/* ============================================================
   Контейнеры источника Instagram

   Общий интерфейс использует source.listContainers().
   Instagram-специфичный мобильный API изолирован здесь.
   ============================================================ */

import {
  nodeApi,
} from '../node-bridge.js';

const API_HOST =
  'i.instagram.com';

const API_PATH =
  '/api/v1/collections/list/';

const APP_ID =
  '567067343352427';

const USER_AGENT =
  'Instagram 428.0.0.47.67 ' +
  'Android (34/14; 480dpi; 1344x2992; ' +
  'Google/google; Pixel 8 Pro; husky; ' +
  'husky; en_US; 961145276)';

function readInstagramCookies(
  cookieFile,
) {
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
    .forEach((line) => {
      const normalized =
        line.startsWith('#HttpOnly_')
          ? line.slice(
            '#HttpOnly_'.length,
          )
          : line;

      if (
        !normalized ||
        normalized.startsWith('#')
      ) {
        return;
      }

      const parts =
        normalized.split('\t');

      if (parts.length < 7) {
        return;
      }

      const domain =
        String(parts[0] || '');

      if (
        !domain.endsWith(
          'instagram.com',
        )
      ) {
        return;
      }

      const name =
        String(parts[5] || '');

      const value =
        String(
          parts
            .slice(6)
            .join('\t'),
        );

      if (name) {
        cookies.set(
          name,
          value,
        );
      }
    });

  if (!cookies.get('sessionid')) {
    throw new Error(
      'В выбранном профиле отсутствует sessionid Instagram',
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

function randomHex(length) {
  let result = '';

  while (result.length < length) {
    result += Math.floor(
      Math.random() * 0x100000000,
    )
      .toString(16)
      .padStart(8, '0');
  }

  return result.slice(0, length);
}

function randomUuid() {
  const value = randomHex(32);

  return [
    value.slice(0, 8),
    value.slice(8, 12),
    `4${value.slice(13, 16)}`,
    `8${value.slice(17, 20)}`,
    value.slice(20, 32),
  ].join('-');
}

function normalizeCollection(
  item,
  position,
) {
  const id =
    item?.collection_id ??
    item?.id ??
    item?.pk;

  if (
    id === undefined ||
    id === null
  ) {
    return null;
  }

  const name = String(
    item?.collection_name ??
    item?.name ??
    item?.title ??
    `Коллекция ${position}`,
  ).trim();

  const count = Number(
    item?.media_count ??
    item?.items_count ??
    item?.count,
  );

  return {
    id: String(id),
    name:
      name ||
      `Коллекция ${position}`,
    type: String(
      item?.collection_type ??
      item?.type ??
      'MEDIA',
    ),
    mediaCount:
      Number.isFinite(count)
        ? count
        : null,
    position,
  };
}

function requestPage({
  cookies,
  cursor,
  signal,
}) {
  const query =
    new URLSearchParams();

  query.set(
    'collection_types',
    JSON.stringify([
      'ALL_MEDIA_AUTO_COLLECTION',
      'PRODUCT_AUTO_COLLECTION',
      'MEDIA',
    ]),
  );

  if (cursor) {
    query.set(
      'max_id',
      cursor,
    );
  }

  const path =
    `${API_PATH}?${query.toString()}`;

  const uuid = randomUuid();
  const androidId =
    `android-${randomHex(16)}`;

  return new Promise(
    (resolve, reject) => {
      let settled = false;

      const finish = (
        callback,
        value,
      ) => {
        if (settled) return;
        settled = true;
        callback(value);
      };

      const headers = {
        Accept: '*/*',

        Cookie:
          cookieHeader(cookies),

        Host:
          API_HOST,

        'User-Agent':
          USER_AGENT,

        'X-IG-App-ID':
          APP_ID,

        'X-IG-Device-ID':
          uuid,

        'X-IG-Family-Device-ID':
          uuid,

        'X-IG-Android-ID':
          androidId,

        'X-Pigeon-Session-ID':
          `UFS-${randomUuid()}-1`,

        'X-Pigeon-Rawclienttime':
          String(Date.now() / 1000),

        'X-IG-App-Locale':
          'en_US',

        'X-IG-Device-Locale':
          'en_US',

        'X-IG-Mapped-Locale':
          'en_US',

        'X-IG-Timezone-Offset':
          String(
            -new Date()
              .getTimezoneOffset() *
            60,
          ),

        'X-IG-Connection-Type':
          'WIFI',

        'X-IG-Capabilities':
          '3brTv10=',

        'X-IG-WWW-Claim':
          '0',

        Connection:
          'keep-alive',
      };

      const userId =
        cookies.get('ds_user_id');

      if (userId) {
        headers['IG-U-DS-USER-ID'] =
          userId;

        headers[
          'IG-INTENDED-USER-ID'
        ] = userId;
      }

      const mid =
        cookies.get('mid');

      if (mid) {
        headers['X-MID'] = mid;
      }

      const request =
        nodeApi.https.get(
          {
            protocol: 'https:',
            hostname: API_HOST,
            path,
            method: 'GET',
            headers,
          },
          (response) => {
            let body = '';

            response.setEncoding(
              'utf8',
            );

            response.on(
              'data',
              (chunk) => {
                body += chunk;
              },
            );

            response.on(
              'end',
              () => {
                let payload = null;

                try {
                  payload =
                    JSON.parse(body);
                } catch (_) {
                  /* Обработаем ниже. */
                }

                if (
                  response.statusCode < 200 ||
                  response.statusCode >= 300
                ) {
                  const detail =
                    payload?.message ||
                    payload?.error_title ||
                    body
                      .slice(0, 200)
                      .trim() ||
                    'без описания';

                  finish(
                    reject,
                    new Error(
                      `Instagram вернул код ` +
                      `${response.statusCode}: ` +
                      detail,
                    ),
                  );

                  return;
                }

                if (!payload) {
                  finish(
                    reject,
                    new Error(
                      'Instagram вернул некорректный JSON',
                    ),
                  );

                  return;
                }

                finish(
                  resolve,
                  payload,
                );
              },
            );
          },
        );

      request.setTimeout(
        30000,
        () => {
          request.destroy(
            new Error(
              'Instagram не ответил при загрузке коллекций',
            ),
          );
        },
      );

      request.on(
        'error',
        (error) => {
          finish(
            reject,
            error,
          );
        },
      );

      if (signal) {
        const abort = () => {
          request.destroy(
            new Error(
              'Операция остановлена',
            ),
          );
        };

        if (signal.aborted) {
          abort();
        } else {
          signal.addEventListener(
            'abort',
            abort,
            { once: true },
          );
        }
      }
    },
  );
}

export async function listInstagramCollections({
  cookieFile,
  signal,
  maximumPages = 100,
} = {}) {
  const cookies =
    readInstagramCookies(
      cookieFile,
    );

  const collections = [];
  const knownIds = new Set();
  const knownCursors = new Set();

  let cursor = '';

  for (
    let page = 0;
    page < maximumPages;
    page += 1
  ) {
    const payload =
      await requestPage({
        cookies,
        cursor,
        signal,
      });

    if (
      !Array.isArray(
        payload?.items,
      )
    ) {
      throw new Error(
        payload?.message ||
        'Instagram не вернул список коллекций',
      );
    }

    payload.items.forEach(
      (item) => {
        const collection =
          normalizeCollection(
            item,
            collections.length + 1,
          );

        if (
          !collection ||
          knownIds.has(
            collection.id,
          )
        ) {
          return;
        }

        knownIds.add(
          collection.id,
        );

        collections.push(
          collection,
        );
      },
    );

    if (
      !payload.more_available
    ) {
      break;
    }

    const nextCursor =
      String(
        payload.next_max_id ??
        payload.max_id ??
        '',
      ).trim();

    if (
      !nextCursor ||
      knownCursors.has(
        nextCursor,
      )
    ) {
      break;
    }

    knownCursors.add(
      nextCursor,
    );

    cursor = nextCursor;
  }

  return collections;
}
