const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blaubeTalk', {
  onState: (cb) => ipcRenderer.on('talk-state', (_e, s) => cb(s)),
  onRefused: (cb) => ipcRenderer.on('talk-refused', (_e, key) => cb(key)),
  onTail: (cb) => ipcRenderer.on('talk-tail', (_e, t) => cb(t)),
  setHeight: (id, h) => ipcRenderer.send('talk-height', id, h),
  send: (id, text) => ipcRenderer.send('talk-send', id, text),
  unsend: (id, n) => ipcRenderer.send('talk-unsend', id, n),
  decide: (id, key, choice, answers) => ipcRenderer.send('talk-permission', id, key, choice, answers),
  close: () => ipcRenderer.send('talk-close'),
  terminal: () => ipcRenderer.send('talk-terminal'),
});
