import { nodeApi, runCommand } from './node-bridge.js';
import { throwIfAborted } from './job-control.js';

// Only the final gallery-dl filename is importable. yt-dlp's .f<format>,
// .part and fragment files are intermediate streams, even when they end in MP4.
export const finalMediaName = name => /^\d+\.(?:jpe?g|png|webp|gif|avif|heic|bmp|tiff|mp4|mov|webm|mkv|m4v|avi)$/i.test(name);
function completeMp4(file) {
  const { fs } = nodeApi;
  const length = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  const header = new Uint8Array(16);
  const view = new DataView(header.buffer);
  let offset = 0;
  const types = new Set();
  try {
    while (offset < length) {
      if (length - offset < 8 || fs.readSync(fd, header, 0, 8, offset) !== 8) return false;
      let size = view.getUint32(0);
      let headerSize = 8;
      const type = String.fromCharCode(...header.slice(4, 8));
      if (size === 1) {
        if (fs.readSync(fd, header, 8, 8, offset + 8) !== 8) return false;
        size = view.getUint32(8) * 4294967296 + view.getUint32(12);
        headerSize = 16;
      } else if (size === 0) size = length - offset;
      if (!Number.isSafeInteger(size) || size < headerSize || size > length - offset) return false;
      types.add(type);
      offset += size;
    }
    return types.has('moov') && types.has('mdat');
  } finally { fs.closeSync(fd); }
}
export async function validateVideo(file, { ffmpeg, signal } = {}) {
  if (!/\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(file)) return;
  if (!ffmpeg) throw new Error('Для проверки и сборки видео требуется FFmpeg. Обновите видеокомпонент.');
  if (/\.(mp4|mov|m4v)$/i.test(file) && !completeMp4(file)) {
    throw new Error(`Видео не прошло проверку: ${nodeApi.path.basename(file)}. Неполный MP4-контейнер.`);
  }
  // Decode the entire video, not just a header or first frame. -map rejects
  // audio-only MP4; -xerror rejects truncated/corrupt streams.
  const result = await runCommand(ffmpeg, ['-nostdin', '-hide_banner', '-v', 'error', '-xerror',
    '-i', file, '-map', '0:v:0', '-map', '0:a?', '-progress', 'pipe:1', '-f', 'null', '-'], { signal, timeout: 120000 });
  throwIfAborted(signal);
  if (result.code !== 0 || ![...String(result.stdout).matchAll(/^frame=\s*(\d+)/gm)].some(match => Number(match[1]) > 0)) throw new Error(`Видео не прошло проверку: ${nodeApi.path.basename(file)}. ${String(result.stderr || '').slice(-500)}`);
}
