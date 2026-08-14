/* Dribbble — шоты дизайнеров. Иерархия ROOT → ACCOUNT → COLLECTION.
   Каждый шот — отдельная публикация (карусели у Dribbble нет). */
import { createGallerySource } from './gallery-source.js';

export default createGallerySource({
  code: 'dribbble',
  title: 'Dribbble',
  icon: 'dribbble',
  ready: true,
  containerTypes: ['ROOT', 'ACCOUNT', 'COLLECTION'],
  containerLabels: { root: 'Все шоты', level1: 'Аккаунт', level2: 'Коллекция' },
  defaultTags: ['Dribbble'],
  nameMarker: 'driborder',
  jobPrefix: 'dribbble',
  cookies: true,
  urlPattern: /(?:^|\/\/)(?:www\.)?dribbble\.com\//i,
  groupBy: 'file',
  buildTargets({ username, collections }) {
    const base = `https://dribbble.com/${username}`;
    if (!collections.length) return [{ id: 'shots', name: 'Все шоты', url: base }];
    return collections.map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      url: `${base}/collections/${entry.id}`,
    }));
  },
  idFields: ['id', 'shot_id', 'pk'],
  authorFields: ['user', 'author', 'username'],
  captionFields: ['title', 'description', 'alt'],
  canonicalUrl: (record, id) => `https://dribbble.com/shots/${id}`,
});
