import test from 'node:test';
import assert from 'node:assert/strict';
import { pinterestMedia, pinterestDownloadPlan } from '../../js/pinterest-media.js';

test('Pinterest HLS metadata chooses progressive MP4 without requiring yt-dlp', () => {
  const media = pinterestMedia({ extension: 'mp4', _galleryUrl: 'ytdl:https://cdn.example/video.m3u8', _fallback: ['https://cdn.example/video.mp4'] });
  assert.deepEqual(media, { url: 'https://cdn.example/video.mp4', extension: 'mp4' });
  assert.deepEqual(pinterestDownloadPlan({ selectedComponents: [4], components: [{ index: 2 }, { index: 4, directMedia: media }] }), [{ ...media, componentIndex: 4 }]);
  assert.deepEqual(pinterestDownloadPlan({ components: [{ index: 1 }] }), []);
  assert.equal(pinterestMedia({ extension: 'mp4', _galleryUrl: 'ytdl:https://cdn.example/only.m3u8' }), null);
});
