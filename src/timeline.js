// MattCut - Timeline Manager

class TimelineManager {
    constructor() {
        this.clips = [];
        this.transitions = [];
        this.selectedClipId = null;
        this.pixelsPerSecond = 20; // Start zoomed out to see 3-4 clips
        this.trackOffset = 80; // width of track label
        this.nextId = 1;
        this.dragging = null;
        this.trimming = null;

        this.container = document.getElementById('timelineContainer');
        this.videoClips = document.getElementById('videoClips');
        this.audioClips = document.getElementById('audioClips');
        this.textClips = document.getElementById('textClips');
        this.ruler = document.getElementById('timelineRuler');
        this.playheadLine = document.getElementById('playheadLine');

        this._setupDragListeners();
        this.renderRuler();
    }

    addClip(mediaItem) {
        const lastClip = this.clips
            .filter(c => c.track === mediaItem.track)
            .sort((a, b) => (a.startTime + a.duration) - (b.startTime + b.duration))
            .pop();

        const startTime = lastClip ? lastClip.startTime + lastClip.duration : 0;

        const clip = {
            id: this.nextId++,
            mediaId: mediaItem.id,
            name: mediaItem.name,
            type: mediaItem.type,
            track: mediaItem.track,
            startTime: startTime,
            duration: mediaItem.duration || 5,
            trimStart: 0,
            trimEnd: 0,
            originalDuration: mediaItem.duration || 5,
            // For text clips
            text: mediaItem.text || '',
            fontSize: mediaItem.fontSize || 48,
            fontColor: mediaItem.fontColor || '#ffffff',
            textPosition: mediaItem.textPosition || 'center',
            textBg: mediaItem.textBg || 'none',
        };

        this.clips.push(clip);
        this.autoFitZoom();
        return clip;
    }

    removeClip(clipId) {
        this.clips = this.clips.filter(c => c.id !== clipId);
        this.transitions = this.transitions.filter(
            t => t.clipBeforeId !== clipId && t.clipAfterId !== clipId
        );
        if (this.selectedClipId === clipId) this.selectedClipId = null;
        this.autoFitZoom();
    }

    splitClip(clipId, splitTime) {
        const clip = this.clips.find(c => c.id === clipId);
        if (!clip) return;

        const relativeTime = splitTime - clip.startTime;
        if (relativeTime <= 0.1 || relativeTime >= clip.duration - 0.1) return;

        const newClip = {
            ...clip,
            id: this.nextId++,
            startTime: clip.startTime + relativeTime,
            duration: clip.duration - relativeTime,
            trimStart: clip.trimStart + relativeTime,
        };

        clip.duration = relativeTime;
        clip.trimEnd = clip.originalDuration - (clip.trimStart + relativeTime);

        this.clips.push(newClip);
        this.render();
    }

    selectClip(clipId) {
        this.selectedClipId = clipId;
        this.render();
    }

    getSelectedClip() {
        return this.clips.find(c => c.id === this.selectedClipId);
    }

    addTransition(clipId, type, duration) {
        const clip = this.clips.find(c => c.id === clipId);
        if (!clip) return;

        // Find the clip before this one on the same track
        const trackClips = this.clips
            .filter(c => c.track === clip.track && c.startTime < clip.startTime)
            .sort((a, b) => b.startTime - a.startTime);

        const prevClip = trackClips[0];

        this.transitions.push({
            id: this.nextId++,
            clipBeforeId: prevClip ? prevClip.id : null,
            clipAfterId: clipId,
            type: type,
            duration: duration
        });
        this.render();
    }

    getTotalDuration() {
        if (this.clips.length === 0) return 0;
        let max = 0;
        for (const clip of this.clips) {
            const end = clip.startTime + clip.duration;
            if (end > max) max = end;
        }
        return max;
    }

    getClipAtTime(time, track) {
        return this.clips.find(c =>
            c.track === (track || 'video') &&
            time >= c.startTime &&
            time < c.startTime + c.duration
        );
    }

    getClipsForTrack(track) {
        return this.clips
            .filter(c => c.track === track)
            .sort((a, b) => a.startTime - b.startTime);
    }

    getTransitionForClip(clipId) {
        return this.transitions.find(t => t.clipAfterId === clipId);
    }

    setZoom(direction) {
        if (direction > 0) {
            this.pixelsPerSecond = Math.min(200, this.pixelsPerSecond + 20);
        } else {
            this.pixelsPerSecond = Math.max(5, this.pixelsPerSecond - 20);
        }
        this.render();
        this.renderRuler();
    }

    // Auto-fit zoom so all clips are visible in the container width
    autoFitZoom() {
        const totalDuration = this.getTotalDuration();
        if (totalDuration <= 0) { this.pixelsPerSecond = 20; return; }
        const containerWidth = this.container.clientWidth - this.trackOffset - 40; // padding
        const ideal = containerWidth / totalDuration;
        // Clamp between 5 and 200
        this.pixelsPerSecond = Math.max(5, Math.min(200, ideal));
        this.render();
        this.renderRuler();
    }

    timeToPixels(time) {
        return time * this.pixelsPerSecond;
    }

    pixelsToTime(px) {
        return px / this.pixelsPerSecond;
    }

    renderRuler() {
        this.ruler.innerHTML = '';
        const totalDuration = Math.max(this.getTotalDuration() + 10, 30);
        const totalWidth = this.timeToPixels(totalDuration) + this.trackOffset;
        this.ruler.style.width = totalWidth + 'px';

        const step = this.pixelsPerSecond >= 60 ? 1 : this.pixelsPerSecond >= 30 ? 2 : 5;

        for (let t = 0; t <= totalDuration; t += step) {
            const mark = document.createElement('div');
            mark.className = 'ruler-mark' + (t % (step * 5) === 0 ? ' major' : '');
            mark.style.left = (this.timeToPixels(t) + this.trackOffset) + 'px';
            const mins = Math.floor(t / 60);
            const secs = Math.floor(t % 60);
            mark.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
            this.ruler.appendChild(mark);
        }
    }

    render() {
        this._renderTrack(this.videoClips, 'video');
        this._renderTrack(this.audioClips, 'audio');
        this._renderTrack(this.textClips, 'text');
        this.renderRuler();
        this._updateTrackWidths();
    }

    _updateTrackWidths() {
        const totalDuration = Math.max(this.getTotalDuration() + 10, 30);
        const totalWidth = this.timeToPixels(totalDuration);
        this.videoClips.style.minWidth = totalWidth + 'px';
        this.audioClips.style.minWidth = totalWidth + 'px';
        this.textClips.style.minWidth = totalWidth + 'px';
    }

    _renderTrack(container, trackName) {
        container.innerHTML = '';
        const trackClips = this.getClipsForTrack(trackName);

        for (const clip of trackClips) {
            const el = document.createElement('div');
            el.className = `timeline-clip ${clip.type}-clip`;
            if (clip.id === this.selectedClipId) el.classList.add('selected');

            el.style.left = this.timeToPixels(clip.startTime) + 'px';
            el.style.width = this.timeToPixels(clip.duration) + 'px';

            el.dataset.clipId = clip.id;
            el.textContent = clip.type === 'text' ? `"${clip.text}"` : clip.name;

            // Trim handles
            const leftHandle = document.createElement('div');
            leftHandle.className = 'trim-handle left';
            leftHandle.dataset.side = 'left';
            el.appendChild(leftHandle);

            const rightHandle = document.createElement('div');
            rightHandle.className = 'trim-handle right';
            rightHandle.dataset.side = 'right';
            el.appendChild(rightHandle);

            container.appendChild(el);

            // Transition marker
            const transition = this.getTransitionForClip(clip.id);
            if (transition) {
                const marker = document.createElement('div');
                marker.className = 'transition-marker';
                marker.style.left = (this.timeToPixels(clip.startTime) - 12) + 'px';
                marker.title = `${transition.type} (${transition.duration}s)`;
                marker.textContent = '⇄';
                container.appendChild(marker);
            }
        }
    }

    updatePlayhead(time) {
        this.playheadLine.style.left = (this.timeToPixels(time) + this.trackOffset) + 'px';
    }

    _setupDragListeners() {
        // Double-click text clips to edit inline
        this.container.addEventListener('dblclick', (e) => {
            const clipEl = e.target.closest('.timeline-clip');
            if (!clipEl) return;
            const clipId = parseInt(clipEl.dataset.clipId);
            const clip = this.clips.find(c => c.id === clipId);
            if (!clip || clip.type !== 'text') return;

            // Open the text editing modal instead of inline edit
            if (this.onTextEdit) this.onTextEdit(clip);
            e.stopPropagation();
        });

        this.container.addEventListener('mousedown', (e) => {
            // Playhead drag — click on ruler or playhead line
            const isPlayhead = e.target.closest('.playhead-line') || e.target.closest('.timeline-ruler');
            if (isPlayhead) {
                const rect = this.container.getBoundingClientRect();
                const scrollLeft = this.container.scrollLeft;
                const x = e.clientX - rect.left + scrollLeft - this.trackOffset;
                const time = Math.max(0, this.pixelsToTime(x));
                if (this.onSeek) this.onSeek(time);
                this._scrubbing = true;
                e.preventDefault();
                return;
            }

            const clipEl = e.target.closest('.timeline-clip');
            if (!clipEl) {
                // Clicked on empty track space - move playhead and start scrubbing
                if (e.target.closest('.track-clips')) {
                    const rect = this.container.getBoundingClientRect();
                    const scrollLeft = this.container.scrollLeft;
                    const x = e.clientX - rect.left + scrollLeft - this.trackOffset;
                    const time = Math.max(0, this.pixelsToTime(x));
                    if (this.onSeek) this.onSeek(time);
                    this._scrubbing = true;
                }
                return;
            }

            const clipId = parseInt(clipEl.dataset.clipId);
            this.selectClip(clipId);
            if (this.onSelect) this.onSelect(clipId);

            const trimHandle = e.target.closest('.trim-handle');
            if (trimHandle) {
                this._startTrim(clipId, trimHandle.dataset.side, e);
            } else {
                this._startDrag(clipId, e);
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (this.dragging) this._onDrag(e);
            if (this.trimming) this._onTrim(e);
            if (this._scrubbing) {
                const rect = this.container.getBoundingClientRect();
                const scrollLeft = this.container.scrollLeft;
                const x = e.clientX - rect.left + scrollLeft - this.trackOffset;
                const time = Math.max(0, this.pixelsToTime(x));
                if (this.onSeek) this.onSeek(time);
            }
        });

        document.addEventListener('mouseup', () => {
            this.dragging = null;
            this.trimming = null;
            this._scrubbing = false;
        });

        // Horizontal scroll with mouse wheel (Shift+scroll or regular scroll)
        this.container.addEventListener('wheel', (e) => {
            if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                // Already horizontal scrolling
                return;
            }
            // Convert vertical scroll to horizontal
            e.preventDefault();
            this.container.scrollLeft += e.deltaY;
        }, { passive: false });
    }

    _startDrag(clipId, e) {
        const clip = this.clips.find(c => c.id === clipId);
        if (!clip) return;
        this.dragging = {
            clipId,
            startX: e.clientX,
            originalStart: clip.startTime
        };
    }

    _onDrag(e) {
        const clip = this.clips.find(c => c.id === this.dragging.clipId);
        if (!clip) return;
        const dx = e.clientX - this.dragging.startX;
        const dt = this.pixelsToTime(dx);
        clip.startTime = Math.max(0, this.dragging.originalStart + dt);
        this.render();
    }

    _startTrim(clipId, side, e) {
        const clip = this.clips.find(c => c.id === clipId);
        if (!clip) return;
        this.trimming = {
            clipId,
            side,
            startX: e.clientX,
            originalStart: clip.startTime,
            originalDuration: clip.duration,
            originalTrimStart: clip.trimStart,
            originalTrimEnd: clip.trimEnd
        };
    }

    _onTrim(e) {
        const clip = this.clips.find(c => c.id === this.trimming.clipId);
        if (!clip) return;
        const dx = e.clientX - this.trimming.startX;
        const dt = this.pixelsToTime(dx);

        // Max allowed duration = original minus any trim on the other side
        const maxDuration = clip.originalDuration - clip.trimStart;

        if (this.trimming.side === 'left') {
            const newStart = Math.max(0, this.trimming.originalStart + dt);
            const diff = newStart - this.trimming.originalStart;
            const newDuration = this.trimming.originalDuration - diff;
            const newTrimStart = this.trimming.originalTrimStart + diff;
            // Don't trim past the start of the media or beyond original duration
            if (newTrimStart < 0 || newDuration < 0.2) return;
            clip.startTime = newStart;
            clip.duration = newDuration;
            clip.trimStart = newTrimStart;
        } else {
            const newDuration = this.trimming.originalDuration + dt;
            const newTrimEnd = this.trimming.originalTrimEnd - dt;
            // Clamp: can't extend beyond original duration, can't shrink below 0.2s
            const maxRight = clip.originalDuration - clip.trimStart;
            clip.duration = Math.max(0.2, Math.min(maxRight, newDuration));
            clip.trimEnd = Math.max(0, clip.originalDuration - clip.trimStart - clip.duration);
        }
        this.render();
        if (this.onTrim) this.onTrim(clip);
    }
}
