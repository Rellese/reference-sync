import { nodeApi, ensureDir } from './node-bridge.js';
import { throwIfAborted, looksInstagramRateLimited, makeInstagramRateLimitError } from './job-control.js';
import { runGallery } from './toolchain.js';
import { browserCookieSpec, parseJsonStream, collectPostRecords, buildPostRecords, normalizePost } from './instagram.js';
import { parseDumpJson } from './sources/gallery-source.js';
import pinterest from './sources/pinterest.js';
import { parseStopLink } from './stop-link.js';

export async function resolveArchiveLinks(links, { settings, signal, onProgress, onResolved, run = runGallery }) {
  const posts = [], failed = [];
  const unique = [...new Map(links.map(link => [link.publicationId, link])).values()];
  const pause = settings.speed === 'lightning' ? '0' : settings.speed === 'balanced' ? '1-2' : '3-5';
  // Reuse one process/browser session for up to 20 publications. Requests stay
  // sequential and retain the selected pacing; successful batches are checkpointed.
  for (let index = 0; index < unique.length; index += 20) {
    throwIfAborted(signal);
    const batch = unique.slice(index, index + 20);
    onProgress?.(index, unique.length);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let rateLimit = '', result;
    try {
      throwIfAborted(signal);
      result = await run(['--simulate', '--dump-json', '--sleep-request', pause,
      '--cookies-from-browser', browserCookieSpec(settings.browser, settings.browserProfile),
      ...batch.map(link => link.url)], { signal: controller.signal,
        onStderr(chunk) {
          rateLimit = (rateLimit + chunk).slice(-8192);
          if (looksInstagramRateLimited(rateLimit)) controller.abort();
        },
      });
    } finally { signal?.removeEventListener('abort', abort); }
    const documents = parseJsonStream(result.stdout || '');
    const found = settings.platform === 'instagram'
      ? buildPostRecords(collectPostRecords(documents)).map(record => normalizePost(record, { collectionId: 'archive-links', collectionName: 'Ссылки из архива' })).filter(Boolean)
      : pinterest.assemble(documents.flatMap(doc => parseDumpJson(JSON.stringify(doc))), { target: { id: 'archive-links', name: 'Ссылки из архива' }, accountUsername: settings.username });
    const byId = new Map();
    for (const post of found) {
      const parsed = parseStopLink(post.url, settings.platform);
      const id = parsed.ok ? parsed.publicationId : post.shortcode || String(post.postId).replace(/^pinterest:/, '');
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push({ ...post, source: settings.platform, archiveLink: true });
    }
    // A failed URL must not discard successful neighbours in the same process.
    // On manual cancellation leave the current batch pending (a carousel may
    // still be incomplete); previously checkpointed batches remain available.
    throwIfAborted(signal);
    for (const link of batch) {
      const resolved = byId.get(link.publicationId) || [];
      if (!resolved.length) failed.push(link);
      else { posts.push(...resolved); await onResolved?.(link, resolved); }
    }
    if (looksInstagramRateLimited(rateLimit || result.stderr)) throw makeInstagramRateLimitError(rateLimit || result.stderr);
  }
  onProgress?.(unique.length, unique.length);
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
