const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const http = require('http');

let mainWindow;

// Find FFmpeg — check bundled sidecar first, then PATH
function getFFmpegPath() {
    // Check bundled location (for packaged app)
    const bundled = path.join(process.resourcesPath || __dirname, 'binaries', 'ffmpeg.exe');
    if (fs.existsSync(bundled)) return bundled;

    // Check in src-tauri (from previous build)
    const tauriBin = path.join(__dirname, 'src-tauri', 'binaries', 'ffmpeg-x86_64-pc-windows-msvc.exe');
    if (fs.existsSync(tauriBin)) return tauriBin;

    // Check common locations
    const common = [
        path.join(__dirname, 'ffmpeg.exe'),
        path.join(__dirname, 'binaries', 'ffmpeg.exe'),
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
    ];
    for (const p of common) {
        if (fs.existsSync(p)) return p;
    }

    // Fall back to PATH
    return 'ffmpeg';
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: 'Matty Milker Movie Maker',
        icon: path.join(__dirname, 'src', 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false, // Allow loading local files for media preview
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
    mainWindow.setMenuBarVisibility(false);

    // Open DevTools in dev mode
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ── File Dialogs ──

ipcMain.handle('open-files-dialog', async (_, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Media Files', extensions: ['mp4','mkv','avi','mov','webm','wmv','flv','m4v','jpg','jpeg','png','gif','bmp','webp','mp3','wav','ogg','aac','flac','m4a'] },
        ],
    });
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('save-file-dialog', async (_, defaultName) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName,
        filters: [
            { name: 'MP4 Video', extensions: ['mp4'] },
        ],
    });
    return result.canceled ? null : result.filePath;
});

// ── Get real file path from drag-drop ──
// In Electron, dropped files have .path — this just confirms it
ipcMain.handle('get-file-path', async (_, filePath) => {
    if (fs.existsSync(filePath)) return filePath;
    return null;
});

// ── Check GPU NVENC ──
ipcMain.handle('check-gpu', async () => {
    const ffmpeg = getFFmpegPath();
    return new Promise((resolve) => {
        execFile(ffmpeg, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.1',
            '-c:v', 'h264_nvenc', '-preset', 'p4',
            '-f', 'null', '-'
        ], (err) => {
            resolve(!err);
        });
    });
});

// ── Write temp file (for web File blobs that need a real path) ──
ipcMain.handle('write-temp-file', async (_, name, data) => {
    const tempDir = path.join(os.tmpdir(), 'mattcut_media');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(tempDir, safeName);
    fs.writeFileSync(filePath, Buffer.from(data));
    return filePath;
});

// ── Probe audio streams ──
ipcMain.handle('probe-audio', async (_, filePath) => {
    const ffmpeg = getFFmpegPath();
    return new Promise((resolve) => {
        execFile(ffmpeg, [
            '-hide_banner', '-i', filePath,
            '-map', '0:a', '-f', 'null', '-t', '0.01', '-'
        ], (err) => {
            resolve(!err);
        });
    });
});

// ── Export Video via FFmpeg ──
let currentExportProcess = null;

ipcMain.handle('export-video', async (event, settings) => {
    const ffmpeg = getFFmpegPath();

    // Check NVENC
    const hasNvenc = await new Promise((resolve) => {
        execFile(ffmpeg, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.1',
            '-c:v', 'h264_nvenc', '-preset', 'p4',
            '-f', 'null', '-'
        ], (err) => resolve(!err));
    });

    const videoCodec = hasNvenc ? 'h264_nvenc' : 'libx264';
    const preset = hasNvenc ? 'p4' : 'medium';

    mainWindow.webContents.send('export-progress', {
        percent: 5,
        status: `Using ${hasNvenc ? 'GPU NVENC' : 'CPU'} (${videoCodec})`,
    });

    // Probe each file for audio
    const hasAudio = [];
    for (let i = 0; i < settings.input_files.length; i++) {
        if (settings.types[i] === 'image') {
            hasAudio.push(false);
        } else {
            const result = await new Promise((resolve) => {
                execFile(ffmpeg, [
                    '-hide_banner', '-i', settings.input_files[i],
                    '-map', '0:a', '-f', 'null', '-t', '0.01', '-'
                ], (err) => resolve(!err));
            });
            hasAudio.push(result);
        }
    }

    // Build FFmpeg args
    const inputs = [];
    const filterParts = [];

    for (let i = 0; i < settings.input_files.length; i++) {
        const file = settings.input_files[i];
        const type = settings.types[i];

        if (type === 'image') {
            inputs.push('-loop', '1', '-t', String(settings.durations[i]), '-i', file);
        } else {
            inputs.push('-i', file);
        }

        // Scale video
        filterParts.push(
            `[${i}:v]scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`
        );

        // Audio
        if (hasAudio[i]) {
            filterParts.push(
                `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}]`
            );
        } else {
            filterParts.push(
                `aevalsrc=0:d=${settings.durations[i]}:s=48000:c=stereo[a${i}]`
            );
        }
    }

    // Concat
    const n = settings.input_files.length;
    const concatInputs = Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join('');
    const filter = `${filterParts.join(';')};${concatInputs}concat=n=${n}:v=1:a=1[outv][outa]`;

    const args = ['-y', '-hide_banner', '-progress', 'pipe:1'];
    args.push(...inputs);

    // Background music
    if (settings.background_music) {
        args.push('-i', settings.background_music);
    }

    args.push('-filter_complex', filter);
    args.push('-map', '[outv]');

    if (settings.background_music) {
        args.push('-map', `${n}:a?`);
    } else {
        args.push('-map', '[outa]');
    }

    // Encoding
    args.push(
        '-c:v', videoCodec,
        '-preset', preset,
        '-b:v', settings.video_bitrate,
        '-maxrate', settings.video_bitrate,
        '-c:a', 'aac',
        '-b:a', settings.audio_bitrate,
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
        '-r', String(settings.fps),
    );

    if (videoCodec === 'libx264') {
        args.push('-profile:v', 'high', '-level', '4.2');
    }
    args.push('-pix_fmt', 'yuv420p');
    args.push(settings.output_path);

    mainWindow.webContents.send('export-progress', { percent: 10, status: 'FFmpeg encoding...' });

    const totalDuration = settings.durations.reduce((a, b) => a + b, 0);
    const totalFrames = Math.ceil(totalDuration * settings.fps);

    return new Promise((resolve, reject) => {
        const proc = spawn(ffmpeg, args);
        currentExportProcess = proc;
        let stderr = '';

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('frame=')) {
                    const frame = parseInt(line.substring(6).trim());
                    if (!isNaN(frame)) {
                        const pct = totalFrames > 0
                            ? 10 + Math.min(85, (frame / totalFrames) * 85)
                            : 50;
                        mainWindow.webContents.send('export-progress', {
                            percent: pct,
                            status: `Encoding frame ${frame} / ${totalFrames}...`,
                        });
                    }
                }
            }
        });

        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
            currentExportProcess = null;
            if (code === 0) {
                mainWindow.webContents.send('export-progress', { percent: 100, status: 'Export complete!' });
                resolve(settings.output_path);
            } else {
                // If NVENC failed, retry with CPU
                if (hasNvenc && (stderr.includes('nvenc') || stderr.includes('NVENC') || stderr.includes('Driver does not support'))) {
                    mainWindow.webContents.send('export-progress', { percent: 10, status: 'GPU failed, retrying with CPU...' });
                    const cpuArgs = args.map(a => {
                        if (a === 'h264_nvenc') return 'libx264';
                        if (a === 'p4') return 'medium';
                        return a;
                    });
                    // Add profile/level if not already there
                    if (!cpuArgs.includes('-profile:v')) {
                        const outIdx = cpuArgs.indexOf(settings.output_path);
                        cpuArgs.splice(outIdx, 0, '-profile:v', 'high', '-level', '4.2');
                    }

                    const proc2 = spawn(ffmpeg, cpuArgs);
                    currentExportProcess = proc2;
                    let stderr2 = '';

                    proc2.stdout.on('data', (data) => {
                        const lines = data.toString().split('\n');
                        for (const line of lines) {
                            if (line.startsWith('frame=')) {
                                const frame = parseInt(line.substring(6).trim());
                                if (!isNaN(frame)) {
                                    const pct = totalFrames > 0 ? 10 + Math.min(85, (frame / totalFrames) * 85) : 50;
                                    mainWindow.webContents.send('export-progress', { percent: pct, status: `CPU encoding frame ${frame} / ${totalFrames}...` });
                                }
                            }
                        }
                    });
                    proc2.stderr.on('data', (d) => { stderr2 += d.toString(); });
                    proc2.on('close', (code2) => {
                        currentExportProcess = null;
                        if (code2 === 0) {
                            mainWindow.webContents.send('export-progress', { percent: 100, status: 'Export complete!' });
                            resolve(settings.output_path);
                        } else {
                            reject(new Error('FFmpeg failed: ' + stderr2.substring(0, 500)));
                        }
                    });
                } else {
                    reject(new Error('FFmpeg failed: ' + stderr.substring(0, 500)));
                }
            }
        });

        proc.on('error', (err) => {
            currentExportProcess = null;
            reject(new Error('Failed to start FFmpeg: ' + err.message));
        });
    });
});

// ── Cancel Export ──
ipcMain.handle('cancel-export', async () => {
    if (currentExportProcess) {
        currentExportProcess.kill('SIGTERM');
        currentExportProcess = null;
    }
});

// ── Read file as buffer (for YouTube upload from exported file) ──
ipcMain.handle('read-file-buffer', async (_, filePath) => {
    return fs.readFileSync(filePath);
});

// ── Write temp file from Buffer (for large files) ──
ipcMain.handle('write-temp-file-buffer', async (_, name, buffer) => {
    const tempDir = path.join(os.tmpdir(), 'mattcut_media');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(tempDir, safeName);
    fs.writeFileSync(filePath, buffer);
    return filePath;
});

// ── Get temp file path ──
ipcMain.handle('get-temp-path', async (_, filename) => {
    const tempDir = path.join(os.tmpdir(), 'mattcut_media');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(tempDir, safeName);
});

// ── Check if file exists ──
ipcMain.handle('file-exists', async (_, filePath) => {
    return fs.existsSync(filePath);
});

// ── YouTube OAuth via local server ──
ipcMain.handle('youtube-oauth', async (_, clientId, scopes) => {
    return new Promise((resolve, reject) => {
        // Start a temporary local HTTP server to catch the OAuth redirect
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://localhost');

            if (url.pathname === '/callback') {
                // Serve a page that extracts the token from the hash fragment
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<!DOCTYPE html><html><body>
                    <h2>Sign-in successful! You can close this tab.</h2>
                    <script>
                        const hash = window.location.hash.substring(1);
                        const params = new URLSearchParams(hash);
                        const token = params.get('access_token');
                        if (token) {
                            fetch('/token?access_token=' + encodeURIComponent(token))
                                .then(() => window.close());
                        }
                    </script>
                </body></html>`);
            } else if (url.pathname === '/token') {
                const token = url.searchParams.get('access_token');
                res.writeHead(200); res.end('OK');
                server.close();
                resolve(token);
            } else {
                res.writeHead(404); res.end();
            }
        });

        // Listen on fixed port so it can be registered in Google Console
        server.listen(9847, '127.0.0.1', () => {
            const port = 9847;
            const redirectUri = `http://localhost:${port}/callback`;

            const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
                '?client_id=' + encodeURIComponent(clientId) +
                '&redirect_uri=' + encodeURIComponent(redirectUri) +
                '&response_type=token' +
                '&scope=' + encodeURIComponent(scopes) +
                '&include_granted_scopes=true' +
                '&prompt=consent';

            // Open in user's default browser (not Electron window)
            shell.openExternal(authUrl);
        });

        // Timeout after 5 minutes
        setTimeout(() => { server.close(); reject(new Error('OAuth timeout')); }, 300000);
    });
});
