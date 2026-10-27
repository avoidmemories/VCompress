// Modern VCompress - Frontend Logic

class VCompress {
    constructor() {
        this.currentFile = null;
        this.isProcessing = false;
        this.startTime = null;
        this.timerInterval = null;
        this.backendReady = false;
        this.ffmpegReady = false;
        this.compressionRunId = 0;
        // Concurrency guards: one compression job at a time; cancel waits
        // for the old job to fully unwind before a new start is allowed.
        this.activeCompressionPromise = null;
        this.isCancelling = false;
        // Chain that fully unwinds a cancelled job in the background; a new
        // start during this window queues on it instead of being rejected.
        this.cancelUnwindPromise = null;
        this.pendingOpenFile = window.pendingOpenFile || null;
        this.lastLoggedFFmpegPath = null;
        this.lastLoggedFilePath = null;
        this.showFolderFlashTimer = null;
        this.clipStart = 0;
        this.clipEnd = 0;
        this.clipDuration = 0;
        this.clipZoom = 0;
        this.clipViewStart = 0;
        this.clipZoomBadgeTimer = null;
        this.loadFileToken = 0;
        this.clipSourceToken = 0;
        this.clipPreviewProxyTimer = null;
        this.clipSegmentPrefetchTimer = null;
        this.prefetchPreviewSegmentKey = null;
        this.prefetchPreviewSegmentPromise = null;
        this.prefetchPreviewSegmentResult = null;
        this.clipSeekPreviewTime = null;
        this.previewFrameTimer = null;
        this.clipFrameTime = 0;
        this.isDraggingClipTimeline = false;
        this.isLoadingPreviewProxy = false;
        this.isLoadingPreviewSegment = false;
        this.usingClipPreviewProxy = false;
        this.usingClipPreviewSegment = false;
        this.clipPlaybackOffset = 0;
        this.clipWantsPlayback = false;
        this.useFramePreview = false;
        this.previewFrameToken = 0;
        this.clipPlaybackToken = 0;
        this.selectedAudioTracks = new Set();
        this.tolerancePresets = ['1', '2', '5', 'Any'];
        this.activeToleranceMenu = null;
        this.suppressToleranceRowClick = false;

        this.initElements();
        this.setInterfaceEnabled(false);
        this.initEventListeners();
        this.initPyWebViewAPI();
    }

    initElements() {
        this.navItems = document.querySelectorAll('.nav-item');
        this.pages = document.querySelectorAll('.page');
        // Window controls are native caption buttons now — no custom elements.
        this.compressPage = document.getElementById('compressPage');
        this.dropZone = document.getElementById('dropZone');
        this.fileInfoCard = document.getElementById('fileInfoCard');
        this.fileName = document.getElementById('fileName');
        this.fileSize = document.getElementById('fileSize');
        this.fileDuration = document.getElementById('fileDuration');
        this.doneBadge = document.getElementById('doneBadge');
        this.clearFileBtn = document.getElementById('clearFileBtn');
        this.targetSize = document.getElementById('targetSize');
        this.resolution = document.getElementById('resolution');
        this.resolutionItem = document.getElementById('resolutionItem');
        this.fps = document.getElementById('fps');
        this.audioBitrate = document.getElementById('audioBitrate');
        this.audioBitrateItem = document.getElementById('audioBitrateItem');
        this.encoderDevice = document.getElementById('encoderDevice');
        this.videoCodec = document.getElementById('videoCodec');
        this.qualityBias = document.getElementById('qualityBias');
        this.qualityBiasDescription = document.getElementById('qualityBiasDescription');
        this.audioMode = document.getElementById('audioMode');
        this.matchSourceFps = document.getElementById('matchSourceFps');
        this.usePadding = document.getElementById('usePadding');
        this.toleranceEnabled = document.getElementById('toleranceEnabled');
        this.toleranceControls = document.getElementById('toleranceControls');
        this.toleranceMinus = document.getElementById('toleranceMinus');
        this.tolerancePlus = document.getElementById('tolerancePlus');
        this.toleranceArrows = document.querySelectorAll('.tolerance-arrow');
        this.defaultTargetSize = document.getElementById('defaultTargetSize');
        this.defaultResolution = document.getElementById('defaultResolution');
        this.defaultFps = document.getElementById('defaultFps');
        this.defaultAudioBitrate = document.getElementById('defaultAudioBitrate');
        this.defaultEncoderDevice = document.getElementById('defaultEncoderDevice');
        this.defaultVideoCodec = document.getElementById('defaultVideoCodec');
        this.defaultQualityBias = document.getElementById('defaultQualityBias');
        this.defaultQualityBiasDescription = document.getElementById('defaultQualityBiasDescription');
        this.defaultAudioMode = document.getElementById('defaultAudioMode');
        this.defaultMatchSourceFps = document.getElementById('defaultMatchSourceFps');
        this.defaultUsePadding = document.getElementById('defaultUsePadding');
        this.defaultOverwriteOutput = document.getElementById('defaultOverwriteOutput');
        this.defaultToleranceEnabled = document.getElementById('defaultToleranceEnabled');
        this.defaultToleranceControls = document.getElementById('defaultToleranceControls');
        this.defaultToleranceMinus = document.getElementById('defaultToleranceMinus');
        this.defaultTolerancePlus = document.getElementById('defaultTolerancePlus');
        this.defaultsSaveState = document.getElementById('defaultsSaveState');
        this.compressContainer = document.getElementById('compressContainer');
        this.compressBtn = document.getElementById('compressBtn');
        this.progressCard = document.getElementById('progressCard');
        this.progressPercent = document.getElementById('progressPercent');
        this.progressStatus = document.getElementById('progressStatus');
        this.renderModeBadge = document.getElementById('renderModeBadge');
        this.progressFill = document.getElementById('progressFill');
        this.progressTime = document.getElementById('progressTime');
        this.cancelBtn = document.getElementById('cancelBtn');
        this.clipEmpty = document.getElementById('clipEmpty');
        this.clipWorkspace = document.getElementById('clipWorkspace');
        this.clipPage = document.getElementById('clipPage');
        this.clipVideo = document.getElementById('clipVideo');
        this.clipFramePreview = document.getElementById('clipFramePreview');
        this.clipDurationBadge = document.getElementById('clipDurationBadge');
        this.clipHoverTime = document.getElementById('clipHoverTime');
        this.clipSelectedRange = document.getElementById('clipSelectedRange');
        this.clipCursorLine = document.getElementById('clipCursorLine');
        this.clipPlayhead = document.getElementById('clipPlayhead');
        this.clipZoomBadge = document.getElementById('clipZoomBadge');
        this.clipTimeline = document.getElementById('clipTimeline');
        this.clipControls = document.querySelector('.clip-controls');
        this.frameBackBtn = document.getElementById('frameBackBtn');
        this.frameForwardBtn = document.getElementById('frameForwardBtn');
        this.markStartBtn = document.getElementById('markStartBtn');
        this.markEndBtn = document.getElementById('markEndBtn');
        this.clipPlayBtn = document.getElementById('clipPlayBtn');
        this.clipAudioPopover = document.getElementById('clipAudioPopover');
        this.clipAudioList = document.getElementById('clipAudioList');
        this.clipAudioCount = document.getElementById('clipAudioCount');
        this.compressClipBtn = document.getElementById('compressClipBtn');
        this.defaultOutputPath = document.getElementById('defaultOutputPath');
        this.outputSettingsCard = document.getElementById('outputSettingsCard');
        this.compactSettingsCard = document.getElementById('compactSettingsCard');
        this.browseDefaultOutputBtn = document.getElementById('browseDefaultOutputBtn');
        this.showOutputFolderBtn = document.getElementById('showOutputFolderBtn');
        this.logContainer = document.getElementById('logContainer');
        this.copyLogsBtn = document.getElementById('copyLogsBtn');
        this.ffmpegStatus = document.getElementById('ffmpegStatus');
        this.lastFFmpegStatus = window.pendingFFmpegStatus || null;
    }

    initEventListeners() {
        this.navItems.forEach(item => {
            item.addEventListener('click', () => this.switchPage(item.dataset.page));
        });

        // Window controls are native now (Electron titleBarOverlay): no custom
        // minimize/close buttons or drag IPC — the bar itself is the drag region.
        this.dropZone.addEventListener('click', () => { if (this.canUseBackend()) this.browseInputFile(); });
        this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));

        [this.compressPage, this.fileInfoCard, this.compressContainer].forEach(target => {
            if (!target) return;
            target.addEventListener('dragover', (e) => this.handleReplaceDragOver(e));
            target.addEventListener('dragleave', (e) => this.handleReplaceDragLeave(e));
            target.addEventListener('drop', (e) => this.handleDropOnCard(e));
        });
        [this.clipPage, this.clipEmpty, this.clipWorkspace].forEach(target => {
            if (!target) return;
            target.addEventListener('dragover', (e) => this.handleClipDragOver(e));
            target.addEventListener('dragleave', (e) => this.handleClipDragLeave(e));
            target.addEventListener('drop', (e) => this.handleClipDrop(e));
        });
        this.clipEmpty?.addEventListener('click', () => { if (this.canUseBackend()) this.browseInputFile(); });

        this.clearFileBtn.addEventListener('click', () => this.clearFile());
        this.compressBtn.addEventListener('click', () => { if (this.canUseBackend()) this.startCompression(); });
        this.compressClipBtn?.addEventListener('click', () => {
            if (!this.canUseBackend()) return;
            this.switchPage('compress');
            this.startCompression(true);
        });
        this.cancelBtn.addEventListener('click', () => this.cancelCompression());
        this.browseDefaultOutputBtn.addEventListener('click', () => { if (this.backendReady) this.browseDefaultOutput(); });
        this.showOutputFolderBtn.addEventListener('click', () => {
            this.setShowFolderFlash(false);
            if (this.backendReady) this.showOutputInFolder();
        });
        this.copyLogsBtn.addEventListener('click', () => this.copyLogs());
        window.onOpenFile = (filePath) => this.openStartupFile(filePath);
        this.qualityBias?.addEventListener('change', () => this.updateQualityBiasDescriptions());
        this.defaultQualityBias?.addEventListener('change', () => this.updateQualityBiasDescriptions());
        this.audioMode?.addEventListener('change', () => this.updateAudioBitrateState());
        this.defaultAudioMode?.addEventListener('change', () => this.updateAudioBitrateState());
        this.audioBitrate?.addEventListener('change', () => this.updateCurrentOutputPath());
        this.resolution?.addEventListener('change', () => this.updateResolutionState());
        [this.toleranceEnabled, this.toleranceMinus, this.tolerancePlus].forEach(el => {
            el?.addEventListener('change', () => this.updateToleranceState());
            el?.addEventListener('input', () => this.updateToleranceState());
            el?.addEventListener('blur', () => this.normalizeToleranceInput(el));
        });
        [this.defaultToleranceEnabled, this.defaultToleranceMinus, this.defaultTolerancePlus].forEach(el => {
            el?.addEventListener('change', () => this.updateToleranceState());
            el?.addEventListener('input', () => this.updateToleranceState());
            el?.addEventListener('blur', () => this.normalizeToleranceInput(el));
        });
        [this.toleranceMinus, this.tolerancePlus, this.defaultToleranceMinus, this.defaultTolerancePlus].forEach(el => {
            el?.addEventListener('keydown', (event) => this.guardToleranceKey(event));
            el?.addEventListener('paste', (event) => this.guardTolerancePaste(event));
        });
        this.toleranceArrows?.forEach(button => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.toggleToleranceMenu(button);
            });
        });
        [this.toleranceControls, this.defaultToleranceControls].forEach(controls => {
            controls?.addEventListener('click', (event) => event.stopPropagation());
            controls?.addEventListener('pointerdown', (event) => {
                event.stopPropagation();
                this.suppressToleranceRowClick = true;
                controls.closest('.tolerance-inline-row')?.classList.add('is-editing');
            });
        });
        document.addEventListener('pointerup', () => {
            document.querySelectorAll('.tolerance-inline-row.is-editing').forEach(row => {
                if (!row.querySelector('.tolerance-select:focus')) row.classList.remove('is-editing');
            });
            window.setTimeout(() => {
                this.suppressToleranceRowClick = false;
            }, 120);
        });
        document.querySelectorAll('.tolerance-select').forEach(input => {
            input.addEventListener('focus', () => input.closest('.tolerance-inline-row')?.classList.add('is-editing'));
            input.addEventListener('blur', () => input.closest('.tolerance-inline-row')?.classList.remove('is-editing'));
        });
        document.querySelectorAll('[data-toggle-target]').forEach(row => {
            row.addEventListener('click', (event) => this.toggleSettingRow(event, row));
        });
        document.addEventListener('click', (event) => {
            if (!event.target.closest('.tolerance-picker') && !event.target.closest('.tolerance-menu')) {
                this.closeToleranceMenu();
            }
        });
        window.addEventListener('resize', () => this.closeToleranceMenu());
        this.clipVideo?.addEventListener('loadedmetadata', () => {
            if (!this.isLoadingPreviewProxy && !this.isLoadingPreviewSegment && !this.usingClipPreviewSegment) {
                this.resetClipRange();
            }
            this.forceClipVideoRepaint();
        });
        this.clipVideo?.addEventListener('loadeddata', () => this.forceClipVideoRepaint());
        this.clipFramePreview?.addEventListener('error', () => {
            this.clipFramePreview?.classList.remove('visible');
            this.clipFramePreview?.removeAttribute('src');
        });
        this.clipVideo?.addEventListener('error', () => {
            if (this.currentFile) {
                if (this.usingClipPreviewSegment || this.isLoadingPreviewSegment) {
                    const fallbackTime = this.currentClipTime();
                    this.isLoadingPreviewSegment = false;
                    this.usingClipPreviewSegment = false;
                    this.useFramePreview = true;
                    this.clipPlaybackOffset = 0;
                    this.clipFrameTime = fallbackTime;
                    this.clipSeekPreviewTime = fallbackTime;
                    this.clipVideo.pause();
                    this.clipVideo.removeAttribute('src');
                    this.clipVideo.load();
                    this.renderClipPreviewFrame(fallbackTime, this.clipSourceToken, 0);
                    this.clipDurationBadge.textContent = this.formatClipDuration(Math.max(0, this.clipEnd - this.clipStart));
                    this.updatePlayButton();
                    this.updateClipReadout();
                    return;
                }
                if (!this.usingClipPreviewProxy && this.currentFile.needs_preview_proxy) {
                    const fallbackTime = this.clipSeekPreviewTime ?? this.clipFrameTime ?? this.clipVideo?.currentTime ?? 0;
                    this.isLoadingPreviewProxy = false;
                    this.useFramePreview = true;
                    this.clipFrameTime = Math.max(0, Math.min(this.clipDuration || 0, fallbackTime));
                    this.clipSeekPreviewTime = this.clipFrameTime;
                    this.clipVideo.pause();
                    this.clipVideo.removeAttribute('src');
                    this.clipVideo.load();
                    this.renderClipPreviewFrame(this.clipFrameTime, this.clipSourceToken, 0);
                    this.scheduleClipSegmentPrefetch(this.clipFrameTime, this.clipSourceToken, 500);
                    this.clipDurationBadge.textContent = this.formatClipDuration(Math.max(0, this.clipEnd - this.clipStart));
                    this.updatePlayButton();
                    this.updateClipReadout();
                } else {
                    this.isLoadingPreviewProxy = false;
                    this.useFramePreview = true;
                    this.clipDurationBadge.textContent = this.formatClipDuration(Math.max(0, this.clipEnd - this.clipStart));
                    this.renderClipPreviewFrame(this.currentClipTime(), this.clipSourceToken, 0);
                }
            } else {
                this.isLoadingPreviewProxy = false;
                this.clipDurationBadge.textContent = 'Preview unavailable';
            }
        });
        this.clipVideo?.addEventListener('timeupdate', () => {
            if (this.useFramePreview) return;
            this.clipSeekPreviewTime = null;
            this.updateClipReadout();
        });
        this.clipVideo?.addEventListener('seeked', () => {
            if (this.useFramePreview) return;
            this.clipSeekPreviewTime = null;
            this.updateClipReadout();
            this.forceClipVideoRepaint();
        });
        this.clipVideo?.addEventListener('play', () => {
            if (this.useFramePreview && !this.usingClipPreviewProxy) {
                this.clipVideo.pause();
                this.showClipFramePreviewIfReady();
                this.updatePlayButton();
                return;
            }
            this.clipFramePreview?.classList.remove('visible');
            this.updatePlayButton();
        });
        this.clipVideo?.addEventListener('pause', () => {
            if (this.useFramePreview && !this.usingClipPreviewProxy) {
                this.renderClipPreviewFrame(this.currentClipTime(), this.clipSourceToken, 0);
            }
            this.updatePlayButton();
        });
        this.clipVideo?.addEventListener('ended', () => {
            if (!this.usingClipPreviewSegment) return;
            const endTime = this.currentClipTime();
            this.usingClipPreviewSegment = false;
            this.useFramePreview = true;
            this.clipPlaybackOffset = 0;
            this.clipFrameTime = endTime;
            this.clipSeekPreviewTime = endTime;
            this.updatePlayButton();
            this.updateClipReadout();
            if (this.clipWantsPlayback && endTime < (this.clipDuration || 0) - 0.05) {
                this.startClipPreviewSegment(endTime, true);
            } else {
                this.renderClipPreviewFrame(endTime, this.clipSourceToken, 0);
            }
        });
        this.clipVideo?.addEventListener('click', () => this.toggleClipPlayback());
        this.clipTimeline?.addEventListener('mousedown', (e) => this.startClipTimelineDrag(e));
        this.clipTimeline?.addEventListener('mousemove', (e) => this.handleClipTimelineMove(e));
        this.clipTimeline?.addEventListener('mouseleave', () => this.hideClipHoverTime());
        this.clipTimeline?.addEventListener('wheel', (e) => this.handleClipWheel(e), { passive: false });
        window.addEventListener('mousemove', (e) => this.dragClipTimeline(e));
        window.addEventListener('mouseup', () => this.stopClipTimelineDrag());
        window.addEventListener('wheel', (e) => this.handleGlobalClipWheel(e), { passive: false });
        window.addEventListener('keydown', (e) => this.handleClipKeyboard(e));
        this.markStartBtn?.addEventListener('click', () => this.setClipPoint('start'));
        this.markEndBtn?.addEventListener('click', () => this.setClipPoint('end'));
        this.clipPlayBtn?.addEventListener('click', () => this.toggleClipPlayback());
        this.frameBackBtn?.addEventListener('click', () => this.stepFrame(-1));
        this.frameForwardBtn?.addEventListener('click', () => this.stepFrame(1));
        [this.markStartBtn, this.markEndBtn, this.clipPlayBtn, this.frameBackBtn, this.frameForwardBtn, this.compressClipBtn].forEach(button => {
            button?.addEventListener('mouseup', () => button.blur());
        });
        this.initDefaultSettingsListeners();
    }

    initDefaultSettingsListeners() {
        [
            this.defaultTargetSize,
            this.defaultResolution,
            this.defaultFps,
            this.defaultAudioBitrate,
            this.defaultEncoderDevice,
            this.defaultVideoCodec,
            this.defaultQualityBias,
            this.defaultAudioMode,
            this.defaultMatchSourceFps,
            this.defaultUsePadding,
            this.defaultOverwriteOutput,
            this.defaultToleranceEnabled,
            this.defaultToleranceMinus,
            this.defaultTolerancePlus,
        ].forEach(el => {
            el?.addEventListener('change', () => this.saveDefaultSettings());
            el?.addEventListener('input', () => {
                if (el.type === 'number' || el.classList?.contains('tolerance-select')) this.markDefaultsDirty();
            });
        });
    }

    updateQualityBiasDescriptions() {
    }

    updateAudioBitrateState() {
        if (this.audioBitrate) {
            this.audioBitrate.disabled = this.isProcessing || !this.ffmpegReady;
        }
    }

    updateResolutionState() {
        if (this.resolution) {
            this.resolution.disabled = this.isProcessing || !this.ffmpegReady;
        }
    }

    updateToleranceState() {
        const toleranceActive = Boolean(this.toleranceEnabled?.checked);
        this.toleranceControls?.classList.toggle('is-muted', !toleranceActive);
        [this.toleranceMinus, this.tolerancePlus].forEach(el => {
            if (el) el.disabled = !toleranceActive || this.isProcessing || !this.ffmpegReady;
            el?.closest('.tolerance-picker')?.querySelector('.tolerance-arrow')?.toggleAttribute('disabled', Boolean(el?.disabled));
        });

        const defaultToleranceActive = Boolean(this.defaultToleranceEnabled?.checked);
        this.defaultToleranceControls?.classList.toggle('is-muted', !defaultToleranceActive);
        [this.defaultToleranceMinus, this.defaultTolerancePlus].forEach(el => {
            if (el) el.disabled = !defaultToleranceActive || this.isProcessing || !this.ffmpegReady;
            el?.closest('.tolerance-picker')?.querySelector('.tolerance-arrow')?.toggleAttribute('disabled', Boolean(el?.disabled));
        });
        this.syncToleranceArrows();
        if (this.activeToleranceMenu?.input?.disabled) this.closeToleranceMenu();
    }

    syncToleranceArrows() {
        this.toleranceArrows?.forEach(button => {
            const input = document.getElementById(button.dataset.target || '');
            button.disabled = !input || input.disabled;
        });
        if (this.activeToleranceMenu?.input?.disabled) this.closeToleranceMenu();
    }

    toggleSettingRow(event, row) {
        if (this.suppressToleranceRowClick) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.target.closest('input, select, button, .toggle-switch, .tolerance-picker, .tolerance-menu')) return;
        const input = document.getElementById(row.dataset.toggleTarget || '');
        if (!input || input.disabled) return;
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    toggleToleranceMenu(button) {
        const input = document.getElementById(button?.dataset?.target || '');
        if (!input || input.disabled) return;
        if (this.activeToleranceMenu?.input === input) {
            this.closeToleranceMenu();
            return;
        }
        this.openToleranceMenu(input);
    }

    openToleranceMenu(input) {
        this.closeToleranceMenu();
        const picker = input.closest('.tolerance-picker');
        const menu = document.createElement('div');
        menu.className = 'tolerance-menu';
        const current = String(input.value || '').trim().toLowerCase();
        this.tolerancePresets.forEach((preset) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'tolerance-option';
            option.textContent = preset;
            option.dataset.value = preset;
            option.classList.toggle('is-active', current === preset.toLowerCase());
            option.addEventListener('click', (event) => {
                event.preventDefault();
                input.value = preset;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                this.closeToleranceMenu();
                input.focus();
            });
            menu.appendChild(option);
        });
        document.body.appendChild(menu);
        const rect = input.getBoundingClientRect();
        const menuHeight = menu.offsetHeight;
        const spaceBelow = window.innerHeight - rect.bottom;
        const openAbove = spaceBelow < menuHeight + 10 && rect.top > menuHeight + 10;
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${openAbove ? rect.top - menuHeight - 6 : rect.bottom + 6}px`;
        picker?.classList.add('is-open');
        this.activeToleranceMenu = { input, menu, picker };
    }

    guardToleranceKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const allowedKeys = [
            'Backspace',
            'Delete',
            'Tab',
            'Enter',
            'Escape',
            'ArrowLeft',
            'ArrowRight',
            'Home',
            'End'
        ];
        if (allowedKeys.includes(event.key)) return;
        if (/^\d$/.test(event.key)) return;
        if ((event.key === '.' || event.key === ',') && !/[.,]/.test(event.currentTarget.value)) return;
        event.preventDefault();
    }

    guardTolerancePaste(event) {
        const text = event.clipboardData?.getData('text') || '';
        if (/^\s*\d*(?:[.,]\d*)?\s*$/.test(text)) return;
        event.preventDefault();
    }

    closeToleranceMenu() {
        this.activeToleranceMenu?.menu?.remove();
        this.activeToleranceMenu?.picker?.classList.remove('is-open');
        this.activeToleranceMenu = null;
    }

    toleranceValue(input) {
        const value = String(input?.value || 'any').trim();
        if (!value || value.toLowerCase() === 'any') return { mode: 'any', mb: 0 };
        const numberText = value.replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0];
        const mb = Number(numberText);
        if (mb === 0 && !/[.,]\d*[1-9]/.test(value)) return { mode: 'any', mb: 0 };
        return { mode: 'mb', mb: Math.max(Number.isFinite(mb) ? mb : 0, 0) };
    }

    formatToleranceValue(mode, mb) {
        if (mode === 'any' || Number(mb) === 0) return 'Any';
        const value = Number.isFinite(Number(mb)) ? Number(mb) : 0;
        return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, '')}`;
    }

    normalizeToleranceInput(input) {
        if (!input?.classList?.contains('tolerance-select')) return;
        const parsed = this.toleranceValue(input);
        input.value = this.formatToleranceValue(parsed.mode, parsed.mb);
    }

    getToleranceSettings(prefix = '') {
        const isDefault = prefix === 'default';
        const enabled = Boolean((isDefault ? this.defaultToleranceEnabled : this.toleranceEnabled)?.checked);
        const minus = this.toleranceValue(isDefault ? this.defaultToleranceMinus : this.toleranceMinus);
        const plus = this.toleranceValue(isDefault ? this.defaultTolerancePlus : this.tolerancePlus);
        return {
            enabled,
            minus_mode: minus.mode,
            minus_mb: minus.mb,
            plus_mode: plus.mode,
            plus_mb: plus.mb
        };
    }

    applyToleranceSettings(settings = {}) {
        const tolerance = settings.tolerance || {};
        const defaults = {
            enabled: false,
            minus_mode: 'mb',
            minus_mb: 5,
            plus_mode: 'mb',
            plus_mb: 1
        };
        const merged = { ...defaults, ...tolerance };
        const setValue = (input, mode, mb) => {
            if (!input) return;
            input.value = this.formatToleranceValue(mode, mb);
        };

        if (this.toleranceEnabled) this.toleranceEnabled.checked = Boolean(merged.enabled);
        setValue(this.toleranceMinus, merged.minus_mode, merged.minus_mb);
        setValue(this.tolerancePlus, merged.plus_mode, merged.plus_mb);

        if (this.defaultToleranceEnabled) this.defaultToleranceEnabled.checked = Boolean(merged.enabled);
        setValue(this.defaultToleranceMinus, merged.minus_mode, merged.minus_mb);
        setValue(this.defaultTolerancePlus, merged.plus_mode, merged.plus_mb);
        this.updateToleranceState();
    }

    audioTracks() {
        return Array.isArray(this.currentFile?.audio_tracks) ? this.currentFile.audio_tracks : [];
    }

    resetAudioTrackSelection(fileInfo = this.currentFile) {
        const tracks = Array.isArray(fileInfo?.audio_tracks) ? fileInfo.audio_tracks : [];
        this.selectedAudioTracks = new Set(tracks.map((track) => Number(track.audio_index ?? track.id)).filter(Number.isFinite));
        this.renderAudioTracks();
    }

    selectedAudioTrackList() {
        const tracks = this.audioTracks();
        if (!tracks.length) return [];
        return [...this.selectedAudioTracks].filter((index) => tracks.some((track) => Number(track.audio_index ?? track.id) === index));
    }

    syncSelectedAudioTracksFromInputs() {
        const tracks = this.audioTracks();
        if (!tracks.length) {
            this.selectedAudioTracks = new Set();
            if (this.clipAudioCount) this.clipAudioCount.textContent = '0/0';
            return;
        }

        const inputs = this.clipAudioList
            ? [...this.clipAudioList.querySelectorAll('input[data-audio-index]')]
            : [];
        if (inputs.length) {
            this.selectedAudioTracks = new Set(
                inputs
                    .filter(input => input.checked)
                    .map(input => Number(input.dataset.audioIndex))
                    .filter(Number.isFinite)
            );
        }
        if (this.clipAudioCount) {
            this.clipAudioCount.textContent = `${this.selectedAudioTrackList().length}/${tracks.length}`;
        }
    }

    renderAudioTracks() {
        const tracks = this.audioTracks();
        if (this.clipAudioCount) {
            this.clipAudioCount.textContent = `${this.selectedAudioTrackList().length}/${tracks.length}`;
        }
        if (!this.clipAudioList) return;
        this.clipAudioList.innerHTML = '';
        if (!tracks.length) {
            const empty = document.createElement('div');
            empty.className = 'clip-audio-empty';
            empty.textContent = this.currentFile ? 'No audio tracks' : 'Load a video to see audio tracks';
            this.clipAudioList.appendChild(empty);
            return;
        }
        tracks.forEach((track) => {
            const index = Number(track.audio_index ?? track.id);
            const row = document.createElement('label');
            row.className = 'clip-audio-track clickable-setting';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.audioIndex = String(index);
            checkbox.checked = this.selectedAudioTracks.has(index);
            checkbox.addEventListener('change', () => this.syncSelectedAudioTracksFromInputs());
            const info = document.createElement('div');
            info.className = 'setting-info';
            const name = document.createElement('div');
            name.className = 'clip-audio-name setting-name';
            name.textContent = `Track ${index + 1}: ${track.label || 'Audio'}`;
            const details = [
                track.codec,
                track.channels,
                track.sample_rate ? `${track.sample_rate} Hz` : '',
                track.bitrate_kbps ? `${track.bitrate_kbps} kbps` : '',
                track.language ? track.language.toUpperCase() : ''
            ].filter(Boolean).join(' / ');
            const meta = document.createElement('div');
            meta.className = 'clip-audio-meta setting-description';
            meta.textContent = details || `Track ${index + 1}`;
            info.appendChild(name);
            info.appendChild(meta);
            row.appendChild(info);
            row.appendChild(checkbox);
            this.clipAudioList.appendChild(row);
        });
    }

    formatTime(seconds, decimals = 2) {
        const value = Math.max(0, Number(seconds) || 0);
        if (value >= 3600) {
            const hours = Math.floor(value / 3600);
            const minutes = Math.floor((value % 3600) / 60);
            const sec = value - hours * 3600 - minutes * 60;
            return `${hours}:${minutes.toString().padStart(2, '0')}:${sec.toFixed(decimals).padStart(decimals + 3, '0')}`;
        }
        const minutes = Math.floor(value / 60);
        const sec = value - minutes * 60;
        return minutes > 0
            ? `${minutes}:${sec.toFixed(decimals).padStart(decimals + 3, '0')}`
            : sec.toFixed(decimals).padStart(decimals + 3, '0');
    }

    filePathToUrl(filePath) {
        const normalized = filePath.replace(/\\/g, '/');
        const encoded = normalized
            .split('/')
            .map((part, index) => (index === 0 && /^[A-Za-z]:$/.test(part)) ? part : encodeURIComponent(part))
            .join('/');
        return `file:///${encoded}`;
    }

    normalizeSourceFps(fps) {
        const value = Number(fps) || 0;
        if (!value) return null;
        const rounded = Math.round(value);
        if (Math.abs(value - rounded) <= 0.25) return rounded;
        return Number(value.toFixed(3));
    }

    applySourceFps(fileInfo) {
        if (!this.matchSourceFps?.checked) return;
        const sourceFps = this.normalizeSourceFps(fileInfo.fps);
        if (!sourceFps) return;
        this.fps.value = sourceFps;
        this.log(`FPS matched to source: ${sourceFps}`);
    }

    prepareClipForNewFile() {
        this.clipSourceToken += 1;
        this.cancelPreviewProxy();
        window.clearTimeout(this.clipPreviewProxyTimer);
        this.clipPreviewProxyTimer = null;
        window.clearTimeout(this.clipSegmentPrefetchTimer);
        this.clipSegmentPrefetchTimer = null;
        this.prefetchPreviewSegmentKey = null;
        this.prefetchPreviewSegmentPromise = null;
        window.clearTimeout(this.previewFrameTimer);
        this.previewFrameTimer = null;
        this.isLoadingPreviewProxy = false;
        this.isLoadingPreviewSegment = false;
        this.usingClipPreviewProxy = false;
        this.usingClipPreviewSegment = false;
        this.clipPlaybackOffset = 0;
        this.clipWantsPlayback = false;
        this.useFramePreview = false;
        this.previewFrameToken += 1;
        this.isDraggingClipTimeline = false;
        this.clipStart = 0;
        this.clipEnd = 0;
        this.clipDuration = 0;
        this.clipZoom = 0;
        this.clipViewStart = 0;
        this.clipSeekPreviewTime = null;
        this.clipFrameTime = 0;
        this.clipCursorLine?.classList.remove('visible');
        this.clipHoverTime?.classList.remove('visible');
        this.hideClipZoomBadge();
        if (this.clipVideo) {
            this.clipVideo.pause();
            this.clipVideo.removeAttribute('src');
            this.clipVideo.load();
        }
        if (this.clipFramePreview) {
            this.clipFramePreview.removeAttribute('src');
            this.clipFramePreview.classList.remove('visible');
        }
        if (this.clipDurationBadge) this.clipDurationBadge.textContent = 'Loading...';
        if (this.compressClipBtn) this.compressClipBtn.disabled = true;
        if (this.clipWorkspace) this.clipWorkspace.style.display = 'none';
        if (this.clipEmpty) this.clipEmpty.style.display = 'flex';
        this.setClipControlsEnabled(false);
        this.updatePlayButton();
    }

    updateClipSource(fileInfo) {
        if (!this.clipVideo || !fileInfo?.path) return;
        const token = ++this.clipSourceToken;
        window.clearTimeout(this.clipPreviewProxyTimer);
        this.clipPreviewProxyTimer = null;
        window.clearTimeout(this.previewFrameTimer);
        this.previewFrameTimer = null;
        this.isLoadingPreviewProxy = false;
        this.isLoadingPreviewSegment = false;
        this.usingClipPreviewProxy = false;
        this.usingClipPreviewSegment = false;
        this.clipPlaybackOffset = 0;
        this.clipWantsPlayback = false;
        this.useFramePreview = false;
        this.clipFrameTime = 0;
        this.previewFrameToken += 1;
        this.clipPlaybackToken += 1;
        this.prefetchPreviewSegmentKey = null;
        this.prefetchPreviewSegmentPromise = null;
        this.prefetchPreviewSegmentResult = null;
        this.isDraggingClipTimeline = false;
        this.clipVideo.pause();
        this.clipVideo.removeAttribute('src');
        this.clipVideo.load();
        this.resetClipRange(fileInfo.duration || 0);
        this.clipVideo.dataset.sourceToken = String(token);
        this.clipVideo.classList.remove('is-hidden');
        this.clipFramePreview?.classList.remove('visible');
        this.clipFramePreview?.removeAttribute('src');
        this.clipEmpty.style.display = 'none';
        this.clipWorkspace.style.display = 'flex';
        this.compressClipBtn.disabled = false;
        this.setClipControlsEnabled(true);
        // Original preview logic restored: the <video> element loads the
        // source file directly (Chromium's own decoder). The proxy/segment/
        // frame fallbacks below kick in on error exactly as they did before
        // the MediaSource experiment.
        this.clipVideo.src = this.filePathToUrl(fileInfo.path);
        this.clipVideo.load();
        if (fileInfo.needs_preview_proxy) this.scheduleClipSegmentPrefetch(0, token, 120, 8);
        if (!this.clipDuration) this.clipDurationBadge.textContent = 'Loading...';
        this.updatePlayButton();
    }


    async prepareClipPreviewProxy(fileInfo, token = this.clipSourceToken, force = false) {
        if ((!force && !fileInfo?.needs_preview_proxy) || !window.pywebview?.api?.prepare_preview_proxy) return;
        const sourcePath = fileInfo.path;
        try {
            if (fileInfo.needs_preview_proxy) this.log('Preparing stable clip preview...');
            const result = await window.pywebview.api.prepare_preview_proxy(sourcePath);
            if (token !== this.clipSourceToken || !this.currentFile || this.currentFile.path !== sourcePath) return;
            if (!result?.success) {
                this.isLoadingPreviewProxy = false;
                this.usingClipPreviewProxy = false;
                this.useFramePreview = false;
                this.clipFramePreview?.classList.remove('visible');
                this.clipFramePreview?.removeAttribute('src');
                if (this.clipVideo && !this.clipVideo.src) {
                    this.clipVideo.src = this.filePathToUrl(sourcePath);
                    this.clipVideo.load();
                }
                this.clipDurationBadge.textContent = this.formatClipDuration(Math.max(0, this.clipEnd - this.clipStart));
                this.updatePlayButton();
                if (result?.error) this.log(`WARNING: Stable preview failed - ${result.error}`, 'warning');
                return;
            }
            const keepTime = Math.max(0, Math.min(this.currentClipTime(), this.clipDuration || Infinity));
            this.clipVideo.pause();
            this.isLoadingPreviewProxy = true;
            this.usingClipPreviewProxy = true;
            this.usingClipPreviewSegment = false;
            this.isLoadingPreviewSegment = false;
            this.clipPlaybackOffset = 0;
            this.useFramePreview = false;
            this.previewFrameToken += 1;
            window.clearTimeout(this.previewFrameTimer);
            this.previewFrameTimer = null;
            this.clipFramePreview?.classList.remove('visible');
            this.clipFramePreview?.removeAttribute('src');
            this.clipVideo.dataset.sourceToken = String(token);
            this.clipVideo.src = this.filePathToUrl(result.path);
            this.clipVideo.load();
            this.clipVideo.addEventListener('loadedmetadata', () => {
                if (token !== this.clipSourceToken) return;
                this.isLoadingPreviewProxy = false;
                if (keepTime > 0 && this.clipVideo.duration > keepTime) this.clipVideo.currentTime = keepTime;
                this.clipDurationBadge.textContent = this.formatClipDuration(Math.max(0, this.clipEnd - this.clipStart));
                this.updatePlayButton();
            }, { once: true });
            if (fileInfo.needs_preview_proxy) {
                const mode = result.mode === 'encode' ? 'encoded' : 'remuxed';
                this.log(result.cached ? 'Stable clip preview loaded from cache' : `Stable clip preview ready (${mode})`);
            }
        } catch (error) {
            if (String(error).includes('Cancelled')) {
                if (token === this.clipSourceToken) this.isLoadingPreviewProxy = false;
                return;
            }
            if (token === this.clipSourceToken) {
                this.isLoadingPreviewProxy = false;
                this.usingClipPreviewProxy = false;
                this.useFramePreview = false;
                this.clipFramePreview?.classList.remove('visible');
                this.clipFramePreview?.removeAttribute('src');
                if (this.clipVideo && !this.clipVideo.src && this.currentFile?.path) {
                    this.clipVideo.src = this.filePathToUrl(this.currentFile.path);
                    this.clipVideo.load();
                }
                this.clipDurationBadge.textContent = this.formatClipDuration(Math.max(0, this.clipEnd - this.clipStart));
                this.updatePlayButton();
            }
            this.log(`WARNING: Stable preview failed - ${error}`, 'warning');
        }
    }

    cancelPreviewProxy() {
        window.pywebview?.api?.cancel_preview_proxy?.().catch?.(() => {});
    }

    renderClipPreviewFrame(time = this.currentClipTime(), token = this.clipSourceToken, delay = 80) {
        if (!this.useFramePreview || !this.currentFile?.path || !window.pywebview?.api?.get_preview_frame) return;
        window.clearTimeout(this.previewFrameTimer);
        this.previewFrameTimer = window.setTimeout(() => this.loadClipPreviewFrame(time, token), delay);
    }

    async loadClipPreviewFrame(time, token) {
        if (!this.useFramePreview || !this.currentFile?.path || token !== this.clipSourceToken) return;
        const frameToken = ++this.previewFrameToken;
        const sourcePath = this.currentFile.path;
        try {
            const result = await window.pywebview.api.get_preview_frame(sourcePath, time);
            if (
                !this.useFramePreview ||
                !result?.success ||
                token !== this.clipSourceToken ||
                frameToken !== this.previewFrameToken ||
                !this.currentFile ||
                this.currentFile.path !== sourcePath
            ) return;
            if (!this.clipFramePreview) return;
            this.clipFramePreview.src = this.filePathToUrl(result.path);
            this.clipFramePreview.classList.add('visible');
        } catch (error) {
            if (String(error).includes('Cancelled')) return;
            this.log(`WARNING: Preview frame failed - ${error}`, 'warning');
        }
    }

    showClipFramePreviewIfReady() {
        if (!this.clipFramePreview?.getAttribute('src')) {
            this.clipFramePreview?.classList.remove('visible');
            return false;
        }
        this.clipFramePreview.classList.add('visible');
        return true;
    }

    scheduleClipSegmentPrefetch(time = this.currentClipTime(), token = this.clipSourceToken, delay = 450, duration = 8) {
        if (!this.currentFile?.needs_preview_proxy || !window.pywebview?.api?.prepare_preview_segment) return;
        window.clearTimeout(this.clipSegmentPrefetchTimer);
        this.clipSegmentPrefetchTimer = window.setTimeout(() => {
            this.prefetchClipPreviewSegment(time, token, duration);
        }, delay);
    }

    prefetchClipPreviewSegment(time = this.currentClipTime(), token = this.clipSourceToken, duration = 8) {
        if (!this.currentFile?.path || token !== this.clipSourceToken || !window.pywebview?.api?.prepare_preview_segment) return null;
        const segmentStart = Math.max(0, Math.floor((Number(time) || 0) * 2) / 2);
        const segmentDuration = Math.max(2, Math.min(16, Number(duration) || 8));
        const key = `${this.currentFile.path}|${segmentStart}|${segmentDuration}`;
        if (this.prefetchPreviewSegmentKey === key && this.prefetchPreviewSegmentResult) {
            return Promise.resolve(this.prefetchPreviewSegmentResult);
        }
        if (this.prefetchPreviewSegmentKey === key && this.prefetchPreviewSegmentPromise) return this.prefetchPreviewSegmentPromise;
        this.prefetchPreviewSegmentKey = key;
        this.prefetchPreviewSegmentResult = null;
        this.prefetchPreviewSegmentPromise = window.pywebview.api.prepare_preview_segment(this.currentFile.path, segmentStart, segmentDuration)
            .then((result) => {
                if (this.prefetchPreviewSegmentKey === key) this.prefetchPreviewSegmentResult = result;
                return result;
            })
            .catch(() => null)
            .finally(() => {
                if (this.prefetchPreviewSegmentKey === key) this.prefetchPreviewSegmentPromise = null;
            });
        return this.prefetchPreviewSegmentPromise;
    }

    resetClipRange(fallbackDuration = 0) {
        const duration = fallbackDuration || this.clipVideo?.duration || this.currentFile?.duration || 0;
        this.clipDuration = Number.isFinite(duration) ? duration : 0;
        this.clipStart = 0;
        this.clipEnd = this.clipDuration;
        this.clipZoom = 0;
        this.clipViewStart = 0;
        this.clipSeekPreviewTime = null;
        this.clipFrameTime = 0;
        this.clipCursorLine?.classList.remove('visible');
        this.clipHoverTime?.classList.remove('visible');
        this.hideClipZoomBadge();
        this.updateClipReadout();
    }

    visibleClipDuration() {
        if (!this.clipDuration) return 0;
        return this.clipDuration / Math.pow(2, this.clipZoom);
    }

    clampClipViewStart(center = this.clipVideo?.currentTime || 0) {
        if (!this.clipDuration) {
            this.clipViewStart = 0;
            return;
        }
        const visible = this.visibleClipDuration();
        const maxStart = Math.max(0, this.clipDuration - visible);
        if (this.clipZoom === 0) {
            this.clipViewStart = 0;
            return;
        }
        this.clipViewStart = Math.max(0, Math.min(maxStart, center - visible / 2));
    }

    ensurePlayheadVisible() {
        if (!this.clipDuration || this.clipZoom === 0) {
            this.clipViewStart = 0;
            return;
        }
        const current = this.currentClipTime();
        const visible = this.visibleClipDuration();
        const maxStart = Math.max(0, this.clipDuration - visible);
        if (current < this.clipViewStart) {
            this.clipViewStart = Math.max(0, current - visible * 0.12);
        } else if (current > this.clipViewStart + visible) {
            this.clipViewStart = Math.min(maxStart, current - visible * 0.88);
        }
    }

    currentClipTime() {
        const videoTime = this.usingClipPreviewSegment
            ? this.clipPlaybackOffset + (this.clipVideo?.currentTime || 0)
            : this.clipVideo?.currentTime;
        const value = this.clipSeekPreviewTime ?? (this.useFramePreview ? this.clipFrameTime : videoTime) ?? 0;
        return Math.max(0, Math.min(this.clipDuration || 0, value));
    }

    timelineTimeFromEvent(e) {
        const rect = this.clipTimeline.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        return Math.min(this.clipDuration, this.clipViewStart + ratio * this.visibleClipDuration());
    }

    timelineRatioFromEvent(e) {
        const rect = this.clipTimeline.getBoundingClientRect();
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }

    seekClipFromTimeline(e) {
        if (!this.clipVideo || !this.clipDuration) return;
        const time = this.timelineTimeFromEvent(e);
        this.clipWantsPlayback = false;
        this.clipSeekPreviewTime = time;
        if (this.usingClipPreviewSegment && this.currentFile?.needs_preview_proxy) {
            this.clipVideo.pause();
            this.usingClipPreviewSegment = false;
            this.useFramePreview = true;
            this.clipPlaybackOffset = 0;
            this.clipFrameTime = time;
            this.renderClipPreviewFrame(time);
            this.scheduleClipSegmentPrefetch(time);
        } else if (this.useFramePreview) {
            this.clipFrameTime = time;
            this.renderClipPreviewFrame(time);
            this.scheduleClipSegmentPrefetch(time);
        } else if (this.clipVideo) {
            this.clipVideo.currentTime = time;
        }
        this.updateClipCursorLine(e);
        this.ensurePlayheadVisible();
        this.updateClipReadout();
    }

    startClipTimelineDrag(e) {
        if (this.isProcessing) return;
        if (e.button !== 0 || !this.clipDuration) return;
        e.preventDefault();
        this.isDraggingClipTimeline = true;
        this.seekClipFromTimeline(e);
        this.showClipHoverTime(e);
    }

    dragClipTimeline(e) {
        if (this.isProcessing) return;
        if (!this.isDraggingClipTimeline) return;
        e.preventDefault();
        this.seekClipFromTimeline(e);
        this.showClipHoverTime(e);
    }

    stopClipTimelineDrag() {
        this.isDraggingClipTimeline = false;
    }

    handleClipTimelineMove(e) {
        if (this.isProcessing) return;
        if (!this.clipDuration) return;
        this.showClipHoverTime(e);
    }

    showClipHoverTime(e) {
        if (!this.clipHoverTime || !this.clipDuration) return;
        this.clipHoverTime.textContent = this.formatTime(this.timelineTimeFromEvent(e));
        this.clipHoverTime.classList.add('visible');
        this.updateClipCursorLine(e);
    }

    hideClipHoverTime() {
        if (this.isDraggingClipTimeline) return;
        this.clipHoverTime?.classList.remove('visible');
        this.clipCursorLine?.classList.remove('visible');
    }

    updateClipCursorLine(e) {
        if (!this.clipCursorLine || !this.clipDuration) return;
        this.clipCursorLine.style.setProperty('--line-x', `${this.timelineRatioFromEvent(e) * 100}%`);
        this.clipCursorLine.classList.add('visible');
    }

    formatClipDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return '00.00';
        if (seconds >= 3600) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds - hours * 3600 - minutes * 60;
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
        }
        const minutes = Math.floor(seconds / 60);
        const secs = seconds - minutes * 60;
        if (minutes > 0) return `${minutes}:${secs.toFixed(2).padStart(5, '0')}`;
        return secs.toFixed(2).padStart(5, '0');
    }

    setClipPoint(which) {
        if (!this.clipVideo || !this.clipDuration) return;
        const value = this.currentClipTime();
        if (which === 'start') {
            this.clipStart = Math.min(value, Math.max(0, this.clipEnd - 0.1));
        } else {
            this.clipEnd = Math.max(value, Math.min(this.clipDuration, this.clipStart + 0.1));
        }
        this.updateClipReadout();
        this.pulseClipRange();
    }

    pulseClipRange() {
        if (!this.clipSelectedRange) return;
        this.clipSelectedRange.classList.remove('range-pulse');
        void this.clipSelectedRange.offsetWidth;
        this.clipSelectedRange.classList.add('range-pulse');
        window.setTimeout(() => this.clipSelectedRange?.classList.remove('range-pulse'), 180);
    }

    stepFrame(direction) {
        if (this.isProcessing) return;
        if (!this.clipVideo && !this.useFramePreview) return;
        const fpsValue = Number(this.fps.value) || this.currentFile?.fps || 60;
        const step = 1 / Math.max(1, fpsValue);
        this.clipWantsPlayback = false;
        this.clipPlaybackToken += 1;
        this.isLoadingPreviewSegment = false;
        this.clipVideo?.pause();
        const base = this.currentClipTime();
        const time = Math.max(0, Math.min(this.clipDuration || Infinity, base + direction * step));
        this.clipSeekPreviewTime = time;
        if (this.currentFile?.needs_preview_proxy) {
            this.usingClipPreviewSegment = false;
            this.useFramePreview = true;
            this.clipPlaybackOffset = 0;
            this.clipFrameTime = time;
            this.showClipFramePreviewIfReady();
            this.renderClipPreviewFrame(time, this.clipSourceToken, 0);
            this.scheduleClipSegmentPrefetch(time, this.clipSourceToken, 180, 8);
        } else if (this.useFramePreview) {
            this.clipFrameTime = time;
            this.renderClipPreviewFrame(time, this.clipSourceToken, 0);
            this.scheduleClipSegmentPrefetch(time);
        } else if (this.clipVideo) {
            this.clipVideo.currentTime = time;
        }
        this.updateClipReadout();
    }

    async startClipPreviewSegment(startOverride = null, autoContinue = false) {
        if (!this.currentFile?.path || !window.pywebview?.api?.prepare_preview_segment || this.isLoadingPreviewSegment) return;
        const token = this.clipSourceToken;
        const playbackToken = ++this.clipPlaybackToken;
        const sourcePath = this.currentFile.path;
        const start = Math.max(0, Math.min(this.clipDuration || Infinity, Number(startOverride ?? this.currentClipTime()) || 0));
        this.clipWantsPlayback = true;
        this.isLoadingPreviewSegment = true;
        this.isLoadingPreviewProxy = false;
        this.clipSeekPreviewTime = start;
        this.clipFrameTime = start;
        if (!autoContinue) this.showClipFramePreviewIfReady();
        if (!autoContinue) this.clipDurationBadge.textContent = 'Preparing playback...';
        this.updatePlayButton();
        try {
            const segmentStart = Math.max(0, Math.floor(start * 2) / 2);
            const segmentDuration = autoContinue ? 16 : 8;
            const prefetchKey = `${sourcePath}|${segmentStart}|${segmentDuration}`;
            let result = null;
            if (this.prefetchPreviewSegmentKey === prefetchKey && this.prefetchPreviewSegmentResult) {
                result = this.prefetchPreviewSegmentResult;
            } else if (this.prefetchPreviewSegmentKey === prefetchKey && this.prefetchPreviewSegmentPromise) {
                result = await this.prefetchPreviewSegmentPromise;
            } else {
                result = await window.pywebview.api.prepare_preview_segment(sourcePath, start, segmentDuration);
            }
            if (token !== this.clipSourceToken || playbackToken !== this.clipPlaybackToken || !this.currentFile || this.currentFile.path !== sourcePath) return;
            this.isLoadingPreviewSegment = false;
            if (!result?.success) {
                this.clipDurationBadge.textContent = this.formatClipDuration(Math.max(0, this.clipEnd - this.clipStart));
                if (result?.error) this.log(`WARNING: Clip playback preview failed - ${result.error}`, 'warning');
                return;
            }
            this.clipVideo.pause();
            this.useFramePreview = false;
            this.usingClipPreviewSegment = true;
            this.usingClipPreviewProxy = false;
            this.clipPlaybackOffset = Number(result.start) || start;
            this.clipSeekPreviewTime = start;
            this.previewFrameToken += 1;
            window.clearTimeout(this.previewFrameTimer);
            this.previewFrameTimer = null;
            this.clipVideo.dataset.sourceToken = String(token);
            this.clipVideo.src = this.filePathToUrl(result.path);
            this.clipVideo.load();
            this.clipVideo.addEventListener('loadedmetadata', () => {
                if (token !== this.clipSourceToken || playbackToken !== this.clipPlaybackToken) return;
                this.clipVideo.currentTime = Math.max(0, start - this.clipPlaybackOffset);
                this.clipDurationBadge.textContent = this.formatClipDuration(Math.max(0, this.clipEnd - this.clipStart));
                this.updateClipReadout();
            }, { once: true });
            let segmentStarted = false;
            const startSegmentPlayback = () => {
                if (segmentStarted || token !== this.clipSourceToken || playbackToken !== this.clipPlaybackToken || !this.usingClipPreviewSegment) return;
                segmentStarted = true;
                if (token !== this.clipSourceToken || playbackToken !== this.clipPlaybackToken || !this.usingClipPreviewSegment) return;
                this.clipFramePreview?.classList.remove('visible');
                this.clipFramePreview?.removeAttribute('src');
                this.clipSeekPreviewTime = null;
                this.scheduleClipSegmentPrefetch(this.clipPlaybackOffset + (Number(result.duration) || segmentDuration), token, 40, 16);
                this.clipVideo.play().catch(() => this.updatePlayButton());
            };
            this.clipVideo.addEventListener('loadeddata', startSegmentPlayback, { once: true });
            this.clipVideo.addEventListener('canplay', startSegmentPlayback, { once: true });
        } catch (error) {
            if (token === this.clipSourceToken && playbackToken === this.clipPlaybackToken) {
                this.isLoadingPreviewSegment = false;
                this.usingClipPreviewSegment = false;
                this.useFramePreview = true;
                this.clipPlaybackOffset = 0;
                this.clipFrameTime = start;
                this.clipSeekPreviewTime = start;
                this.renderClipPreviewFrame(start, token, 0);
                this.clipDurationBadge.textContent = this.formatClipDuration(Math.max(0, this.clipEnd - this.clipStart));
                this.updatePlayButton();
                this.updateClipReadout();
            }
            this.log(`WARNING: Clip playback preview failed - ${error}`, 'warning');
        }
    }

    toggleClipPlayback() {
        if (this.isProcessing) return;
        if (!this.clipVideo) return;
        if (this.useFramePreview && !this.usingClipPreviewProxy) {
            this.startClipPreviewSegment();
            return;
        }
        if ((this.isLoadingPreviewProxy || this.isLoadingPreviewSegment) && !this.usingClipPreviewProxy && this.currentFile?.needs_preview_proxy) {
            this.clipVideo.pause();
            this.clipDurationBadge.textContent = this.isLoadingPreviewSegment ? 'Preparing playback...' : 'Preparing preview...';
            this.updatePlayButton();
            return;
        }
        if (this.clipVideo.paused) {
            this.clipWantsPlayback = true;
            this.clipFramePreview?.classList.remove('visible');
            this.clipSeekPreviewTime = null;
            this.clipVideo.play().catch(() => this.updatePlayButton());
        } else {
            this.clipWantsPlayback = false;
            this.clipVideo.pause();
        }
        this.updatePlayButton();
    }

    updatePlayButton() {
        if (!this.clipPlayBtn || !this.clipVideo) return;
        this.clipPlayBtn.innerHTML = this.clipVideo.paused
            ? '<svg viewBox="0 0 24 24"><path d="M9 7l8 5-8 5z"/></svg>'
            : '<svg viewBox="0 0 24 24"><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></svg>';
    }

    setClipControlsEnabled(enabled) {
        [this.frameBackBtn, this.frameForwardBtn, this.markStartBtn, this.markEndBtn, this.clipPlayBtn, this.compressClipBtn].forEach(el => {
            if (!el || !('disabled' in el)) return;
            el.disabled = !enabled || this.isProcessing || !this.ffmpegReady;
            el.classList.toggle('is-disabled', !enabled);
        });
    }

    forceClipVideoRepaint() {
        if (!this.clipVideo) return;
        this.clipVideo.style.opacity = '0.999';
        requestAnimationFrame(() => {
            if (this.clipVideo) this.clipVideo.style.opacity = '';
        });
    }

    handleClipKeyboard(e) {
        if (this.isProcessing) return;
        if (document.activeElement?.matches('input, select, textarea')) return;
        if (e.code !== 'Space') return;
        if (!document.getElementById('clipPage')?.classList.contains('active')) return;
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        this.toggleClipPlayback();
    }

    handleClipWheel(e) {
        if (this.isProcessing) return;
        if (!this.clipDuration) return;
        e.preventDefault();
        if (e.ctrlKey) {
            this.stepFrame(e.deltaY < 0 ? 1 : -1);
            return;
        }
        const oldZoom = this.clipZoom;
        this.clipZoom = Math.max(0, Math.min(4, this.clipZoom + (e.deltaY < 0 ? 1 : -1)));
        if (oldZoom !== this.clipZoom) {
            this.clampClipViewStart(this.clipVideo?.currentTime || 0);
            this.updateClipReadout();
            this.showClipZoomBadge();
        }
    }

    showClipZoomBadge() {
        if (!this.clipZoomBadge) return;
        const zoomLabel = `${Math.pow(2, this.clipZoom)}x`;
        this.clipZoomBadge.textContent = zoomLabel;
        this.clipZoomBadge.classList.toggle('visible', this.clipZoom > 0);
    }

    hideClipZoomBadge() {
        if (!this.clipZoomBadge) return;
        this.clipZoomBadge.classList.remove('visible');
        window.clearTimeout(this.clipZoomBadgeTimer);
        this.clipZoomBadgeTimer = null;
    }

    handleGlobalClipWheel(e) {
        if (this.isProcessing) return;
        if (!e.ctrlKey || !document.getElementById('clipPage')?.classList.contains('active')) return;
        if (e.target?.closest?.('#clipTimeline')) return;
        e.preventDefault();
        this.stepFrame(e.deltaY < 0 ? 1 : -1);
    }

    updateClipReadout() {
        const duration = Math.max(0, this.clipEnd - this.clipStart);
        if (this.clipDurationBadge) this.clipDurationBadge.textContent = this.clipDuration ? this.formatClipDuration(duration) : 'No video';
        if (this.clipSelectedRange && this.clipPlayhead && this.clipDuration) {
            this.ensurePlayheadVisible();
            const visible = this.visibleClipDuration();
            const visibleStart = this.clipViewStart;
            const visibleEnd = this.clipViewStart + visible;
            const selectedStart = Math.max(this.clipStart, visibleStart);
            const selectedEnd = Math.min(this.clipEnd, visibleEnd);
            const left = ((selectedStart - visibleStart) / visible) * 100;
            const width = Math.max(0, ((selectedEnd - selectedStart) / visible) * 100);
            const current = this.currentClipTime();
            const playhead = ((current - this.clipViewStart) / visible) * 100;
            this.clipSelectedRange.style.left = `${left}%`;
            this.clipSelectedRange.style.width = `${width}%`;
            this.clipPlayhead.style.setProperty('--line-x', `${Math.max(0, Math.min(100, playhead))}%`);
        }
    }

    setCompressSettingsLocked(locked) {
        this.outputSettingsCard?.classList.toggle('is-locked', locked);
        this.compactSettingsCard?.classList.toggle('is-locked', locked);
        this.clipTimeline?.classList.toggle('is-locked', locked);
        this.clipControls?.classList.toggle('is-locked', locked);
        this.clipAudioList?.classList.toggle('is-locked', locked);
        [
            this.defaultOutputPath,
            this.browseDefaultOutputBtn,
            this.showOutputFolderBtn,
            this.targetSize,
            this.resolution,
            this.fps,
            this.audioBitrate,
            this.toleranceEnabled,
            this.toleranceMinus,
            this.tolerancePlus,
            this.compressClipBtn,
            this.frameBackBtn,
            this.frameForwardBtn,
            this.markStartBtn,
            this.markEndBtn,
            this.clipPlayBtn
        ].forEach(el => {
            if (!el || !('disabled' in el)) return;
            el.disabled = locked || !this.ffmpegReady;
        });
        this.clipAudioList?.querySelectorAll('input[data-audio-index]').forEach(input => {
            input.disabled = locked;
        });
        this.updateAudioBitrateState();
        this.updateResolutionState();
        this.updateToleranceState();
        if (this.compressClipBtn && !this.currentFile) this.compressClipBtn.disabled = true;
    }

    async initPyWebViewAPI() {
        await this.waitForPyWebView();

        this.backendReady = true;
        this.log('Backend ready');
        await this.loadSettings();
        if (this.lastFFmpegStatus) {
            this.updateFFmpegStatus(this.lastFFmpegStatus);
        } else {
            await this.checkFFmpegStatus();
        }
        await this.loadStartupFile();
    }

    waitForPyWebView() {
        return new Promise(resolve => {
            if (window.pywebview?.api) {
                resolve();
                return;
            }

            let done = false;
            const finish = () => {
                if (done || !window.pywebview?.api) return;
                done = true;
                clearInterval(timer);
                resolve();
            };

            const timer = setInterval(finish, 25);
            window.addEventListener('pywebviewready', finish, { once: true });
            finish();
        });
    }

    canUseBackend() {
        if (!this.backendReady || !this.ffmpegReady) {
            this.log('Please wait until FFmpeg is ready', 'warning');
            return false;
        }
        return true;
    }

    setInterfaceEnabled(enabled) {
        const elements = [
            this.dropZone,
            this.compressBtn,
            this.browseDefaultOutputBtn,
            this.showOutputFolderBtn,
            this.targetSize,
            this.resolution,
            this.fps,
            this.audioBitrate,
            this.encoderDevice,
            this.videoCodec,
            this.qualityBias,
            this.audioMode,
            this.matchSourceFps,
            this.usePadding,
            this.toleranceEnabled,
            this.toleranceMinus,
            this.tolerancePlus,
            this.defaultTargetSize,
            this.defaultResolution,
            this.defaultFps,
            this.defaultAudioBitrate,
            this.defaultEncoderDevice,
            this.defaultVideoCodec,
            this.defaultQualityBias,
            this.defaultAudioMode,
            this.defaultMatchSourceFps,
            this.defaultUsePadding,
            this.defaultOverwriteOutput,
            this.defaultToleranceEnabled,
            this.defaultToleranceMinus,
            this.defaultTolerancePlus,
            this.compressClipBtn,
            this.frameBackBtn,
            this.frameForwardBtn,
            this.markStartBtn,
            this.markEndBtn,
            this.clipPlayBtn,
        ];

        elements.forEach(el => {
            if (!el) return;
            if ('disabled' in el) el.disabled = !enabled;
            el.classList.toggle('is-disabled', !enabled);
        });
        this.updateAudioBitrateState();
        this.updateResolutionState();
        this.updateToleranceState();
        if (this.compressClipBtn && !this.currentFile) this.compressClipBtn.disabled = true;
        [this.frameBackBtn, this.frameForwardBtn, this.markStartBtn, this.markEndBtn, this.clipPlayBtn].forEach(el => {
            if (!el || this.currentFile) return;
            if ('disabled' in el) el.disabled = true;
        });
    }

    switchPage(pageId) {
        if (pageId !== 'clip' && this.clipVideo && !this.clipVideo.paused) {
            this.clipVideo.pause();
            this.updatePlayButton();
        }

        this.pages.forEach(page => page.classList.remove('active'));
        this.navItems.forEach(item => item.classList.remove('active'));
        document.getElementById(`${pageId}Page`).classList.add('active');
        document.querySelector(`[data-page="${pageId}"]`).classList.add('active');
    }

    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        this.dropZone.classList.add('drag-over');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        this.dropZone.classList.remove('drag-over');
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this.dropZone.classList.remove('drag-over');

        if (!this.canUseBackend()) return;
        this.loadDroppedFile(e);
    }

    handleReplaceDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!this.currentFile) return;
        this.compressPage?.classList.add('drag-over');
        this.fileInfoCard?.classList.add('drag-over');
        this.compressContainer?.classList.add('drag-over');
    }

    handleReplaceDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget.contains(e.relatedTarget)) return;
        this.clearReplaceDragState();
    }

    handleDropOnCard(e) {
        e.preventDefault();
        e.stopPropagation();
        this.clearReplaceDragState();
        if (!this.canUseBackend()) return;
        if (this.isProcessing) {
            this.log('Cancel compression before replacing the video', 'warning');
            return;
        }
        if (!this.currentFile && e.currentTarget === this.compressPage) return;
        this.loadDroppedFile(e);
    }

    clearReplaceDragState() {
        this.compressPage?.classList.remove('drag-over');
        this.fileInfoCard?.classList.remove('drag-over');
        this.compressContainer?.classList.remove('drag-over');
    }

    handleClipDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        this.clipPage?.classList.add('drag-over');
        this.clipEmpty?.classList.add('drag-over');
        this.clipWorkspace?.classList.add('drag-over');
    }

    handleClipDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget.contains(e.relatedTarget)) return;
        this.clearClipDragState();
    }

    handleClipDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this.clearClipDragState();
        if (!this.canUseBackend()) return;
        if (this.isProcessing) {
            this.log('Cancel compression before replacing the video', 'warning');
            return;
        }
        this.loadDroppedFile(e);
    }

    clearClipDragState() {
        this.clipPage?.classList.remove('drag-over');
        this.clipEmpty?.classList.remove('drag-over');
        this.clipWorkspace?.classList.remove('drag-over');
    }

    loadDroppedFile(e) {
        const file = e.dataTransfer?.files?.[0];
        const filePath = window.electronAPI?.get_dropped_file_path?.(file) || file?.path;
        if (!filePath) {
            this.log('ERROR: Could not read dropped file path', 'error');
            return;
        }
        this.loadFile(filePath);
    }

    async browseInputFile() {
        if (!this.canUseBackend()) return;

        try {
            const result = await window.pywebview.api.browse_input_file();
            if (result.path) {
                this.loadFile(result.path);
            }
        } catch (error) {
            this.log(`ERROR: ${error}`, 'error');
        }
    }

    async loadFile(filePath) {
        if (!this.canUseBackend()) {
            this.log('ERROR: Backend API not available', 'error');
            return;
        }

        const token = ++this.loadFileToken;
        this.log('--------------------------------------------------');
        this.prepareClipForNewFile();
        try {
            const fileInfo = await window.pywebview.api.load_file(filePath);
            if (token !== this.loadFileToken) return;

            if (fileInfo.success) {
                this.currentFile = fileInfo;
                if (fileInfo.is_audio_only && this.audioBitrate) {
                    this.audioBitrate.value = 'audio_only';
                }
                this.resetAudioTrackSelection(fileInfo);
                this.updateCurrentOutputPath();
                this.applySourceFps(fileInfo);
                this.displayFileInfo(fileInfo);
                this.updateClipSource(fileInfo);
                if (this.lastLoggedFilePath !== fileInfo.path) {
                    this.log(`File loaded: ${fileInfo.name}`);
                    this.lastLoggedFilePath = fileInfo.path;
                }
            } else {
                this.log(`ERROR: ${fileInfo.error}`, 'error');
            }
        } catch (error) {
            this.log(`ERROR: Failed to load file - ${error}`, 'error');
        }
    }

    async openStartupFile(filePath) {
        if (!filePath) return;
        if (this.isProcessing) {
            this.log('Cancel compression before opening another video', 'warning');
            return;
        }
        if (!this.backendReady || !this.ffmpegReady) {
            this.pendingOpenFile = filePath;
            return;
        }
        await this.loadFile(filePath);
    }

    async loadStartupFile() {
        try {
            const startupFile = this.pendingOpenFile || await window.pywebview.api.get_startup_file?.();
            this.pendingOpenFile = null;
            if (startupFile) {
                await this.openStartupFile(startupFile);
            }
        } catch (error) {
            this.log(`ERROR: Failed to open startup file - ${error}`, 'error');
        }
    }

    displayFileInfo(fileInfo) {
        this.setDoneBadge(false);
        this.setShowFolderFlash(false);
        if (this.compressBtn) this.compressBtn.disabled = !this.ffmpegReady;
        this.fileName.textContent = fileInfo.name;
        this.fileSize.textContent = `${fileInfo.size_mb.toFixed(1)} MB`;

        this.setDisplayedVideoDuration(fileInfo.duration);

        this.dropZone.style.display = 'none';
        // 'flex', not 'block': the card's vertical layout (header on top,
        // file info centered below it) is flex-column in CSS — a 'block'
        // inline style here silently disabled that centering.
        this.fileInfoCard.style.display = 'flex';
        this.fileInfoCard.classList.remove('animate-in');
        void this.fileInfoCard.offsetWidth;
        this.fileInfoCard.classList.add('animate-in');
        this.compressContainer.style.display = 'block';
    }

    setDisplayedVideoDuration(duration) {
        if (duration) {
            const minutes = Math.floor(duration / 60);
            const seconds = Math.floor(duration % 60);
            this.fileDuration.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        } else {
            this.fileDuration.textContent = '0:00';
        }
    }

    clearFile() {
        // The X button doubles as cancel: clearing the file while a compression
        // is running must stop the encode first — otherwise the job keeps
        // writing to an output the user just "removed".
        if (this.isProcessing) {
            this.cancelCompression();
        }
        this.currentFile = null;
        this.clipSourceToken += 1;
        this.cancelPreviewProxy();
        window.clearTimeout(this.clipPreviewProxyTimer);
        this.clipPreviewProxyTimer = null;
        window.clearTimeout(this.previewFrameTimer);
        this.previewFrameTimer = null;
        this.isLoadingPreviewProxy = false;
        this.usingClipPreviewProxy = false;
        this.isDraggingClipTimeline = false;
        this.clipStart = 0;
        this.clipEnd = 0;
        this.clipDuration = 0;
        this.clipZoom = 0;
        this.clipViewStart = 0;
        this.clipSeekPreviewTime = null;
        this.clipCursorLine?.classList.remove('visible');
        this.clipHoverTime?.classList.remove('visible');
        this.hideClipZoomBadge();
        this.selectedAudioTracks = new Set();
        this.renderAudioTracks();
        this.clearClipDragState();
        this.clearReplaceDragState();
        this.setDoneBadge(false);
        this.setShowFolderFlash(false);
        this.fileInfoCard.style.display = 'none';
        this.compressContainer.style.display = 'none';
        this.dropZone.style.display = 'flex';
        if (this.clipVideo) {
            this.clipVideo.pause();
            this.clipVideo.removeAttribute('src');
            this.clipVideo.load();
        }
        this.clipWorkspace.style.display = 'none';
        this.clipEmpty.style.display = 'flex';
        this.clipDurationBadge.textContent = 'No video';
        this.compressClipBtn.disabled = true;
        this.setClipControlsEnabled(false);
        this.log('Selection cleared');
    }

    outputPathWithSuffix(suffix = 'compressed') {
        if (!this.currentFile || !this.defaultOutputPath.value) return;

        const folder = this.defaultOutputPath.value.replace(/[\\\/]+$/, '');
        if (!folder) return;

        const dotIndex = this.currentFile.name.lastIndexOf('.');
        const stem = dotIndex > 0 ? this.currentFile.name.slice(0, dotIndex) : this.currentFile.name;
        const audioOnly = this.audioBitrate?.value === 'audio_only' || this.currentFile.is_audio_only;
        return `${folder}\\${stem}_${suffix}.${audioOnly ? 'mp3' : 'mp4'}`;
    }

    updateCurrentOutputPath() {
        const outputPath = this.outputPathWithSuffix('compressed');
        if (outputPath) this.currentFile.output_path = outputPath;
    }

    getCurrentSettings() {
        const audioPreset = this.audioBitrate.value;
        const audioMode = audioPreset === 'remove' ? 'remove' : this.audioMode.value;
        const audioBitrate = parseInt(audioPreset) || 128;
        return {
            target_mb: parseFloat(this.targetSize.value),
            resolution: this.resolution.value,
            fps: parseFloat(this.fps.value),
            audio_bitrate: audioBitrate,
            encoder_device: this.encoderDevice.value,
            video_codec: this.videoCodec.value,
            quality_bias: this.qualityBias.value,
            keep_original_resolution: this.resolution.value === 'original',
            audio_mode: audioMode,
            match_source_fps: this.matchSourceFps.checked,
            use_gpu: this.encoderDevice.value === 'gpu',
            use_padding: this.usePadding.checked,
            remove_audio: audioMode === 'remove',
            export_audio_only: audioPreset === 'audio_only' || this.currentFile?.is_audio_only,
            tolerance: this.getToleranceSettings()
        };
    }

    applySettingsToInputs(settings) {
        const encoderDevice = settings.encoder_device || (settings.use_gpu === false ? 'cpu' : 'gpu');
        const videoCodec = settings.video_codec || 'h264';
        const qualityBias = settings.quality_bias || 'balanced';
        const audioMode = settings.audio_mode === 'keep' ? 'keep' : 'compress';
        const audioPreset = settings.remove_audio ? 'remove' : settings.audio_bitrate || '128';
        const resolution = settings.keep_original_resolution ? 'original' : settings.resolution;

        if (settings.target_mb) this.targetSize.value = settings.target_mb;
        if (resolution) this.resolution.value = resolution;
        if (settings.fps) this.fps.value = settings.fps;
        if (audioPreset) this.audioBitrate.value = audioPreset;
        if (this.encoderDevice) this.encoderDevice.value = encoderDevice;
        if (this.videoCodec) this.videoCodec.value = videoCodec;
        if (this.qualityBias) this.qualityBias.value = qualityBias;
        if (this.audioMode) this.audioMode.value = audioMode;
        if (settings.match_source_fps !== undefined) this.matchSourceFps.checked = settings.match_source_fps;
        if (settings.use_padding !== undefined) this.usePadding.checked = settings.use_padding;

        if (settings.target_mb) this.defaultTargetSize.value = settings.target_mb;
        if (resolution) this.defaultResolution.value = resolution;
        if (settings.fps) this.defaultFps.value = settings.fps;
        if (audioPreset) this.defaultAudioBitrate.value = audioPreset;
        if (this.defaultEncoderDevice) this.defaultEncoderDevice.value = encoderDevice;
        if (this.defaultVideoCodec) this.defaultVideoCodec.value = videoCodec;
        if (this.defaultQualityBias) this.defaultQualityBias.value = qualityBias;
        if (this.defaultAudioMode) this.defaultAudioMode.value = audioMode;
        if (settings.match_source_fps !== undefined) this.defaultMatchSourceFps.checked = settings.match_source_fps;
        if (settings.use_padding !== undefined) this.defaultUsePadding.checked = settings.use_padding;
        // Off by default: duplicated outputs get " (1)", " (2)" suffixes like
        // Windows Explorer copies (the safe behavior).
        if (this.defaultOverwriteOutput) this.defaultOverwriteOutput.checked = Boolean(settings.overwrite_output);
        this.applyToleranceSettings(settings);
        this.updateQualityBiasDescriptions();
        this.updateAudioBitrateState();
        this.updateResolutionState();
    }

    markDefaultsDirty() {
        if (!this.defaultsSaveState) return;
        this.defaultsSaveState.textContent = 'Editing';
        this.defaultsSaveState.classList.add('dirty');
    }

    async saveDefaultSettings() {
        if (!this.backendReady) return;

        const settings = {
            target_mb: parseFloat(this.defaultTargetSize.value),
            resolution: this.defaultResolution.value,
            fps: parseFloat(this.defaultFps.value),
            audio_bitrate: this.defaultAudioBitrate.value,
            encoder_device: this.defaultEncoderDevice.value,
            video_codec: this.defaultVideoCodec.value,
            quality_bias: this.defaultQualityBias.value,
            keep_original_resolution: this.defaultResolution.value === 'original',
            audio_mode: this.defaultAudioMode.value,
            match_source_fps: this.defaultMatchSourceFps.checked,
            use_gpu: this.defaultEncoderDevice.value === 'gpu',
            use_padding: this.defaultUsePadding.checked,
            overwrite_output: this.defaultOverwriteOutput.checked,
            remove_audio: this.defaultAudioBitrate.value === 'remove',
            export_audio_only: this.defaultAudioBitrate.value === 'audio_only',
            tolerance: this.getToleranceSettings('default')
        };

        this.applySettingsToInputs(settings);
        this.markDefaultsDirty();

        try {
            const current = await window.pywebview.api.load_settings();
            await window.pywebview.api.save_settings({ ...current, ...settings });
            if (this.defaultsSaveState) {
                this.defaultsSaveState.textContent = 'Saved';
                this.defaultsSaveState.classList.remove('dirty');
            }
            this.log('Startup defaults saved', 'success');
        } catch (error) {
            this.log(`ERROR: Failed to save defaults - ${error}`, 'error');
        }
    }

    async startCompression(useClip = false) {
        if (!this.canUseBackend() || this.isProcessing || !this.currentFile) return;
        if (useClip && (!this.clipDuration || this.clipEnd <= this.clipStart)) {
            this.log('ERROR: Select a valid clip range first', 'error');
            return;
        }
        // If a cancel is still unwinding the previous job in the background,
        // QUEUE this start: show progress right away and wait for the old
        // ffmpeg to die (typically <2s) instead of bouncing the user with
        // "Already processing". The unwind chain ends with isCancelling=false.
        if (this.isCancelling && this.cancelUnwindPromise) {
            // Enter the visual progress state immediately so the click has
            // visible feedback while we wait for the previous job's exit.
            this.isProcessing = true;
            this.setDoneBadge(false);
            this.showProgressState(useClip);
            this.setCompressSettingsLocked(true);
            this.updateProgress(2, 'Waiting for previous job to finish...');
            await this.cancelUnwindPromise;
            if (!this.currentFile) { // cleared while waiting
                this.isProcessing = false;
                this.showButtonState();
                this.setCompressSettingsLocked(false);
                return;
            }
        }
        // Claim the job SYNCHRONOUSLY, before any await: a Cancel click
        // landing during the path-reservation stage below used to see
        // isProcessing=false, "cancel" nothing, and unlock the button while
        // this start kept running into a live ffmpeg — the "cancel works
        // every other time" bug. From here on, Cancel sees a real job.
        this.isProcessing = true;
        const runId = ++this.compressionRunId;
        this.setDoneBadge(false);
        this.showProgressState(useClip);
        this.setCompressSettingsLocked(true);
        this.startTime = Date.now();
        this.startTimer();

        this.setDisplayedVideoDuration(this.currentFile.duration);
        const outputPath = this.outputPathWithSuffix(useClip ? 'compressed_clip' : 'compressed');
        if (outputPath) {
            // Overwrite Output setting: ON reuses the exact path (ffmpeg's -y
            // replaces the previous result); OFF bumps to "name (1).mp4",
            // "name (2).mp4"... like Explorer copying into a busy folder.
            const overwrite = Boolean(this.defaultOverwriteOutput?.checked);
            this.currentFile.output_path = overwrite
                ? outputPath
                : await window.pywebview.api.reserve_output_path(outputPath);
            if (overwrite && await window.pywebview.api.path_exists(outputPath)) {
                this.log(`Overwriting existing file: ${outputPath}`);
            }
        }
        // A cancel arrived while we were reserving the path — stop here,
        // the backend never saw this job (generation was bumped in main).
        if (runId !== this.compressionRunId) {
            this.isProcessing = false;
            this.stopTimer();
            this.setCompressSettingsLocked(false);
            return;
        }

        const audioPreset = this.audioBitrate.value;
        const exportAudioOnly = audioPreset === 'audio_only' || this.currentFile.is_audio_only;
        const audioMode = audioPreset === 'remove' && !exportAudioOnly ? 'remove' : this.audioMode.value;
        const audioBitrate = parseInt(audioPreset) || 128;
        this.syncSelectedAudioTracksFromInputs();

        const params = {
            input_path: this.currentFile.path,
            output_path: this.currentFile.output_path,
            target_mb: parseFloat(this.targetSize.value),
            audio_bitrate: audioBitrate,
            resolution: this.resolution.value,
            fps: parseFloat(this.fps.value),
            encoder_device: this.encoderDevice.value,
            video_codec: this.videoCodec.value,
            quality_bias: this.qualityBias.value,
            keep_original_resolution: this.resolution.value === 'original',
            audio_mode: audioMode,
            match_source_fps: this.matchSourceFps.checked,
            use_gpu: this.encoderDevice.value === 'gpu',
            use_padding: this.usePadding.checked,
            remove_audio: audioMode === 'remove',
            export_audio_only: exportAudioOnly,
            selected_audio_tracks: audioMode === 'remove' && !exportAudioOnly ? [] : this.selectedAudioTrackList(),
            tolerance: this.getToleranceSettings(),
            clip_start: useClip ? this.clipStart : 0,
            clip_end: useClip ? this.clipEnd : 0
        };

        // Declared OUTSIDE try: the finally-block references it and must not
        // throw a ReferenceError when an early stage fails before the call.
        let call = null;
        try {
            // Track the in-flight backend job so cancelCompression can await
            // its full unwind (the backend's finally releases the job lock)
            // before a new start is allowed — no more overlapping encodes.
            // The promise is attached synchronously: between creating it and
            // awaiting there is no gap where a Cancel could miss the job.
            call = window.pywebview.api.compress_video(params);
            this.activeCompressionPromise = call;
            const result = await call;
            if (runId !== this.compressionRunId) return;

            if (result.success) {
                if (this.currentFile) {
                    this.currentFile.output_path = result.output_path;
                }
                this.updateProgress(100, 'Completed successfully!');
                this.log('Compression completed successfully!', 'success');
                this.log(`Output: ${result.output_path}`, 'success');
                this.log(`Final size: ${result.final_size_mb.toFixed(3)} MB`, 'success');
                this.log(`Time elapsed: ${result.elapsed_time.toFixed(1)}s`, 'success');
                this.setDoneBadge(true);
                this.setShowFolderFlash(true);
                this.setCompressSettingsLocked(false);

                setTimeout(() => {
                    if (runId !== this.compressionRunId) return;
                    this.showButtonState();
                    this.resetProgress();
                }, 3000);
            } else {
                this.log(`ERROR: ${result.error}`, 'error');
                this.playRenderErrorSound();
                this.updateProgress(0, 'Error occurred');
                if (this.currentFile) this.currentFile.output_path = null;
                this.setShowFolderFlash(false);
                this.setCompressSettingsLocked(false);
                this.showButtonState();
            }
        } catch (error) {
            if (runId !== this.compressionRunId) return;
            this.log(`ERROR: ${error}`, 'error');
            this.playRenderErrorSound();
            this.updateProgress(0, 'Error occurred');
            if (this.currentFile) this.currentFile.output_path = null;
            this.setShowFolderFlash(false);
            this.setCompressSettingsLocked(false);
            this.showButtonState();
        } finally {
            if (runId === this.compressionRunId) {
                this.isProcessing = false;
                this.stopTimer();
                this.setCompressSettingsLocked(false);
            }
            // Only clear the tracked promise if it's still ours — cancel's
            // await on it has priority, and a NEW job may already own it.
            if (this.activeCompressionPromise === call) {
                this.activeCompressionPromise = null;
            }
        }
    }

    playRenderErrorSound() {
        try {
            window.pywebview?.api?.play_error_sound?.();
        } catch {}
    }

    async cancelCompression() {
        if (!this.isProcessing && !this.activeCompressionPromise) return;
        this.compressionRunId++;
        this.isCancelling = true;
        this.log('Cancelling...', 'warning');
        // 1. UI reacts INSTANTLY: kill the timer, restore the button. The
        //    user must never wait for the backend to unwind — the hard
        //    taskkill + deferred cleanup in main make the kill itself fast,
        //    but the compress_video promise may still take a moment to
        //    resolve, and that is background bookkeeping, not UX.
        this.stopTimer();
        this.isProcessing = false;
        this.showButtonState();
        this.setCompressSettingsLocked(false);
        if (this.currentFile) this.currentFile.output_path = null;
        this.setShowFolderFlash(false);
        this.resetProgress();
        this.log('Compression cancelled by user', 'warning');
        // 2. Fire the backend kill and await full unwind in the background.
        //    startCompression(), if clicked during this window, ALSO waits
        //    on this same chain — so a restart is queued, not rejected.
        const unwind = (async () => {
            try {
                if (window.pywebview) {
                    await window.pywebview.api.cancel_compression();
                }
            } catch { /* backend may already be done */ }
            if (this.activeCompressionPromise) {
                try { await this.activeCompressionPromise; } catch { /* handled by its owner */ }
            }
            this.isCancelling = false;
        })();
        this.cancelUnwindPromise = unwind;
    }

    setDoneBadge(visible) {
        if (!this.doneBadge) return;
        this.doneBadge.style.display = visible ? 'inline-flex' : 'none';
    }

    setShowFolderFlash(visible) {
        if (!this.showOutputFolderBtn) return;
        clearTimeout(this.showFolderFlashTimer);
        this.showOutputFolderBtn.classList.toggle('done-flash', visible);
        if (visible) {
            this.showFolderFlashTimer = setTimeout(() => {
                this.showOutputFolderBtn.classList.remove('done-flash');
            }, 3000);
        }
    }

    showProgressState(useClip = false, replayAnimation = true) {
        const wasVisible = this.progressCard.style.display !== 'none';
        this.resetProgress(useClip);
        this.compressBtn.style.display = 'none';
        this.progressCard.style.display = 'flex';
        // Replay the slide-in ONLY on a real button→progress transition.
        // A second call while the card is already showing (queued restart
        // waiting for the previous job to die) must NOT restart the
        // animation — that was the "progress flashes twice" bug.
        if (replayAnimation && !wasVisible) {
            this.progressCard.style.animation = 'none';
            void this.progressCard.offsetWidth;
            this.progressCard.style.animation = '';
        }
    }

    showButtonState() {
        this.progressCard.style.display = 'none';
        this.compressBtn.style.display = 'flex';
    }

    updateProgress(percent, status) {
        this.progressPercent.textContent = `${percent}%`;
        this.progressStatus.textContent = status;
        this.progressFill.style.width = `${percent}%`;
    }

    setRenderMode(useClip = false) {
        if (!this.renderModeBadge) return;
        const clipDuration = Math.max(0, this.clipEnd - this.clipStart);
        this.renderModeBadge.textContent = useClip ? `Clip ${this.formatClipDuration(clipDuration)}` : 'Full video';
        this.renderModeBadge.classList.toggle('clip-mode', useClip);
    }

    resetProgress(useClip = false) {
        this.stopTimer();
        if (this.progressTime) this.progressTime.textContent = 'Time elapsed: 0s';
        this.setRenderMode(useClip);
        this.updateProgress(0, 'Initializing...');
    }

    startTimer() {
        this.stopTimer();
        if (this.progressTime) this.progressTime.textContent = 'Time elapsed: 0s';
        this.timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            this.progressTime.textContent = `Time elapsed: ${elapsed}s`;
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    async browseDefaultOutput() {
        if (!this.backendReady) return;

        try {
            const result = await window.pywebview.api.browse_output_folder();
            if (result.path) {
                this.defaultOutputPath.value = result.path;
                const current = await window.pywebview.api.load_settings();
                await window.pywebview.api.save_settings({ ...current, last_out_dir: result.path });
                this.updateCurrentOutputPath();
                this.log(`Output folder: ${result.path}`);
            }
        } catch (error) {
            this.log(`ERROR: ${error}`, 'error');
        }
    }

    async showOutputInFolder() {
        if (!this.backendReady) return;

        try {
            if (!this.currentFile || !this.currentFile.output_path) {
                this.log('ERROR: No output file selected yet', 'error');
                return;
            }

            const result = await window.pywebview.api.show_in_folder(this.currentFile.output_path);
            if (!result.success) {
                this.log(`ERROR: ${result.error}`, 'error');
            }
        } catch (error) {
            this.log(`ERROR: ${error}`, 'error');
        }
    }

    async loadSettings() {
        if (!window.pywebview) return;

        try {
            const settings = await window.pywebview.api.load_settings();

            if (settings.last_out_dir) {
                this.defaultOutputPath.value = settings.last_out_dir;
            }

            this.applySettingsToInputs(settings);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    async checkFFmpegStatus() {
        if (!window.pywebview) return;

        this.ffmpegReady = false;
        this.setInterfaceEnabled(false);

        try {
            const api = window.pywebview.api;
            const getStatus = api.get_ffmpeg_status || api.getFfmpegStatus || api.getFFmpegStatus;
            if (!getStatus) {
                if (this.lastFFmpegStatus) {
                    this.updateFFmpegStatus(this.lastFFmpegStatus);
                    return this.lastFFmpegStatus;
                }
                throw new Error(`FFmpeg status API is missing. Available API: ${Object.keys(api).join(', ')}`);
            }

            let status = await getStatus();
            for (let attempt = 0; attempt < 3 && !status.found; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 150));
                status = await getStatus();
            }
            this.updateFFmpegStatus(status);
            return status;
        } catch (error) {
            const status = { found: false, path: 'API error', version: String(error) };
            this.updateFFmpegStatus(status);
            return status;
        }
    }

    updateFFmpegStatus(status) {
        const statusIndicator = this.ffmpegStatus.querySelector('.status-indicator');
        const statusValue = this.ffmpegStatus.querySelector('.status-value');

        if (status.found) {
            statusIndicator.style.background = '#4CAF50';
            statusValue.textContent = 'Ready';
            this.ffmpegReady = true;
            this.setInterfaceEnabled(true);
            if (this.lastLoggedFFmpegPath !== status.path) {
                this.log(`FFmpeg: ${status.path}`);
                this.lastLoggedFFmpegPath = status.path;
            }
        } else {
            statusIndicator.style.background = '#FF5252';
            statusValue.textContent = 'Not found';
            this.ffmpegReady = false;
            this.setInterfaceEnabled(false);
            if (this.lastLoggedFFmpegPath !== status.path) {
                this.log(`ERROR: FFmpeg not found: ${status.path || 'unknown path'}`, 'error');
                if (status.version) {
                    this.log(`ERROR: ${status.version}`, 'error');
                }
                this.lastLoggedFFmpegPath = status.path;
            }
        }

        this.applyNvencStatus(status.nvenc);
    }

    // status.nvenc: null = probe not finished yet, true/false after probe.
    // When false, GPU encodes would fail mid-run on this machine, so the GPU
    // option is disabled and CPU is selected instead.
    applyNvencStatus(nvenc) {
        const gpuOption = this.encoderDevice?.querySelector('option[value="gpu"]');
        const defaultGpuOption = this.defaultEncoderDevice?.querySelector('option[value="gpu"]');
        if (nvenc === null || nvenc === undefined) {
            [gpuOption, defaultGpuOption].forEach(option => {
                if (option) {
                    option.disabled = false;
                    option.textContent = 'GPU';
                }
            });
            return;
        }

        [gpuOption, defaultGpuOption].forEach(option => {
            if (!option) return;
            option.disabled = !nvenc;
            option.textContent = nvenc ? 'GPU' : 'GPU unavailable';
        });

        if (!nvenc) {
            if (this.encoderDevice?.value === 'gpu') {
                this.encoderDevice.value = 'cpu';
                if (!this.switchedToCpuLogged) {
                    this.switchedToCpuLogged = true;
                    this.log('Switched to CPU encoding: NVENC not available on this machine', 'warning');
                }
            }
            if (this.defaultEncoderDevice?.value === 'gpu') {
                this.defaultEncoderDevice.value = 'cpu';
            }
        }
    }

    log(message, type = 'info') {
        const logLine = document.createElement('div');
        logLine.className = `log-line ${type}`;

        const timestamp = new Date().toLocaleTimeString();
        logLine.textContent = `[${timestamp}] ${message}`;

        const emptyState = this.logContainer.querySelector('.log-empty');
        if (emptyState) {
            emptyState.remove();
        }

        this.logContainer.appendChild(logLine);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }

    copyLogs() {
        const logs = Array.from(this.logContainer.querySelectorAll('.log-line'))
            .map(line => line.textContent)
            .join('\n');

        navigator.clipboard.writeText(logs).then(() => {
            const originalText = this.copyLogsBtn.textContent;
            this.copyLogsBtn.textContent = 'Copied!';
            setTimeout(() => {
                this.copyLogsBtn.textContent = originalText;
            }, 2000);
        });
    }

    onProgress(percent, status) {
        this.updateProgress(percent, status);
    }

    onLog(message, type = 'info') {
        this.log(message, type);
    }

    onFFmpegStatus(status) {
        this.lastFFmpegStatus = status;
        this.updateFFmpegStatus(status);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new VCompress();
});

window.onProgress = (percent, status) => {
    if (window.app) {
        window.app.onProgress(percent, status);
    }
};

window.onLog = (message, type) => {
    if (window.app) {
        window.app.onLog(message, type);
    }
};

window.onFFmpegStatus = (status) => {
    window.pendingFFmpegStatus = status;
    if (window.app) {
        window.app.onFFmpegStatus(status);
    }
};

window.onNativeFileDrop = (filePath) => {
    if (window.app) {
        window.app.log('Dropped file detected');
        window.app.loadFile(filePath);
    }
};




