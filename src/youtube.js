// Matty Milker Movie Maker - YouTube Upload Module

class YouTubeUploader {
    constructor() {
        this.clientId = '801264622233-3c58511srb0erpiujur0o3e5988ua901.apps.googleusercontent.com';
        this.scopes = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
        this.accessToken = null;
        this.userName = null;
        this.channels = [];
        this.selectedChannelId = null;

        // Restore saved session
        this._restoreSession();
    }

    _restoreSession() {
        try {
            const saved = localStorage.getItem('yt_session');
            if (saved) {
                const data = JSON.parse(saved);
                this.accessToken = data.accessToken;
                this.userName = data.userName;
                this.channels = data.channels || [];
                this.selectedChannelId = data.selectedChannelId;
            }
        } catch(e) {}
    }

    _saveSession() {
        try {
            localStorage.setItem('yt_session', JSON.stringify({
                accessToken: this.accessToken,
                userName: this.userName,
                channels: this.channels,
                selectedChannelId: this.selectedChannelId,
            }));
        } catch(e) {}
    }

    _clearSession() {
        try { localStorage.removeItem('yt_session'); } catch(e) {}
    }

    // Start Google OAuth flow
    async signIn() {
        // In Electron, use the main process local server approach
        if (window.electronAPI) {
            try {
                const token = await window.electronAPI.youtubeOAuth(this.clientId, this.scopes);
                if (token) {
                    this.accessToken = token;
                    await this._getUserInfo();
                    return this.userName;
                }
                throw new Error('No token received');
            } catch (e) {
                throw new Error('Sign-in failed: ' + e.message);
            }
        }

        // Web: use popup flow
        return new Promise((resolve, reject) => {
            const redirectUri = window.location.origin + window.location.pathname;

            const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
                '?client_id=' + encodeURIComponent(this.clientId) +
                '&redirect_uri=' + encodeURIComponent(redirectUri) +
                '&response_type=token' +
                '&scope=' + encodeURIComponent(this.scopes) +
                '&include_granted_scopes=true' +
                '&prompt=consent';

            const popup = window.open(authUrl, 'google-auth', 'width=500,height=600,menubar=no,toolbar=no');

            if (!popup) {
                reject(new Error('Popup blocked. Please allow popups for this site.'));
                return;
            }

            const pollTimer = setInterval(() => {
                try {
                    if (popup.closed) {
                        clearInterval(pollTimer);
                        reject(new Error('Sign-in cancelled'));
                        return;
                    }
                    const popupUrl = popup.location.href;
                    if (popupUrl.includes('access_token=')) {
                        clearInterval(pollTimer);
                        const hash = popup.location.hash.substring(1);
                        const params = new URLSearchParams(hash);
                        this.accessToken = params.get('access_token');
                        popup.close();
                        this._getUserInfo().then(resolve).catch(resolve);
                    }
                } catch (e) {
                    // Cross-origin — keep polling
                }
            }, 500);
        });
    }

    async _getUserInfo() {
        try {
            const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { 'Authorization': 'Bearer ' + this.accessToken }
            });
            const data = await resp.json();
            this.userName = data.name || data.email || 'Connected';

            // Fetch channels for this account
            await this._fetchChannels();
            this._saveSession();

            return this.userName;
        } catch (e) {
            this.userName = 'Connected';
            return this.userName;
        }
    }

    async _fetchChannels() {
        this.channels = [];
        this.selectedChannelId = null;
        try {
            const resp = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50', {
                headers: { 'Authorization': 'Bearer ' + this.accessToken }
            });
            const data = await resp.json();
            if (data.items && data.items.length > 0) {
                this.channels = data.items.map(ch => ({
                    id: ch.id,
                    title: ch.snippet.title,
                    thumbnail: ch.snippet.thumbnails?.default?.url || '',
                }));
                this.selectedChannelId = this.channels[0].id; // Default to first
            }
        } catch (e) {
            console.warn('Could not fetch channels:', e);
        }
    }

    getChannels() {
        return this.channels || [];
    }

    selectChannel(channelId) {
        this.selectedChannelId = channelId;
    }

    signOut() {
        this.accessToken = null;
        this.userName = null;
        this.channels = [];
        this.selectedChannelId = null;
        this._clearSession();
    }

    isSignedIn() {
        return !!this.accessToken;
    }

    // Upload video blob to YouTube
    async upload(blob, metadata, onProgress, onStatus) {
        if (!this.accessToken) {
            throw new Error('Not signed in to YouTube');
        }

        onStatus('Preparing upload...');

        const { title, description, privacy, tags } = metadata;

        // Step 1: Start resumable upload
        // If a specific channel is selected, use onBehalfOfContentOwner or just let the token handle it
        // The YouTube API uploads to the authenticated channel by default
        // For brand accounts, the channelId in snippet handles it
        const uploadParams = 'uploadType=resumable&part=snippet,status';
        const initResponse = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?' + uploadParams, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + this.accessToken,
                'Content-Type': 'application/json',
                'X-Upload-Content-Length': blob.size,
                'X-Upload-Content-Type': 'video/mp4',
            },
            body: JSON.stringify({
                snippet: {
                    title: title || 'Untitled Video',
                    description: description || '',
                    tags: tags || [],
                    categoryId: '22', // People & Blogs
                },
                status: {
                    privacyStatus: privacy || 'private',
                    selfDeclaredMadeForKids: false,
                }
            })
        });

        if (!initResponse.ok) {
            const err = await initResponse.text();
            throw new Error('YouTube API error: ' + err);
        }

        const uploadUrl = initResponse.headers.get('Location');
        if (!uploadUrl) {
            throw new Error('No upload URL returned from YouTube');
        }

        // Step 2: Upload the video data
        onStatus('Uploading to YouTube...');

        const chunkSize = 5 * 1024 * 1024; // 5MB chunks
        let offset = 0;
        const totalSize = blob.size;

        while (offset < totalSize) {
            const end = Math.min(offset + chunkSize, totalSize);
            const chunk = blob.slice(offset, end);

            const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Range': `bytes ${offset}-${end - 1}/${totalSize}`,
                    'Content-Type': 'video/mp4',
                },
                body: chunk,
            });

            if (uploadResponse.status === 200 || uploadResponse.status === 201) {
                // Upload complete
                const result = await uploadResponse.json();
                onProgress(100);
                onStatus('Upload complete!');
                return result;
            } else if (uploadResponse.status === 308) {
                // Resume incomplete — continue
                offset = end;
                const pct = Math.round((offset / totalSize) * 100);
                onProgress(pct);
                onStatus(`Uploading to YouTube... ${pct}%`);
            } else {
                const err = await uploadResponse.text();
                throw new Error('Upload error: ' + err);
            }
        }
    }

    // Check if we got a token from the URL hash (redirect callback)
    checkRedirect() {
        const hash = window.location.hash;
        if (hash && hash.includes('access_token=')) {
            const params = new URLSearchParams(hash.substring(1));
            this.accessToken = params.get('access_token');
            // Clean up the URL
            history.replaceState(null, '', window.location.pathname);
            this._getUserInfo();
            return true;
        }
        return false;
    }
}
