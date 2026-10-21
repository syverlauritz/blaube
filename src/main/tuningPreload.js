const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blaubeTuning', {
  get: () => ipcRenderer.invoke('config-get'),
  set: (partial) => ipcRenderer.send('config-set', partial),
  replace: (full) => ipcRenderer.invoke('config-replace', full),
  copy: () => ipcRenderer.invoke('config-copy'),
  demo: () => ipcRenderer.send('demo'),
});
