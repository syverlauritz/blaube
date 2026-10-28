const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blaubeTuning', {
  get: () => ipcRenderer.invoke('config-get'),
  set: (partial) => ipcRenderer.send('config-set', partial),
  replace: (full) => ipcRenderer.invoke('config-replace', full),
  copy: () => ipcRenderer.invoke('config-copy'),
  onChange: (f) => ipcRenderer.on('config', (_e, cfg) => f(cfg)),
  demo: () => ipcRenderer.send('demo'),
  lifeDemo: () => ipcRenderer.send('life-demo'),
  sing: (on) => ipcRenderer.send('tuning-sing', on),
});
