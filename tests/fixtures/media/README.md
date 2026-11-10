# Synthetic media fixture

`synthetic-av.mp4` is a one-second blue 32×32 frame with a generated 440 Hz
sine tone. It contains no downloaded or personal media. It exercises actual
video/audio decoding, audio-only rejection, truncated MP4 rejection and HLS
merging through the real downloader.

Generated with FFmpeg:

```sh
ffmpeg -f lavfi -i color=c=blue:s=32x32:r=10 \
  -f lavfi -i sine=frequency=440:sample_rate=44100 \
  -t 1 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart synthetic-av.mp4
```

Run the optional HLS integration test with installed tools (no automatic
installation). It serves only this synthetic media over loopback:

```sh
RS_TEST_FFMPEG=/absolute/path/to/ffmpeg \
RS_TEST_GALLERY_PYTHON=/absolute/path/to/python \
RS_TEST_GALLERY_RUNTIME=/optional/gallery-dl/python/package/directory \
node --test tests/integration/hls-merge.test.js
```
