// Behance returns a project URL on its Directory record, not an image.
// Never use an HTML page or a video player as an <img> source.
function imageUrl(value) {
  const url = typeof value === 'string' ? value : value?.url;
  return typeof url === 'string' && /^https:\/\//i.test(url) && /\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(url) ? url : '';
}
function sizedImage(sizes) {
  const items = (Array.isArray(sizes) ? sizes : []).filter(item => imageUrl(item));
  const preferred = ['202','230','max_316','404','max_632','115','max_158','808','max_808'];
  for (const size of preferred) {
    const item = items.find(item => new URL(imageUrl(item)).pathname.split('/').at(-2) === size);
    if (item) return imageUrl(item);
  }
  return imageUrl(items[0]);
}
export function behancePreview(record = {}) {
  const module = record.module;
  if (module) {
    const preview = sizedImage(module.imageSizes?.allAvailable) || imageUrl(module.thumbnail) || imageUrl(module.poster);
    if (preview) return preview;
    // An absent video poster stays empty rather than showing the project cover
    // as though it depicted this particular block.
    if (record.extension === 'mp4' || /(?:Video|Embed)Module/.test(module.__typename || '')) return '';
  }
  if (record._galleryType === 2 || !module) {
    const cover = sizedImage(record.covers?.allAvailable);
    if (cover) return cover;
  }
  return imageUrl(record.thumbnail_url) || imageUrl(record.preview_url) || imageUrl(record._galleryUrl);
}
