/* ============================================================
   Источник: Instagram

   Описание для реестра. Вся рабочая логика лежит в
   js/instagram.js — здесь только контракт, чтобы общий код
   не знал слова «instagram».
   ============================================================ */

import { discoverSaved, downloadPosts } from '../instagram.js';

export default {
  code: 'instagram',
  title: 'Instagram',
  icon: 'instagram',
  ready: true,

  /* ROOT → ACCOUNT → COLLECTION (как в source_adapter.py) */
  containerTypes: ['ROOT', 'ACCOUNT', 'COLLECTION'],
  containerLabels: {
    root: 'Все сохранённые публикации',
    level1: 'Аккаунт',
    level2: 'Коллекция',
  },

  sourceModes: ['browser', 'archive'],
  needsAccount: true,
  needsBrowser: true,

  defaultTags: ['Instagram'],
  nameMarker: 'instpoporder',
  jobPrefix: 'instagram',

  urlPattern: /(?:^|\/\/)(?:www\.)?instagram\.com\//i,

  discover: (options) => discoverSaved(options),
  download: (options) => downloadPosts(options),
};
