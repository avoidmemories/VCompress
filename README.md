# VCompress

A portable Electron app that compresses any video down to a **target file size in MB** — built primarily for sending clips in Discord, where the free tier caps uploads around 8–10 MB. You drop a video, tell it how big the result should be, and it figures out the bitrate needed to land there, then re-encodes with bundled FFmpeg.

## What it does

- Compresses video to an exact target size, not just a quality level
- GPU encode via NVENC or CPU 2-pass encode, three codecs each
- Clips a segment with a timeline before compressing
- Picks audio tracks, removes or keeps original sound, exports audio-only
- Shows detailed logs and a final size report

## Interface tour

### Compress tab

Drop a video on the card or click to browse. You get one card with all the quick settings:

- **Size** — target output in megabytes.
- **Resolution** — output resolution, `Keep Original` keeps source size.
- **FPS** — output frame rate, or tick `Match Source FPS` in Settings to pull it from the loaded file.
- **Audio** — `Remove` strips sound, `Audio Only` exports MP3, or pick a bitrate 96–320 kbps.
- **Compress** — starts the job; shows progress and elapsed time while running.
- **Save Location** — where the result lands, plus `Show in folder` after finish.

### Clip tab

Trim a segment before rendering. You can scrub the timeline, drag the range, and:

- **Play / Pause** and frame-step buttons under the player
- **Zoom badge** — current zoom level; scroll the mouse wheel over the timeline to zoom in/out
- **Ctrl + scroll wheel** — step frame-by-frame without moving the cursor
- **Trim left / Trim right** — snap the selection to the playhead
- **Compress** on the toolbar renders only the selected range

### Settings tab

Fine-grained encoding options for the current run. These are applied to the next compression you start, not as app defaults:

- **Encoding Device** — `GPU` uses your graphics card for speed, `CPU` is slower but works everywhere. CPU also hits the target size more precisely — its 2-pass encode analyses the video first, then encodes with a tighter bitrate budget than the single-pass GPU path.
- **Video Codec** — `H.264` for maximum compatibility, `H.265` saves more size, `AV1` gives the best quality per megabyte but encodes slower and needs a modern player.
- **Quality Bias** — `Smaller Size`, `Balanced` or `Better Quality`: how much to trade encode time vs picture quality at the same target size.
- **Audio Mode** — `Compress` re-encodes sound to your chosen bitrate, `Keep Original` passes it through untouched.
- **Match Source FPS** — read FPS from the loaded video instead of typing it.
- **Padding** — pads the file with zero bytes to hit exactly the target size
- **Size Tolerance MB** — acceptable `-`/`+` range around the target; leave `Any` to accept whatever the encoder produces.

### Defaults tab

Startup defaults for new files. Changes here are saved to `compressor_settings.json` and used the next time the app opens — while Settings applies only to the current run.

### Audio tab

Pick which source audio tracks go into the output. Useful for files with multiple language or comment tracks — uncheck what you don't need.

### Logs tab

Everything the encoder says: detected duration, bitrate, retries, final size and full FFmpeg output. `Copy Logs` copies it for bug reports.

## Build & run

Two ways to use it:

**From source** — needs Node.js:

```bat
setup.bat    :: installs Node.js (if missing) and deps
run.bat      :: visible console
run_hidden.vbs :: no console window
```

**Portable build** — already compiled `VCompress.exe` in `VCompress-Portable`, just drop a `ffmpeg.exe` next to it (or it ships one under `resources/`).

## Requirements

- Windows 10/11
- Node.js (setup.bat installs it via winget if missing)
- FFmpeg binary — put `ffmpeg.exe` into `ffmpeg/bin/` for source, or into `resources/ffmpeg/` for the portable build. Static Windows builds are available on gyan.dev or gpl/ffmpeg.org mirrors.

## Notes

- For Discord's ~20 MB limit, pick `Size = 20` and `Audio = 96 kbps` — the app handles the bitrate math and retries until it fits the size tolerance.
- AV1 needs a recent GPU (or `libsvtav1` on CPU) — H.265 is a safer pick if you're not sure.
- Output never exceeds your target size: if the first encode lands over the limit, the app recalculates bitrate and re-encodes automatically.

## License

MIT. FFmpeg binary is excluded from the repo — see [LICENSING](ffmpeg.org/legal.html) if you redistribute it.
