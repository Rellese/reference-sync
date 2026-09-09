/* ============================================================
   Источник: Pinterest

   Иерархия контейнеров:
   ROOT → BOARD → SECTION
   ============================================================ */

import { createGallerySource } from './gallery-source.js';

import {
  listPinterestContainers,
} from './pinterest-containers.js';

function clean(value) {
  return String(value ?? '').trim();
}

function withTrailingSlash(value) {
  const text = clean(value);

  if (!text) {
    return '';
  }

  return text.endsWith('/')
    ? text
    : `${text}/`;
}

function absolutePinterestUrl(value) {
  const text = clean(value);

  if (!text) {
    return '';
  }

  if (/^https?:\/\//i.test(text)) {
    return withTrailingSlash(text);
  }

  return withTrailingSlash(
    `https://www.pinterest.com/${
      text.replace(/^\/+/, '')
    }`,
  );
}

/*
 * Pinterest возвращает реальные URL для досок и разделов.
 * Их необходимо использовать напрямую: ID раздела нельзя
 * подставлять в адрес так же, как slug доски.
 *
 * Запасной адрес раздела:
 *   /USER/BOARD/id:SECTION_ID/
 *
 * Этот формат поддерживается PinterestSectionExtractor
 * в gallery-dl.
 */
export function buildPinterestTargets({
  username,
  collections = [],
}) {
  const cleanUsername =
    clean(username).replace(/^@+/, '');

  const base =
    `https://www.pinterest.com/${cleanUsername}`;

  if (!Array.isArray(collections) || !collections.length) {
    return [{
      id: 'allpins',
      name: 'Все пины',
      type: 'ROOT',
      parentId: '',
      url: `${base}/pins/`,
    }];
  }

  const targets = [];
  const seen = new Set();

  for (const entry of collections) {
    const id = clean(entry?.id);

    if (!id) {
      continue;
    }

    const type =
      clean(entry?.type).toUpperCase() ||
      (entry?.parentId ? 'SECTION' : 'BOARD');

    const name =
      clean(entry?.name) || id;

    let url =
      absolutePinterestUrl(entry?.url);

    if (!url && type === 'SECTION') {
      const boardUrl =
        absolutePinterestUrl(
          entry?.boardUrl ||
          entry?.parentUrl,
        );

      if (boardUrl) {
        url = `${boardUrl}id:${
          encodeURIComponent(id)
        }/`;
      } else {
        const boardSlug =
          clean(entry?.boardSlug);

        const sectionSlug =
          clean(entry?.slug);

        if (boardSlug && sectionSlug) {
          url =
            `${base}/${
              encodeURIComponent(boardSlug)
            }/${
              encodeURIComponent(sectionSlug)
            }/`;
        }
      }
    }

    if (!url && type === 'BOARD') {
      const slug =
        clean(entry?.slug) || id;

      url =
        `${base}/${
          encodeURIComponent(slug)
        }/`;
    }

    if (!url) {
      continue;
    }

    /*
     * ID одного раздела может совпасть с ID или slug
     * другого контейнера. Тип входит в ключ дедупликации.
     */
    const targetKey = `${type}:${id}`;

    if (seen.has(targetKey)) {
      continue;
    }

    seen.add(targetKey);

    targets.push({
      id,
      name,
      type,
      parentId: clean(entry?.parentId),
      url,
    });
  }

  return targets;
}

const pinterestSource = createGallerySource({
  code: 'pinterest',
  title: 'Pinterest',
  icon: 'pinterest',
  ready: true,

  containerTypes: ['ROOT', 'BOARD', 'SECTION'],

  containerLabels: {
    root: 'Все доски',
    level1: 'Доска',
    level2: 'Раздел',
  },

  defaultTags: ['Pinterest'],
  nameMarker: 'pinorder',
  jobPrefix: 'pinterest',

  urlPattern:
    /(?:^|\/\/)(?:[a-z]{2}\.)?pinterest\.[a-z.]+\//i,

  /*
   * Один Pinterest-пин может содержать несколько файлов.
   * Все URL-сообщения с одинаковым pin_id объединяются
   * в одну публикацию-карусель.
   */
  groupBy: 'post',

  buildTargets: buildPinterestTargets,

  idFields: ['pin_id', 'id', 'pk'],

  authorFields: [
    'pinner',
    'username',
    'owner',
    'user',
  ],

  captionFields: [
    'description',
    'grid_title',
    'title',
    'alt_text',
  ],

  canonicalUrl:
    (record, id) =>
      `https://www.pinterest.com/pin/${id}/`,
});

export default {
  ...pinterestSource,

  listContainers: (options) =>
    listPinterestContainers(options),
};
