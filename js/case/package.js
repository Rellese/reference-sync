import { nodeApi } from '../node-bridge.js';
import { caseUrl } from '../sources/behance-case.js';
import { writeCaseZip } from './zip-writer.js';
import { downloadCaseCover } from './cover.js';

const images = new Set(['jpg','jpeg','png','gif','webp','avif']);
const videos = new Set(['mp4','webm','mov','m4v','mkv']);
const text = value => String(value || '').slice(0, 200000);
const dimension = value => Number.isFinite(Number(value)) && Number(value)>0 ? Math.min(Number(value),100000) : null;
const fallbackCover = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#161616"/><rect x="180" y="120" width="280" height="240" rx="20" fill="#292929"/><path d="M280 180L380 240L280 300Z" fill="#e85935"/></svg>';

// Uses the ordinary download result but never changes its files or import IDs.
// Callers must supply verified downloads; packaging is not a media decoder.
export async function packageBehanceCase(entry, destination, options={}) {
  const {path} = nodeApi;
  const document = entry?.post?.caseDocument;
  if (entry?.post?.source !== 'behance' || document?.version !== 1 || document?.format !== 'reference-sync-case' || !Array.isArray(document.blocks) || document.blocks.length > 10000) {
    throw new Error('Invalid Behance case document');
  }
  const assets = new Map();
  for (const file of entry.files || []) {
    const name = path.basename(file);
    const match = name.match(/^(\d+)\.([a-z0-9]+)$/i);
    if (!match) throw new Error('Invalid downloaded asset name');
    const number = Number(match[1]), extension = match[2].toLowerCase();
    if (!Number.isSafeInteger(number) || number < 1 || assets.has(number) || (!images.has(extension) && !videos.has(extension))) throw new Error('Invalid downloaded asset');
    assets.set(number,{name:`assets/${number}.${extension}`,file,extension});
  }
  const entries = [], used = new Set();
  const blocks = document.blocks.map((block, position) => {
    const kind = ['text','image','gif','video','unsupported'].includes(block.kind) ? block.kind : 'unsupported';
    const asset = assets.get(block.componentNumber);
    const compatible = asset && (kind === 'video' ? videos.has(asset.extension) : ['image','gif'].includes(kind) && images.has(asset.extension));
    if (compatible && !used.has(asset.name)) { entries.push(asset); used.add(asset.name); }
    return {
      id:`block-${position+1}`,position,kind,
      status: kind === 'text' ? 'text' : kind === 'unsupported' ? 'unsupported' : compatible ? 'local' : 'unavailable',
      asset:compatible ? asset.name : '',
      text:text(block.text),
      links:(Array.isArray(block.links) ? block.links : []).slice(0,1000).map(link=>({url:caseUrl(link.url),text:text(link.text)})).filter(link=>link.url),
      width:dimension(block.width),height:dimension(block.height),
      groupId:text(block.groupId), alignment:['left','right','center','justify'].includes(block.alignment) ? block.alignment : 'left',
      fullBleed:block.fullBleed === true,
    };
  });
  // Original source/CDN/iframe URLs, cookies and local paths are not copied.
  let cover, coverOrigin='fallback';
  if(document.coverUrl) {
    try {
      const image=await (options.coverLoader || downloadCaseCover)(document.coverUrl,{signal:options.signal});
      if(!images.has(image.extension) || !nodeApi.Buffer.isBuffer(image.data) || !image.data.length) throw new Error('Invalid cover');
      let number=1;while(assets.has(number))number++;
      cover=`assets/${number}.${image.extension}`;
      entries.push({name:cover,data:image.data});coverOrigin='behance';
    }catch(error){if(options.signal?.aborted)throw error;}
  }
  if(!cover)cover = entries.find(asset=>images.has(asset.extension))?.name;
  if (!cover) { cover='cover.svg'; entries.push({name:cover,data:fallbackCover}); }
  const manifest = {
    format:'reference-sync-case',version:1,
    source:{platform:'behance',id:text(document.source?.id),url:caseUrl(document.source?.url),title:text(document.source?.title),author:text(document.source?.author)},
    canvasWidth:dimension(document.canvasWidth) || 1400, cover, coverOrigin, blocks,
    complete:!blocks.some(block=>['unavailable','unsupported'].includes(block.status)),
  };
  const data = JSON.stringify(manifest);
  if (nodeApi.Buffer.byteLength(data)>16*1024*1024) throw new Error('Case manifest exceeds size limit');
  entries.unshift({name:'manifest.json',data});
  const result = await writeCaseZip(destination,entries,options);
  return {...result,manifest};
}
