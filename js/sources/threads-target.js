const hosts = new Set(['threads.com','www.threads.com','threads.net','www.threads.net']);
export function threadsTarget(input) {
  let url; try { url = new URL(String(input || '').trim()); } catch {}
  const match = url?.pathname.match(/^\/(?:@([A-Za-z0-9_.]{1,80})\/post|t)\/([A-Za-z0-9_-]{5,40})\/?$/);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname) || !match)
    throw Object.assign(Error('Вставьте HTTPS-ссылку на публикацию Threads.'), {code:'THREADS_URL'});
  return {type:'POST',id:match[2],url:`https://www.threads.com/${match[1]?'@'+match[1]+'/post':'t'}/${match[2]}`};
}
export function threadsMediaUrl(input) {
  let url; try { url = new URL(String(input || '')); } catch {}
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname === '/' ||
      !['cdninstagram.com','fbcdn.net'].some(host => url.hostname.endsWith('.'+host))) throw Error('THREADS_MEDIA_URL');
  return url.href;
}
