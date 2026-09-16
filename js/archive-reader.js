import { nodeApi, ensureDir, workRoot } from './node-bridge.js';
import { extractZip, safeArchiveName } from './archive-zip.js';
import { parseStopLink } from './stop-link.js';
import { throwIfAborted } from './job-control.js';

const MEDIA = /\.(jpe?g|png|webp|gif|avif|heic|mp4|mov|m4v|webm)$/i;
const DATA = /\.(json|html?)$/i;
const isVideo = name => /\.(mp4|mov|m4v|webm)$/i.test(name);
const fileUrl = file => nodeApi.url.pathToFileURL(file).href;
export function parseArchiveMetadata(text, extension, source) {
  const groups = [], links = new Map();
  function link(value) {
    if (typeof value !== 'string') return;
    const parsed = parseStopLink(value, source);
    if (parsed.ok) links.set(parsed.publicationId, parsed);
  }
  if (/html?/i.test(extension)) {
    // Attributes only. No DOM insertion, scripts, network requests, or HTML execution.
    for (const match of text.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
      const value = match[1].replace(/&amp;/g, '&').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,
        (_, hex, decimal) => { const code = parseInt(hex || decimal, hex ? 16 : 10); return code <= 0x10ffff ? String.fromCodePoint(code) : ''; });
      link(value);
      if (MEDIA.test(value) && !/^[a-z]+:/i.test(value)) groups.push({ paths: [value], title: '', description: '' });
    }
  } else {
    const data = JSON.parse(text);
    const queue = [{ value: data, depth: 0 }];
    let visited = 0;
    while (queue.length) {
      const { value, depth } = queue.pop();
      if (++visited > 250000 || depth > 100) throw new Error('Слишком сложная структура JSON');
      if (typeof value === 'string') { link(value); continue; }
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value.media)) {
        const paths = value.media.map(item => item?.uri || item?.path).filter(item => typeof item === 'string' && MEDIA.test(item));
        if (paths.length) groups.push({ paths, title: value.title || '', description: value.caption || value.title || value.media[0]?.title || '' });
      } else if (typeof value.uri === 'string' && MEDIA.test(value.uri)) {
        groups.push({ paths: [value.uri], title: value.title || '', description: value.title || '' });
      }
      for (const [key, child] of Object.entries(value)) {
        // Session/password exports and private message transcripts are not publications.
        if (/password|cookie|token|messages|inbox/i.test(key)) continue;
        queue.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return { groups, links: [...links.values()] };
}
async function fingerprint(file, signal) {
  const hash = nodeApi.crypto.createHash('sha256');
  const input = nodeApi.fs.createReadStream(file);
  const abort = () => input.destroy(new Error('Чтение остановлено'));
  signal?.addEventListener('abort', abort, { once: true });
  try { throwIfAborted(signal); for await (const chunk of input) hash.update(chunk); return hash.digest('hex'); }
  finally { signal?.removeEventListener('abort', abort); }
}
export async function readArchive(file, { source = 'instagram', signal, onProgress } = {}) {
  if (!nodeApi.available) throw new Error('Откройте плагин в Eagle для чтения архива');
  const { fs, path, crypto } = nodeApi;
  const extension = path.extname(file).toLowerCase();
  if (!['.zip', '.json', '.html', '.htm'].includes(extension)) throw new Error('Выберите ZIP, JSON или HTML');
  const stagingRoot = fs.mkdtempSync(path.join(ensureDir(path.join(workRoot(), 'staging')), 'archive-'));
  let entries, base;
  try {
    if (extension === '.zip') {
      entries = await extractZip(file, stagingRoot, { signal, onProgress, accept: name => (MEDIA.test(name) || DATA.test(name)) && !/(?:^|\/)(?:messages|inbox|security|login_and_account_creation)(?:\/|$)/i.test(name) });
      base = stagingRoot;
    } else { base = path.dirname(file); entries = [{ name: path.basename(file), path: file }]; }
    const media = new Map(entries.filter(entry => MEDIA.test(entry.name)).map(entry => [entry.name, entry]));
    const groups = [], links = new Map();
    for (const entry of entries.filter(entry => DATA.test(entry.name))) {
      throwIfAborted(signal);
      if (fs.statSync(entry.path).size > 20 * 1024 ** 2) throw new Error('Файл описания превышает 20 МБ. Экспортируйте меньший период.');
      const parsed = parseArchiveMetadata(await fs.promises.readFile(entry.path, 'utf8'), path.extname(entry.name), source);
      for (const group of parsed.groups) groups.push({ ...group, metadataDir: path.posix.dirname(entry.name) });
      for (const link of parsed.links) links.set(link.publicationId, link);
    }
    const consumed = new Set(), posts = [], hashes = new Map();
    async function resolveMedia(relative, metadataDir) {
      let decoded;
      try { decoded = decodeURIComponent(relative); } catch { return null; }
      if (/^[a-z]+:/i.test(decoded)) return null;
      const name = safeArchiveName(decoded);
      const candidates = [name, path.posix.join(metadataDir, name)];
      if (extension === '.zip') return candidates.map(key => media.get(key)).find(Boolean) || null;
      const baseReal = fs.realpathSync(base);
      for (const candidate of candidates) {
        const full = path.join(base, candidate);
        if (!fs.existsSync(full)) continue;
        const real = fs.realpathSync(full);
        if (!real.startsWith(baseReal + path.sep) || !fs.statSync(real).isFile()) throw new Error('Файл медиа находится за пределами папки экспорта');
        return { name: candidate, path: real };
      }
      return null;
    }
    async function append(group) {
      const files = [];
      for (const relative of group.paths) {
        const entry = await resolveMedia(relative, group.metadataDir || '.');
        if (entry && !consumed.has(entry.path)) files.push(entry);
      }
      if (!files.length) return;
      for (const entry of files) {
        consumed.add(entry.path);
        if (!hashes.has(entry.path)) hashes.set(entry.path, await fingerprint(entry.path, signal));
      }
      const digest = crypto.createHash('sha256').update(files.map(entry => hashes.get(entry.path)).join(':')).digest('hex');
      const collection = path.posix.dirname(files[0].name);
      const components = files.map((entry, index) => ({ index: index + 1, mediaType: isVideo(entry.name) ? 'video' : 'image', type: isVideo(entry.name) ? 'video' : 'image', archivePath: entry.path,
        previewUrl: isVideo(entry.name) ? '' : fileUrl(entry.path), extension: path.extname(entry.name).slice(1) }));
      posts.push({ postId: `${source}:archive-${digest}`, source, url: '', username: String(group.title || path.basename(files[0].name, path.extname(files[0].name))),
        description: String(group.description || ''), type: components.length > 1 ? 'Карусель' : isVideo(files[0].name) ? 'Видео' : 'Фото',
        structure: `${components.length} элем.`, selectedComponents: components.map(item => item.index),
        componentCount: components.length, components, previewUrl: components[0].previewUrl,
        collectionId: `archive:${collection}`, collectionName: collection === '.' ? 'Архив' : collection,
        archiveLocal: true, archiveBase: base, archiveStaging: stagingRoot });
    }
    for (const group of groups) await append(group);
    for (const entry of media.values()) if (!consumed.has(entry.path)) await append({ paths: [entry.name] });
    const collections = new Map();
    for (const post of posts) {
      let directory = post.collectionName === 'Архив' ? '.' : post.collectionName;
      const parent = path.posix.dirname(directory);
      if (parent !== '.' && parent !== directory) post.collectionParentId = `archive:${parent}`;
      while (directory !== '.') {
        const parentDir = path.posix.dirname(directory);
        collections.set(`archive:${directory}`, { id: `archive:${directory}`, name: path.posix.basename(directory), parentId: parentDir === '.' ? '' : `archive:${parentDir}` });
        directory = parentDir;
      }
      post.collectionName = path.posix.basename(post.collectionName);
    }
    return { source, posts: [...new Map(posts.map(post => [post.postId, post])).values()], collections: [...collections.values()], links: [...links.values()], stagingRoot };
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}
