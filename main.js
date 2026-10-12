const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
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

function isMediaFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  return fs.existsSync(filePath) && mediaExtensions.has(path.extname(filePath).toLowerCase());
}

function getOpenFileArg(argv = process.argv) {
  return argv.find((arg) => isMediaFile(arg)) || null;
}

function ffmpegStatus() {
  FFMPEG = resolveFFmpeg();
  if (FFMPEG === 'ffmpeg' || fs.existsSync(FFMPEG)) {
    return { found: true, path: FFMPEG, version: 'Ready' };
  }
  return { found: false, path: FFMPEG || 'Not found', version: 'Resolved path does not exist' };
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

function runFFmpeg(args, onData) {
  return new Promise((resolve, reject) => {
    if (cancelRequested) {
      reject(new Error('Cancelled'));
      return;
    }

    let stderr = '';
    currentProcess = spawn(FFMPEG, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    currentProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onData?.(text);
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

function getMediaInfoText(filePath) {
  const result = spawnSync(FFMPEG, ['-i', filePath], {
    encoding: 'utf8',
    windowsHide: true,
    errors: 'replace'
  });
  return result.stderr || '';
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
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('Audio:')) continue;
    const streamMatch = line.match(/Stream #\d+:(\d+)(?:\[[^\]]+\])?(?:\(([^)]+)\))?:\s*Audio:\s*([^,\r\n]+)/i);
    if (!streamMatch) continue;
    const [, streamIndexText, languageText, codecText] = streamMatch;
    const streamIndex = Number(streamIndexText);
    const audioIndex = tracks.length;
    const sampleRateMatch = line.match(/,\s*(\d+)\s*Hz/i);
    const bitrateMatch = line.match(/,\s*(\d+)\s*kb\/s/i);
    const channelMatch = line.match(/,\s*([^,\r\n]*?(?:stereo|mono|5\.1|7\.1|quad|surround)[^,\r\n]*)/i);
    const titleMatch = line.match(/title\s*:\s*([^\r\n]+)/i);
    tracks.push({
      id: audioIndex,
      audio_index: audioIndex,
      stream_index: Number.isFinite(streamIndex) ? streamIndex : audioIndex + 1,
      label: titleMatch ? titleMatch[1].trim() : `Audio ${audioIndex + 1}`,
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
    .update(`frame-v2-precise|${path.resolve(filePath)}|${stat.size}|${stat.mtimeMs}|${frameTime}`)
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
    const fastSeek = Math.max(0, targetTime - 2);
    const preciseSeek = Math.max(0, targetTime - fastSeek);
    await runPreviewFrame([
      '-y',
      '-hide_banner',
      '-loglevel', 'fatal',
      '-max_error_rate', '1.0',
      '-err_detect', 'ignore_err',
      '-fflags', '+genpts+discardcorrupt',
      '-ss', String(fastSeek),
      '-i', filePath,
      '-ss', String(preciseSeek),
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
    .update(`segment-v5-long|${path.resolve(filePath)}|${stat.size}|${stat.mtimeMs}|${segmentStart}|${segmentDuration}`)
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
      name: 'Smaller Size',
      gpuSafety: 0.91,
      cpuSafety: 0.95,
      gpuCq: { h264: 23, h265: 25, av1: 28 },
      cpuPreset: { h264: 'veryfast', h265: 'medium', av1: '8' }
    };
  }
  if (bias === 'better') {
    return {
      name: 'Better Quality',
      gpuSafety: 0.97,
      cpuSafety: 0.99,
      gpuCq: { h264: 18, h265: 20, av1: 22 },
      cpuPreset: { h264: 'slow', h265: 'slow', av1: '6' }
    };
  }
  return {
    name: 'Balanced',
    gpuSafety: 0.94,
    cpuSafety: 0.98,
    gpuCq: { h264: 20, h265: 22, av1: 24 },
    cpuPreset: { h264: 'medium', h265: 'medium', av1: '7' }
  };
}

function codecLabel(codec) {
  return ({ h264: 'H.264', h265: 'H.265', av1: 'AV1' })[codec] || 'H.264';
}

function gpuEncoder(codec) {
  return ({ h264: 'h264_nvenc', h265: 'hevc_nvenc', av1: 'av1_nvenc' })[codec] || 'h264_nvenc';
}

function cpuEncoder(codec) {
  return ({ h264: 'libx264', h265: 'libx265', av1: 'libsvtav1' })[codec] || 'libx264';
}

function gpuArgsForCodec(codec, vbr, profile) {
  const common = ['-preset', 'p5', '-b:v', `${vbr}k`, '-maxrate', `${vbr}k`, '-bufsize', `${Math.floor(vbr * 1.25)}k`];
  if (codec === 'h264') return [...common, '-tune', 'hq', '-rc:v', 'vbr_hq', '-profile:v', 'high', '-tag:v', 'avc1'];
  if (codec === 'h265') return [...common, '-tune', 'hq', '-rc:v', 'vbr_hq', '-tag:v', 'hvc1'];
  return ['-preset', 'p5', '-b:v', `${vbr}k`, '-maxrate', `${vbr}k`, '-bufsize', `${Math.max(vbr, 1)}k`, '-rc:v', 'cbr', '-multipass', 'qres'];
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
  return [
    '-c:v', 'libsvtav1', '-b:v', `${vbr}k`, '-preset', profile.cpuPreset.av1,
    '-pass', String(pass), '-passlogfile', passLog
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

function clipInputArgs(input, clipStart, clipDuration) {
  const args = ['-y'];
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

async function encodeGpu(input, output, vbr, abr, vf, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks) {
  const encoder = gpuEncoder(codec);
  sendLog(`GPU mode (${encoder}, ${codecLabel(codec)})...`);
  const args = [
    ...clipInputArgs(input, clipStart, clipDuration),
    '-map', '0:v:0', '-sn', '-dn',
    '-vf', vf,
    '-c:v', encoder,
    ...gpuArgsForCodec(codec, vbr, profile),
    '-pix_fmt', 'yuv420p',
    ...cleanVideoOutputMetadataArgs(),
    '-movflags', '+faststart',
    ...audioOutputArgs(abr, audioMode, selectedAudioTracks),
    output
  ];

  try {
    await runFFmpeg(args);
    return true;
  } catch (error) {
    sendLog(`WARNING: ${encoder} failed - actual ffmpeg error:`);
    sendLog(error.message);
    return false;
  }
}

async function encodeCpu2Pass(input, output, vbr, abr, vf, passLog, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks) {
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const encoder = cpuEncoder(codec);
  sendLog('Pass 1/2: Analysis...');
  await runFFmpeg([
    ...clipInputArgs(input, clipStart, clipDuration), '-vf', vf,
    '-map', '0:v:0', '-sn', '-dn',
    ...cpuArgsForCodec(codec, vbr, passLog, 1, profile),
    '-an', '-f', 'null', nul
  ]);

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
  ]);
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

function finishOutput(output, targetBytes, usePadding, expectedSize, tolerance = null) {
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
  const fullDuration = getDuration(input);
  const clipStart = Math.max(0, Number(params.clip_start || 0));
  const requestedClipEnd = Number(params.clip_end || 0);
  const clipEnd = requestedClipEnd > clipStart ? Math.min(requestedClipEnd, fullDuration || requestedClipEnd) : 0;
  const clipDuration = clipEnd > clipStart ? clipEnd - clipStart : 0;
  const mediaInfo = getMediaInfoText(input);
  const sourceHasVideo = hasVideoStream(mediaInfo);
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

    let ok = await encodeGpu(input, output, vbr, abr, vf, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks);
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
      ok = await encodeGpu(input, output, vbr, abr, vf, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks);
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

  sendProgress(5);
  await encodeCpu2Pass(input, output, vbr, abr, vf, passLog, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks);
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
    await encodeCpu2Pass(input, output, vbr, abr, vf, passLog, codec, audioMode, profile, clipStart, clipDuration, selectedAudioTracks);
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1052,
    height: 569,
    resizable: false,
    frame: false,
    backgroundColor: '#0E1014',
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
  });
}

ipcMain.handle('get-ffmpeg-status', () => ffmpegStatus());
ipcMain.handle('get-startup-file', () => pendingOpenFile);

ipcMain.handle('load-file', (_event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
    const stat = fs.statSync(filePath);
    const parsed = path.parse(filePath);
    const mediaInfo = getMediaInfoText(filePath);
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

ipcMain.handle('compress-video', async (_event, params) => {
  if (currentProcess) return { success: false, error: 'Already processing' };
  cancelRequested = false;
  const started = Date.now();
  try {
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
  }
});

ipcMain.handle('cancel-compression', () => {
  cancelRequested = true;
  if (currentProcess) currentProcess.kill('SIGTERM');
  cleanupOutputArtifacts(currentOutputPath, currentPassLog);
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
ipcMain.handle('save-settings', (_event, settings) => saveSettings(settings));
ipcMain.handle('minimize-window', () => mainWindow?.minimize());
ipcMain.handle('maximize-window', () => ({ success: false }));
ipcMain.handle('close-window', () => mainWindow?.close());
ipcMain.handle('begin-window-drag', (_event, screenX, screenY) => {
  const [x, y] = mainWindow.getPosition();
  dragOffset = { x: Math.trunc(screenX) - x, y: Math.trunc(screenY) - y };
});
ipcMain.handle('drag-window', (_event, screenX, screenY) => {
  mainWindow.setPosition(Math.trunc(screenX) - dragOffset.x, Math.trunc(screenY) - dragOffset.y, false);
});

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

  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}


