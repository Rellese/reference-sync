import { nodeApi } from '../node-bridge.js';
import { safeArchiveName } from '../archive-zip.js';
import { throwIfAborted } from '../job-control.js';

const table = Array.from({length:256}, (_, value) => {
  for (let bit=0; bit<8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export const CASE_MAX_BYTES = 2 ** 31 - 1;

// STORE avoids recompressing video. Only one small chunk and the ZIP directory
// are held in memory. Publication uses an exclusive hard link on the same disk.
export async function writeCaseZip(destination, entries, {signal, maxBytes=CASE_MAX_BYTES}={}) {
  const {fs, path, Buffer, crypto} = nodeApi;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > CASE_MAX_BYTES) throw new Error('Invalid case size limit');
  if (!entries.length || entries.length > 10000) throw new Error('Invalid case entry count');
  const seen = new Set();
  for (const entry of entries) {
    const name = safeArchiveName(entry.name);
    if (name.endsWith('/') || Buffer.byteLength(name) > 65535 || seen.has(name.toLowerCase())) throw new Error('Invalid case entry name');
    seen.add(name.toLowerCase());
  }
  throwIfAborted(signal);
  const temporary = path.join(path.dirname(destination), `.rscase-${crypto.randomBytes(12).toString('hex')}.tmp`);
  let output;
  let offset = 0;
  const directory = [];
  const append = async buffer => {
    throwIfAborted(signal);
    if (offset + buffer.length > maxBytes) throw new Error('Case exceeds size limit');
    let written = 0;
    while (written < buffer.length) {
      const result = await output.write(buffer, written, buffer.length-written, offset+written);
      if (!result.bytesWritten) throw new Error('Could not write case file');
      written += result.bytesWritten;
    }
    offset += written;
  };
  try {
    output = await fs.promises.open(temporary, 'wx', 0o600);
    for (const entry of entries) {
      const name = Buffer.from(entry.name);
      const start = offset;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4);
      local.writeUInt16LE(0x808,6); local.writeUInt16LE(name.length,26);
      await append(local); await append(name);
      let crc = 0xffffffff, size = 0;
      let input;
      try {
        let chunks;
        if (entry.file) {
          if (!(await fs.promises.lstat(entry.file)).isFile()) throw new Error('Invalid case asset');
          input = await fs.promises.open(entry.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
          const stat = await input.stat();
          if (!stat.isFile() || !stat.size || stat.size > maxBytes-offset) throw new Error('Invalid case asset');
          chunks = input.createReadStream({autoClose:false, highWaterMark:256*1024});
        } else chunks = [Buffer.from(entry.data)];
        for await (const chunk of chunks) {
          size += chunk.length;
          for (const value of chunk) crc = table[(crc ^ value) & 255] ^ (crc >>> 8);
          await append(chunk);
        }
      } finally { await input?.close(); }
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc,4);
      descriptor.writeUInt32LE(size,8); descriptor.writeUInt32LE(size,12);
      await append(descriptor);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6);
      central.writeUInt16LE(0x808,8); central.writeUInt32LE(crc,16);
      central.writeUInt32LE(size,20); central.writeUInt32LE(size,24);
      central.writeUInt16LE(name.length,28); central.writeUInt32LE(start,42);
      directory.push(central,name);
    }
    const directoryStart = offset;
    for (const chunk of directory) await append(chunk);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10);
    end.writeUInt32LE(offset-directoryStart,12); end.writeUInt32LE(directoryStart,16);
    await append(end);
    await output.sync(); await output.close(); output = null;
    throwIfAborted(signal);
    await fs.promises.link(temporary,destination);
    return {path:destination, bytes:offset};
  } finally {
    await output?.close();
    await fs.promises.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
