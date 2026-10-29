# VCompress

A portable Electron app that compresses any video down to a **target file size in MB** — built primarily for sending clips in Discord, where the free tier caps uploads around 10-20 MB. You drop a video, tell it how big the result should be, and it figures out the bitrate needed to land there, then re-encodes with bundled FFmpeg.

> [!IMPORTANT]
> **Choose the right download before installing:**
>
> - **`VCompress-Fast.zip`** — fastest NVIDIA GPU encoding, up to **40% faster** than Compatible on supported systems. Uses BtbN FFmpeg and requires an NVIDIA driver **610.00 or newer**. Best for modern RTX systems.
> - **`VCompress-Compatible.zip`** — recommended when the NVIDIA driver is below `610.00`, or when Fast says NVENC is unavailable. Uses Gyan FFmpeg and supports older NVIDIA driver branches, including many GTX 10xx / GTX 16xx PCs.
>
> GPU codec support still depends on the hardware: AV1 NVENC requires RTX 40-series or newer; GTX 10xx / GTX 16xx use H.264 or H.265.

<p align="center">
  <img src="https://i.imgur.com/qpCuc8A.png" alt="Preview" width="1000">
</p>

## Recommended Quality Settings (H.265 if AV1 is unavailable)

<p align="center">
  <img src="https://i.imgur.com/Dq5nOgB.png" alt="Preview" width="1000">
</p>

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
- **Video Codec** — `H.264` for maximum compatibility, `H.265` saves more size, `AV1` gives the best quality per megabyte but encodes slower and needs a modern player (AV1 hardware encoding requires RTX 40-series+).
- **Quality Bias** — `Faster Encode`, `Balanced` or `Better Quality`: how much to trade encode time vs picture quality at the same target size.
- **Audio Mode** — `Compress` re-encodes sound to your chosen bitrate, `Keep Original` passes it through untouched.
- **Match Source FPS** — read FPS from the loaded video instead of typing it.
- **Padding** — pads the file with zero bytes to hit exactly the target size
- **Size Tolerance MB** — acceptable `-`/`+` range around the target; leave `Any` to accept whatever the encoder produces.

### Defaults tab

Startup defaults for new files. Changes here are saved to `compressor_settings.json` and used the next time the app opens — while Settings applies only to the current run.

Includes **Overwrite Output**: off (default) — re-compressing the same video produces `name (1).mp4`, `name (2).mp4`… like Explorer copies; on — replaces the previous result in place.

### Audio tab

Pick which source audio tracks go into the output. Tracks carry their real names from the file metadata (e.g. `System sounds` / `Microphone` for NVIDIA App recordings), so you always know what you're keeping. Uncheck what you don't need.

### Logs tab

Everything the encoder says: detected duration, bitrate, probes, retries, final size and full FFmpeg output. `Copy Logs` copies it for bug reports.

## Build & run

Two ways to use it:

**Portable (recommended)** — download the release archive, unpack anywhere and run `VCompress.exe`. FFmpeg is bundled, nothing else is needed.

**From source** — needs Node.js:

```bat
setup.bat    :: installs Node.js (if missing) and deps
run.bat      :: visible console
run_hidden.vbs :: no console window
```

Build release zips yourself (both variants in one run):

```bat
build-release.bat
```

This produces `dist\VCompress-Fast-win64.zip` (BtbN FFmpeg) and
`dist\VCompress-Compatible-win64.zip` (Gyan FFmpeg) — icon embedded, correct
FFmpeg placed into each automatically. Requires the two binaries to exist
once: put them into `ffmpeg\btbn\ffmpeg.exe` and `ffmpeg\gyan\ffmpeg.exe`.
Run with `fast` or `compatible` to build a single variant.

Build just an unpacked portable folder (no zip, current `ffmpeg\bin\`):

```bat
npm run build:win
node_modules\rcedit\bin\rcedit-x64.exe dist\win-unpacked\VCompress.exe --set-icon build\icon.ico
```

(The second line embeds the app icon into the .exe so Explorer shows it —
electron-builder's own icon step is disabled to avoid its winCodeSign
download.)

The output lands in `dist\` (an unpacked portable folder with `VCompress.exe`).

## Requirements

- Windows 10/11
- Node.js (setup.bat installs it via winget if missing) — only for running from source
- FFmpeg binary — bundled in each release. **Compatible** uses the [gyan.dev full build](https://www.gyan.dev/ffmpeg/builds/) for broader old-driver support. **Fast** uses a fixed [BtbN](https://github.com/BtbN/FFmpeg-Builds/releases) build and requires NVIDIA driver `610.00+` for NVENC. For source builds, put `ffmpeg.exe` into `ffmpeg/bin/`.

## Notes

- For Discord's ~20 MB limit, pick `Size = 20` and `Audio = 96 kbps` — the app handles the bitrate math and retries until it fits the size tolerance.
- AV1 needs a recent GPU (or `libsvtav1` on CPU) — H.265 is a safer pick if you're not sure.
- Output never exceeds your target size: if the first encode lands over the limit, the app recalculates bitrate and re-encodes automatically.
- Hardware encoders have a minimum bitrate floor (~0.5 Mbps at 1080p). If your target is very small for a long video, the app warns you in the log before encoding and suggests lowering the resolution or trimming the video.
- Very aggressive targets on damaged recordings (NVIDIA App/ShadowPlay glitches) are detected and reported in the log — trim the broken part in the Clip tab for a clean result.

## License

MIT — see [LICENSE](LICENSE).
