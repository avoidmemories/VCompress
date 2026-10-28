const { ipcRenderer, webUtils } = require('electron');

const api = {
  get_ffmpeg_status: () => ipcRenderer.invoke('get-ffmpeg-status'),
  getFfmpegStatus: () => ipcRenderer.invoke('get-ffmpeg-status'),
  getFFmpegStatus: () => ipcRenderer.invoke('get-ffmpeg-status'),
  get_nvenc_status: () => ipcRenderer.invoke('get-nvenc-status'),
  get_startup_file: () => ipcRenderer.invoke('get-startup-file'),
  load_file: (filePath) => ipcRenderer.invoke('load-file', filePath),
  prepare_preview_proxy: (filePath) => ipcRenderer.invoke('prepare-preview-proxy', filePath),
  prepare_preview_segment: (filePath, start, duration) => ipcRenderer.invoke('prepare-preview-segment', filePath, start, duration),
  cancel_preview_proxy: () => ipcRenderer.invoke('cancel-preview-proxy'),
  get_preview_frame: (filePath, time) => ipcRenderer.invoke('get-preview-frame', filePath, time),
  prepare_audio_track_preview: (filePath, trackIndex) => ipcRenderer.invoke('prepare-audio-track-preview', filePath, trackIndex),
  browse_input_file: () => ipcRenderer.invoke('browse-input-file'),
  compress_video: (params) => ipcRenderer.invoke('compress-video', params),
  cancel_compression: () => ipcRenderer.invoke('cancel-compression'),
  play_error_sound: () => ipcRenderer.invoke('play-error-sound'),
  browse_output_folder: () => ipcRenderer.invoke('browse-output-folder'),
  show_in_folder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  load_settings: () => ipcRenderer.invoke('load-settings'),
  save_settings: (settings) => ipcRenderer.invoke('save-settings', settings),
  path_exists: (targetPath) => ipcRenderer.invoke('path-exists', targetPath),
  reserve_output_path: (targetPath) => ipcRenderer.invoke('reserve-output-path', targetPath),
  get_dropped_file_path: (file) => {
    if (!file) return null;
    if (typeof webUtils?.getPathForFile === 'function') {
      return webUtils.getPathForFile(file);
    }
    return file.path || null;
  }
};

window.pywebview = { api };
window.electronAPI = api;

ipcRenderer.on('progress', (_event, percent, status) => {
  window.onProgress?.(percent, status);
});

ipcRenderer.on('log', (_event, message, type = 'info') => {
  window.onLog?.(message, type);
});

ipcRenderer.on('ffmpeg-status', (_event, status) => {
  window.onFFmpegStatus?.(status);
});

ipcRenderer.on('open-file', (_event, filePath) => {
  if (window.onOpenFile) {
    window.onOpenFile(filePath);
  } else {
    window.pendingOpenFile = filePath;
  }
});

window.addEventListener('DOMContentLoaded', () => {
  window.dispatchEvent(new Event('pywebviewready'));
});
