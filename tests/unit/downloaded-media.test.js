import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as childProcess from 'node:child_process';
import { nodeApi } from '../../js/node-bridge.js';
import { finalMediaName, validateVideo } from '../../js/downloaded-media.js';
import { selectedDownloadedFiles } from '../../js/carousel-selection.js';

test('intermediate format/audio tracks are excluded for single posts and restored carousels', () => {
  const files = ['1.f1244.mp4', '1.faudio1-1.mp4', '1.fprogram_audio_0-Alternate_Audio.mp4', '1.mp4.part', '1.mp4'];
  assert.deepEqual(files.filter(finalMediaName), ['1.mp4']);
  for (const componentCount of [1, 2]) {
    const result = selectedDownloadedFiles({ post: { componentCount, components: [{ index: 1 }, { index: 2 }] }, files });
    assert.deepEqual(result.map(entry => entry.file), ['1.mp4']);
  }
});

test('real decoder accepts complete AV, rejects audio-only MP4 and truncation', async t => {
  const ffmpeg = process.env.RS_TEST_FFMPEG || ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(file => fs.existsSync(file));
  if (!ffmpeg) { t.skip('FFmpeg is required'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-media-validation-'));
  const previous = { ...nodeApi };
  Object.assign(nodeApi, { available: true, fs, path, childProcess });
  t.after(() => { Object.assign(nodeApi, previous); fs.rmSync(root, { recursive: true, force: true }); });
  const fixture = new URL('../fixtures/media/synthetic-av.mp4', import.meta.url);
  const video = path.join(root, '1.mp4'), audio = path.join(root, '2.mp4'), broken = path.join(root, '3.mp4');
  fs.copyFileSync(fixture, video);
  childProcess.execFileSync(ffmpeg, ['-v', 'error', '-i', video, '-map', '0:a:0', '-c', 'copy', audio]);
  fs.writeFileSync(broken, fs.readFileSync(video).subarray(0, 3000));
  await validateVideo(video, { ffmpeg });
  await assert.rejects(validateVideo(audio, { ffmpeg }), /не прошло проверку/);
  await assert.rejects(validateVideo(broken, { ffmpeg }), /не прошло проверку/);
});
