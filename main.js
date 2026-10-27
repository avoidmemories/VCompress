const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const appDir = __dirname;
const videoExtensions = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v']);
const audioExtensions = new Set(['.mp3', '.wav', '.ogg', '.opus', '.flac', '.aac', '.m4a', '.wma']);
const mediaExtensions = new Set([...videoExtensions, ...audioExtensions]);
let mainWindow = null;
let currentProcess = null;
let currentPreviewProcess = null;
let currentPreviewFrameProcess = null;
let cancelRequested = false;
let currentOutputPath = null;
let currentPassLog = null;
let dragOffset = { x: 0, y: 0 };
let pendingOpenFile = getOpenFileArg();


function getPortableDir() {
  return app.isPackaged ? path.dirname(process.execPath) : appDir;
}

function getSettingsFile() {
  return path.join(getPortableDir(), 'compressor_settings.json');
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  fs.writeFileSync(getSettingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  return { success: true };
}

function resolveFFmpeg() {
  const envPath = process.env.FFMPEG_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const resourcesDir = app.isPackaged ? process.resourcesPath : appDir;
  const candidates = [
    path.join(resourcesDir, 'ffmpeg', 'ffmpeg.exe'),
    path.join(resourcesDir, 'ffmpeg.exe'),
    path.join(appDir, 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(appDir, 'ffmpeg', 'ffmpeg.exe'),
    path.join(appDir, 'ffmpeg.exe')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return 'ffmpeg';
}

let FFMPEG = resolveFFmpeg();
let NVENC_AVAILABLE = null; // null = not probed yet, true/false after probe

function isMediaFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  return fs.existsSync(filePath) && mediaExtensions.has(path.extname(filePath).toLowerCase());
}

function getOpenFileArg(argv = process.argv) {
  return argv.find((arg) => isMediaFile(arg)) || null;
}

// One-shot NVENC capability probe (~200ms): encode 0.1s of black to h264_nvenc.
// Result is cached for the app's lifetime and surfaced to the UI so the GPU
// option can be disabled on machines without an NVIDIA GPU instead of failing
// mid-compress.
function probeNvencSupport() {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error',
      // 145x145: NVENC rejects frame dimensions below ~149 px; a probe
      // smaller than that fails with "invalid param" even on capable GPUs.
      '-f', 'lavfi', '-i', 'nullsrc=s=256x256:d=0.1',
      '-c:v', 'h264_nvenc', '-f', 'null', '-'
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

function ffmpegStatus() {
  FFMPEG = resolveFFmpeg();
  // 'ffmpeg' as a bare name is a PATH fallback, not a found binary —
  // verify it actually launches before reporting Ready, otherwise the app
  // shows "Ready" on machines with no ffmpeg anywhere and every encode
  // (and the NVENC probe) fails confusingly.
  let found = false;
  let version = 'FFmpeg executable not found. Put ffmpeg.exe into ffmpeg/bin/ next to the app.';
  if (FFMPEG !== 'ffmpeg') {
    found = fs.existsSync(FFMPEG);
    if (!found) version = `Resolved path does not exist: ${FFMPEG}`;
  } else {
    const probe = spawnSync(FFMPEG, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    found = probe.status === 0 && !probe.error;
    if (found) {
      const line = (probe.stdout || '').split(/\r?\n/)[0] || '';
      version = line.includes('ffmpeg') ? line : 'Ready';
    }
  }
  return { found, path: FFMPEG, version, nvenc: NVENC_AVAILABLE };
}

function sendLog(message, type = 'info') {
  mainWindow?.webContents.send('log', String(message), type);
}

function sendProgress(percent, status = 'Processing...') {
  mainWindow?.webContents.send('progress', percent, status);
}

function playSystemSound(fileName) {
  if (process.platform !== 'win32') return;
  const soundPath = path.join('C:\\Windows\\Media', fileName);
  if (!fs.existsSync(soundPath)) return;
  spawn('powershell.exe', [
    '-NoProfile',
    '-Command',
    `(New-Object Media.SoundPlayer '${soundPath}').PlaySync()`
  ], { windowsHide: true, stdio: 'ignore' });
}

function playCompleteSound() {
  playSystemSound('Windows Exclamation.wav');
}

function playErrorSound() {
  playSystemSound('Windows Error.wav');
}

function runFFmpeg(args, onData, progressContext = null) {
  return new Promise((resolve, reject) => {
    if (cancelRequested) {
      reject(new Error('Cancelled'));
      return;
    }

    let stderr = '';
    let stderrTail = '';
    let lastProgressSent = 0;
    currentProcess = spawn(FFMPEG, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const progress = progressContext ? normalizeProgressContext(progressContext) : null;

    currentProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrTail = (stderrTail + text).slice(-2000);
      onData?.(text);

      if (progress) {
        // ffmpeg's progress lines come as \r-separated updates in one stream;
        // parse the tail so a line split across chunk boundaries still works.
        const now = Date.now();
        if (now - lastProgressSent >= 250) {
          const update = parseFfmpegProgress(stderrTail, progress);
          if (update) {
            lastProgressSent = now;
            reportFfmpegProgress(update, progress);
          }
        }
      }
    });

    currentProcess.on('error', reject);
    currentProcess.on('close', (code) => {
      currentProcess = null;
      if (cancelRequested) {
        reject(new Error('Cancelled'));
      } else if (code === 0) {
        resolve({ stderr });
      } else {
        reject(new Error(stderr.slice(-1200) || `FFmpeg exited with code ${code}`));
      }
    });
  });
}

// progressContext: { fromPercent, toPercent, duration, label }
// so a 2-pass encode maps pass 1 to 0-50% and pass 2 to 50-100%.
function normalizeProgressContext(ctx) {
  const from = Number(ctx.fromPercent);
  const to = Number(ctx.toPercent);
  const duration = Number(ctx.duration);
  return {
    fromPercent: Number.isFinite(from) ? Math.max(0, from) : 0,
    toPercent: Number.isFinite(to) ? Math.max(0, to) : 100,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    label: ctx.label || 'Encoding',
    startMs: Date.now()
  };
}

function parseFfmpegProgress(tail, progress) {
  if (!progress.duration) return null;
  // ffmpeg writes progress as \r-separated updates; only the newest complete
  // line is current. Scan segments from the end and take the first that has a
  // time= value — this skips a trailing partial line cut at a chunk boundary
  // and a trailing empty segment after the final \r.
  const segments = tail.split(/[\r\n]+/);
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    const timeMatch = segment.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!timeMatch) continue;
    const seconds = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    let speed = null;
    const speedMatch = segment.match(/speed=\s*([\d.]+)x/);
    if (speedMatch) {
      const parsed = Number(speedMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) speed = parsed;
    }
    return { seconds, speed };
  }
  return null;
}

function reportFfmpegProgress(update, progress) {
  const fraction = Math.max(0, Math.min(1, update.seconds / progress.duration));
  const percent = Math.round(progress.fromPercent + (progress.toPercent - progress.fromPercent) * fraction);
  let status = `${progress.label}: ${formatSeconds(Math.min(update.seconds, progress.duration))} / ${formatSeconds(progress.duration)}`;
  if (update.speed) {
    const elapsed = (Date.now() - progress.startMs) / 1000;
    const done = Math.min(update.seconds, progress.duration);
    const eta = Math.max(0, (progress.duration - done) / update.speed);
    if (elapsed >= 3 && eta >= 5) {
      status += ` (${update.speed.toFixed(2)}x, ~${formatEta(eta)} left)`;
    } else {
      status += ` (${update.speed.toFixed(2)}x)`;
    }
  }
  sendProgress(percent, status);
}

function formatEta(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return secs ? `${minutes}m ${secs}s` : `${minutes}m`;
}

function getDuration(filePath) {
  const text = getMediaInfoText(filePath);
  return parseDurationFromText(text);
}

function parseDurationFromText(text) {
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// Media-info cache: probing a file spawns ffmpeg (up to ~1s for big files),
// and compress() used to probe the same input up to 3 times in a row.
// Keyed by path + size + mtime, so edits to the file invalidate naturally.
const mediaInfoCache = new Map();

function getMediaInfoCacheKey(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${path.resolve(filePath)}|${stat.size}|${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

function getMediaInfoText(filePath) {
  const key = getMediaInfoCacheKey(filePath);
  if (!key) return '';
  const cached = mediaInfoCache.get(key);
  if (cached !== undefined) return cached;
  const result = spawnSync(FFMPEG, ['-i', filePath], {
    encoding: 'utf8',
    windowsHide: true,
    errors: 'replace'
  });
  const text = result.stderr || '';
  mediaInfoCache.set(key, text);
  return text;
}

function getMediaInfoTextAsync(filePath) {
  const key = getMediaInfoCacheKey(filePath);
  if (!key) return Promise.resolve('');
  const cached = mediaInfoCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise((resolve) => {
    let stderr = '';
    const child = spawn(FFMPEG, ['-i', filePath], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', () => resolve(''));
    child.on('close', () => {
      mediaInfoCache.set(key, stderr);
      resolve(stderr);
    });
  });
}

function getAudioBitrate(filePath) {
  const text = getMediaInfoText(filePath);
  const audioLine = text.split(/\r?\n/).find((line) => line.includes('Audio:'));
  if (!audioLine) return 0;
  const match = audioLine.match(/,\s*(\d+)\s*kb\/s/i);
  return match ? Number(match[1]) : 0;
}

function getVideoFps(filePath) {
  const text = getMediaInfoText(filePath);
  return parseVideoFpsFromText(text);
}

function parseVideoFpsFromText(text) {
  const videoLine = text.split(/\r?\n/).find((line) => line.includes('Video:'));
  if (!videoLine) return 0;
  const fpsMatch = videoLine.match(/,\s*([\d.]+)\s*fps/i);
  if (fpsMatch) return Number(fpsMatch[1]);
  const tbrMatch = videoLine.match(/,\s*([\d.]+)\s*tbr/i);
  return tbrMatch ? Number(tbrMatch[1]) : 0;
}

function parseAudioTracksFromText(text) {
  const tracks = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('Audio:')) continue;
    const streamMatch = line.match(/Stream #\d+:(\d+)(?:\[[^\]]+\])?(?:\(([^)]+)\))?:\s*Audio:\s*([^,\r\n]+)/i);
    if (!streamMatch) continue;
    const [, streamIndexText, languageText, codecText] = streamMatch;
    const streamIndex = Number(streamIndexText);
    const audioIndex = tracks.length;
    const sampleRateMatch = line.match(/,\s*(\d+)\s*Hz/i);
    const bitrateMatch = line.match(/,\s*(\d+)\s*kb\/s/i);
    const channelMatch = line.match(/,\s*([^,\r\n]*?(?:stereo|mono|5\.1|7\.1|quad|surround)[^,\r\n]*)/i);
    // Track names: DVR recordings (NVIDIA App/ShadowPlay) put them in the
    // stream's metadata as "name" or "title" on the lines FOLLOWING the
    // "Audio:" line, inside a "Metadata:" block. Look ahead up to 8 lines,
    // stopping at the next stream.
    let label = '';
    for (let j = i + 1; j < Math.min(lines.length, i + 9); j++) {
      const next = lines[j];
      if (next.includes('Stream #')) break;
      const nameMatch = next.match(/^\s*(?:name|title)\s*:\s*([^\r\n]+)/i);
      if (nameMatch) {
        label = nameMatch[1].trim();
        break;
      }
    }
    tracks.push({
      id: audioIndex,
      audio_index: audioIndex,
      stream_index: Number.isFinite(streamIndex) ? streamIndex : audioIndex + 1,
      label: label || `Audio ${audioIndex + 1}`,
      language: languageText || '',
      codec: codecText.trim(),
      channels: channelMatch ? channelMatch[1].trim() : '',
      sample_rate: sampleRateMatch ? Number(sampleRateMatch[1]) : 0,
      bitrate_kbps: bitrateMatch ? Number(bitrateMatch[1]) : 0
    });
  }
  return tracks;
}

function normalizeSelectedAudioTracks(selectedTracks, availableTracks) {
  const available = Array.isArray(availableTracks) ? availableTracks : [];
  if (!available.length) return [];
  if (!Array.isArray(selectedTracks)) return available.map((track) => track.audio_index);
  const allowed = new Set(available.map((track) => track.audio_index));
  return [...new Set(selectedTracks.map((value) => Number(value)).filter((value) => allowed.has(value)))];
}

function selectedAudioBitrateKbps(audioMode, abr, selectedTracks, availableTracks) {
  if (audioMode === 'remove' || !selectedTracks.length) return 0;
  if (audioMode === 'keep') {
    const byIndex = new Map(availableTracks.map((track) => [track.audio_index, track]));
    return selectedTracks.reduce((sum, index) => sum + (byIndex.get(index)?.bitrate_kbps || abr), 0);
  }
  return abr * selectedTracks.length;
}

function hasDecodeWarnings(mediaInfo) {
  return /Invalid data found|no frame|missing picture|error while decoding|Failed to parse header|concealing \d+/i.test(mediaInfo);
}

function parseVideoLineFromText(text) {
  return text.split(/\r?\n/).find((line) => line.includes('Video:')) || '';
}

function hasVideoStream(text) {
  return Boolean(parseVideoLineFromText(text));
}

function parseVideoDimensionsFromText(text) {
  const videoLine = parseVideoLineFromText(text);
  const matches = [...videoLine.matchAll(/(\d{2,5})x(\d{2,5})/g)]
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }))
    .filter((size) => size.width > 0 && size.height > 0);
  return matches.find((size) => size.width >= 160 && size.height >= 120) || null;
}

function parseVideoBitrateKbpsFromText(text) {
  const videoLine = parseVideoLineFromText(text);
  const match = videoLine.match(/,\s*(\d+)\s*kb\/s/i);
  return match ? Number(match[1]) : 0;
}

function parseRotationDegrees(mediaInfo) {
  const displayMatch = mediaInfo.match(/rotation of\s*(-?\d+(?:\.\d+)?)\s*degrees/i);
  if (displayMatch) return Number(displayMatch[1]);
  const rotateMatch = mediaInfo.match(/rotate\s*:\s*(-?\d+(?:\.\d+)?)/i);
  return rotateMatch ? Number(rotateMatch[1]) : 0;
}

function hasNonRightAngleRotation(mediaInfo) {
  const rotation = parseRotationDegrees(mediaInfo);
  if (!Number.isFinite(rotation)) return false;
  const normalized = Math.abs(rotation % 360);
  const nearestRightAngle = Math.round(normalized / 90) * 90;
  return Math.abs(normalized - nearestRightAngle) > 1;
}

function shouldUsePreviewProxy(mediaInfo) {
  return hasDecodeWarnings(mediaInfo) || hasNonRightAngleRotation(mediaInfo);
}

function runFFmpegBackground(args) {
  return new Promise((resolve, reject) => {
    if (currentPreviewProcess) {
      try {
        currentPreviewProcess.kill('SIGTERM');
      } catch {}
      currentPreviewProcess = null;
    }

    const child = spawn(FFMPEG, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    currentPreviewProcess = child;

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (currentPreviewProcess === child) currentPreviewProcess = null;
      reject(error);
    });
    child.on('close', (code) => {
      if (currentPreviewProcess === child) currentPreviewProcess = null;
      if (code === 0) resolve();
      else if (child.killed) reject(new Error('Cancelled'));
      else reject(new Error(stderr.slice(-1200) || `FFmpeg exited with code ${code}`));
    });
  });
}

function cancelPreviewProxy() {
  if (currentPreviewProcess) {
    try {
      currentPreviewProcess.kill('SIGTERM');
    } catch {}
    currentPreviewProcess = null;
  }
  if (currentPreviewFrameProcess) {
    try {
      currentPreviewFrameProcess.kill('SIGTERM');
    } catch {}
    currentPreviewFrameProcess = null;
  }
  return { success: true };
}


function runPreviewFrame(args) {
  return new Promise((resolve, reject) => {
    if (currentPreviewFrameProcess) {
      try {
        currentPreviewFrameProcess.kill('SIGTERM');
      } catch {}
      currentPreviewFrameProcess = null;
    }

    const child = spawn(FFMPEG, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    currentPreviewFrameProcess = child;

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (currentPreviewFrameProcess === child) currentPreviewFrameProcess = null;
      reject(error);
    });
    child.on('close', (code) => {
      if (currentPreviewFrameProcess === child) currentPreviewFrameProcess = null;
      if (code === 0) resolve();
      else if (child.killed) reject(new Error('Cancelled'));
      else reject(new Error(stderr.slice(-1200) || `FFmpeg exited with code ${code}`));
    });
  });
}

function getPreviewFrameCachePath(filePath, time) {
  const stat = fs.statSync(filePath);
  const frameTime = Math.max(0, Math.round((Number(time) || 0) * 1000) / 1000);
  const key = crypto
    .createHash('sha1')
    .update(`frame-v3-keyseek|${path.resolve(filePath)}|${stat.size}|${stat.mtimeMs}|${frameTime}`)
    .digest('hex');
  const dir = path.join(app.getPath('temp'), 'vcompress-preview-frames');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${key}.jpg`);
}

async function createPreviewFrame(filePath, time) {
  if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
  const output = getPreviewFrameCachePath(filePath, time);
  if (fs.existsSync(output) && fs.statSync(output).size > 0) {
    return { success: true, path: output, cached: true };
  }

  const tmp = `${output}.tmp.jpg`;
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    const targetTime = Math.max(0, Number(time) || 0);
    // Input-side seek only, output-side -frames:v 1. The old pattern
    // (fastSeek 2s early + precise output seek) made the decoder chew
    // through 2 seconds of frames from a poisoned reference chain on
    // damaged sources, producing a garbage frame that then got CACHED as
    // the preview for that timestamp. A single input seek resets the
    // decoder onto the nearest keyframe, which is what LosslessCut's frame
    // extraction does.
    await runPreviewFrame([
      '-y',
      '-hide_banner',
      '-loglevel', 'fatal',
      '-max_error_rate', '1.0',
      '-err_detect', 'ignore_err',
      '-fflags', '+genpts+discardcorrupt',
      '-ss', String(targetTime),
      '-i', filePath,
      '-frames:v', '1',
      '-vf', 'scale=w=min(1280\\,iw):h=-2:force_original_aspect_ratio=decrease:force_divisible_by=2',
      '-q:v', '3',
      tmp
    ]);
    fs.renameSync(tmp, output);
    return { success: true, path: output, cached: false };
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    return { success: false, error: error.message };
  }
}

function getPreviewCachePath(filePath) {
  const stat = fs.statSync(filePath);
  const key = crypto
    .createHash('sha1')
    .update(`v11-stable-preview-clean-audio|${path.resolve(filePath)}|${stat.size}|${stat.mtimeMs}`)
    .digest('hex');
  const dir = path.join(app.getPath('temp'), 'vcompress-preview-cache');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${key}.mp4`);
}

function getPreviewSegmentCachePath(filePath, start, duration) {
  const stat = fs.statSync(filePath);
  const segmentStart = Math.max(0, Math.floor((Number(start) || 0) * 2) / 2);
  const segmentDuration = Math.max(2, Math.min(16, Number(duration) || 8));
  const key = crypto
    .createHash('sha1')
    .update(`segment-v6-keyseek|${path.resolve(filePath)}|${stat.size}|${stat.mtimeMs}|${segmentStart}|${segmentDuration}`)
    .digest('hex');
  const dir = path.join(app.getPath('temp'), 'vcompress-preview-segments');
  fs.mkdirSync(dir, { recursive: true });
  return { output: path.join(dir, `${key}.mp4`), start: segmentStart, duration: segmentDuration };
}

async function createPreviewSegment(filePath, start = 0, duration = 8) {
  if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
  const mediaInfo = getMediaInfoText(filePath);
  const ignoreRotation = hasNonRightAngleRotation(mediaInfo);
  const { output, start: segmentStart, duration: segmentDuration } = getPreviewSegmentCachePath(filePath, start, duration);
  if (fs.existsSync(output) && fs.statSync(output).size > 0) {
    return { success: true, path: output, start: segmentStart, duration: segmentDuration, cached: true };
  }

  const tmp = `${output}.tmp.mp4`;
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'fatal',
      '-max_error_rate', '1.0',
      '-err_detect', 'ignore_err',
      '-fflags', '+genpts+discardcorrupt',
      '-ss', String(segmentStart),
      '-i', filePath,
      '-t', String(segmentDuration),
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-dn',
      '-sn',
      '-vf', 'scale=w=min(854\\,iw):h=-2:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=20,format=yuv420p',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '4.0',
      '-crf', '30',
      '-g', '20',
      '-bf', '0',
      '-c:a', 'aac',
      '-b:a', '80k',
      '-ac', '2',
      '-fps_mode', 'cfr',
      '-metadata:s:v:0', 'rotate=0',
      '-map_metadata', '-1',
      '-map_chapters', '-1',
      '-movflags', '+faststart',
      tmp
    ];
    if (ignoreRotation) args.splice(8, 0, '-noautorotate');
    await runFFmpegBackground(args);
    fs.renameSync(tmp, output);
    return { success: true, path: output, start: segmentStart, duration: segmentDuration, cached: false };
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    return { success: false, error: error.message };
  }
}

async function createPreviewProxy(filePath) {
  if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
  const output = getPreviewCachePath(filePath);
  if (fs.existsSync(output) && fs.statSync(output).size > 0) {
    return { success: true, path: output, cached: true };
  }

  const mediaInfo = getMediaInfoText(filePath);
  const ignoreRotation = hasNonRightAngleRotation(mediaInfo);
  const needsReencode = hasDecodeWarnings(mediaInfo);
  const remuxTmp = `${output}.remux.tmp.mp4`;
  const encodeTmp = `${output}.encode.tmp.mp4`;
  try {
    if (fs.existsSync(remuxTmp)) fs.unlinkSync(remuxTmp);
    if (fs.existsSync(encodeTmp)) fs.unlinkSync(encodeTmp);

    if (!needsReencode) {
      const remuxArgs = [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-max_error_rate', '1.0',
        '-err_detect', 'ignore_err',
        '-fflags', '+genpts+discardcorrupt',
        '-analyzeduration', '100M',
        '-probesize', '100M'
      ];
      if (ignoreRotation) remuxArgs.push('-noautorotate');
      remuxArgs.push(
        '-i', filePath,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-dn',
        '-sn',
        '-c', 'copy',
        '-movflags', '+faststart',
        '-avoid_negative_ts', 'make_zero',
        '-map_metadata', '-1',
        remuxTmp
      );

      try {
        await runFFmpegBackground(remuxArgs);
        if (fs.existsSync(remuxTmp) && fs.statSync(remuxTmp).size > 0) {
          fs.renameSync(remuxTmp, output);
          return { success: true, path: output, cached: false, mode: 'remux' };
        }
      } catch {
        try {
          if (fs.existsSync(remuxTmp)) fs.unlinkSync(remuxTmp);
        } catch {}
      }
    }

    const encodeArgs = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-max_error_rate', '1.0',
      '-err_detect', 'ignore_err',
      '-fflags', '+genpts+discardcorrupt',
      '-analyzeduration', '100M',
      '-probesize', '100M'
    ];
    if (ignoreRotation) encodeArgs.push('-noautorotate');
    encodeArgs.push(
      '-i', filePath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-dn',
      '-sn',
      '-vf', 'scale=w=min(1280\\,iw):h=-2:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,format=yuv420p',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '4.0',
      '-crf', '26',
      '-g', '30',
      '-bf', '0',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-vsync', '0',
      '-metadata:s:v:0', 'rotate=0',
      '-map_metadata', '-1',
      '-map_chapters', '-1',
      '-movflags', '+faststart',
      encodeTmp
    );
    await runFFmpegBackground(encodeArgs);
    fs.renameSync(encodeTmp, output);
    return { success: true, path: output, cached: false, mode: 'encode' };
  } catch (error) {
    try {
      if (fs.existsSync(remuxTmp)) fs.unlinkSync(remuxTmp);
      if (fs.existsSync(encodeTmp)) fs.unlinkSync(encodeTmp);
    } catch {}
    return { success: false, error: error.message };
  }
}

function makeVf(resolution, fps = 60, keepOriginalResolution = false, mediaInfo = '') {
  if (keepOriginalResolution || resolution === 'original') return `fps=${fps}`;
  const [w, h] = resolution.split('x').map(Number);
  const sourceSize = parseVideoDimensionsFromText(mediaInfo);
  const sourceIsLandscape = !sourceSize || sourceSize.width >= sourceSize.height;
  const targetW = sourceIsLandscape ? Math.max(w, h) : Math.min(w, h);
  const targetH = sourceIsLandscape ? Math.min(w, h) : Math.max(w, h);
  return `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=${fps}`;
}

function calcBitrate(mb, secs, abrKbps = 128, safety = 0.98) {
  const targetBits = Number(mb) * 8 * 1024 * 1024 * safety;
  const audioBits = abrKbps * 1000 * secs;
  return Math.max(Math.floor((targetBits - audioBits) / secs / 1000), 1);
}

function formatSeconds(value) {
  const total = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function padFileToSize(filePath, targetBytes) {
  let current = fs.statSync(filePath).size;
  let missing = targetBytes - current;
  if (missing <= 0) return current;

  const chunk = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(filePath, 'a');
  try {
    while (missing > 0) {
      const n = Math.min(missing, chunk.length);
      fs.writeSync(fd, chunk, 0, n);
      missing -= n;
    }
  } finally {
    fs.closeSync(fd);
  }

  current = fs.statSync(filePath).size;
  sendLog(`Padded file to exact target: ${(current / 1024 / 1024).toFixed(3)} MB (${current} bytes)`);
  return current;
}

function normalizeTolerance(params = {}, targetBytes = 0) {
  const source = params.tolerance || {};
  const enabled = Boolean(source.enabled);
  const mbToBytes = (value) => Math.max(0, Number(value) || 0) * 1024 * 1024;
  return {
    enabled,
    minBytes: enabled && source.minus_mode !== 'any' ? Math.max(0, targetBytes - mbToBytes(source.minus_mb)) : 0,
    maxBytes: enabled && source.plus_mode !== 'any' ? targetBytes + mbToBytes(source.plus_mb) : Infinity,
    minusAny: !enabled || source.minus_mode === 'any',
    plusAny: !enabled || source.plus_mode === 'any'
  };
}

function outputFitStatus(bytes, targetBytes, tolerance) {
  if (!tolerance?.enabled) {
    return { ok: bytes <= targetBytes, direction: bytes > targetBytes ? 'over' : 'ok' };
  }
  if (bytes < tolerance.minBytes) return { ok: false, direction: 'under' };
  if (bytes > tolerance.maxBytes) return { ok: false, direction: 'over' };
  return { ok: true, direction: 'ok' };
}

function toleranceLabel(tolerance, targetBytes) {
  if (!tolerance?.enabled) return '';
  const minus = tolerance.minusAny ? 'any' : `${((targetBytes - tolerance.minBytes) / 1024 / 1024).toFixed(1)} MB`;
  const plus = tolerance.plusAny ? 'any' : `${((tolerance.maxBytes - targetBytes) / 1024 / 1024).toFixed(1)} MB`;
  return `Size tolerance : -${minus} / +${plus}`;
}

function normalizeCodec(codec) {
  if (codec === 'h265' || codec === 'hevc') return 'h265';
  if (codec === 'av1') return 'av1';
  return 'h264';
}

function normalizeDevice(device, useGpu) {
  if (device === 'cpu') return 'cpu';
  if (device === 'gpu') return 'gpu';
  return useGpu === false ? 'cpu' : 'gpu';
}

function normalizeQualityBias(value) {
  if (value === 'smaller' || value === 'better') return value;
  return 'balanced';
}

function normalizeAudioMode(value, removeAudio) {
  if (value === 'keep' || value === 'remove') return value;
  if (removeAudio) return 'remove';
  return 'compress';
}

function qualityProfile(value) {
  const bias = normalizeQualityBias(value);
  if (bias === 'smaller') {
    return {
      name: 'Faster Encode',
      gpuSafety: 0.91,
      cpuSafety: 0.95,
      gpuCq: { h264: 23, h265: 25, av1: 28 },
      cpuPreset: { h264: 'veryfast', h265: 'medium', av1: '8' },
      gpuPreset: 'p4'
    };
  }
  if (bias === 'better') {
    return {
      name: 'Better Quality',
      gpuSafety: 0.97,
      cpuSafety: 0.99,
      gpuCq: { h264: 18, h265: 20, av1: 22 },
      cpuPreset: { h264: 'slow', h265: 'slow', av1: '6' },
      gpuPreset: 'p5'
    };
  }
  return {
    name: 'Balanced',
    gpuSafety: 0.94,
    cpuSafety: 0.98,
    gpuCq: { h264: 20, h265: 22, av1: 24 },
    cpuPreset: { h264: 'medium', h265: 'medium', av1: '7' },
    gpuPreset: 'p4'
  };
}

function codecLabel(codec) {
  return ({ h264: 'H.264', h265: 'H.265', av1: 'AV1' })[codec] || 'H.264';
}

function gpuEncoder(codec) {
  return ({ h264: 'h264_nvenc', h265: 'hevc_nvenc', av1: 'av1_nvenc' })[codec] || 'h264_nvenc';
}

// Empirical minimum bitrate the hardware encoder will actually honor at a
// given width (measured on this machine: av1_nvenc floors near ~640 kbps at
// 1080p on complex content, h264 ~485 kbps; both scale roughly with pixel
// count). Below these, -b:v is silently ignored and every retry overshoots.
function estimateEncoderFloor(codec, width) {
  const floorAt1080 = codec === 'av1' ? 640 : codec === 'h265' ? 400 : 485;
  const pixelRatio = Math.max(0.25, (width * width) / (1920 * 1920));
  return Math.round(floorAt1080 * pixelRatio);
}

// AV1 CPU encoder: libsvtav1 when the bundled ffmpeg has it (fast, the
// intended path), libaom-av1 as a fallback (works everywhere but is much
// slower). Probed once and cached.
let AV1_CPU_ENCODER = null;

function getAv1CpuEncoder() {
  if (AV1_CPU_ENCODER) return AV1_CPU_ENCODER;
  const probe = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], {
    encoding: 'utf8', windowsHide: true, timeout: 10000
  });
  const list = probe.stdout || '';
  AV1_CPU_ENCODER = list.includes('libsvtav1') ? 'libsvtav1' : 'libaom-av1';
  return AV1_CPU_ENCODER;
}

function cpuEncoder(codec) {
  if (codec === 'av1') return getAv1CpuEncoder();
  return ({ h264: 'libx264', h265: 'libx265' })[codec] || 'libx264';
}

function gpuArgsForCodec(codec, vbr, profile) {
  // Preset comes from the quality bias: p4 is NVENC's default and much
  // faster; p5 only pays off when quality matters and the bitrate budget
  // is not the binding constraint anyway.
  const preset = profile?.gpuPreset || 'p4';
  const common = ['-preset', preset, '-b:v', `${vbr}k`, '-maxrate', `${vbr}k`, '-bufsize', `${Math.floor(vbr * 1.25)}k`];
  if (codec === 'h264') return [...common, '-tune', 'hq', '-rc', 'vbr', '-multipass', 'fullres', '-profile:v', 'high', '-tag:v', 'avc1'];
  if (codec === 'h265') return [...common, '-tune', 'hq', '-rc', 'vbr', '-multipass', 'fullres', '-tag:v', 'hvc1'];
  // AV1: VBR (not CBR) — a CBR budget poisoned by damaged frames at the
  // start of the source drags quality down for everything that follows;
  // VBR recovers immediately after the damaged section.
  return [...common, '-rc', 'vbr', '-multipass', 'qres'];
}

function cpuArgsForCodec(codec, vbr, passLog, pass, profile) {
  const rateLimit = ['-b:v', `${vbr}k`, '-maxrate', `${vbr}k`, '-bufsize', `${Math.floor(vbr * 1.25)}k`];
  if (codec === 'h264') {
    return ['-c:v', 'libx264', ...rateLimit, '-pass', String(pass), '-passlogfile', passLog, '-preset', profile.cpuPreset.h264, '-profile:v', 'high', '-tag:v', 'avc1'];
  }
  if (codec === 'h265') {
    return [
      '-c:v', 'libx265', ...rateLimit, '-preset', profile.cpuPreset.h265,
      '-pass', String(pass), '-passlogfile', passLog,
      '-tag:v', 'hvc1'
    ];
  }
  if (getAv1CpuEncoder() === 'libsvtav1') {
    // SVT-AV1 >= 4.x rejects -maxrate/-bufsize alongside -b:v ("Max Bitrate
    // only supported with CRF mode") — target size is enforced by -b:v
    // plus 2-pass anyway, so rate limits are simply omitted here.
    return [
      '-c:v', 'libsvtav1', '-b:v', `${vbr}k`, '-preset', profile.cpuPreset.av1,
      '-pass', String(pass), '-passlogfile', passLog
    ];
  }
  // libaom-av1 fallback: no -preset (uses -cpu-used), no -tag:v.
  // cpu-used 8 = fastest, 0 = slowest; mapped from quality bias.
  const cpuUsed = profile.cpuPreset.av1 === '6' ? '4' : profile.cpuPreset.av1 === '8' ? '6' : '5';
  return [
    '-c:v', 'libaom-av1', '-b:v', `${vbr}k`, '-cpu-used', cpuUsed, '-row-mt', '1',
    '-threads', '0', '-pass', String(pass), '-passlogfile', passLog
  ];
}

function audioOutputArgs(abr, audioMode, selectedAudioTracks = []) {
  if (audioMode === 'remove' || !selectedAudioTracks.length) return ['-an'];
  const maps = selectedAudioTracks.flatMap((index) => ['-map', `0:a:${index}?`]);
  if (audioMode === 'keep') return [...maps, '-c:a', 'copy'];
  return [...maps, '-c:a', 'aac', '-b:a', `${abr}k`];
}

function audioOnlyOutputArgs(abr, selectedAudioTracks = []) {
  if (!selectedAudioTracks.length) throw new Error('No audio tracks selected for audio-only export.');
  const bitrate = Math.max(Number(abr) || 128, 32);
  if (selectedAudioTracks.length === 1) {
    return ['-map', `0:a:${selectedAudioTracks[0]}?`, '-vn', '-sn', '-dn', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, '-ac', '2'];
  }
  const inputs = selectedAudioTracks.map((index) => `[0:a:${index}]`).join('');
  return [
    '-filter_complex', `${inputs}amix=inputs=${selectedAudioTracks.length}:duration=longest:normalize=0[aout]`,
    '-map', '[aout]',
    '-vn', '-sn', '-dn',
    '-c:a', 'libmp3lame',
    '-b:a', `${bitrate}k`,
    '-ac', '2'
  ];
}

// Input flags that let ffmpeg survive damaged sources (DVR recordings with
// broken GOPs are common): tolerate a high decode error rate, keep going
// on corrupt packets, regenerate timestamps. Without these, ffmpeg aborts
// when the decode error rate crosses 2/3 ("Decode error rate ... exceeds
// maximum 0.666667").
function resilientInputArgs() {
  return ['-err_detect', 'ignore_err', '-max_error_rate', '1.0', '-fflags', '+genpts+discardcorrupt'];
}

function clipInputArgs(input, clipStart, clipDuration) {
  const args = ['-y', ...resilientInputArgs()];
  const preSeek = clipStart > 0 ? Math.max(0, clipStart - 1.5) : 0;
  const fineSeek = clipStart > 0 ? clipStart - preSeek : 0;
  if (preSeek > 0) args.push('-ss', String(preSeek));
  args.push('-i', input);
  if (fineSeek > 0) args.push('-ss', String(fineSeek));
  if (clipDuration > 0) args.push('-t', String(clipDuration));
  return args;
}

function expectedOutputOrientation(mediaInfo, resolution, keepOriginalResolution) {
  const sourceSize = parseVideoDimensionsFromText(mediaInfo);
  if (keepOriginalResolution || resolution === 'original' || !sourceSize) return sourceSize;
  const [w, h] = String(resolution || '').split('x').map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return sourceSize;
  const sourceIsLandscape = sourceSize.width >= sourceSize.height;
  return {
    width: sourceIsLandscape ? Math.max(w, h) : Math.min(w, h),
    height: sourceIsLandscape ? Math.min(w, h) : Math.max(w, h)
  };
}

function validateOutputVideo(output, expectedSize) {
  const info = getMediaInfoText(output);
  const actual = parseVideoDimensionsFromText(info);
  if (!actual) throw new Error('Output video stream is missing or unreadable.');
  if (!expectedSize) return;
  const expectedLandscape = expectedSize.width >= expectedSize.height;
  const actualLandscape = actual.width >= actual.height;
  if (expectedLandscape !== actualLandscape) {
    throw new Error(`Invalid output resolution: ${actual.width}x${actual.height}. Expected ${expectedSize.width}x${expectedSize.height} orientation.`);
  }
}

function cleanVideoOutputMetadataArgs() {
  return [
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-metadata:s:v:0', 'rotate=0'
  ];
}

function cleanupOutputArtifacts(output, passLog) {
  if (output && fs.existsSync(output)) {
    try {
      fs.unlinkSync(output);
    } catch {}
  }
  if (passLog) cleanupPassLogs(passLog);
}

// Builds the full GPU encode pipeline. `gpuPipeline` selects decode/scale
// placement: 'hw' runs NVDEC + scale_cuda on the GPU (no CPU frame copies);
// 'sw' is the legacy CPU decode + CPU scale path, used as fallback when the
// hw pipeline fails to start (unsupported codec, no CUDA device, etc).
function gpuEncodeArgs(gpuPipeline, input, output, vbr, abr, vf, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks) {
  const encoder = gpuEncoder(codec);
  let inputArgs;
  let filter;
  if (gpuPipeline === 'hw') {
    // clipInputArgs places -ss before -i (fast seek); hwaccel flags must sit
    // next to the input so they apply to that exact -i.
    // '-y' first: GPU bitrate corrections re-encode to the SAME output path,
    // and without it ffmpeg asks "Overwrite? [y/N]" interactively — which in
    // a spawned process reads EOF and aborts, falsely looking like a pipeline
    // failure and triggering the slow CPU-decode fallback.
    inputArgs = ['-y', ...resilientInputArgs()];
    const preSeek = clipStart > 0 ? Math.max(0, clipStart - 1.5) : 0;
    if (preSeek > 0) inputArgs.push('-ss', String(preSeek));
    inputArgs.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda');
    inputArgs.push('-i', input);
    const fineSeek = clipStart > 0 ? clipStart - preSeek : 0;
    if (fineSeek > 0) inputArgs.push('-ss', String(fineSeek));
    if (clipDuration > 0) inputArgs.push('-t', String(clipDuration));

    // Translate the CPU scale/fps filter to its CUDA equivalent. The fps part
    // needs a CPU frame (CUDA fps filter does not exist), so scale on GPU,
    // download, then fps on CPU — the expensive resize stays on the GPU.
    // With no scale part (Keep Original) we still must hwdownload before fps.
    const fpsPart = vf.split(',').find((part) => part.startsWith('fps='));
    const scalePart = vf.split(',').find((part) => part.startsWith('scale='));
    if (scalePart) {
      filter = `${scalePart.replace(/^scale=/, 'scale_cuda=')},hwdownload,format=nv12${fpsPart ? `,${fpsPart}` : ''}`;
    } else {
      filter = fpsPart ? `hwdownload,format=nv12,${fpsPart}` : 'null';
    }
  } else {
    inputArgs = clipInputArgs(input, clipStart, clipDuration);
    filter = vf;
  }

  const args = [
    ...inputArgs,
    '-map', '0:v:0', '-sn', '-dn',
    '-vf', filter,
    '-c:v', encoder,
    ...gpuArgsForCodec(codec, vbr, profile),
    ...cleanVideoOutputMetadataArgs(),
    '-movflags', '+faststart',
    ...audioOutputArgs(abr, audioMode, selectedAudioTracks),
    output
  ];
  return args;
}

// Encodes a short probe segment (mid-file) at the planned bitrate and returns
// the measured overshoot/undershoot ratio, so the first full encode can start
// with a corrected bitrate instead of relying on retry loops. Runs in the
// normal output dir; ~seconds of work, cleaned up afterwards.
async function probeGpuBitrate(input, vbr, vf, codec, profile, duration) {
  // The probe pays off only when it is a small fraction of a full encode:
  // it costs ~probeSecs of encoding to potentially save one FULL re-encode.
  // On clips under ~60s the math is negative — a retry of a 10s clip costs
  // the same as the probe itself — so skip probing short content entirely.
  if (!duration || duration < 60) return null;
  const probeSecs = Math.min(15, Math.floor(duration * 0.1));
  if (probeSecs < 5) return null;
  const probeStart = Math.max(0, Math.floor((duration - probeSecs) / 2));
  const probeOutput = path.join(app.getPath('temp'), `vcompress-gpu-probe-${process.pid}.mp4`);
  const args = [
    '-y', '-hide_banner', '-loglevel', 'fatal',
    ...resilientInputArgs(),
    '-ss', String(probeStart),
    '-i', input,
    '-t', String(probeSecs),
    '-map', '0:v:0', '-sn', '-dn',
    '-vf', vf,
    '-c:v', gpuEncoder(codec),
    ...gpuArgsForCodec(codec, vbr, profile),
    '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    probeOutput
  ];
  try {
    if (fs.existsSync(probeOutput)) fs.unlinkSync(probeOutput);
    const started = Date.now();
    await new Promise((resolve, reject) => {
      const child = spawn(FFMPEG, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.slice(-800) || `FFmpeg exited with code ${code}`));
      });
    });
    const probeBytes = fs.existsSync(probeOutput) ? fs.statSync(probeOutput).size : 0;
    if (probeBytes <= 0) return null;
    // Estimated full size if the whole video encoded at this density,
    // minus the audio portion the probe didn't include.
    const plannedBytes = (vbr * 1000 / 8) * probeSecs;
    if (plannedBytes <= 0) return null;
    const ratio = probeBytes / plannedBytes;
    sendLog(`GPU probe: ${probeSecs}s encoded at ${(probeBytes / 1024 / 1024).toFixed(3)} MB in ${((Date.now() - started) / 1000).toFixed(1)}s (rate ratio ${ratio.toFixed(3)})`);
    return Number.isFinite(ratio) && ratio > 0.1 && ratio < 10 ? ratio : null;
  } catch (error) {
    sendLog(`GPU probe skipped: ${error.message.slice(0, 200)}`);
    return null;
  } finally {
    try {
      if (fs.existsSync(probeOutput)) fs.unlinkSync(probeOutput);
    } catch {}
  }
}

async function encodeGpu(input, output, vbr, abr, vf, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks, progressContext = null) {
  const encoder = gpuEncoder(codec);
  const durationForProgress = progressContext || {
    fromPercent: 10,
    toPercent: 70,
    duration: Math.max(1, clipDuration || 0),
    label: 'Encoding (GPU)'
  };

  // Fast path restored: hw pipeline (NVDEC + NVENC) first, CPU decode as
  // fallback. Damaged-source handling is a log warning only — no extra
  // decode passes, no pipeline steering (the pre-damage-handling behavior).
  const pipelines = ['hw', 'sw'];
  for (const pipeline of pipelines) {
    const args = gpuEncodeArgs(pipeline, input, output, vbr, abr, vf, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks);
    if (pipeline === 'hw') {
      sendLog(`GPU mode (${encoder}, ${codecLabel(codec)}, NVDEC + NVENC pipeline)...`);
    } else {
      sendLog(`GPU mode (${encoder}, ${codecLabel(codec)}, CPU decode fallback)...`);
    }
    try {
      await runFFmpeg(args, null, durationForProgress);
      return true;
    } catch (error) {
      if (error.message === 'Cancelled') throw error;
      if (pipeline === 'hw') {
        sendLog('WARNING: hardware pipeline failed, retrying with CPU decode:');
        sendLog(error.message);
        continue;
      }
      sendLog(`WARNING: ${encoder} failed - actual ffmpeg error:`);
      sendLog(error.message);
      return false;
    }
  }
  return false;
}

async function encodeCpu2Pass(input, output, vbr, abr, vf, passLog, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks, progressDuration = 0) {
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const encoder = cpuEncoder(codec);
  sendLog('Pass 1/2: Analysis...');
  await runFFmpeg([
    ...clipInputArgs(input, clipStart, clipDuration), '-vf', vf,
    '-map', '0:v:0', '-sn', '-dn',
    ...cpuArgsForCodec(codec, vbr, passLog, 1, profile),
    '-an', '-f', 'null', nul
  ], null, progressDuration ? { fromPercent: 5, toPercent: 50, duration: progressDuration, label: 'Pass 1/2 analysis' } : null);

  sendLog(`Pass 2/2: Encoding (${encoder}, ${codecLabel(codec)})...`);
  await runFFmpeg([
    ...clipInputArgs(input, clipStart, clipDuration), '-vf', vf,
    '-map', '0:v:0', '-sn', '-dn',
    ...cpuArgsForCodec(codec, vbr, passLog, 2, profile),
    '-pix_fmt', 'yuv420p',
    ...cleanVideoOutputMetadataArgs(),
    '-movflags', '+faststart',
    ...audioOutputArgs(abr, audioMode, selectedAudioTracks),
    output
  ], null, progressDuration ? { fromPercent: 50, toPercent: 70, duration: progressDuration, label: 'Pass 2/2 encode' } : null);
}

async function encodeAudioOnly(input, output, abr, clipStart, clipDuration, selectedAudioTracks) {
  sendLog('Audio-only export (MP3)...');
  await runFFmpeg([
    ...clipInputArgs(input, clipStart, clipDuration),
    ...audioOnlyOutputArgs(abr, selectedAudioTracks),
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    output
  ]);
}

function cleanupPassLogs(passLog) {
  const dir = path.dirname(passLog);
  const prefix = path.basename(passLog);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(prefix)) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {}
    }
  }
}

async function finishOutput(output, targetBytes, usePadding, expectedSize, tolerance = null) {
  validateOutputVideo(output, expectedSize);
  let finalBytes = fs.statSync(output).size;
  if (usePadding && finalBytes < targetBytes) finalBytes = padFileToSize(output, targetBytes);
  const fit = outputFitStatus(finalBytes, targetBytes, tolerance);
  if (!fit.ok) {
    const limitText = fit.direction === 'under'
      ? `${finalBytes} bytes < ${tolerance.minBytes} bytes`
      : `${finalBytes} bytes > ${Number.isFinite(tolerance?.maxBytes) ? tolerance.maxBytes : targetBytes} bytes`;
    throw new Error(`Could not fit size tolerance: ${limitText}`);
  }
  const finalMb = finalBytes / 1024 / 1024;
  const pct = (finalBytes / targetBytes) * 100;

  sendProgress(100, 'Completed successfully!');
  sendLog(`DONE: ${finalMb.toFixed(3)} MB (${finalBytes} bytes, ${pct.toFixed(2)}% of limit)`);
  return finalMb;
}

async function compress(params) {
  const input = params.input_path;
  const output = params.output_path;
  const targetMb = Number(params.target_mb);
  const abr = Number(params.audio_bitrate || 128);
  const resolution = params.resolution || '1920x1080';
  const fps = Number(params.fps || 60);
  const codec = normalizeCodec(params.video_codec);
  const device = normalizeDevice(params.encoder_device, params.use_gpu);
  const profile = qualityProfile(params.quality_bias);
  const audioMode = normalizeAudioMode(params.audio_mode, params.remove_audio);
  const keepOriginalResolution = Boolean(params.keep_original_resolution) || resolution === 'original';
  const useGpu = device === 'gpu';
  const usePadding = Boolean(params.use_padding);
  // Single probe: duration, streams, audio tracks all come from one ffmpeg
  // run (cached by path+size+mtime, so repeated compress() calls are free).
  const mediaInfo = getMediaInfoText(input);
  const fullDuration = parseDurationFromText(mediaInfo);
  const clipStart = Math.max(0, Number(params.clip_start || 0));
  const requestedClipEnd = Number(params.clip_end || 0);
  const clipEnd = requestedClipEnd > clipStart ? Math.min(requestedClipEnd, fullDuration || requestedClipEnd) : 0;
  const clipDuration = clipEnd > clipStart ? clipEnd - clipStart : 0;
  const sourceHasVideo = hasVideoStream(mediaInfo);
  // Cheap damaged-source detection: reuse the metadata probe we already ran
  // (zero extra cost). A DVR-glitched file shows decode warnings right in the
  // probe output. This only drives a log warning now — the encode path itself
  // stays identical to the fast pre-damage-handling logic.
  const damagedSource = sourceHasVideo && hasDecodeWarnings(mediaInfo);
  const exportAudioOnly = Boolean(params.export_audio_only) || !sourceHasVideo;
  const audioTracks = parseAudioTracksFromText(mediaInfo);
  const selectedAudioTracks = audioMode === 'remove' && !exportAudioOnly
    ? []
    : normalizeSelectedAudioTracks(params.selected_audio_tracks, audioTracks);
  const renderAudioMode = exportAudioOnly ? 'compress' : audioMode;
  const bitrateAudioKbps = selectedAudioBitrateKbps(renderAudioMode, abr, selectedAudioTracks, audioTracks);
  const selectedAudioLabel = selectedAudioTracks.length
    ? `${selectedAudioTracks.length}/${audioTracks.length || selectedAudioTracks.length} track${selectedAudioTracks.length === 1 ? '' : 's'}`
    : 'none';

  sendLog('Detecting video duration...');
  const duration = clipDuration || fullDuration;
  if (!duration) throw new Error('Could not detect video duration.');

  // Damaged source: warn in the log but encode normally. The heavy auto-recovery
  // (clean-point scanning, NVDEC skipping) slowed every compression by seconds
  // of extra passes — removed. A damaged recording is the user's call: trim it
  // in the Clip tab, or let it encode and see the damage preserved as-is.
  if (damagedSource) {
    sendLog('WARNING: this source may be corrupted (recording glitches detected in decode).', 'warning');
    sendLog('         Output may contain artifacts from the damaged section.', 'warning');
    sendLog('         Tip: trim the damaged part in the Clip tab before compressing.', 'warning');
  }

  const targetBytes = Math.floor(targetMb * 1024 * 1024);
  const tolerance = normalizeTolerance(params, targetBytes);
  const expectedOutputSize = expectedOutputOrientation(mediaInfo, resolution, keepOriginalResolution);
  const vf = makeVf(resolution, fps, keepOriginalResolution, mediaInfo);
  const parsed = path.parse(output);
  const passLog = path.join(parsed.dir, `${parsed.name}_2pass`);
  currentOutputPath = output;
  currentPassLog = passLog;

  if (exportAudioOnly) {
    if (!audioTracks.length) throw new Error('No audio stream found.');
    sendLog(`Duration        : ${duration.toFixed(1)} sec${clipDuration ? ` (clip ${formatSeconds(clipStart)}-${formatSeconds(clipEnd)})` : ''}`);
    sendLog(`Export          : Audio Only (MP3)`);
    sendLog(`Audio bitrate   : ${abr} kbps (${selectedAudioLabel})`);
    sendLog('--------------------------------------------------');
    sendProgress(15, 'Exporting audio...');
    await encodeAudioOnly(input, output, abr, clipStart, clipDuration, selectedAudioTracks);
    const finalBytes = fs.statSync(output).size;
    const finalMb = finalBytes / 1024 / 1024;
    sendProgress(100, 'Completed successfully!');
    sendLog(`DONE: ${finalMb.toFixed(3)} MB (${finalBytes} bytes)`);
    return finalMb;
  }

  if (useGpu) {
    let vbr = calcBitrate(targetMb, duration, bitrateAudioKbps, profile.gpuSafety);
    sendLog(`Resolution      : ${keepOriginalResolution ? 'original' : resolution}`);
    sendLog(`Duration        : ${duration.toFixed(1)} sec${clipDuration ? ` (clip ${formatSeconds(clipStart)}-${formatSeconds(clipEnd)})` : ''}`);
    sendLog(`Target size     : ${targetMb} MB (${targetBytes} bytes max)`);
    const toleranceText = toleranceLabel(tolerance, targetBytes);
    if (toleranceText) sendLog(toleranceText);
    sendLog(`Encoder         : GPU ${codecLabel(codec)} (${gpuEncoder(codec)})`);
    sendLog(`Quality bias    : ${profile.name}`);
    sendLog(`Video bitrate   : ${vbr} kbps`);
    if (audioMode === 'remove') {
      sendLog('Audio           : removed');
    } else if (audioMode === 'keep') {
      sendLog(`Audio           : keep original (${selectedAudioLabel}${bitrateAudioKbps ? `, ${bitrateAudioKbps} kbps` : ''})`);
    } else {
      sendLog(`Audio bitrate   : ${abr} kbps (${selectedAudioLabel}, ${bitrateAudioKbps} kbps total)`);
    }
    sendLog('--------------------------------------------------');
    sendProgress(10);

    // Feasibility pre-check: hardware encoders have a practical minimum
    // bitrate (~450 kbps at 1080p, less at lower resolutions). If the target
    // demands less than that, warn BEFORE burning minutes on encodes that
    // will all overshoot. Empirical floors measured on this machine.
    const encoderFloorKbps = estimateEncoderFloor(codec, keepOriginalResolution || resolution === 'original' ? 1920 : Number(String(resolution).split('x')[0]) || 1920);
    if (vbr < encoderFloorKbps) {
      sendLog(`WARNING: target requires ${vbr} kbps, but the ${codecLabel(codec)} encoder reliably goes no lower than ~${encoderFloorKbps} kbps at this resolution.`, 'warning');
      sendLog('         The output will likely overshoot. Consider: lower resolution, larger target, or trim the video.', 'warning');
    }

    // Probe a short segment first: NVENC's single estimate is often off by
    // 5-20%, and one full retry costs far more than this seconds-long probe.
    sendProgress(8, 'Probing encoder rate accuracy...');
    const probeRatio = await probeGpuBitrate(input, vbr, vf, codec, profile, duration);
    if (cancelRequested) throw new Error('Cancelled');
    if (probeRatio && Math.abs(probeRatio - 1) > 0.05) {
      const probedVbr = Math.max(Math.floor(vbr / probeRatio), 1);
      if (probedVbr !== vbr) {
        sendLog(`  -> probe-adjusted bitrate: ${probedVbr} kbps (was ${vbr})`);
        vbr = probedVbr;
      }
    }
    sendProgress(10, 'Encoding (GPU)...');

    const gpuProgress = { fromPercent: 10, toPercent: 70, duration, label: 'Encoding (GPU)' };
    let ok = await encodeGpu(input, output, vbr, abr, vf, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks, gpuProgress);
    if (!ok) throw new Error(`GPU ${codecLabel(codec)} encoding failed. Try another codec or CPU mode.`);

    const maxGpuCorrections = 10;
    let previousBytes = 0;
    let stalledGpuCorrections = 0;

    for (let iteration = 0; iteration <= maxGpuCorrections; iteration++) {
      const curBytes = fs.statSync(output).size;
      const curMb = curBytes / 1024 / 1024;
      const pct = (curBytes / targetBytes) * 100;
      const label = iteration === 0 ? 'After GPU encoding' : `GPU correction ${iteration}`;
      sendLog(`${label}: ${curMb.toFixed(3)} MB (${curBytes} bytes, ${pct.toFixed(2)}% of limit)`);
      const fit = outputFitStatus(curBytes, targetBytes, tolerance);

      if (fit.ok) {
        return finishOutput(output, targetBytes, usePadding, expectedOutputSize, tolerance);
      }

      if (iteration === maxGpuCorrections) break;

      // Encoder-floor detector: hardware encoders (especially av1_nvenc)
      // have a MINIMUM quality floor (~500+ kbps at 1080p on complex
      // content) — below it they simply ignore -b:v. Symptom: bitrate was
      // cut drastically but the output did not shrink (or even grew).
      // Retrying further is wasted GPU time; stop with an actionable hint.
      if (previousBytes > 0 && fit.direction === 'over' && curBytes > previousBytes * 0.95) {
        const actualKbps = Math.round(curBytes * 8 / 1000 / Math.max(1, duration));
        throw new Error(
          `The ${codecLabel(codec)} encoder cannot go low enough for this target: even at ${vbr} kbps it produced ${actualKbps} kbps. ` +
          `${targetMb} MB for ${formatSeconds(duration)} at ${keepOriginalResolution ? 'source resolution' : resolution} is below the encoder's floor. ` +
          'Fix: lower the resolution (e.g. 1280x720), raise the target size, or cut the video in the Clip tab.'
        );
      }

      const improvement = previousBytes > 0 ? (previousBytes - curBytes) / previousBytes : 1;
      if (fit.direction === 'under') stalledGpuCorrections = 0;
      else if (previousBytes > 0 && improvement < 0.005) stalledGpuCorrections += 1;
      else stalledGpuCorrections = 0;
      if (fit.direction === 'over' && (stalledGpuCorrections >= 2 || vbr <= 30)) {
        break;
      }
      const safety = fit.direction === 'under' ? 1.02 : improvement > 0 && improvement < 0.01 ? 0.62 : curBytes > targetBytes * 1.15 ? 0.76 : 0.92;
      const scale = (targetBytes / curBytes) * safety;
      let nextVbr = Math.max(Math.floor(vbr * scale), 1);
      if (fit.direction === 'over' && nextVbr >= vbr) nextVbr = Math.max(vbr - 50, 1);
      if (fit.direction === 'under' && nextVbr <= vbr) nextVbr = vbr + Math.max(25, Math.floor(vbr * 0.1));
      if (fit.direction === 'over' && Math.abs(nextVbr - vbr) < 5) nextVbr = Math.max(Math.floor(vbr * 0.7), 1);
      previousBytes = curBytes;
      vbr = nextVbr;
      sendLog(`  -> GPU retry bitrate: ${vbr} kbps`);
      ok = await encodeGpu(input, output, vbr, abr, vf, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks, gpuProgress);
      if (!ok) throw new Error(`GPU ${codecLabel(codec)} correction failed. Try another codec or CPU mode.`);
      sendProgress(Math.min(95, 70 + (iteration + 1) * 10));
    }

    const finalBytes = fs.statSync(output).size;
    throw new Error(`GPU could not get under target size: ${finalBytes} bytes > ${targetBytes} bytes`);
  }

  let vbr = calcBitrate(targetMb, duration, bitrateAudioKbps, profile.cpuSafety);
  sendLog(`Resolution      : ${keepOriginalResolution ? 'original' : resolution}`);
  sendLog(`Duration        : ${duration.toFixed(1)} sec${clipDuration ? ` (clip ${formatSeconds(clipStart)}-${formatSeconds(clipEnd)})` : ''}`);
  sendLog(`Target size     : ${targetMb} MB (${targetBytes} bytes max)`);
  const toleranceText = toleranceLabel(tolerance, targetBytes);
  if (toleranceText) sendLog(toleranceText);
  sendLog(`Encoder         : CPU ${codecLabel(codec)} (${cpuEncoder(codec)})`);
  sendLog(`Quality bias    : ${profile.name}`);
  sendLog(`Video bitrate   : ${vbr} kbps`);
  if (audioMode === 'remove') {
    sendLog('Audio           : removed');
  } else if (audioMode === 'keep') {
    sendLog(`Audio           : keep original (${selectedAudioLabel}${bitrateAudioKbps ? `, ${bitrateAudioKbps} kbps` : ''})`);
  } else {
    sendLog(`Audio bitrate   : ${abr} kbps (${selectedAudioLabel}, ${bitrateAudioKbps} kbps total)`);
  }
  sendLog('--------------------------------------------------');

  sendProgress(5, 'Pass 1/2 analysis...');
  await encodeCpu2Pass(input, output, vbr, abr, vf, passLog, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks, duration);
  sendProgress(70);

  const maxCpuCorrections = 6;
  let previousCpuBytes = 0;

  for (let iteration = 0; iteration <= maxCpuCorrections; iteration++) {
    const curBytes = fs.statSync(output).size;
    const curMb = curBytes / 1024 / 1024;
    const pct = (curBytes / targetBytes) * 100;
    const label = iteration === 0 ? 'After CPU encoding' : `CPU correction ${iteration}`;
    sendLog(`${label}: ${curMb.toFixed(3)} MB (${curBytes} bytes, ${pct.toFixed(2)}% of limit)`);
    const fit = outputFitStatus(curBytes, targetBytes, tolerance);

    if (fit.ok) {
      cleanupPassLogs(passLog);
      return finishOutput(output, targetBytes, usePadding, expectedOutputSize, tolerance);
    }

    if (iteration === maxCpuCorrections) break;
    const improvement = previousCpuBytes > 0 ? (previousCpuBytes - curBytes) / previousCpuBytes : 1;
    const safety = fit.direction === 'under' ? 1.02 : improvement > 0 && improvement < 0.01 ? 0.55 : curBytes > targetBytes * 1.15 ? 0.68 : 0.9;
    const scale = (targetBytes / curBytes) * safety;
    const nextVbr = Math.max(Math.floor(vbr * scale), 1);
    vbr = fit.direction === 'under' && nextVbr <= vbr ? vbr + Math.max(25, Math.floor(vbr * 0.1)) : nextVbr;
    previousCpuBytes = curBytes;
    sendLog(`  -> CPU retry bitrate: ${vbr} kbps`);
    await encodeCpu2Pass(input, output, vbr, abr, vf, passLog, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks, duration);
    sendProgress(Math.min(95, 70 + (iteration + 1) * 10));
  }

  cleanupPassLogs(passLog);
  const finalBytes = fs.statSync(output).size;
  throw new Error(`Could not get under target size: ${finalBytes} bytes > ${targetBytes} bytes`);
}

function outputPathFor(inputPath) {
  const settings = loadSettings();
  const parsed = path.parse(inputPath);
  const outputDir = settings.last_out_dir || parsed.dir;
  const ext = audioExtensions.has(parsed.ext.toLowerCase()) ? 'mp3' : 'mp4';
  return path.join(outputDir, `${parsed.name}_compressed.${ext}`);
}

// Preview frame/segment/proxy caches live in %TEMP% and grow unbounded.
// Sweep anything older than 7 days at startup — cheap on a few hundred files,
// and never touches a cache written in the current session.
function cleanupPreviewCaches() {
  const cacheDirs = ['vcompress-preview-frames', 'vcompress-preview-cache', 'vcompress-preview-segments'];
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  for (const dirName of cacheDirs) {
    const dir = path.join(app.getPath('temp'), dirName);
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (stat.isFile() && Date.now() - stat.mtimeMs > maxAgeMs) fs.unlinkSync(full);
      } catch {}
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1052,
    height: 569,
    minWidth: 900,
    minHeight: 560,
    resizable: true,
    // Fully native Windows frame: the system title bar with its own
    // transparency (follows the wallpaper / DWM theme), the exe icon and
    // standard caption buttons. Our custom bar markup in the page is hidden
    // via CSS when the native frame is active.
    frame: true,
    title: 'VCompress',
    backgroundColor: '#0E1014',
    // Window + taskbar icon: the exe-embedded icon (set by electron-builder)
    // only shows in Explorer; the window itself needs an explicit icon, and
    // Windows uses the window class icon for the taskbar entry.
    icon: path.join(appDir, 'build', 'icon.ico'),
    show: false,
    webPreferences: {
      preload: path.join(appDir, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(appDir, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.webContents.send('ffmpeg-status', ffmpegStatus());
    if (pendingOpenFile) {
      mainWindow.webContents.send('open-file', pendingOpenFile);
    }
    if (NVENC_AVAILABLE === null) {
      const status = ffmpegStatus();
      if (!status.found) {
        // No usable ffmpeg: the probe would fail with ENOENT and get reported
        // as "no NVENC", which is wrong. Leave it unknown until ffmpeg exists.
        sendLog('NVENC probe skipped: FFmpeg not found.', 'warning');
      } else {
        probeNvencSupport().then((available) => {
          NVENC_AVAILABLE = available;
          mainWindow?.webContents.send('ffmpeg-status', ffmpegStatus());
          if (!available) {
            sendLog('GPU encoder (NVENC) not available - CPU mode will be used.', 'warning');
          }
        });
      }
    }
  });
}

ipcMain.handle('get-ffmpeg-status', () => ffmpegStatus());
ipcMain.handle('get-nvenc-status', () => NVENC_AVAILABLE);
ipcMain.handle('get-startup-file', () => pendingOpenFile);

ipcMain.handle('load-file', async (_event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
    const stat = fs.statSync(filePath);
    const parsed = path.parse(filePath);
    // Async probe: a sync ffmpeg spawn would freeze window drag and every
    // other IPC handler for up to ~1s on big files.
    const mediaInfo = await getMediaInfoTextAsync(filePath);
    const duration = parseDurationFromText(mediaInfo);
    const audioTracks = parseAudioTracksFromText(mediaInfo);
    const hasVideo = hasVideoStream(mediaInfo);
    return {
      success: true,
      path: path.resolve(filePath),
      name: parsed.base,
      size_bytes: stat.size,
      size_mb: stat.size / 1024 / 1024,
      duration,
      fps: parseVideoFpsFromText(mediaInfo),
      has_video: hasVideo,
      is_audio_only: !hasVideo && audioTracks.length > 0,
      audio_tracks: audioTracks,
      needs_preview_proxy: hasVideo && shouldUsePreviewProxy(mediaInfo),
      output_path: outputPathFor(filePath)
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('prepare-preview-proxy', async (_event, filePath) => createPreviewProxy(filePath));
ipcMain.handle('prepare-preview-segment', async (_event, filePath, start, duration) => createPreviewSegment(filePath, start, duration));
ipcMain.handle('cancel-preview-proxy', () => cancelPreviewProxy());
ipcMain.handle('get-preview-frame', async (_event, filePath, time) => createPreviewFrame(filePath, time));

ipcMain.handle('browse-input-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Media Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', 'mp3', 'wav', 'ogg', 'opus', 'flac', 'aac', 'm4a', 'wma'] },
      { name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'opus', 'flac', 'aac', 'm4a', 'wma'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return { path: result.canceled ? null : result.filePaths[0] };
});

// One active compression job at a time. Job lifecycle built on a
// generation counter, which fixes the "cancel half-works" race:
// - compress-video bumps the generation and clears the cancel flag — a job
//   can only be cancelled by a cancel that arrives AFTER its start.
// - cancel-compression bumps the generation too and kills the child: a
//   compress-video still in flight (already past the lock check) will see
//   a newer generation when it finally runs and reject itself immediately
//   instead of starting an ffmpeg nobody wants anymore.
// - finish releases the lock in finally; a cancel-then-start race is
//   impossible: the new start either gets a clean lock or a rejection.
let compressionJobActive = false;
let compressionGeneration = 0;

ipcMain.handle('compress-video', async (_event, params) => {
  if (compressionJobActive) return { success: false, error: 'Already processing' };
  compressionJobActive = true;
  const myGeneration = ++compressionGeneration;
  cancelRequested = false;
  const started = Date.now();
  try {
    // A cancel landed between the UI's start and this handler's turn —
    // the generation moved past ours, so this job is dead on arrival.
    if (myGeneration !== compressionGeneration) {
      throw new Error('Cancelled');
    }
    const finalSize = await compress(params);
    playCompleteSound();
    return {
      success: true,
      output_path: params.output_path,
      final_size_mb: finalSize,
      elapsed_time: (Date.now() - started) / 1000
    };
  } catch (error) {
    cleanupOutputArtifacts(params.output_path, currentPassLog);
    return { success: false, error: error.message };
  } finally {
    cancelRequested = false;
    currentProcess = null;
    currentOutputPath = null;
    currentPassLog = null;
    compressionJobActive = false;
  }
});

ipcMain.handle('cancel-compression', () => {
  // Bump the generation so any compress-video that already passed the
  // lock check but hasn't spawned yet rejects itself as cancelled.
  compressionGeneration++;
  cancelRequested = true;
  if (currentProcess) {
    // Kill the whole process TREE hard: ffmpeg may have spawned helper
    // processes, and a soft SIGTERM lets it flush buffers for seconds —
    // that was the 2-3s cancel delay. taskkill /T /F kills the tree now.
    try {
      spawn('taskkill', ['/PID', String(currentProcess.pid), '/T', '/F'], { windowsHide: true });
    } catch {}
    try { currentProcess.kill('SIGKILL'); } catch {}
  }
  // Defer artifact cleanup: the output file may still be held open by the
  // dying ffmpeg for a moment — deleting it synchronously here would fail
  // on Windows (file locked) and stall the cancel. The compress-video
  // handler's catch-block runs cleanup again once the process is gone.
  const out = currentOutputPath;
  const log = currentPassLog;
  if (out || log) {
    setTimeout(() => cleanupOutputArtifacts(out, log), 500);
  }
  return { success: true };
});

ipcMain.handle('play-error-sound', () => {
  playErrorSound();
  return { success: true };
});

ipcMain.handle('browse-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return { path: result.canceled ? null : result.filePaths[0] };
});

ipcMain.handle('show-in-folder', (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'File not found' };
  shell.showItemInFolder(filePath);
  return { success: true };
});

ipcMain.handle('load-settings', () => loadSettings());
ipcMain.handle('path-exists', (_event, targetPath) => {
  try {
    return typeof targetPath === 'string' && fs.existsSync(targetPath);
  } catch {
    return false;
  }
});
// Returns a non-colliding output path: name.mp4 -> name (1).mp4 -> name (2).mp4...
// so re-compressing the same source in one session never silently overwrites
// the previous result (which users expect, since Windows Explorer behaves
// this way when copying files).
ipcMain.handle('reserve-output-path', async (_event, targetPath) => {
  if (typeof targetPath !== 'string' || !targetPath) return targetPath;
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  for (let counter = 1; counter < 1000; counter++) {
    try {
      if (!fs.existsSync(candidate)) return candidate;
    } catch {
      return candidate;
    }
    candidate = path.join(parsed.dir, `${parsed.name} (${counter})${parsed.ext}`);
  }
  return candidate;
});
ipcMain.handle('save-settings', (_event, settings) => saveSettings(settings));

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = getOpenFileArg(argv);
    if (filePath) {
      pendingOpenFile = filePath;
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('open-file', filePath);
      }
    }
  });

  app.whenReady().then(() => {
    // Remove the default File/Edit/View/Window/Help menu bar — the app is
    // fully self-contained and the menu only wastes title bar space.
    Menu.setApplicationMenu(null);
    createWindow();
    cleanupPreviewCaches();
  });
  app.on('window-all-closed', () => app.quit());
}


