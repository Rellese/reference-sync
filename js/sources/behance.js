import { decorateBehancePost } from './behance-case.js';
import { packageBehanceCase } from '../case/package.js';
import { downloadWithCases } from '../case/download.js';
import { behancePreview } from './behance-preview.js';
import { validateSourceLink } from '../source-link.js';
// Saved moodboards and explicit links share the same media-block importer.
import { listBehanceCollections } from './behance-collections.js';
import { runGallery } from '../toolchain.js';
import { throwIfAborted } from '../job-control.js';
import { createGallerySource, parseDumpJson } from './gallery-source.js';
import { BEHANCE_USER_AGENT, withBehanceSession, refreshBehanceChallenge } from './behance-session.js';

export function behanceTarget(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { /* handled below */ }
  if (!url || url.protocol !== 'https:' || !['behance.net', 'www.behance.net'].includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Вставьте HTTPS-ссылку на кейс или коллекцию Behance.');
  }
  const match = url.pathname.match(/^\/(gallery|collection|moodboard)\/(\d+)(?:\/|$)/);
  if (!match) throw new Error('Вставьте HTTPS-ссылку на кейс или коллекцию Behance.');
  if (match[1] === 'moodboard') match[1] = 'collection';
  return { id: match[2], name: `${match[1] === 'collection' ? 'Behance collection' : 'Behance project'} ${match[2]}`,
    type: match[1] === 'collection' ? 'COLLECTION' : 'PROJECT', parentId: '',
    url: `https://www.behance.net/${match[1]}/${match[2]}/a` };
}
export function buildBehanceTargets({ username, collections = [] }) {
  if (!collections.length) return [behanceTarget(username)];
  return collections.map(entry => {
    const target = behanceTarget(entry.url);
    return {...target, id:entry.id || target.id, name:entry.name || target.name,
      type:entry.type || target.type, parentId:entry.parentId || ''};
  });
}

export function validateBehanceDiscovery(records) {
  if (records.some(record => record._galleryType === -1)) {
    throw new Error('Behance не разрешил получить данные проекта. Проверьте доступ в выбранном браузере и повторите поиск.');
  }
}
export const behanceMediaSource = createGallerySource({
  code: 'behance', title: 'Behance', icon: 'behance', ready: true, needsAccount: false,
  containerTypes: ['ROOT', 'COLLECTION'],
  containerLabels: { root: 'Проекты', level1: 'Коллекция', level2: 'Коллекция' },
  defaultTags: ['Behance'], nameMarker: 'behorder', jobPrefix: 'behance', cookies: true,
  urlPattern: /(?:^|\/\/)(?:www\.)?behance\.net\//i, groupBy: 'post',
  buildTargets: buildBehanceTargets,
  previewResolver: behancePreview,
  decoratePost: decorateBehancePost,
  idFields: ['id', 'gallery_id', 'project_id'], progressIdField: 'id',
  authorFields: ['creator', 'user', 'username'], captionFields: ['description', 'name', 'title'],
  canonicalUrl: (record, id) => `https://www.behance.net/gallery/${id}/a`,
  // DataJob JSONL drops extraction exceptions and cannot resolve child jobs.
  // A second --dump-json resolves collection projects; a JSON document keeps errors.
  extraDiscoverArgs: ['--dump-json', '-o', 'output.jsonl=false', '-o', 'extractor.behance.tls12=true', '-o', `extractor.behance.user-agent=${BEHANCE_USER_AGENT}`],
  extraDownloadArgs: post => ['-o', 'extractor.behance.tls12=true', '-o', `extractor.behance.user-agent=${BEHANCE_USER_AGENT}`,
    '-o', `downloader.ytdl.cmdline-args=${JSON.stringify(['--referer', behanceTarget(post.url).url, '--no-playlist'])}`],
  validateDiscovery: validateBehanceDiscovery,
  discoveryJsonDocument: true,
});
export default {
  ...behanceMediaSource,
  packageCase: packageBehanceCase,
  discover: discoverBehance,
  download(options) {
    if (!options.posts?.length) return behanceMediaSource.download(options);
    const target = behanceTarget(options.posts[0].url);
    return withBehanceSession(options, target.url, next => downloadWithCases(next,
      request => behanceMediaSource.download({...request, preparePost:(post, context) => refreshBehanceChallenge(context.cookieFile, behanceTarget(post.url).url, context.signal)})));
  },
  listContainers: listBehanceCollections,
};

export async function discoverBehance(options, {
  session = withBehanceSession, run = runGallery, refresh = refreshBehanceChallenge,
  discoverProject = next => behanceMediaSource.discover(next),
} = {}) {
  const targets = options.targetUrl ? [{id:'link',name:'Behance',url:validateSourceLink('behance',options.targetUrl)}] : buildBehanceTargets(options);
  const posts = new Map();
  let stoppedEarly = false;
  const stopLinkTargets = [];
  for (const target of targets) {
    throwIfAborted(options.signal);
    await session(options, target.url, async next => {
      let projectUrls;
      if (/\/gallery\/\d+/.test(target.url)) projectUrls = [behanceTarget(target.url).url];
      else {
        const engineUrl = target.url.replace('/moodboard/', '/collection/');
        const result = await run(['--config-ignore','--no-input','--cookies',next.cookieFile,
          '--dump-json','-o','output.jsonl=false','--http-timeout','30','--retries','2',
          '-o','extractor.behance.tls12=true','-o',`extractor.behance.user-agent=${BEHANCE_USER_AGENT}`,engineUrl], {signal:next.signal});
        const records = parseDumpJson(result.stdout);
        validateBehanceDiscovery(records);
        if (result.code !== 0) throw new Error('Не удалось прочитать список кейсов Behance.');
        projectUrls = [...new Set(records.filter(record => record._galleryType === 6).map(record => behanceTarget(record._galleryUrl).url))];
      }
      let accepted = 0;
      for (const url of projectUrls) {
        throwIfAborted(next.signal);
        if (options.limit > 0 && accepted >= options.limit) break;
        await refresh(next.cookieFile, url, next.signal);
        const result = await discoverProject({...next, targetUrl:'', limit:0,
          collections:[{...target,url}], onProgress:progress => options.onProgress?.({...progress,found:posts.size})});
        for (const post of result.posts) {
          const existing = posts.get(post.postId);
          if (!existing) posts.set(post.postId,post);
          else {
            for (const key of ['containers','collectionOccurrences']) {
              const identity = item => String(item.id ?? item.collectionId);
              const seen = new Set((existing[key] || []).map(identity));
              for (const item of post[key] || []) if (!seen.has(identity(item))) { (existing[key] ||= []).push(item); seen.add(identity(item)); }
            }
          }
          accepted++;
        }
        options.onProgress?.({found:posts.size,collection:target.name});
        if (result.stoppedEarly) {
          stoppedEarly = true;
          if (result.stopLinkReached) stopLinkTargets.push(String(target.id));
          break;
        }
      }
    });
  }
  return {posts:[...posts.values()],stoppedEarly,stopLinkReached:stopLinkTargets.length>0,stopLinkTargets};
}
