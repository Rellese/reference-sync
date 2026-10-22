import {vimeoTarget} from './sources/vimeo-target.js';
import {xTarget} from './sources/x-target.js';
import {dribbbleTarget} from './sources/dribbble-target.js';
import {layersTarget} from './sources/layers-target.js';
import {threadsTarget} from './sources/threads-target.js';
import {getSource} from './sources/registry.js';
// Strict selected-platform routing; never pass arbitrary URLs to the engine.
const rules = {
  instagram: {hosts:['instagram.com','www.instagram.com'], path:/^\/(?:p\/[\w-]+|reel\/[\w-]+|tv\/[\w-]+|[\w.]+)\/?$/},
  pinterest: {hosts:['pinterest.com','www.pinterest.com','ru.pinterest.com','uk.pinterest.com','pinterest.fr','www.pinterest.fr','pinterest.de','www.pinterest.de','pinterest.es','www.pinterest.es','pin.it'], path:/^\/(?:pin\/\d+|[\w-]+(?:\/[\w-]+){0,2})\/?$/},
  behance: {hosts:['behance.net','www.behance.net'], path:/^\/(?:gallery\/\d+(?:\/[^/]+)?|(?:collection|moodboard)\/\d+(?:\/[^/]+)?|[\w.-]+)\/?$/},
  vimeo: {hosts:['vimeo.com','www.vimeo.com'], path:/^\/(?:\d+|[\w-]+)\/?$/},
};
const reserved = new Set(['accounts','explore','login','logout','signup','settings','search','home','messages','notifications','saved','moodboards','collections','gallery','pin','p','reel','tv']);
export function validateSourceLink(platform, input) {
  if(platform==='vimeo')return vimeoTarget(input).url;
  if(platform==='x')return xTarget(input).url;
  if(platform==='dribbble')return dribbbleTarget(input).url;
  if(platform==='layers')return layersTarget(input).url;
  if(platform==='threads')return threadsTarget(input).url;
  let url;
  try { url = new URL(String(input || '').trim()); } catch { /* rejected below */ }
  const rule = rules[platform];
  if (!rule || !url || url.protocol !== 'https:' || url.username || url.password || url.port ||
      !rule.hosts.includes(url.hostname) || !rule.path.test(url.pathname) || reserved.has(url.pathname.replace(/^\/|\/$/g,''))) {
    throw new Error('Вставьте ссылку на публикацию или профиль выбранной социальной сети.');
  }
  url.hash = ''; url.search = '';
  return url.href;
}
export function searchSettings(settings) {
  if (settings.downloadMode === 'link') return {...settings, source:'browser', targetUrl:validateSourceLink(settings.platform, settings.sourceUrl),
    searchMode:'full', folderSearch:false, stopLinkEnabled:false};
  if(settings.downloadMode==='liked'){
    if(!getSource(settings.platform).discoverLiked)throw Error('Поиск понравившихся публикаций недоступен для этой сети.');
    return {...settings,source:'browser',targetUrl:'',username:'',folderSearch:false};
  }
  return {...settings, source:['behance','vimeo','x','dribbble','layers'].includes(settings.platform) ? 'browser' : settings.source, folderSearch:settings.platform === 'threads'?false:settings.platform === 'behance' || settings.folderSearch};
}
export const effectiveFolderSearch=settings=>settings.platform!=='threads'&&settings.downloadMode!=='link'&&settings.downloadMode!=='liked'&&(settings.platform==='behance'||settings.folderSearch===true);

export function sourceLinkTarget(platform, input) {
  const url = new URL(validateSourceLink(platform, input));
  const parts = url.pathname.split('/').filter(Boolean);
  // Profile dispatchers otherwise yield child jobs rather than media records.
  if (parts.length === 1 && platform === 'instagram') url.pathname = `/${parts[0]}/posts/`;
  if (parts.length === 1 && platform === 'pinterest' && url.hostname !== 'pin.it') url.pathname = `/${parts[0]}/pins/`;
  if (platform === 'behance' && parts[0] === 'moodboard') url.pathname = `/collection/${parts[1]}/a`;
  return url.href;
}
