/* X (Twitter) — закладки и медиа профиля. Пост может содержать
   до 4 файлов, поэтому groupBy: 'post'. */
import { createGallerySource } from './gallery-source.js';

export default createGallerySource({
  code: 'x',
  title: 'X',
  icon: 'x',
  ready: true,
  containerTypes: ['ROOT', 'ACCOUNT', 'COLLECTION'],
  containerLabels: { root: 'Все закладки', level1: 'Аккаунт', level2: 'Подборка' },
  defaultTags: ['X'],
  nameMarker: 'xorder',
  jobPrefix: 'x',
  cookies: true,
  urlPattern: /(?:^|\/\/)(?:www\.|mobile\.)?(?:twitter|x)\.com\//i,
  groupBy: 'post',
  buildTargets({ username, collections }) {
    if (!collections.length) {
      return [{
        id: 'bookmarks',
        name: 'Все закладки',
        url: 'https://x.com/i/bookmarks',
      }];
    }
    return collections.map((entry) => {
      /* «media» — особая коллекция: медиа профиля вместо закладок */
      if (entry.id === 'media') {
        return { id: 'media', name: entry.name || 'Медиа профиля',
          url: `https://x.com/${username}/media` };
      }
      return { id: entry.id, name: entry.name || entry.id,
        url: `https://x.com/i/bookmarks/${entry.id}` };
    });
  },
  idFields: ['tweet_id', 'id', 'pk'],
  authorFields: ['author', 'user', 'username'],
  captionFields: ['content', 'text', 'description'],
  canonicalUrl: (record, id) => {
    const author = record?.author?.name || record?.user?.name || 'i';
    return `https://x.com/${author}/status/${id}`;
  },
});
