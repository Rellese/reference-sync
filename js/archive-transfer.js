import { nodeApi, ensureDir } from './node-bridge.js';
import { throwIfAborted, looksInstagramRateLimited, makeInstagramRateLimitError } from './job-control.js';
import { runGallery } from './toolchain.js';
import { browserCookieSpec, parseJsonStream, collectPostRecords, buildPostRecords, normalizePost } from './instagram.js';
import { parseDumpJson } from './sources/gallery-source.js';
import pinterest from './sources/pinterest.js';

export async function resolveArchiveLinks(links, { settings, signal, onProgress, onResolved, run = runGallery }) {
  const posts = [], failed = [];
  const pause = settings.speed === 'lightning' ? '0' : settings.speed === 'balanced' ? '1-2' : '2-4';
  for (const [index, link] of links.entries()) {
    throwIfAborted(signal);
    onProgress?.(index, links.length);
    const result = await run(['--simulate', '--dump-json', '--sleep-request', pause,
      '--cookies-from-browser', browserCookieSpec(settings.browser, settings.browserProfile), link.url], { signal });
    throwIfAborted(signal);
    if (looksInstagramRateLimited(result.stderr)) throw makeInstagramRateLimitError(result.stderr);
    if (result.code !== 0) { failed.push(link); continue; }
    const found = settings.platform === 'instagram'
      ? buildPostRecords(collectPostRecords(parseJsonStream(result.stdout))).map(record => normalizePost(record, { collectionId: 'archive-links', collectionName: 'Ссылки из архива' })).filter(Boolean)
      : pinterest.assemble(parseDumpJson(result.stdout), { target: { id: 'archive-links', name: 'Ссылки из архива' }, accountUsername: settings.username });
    if (!found.length) failed.push(link);
    const resolved = found.map(post => ({ ...post, source: settings.platform, archiveLink: true }));
    posts.push(...resolved);
    if (resolved.length) await onResolved?.(link, resolved);
  }
  onProgress?.(links.length, links.length);
  return { posts, failed };
}
export async function downloadArchivePosts(options, remoteDownload) {
  const { posts, stagingRoot, signal, control, onProgress, onCompleted } = options;
  const { fs, path, stream } = nodeApi;
  const results = [];
  for (const [index, post] of posts.entries()) {
    throwIfAborted(signal);
    await control?.checkpoint();
    onProgress?.({ current: index + 1, total: posts.length, post });
    if (!post.archiveLocal) {
      const remote = await remoteDownload({ ...options, posts: [post], onProgress: null });
      results.push(...remote.results);
      if (remote.stopReason) return { results, stopReason: remote.stopReason };
      continue;
    }
    const base = fs.realpathSync(post.archiveBase);
    const directory = ensureDir(path.join(stagingRoot, post.postId.replace(/[^\w.-]/g, '_')));
    const files = [];
    for (const component of post.components) {
      if (Array.isArray(post.selectedComponents) && !post.selectedComponents.includes(component.index)) continue;
      throwIfAborted(signal);
      const original = fs.realpathSync(component.archivePath);
      if (!original.startsWith(base + path.sep) || !fs.statSync(original).isFile()) throw new Error('Файл находится за пределами выбранного архива');
      const destination = path.join(directory, `${component.index}.${path.extname(original).slice(1)}`);
      const input = fs.createReadStream(original), output = fs.createWriteStream(destination + '.part', { mode: 0o600 });
      const abort = () => input.destroy(new Error('Копирование остановлено'));
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (signal?.aborted) abort();
        await new Promise((resolve, reject) => stream.pipeline(input, output, error => error ? reject(error) : resolve()));
        throwIfAborted(signal);
        fs.renameSync(destination + '.part', destination);
        files.push(destination);
      } catch (error) {
        try { fs.unlinkSync(destination + '.part'); } catch {}
        throwIfAborted(signal); throw error;
      } finally { signal?.removeEventListener('abort', abort); }
    }
    const entry = { post, files, error: null };
    results.push(entry); await onCompleted?.(entry);
  }
  return { results, stagingRoot };
}
