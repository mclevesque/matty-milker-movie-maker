// Matty Milker Movie Maker - Main Application

class MattCutApp {
    constructor() {
        this.timeline = new TimelineManager();
        this.renderer = new Renderer();
        this.mediaItems = [];
        this.nextMediaId = 1;
        this.isPlaying = false;
        this.currentTime = 0;
        this.animFrame = null;
        this.backgroundMusic = null;
        this.musicAttribution = null; // { title, artist, url, license }
        this.previewAudio = null; // for previewing music tracks
        this.projectName = 'Untitled Project';
        this.projectFileHandle = null; // File System Access API handle for Save
        this.hasUnsavedChanges = false;
        this._editingTextClipId = null;
        this._undoStack = [];
        this._maxUndoSteps = 50;

        this.canvas = document.getElementById('previewCanvas');
        this.ctx = this.canvas.getContext('2d');

        this._setupUI();
        this._setupDropZone();
        this._setupTimeline();
        this._setupModals();
        this._setupMediaBinTabs();
        this._setupTitlePresets();
        this._setupPublishModal();
        this._setupAudioBar();
        this._setupMusicBrowser();
        this._setupPreviewResolution();
        this._setupFileMenu();
        this._drawBlank();
        this._renderStoryboard(); // Render empty storyboard with drop-enabled placeholders
    }

    // ── UI Setup ──

    _setupUI() {
        document.getElementById('btnImport').addEventListener('click', () => this._importMediaClick());
        document.getElementById('fileInput').addEventListener('change', (e) => { this._importFiles(e.target.files); e.target.value = ''; });

        document.getElementById('linkImportVideo').addEventListener('click', () => this._importMediaClick('video'));
        document.getElementById('linkImportPictures').addEventListener('click', () => this._importMediaClick('image'));
        document.getElementById('linkImportAudio').addEventListener('click', () => this._importMediaClick('audio'));
        // Web fallback inputs (non-Tauri only)
        document.getElementById('videoInput').addEventListener('change', (e) => { this._importFiles(e.target.files); e.target.value = ''; });
        document.getElementById('imageInput').addEventListener('change', (e) => { this._importFiles(e.target.files); e.target.value = ''; });
        document.getElementById('audioInput').addEventListener('change', (e) => { this._importFiles(e.target.files); e.target.value = ''; });

        document.getElementById('linkImportedMedia').addEventListener('click', () => this._switchBinTab('media'));
        document.getElementById('linkEffects').addEventListener('click', () => this._switchBinTab('effects'));
        document.getElementById('linkTransitions').addEventListener('click', () => this._switchBinTab('transitions'));
        document.getElementById('linkTitles').addEventListener('click', () => this._switchBinTab('titles'));
        document.getElementById('linkFreeMusic').addEventListener('click', () => this._switchBinTab('music'));
        document.getElementById('linkPublishPC').addEventListener('click', () => this._showPublishModal('computer'));
        document.getElementById('linkPublishYT').addEventListener('click', () => this._showPublishModal('youtube'));

        document.getElementById('btnPlay').addEventListener('click', () => this._togglePlay());
        document.getElementById('btnRewind').addEventListener('click', () => this._rewind());
        document.getElementById('btnStepBack').addEventListener('click', () => { this.currentTime = Math.max(0, this.currentTime - 1/30); this._seekTo(this.currentTime); });
        document.getElementById('btnStepFwd').addEventListener('click', () => { this.currentTime = Math.min(this.timeline.getTotalDuration(), this.currentTime + 1/30); this._seekTo(this.currentTime); });
        document.getElementById('btnFastFwd').addEventListener('click', () => { this.currentTime = Math.min(this.timeline.getTotalDuration(), this.currentTime + 5); this._seekTo(this.currentTime); });
        document.getElementById('btnSplit').addEventListener('click', () => this._splitAtPlayhead());
        document.getElementById('btnDelete').addEventListener('click', () => this._deleteSelected());

        // Scrub bar for easy scanning
        this._setupScrubBar();
        document.getElementById('btnZoomIn').addEventListener('click', () => this.timeline.setZoom(1));
        document.getElementById('btnZoomOut').addEventListener('click', () => this.timeline.setZoom(-1));
        document.getElementById('btnPublish').addEventListener('click', () => this._showPublishModal());

        document.getElementById('tabStoryboard').addEventListener('click', () => {
            document.getElementById('tabStoryboard').classList.add('active');
            document.getElementById('tabTimeline').classList.remove('active');
            document.getElementById('storyboardTrack').classList.remove('hidden');
            document.getElementById('timelineView').classList.add('hidden');
        });
        document.getElementById('tabTimeline').addEventListener('click', () => {
            document.getElementById('tabTimeline').classList.add('active');
            document.getElementById('tabStoryboard').classList.remove('active');
            document.getElementById('timelineView').classList.remove('hidden');
            document.getElementById('storyboardTrack').classList.add('hidden');
        });

        // Export preset description
        const presetSelect = document.getElementById('exportPreset');
        if (presetSelect) {
            presetSelect.addEventListener('change', () => {
                const info = document.getElementById('presetInfo');
                const preset = Renderer.EXPORT_PRESETS[presetSelect.value];
                if (info && preset) info.textContent = preset.description;
            });
        }

        document.addEventListener('keydown', (e) => {
            // Ctrl+S / Cmd+S to save project
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this._saveProject();
                return;
            }
            // ESC closes any open modal or file menu
            if (e.code === 'Escape') {
                document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
                this._closeFileMenu();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
                e.preventDefault();
                this._undo();
                return;
            }
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
            switch (e.code) {
                case 'Space': e.preventDefault(); this._togglePlay(); break;
                case 'Delete': case 'Backspace': this._deleteSelected(); break;
            }
        });

        // Click outside modal to close
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.remove('active');
            });
        });

        // Cancel export
        document.getElementById('btnExportCancel').addEventListener('click', () => {
            this.renderer.cancel();
            this._hideModal('exportModal');
            document.getElementById('exportProgress').style.width = '0%';
            this._toast('Export cancelled', 'warning');
        });
    }

    _setupPreviewResolution() {
        const resSelect = document.getElementById('previewResolution');
        resSelect.addEventListener('change', () => {
            const [w, h] = resSelect.value.split('x').map(Number);
            this.canvas.width = w;
            this.canvas.height = h;
            this._renderPreviewFrame(this.currentTime);
        });
    }

    _setupDropZone() {
        const dropZone = document.getElementById('dropZone');
        const centerArea = document.querySelector('.center-area');

        // Drop zone click — uses Tauri native dialog when available
        dropZone.addEventListener('click', () => this._importMediaClick());

        // Accept drops on the entire center area + drop zone
        [dropZone, centerArea].forEach(el => {
            el.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
            el.addEventListener('dragleave', (e) => {
                // Only remove highlight when leaving the center area entirely
                if (el === centerArea && !centerArea.contains(e.relatedTarget)) {
                    dropZone.classList.remove('drag-over');
                }
            });
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('drag-over');
                if (e.dataTransfer.files.length > 0) {
                    // Always use web File API — works in both browser and Tauri
                    this._importFiles(e.dataTransfer.files);
                }
            });
        });

        // CRITICAL: Prevent browser/Electron from navigating to dropped files
        // Always preventDefault on dragover and drop at document level
        document.addEventListener('dragover', (e) => { e.preventDefault(); });
        document.addEventListener('dragenter', (e) => { e.preventDefault(); });
        document.addEventListener('drop', (e) => {
            e.preventDefault(); // ALWAYS prevent navigation
            // Only import if no child handler already processed this drop
            if (!e.defaultPrevented || !e._handled) {
                const target = e.target;
                const isHandledZone = target.closest('.sb-clip, .sb-placeholder, .sb-drop-slot, .timeline-row, .drop-zone, .center-area, .media-grid, .track-audio-main');
                if (!isHandledZone && e.dataTransfer.files.length > 0) {
                    this._importFiles(e.dataTransfer.files);
                }
            }
        });

        // In Electron, drag-dropped files have .path with real filesystem paths
        // The standard HTML5 drag-drop handlers in _setupUI already call _importFiles
        // which reads file.path — no special Electron listener needed
    }

    _setupTimeline() {
        this.timeline.onSeek = (time) => this._seekTo(time);
        this.timeline.onSelect = () => this._renderStoryboard();
        this.timeline.onTextEdit = (clip) => this._editTextClip(clip.id);
    }

    _setupMediaBinTabs() {
        document.querySelectorAll('.bin-tab').forEach(tab => {
            tab.addEventListener('click', () => this._switchBinTab(tab.dataset.pane));
        });
        document.querySelectorAll('.preset-card[data-effect]').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.preset-card[data-effect]').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                const clip = this.timeline.getSelectedClip();
                if (clip) { clip.effect = card.dataset.effect; this._renderPreviewFrame(this.currentTime); }
            });
        });
        document.querySelectorAll('.preset-card[data-transition]').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.preset-card[data-transition]').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                const clip = this.timeline.getSelectedClip();
                if (clip) { this.timeline.addTransition(clip.id, card.dataset.transition, 1); this._renderStoryboard(); }
            });
        });
    }

    _switchBinTab(paneName) {
        document.querySelectorAll('.bin-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.bin-pane').forEach(p => p.classList.remove('active'));
        const tab = document.querySelector(`.bin-tab[data-pane="${paneName}"]`);
        const pane = document.getElementById('pane' + paneName.charAt(0).toUpperCase() + paneName.slice(1));
        if (tab) tab.classList.add('active');
        if (pane) pane.classList.add('active');
        document.querySelectorAll('.task-link').forEach(l => l.classList.remove('active-link'));
        const linkMap = { media:'linkImportedMedia', effects:'linkEffects', transitions:'linkTransitions', titles:'linkTitles', music:'linkFreeMusic' };
        const link = document.getElementById(linkMap[paneName]);
        if (link) link.classList.add('active-link');
    }

    _setupTitlePresets() {
        const presets = {
            'intro-centered': { text: 'MY MOVIE', fontSize: 56, fontColor: '#ffffff', textPosition: 'center', textBg: 'shadow', duration: 5 },
            'intro-fade': { text: 'Title Here', fontSize: 44, fontColor: '#ffffff', textPosition: 'center', textBg: 'none', duration: 4 },
            'lower-third': { text: 'Name Here', fontSize: 28, fontColor: '#ffffff', textPosition: 'lower-third', textBg: 'box', duration: 4 },
            'credits': { text: 'Directed by\nMatt', fontSize: 36, fontColor: '#ffffff', textPosition: 'center', textBg: 'none', duration: 6 },
            'chapter': { text: 'Chapter 1', fontSize: 40, fontColor: '#ffffff', textPosition: 'center', textBg: 'shadow', duration: 3 },
            'custom': null,
        };
        document.querySelectorAll('.title-preset').forEach(card => {
            card.addEventListener('click', () => {
                const name = card.dataset.preset;
                const p = presets[name];
                if (p) {
                    // Pre-fill modal with preset values
                    document.getElementById('textInput').value = p.text;
                    document.getElementById('textSize').value = p.fontSize;
                    document.getElementById('textSizeVal').textContent = p.fontSize + 'px';
                    document.getElementById('textColor').value = p.fontColor;
                    document.getElementById('textPosition').value = p.textPosition;
                    document.getElementById('textBg').value = p.textBg;
                    document.getElementById('textDuration').value = p.duration;
                }
                // Always open modal so user can customize before adding
                this._editingTextClipId = null; // new clip, not editing
                document.getElementById('textModalTitle').textContent = 'Add Title';
                this._showTextModal();
            });
        });
    }

    // ── Audio / Music Track ──

    _setupAudioBar() {
        // Music file input handler
        document.getElementById('musicInput').addEventListener('change', (e) => {
            for (const f of e.target.files) this._importAudioToTimeline(f);
            e.target.value = '';
        });

        // Make the Music timeline track clickable and droppable
        const audioTrack = document.querySelector('.track-audio-main');
        if (audioTrack) {
            // Click label or empty area to open file picker
            audioTrack.addEventListener('click', (e) => {
                if (!e.target.closest('.timeline-clip')) {
                    document.getElementById('musicInput').click();
                }
            });
            audioTrack.style.cursor = 'pointer';

            // Drag-drop onto music track
            audioTrack.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                audioTrack.style.background = 'rgba(106,159,232,0.2)';
            });
            audioTrack.addEventListener('dragleave', () => {
                audioTrack.style.background = '';
            });
            audioTrack.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                audioTrack.style.background = '';
                if (e.dataTransfer.files.length > 0) {
                    for (const f of e.dataTransfer.files) {
                        if (f.type.startsWith('audio/') || ['mp3','wav','ogg','aac','flac','m4a'].includes(f.name.split('.').pop().toLowerCase())) {
                            this._importAudioToTimeline(f);
                        }
                    }
                }
            });
        }
    }

    async _importAudioToTimeline(file) {
        const realPath = file.path || null;
        const isElectron = !!(window.electronAPI);
        let mediaUrl;
        if (isElectron && realPath) {
            const normalized = realPath.replace(/\\/g, '/');
            mediaUrl = 'file:///' + normalized;
        } else {
            mediaUrl = URL.createObjectURL(file);
        }

        const audio = new Audio(mediaUrl);
        audio.crossOrigin = 'anonymous';
        audio.preload = 'metadata';
        await new Promise(r => { audio.onloadedmetadata = () => r(); audio.onerror = () => r(); });

        const item = {
            id: this.nextMediaId++, name: file.name, type: 'audio',
            file, filePath: realPath, url: mediaUrl,
            duration: audio.duration || 5, element: audio, track: 'audio',
        };
        this.mediaItems.push(item);
        this.timeline.addClip(item);
        this._renderStoryboard();
        this._renderPreviewFrame(this.currentTime);
        this._toast(`Music added: ${file.name}`, 'success');
        if (this._markUnsaved) this._markUnsaved();
    }

    async _importBackgroundMusic(file, attribution) {
        const audio = new Audio();
        const url = URL.createObjectURL(file);
        audio.src = url;
        await new Promise(r => { audio.onloadedmetadata = r; audio.onerror = r; });
        this.backgroundMusic = { id: this.nextMediaId++, name: file.name, file, url, duration: audio.duration || 0, element: audio };
        this.musicAttribution = attribution || null;
        this._renderAudioBar();
    }

    _setBackgroundMusicFromUrl(audioUrl, attribution) {
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.src = audioUrl;
        audio.addEventListener('loadedmetadata', () => {
            // We need a File for export — fetch the blob
            fetch(audioUrl)
                .then(r => r.blob())
                .then(blob => {
                    const file = new File([blob], attribution.title + '.mp3', { type: 'audio/mpeg' });
                    this.backgroundMusic = { id: this.nextMediaId++, name: attribution.title, file, url: audioUrl, duration: audio.duration || 0, element: audio };
                    this.musicAttribution = attribution;
                    this._renderAudioBar();
                    this._updateYTAttribution();
                });
        });
        audio.addEventListener('error', () => {
            alert('Could not load this track. Try another one.');
        });
    }

    _renderAudioBar() {
        const attrEl = document.getElementById('audioAttribution');
        // Music is now managed via timeline clips — just update attribution
        if (this.musicAttribution) {
            attrEl.classList.remove('hidden');
            attrEl.innerHTML = `Music: "${this.musicAttribution.title}" by ${this.musicAttribution.artist} ` +
                `(${this.musicAttribution.license}) ` +
                (this.musicAttribution.url ? `<a href="${this.musicAttribution.url}" target="_blank">Source</a>` : '');
        } else {
            attrEl.classList.add('hidden');
            attrEl.innerHTML = '';
        }
    }

    // ── Free Music Browser (Pixabay) ──

    _setupMusicBrowser() {
        document.getElementById('btnMusicSearch').addEventListener('click', () => {
            const q = document.getElementById('musicSearch').value.trim();
            if (q) this._searchMusic(q);
        });
        document.getElementById('musicSearch').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const q = e.target.value.trim();
                if (q) this._searchMusic(q);
            }
        });
        document.querySelectorAll('.music-cat').forEach(btn => {
            btn.addEventListener('click', () => {
                const q = btn.dataset.q;
                document.getElementById('musicSearch').value = q;
                this._searchMusic(q);
            });
        });
    }

    async _searchMusic(query) {
        const list = document.getElementById('musicList');
        const loading = document.getElementById('musicLoading');
        const categories = document.getElementById('musicCategories');
        const placeholder = document.querySelector('.music-placeholder');

        list.innerHTML = '';
        loading.classList.remove('hidden');
        if (categories) categories.style.display = 'none';
        if (placeholder) placeholder.style.display = 'none';

        try {
            const apiKey = '55128018-aafa7660499afea771f96c7ac';
            // Pixabay doesn't have a dedicated music API — use their main API for audio
            // We'll search their music page via a proxy approach, or use their video API
            // Actually Pixabay has no public music API. Let's use Freesound API instead (CC licensed)
            // For now, show results from Pixabay's sound effects endpoint
            const response = await fetch(
                `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=20`
            );
            const data = await response.json();
            loading.classList.add('hidden');
            this._showMusicResults(query, data);
        } catch (err) {
            console.error('Music search error:', err);
            loading.classList.add('hidden');
            this._showMusicResults(query, null);
        }
    }

    _showMusicResults(query, apiData) {
        const list = document.getElementById('musicList');
        list.innerHTML = '';

        // Show import option at top
        const importCard = document.createElement('div');
        importCard.className = 'music-track';
        importCard.style.background = '#e8f0e8';
        importCard.style.borderColor = '#a0c0a0';
        importCard.innerHTML = `
            <button class="music-play-btn" style="background: linear-gradient(180deg, #5ab85a, #3a8a3a); border-color: #2a6a2a;">&#128194;</button>
            <div class="music-track-info">
                <div class="music-track-title" style="color: #2a6a2a;">Import your own audio file</div>
                <div class="music-track-artist">MP3, WAV, OGG, AAC, FLAC supported</div>
            </div>
            <button class="music-use-btn" style="background: #3a8a3a;" id="musicImportOwn">Browse Files</button>
        `;
        list.appendChild(importCard);
        document.getElementById('musicImportOwn').addEventListener('click', () => document.getElementById('musicInput').click());

        // Show free music download links
        const linksCard = document.createElement('div');
        linksCard.style.cssText = 'padding: 8px; background: #f0f4ff; border: 1px solid #d0d8e8; border-radius: 4px; margin-top: 6px; font-size: 11px; color: #446;';
        linksCard.innerHTML = `
            <strong>Browse free music to download and import:</strong><br>
            <a href="https://pixabay.com/music/search/${encodeURIComponent(query)}/" target="_blank" style="color:#2962ff;">Pixabay Music: "${query}"</a> (free, no attribution) &bull;
            <a href="https://freemusicarchive.org/search?quicksearch=${encodeURIComponent(query)}" target="_blank" style="color:#2962ff;">Free Music Archive</a> &bull;
            <a href="https://studio.youtube.com/channel/UC/music" target="_blank" style="color:#2962ff;">YouTube Audio Library</a>
        `;
        list.appendChild(linksCard);

        // Attribution input
        const attrCard = document.createElement('div');
        attrCard.style.cssText = 'padding: 10px; background: #fff8e8; border: 1px solid #e0d8a0; border-radius: 4px; margin-top: 8px;';
        attrCard.innerHTML = `
            <div style="font-size: 12px; font-weight: bold; color: #6a5a1a; margin-bottom: 6px;">Add Music Attribution</div>
            <div style="font-size: 11px; color: #446; margin-bottom: 8px;">If your music requires credit, fill this in:</div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <input type="text" id="attrTitle" placeholder="Song title" style="padding: 4px 8px; border: 1px solid #ccc; border-radius: 3px; font-size: 11px;">
                <input type="text" id="attrArtist" placeholder="Artist name" style="padding: 4px 8px; border: 1px solid #ccc; border-radius: 3px; font-size: 11px;">
                <input type="text" id="attrUrl" placeholder="Song URL (optional)" style="padding: 4px 8px; border: 1px solid #ccc; border-radius: 3px; font-size: 11px;">
                <select id="attrLicense" style="padding: 4px 8px; border: 1px solid #ccc; border-radius: 3px; font-size: 11px;">
                    <option value="Pixabay License">Pixabay License (free)</option>
                    <option value="CC BY 4.0">Creative Commons BY 4.0</option>
                    <option value="CC BY-SA 4.0">Creative Commons BY-SA 4.0</option>
                    <option value="CC BY-NC 4.0">Creative Commons BY-NC 4.0</option>
                    <option value="CC0">Public Domain (CC0)</option>
                    <option value="YouTube Audio Library">YouTube Audio Library</option>
                    <option value="Royalty Free">Royalty Free</option>
                </select>
                <button class="btn-primary" id="btnSaveAttr" style="align-self: flex-start; padding: 4px 14px; font-size: 11px;">Save Attribution</button>
            </div>
        `;
        list.appendChild(attrCard);

        document.getElementById('btnSaveAttr').addEventListener('click', () => {
            const title = document.getElementById('attrTitle').value.trim();
            const artist = document.getElementById('attrArtist').value.trim();
            const url = document.getElementById('attrUrl').value.trim();
            const license = document.getElementById('attrLicense').value;
            if (title && artist) {
                this.musicAttribution = { title, artist, url, license };
                this._renderAudioBar();
                this._updateYTAttribution();
                alert('Attribution saved! It will auto-appear in your YouTube description when you publish.');
            } else {
                alert('Please enter at least a song title and artist name.');
            }
        });
    }

    _getAttributionText() {
        if (!this.musicAttribution) return '';
        const a = this.musicAttribution;
        let text = `\n\nMusic:\n"${a.title}" by ${a.artist}`;
        if (a.license) text += ` (${a.license})`;
        if (a.url) text += `\n${a.url}`;
        return text;
    }

    _updateYTAttribution() {
        const section = document.getElementById('ytAttributionSection');
        if (!section) return;
        if (this.musicAttribution) {
            section.classList.remove('hidden');
            section.innerHTML = `<strong>&#127925; Auto-Attribution (will be added to description):</strong>${this._getAttributionText().replace(/\n/g, '<br>')}`;
        } else {
            section.classList.add('hidden');
            section.innerHTML = '';
        }
    }

    // ── Modals ──

    _setupModals() {
        document.getElementById('btnTextOk').addEventListener('click', () => this._addTextOverlay());
        document.getElementById('btnTextCancel').addEventListener('click', () => { this._editingTextClipId = null; this._hideModal('textModal'); });
        document.getElementById('textSize').addEventListener('input', (e) => { document.getElementById('textSizeVal').textContent = e.target.value + 'px'; });

        // Stop mouse events in modals from bubbling to timeline (prevents scrub/drag during text select)
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('mousedown', (e) => e.stopPropagation());
            modal.addEventListener('mousemove', (e) => e.stopPropagation());
            modal.addEventListener('mouseup', (e) => e.stopPropagation());
        });
    }

    _showTextModal() {
        document.getElementById('textModal').classList.add('active');
        document.getElementById('btnTextOk').textContent = this._editingTextClipId ? 'Save' : 'Add';
        // Focus the text input
        setTimeout(() => document.getElementById('textInput').focus(), 50);
    }
    _hideModal(id) { document.getElementById(id).classList.remove('active'); }

    _addTextOverlayDirect(preset) {
        const item = {
            id: this.nextMediaId++, name: `Text: "${preset.text.split('\n')[0]}"`,
            type: 'text', track: 'text', duration: preset.duration,
            text: preset.text, fontSize: preset.fontSize, fontColor: preset.fontColor,
            textPosition: preset.textPosition, textBg: preset.textBg,
        };
        this.mediaItems.push(item);
        this.timeline.addClip(item);
        this._renderStoryboard();
        this._renderPreviewFrame(this.currentTime);
        this._markUnsaved();
    }

    _addTextOverlay() {
        const vals = {
            text: document.getElementById('textInput').value || 'Title',
            fontSize: parseInt(document.getElementById('textSize').value),
            fontColor: document.getElementById('textColor').value,
            textPosition: document.getElementById('textPosition').value,
            duration: parseFloat(document.getElementById('textDuration').value) || 5,
            textBg: document.getElementById('textBg').value,
        };

        if (this._editingTextClipId) {
            // Update existing clip
            const clip = this.timeline.clips.find(c => c.id === this._editingTextClipId);
            if (clip) {
                clip.text = vals.text;
                clip.fontSize = vals.fontSize;
                clip.fontColor = vals.fontColor;
                clip.textPosition = vals.textPosition;
                clip.textBg = vals.textBg;
                clip.duration = vals.duration;
                clip.name = `Text: "${vals.text.split('\n')[0]}"`;
                this.timeline.render();
                this._renderStoryboard();
                this._renderPreviewFrame(this.currentTime);
            }
            this._editingTextClipId = null;
        } else {
            // Add new clip
            this._addTextOverlayDirect(vals);
        }
        this._hideModal('textModal');
    }

    _editTextClip(clipId) {
        const clip = this.timeline.clips.find(c => c.id === clipId);
        if (!clip || clip.type !== 'text') return;
        // Pre-fill modal with clip values
        document.getElementById('textInput').value = clip.text || '';
        document.getElementById('textSize').value = clip.fontSize || 48;
        document.getElementById('textSizeVal').textContent = (clip.fontSize || 48) + 'px';
        document.getElementById('textColor').value = clip.fontColor || '#ffffff';
        document.getElementById('textPosition').value = clip.textPosition || 'center';
        document.getElementById('textBg').value = clip.textBg || 'none';
        document.getElementById('textDuration').value = clip.duration || 5;
        this._editingTextClipId = clipId;
        document.getElementById('textModalTitle').textContent = 'Edit Title';
        this._showTextModal();
    }

    // ── Publish Modal ──

    _setupPublishModal() {
        document.getElementById('pubComputer').addEventListener('click', () => this._selectPublishTarget('computer'));
        document.getElementById('pubYoutube').addEventListener('click', () => this._selectPublishTarget('youtube'));
        document.getElementById('btnPublishOk').addEventListener('click', () => this._doPublish());
        document.getElementById('btnPublishCancel').addEventListener('click', () => this._hideModal('publishModal'));

        this.youtubeUploader = new YouTubeUploader();
        // Check if returning from OAuth redirect or restored session
        if (this.youtubeUploader.checkRedirect() || this.youtubeUploader.isSignedIn()) {
            document.getElementById('ytAuthSection').classList.add('hidden');
            document.getElementById('ytLoggedIn').classList.remove('hidden');
            document.getElementById('ytUsername').textContent = this.youtubeUploader.userName || 'Connected';
            this._populateChannelPicker();
        }

        document.getElementById('btnYtLogin').addEventListener('click', async () => {
            try {
                await this.youtubeUploader.signIn();
                document.getElementById('ytAuthSection').classList.add('hidden');
                document.getElementById('ytLoggedIn').classList.remove('hidden');
                document.getElementById('ytUsername').textContent = this.youtubeUploader.userName || 'Connected';
                this._populateChannelPicker();
                this._toast('Signed in to YouTube!', 'success');
            } catch (e) {
                this._toast('YouTube sign-in failed: ' + e.message, 'error');
            }
        });
        document.getElementById('btnYtLogout').addEventListener('click', () => {
            this.youtubeUploader.signOut();
            document.getElementById('ytAuthSection').classList.remove('hidden');
            document.getElementById('ytLoggedIn').classList.add('hidden');
            document.getElementById('ytChannelPicker').classList.add('hidden');
            this._toast('Signed out of YouTube', 'info');
        });

        // Channel picker change
        document.getElementById('ytChannel').addEventListener('change', (e) => {
            this.youtubeUploader.selectChannel(e.target.value);
        });
    }

    _populateChannelPicker() {
        const channels = this.youtubeUploader.getChannels();
        const picker = document.getElementById('ytChannelPicker');
        const select = document.getElementById('ytChannel');
        select.innerHTML = '';

        if (channels.length > 0) {
            for (const ch of channels) {
                const opt = document.createElement('option');
                opt.value = ch.id;
                opt.textContent = ch.title;
                select.appendChild(opt);
            }
            picker.classList.remove('hidden');

            // Update username to show channel name
            document.getElementById('ytUsername').textContent =
                channels[0].title + (channels.length > 1 ? ` (+${channels.length - 1} more)` : '');
        } else {
            picker.classList.add('hidden');
        }
    }

    _showPublishModal(target) {
        document.getElementById('publishModal').classList.add('active');
        this._updateYTAttribution();
        if (target) this._selectPublishTarget(target);
    }

    _selectPublishTarget(target) {
        document.querySelectorAll('.publish-option').forEach(o => o.classList.remove('selected'));
        document.querySelector(`.publish-option[data-target="${target}"]`).classList.add('selected');
        document.getElementById('pubComputerDetails').classList.toggle('hidden', target !== 'computer');
        document.getElementById('pubYoutubeDetails').classList.toggle('hidden', target !== 'youtube');

        // Auto-fill YouTube description with attribution
        if (target === 'youtube' && this.musicAttribution) {
            const desc = document.getElementById('ytDescription');
            if (!desc.value.includes(this.musicAttribution.title)) {
                desc.value = desc.value + this._getAttributionText();
            }
        }
    }

    async _doPublish() {
        if (this.timeline.clips.length === 0) { alert('Add some media to the timeline first!'); return; }

        const selectedTarget = document.querySelector('.publish-option.selected');
        const target = selectedTarget ? selectedTarget.dataset.target : 'computer';
        const preset = target === 'youtube'
            ? (document.getElementById('ytExportPreset').value || 'youtube-1080p60')
            : (document.getElementById('exportPreset').value || 'youtube-1080p60');

        const settings = {
            preset: preset,
            filename: document.getElementById('exportFilename').value || 'Matty_Milker_Export',
        };

        this._hideModal('publishModal');
        this._pause();

        // In Electron, set the output path
        const isElectron = !!(window.electronAPI);
        if (isElectron) {
            if (target === 'computer') {
                const outputPath = await window.electronAPI.saveFileDialog(
                    (settings.filename || 'Matty_Milker_Export') + '.mp4'
                );
                if (!outputPath) return; // User cancelled
                settings._outputPath = outputPath;
            } else if (target === 'youtube') {
                // YouTube: save to disk first (user gets a backup), then upload
                const outputPath = await window.electronAPI.saveFileDialog(
                    (settings.filename || 'Matty_Milker_Export') + '.mp4'
                );
                if (!outputPath) return; // User cancelled
                settings._outputPath = outputPath;
            }
        }

        const modal = document.getElementById('exportModal');
        const progressBar = document.getElementById('exportProgress');
        const statusText = document.getElementById('exportStatus');
        modal.classList.add('active');

        const success = await this.renderer.exportVideo(
            this.timeline, this.mediaItems, this.canvas, settings,
            this.backgroundMusic,
            (pct) => { progressBar.style.width = pct + '%'; },
            (text) => { statusText.textContent = text; }
        );

        if (success) {
            if (target === 'youtube') {
                // Upload to YouTube
                if (!this.youtubeUploader || !this.youtubeUploader.isSignedIn()) {
                    statusText.textContent = 'Not signed in to YouTube. Video saved to disk instead.';
                    setTimeout(() => { this._hideModal('exportModal'); progressBar.style.width = '0%'; }, 3000);
                    return;
                }

                try {
                    const description = (document.getElementById('ytDescription').value || '') + this._getAttributionText();
                    let blob = this.renderer.lastExportBlob;

                    // In Electron, FFmpeg writes to disk — read it back as a blob
                    if (!blob && window.electronAPI && settings._outputPath) {
                        statusText.textContent = 'Reading exported file for upload...';
                        const buffer = await window.electronAPI.readFileBuffer(settings._outputPath);
                        blob = new Blob([buffer], { type: 'video/mp4' });
                    }

                    if (!blob) {
                        statusText.textContent = 'Export completed but no video data available for upload.';
                        setTimeout(() => { this._hideModal('exportModal'); progressBar.style.width = '0%'; }, 3000);
                        return;
                    }

                    const result = await this.youtubeUploader.upload(blob, {
                        title: document.getElementById('ytTitle').value || this.projectName || 'Untitled Video',
                        description: description,
                        privacy: document.getElementById('ytPrivacy').value || 'private',
                    },
                    (pct) => { progressBar.style.width = pct + '%'; },
                    (text) => { statusText.textContent = text; });

                    statusText.textContent = 'Uploaded to YouTube!';
                    this._toast('Video uploaded to YouTube!', 'success');
                } catch (e) {
                    statusText.textContent = 'YouTube upload failed: ' + e.message;
                    this._toast('YouTube upload failed: ' + e.message, 'error');
                }
                setTimeout(() => { this._hideModal('exportModal'); progressBar.style.width = '0%'; }, 4000);
            } else {
                // Saved to disk
                if (this.musicAttribution) {
                    try {
                        await navigator.clipboard.writeText(this._getAttributionText());
                        statusText.textContent = 'Saved! Music attribution copied to clipboard.';
                    } catch(e) {
                        statusText.textContent = 'Saved to disk!';
                    }
                } else {
                    statusText.textContent = 'Saved to disk!';
                }
                this._toast('Video exported successfully!', 'success');
                setTimeout(() => { this._hideModal('exportModal'); progressBar.style.width = '0%'; }, 3000);
            }
        }
    }

    // ── Media Import ──

    async _importMediaClick(filterType) {
        const isElectron = !!(window.electronAPI);
        if (isElectron) {
            // Use Electron native dialog — gives real file paths for FFmpeg
            try {
                const paths = await window.electronAPI.openFilesDialog();
                if (paths && paths.length > 0) {
                    for (const filePath of paths) {
                        await this._importFromPath(filePath);
                    }
                }
            } catch (e) {
                this._toast('Import failed: ' + e, 'error');
                document.getElementById('fileInput').click();
            }
        } else {
            document.getElementById('fileInput').click();
        }
    }

    async _importFromPath(filePath) {
        // Extract filename from path
        const name = filePath.split(/[/\\]/).pop();
        const type = this._getMediaType({ name, type: '' });
        if (!type) return;

        // In Electron with webSecurity:false, file:// URLs work directly
        const normalized = filePath.replace(/\\/g, '/');
        const url = 'file:///' + normalized;

        const item = {
            id: this.nextMediaId++, name, type,
            file: { name, path: filePath }, // fake File with real path
            filePath: filePath, // REAL path for FFmpeg
            url, duration: 5, element: null,
            track: type === 'audio' ? 'audio' : 'video',
            videoWidth: 0, videoHeight: 0,
        };

        if (type === 'video') {
            const v = document.createElement('video');
            v.muted = true; v.preload = 'auto'; v.autoplay = false; v.playsInline = true;
            v.crossOrigin = 'anonymous';
            v.src = url;
            await new Promise(r => { v.onloadeddata = () => { item.duration = v.duration; r(); }; v.onerror = () => { console.error('Video load error for', url); r(); }; });
            v.currentTime = 0.1;
            await new Promise(r => { v.onseeked = r; setTimeout(r, 500); });
            v.pause();
            item.element = v;
            item.videoWidth = v.videoWidth;
            item.videoHeight = v.videoHeight;
            this._autoDetectResolution(v);
        } else if (type === 'image') {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = url;
            await new Promise(r => { img.onload = r; img.onerror = r; });
            item.element = img; item.duration = 5;
        } else if (type === 'audio') {
            const a = new Audio(url);
            a.preload = 'metadata';
            await new Promise(r => { a.onloadedmetadata = () => { item.duration = a.duration; r(); }; a.onerror = r; });
            item.element = a;
        }

        this.mediaItems.push(item);
        this._renderMediaGrid();
        this.timeline.addClip(item);
        this._renderStoryboard();
        this._renderPreviewFrame(0);
        this._updateTimeDisplay();
        this._toast(`Imported: ${name}`, 'success');
        if (this._markUnsaved) this._markUnsaved();
    }

    async _importFiles(files) { for (const f of files) await this._importFile(f); }

    async _importFile(file) {
        const type = this._getMediaType(file);
        if (!type) return;

        // In Electron, File objects from drag-drop have .path with real filesystem path
        const realPath = file.path || null;

        // Determine the best URL for media playback
        let mediaUrl;
        const isElectron = !!(window.electronAPI);
        if (isElectron && realPath) {
            // Use file:// protocol — Electron with webSecurity:false allows this
            const normalized = realPath.replace(/\\/g, '/');
            mediaUrl = 'file:///' + normalized;
        } else {
            mediaUrl = URL.createObjectURL(file);
        }

        const item = {
            id: this.nextMediaId++, name: file.name, type, file,
            filePath: realPath, // Real path for FFmpeg (null in browser)
            url: mediaUrl, duration: 5, element: null,
            track: type === 'audio' ? 'audio' : 'video',
            videoWidth: 0, videoHeight: 0,
        };

        if (type === 'video') {
            const v = document.createElement('video');
            v.muted = true;
            v.preload = 'auto';
            v.autoplay = false;
            v.playsInline = true;
            v.crossOrigin = 'anonymous';
            v.src = item.url;
            // Wait for enough data to render frames
            const loaded = await new Promise(r => {
                v.onloadeddata = () => { item.duration = v.duration; r(true); };
                v.onerror = (e) => { console.error('Video load error:', e, item.url); r(false); };
            });
            if (!loaded && isElectron && realPath) {
                // Fallback: try blob URL if asset protocol failed
                console.log('Retrying with blob URL...');
                item.url = URL.createObjectURL(file);
                v.src = item.url;
                await new Promise(r => {
                    v.onloadeddata = () => { item.duration = v.duration; r(); };
                    v.onerror = () => r();
                });
            }
            // Seek to 0.1s to get a real frame for thumbnails
            v.currentTime = 0.1;
            await new Promise(r => { v.onseeked = r; setTimeout(r, 500); });
            v.pause();
            item.element = v;
            item.videoWidth = v.videoWidth;
            item.videoHeight = v.videoHeight;
            this._autoDetectResolution(v);
        } else if (type === 'image') {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = item.url;
            await new Promise(r => { img.onload = r; img.onerror = r; });
            item.element = img; item.duration = 5;
        } else if (type === 'audio') {
            const a = new Audio(item.url);
            a.crossOrigin = 'anonymous';
            a.preload = 'metadata';
            await new Promise(r => { a.onloadedmetadata = () => { item.duration = a.duration; r(); }; a.onerror = r; });
            item.element = a;
        }

        this.mediaItems.push(item);
        this._renderMediaGrid();
        this.timeline.addClip(item);
        this._renderStoryboard();
        this._renderPreviewFrame(0);
        this._updateTimeDisplay();
        this._markUnsaved();
        this._toast(`Imported: ${item.name}`, 'success');
    }

    _autoDetectResolution(videoEl) {
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        if (!w || !h) return;

        // Set preview resolution to match source
        const resSelect = document.getElementById('previewResolution');
        if (h >= 1080) {
            resSelect.value = '1920x1080';
            this.canvas.width = 1920; this.canvas.height = 1080;
        } else if (h >= 720) {
            resSelect.value = '1280x720';
            this.canvas.width = 1280; this.canvas.height = 720;
        } else {
            resSelect.value = '854x480';
            this.canvas.width = 854; this.canvas.height = 480;
        }

        // Auto-select best export preset to match source
        const exportSelect = document.getElementById('exportPreset');
        const ytExportSelect = document.getElementById('ytExportPreset');
        if (h >= 2160) {
            if (exportSelect) exportSelect.value = 'youtube-4k';
            if (ytExportSelect) ytExportSelect.value = 'youtube-4k';
        } else if (h >= 1440) {
            if (exportSelect) exportSelect.value = 'youtube-1440p';
        } else if (h >= 1080) {
            if (exportSelect) exportSelect.value = 'youtube-1080p60';
            if (ytExportSelect) ytExportSelect.value = 'youtube-1080p60';
        } else {
            if (exportSelect) exportSelect.value = 'youtube-720p';
            if (ytExportSelect) ytExportSelect.value = 'youtube-720p';
        }

        // Update preset info text
        const presetInfo = document.getElementById('presetInfo');
        if (presetInfo && exportSelect) {
            const preset = Renderer.EXPORT_PRESETS[exportSelect.value];
            if (preset) presetInfo.textContent = `Auto-detected ${w}x${h} source. ${preset.description}`;
        }
    }

    _getMediaType(file) {
        if (file.type.startsWith('video/')) return 'video';
        if (file.type.startsWith('image/')) return 'image';
        if (file.type.startsWith('audio/')) return 'audio';
        const ext = file.name.split('.').pop().toLowerCase();
        // All common video formats
        if (['mp4','webm','avi','mov','mkv','wmv','flv','m4v','3gp','mpeg','mpg','ts','mts','m2ts','vob','ogv','f4v','asf','rm','rmvb','divx'].includes(ext)) return 'video';
        if (['jpg','jpeg','png','gif','bmp','webp','tiff','tif','svg','ico','heic','heif','avif','raw'].includes(ext)) return 'image';
        if (['mp3','wav','ogg','aac','flac','m4a','wma','opus','aiff','alac','ape','mid','midi'].includes(ext)) return 'audio';
        return null;
    }

    _renderMediaGrid() {
        const grid = document.getElementById('mediaGrid');
        grid.innerHTML = '';
        const dropZone = document.getElementById('dropZone');
        if (this.mediaItems.filter(m => m.type !== 'text').length > 0) dropZone.classList.add('has-media');

        for (const item of this.mediaItems) {
            if (item.type === 'text') continue;
            const card = document.createElement('div');
            card.className = 'media-card'; card.draggable = true; card.dataset.mediaId = item.id;

            const thumb = document.createElement('div'); thumb.className = 'card-thumb';
            if (item.type === 'video' && item.element) {
                const c = document.createElement('canvas'); c.width = 80; c.height = 54;
                try { c.getContext('2d').drawImage(item.element, 0, 0, 80, 54); } catch(e) {}
                thumb.appendChild(c);
            } else if (item.type === 'image' && item.element) {
                const img = document.createElement('img'); img.src = item.url; thumb.appendChild(img);
            } else {
                const icon = document.createElement('span'); icon.className = 'card-icon';
                icon.textContent = item.type === 'audio' ? '\u{1F3B5}' : '\u{1F4C4}'; thumb.appendChild(icon);
            }
            card.appendChild(thumb);

            const n = document.createElement('div'); n.className = 'card-name'; n.textContent = item.name; card.appendChild(n);
            const d = document.createElement('div'); d.className = 'card-duration'; d.textContent = this._formatTime(item.duration); card.appendChild(d);

            card.addEventListener('dblclick', () => { this.timeline.addClip(item); this._renderStoryboard(); this._renderPreviewFrame(this.currentTime); });
            card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', item.id));

            // Right-click to delete from media library
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this._showContextMenu(e.clientX, e.clientY, [
                    { label: 'Add to timeline', action: () => { this.timeline.addClip(item); this._renderStoryboard(); this._renderPreviewFrame(this.currentTime); } },
                    { label: 'Remove from library', action: () => { this._removeMediaItem(item.id); } },
                ]);
            });

            // Delete button overlay
            const delBtn = document.createElement('button');
            delBtn.className = 'card-delete';
            delBtn.textContent = '\u00d7';
            delBtn.title = 'Remove from library';
            delBtn.addEventListener('click', (e) => { e.stopPropagation(); this._removeMediaItem(item.id); });
            card.appendChild(delBtn);

            grid.appendChild(card);
        }
    }

    // ── Storyboard ──

    _renderStoryboard() {
        const track = document.getElementById('storyboardTrack');
        track.innerHTML = '';
        const clips = this.timeline.getClipsForTrack('video');

        // Render existing clips
        clips.forEach((clip, idx) => {
            if (idx > 0) {
                const trans = document.createElement('div');
                const t = this.timeline.getTransitionForClip(clip.id);
                trans.className = 'sb-transition' + (t ? ' has-transition' : '');
                trans.textContent = t ? t.type : '\u2295';
                trans.title = t ? `${t.type} (${t.duration}s)` : 'Click to add transition';
                trans.addEventListener('click', () => { this.timeline.selectClip(clip.id); this._switchBinTab('transitions'); });
                track.appendChild(trans);
            }

            const el = document.createElement('div');
            el.className = 'sb-clip' + (clip.id === this.timeline.selectedClipId ? ' selected' : '');

            const thumb = document.createElement('div'); thumb.className = 'sb-thumb';
            const item = this.mediaItems.find(m => m.id === clip.mediaId);
            if (item) {
                if (item.type === 'video' && item.element) {
                    const c = document.createElement('canvas'); c.width = 90; c.height = 52;
                    try { c.getContext('2d').drawImage(item.element, 0, 0, 90, 52); } catch(e) {}
                    thumb.appendChild(c);
                } else if (item.type === 'image' && item.element) {
                    const img = document.createElement('img'); img.src = item.url; thumb.appendChild(img);
                } else {
                    const icon = document.createElement('span'); icon.className = 'sb-icon'; icon.textContent = '\u{1F3B5}'; thumb.appendChild(icon);
                }
            }
            el.appendChild(thumb);

            const n = document.createElement('div'); n.className = 'sb-name'; n.textContent = clip.name; el.appendChild(n);
            const d = document.createElement('div'); d.className = 'sb-duration'; d.textContent = this._formatTime(clip.duration); el.appendChild(d);

            el.addEventListener('click', () => { this.timeline.selectClip(clip.id); this._renderStoryboard(); });

            // Right-click to delete from timeline
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this._showContextMenu(e.clientX, e.clientY, [
                    { label: 'Remove from timeline', action: () => { this.timeline.removeClip(clip.id); this._renderStoryboard(); this._renderPreviewFrame(this.currentTime); } },
                    { label: 'Remove from library', action: () => { this._removeMediaItem(clip.mediaId); } },
                ]);
            });

            // Drag to reorder in storyboard
            el.draggable = true;
            el.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('application/x-clip-id', clip.id);
                e.dataTransfer.effectAllowed = 'move';
                el.style.opacity = '0.5';
            });
            el.addEventListener('dragend', () => { el.style.opacity = '1'; });
            el.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                el.style.borderColor = '#ff6600';
            });
            el.addEventListener('dragleave', () => {
                el.style.borderColor = '';
            });
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                el.style.borderColor = '';

                // Reorder: clip dragged from storyboard
                const draggedClipId = parseInt(e.dataTransfer.getData('application/x-clip-id'));
                if (draggedClipId && draggedClipId !== clip.id) {
                    this._reorderClip(draggedClipId, clip.id);
                    return;
                }

                // Insert: media item dragged from library onto an existing clip (insert before it)
                const mediaId = parseInt(e.dataTransfer.getData('text/plain'));
                if (mediaId) {
                    const item = this.mediaItems.find(m => m.id === mediaId);
                    if (item) {
                        const newClip = this.timeline.addClip(item);
                        // Move new clip before the target
                        if (newClip) this._reorderClip(newClip.id, clip.id);
                    }
                    return;
                }

                // Files from desktop
                if (e.dataTransfer.files.length > 0) {
                    this._importFiles(e.dataTransfer.files);
                }
            });

            track.appendChild(el);
        });

        // Always show empty placeholder slots at the end (like classic WMM)
        const emptySlots = Math.max(1, 6 - clips.length);
        for (let i = 0; i < emptySlots; i++) {
            const ph = document.createElement('div');
            ph.className = 'sb-placeholder sb-drop-slot';
            ph.innerHTML = '<div class="sb-film-strip">\u{1F39E}</div><span>' + (clips.length === 0 && i === 0 ? 'Drag media here' : '') + '</span>';

            // Each slot accepts drops
            ph.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                ph.style.borderColor = '#4a7cc9';
                ph.style.background = '#d8e8ff';
            });
            ph.addEventListener('dragleave', () => {
                ph.style.borderColor = '';
                ph.style.background = '';
            });
            ph.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                ph.style.borderColor = '';
                ph.style.background = '';

                // Handle files dropped from desktop
                if (e.dataTransfer.files.length > 0) {
                    this._importFiles(e.dataTransfer.files);
                    return;
                }

                // Handle clip reorder dropped onto empty slot (move to end)
                const draggedClipId = parseInt(e.dataTransfer.getData('application/x-clip-id'));
                if (draggedClipId) {
                    // Move this clip to the end
                    const dragged = this.timeline.clips.find(c => c.id === draggedClipId);
                    if (dragged) {
                        const trackClips = this.timeline.clips
                            .filter(c => c.track === dragged.track)
                            .sort((a, b) => a.startTime - b.startTime);
                        const idx = trackClips.indexOf(dragged);
                        trackClips.splice(idx, 1);
                        trackClips.push(dragged);
                        let t = 0;
                        for (const c of trackClips) { c.startTime = t; t += c.duration; }
                        this._playSnapSound();
                        this.timeline.render();
                        this._renderStoryboard();
                        this._renderPreviewFrame(this.currentTime);
                        this._toast('Clip moved to end', 'success');
                    }
                    return;
                }

                // Handle media item dragged from library
                const mediaId = parseInt(e.dataTransfer.getData('text/plain'));
                if (mediaId) {
                    const item = this.mediaItems.find(m => m.id === mediaId);
                    if (item) {
                        this.timeline.addClip(item);
                        this._playSnapSound();
                        this._renderStoryboard();
                        this._renderPreviewFrame(this.currentTime);
                        this._toast(`Added: ${item.name}`, 'success');
                    }
                }
            });

            // Click to open file picker (uses Tauri native dialog when available)
            ph.addEventListener('click', () => {
                this._importMediaClick();
            });

            track.appendChild(ph);
        }

        // Make the whole storyboard track a drop target too
        if (!track._dropSetup) {
            track._dropSetup = true;
            track.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
            track.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer.files.length > 0) {
                    this._importFiles(e.dataTransfer.files);
                } else {
                    const mediaId = parseInt(e.dataTransfer.getData('text/plain'));
                    if (mediaId) {
                        const item = this.mediaItems.find(m => m.id === mediaId);
                        if (item) {
                            this.timeline.addClip(item);
                            this._renderStoryboard();
                            this._renderPreviewFrame(this.currentTime);
                        }
                    }
                }
            });
        }

        this.timeline.render();
    }

    // ── Preview ──

    _seekTo(time) {
        this.currentTime = time;
        this.timeline.updatePlayhead(time);
        this._renderPreviewFrame(time);
        this._updateTimeDisplay();
    }

    _togglePlay() { if (this.isPlaying) this._pause(); else this._play(); }

    _play() {
        if (this.timeline.clips.length === 0 && !this.backgroundMusic) return;
        const total = Math.max(this.timeline.getTotalDuration(), this.backgroundMusic ? this.backgroundMusic.duration : 0);
        if (this.currentTime >= total) this.currentTime = 0;
        this.isPlaying = true;
        this._activeVideoClipId = null;
        document.getElementById('btnPlay').textContent = '\u23F8';
        this._syncVideoPlayback(this.currentTime);
        if (this.backgroundMusic && this.backgroundMusic.element) {
            this.backgroundMusic.element.currentTime = this.currentTime;
            this.backgroundMusic.element.play().catch(() => {});
        }
        // Cache media lookups for playback performance
        this._mediaCache = {};
        for (const item of this.mediaItems) this._mediaCache[item.id] = item;

        let last = performance.now();
        let frameCount = 0;
        const animate = (ts) => {
            if (!this.isPlaying) return;
            const dt = (ts - last) / 1000; last = ts;
            this.currentTime += dt;
            if (this.currentTime >= total) { this.currentTime = total; this._pause(); return; }

            // Update playhead every 3 frames to reduce DOM thrash
            frameCount++;
            if (frameCount % 3 === 0) {
                this.timeline.updatePlayhead(this.currentTime);
                this._updateTimeDisplay();
            }

            this._renderPreviewFrame(this.currentTime);
            this.animFrame = requestAnimationFrame(animate);
        };
        this.animFrame = requestAnimationFrame(animate);
    }

    _pause() {
        this.isPlaying = false;
        this._activeVideoClipId = null;
        this._activeAudioClipId = null;
        document.getElementById('btnPlay').textContent = '\u25B6';
        if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
        for (const item of this.mediaItems) {
            if (item.type === 'video' && item.element) {
                item.element.pause();
                item.element.muted = true;
            }
            if (item.type === 'audio' && item.element && item.element.pause) {
                item.element.pause();
            }
        }
        if (this.backgroundMusic && this.backgroundMusic.element) this.backgroundMusic.element.pause();
        this._mediaCache = null;
    }

    _rewind() { this._pause(); this.currentTime = 0; this._seekTo(0); }

    _syncVideoPlayback(time) {
        const clip = this.timeline.getClipAtTime(time, 'video');
        if (clip) {
            const item = (this._mediaCache && this._mediaCache[clip.mediaId]) || this.mediaItems.find(m => m.id === clip.mediaId);
            if (item && item.type === 'video' && item.element) {
                item.element.muted = false;
                item.element.currentTime = clip.trimStart + (time - clip.startTime);
                item.element.play().catch(() => {});
                this._activeVideoClipId = clip.id;
            }
        }

        // Also sync audio track clips
        const audioClip = this.timeline.getClipAtTime(time, 'audio');
        if (audioClip) {
            const audioItem = (this._mediaCache && this._mediaCache[audioClip.mediaId]) || this.mediaItems.find(m => m.id === audioClip.mediaId);
            if (audioItem && audioItem.element && audioItem.element.play) {
                const audioTime = audioClip.trimStart + (time - audioClip.startTime);
                audioItem.element.currentTime = audioTime;
                audioItem.element.play().catch(() => {});
                this._activeAudioClipId = audioClip.id;
            }
        }
    }

    _renderPreviewFrame(time) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);

        const clip = this.timeline.getClipAtTime(time, 'video');
        if (clip) {
            const item = (this._mediaCache && this._mediaCache[clip.mediaId]) || this.mediaItems.find(m => m.id === clip.mediaId);
            if (item && item.element) {
                // Handle clip transitions when playing — sync audio to new clip
                if (this.isPlaying && clip.id !== this._activeVideoClipId) {
                    // Pause old video, start new one
                    if (this._activeVideoClipId) {
                        for (const mi of this.mediaItems) {
                            if (mi.type === 'video' && mi.element) { mi.element.pause(); mi.element.muted = true; }
                        }
                    }
                    if (item.type === 'video' && item.element) {
                        item.element.muted = false;
                        const vt = clip.trimStart + (time - clip.startTime);
                        item.element.currentTime = vt;
                        item.element.play().catch(() => {});
                    }
                    this._activeVideoClipId = clip.id;
                }

                const transition = this.timeline.getTransitionForClip(clip.id);
                let alpha = 1;
                if (transition) {
                    const elapsed = time - clip.startTime;
                    if (elapsed < transition.duration) alpha = elapsed / transition.duration;
                }
                ctx.save();
                if (transition && alpha < 1) {
                    const type = transition.type;
                    if (type === 'fade' || type === 'dissolve') { ctx.globalAlpha = alpha; }
                    else if (type.startsWith('wipe')) {
                        ctx.beginPath();
                        switch (type) {
                            case 'wipe-left': ctx.rect(0, 0, w * alpha, h); break;
                            case 'wipe-right': ctx.rect(w * (1-alpha), 0, w * alpha, h); break;
                            case 'wipe-up': ctx.rect(0, 0, w, h * alpha); break;
                            case 'wipe-down': ctx.rect(0, h * (1-alpha), w, h * alpha); break;
                        }
                        ctx.clip();
                    }
                }
                if (item.type === 'video') {
                    // During playback, let the video element drive timing — only seek when paused
                    if (!this.isPlaying) {
                        const vt = clip.trimStart + (time - clip.startTime);
                        if (Math.abs(item.element.currentTime - vt) > 0.3) item.element.currentTime = vt;
                    }
                    try { ctx.drawImage(item.element, 0, 0, w, h); } catch(e) {}
                } else if (item.type === 'image') {
                    ctx.drawImage(item.element, 0, 0, w, h);
                }
                // Only apply pixel effects when paused (too expensive at 60fps)
                if (clip.effect && clip.effect !== 'none' && !this.isPlaying) this._applyEffect(clip.effect);
                ctx.restore();
            }
        }

        // Only render text overlay if there's one at this time
        const textClip = this.timeline.getClipAtTime(time, 'text');
        if (textClip) this._renderTextOverlay(textClip);
    }

    _applyEffect(effect) {
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const d = imageData.data;
        switch (effect) {
            case 'grayscale': for (let i=0;i<d.length;i+=4){const a=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;d[i]=d[i+1]=d[i+2]=a;} break;
            case 'sepia': for (let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];d[i]=Math.min(255,r*0.393+g*0.769+b*0.189);d[i+1]=Math.min(255,r*0.349+g*0.686+b*0.168);d[i+2]=Math.min(255,r*0.272+g*0.534+b*0.131);} break;
            case 'brightness': for (let i=0;i<d.length;i+=4){d[i]=Math.min(255,d[i]+40);d[i+1]=Math.min(255,d[i+1]+40);d[i+2]=Math.min(255,d[i+2]+40);} break;
            case 'contrast': for (let i=0;i<d.length;i+=4){d[i]=Math.min(255,Math.max(0,1.5*(d[i]-128)+128));d[i+1]=Math.min(255,Math.max(0,1.5*(d[i+1]-128)+128));d[i+2]=Math.min(255,Math.max(0,1.5*(d[i+2]-128)+128));} break;
            case 'invert': for (let i=0;i<d.length;i+=4){d[i]=255-d[i];d[i+1]=255-d[i+1];d[i+2]=255-d[i+2];} break;
        }
        this.ctx.putImageData(imageData, 0, 0);
    }

    _renderTextOverlay(clip) {
        const lines = (clip.text || '').split('\n');
        const fontSize = clip.fontSize || 48;
        this.ctx.font = `bold ${fontSize}px 'Segoe UI', Arial, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = clip.fontColor || '#ffffff';
        let y;
        switch (clip.textPosition) {
            case 'top': y = fontSize + 40; break;
            case 'bottom': y = this.canvas.height - 40; break;
            case 'lower-third': y = this.canvas.height * 0.78; break;
            default: y = this.canvas.height / 2 - ((lines.length - 1) * fontSize) / 2;
        }
        for (const line of lines) {
            if (clip.textBg === 'shadow') { this.ctx.shadowColor = 'rgba(0,0,0,0.8)'; this.ctx.shadowBlur = 8; this.ctx.shadowOffsetX = 2; this.ctx.shadowOffsetY = 2; }
            else if (clip.textBg === 'box') {
                const m = this.ctx.measureText(line); const p = 10;
                this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
                this.ctx.fillRect(this.canvas.width/2 - m.width/2 - p, y - fontSize + 6, m.width + p*2, fontSize + 4);
                this.ctx.fillStyle = clip.fontColor || '#ffffff';
            }
            this.ctx.fillText(line, this.canvas.width / 2, y);
            this.ctx.shadowColor = 'transparent'; this.ctx.shadowBlur = 0;
            y += fontSize + 4;
        }
    }

    _drawBlank() { this.ctx.fillStyle = '#111'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }

    _removeMediaItem(mediaId) {
        // Remove from media library
        const item = this.mediaItems.find(m => m.id === mediaId);
        if (item) {
            if (item.element && item.element.pause) item.element.pause();
            if (item.url) URL.revokeObjectURL(item.url);
        }
        this.mediaItems = this.mediaItems.filter(m => m.id !== mediaId);
        // Remove any timeline clips using this media
        this.timeline.clips = this.timeline.clips.filter(c => c.mediaId !== mediaId);
        this.timeline.render();
        this._renderMediaGrid();
        this._renderStoryboard();
        this._renderPreviewFrame(this.currentTime);
        this._updateTimeDisplay();
    }

    _showContextMenu(x, y, items) {
        // Remove existing menu
        const existing = document.querySelector('.context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        items.forEach(item => {
            const el = document.createElement('div');
            el.className = 'context-menu-item';
            el.textContent = item.label;
            el.addEventListener('click', () => { menu.remove(); item.action(); });
            menu.appendChild(el);
        });

        document.body.appendChild(menu);
        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', function close() {
                menu.remove();
                document.removeEventListener('click', close);
            }, { once: true });
        }, 10);
    }

    _setupScrubBar() {
        const container = document.getElementById('scrubBarContainer');
        const fill = document.getElementById('scrubBarFill');
        const handle = document.getElementById('scrubHandle');
        let scrubbing = false;

        const scrubTo = (e) => {
            const rect = container.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const total = Math.max(this.timeline.getTotalDuration(), this.backgroundMusic ? this.backgroundMusic.duration : 0);
            if (total > 0) {
                this.currentTime = pct * total;
                this._seekTo(this.currentTime);
                this._updateScrubBar();
            }
        };

        container.addEventListener('mousedown', (e) => {
            scrubbing = true;
            if (this.isPlaying) this._pause();
            scrubTo(e);
        });
        document.addEventListener('mousemove', (e) => { if (scrubbing) scrubTo(e); });
        document.addEventListener('mouseup', () => { scrubbing = false; });
    }

    _updateScrubBar() {
        const total = Math.max(this.timeline.getTotalDuration(), this.backgroundMusic ? this.backgroundMusic.duration : 0);
        const pct = total > 0 ? (this.currentTime / total) * 100 : 0;
        const fill = document.getElementById('scrubBarFill');
        const handle = document.getElementById('scrubHandle');
        if (fill) fill.style.width = pct + '%';
        if (handle) handle.style.left = pct + '%';
    }

    _toast(message, type) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = 'toast ' + (type || 'info');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
    }

    _reorderClip(draggedId, targetId) {
        const dragged = this.timeline.clips.find(c => c.id === draggedId);
        const target = this.timeline.clips.find(c => c.id === targetId);
        if (!dragged || !target || dragged.track !== target.track) return;

        // Simply swap their start times — this is the clearest reorder
        const tempStart = dragged.startTime;
        const tempDuration = dragged.duration;

        // Get all clips on this track sorted by position
        const trackClips = this.timeline.clips
            .filter(c => c.track === dragged.track)
            .sort((a, b) => a.startTime - b.startTime);

        // Find indices in sorted order
        const dragIdx = trackClips.indexOf(dragged);
        const targetIdx = trackClips.indexOf(target);

        // Move dragged to target's position in the array
        trackClips.splice(dragIdx, 1);
        trackClips.splice(targetIdx > dragIdx ? targetIdx - 1 : targetIdx, 0, dragged);

        // Recalculate all start times sequentially — no gaps, no overlaps
        let t = 0;
        for (const c of trackClips) {
            c.startTime = t;
            t += c.duration;
        }

        // Play snap sound
        this._playSnapSound();

        this.timeline.render();
        this._renderStoryboard();
        this._renderPreviewFrame(this.currentTime);
        this._toast('Clip moved', 'success');

        // Flash snap animation on all storyboard clips
        setTimeout(() => {
            document.querySelectorAll('.sb-clip').forEach(el => {
                el.classList.add('snap-in');
                setTimeout(() => el.classList.remove('snap-in'), 300);
            });
        }, 10);
    }

    _playSnapSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const t = ctx.currentTime;
            // Short percussive "snap" click
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, t);
            osc.frequency.exponentialRampToValueAtTime(300, t + 0.06);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.3, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
            osc.connect(gain).connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.1);
        } catch(e) {}
    }

    // ── Actions ──
    _splitAtPlayhead() {
        const clip = this.timeline.getClipAtTime(this.currentTime, 'video');
        if (clip) {
            this._saveUndoState();
            this.timeline.splitClip(clip.id, this.currentTime);
            this._renderStoryboard();
            this._markUnsaved();
            this._toast('Clip split at playhead', 'success');
        } else {
            this._toast('No clip at playhead position', 'warning');
        }
    }
    // ── Undo System ──

    _saveUndoState() {
        const state = {
            clips: JSON.parse(JSON.stringify(this.timeline.clips)),
            mediaItems: this.mediaItems.map(m => ({
                id: m.id, name: m.name, type: m.type, duration: m.duration,
                url: m.url, filePath: m.filePath, track: m.track,
                videoWidth: m.videoWidth, videoHeight: m.videoHeight,
                text: m.text, fontSize: m.fontSize, fontColor: m.fontColor,
                textPosition: m.textPosition, textBg: m.textBg,
            })),
        };
        this._undoStack.push(state);
        if (this._undoStack.length > this._maxUndoSteps) this._undoStack.shift();
    }

    _undo() {
        if (this._undoStack.length === 0) {
            this._toast('Nothing to undo', 'info');
            return;
        }
        const state = this._undoStack.pop();

        // Restore clips (keep references to media elements)
        this.timeline.clips = state.clips;
        this.timeline.render();
        this._renderStoryboard();
        this._renderPreviewFrame(this.currentTime);
        this._toast('Undo', 'info');
    }

    _deleteSelected() {
        const s = this.timeline.getSelectedClip();
        if (s) {
            this._saveUndoState();
            this.timeline.removeClip(s.id);
            this._renderStoryboard();
            this._renderPreviewFrame(this.currentTime);
            this._markUnsaved();
            this._toast('Clip removed from timeline', 'info');
        } else {
            this._toast('No clip selected', 'warning');
        }
    }

    // ── Project Save/Open System ──

    _setupFileMenu() {
        // Create file menu dropdown dynamically
        const fileMenuItem = document.querySelector('.menu-item');
        if (!fileMenuItem) return;

        // Make File clickable
        fileMenuItem.style.cursor = 'pointer';
        fileMenuItem.style.userSelect = 'none';

        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.id = 'fileMenuDropdown';
        dropdown.style.cssText = 'display:none;position:absolute;top:100%;left:0;background:#f0f0f0;border:1px solid #999;box-shadow:2px 2px 6px rgba(0,0,0,0.3);min-width:200px;z-index:10000;font-size:12px;';

        const items = [
            { label: 'New Project', shortcut: '', action: () => this._newProject() },
            { label: 'Open Project...', shortcut: '', action: () => this._openProject() },
            { label: '---' },
            { label: 'Save Project', shortcut: 'Ctrl+S', action: () => this._saveProject() },
            { label: 'Save As...', shortcut: '', action: () => this._saveProjectAs() },
        ];

        items.forEach(item => {
            if (item.label === '---') {
                const sep = document.createElement('div');
                sep.style.cssText = 'height:1px;background:#ccc;margin:2px 0;';
                dropdown.appendChild(sep);
                return;
            }
            const el = document.createElement('div');
            el.style.cssText = 'padding:6px 24px 6px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;';
            el.addEventListener('mouseenter', () => el.style.background = '#d0d8e8');
            el.addEventListener('mouseleave', () => el.style.background = 'transparent');

            const labelSpan = document.createElement('span');
            labelSpan.textContent = item.label;
            el.appendChild(labelSpan);

            if (item.shortcut) {
                const shortcutSpan = document.createElement('span');
                shortcutSpan.textContent = item.shortcut;
                shortcutSpan.style.cssText = 'color:#888;font-size:11px;margin-left:24px;';
                el.appendChild(shortcutSpan);
            }

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this._closeFileMenu();
                item.action();
            });
            dropdown.appendChild(el);
        });

        // Position dropdown relative to file menu item
        fileMenuItem.style.position = 'relative';
        fileMenuItem.appendChild(dropdown);

        fileMenuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display !== 'none';
            if (isOpen) {
                this._closeFileMenu();
            } else {
                dropdown.style.display = 'block';
            }
        });

        // Close on click outside
        document.addEventListener('click', () => this._closeFileMenu());
    }

    _closeFileMenu() {
        const dd = document.getElementById('fileMenuDropdown');
        if (dd) dd.style.display = 'none';
    }

    _updateTitleBar() {
        const titleEl = document.querySelector('.title-text');
        if (titleEl) {
            titleEl.textContent = `Matty Milker Movie Maker - ${this.projectName}`;
        }
    }

    _showProjectNameModal(callback) {
        // Remove existing modal if any
        const existing = document.getElementById('projectNameModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'projectNameModal';
        modal.className = 'modal active';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;';

        const box = document.createElement('div');
        box.style.cssText = 'background:linear-gradient(180deg,#e8ecf0,#d0d8e0);border:2px solid #7a8a9a;border-radius:6px;padding:24px 32px;min-width:360px;box-shadow:4px 4px 16px rgba(0,0,0,0.4);text-align:center;';

        const title = document.createElement('div');
        title.textContent = 'Project Name';
        title.style.cssText = 'font-size:16px;font-weight:bold;color:#1a3a6a;margin-bottom:16px;';
        box.appendChild(title);

        const desc = document.createElement('div');
        desc.textContent = 'Enter a name for your project:';
        desc.style.cssText = 'font-size:12px;color:#446;margin-bottom:12px;';
        box.appendChild(desc);

        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.projectName;
        input.style.cssText = 'width:100%;padding:8px 12px;border:1px solid #999;border-radius:4px;font-size:14px;box-sizing:border-box;margin-bottom:16px;';
        box.appendChild(input);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;';

        const okBtn = document.createElement('button');
        okBtn.textContent = 'OK';
        okBtn.style.cssText = 'padding:6px 24px;background:linear-gradient(180deg,#6a9fe8,#4a7cc9);color:white;border:1px solid #3a5a8a;border-radius:3px;cursor:pointer;font-size:12px;font-weight:bold;';
        okBtn.addEventListener('click', () => {
            const name = input.value.trim() || 'Untitled Project';
            this.projectName = name;
            this._updateTitleBar();
            modal.remove();
            if (callback) callback(name);
        });
        btnRow.appendChild(okBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding:6px 24px;background:linear-gradient(180deg,#e0e0e0,#c0c0c0);color:#333;border:1px solid #999;border-radius:3px;cursor:pointer;font-size:12px;';
        cancelBtn.addEventListener('click', () => {
            modal.remove();
            if (callback) callback(this.projectName);
        });
        btnRow.appendChild(cancelBtn);

        box.appendChild(btnRow);
        modal.appendChild(box);
        document.body.appendChild(modal);

        // Click outside to dismiss (use default name)
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                if (callback) callback(this.projectName);
            }
        });

        // Focus input and select all
        setTimeout(() => { input.focus(); input.select(); }, 50);

        // Enter key to confirm
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') okBtn.click();
            if (e.key === 'Escape') cancelBtn.click();
        });
    }

    _getProjectData() {
        return {
            projectName: this.projectName,
            version: 1,
            clips: this.timeline.clips.map(c => ({
                id: c.id,
                mediaId: c.mediaId,
                name: c.name,
                track: c.track,
                startTime: c.startTime,
                duration: c.duration,
                trimStart: c.trimStart || 0,
                trimEnd: c.trimEnd || 0,
                effect: c.effect || 'none',
                text: c.text || null,
                fontSize: c.fontSize || null,
                fontColor: c.fontColor || null,
                textPosition: c.textPosition || null,
                textBg: c.textBg || null,
            })),
            mediaItems: this.mediaItems.map(m => ({
                id: m.id,
                name: m.name,
                type: m.type,
                duration: m.duration,
                track: m.track,
            })),
            backgroundMusic: this.backgroundMusic ? {
                name: this.backgroundMusic.name,
                duration: this.backgroundMusic.duration,
            } : null,
            musicAttribution: this.musicAttribution,
            nextMediaId: this.nextMediaId,
        };
    }

    async _saveProject() {
        // If we have a file handle, save directly
        if (this.projectFileHandle) {
            try {
                const writable = await this.projectFileHandle.createWritable();
                const data = JSON.stringify(this._getProjectData(), null, 2);
                await writable.write(data);
                await writable.close();
                this.hasUnsavedChanges = false;
                this._toast(`Saved: ${this.projectName}`, 'success');
                return;
            } catch (e) {
                // Handle might be stale, fall through to Save As
                console.warn('File handle stale, showing save picker:', e);
            }
        }
        // No handle yet, do Save As
        await this._saveProjectAs();
    }

    async _saveProjectAs() {
        const data = JSON.stringify(this._getProjectData(), null, 2);
        const filename = this.projectName.replace(/[^a-zA-Z0-9_\- ]/g, '') + '.mmm';

        // Try File System Access API
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'Matty Milker Movie Maker Project',
                        accept: { 'application/json': ['.mmm'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(data);
                await writable.close();
                this.projectFileHandle = handle;
                this.hasUnsavedChanges = false;
                this._toast(`Saved: ${this.projectName}`, 'success');
                return;
            } catch (e) {
                if (e.name === 'AbortError') return; // User cancelled
                console.warn('File System Access failed, falling back:', e);
            }
        }

        // Fallback: blob download
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        this.hasUnsavedChanges = false;
        this._toast(`Downloaded: ${filename}`, 'success');
    }

    async _openProject() {
        let fileData;

        // Try File System Access API
        if (window.showOpenFilePicker) {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'Matty Milker Movie Maker Project',
                        accept: { 'application/json': ['.mmm'] },
                    }],
                    multiple: false,
                });
                const file = await handle.getFile();
                fileData = await file.text();
                this.projectFileHandle = handle;
            } catch (e) {
                if (e.name === 'AbortError') return; // User cancelled
                console.warn('File System Access failed:', e);
                return;
            }
        } else {
            // Fallback: use file input
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.mmm';
            const filePromise = new Promise((resolve) => {
                input.addEventListener('change', () => {
                    if (input.files.length > 0) {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.readAsText(input.files[0]);
                    } else {
                        resolve(null);
                    }
                });
            });
            input.click();
            fileData = await filePromise;
            if (!fileData) return;
        }

        try {
            const proj = JSON.parse(fileData);
            this._loadProjectData(proj);
        } catch (e) {
            this._toast('Failed to load project file', 'warning');
            console.error('Project load error:', e);
        }
    }

    _loadProjectData(proj) {
        // Clear current state
        this._pause();
        this.currentTime = 0;

        // Restore project name
        this.projectName = proj.projectName || 'Untitled Project';
        this._updateTitleBar();

        // Restore media items (metadata only — files need re-import)
        this.mediaItems = (proj.mediaItems || []).map(m => ({
            id: m.id,
            name: m.name,
            type: m.type,
            duration: m.duration,
            track: m.track,
            file: null,
            url: null,
            element: null,
            videoWidth: 0,
            videoHeight: 0,
        }));

        // Restore timeline clips
        this.timeline.clips = (proj.clips || []).map(c => ({
            id: c.id,
            mediaId: c.mediaId,
            name: c.name,
            track: c.track,
            startTime: c.startTime,
            duration: c.duration,
            trimStart: c.trimStart || 0,
            trimEnd: c.trimEnd || 0,
            effect: c.effect || 'none',
            text: c.text || null,
            fontSize: c.fontSize || null,
            fontColor: c.fontColor || null,
            textPosition: c.textPosition || null,
            textBg: c.textBg || null,
        }));

        this.nextMediaId = proj.nextMediaId || (this.mediaItems.length + 1);
        this.musicAttribution = proj.musicAttribution || null;

        // Background music metadata (file needs re-import)
        if (proj.backgroundMusic) {
            this.backgroundMusic = {
                id: this.nextMediaId++,
                name: proj.backgroundMusic.name,
                file: null,
                url: null,
                duration: proj.backgroundMusic.duration,
                element: null,
            };
        } else {
            this.backgroundMusic = null;
        }

        this.hasUnsavedChanges = false;

        // Re-render everything
        this._renderMediaGrid();
        this._renderStoryboard();
        this._renderAudioBar();
        this._renderPreviewFrame(0);
        this._updateTimeDisplay();
        this._drawBlank();

        // Notify user that media files need re-import
        this._toast(`Opened: ${this.projectName}`, 'success');
        setTimeout(() => {
            this._toast('Media files need to be re-imported from their original locations', 'warning');
        }, 1500);
    }

    async _newProject() {
        if (this.hasUnsavedChanges || this.timeline.clips.length > 0 || this.mediaItems.length > 0) {
            const confirmed = confirm('Start a new project? Any unsaved changes will be lost.');
            if (!confirmed) return;
        }

        // Clear everything
        this._pause();
        this.currentTime = 0;
        this.timeline.clips = [];
        this.timeline.selectedClipId = null;
        this.mediaItems = [];
        this.nextMediaId = 1;
        this.backgroundMusic = null;
        this.musicAttribution = null;
        this.projectFileHandle = null;
        this.hasUnsavedChanges = false;

        this._renderMediaGrid();
        this._renderStoryboard();
        this._renderAudioBar();
        this._drawBlank();
        this._updateTimeDisplay();

        // Drop zone reset
        const dropZone = document.getElementById('dropZone');
        if (dropZone) dropZone.classList.remove('has-media');

        // Prompt for new project name
        this._showProjectNameModal();
    }

    _markUnsaved() {
        this.hasUnsavedChanges = true;
    }

    _formatTime(seconds) {
        if (!seconds || !isFinite(seconds)) return '0:00:00.00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;
    }

    _updateTimeDisplay() {
        document.getElementById('currentTime').textContent = this._formatTime(this.currentTime);
        const total = Math.max(this.timeline.getTotalDuration(), this.backgroundMusic ? this.backgroundMusic.duration : 0);
        document.getElementById('totalTime').textContent = this._formatTime(total);
        this._updateScrubBar();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('previewCanvas').getContext('2d').save();
    window.app = new MattCutApp();

    // MOOOOOOO splash
    const splash = document.createElement('div');
    splash.id = 'mooSplash';
    splash.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:linear-gradient(180deg,#2a5ca8,#4a7cc9);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:opacity 0.6s;';
    splash.innerHTML = '<div style="font-size:80px;margin-bottom:10px;">🐄</div>' +
        '<div style="font-size:48px;font-weight:bold;color:white;letter-spacing:6px;text-shadow:2px 2px 8px rgba(0,0,0,0.4);" id="mooText">MOOOOOOO</div>' +
        '<div style="font-size:14px;color:rgba(255,255,255,0.7);margin-top:16px;">Matty Milker Movie Maker</div>' +
        '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:8px;">Click anywhere to start</div>';
    document.body.appendChild(splash);

    // Animate the MOO text
    const mooText = document.getElementById('mooText');
    let mooCount = 0;
    const mooAnim = setInterval(() => {
        mooCount++;
        const oCount = 3 + (mooCount % 5);
        mooText.textContent = 'M' + 'O'.repeat(oCount);
        mooText.style.transform = `scale(${1 + Math.sin(mooCount * 0.3) * 0.05})`;
    }, 200);

    // Generate cow MOO sound with Web Audio API
    function playMoo() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const t = ctx.currentTime;
            const dur = 2.2;

            // Fundamental — deep chest resonance (cow vocal cords ~100Hz)
            const f0 = ctx.createOscillator();
            f0.type = 'sawtooth';
            f0.frequency.setValueAtTime(92, t);
            f0.frequency.setValueAtTime(92, t + 0.05);
            f0.frequency.linearRampToValueAtTime(98, t + 0.4);  // slight rise into the "OOO"
            f0.frequency.setValueAtTime(98, t + 1.2);
            f0.frequency.linearRampToValueAtTime(88, t + dur);   // drop off at end

            // Nasal formant — this is the "OOO" sound (~280Hz, strong)
            const nasal = ctx.createOscillator();
            nasal.type = 'sine';
            nasal.frequency.setValueAtTime(280, t);
            nasal.frequency.linearRampToValueAtTime(300, t + 0.3);
            nasal.frequency.setValueAtTime(300, t + 1.0);
            nasal.frequency.linearRampToValueAtTime(260, t + dur);

            // Higher formant for "M" onset buzz (~450Hz)
            const mBuzz = ctx.createOscillator();
            mBuzz.type = 'triangle';
            mBuzz.frequency.setValueAtTime(450, t);
            mBuzz.frequency.linearRampToValueAtTime(380, t + 0.15);
            mBuzz.frequency.setValueAtTime(380, t + 0.5);
            mBuzz.frequency.linearRampToValueAtTime(350, t + dur);

            // Sub-bass rumble for body
            const sub = ctx.createOscillator();
            sub.type = 'sine';
            sub.frequency.setValueAtTime(55, t);
            sub.frequency.linearRampToValueAtTime(50, t + dur);

            // Gain: "M" attack then sustained "OOO"
            const g0 = ctx.createGain();
            g0.gain.setValueAtTime(0, t);
            g0.gain.linearRampToValueAtTime(0.06, t + 0.02);  // fast "M" attack
            g0.gain.linearRampToValueAtTime(0.12, t + 0.15);  // open into "OOO"
            g0.gain.setValueAtTime(0.12, t + 1.4);
            g0.gain.linearRampToValueAtTime(0, t + dur);

            const gN = ctx.createGain();
            gN.gain.setValueAtTime(0, t);
            gN.gain.linearRampToValueAtTime(0.02, t + 0.05);
            gN.gain.linearRampToValueAtTime(0.10, t + 0.2);   // nasal "OOO" comes in strong
            gN.gain.setValueAtTime(0.10, t + 1.4);
            gN.gain.linearRampToValueAtTime(0, t + dur);

            const gM = ctx.createGain();
            gM.gain.setValueAtTime(0, t);
            gM.gain.linearRampToValueAtTime(0.06, t + 0.03);  // "M" buzz loud at start
            gM.gain.linearRampToValueAtTime(0.01, t + 0.25);  // fades as mouth opens
            gM.gain.linearRampToValueAtTime(0, t + dur);

            const gS = ctx.createGain();
            gS.gain.setValueAtTime(0, t);
            gS.gain.linearRampToValueAtTime(0.08, t + 0.1);
            gS.gain.setValueAtTime(0.08, t + 1.4);
            gS.gain.linearRampToValueAtTime(0, t + dur);

            // Band-pass filter centered on nasal formant
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(300, t);
            bp.Q.setValueAtTime(3, t);

            // Low-pass on the sawtooth to soften it
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.setValueAtTime(500, t);
            lp.frequency.linearRampToValueAtTime(400, t + dur);
            lp.Q.setValueAtTime(4, t);

            f0.connect(g0).connect(lp).connect(ctx.destination);
            nasal.connect(gN).connect(bp).connect(ctx.destination);
            mBuzz.connect(gM).connect(ctx.destination);
            sub.connect(gS).connect(ctx.destination);

            f0.start(t); nasal.start(t); mBuzz.start(t); sub.start(t);
            f0.stop(t + dur); nasal.stop(t + dur); mBuzz.stop(t + dur); sub.stop(t + dur);
        } catch(e) {}
    }

    // Dismiss splash
    function dismissSplash() {
        playMoo();
        clearInterval(mooAnim);
        mooText.textContent = 'MOOOOOOO!';
        mooText.style.transform = 'scale(1.1)';
        setTimeout(() => {
            splash.style.opacity = '0';
            setTimeout(() => {
                splash.remove();
                // Show project name modal after splash
                window.app._showProjectNameModal();
            }, 600);
        }, 1200);
    }

    splash.addEventListener('click', dismissSplash);

    // Auto-play moo after a short delay
    setTimeout(() => {
        playMoo();
    }, 500);

    // ── Resizable Panels ──
    function setupResize(handleId, targetEl, dir, minSize, maxSize) {
        const handle = document.getElementById(handleId);
        if (!handle || !targetEl) return;
        let dragging = false;
        let startPos, startSize;

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            dragging = true;
            handle.classList.add('dragging');
            document.body.style.cursor = dir === 'horizontal' ? 'row-resize' : 'col-resize';
            document.body.style.userSelect = 'none';
            if (dir === 'horizontal') {
                startPos = e.clientY;
                startSize = targetEl.offsetHeight;
            } else {
                startPos = e.clientX;
                startSize = targetEl.offsetWidth;
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            let delta;
            if (dir === 'horizontal') {
                delta = startPos - e.clientY; // dragging up = bigger
                const newSize = Math.max(minSize, Math.min(maxSize, startSize + delta));
                targetEl.style.height = newSize + 'px';
                targetEl.style.flexBasis = newSize + 'px';
            } else {
                delta = e.clientX - startPos;
                const newSize = Math.max(minSize, Math.min(maxSize, startSize + delta));
                targetEl.style.width = newSize + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                handle.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    const sidebar = document.querySelector('.sidebar');
    const centerArea = document.querySelector('.center-area');
    const storyboardSection = document.querySelector('.storyboard-section');

    setupResize('resizeSidebar', sidebar, 'vertical', 100, 350);
    setupResize('resizeCenter', centerArea, 'vertical', 150, 600);
    setupResize('resizeTimeline', storyboardSection, 'horizontal', 100, 450);
});
