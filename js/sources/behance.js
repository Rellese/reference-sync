/* Behance — проекты. Проект = публикация из нескольких файлов,
   поэтому groupBy: 'post' (компоненты объединяются в карусель). */
import { createGallerySource } from './gallery-source.js';

export default createGallerySource({
  code: 'behance',
  title: 'Behance',
  icon: 'behance',
  ready: true,
  containerTypes: ['ROOT', 'ACCOUNT', 'COLLECTION'],
  containerLabels: { root: 'Все проекты', level1: 'Аккаунт', level2: 'Коллекция' },
  defaultTags: ['Behance'],
  nameMarker: 'behorder',
  jobPrefix: 'behance',
  cookies: true,
  urlPattern: /(?:^|\/\/)(?:www\.)?behance\.net\//i,
  groupBy: 'post',
  buildTargets({ username, collections }) {
    const base = `https://www.behance.net/${username}`;
    if (!collections.length) return [{ id: 'projects', name: 'Все проекты', url: base }];
    return collections.map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      url: `https://www.behance.net/collection/${entry.id}`,
    }));
  },
  idFields: ['id', 'project_id', 'pk'],
  authorFields: ['owners', 'creator', 'user', 'username'],
  captionFields: ['name', 'title', 'description'],
  canonicalUrl: (record, id) => `https://www.behance.net/gallery/${id}/`,
});
