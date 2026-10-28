# Synthetic video fixtures

These two three-second, silent 320x180 clips contain only a solid blue or green
frame. They were generated locally for browser playback checks; no downloaded
or user media is included. They are development fixtures and are excluded from
the native release archive and runtime container.

Reproduce with FFmpeg:

```sh
ffmpeg -f lavfi -i color=c=blue:s=320x180:d=3 -c:v libx264 -pix_fmt yuv420p blue.mp4
ffmpeg -f lavfi -i color=c=green:s=320x180:d=3 -c:v libx264 -pix_fmt yuv420p green.mp4
```

`node scripts/demo.js` puts these clips and two generated WAV tracks in disposable
storage. Browser checks performed against that demo:

- Repeat off, auto-next on: the first clip advances to the second, which stops at
  the end of the video list.
- Repeat on, auto-next on: the first clip continues playing after its three-second
  duration and retains its title; repeat has priority.
- Both off: the same clip ends with `currentTime=duration` and `paused=true`.
- Opening another directory leaves the audio bar playing its original queue;
  automatic progression, Next track and Stop work.

These are manual browser observations, not automated browser regression tests.
Mobile autoplay, touch seeking, different codecs and audio error recovery still
need verification.
