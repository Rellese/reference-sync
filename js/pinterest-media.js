// Prefer original direct media and progressive MP4 over HLS. Preserve source numbers.
export function pinterestMedia(record) {
  const direct = String(record._galleryUrl || '');
  const variants = [direct, ...Object.values(record.videos?.video_list || {}).sort((a, b) => (b?.width || 0) - (a?.width || 0)).map(video => video?.url), ...(Array.isArray(record._fallback) ? record._fallback : [record._fallback])];
  const mediaType = String(record.extension || '').toLowerCase() === 'mp4' || record.is_video ? 'video' : 'image';
  const url = variants.find(value => typeof value === 'string' && /^https:\/\//i.test(value)
    && (mediaType === 'video' ? /\.mp4(?:[?#]|$)/i : /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i).test(value));
  return url ? { url, extension: url.split(/[?#]/)[0].split('.').pop().toLowerCase() } : null;
}
export function pinterestDownloadPlan(post) {
  const selected = Array.isArray(post.selectedComponents) ? new Set(post.selectedComponents) : null;
  const components = (post.components || []).filter(component => !selected || selected.has(component.index));
  if (!components.length || components.some(component => !component.directMedia)) return [];
  return components.map(component => ({ ...component.directMedia, componentIndex: component.index }));
}
