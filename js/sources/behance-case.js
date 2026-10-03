// Portable data only: no HTML, scripts, browser session, or executable embeds.
import { behancePreview, behanceCoverCandidates } from './behance-preview.js';
import {behanceLayout} from './behance-layout.js';

const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function decodeEntities(value) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match,key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] ?? match;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}
export function caseUrl(value) {
  try {
    const url = new URL(decodeEntities(value));
    return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function caseText(html) {
  return decodeEntities(String(html || '').replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
    .replace(/<br\s*\/?\s*>|<\/(?:div|p|h[1-6]|li)>/gi,'\n').replace(/<[^>]*>/g,''))
    .replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function linksIn(html) {
  return [...String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)]
    .map(match=>({url:caseUrl(match[1]),text:caseText(match[2])})).filter(link=>link.url);
}
const moduleId = module => String(module?.id || module?.oid || '');
const positive = value => Number.isFinite(Number(value)) && Number(value)>0 ? Number(value) : null;
function embeddedUrl(module) {
  const html = module.originalEmbed || module.fluidEmbed || module.embed || '';
  return caseUrl(String(html).match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]);
}

export function buildBehanceCase(post, records = []) {
  const project = records.find(record=>Array.isArray(record.allModules) || Array.isArray(record.modules)) || {};
  const modules = project.allModules || project.modules || [];
  const media = records.filter(record=>record._galleryType === 3 && Number(record.num)>0);
  const matched = new Set();
  const blocks = [];
  const add = (module, record, suffix = '', groupId = '') => {
    const type = String(module.__typename || '');
    const sourceUrl = caseUrl(String(record?._galleryUrl || '').replace(/^ytdl:/, ''));
    const extension = String(record?.extension || '').toLowerCase();
    const kind = type === 'TextModule' ? 'text' : type === 'ImageModule' || type === 'MediaCollectionModule'
      ? (extension === 'gif' ? 'gif' : 'image') : /^(Video|Embed)Module$/.test(type) ? 'video' : 'unsupported';
    const html = type === 'TextModule' ? module.text : (module.captionPlain || module.caption || '');
    const text = caseText(html);
    blocks.push({
      id:`block-${blocks.length+1}-${moduleId(module) || 'unknown'}${suffix}`,
      position:blocks.length, moduleId:moduleId(module), groupId, kind,
      status:kind === 'text' ? 'text' : kind === 'unsupported' ? 'unsupported' : sourceUrl ? 'downloadable' : 'unavailable',
      componentNumber:record ? Number(record.num) : null,
      sourceUrl, embedUrl:kind === 'video' ? embeddedUrl(module) : '',
      previewUrl:record ? behancePreview(record) : '', text, links:linksIn(html),
      width:positive(module.width), height:positive(module.height),
      alignment:['left','center','right','justify'].includes(module.alignment) ? module.alignment : 'left',
      fullBleed:module.fullBleed === true || module.fullBleed === 1,
    });
    if(record)matched.add(record);
  };
  for (const module of modules) {
    const matches = media.filter(record=>moduleId(record.module) && moduleId(record.module) === moduleId(module));
    if (module.__typename === 'MediaCollectionModule') {
      const count = Math.max(module.components?.length || 0,matches.length,1);
      for(let i=0;i<count;i++) add(module,matches[i],`-${i+1}`,moduleId(module));
    } else add(module,matches[0]);
  }
  // Older extractors may omit the module tree; retain their download records.
  for (const record of media) if(!matched.has(record)) add(record.module || {__typename:/^(mp4|webm|mov)$/.test(record.extension)?'VideoModule':'ImageModule'},record);
  // Covers are project metadata, independent of the module tree. A post preview
  // can depict the first block and must never be substituted for a project cover.
  const coverUrls=[...new Set([project,...records].flatMap(behanceCoverCandidates))];
  return {
    format:'reference-sync-case', version:1,
    source:{platform:'behance',id:String(post.externalId || post.postId.replace(/^behance:/,'')),url:caseUrl(post.url),
      title:caseText(project.name || project.title || ''),author:post.plainUsername || post.username || ''},
    coverUrl:coverUrls[0] || '', coverUrls, canvasWidth:positive(project.canvasWidth) || 1400,
    layout:behanceLayout(project),blocks,
  };
}
export function decorateBehancePost(post, records) {
  return {...post, caseDocument:buildBehanceCase(post, records)};
}
