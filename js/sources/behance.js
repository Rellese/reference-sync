// First Behance milestone: media blocks from an explicit project/collection URL.
// Account collection enumeration and whole-case packages are separate M7 stages.
import { createGallerySource } from './gallery-source.js';

export function behanceTarget(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { /* handled below */ }
  if (!url || url.protocol !== 'https:' || !['behance.net', 'www.behance.net'].includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Вставьте HTTPS-ссылку на кейс или коллекцию Behance.');
  }
  const match = url.pathname.match(/^\/(gallery|collection)\/(\d+)(?:\/|$)/);
  if (!match) throw new Error('Вставьте HTTPS-ссылку на кейс или коллекцию Behance.');
  return { id: match[2], name: `${match[1] === 'collection' ? 'Behance collection' : 'Behance project'} ${match[2]}`,
    type: match[1] === 'collection' ? 'COLLECTION' : 'PROJECT', parentId: '',
    url: `https://www.behance.net/${match[1]}/${match[2]}/` };
}
export function buildBehanceTargets({ username, collections = [] }) {
  return collections.length ? collections.map(entry => ({ ...behanceTarget(entry.url), name: entry.name || behanceTarget(entry.url).name })) : [behanceTarget(username)];
}
export function validateBehanceDiscovery(records) {
  if (records.some(record => record._galleryType === -1)) {
    throw new Error('Behance не разрешил получить данные проекта. Проверьте доступ в выбранном браузере и повторите поиск.');
  }
}
const source = createGallerySource({
  code: 'behance', title: 'Behance', icon: 'behance', ready: true,
  containerTypes: ['ROOT', 'COLLECTION'],
  containerLabels: { root: 'Проекты', level1: 'Коллекция', level2: 'Коллекция' },
  defaultTags: ['Behance'], nameMarker: 'behorder', jobPrefix: 'behance', cookies: true,
  urlPattern: /(?:^|\/\/)(?:www\.)?behance\.net\//i, groupBy: 'post',
  buildTargets: buildBehanceTargets,
  idFields: ['id', 'gallery_id', 'project_id'], progressIdField: 'id',
  authorFields: ['creator', 'user', 'username'], captionFields: ['description', 'name', 'title'],
  canonicalUrl: (record, id) => `https://www.behance.net/gallery/${id}/`,
  // DataJob JSONL drops extraction exceptions and cannot resolve child jobs.
  // A second --dump-json resolves collection projects; a JSON document keeps errors.
  extraDiscoverArgs: ['--dump-json', '-o', 'output.jsonl=false', '-o', 'extractor.behance.tls12=true'],
  extraDownloadArgs: ['-o', 'extractor.behance.tls12=true'],
  validateDiscovery: validateBehanceDiscovery,
});
export default {
  ...source,
  async listContainers({ username }) {
    const target = behanceTarget(username);
    if (target.type !== 'COLLECTION') throw new Error('Для поиска по папкам вставьте ссылку на коллекцию Behance.');
    return [target];
  },
};
