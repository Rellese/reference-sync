import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import * as childProcess from 'node:child_process';
import { nodeApi } from '../../js/node-bridge.js';
import { toolchain, runGallery } from '../../js/toolchain.js';
import { finalMediaName, validateVideo } from '../../js/downloaded-media.js';

test('real gallery-dl/yt-dlp merges separate HLS audio and video using the supplied FFmpeg path', async t => {
  const ffmpeg = process.env.RS_TEST_FFMPEG;
  const python = process.env.RS_TEST_GALLERY_PYTHON;
  if (!ffmpeg || !python) return t.skip('Set RS_TEST_FFMPEG and RS_TEST_GALLERY_PYTHON; optional RS_TEST_GALLERY_RUNTIME');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-hls-'));
  const previousNode = { ...nodeApi }, previousToolchain = { ...toolchain };
  Object.assign(nodeApi, { available: true, fs, path, childProcess });
  Object.assign(toolchain, { ready: true, kind: 'module', command: python, args: ['-c', `
import gallery_dl
from gallery_dl import extractor
from gallery_dl.extractor.common import Extractor, Message
class FixtureExtractor(Extractor):
    category = 'pinterest'
    subcategory = 'fixture'
    pattern = r'rsfixture:(.+)'
    def __init__(self, match):
        Extractor.__init__(self, match)
        self.media_url = match[1]
    def items(self):
        data = {'extension': 'mp4', 'num': 1}
        yield Message.Directory, '', data
        yield Message.Url, 'ytdl:' + self.media_url, data
extractor.add(FixtureExtractor)
gallery_dl.main()
`],
    pythonPath: process.env.RS_TEST_GALLERY_RUNTIME, ffmpeg });
  const server = http.createServer((req, res) => {
    const name = path.basename(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(root, name);
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Length', fs.statSync(file).size);
    fs.createReadStream(file).pipe(res);
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    Object.assign(nodeApi, previousNode); Object.assign(toolchain, previousToolchain);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const fixture = new URL('../fixtures/media/synthetic-av.mp4', import.meta.url);
  for (const [name, stream] of [['video', 'v'], ['audio', 'a']]) {
    childProcess.execFileSync(ffmpeg, ['-v', 'error', '-i', fixture.pathname, '-map', `0:${stream}:0`, '-c', 'copy',
      '-f', 'hls', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', `${name}-init.mp4`,
      '-hls_segment_filename', path.join(root, `${name}-%d.m4s`), path.join(root, `${name}.m3u8`)]);
  }
  fs.writeFileSync(path.join(root, 'master.m3u8'), '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=32x32,CODECS="avc1.64000a,mp4a.40.2",AUDIO="aud"\nvideo.m3u8\n');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `rsfixture:http://127.0.0.1:${server.address().port}/master.m3u8`;
  const run = async (name, merger) => {
    toolchain.ffmpeg = merger;
    const dest = path.join(root, name);
    const result = await runGallery(['--config-ignore', '--no-input', '-o', 'downloader.ytdl.format=bestvideo+bestaudio', '--dest', dest, '--directory', '', '--filename', '1.{extension}', url], { timeout: 60000 });
    const files = fs.existsSync(dest) ? fs.readdirSync(dest) : [];
    return { result, dest, files };
  };
  const missing = await run('missing', path.join(root, 'no-ffmpeg'));
  assert.ok(missing.files.some(name => /^1\.f.*\.mp4$/.test(name)), JSON.stringify(missing));
  assert.deepEqual(missing.files.filter(finalMediaName), [], JSON.stringify(missing));
  const merged = await run('merged', ffmpeg);
  assert.equal(merged.result.code, 0, merged.result.stderr);
  assert.deepEqual(merged.files.filter(finalMediaName), ['1.mp4']);
  const video = path.join(merged.dest, '1.mp4');
  await validateVideo(video, { ffmpeg });
  const streams = childProcess.spawnSync(ffmpeg, ['-hide_banner', '-i', video], { encoding: 'utf8' }).stderr;
  assert.match(streams, /Video:/); assert.match(streams, /Audio:/);
});
