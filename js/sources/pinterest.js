/* ============================================================
   Источник: Pinterest

   Перенос app/pinterest_discover.py + pinterest_normalize.py
   на общий контракт. Иерархия ROOT → BOARD → SECTION,
   как в source_adapter.py.
   ============================================================ */

import { createGallerySource } from './gallery-source.js';

export default createGallerySource({
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
  urlPattern: /(?:^|\/\/)(?:[a-z]{2}\.)?pinterest\.[a-z.]+\//i,

  /* На Pinterest каждый пин — отдельный файл, карусели нет */
  groupBy: 'file',

  /* Без коллекций берём все доски пользователя,
     с коллекциями — только выбранные доски и разделы */
  buildTargets({ username, collections }) {
    const base = `https://www.pinterest.com/${username}`;
    if (!collections.length) {
      return [{ id: 'boards', name: 'Все доски', url: `${base}/` }];
    }
    return collections.map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      /* id раздела приходит как «board/section» */
      url: `${base}/${entry.id}/`,
    }));
  },

  idFields: ['pin_id', 'id', 'pk'],
  authorFields: ['pinner', 'username', 'owner', 'user'],
  captionFields: ['description', 'grid_title', 'title', 'alt_text'],

  canonicalUrl: (record, id) => `https://www.pinterest.com/pin/${id}/`,
});
