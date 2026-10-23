const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blaubeTalk', {
  onState: (cb) => ipcRenderer.on('talk-state', (_e, s) => cb(s)),
  send: (text) => ipcRenderer.send('talk-send', text),
  close: () => ipcRenderer.send('talk-close'),
  terminal: () => ipcRenderer.send('talk-terminal'),
});
