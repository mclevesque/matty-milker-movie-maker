// Matty Milker Movie Maker - Renderer
// Electron: Native FFmpeg with GPU NVENC — blazing fast
// Web fallback: WebCodecs

class Renderer {
    constructor() {
        this.lastExportBlob = null;
        this.cancelled = false;
        this.isElectron = !!(window.electronAPI);
    }

    static EXPORT_PRESETS = {
        'youtube-4k': { label: '4K Ultra HD (2160p)', width: 3840, height: 2160, fps: 60, videoBitrate: '35M', audioBitrate: '384k', description: 'Best quality for YouTube.' },
        'youtube-1440p': { label: '2K QHD (1440p)', width: 2560, height: 1440, fps: 60, videoBitrate: '16M', audioBitrate: '384k', description: 'Great quality.' },
        'youtube-1080p60': { label: '1080p 60fps (Recommended)', width: 1920, height: 1080, fps: 60, videoBitrate: '12M', audioBitrate: '320k', description: "YouTube's sweet spot." },
        'youtube-1080p30': { label: '1080p 30fps', width: 1920, height: 1080, fps: 30, videoBitrate: '8M', audioBitrate: '256k', description: 'Standard HD.' },
        'youtube-720p': { label: '720p HD', width: 1280, height: 720, fps: 30, videoBitrate: '5M', audioBitrate: '192k', description: 'Fast upload.' },
        'youtube-shorts': { label: 'YouTube Shorts (1080x1920)', width: 1080, height: 1920, fps: 30, videoBitrate: '8M', audioBitrate: '256k', description: 'Vertical for Shorts.' },
    };

    cancel() {
        this.cancelled = true;
        if (this.isElectron) window.electronAPI.cancelExport();
    }

    async exportVideo(timeline, mediaItems, canvas, settings, bgMusic, onProgress, onStatus) {
        this.cancelled = false;
        if (this.isElectron) {
            return this._exportElectron(timeline, mediaItems, settings, bgMusic, onProgress, onStatus);
        }
        return this._exportWeb(timeline, mediaItems, canvas, settings, onProgress, onStatus);
    }

    // ══════════════════════════════════════════════════════════
    // ELECTRON EXPORT — Native FFmpeg, GPU NVENC, all codecs
    // ══════════════════════════════════════════════════════════
    async _exportElectron(timeline, mediaItems, settings, bgMusic, onProgress, onStatus) {
        const api = window.electronAPI;
        const preset = Renderer.EXPORT_PRESETS[settings.preset] || Renderer.EXPORT_PRESETS['youtube-1080p60'];

        try {
            onStatus('Checking GPU encoder...');
            onProgress(3);

            // Use pre-chosen path from app.js, or prompt now
            let outputPath = settings._outputPath;
            if (!outputPath) {
                outputPath = await api.saveFileDialog(
                    (settings.filename || 'Matty_Milker_Export') + '.mp4'
                );
            }
            if (!outputPath) { onStatus('Cancelled'); return false; }

            // Build clip list — in Electron, dropped files have .path for real filesystem paths
            const videoClips = timeline.getClipsForTrack('video');
            const inputFiles = [], durations = [], types = [];

            for (const clip of videoClips) {
                const mi = mediaItems.find(m => m.id === clip.mediaId);
                if (!mi) continue;

                let filePath = mi.filePath;
                if (!filePath && mi.file && mi.file.path) {
                    filePath = mi.file.path; // Electron drag-drop gives .path
                }
                if (!filePath && mi.file instanceof Blob) {
                    // Web-imported file — write to temp in chunks to avoid array overflow
                    const arrayBuffer = await mi.file.arrayBuffer();
                    filePath = await api.writeTempFileBuffer(mi.name, arrayBuffer);
                }
                if (!filePath) continue;

                inputFiles.push(filePath);
                durations.push(clip.duration);
                types.push(mi.type);
            }

            if (inputFiles.length === 0) { onStatus('No clips to export'); return false; }

            let bgMusicPath = null;
            if (bgMusic) {
                bgMusicPath = bgMusic.filePath || (bgMusic.file && bgMusic.file.path) || null;
                if (!bgMusicPath && bgMusic.file instanceof Blob) {
                    const ab = await bgMusic.file.arrayBuffer();
                    bgMusicPath = await api.writeTempFileBuffer(bgMusic.name, ab);
                }
            }

            onProgress(5);
            onStatus('Starting FFmpeg...');

            // Listen for progress updates from main process
            api.onExportProgress((data) => {
                onProgress(data.percent);
                onStatus(data.status);
            });

            await api.exportVideo({
                input_files: inputFiles,
                durations,
                types,
                output_path: outputPath,
                width: preset.width,
                height: preset.height,
                fps: preset.fps,
                video_bitrate: preset.videoBitrate,
                audio_bitrate: preset.audioBitrate,
                background_music: bgMusicPath,
            });

            onProgress(100);
            onStatus('Done! Saved to ' + outputPath);
            return true;
        } catch (err) {
            onStatus('Export failed: ' + (err.message || err));
            return false;
        }
    }

    // ══════════════════════════════════════════════════════════
    // WEB EXPORT — WebCodecs fallback (Chrome only)
    // ══════════════════════════════════════════════════════════
    async _exportWeb(timeline, mediaItems, canvas, settings, onProgress, onStatus) {
        const preset = Renderer.EXPORT_PRESETS[settings.preset] || Renderer.EXPORT_PRESETS['youtube-1080p60'];
        const fps = preset.fps;
        const totalDuration = timeline.getTotalDuration();
        if (totalDuration <= 0) { onStatus('No clips'); return false; }

        if (typeof VideoEncoder === 'undefined') {
            onStatus(/Chrome/.test(navigator.userAgent) ? 'Update Chrome to 94+.' : 'Export requires Google Chrome.');
            return false;
        }

        try {
            const mod = await import('./webm-muxer.js');
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = preset.width; exportCanvas.height = preset.height;
            const ctx = exportCanvas.getContext('2d');
            const totalFrames = Math.ceil(totalDuration * fps);
            const frameDurUs = Math.round(1_000_000 / fps);
            const bitrate = parseInt(preset.videoBitrate) * 1_000_000;

            let codec = 'vp09.00.10.08';
            try { const s = await VideoEncoder.isConfigSupported({ codec, width: preset.width, height: preset.height, bitrate, framerate: fps }); if (!s.supported) codec = 'vp8'; } catch(e) { codec = 'vp8'; }

            const target = new mod.ArrayBufferTarget();
            const muxer = new mod.Muxer({ target, video: { codec: 'V_VP9', width: preset.width, height: preset.height, frameRate: fps }, firstTimestampBehavior: 'offset' });
            const encoder = new VideoEncoder({
                output: (c, m) => muxer.addVideoChunk(c, m),
                error: (e) => console.error(e),
            });
            encoder.configure({ codec, width: preset.width, height: preset.height, bitrate, framerate: fps });

            onProgress(10); onStatus('Encoding...');

            for (let i = 0; i < totalFrames; i++) {
                if (this.cancelled) break;
                const time = i / fps;
                ctx.fillStyle = '#000'; ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
                const clip = timeline.getClipAtTime(time, 'video');
                if (clip) {
                    const mi = mediaItems.find(m => m.id === clip.mediaId);
                    if (mi?.type === 'image' && mi.element) ctx.drawImage(mi.element, 0, 0, exportCanvas.width, exportCanvas.height);
                    else if (mi?.type === 'video' && mi.element) {
                        if (i % 3 === 0) { mi.element.currentTime = clip.trimStart + (time - clip.startTime); await new Promise(r => { mi.element.onseeked = r; setTimeout(r, 50); }); }
                        try { ctx.drawImage(mi.element, 0, 0, exportCanvas.width, exportCanvas.height); } catch(e) {}
                    }
                }
                const tc = timeline.getClipAtTime(time, 'text');
                if (tc) this._renderText(ctx, exportCanvas, tc);
                const frame = new VideoFrame(exportCanvas, { timestamp: i * frameDurUs, duration: frameDurUs });
                encoder.encode(frame, { keyFrame: (i % (fps*2)) === 0 }); frame.close();
                if (encoder.encodeQueueSize > 5) await new Promise(r => setTimeout(r, 1));
                if (i % 15 === 0) { await new Promise(r => setTimeout(r, 0)); onProgress(10+Math.round((i/totalFrames)*80)); onStatus(`${Math.round(time)}s/${Math.round(totalDuration)}s (${Math.round(i/totalFrames*100)}%)`); }
            }

            await encoder.flush(); encoder.close(); muxer.finalize();
            const blob = new Blob([target.buffer], { type: 'video/webm' });
            this.lastExportBlob = blob;
            onProgress(100); onStatus(`Done! (${(blob.size/1048576).toFixed(1)} MB)`);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = (settings.filename||'export')+'.webm'; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return true;
        } catch (err) { onStatus('Export failed: ' + err.message); return false; }
    }

    _renderText(ctx, canvas, clip) {
        const lines = (clip.text||'').split('\n');
        const fs = clip.fontSize||48;
        ctx.font = `bold ${fs}px 'Segoe UI',Arial`; ctx.textAlign = 'center'; ctx.fillStyle = clip.fontColor||'#fff';
        let y; switch(clip.textPosition) { case 'top': y=fs+40; break; case 'bottom': y=canvas.height-40; break; case 'lower-third': y=canvas.height*0.78; break; default: y=canvas.height/2-((lines.length-1)*fs)/2; }
        for (const line of lines) {
            if (clip.textBg==='shadow') { ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=8; ctx.shadowOffsetX=2; ctx.shadowOffsetY=2; }
            else if (clip.textBg==='box') { const m=ctx.measureText(line); ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(canvas.width/2-m.width/2-10,y-fs+6,m.width+20,fs+4); ctx.fillStyle=clip.fontColor||'#fff'; }
            ctx.fillText(line,canvas.width/2,y); ctx.shadowColor='transparent'; ctx.shadowBlur=0; y+=fs+4;
        }
    }
}
