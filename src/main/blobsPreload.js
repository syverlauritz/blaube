const { contextBridge, ipcRenderer } = require('electron');

// The Blobs overview's way to the app (see openBlobs in main.js).
contextBridge.exposeInMainWorld('blaubeBlobs', {
	onState: (cb) => ipcRenderer.on('blobs-state', (_e, s) => cb(s)),
	toggle: (id) => ipcRenderer.send('blobs-toggle', id),
	toggleHelper: (key) => ipcRenderer.send('blobs-helper-toggle', key),
	resize: (phase, edge, x, y) => ipcRenderer.send('blobs-resize', phase, edge, x, y),
	showAll: () => ipcRenderer.send('blobs-show-all'),
	hideIdle: () => ipcRenderer.send('blobs-hide-idle'),
	setMax: (n) => ipcRenderer.send('blobs-max', n),
	talk: (id) => ipcRenderer.send('blobs-talk', id),
	close: () => ipcRenderer.send('blobs-close'),
	setHeight: (h) => ipcRenderer.send('blobs-height', h),
});
