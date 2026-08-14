/* Vimeo — видео. Каждое видео — отдельная публикация, cookies
   нужны только для приватных, но оставляем: вреда нет. */
import { createGallerySource } from './gallery-source.js';

export default createGallerySource({
  code: 'vimeo',
  title: 'Vimeo',
  icon: 'vimeo',
  ready: true,
  containerTypes: ['ROOT', 'ACCOUNT', 'COLLECTION'],
  containerLabels: { root: 'Все видео', level1: 'Канал', level2: 'Подборка' },
  defaultTags: ['Vimeo'],
  nameMarker: 'vimorder',
  jobPrefix: 'vimeo',
  cookies: true,
  urlPattern: /(?:^|\/\/)(?:www\.|player\.)?vimeo\.com\//i,
  groupBy: 'file',
  buildTargets({ username, collections }) {
    const base = `https://vimeo.com/${username}`;
    if (!collections.length) return [{ id: 'videos', name: 'Все видео', url: base }];
    return collections.map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      url: `${base}/${entry.id}`,
    }));
  },
  idFields: ['id', 'video_id', 'clip_id', 'pk'],
  authorFields: ['uploader', 'user', 'owner', 'username'],
  captionFields: ['title', 'description'],
  canonicalUrl: (record, id) => `https://vimeo.com/${id}`,
});
