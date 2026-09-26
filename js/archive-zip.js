import { nodeApi } from './node-bridge.js';
import { throwIfAborted } from './job-control.js';

export function safeArchiveName(value) {
  const name = String(value).replace(/\\/g, '/');
  if (!name || name.startsWith('/') || /[\x00-\x1f:]/.test(name) || name.split('/').some(part => part === '..' || part === '.' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('Недопустимый путь внутри архива');
  }
  return name;
}
function read(fd, size, position) {
  const buffer = nodeApi.Buffer.alloc(size);
  if (nodeApi.fs.readSync(fd, buffer, 0, size, position) !== size) throw new Error('Архив повреждён или обрезан');
  return buffer;
}
export function listZip(file) {
  const { fs } = nodeApi;
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailSize = Math.min(size, 65557);
    const tail = read(fd, tailSize, size - tailSize);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    }
    if (end < 0) throw new Error('Это не целый ZIP-архив');
    const count = tail.readUInt16LE(end + 10), bytes = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count || count === 65535 || offset === 0xffffffff) {
      throw new Error('ZIP64 и составные ZIP пока не поддерживаются. Выберите меньшую часть экспорта.');
    }
    if (bytes > 64 * 1024 * 1024 || offset + bytes > size - tailSize + end) throw new Error('Повреждён каталог ZIP');
    const directory = read(fd, bytes, offset), entries = [], names = new Set();
    let cursor = 0, total = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > bytes || directory.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Повреждён каталог ZIP');
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10);
      const compressed = directory.readUInt32LE(cursor + 20), unpacked = directory.readUInt32LE(cursor + 24);
      const nameSize = directory.readUInt16LE(cursor + 28), extra = directory.readUInt16LE(cursor + 30), comment = directory.readUInt16LE(cursor + 32);
      const attributes = directory.readUInt32LE(cursor + 38), localOffset = directory.readUInt32LE(cursor + 42);
      if (cursor + 46 + nameSize + extra + comment > bytes) throw new Error('Повреждён каталог ZIP');
      const name = safeArchiveName(directory.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8'));
      const key = name.normalize('NFC').toLowerCase().replace(/\/$/, '');
      if (names.has(key)) throw new Error('В архиве есть повторяющиеся пути');
      names.add(key);
      if (flags & 1 || ![0, 8].includes(method)) throw new Error('Зашифрованный или неподдерживаемый ZIP');
      const kind = (attributes >>> 16) & 0xf000;
      if (kind && ![0x8000, 0x4000].includes(kind)) throw new Error('Архив содержит ссылки или специальные файлы');
      total += unpacked;
      if (unpacked > 2 ** 31 || total > 32 * 1024 ** 3 || unpacked > Math.max(1024 * 1024, compressed * 1000)) throw new Error('Слишком большой объём распаковки');
      const local = read(fd, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== method) throw new Error('Повреждён заголовок ZIP');
      const localNameSize = local.readUInt16LE(26), dataOffset = localOffset + 30 + localNameSize + local.readUInt16LE(28);
      const localName = read(fd, localNameSize, localOffset + 30).toString('utf8');
      if (localName !== name || dataOffset + compressed > offset) throw new Error('Несогласованные пути или границы ZIP');
      entries.push({ name, method, compressed, unpacked, dataOffset, crc: directory.readUInt32LE(cursor + 16), directory: name.endsWith('/') });
      cursor += 46 + nameSize + extra + comment;
    }
    return entries;
  } finally { fs.closeSync(fd); }
}
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export async function extractZip(file, destination, { signal, onProgress, accept = () => true } = {}) {
  const { fs, path, stream, zlib } = nodeApi;
  const entries = listZip(file).filter(entry => !entry.directory && accept(entry.name));
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const extracted = [];
  for (const [index, entry] of entries.entries()) {
    throwIfAborted(signal);
    const outputPath = path.join(destination, entry.name);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    let bytes = 0, crc = 0xffffffff;
    const verifier = new stream.Transform({ transform(chunk, encoding, done) {
      bytes += chunk.length;
      if (bytes > entry.unpacked) { done(new Error('Превышен заявленный размер файла')); return; }
      for (const value of chunk) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
      done(null, chunk);
    } });
    const input = entry.compressed
      ? fs.createReadStream(file, { start: entry.dataOffset, end: entry.dataOffset + entry.compressed - 1 })
      : stream.Readable.from([]);
    const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
    let created = false;
    output.once('open', () => { created = true; });
    const stages = entry.method === 8 ? [input, zlib.createInflateRaw(), verifier, output] : [input, verifier, output];
    const abort = () => input.destroy(new Error('Распаковка остановлена'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) abort();
      await new Promise((resolve, reject) => stream.pipeline(...stages, error => error ? reject(error) : resolve()));
      if (bytes !== entry.unpacked || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw new Error('Контрольная сумма файла не совпадает');
      extracted.push({ name: entry.name, path: outputPath });
      onProgress?.({ current: index + 1, total: entries.length });
    } catch (error) {
      if (created) { try { fs.unlinkSync(outputPath); } catch {} }
      throwIfAborted(signal);
      throw error;
    } finally { signal?.removeEventListener('abort', abort); }
  }
  return extracted;
}
