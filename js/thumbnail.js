// Preserve the reserved image box while lazy images load or fail.
export function attachThumbnail(container, url) {
  const image = document.createElement('img');
  container.classList.add('is-loading');
  image.loading = 'lazy';
  image.decoding = 'async';
  image.alt = '';
  image.addEventListener('load', () => container.classList.remove('is-loading'), { once: true });
  image.addEventListener('error', () => {
    container.classList.remove('is-loading');
    container.classList.add('is-empty');
    image.remove();
  }, { once: true });
  container.appendChild(image);
  image.src = url;
  return image;
}
