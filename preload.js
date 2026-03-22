const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // File dialogs
    openFilesDialog: () => ipcRenderer.invoke('open-files-dialog'),
    saveFileDialog: (defaultName) => ipcRenderer.invoke('save-file-dialog', defaultName),

    // FFmpeg export
    checkGpu: () => ipcRenderer.invoke('check-gpu'),
    exportVideo: (settings) => ipcRenderer.invoke('export-video', settings),
    cancelExport: () => ipcRenderer.invoke('cancel-export'),
    onExportProgress: (callback) => {
        ipcRenderer.on('export-progress', (_, data) => callback(data));
    },

    // File operations
    writeTempFile: (name, data) => ipcRenderer.invoke('write-temp-file', name, data),
    writeTempFileBuffer: (name, arrayBuffer) => ipcRenderer.invoke('write-temp-file-buffer', name, Buffer.from(arrayBuffer)),
    probeAudio: (filePath) => ipcRenderer.invoke('probe-audio', filePath),
    readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
    fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),

    // YouTube OAuth
    youtubeOAuth: (clientId, scopes) => ipcRenderer.invoke('youtube-oauth', clientId, scopes),

    getTempPath: (filename) => ipcRenderer.invoke('get-temp-path', filename),

    // Platform info
    isElectron: true,
});
