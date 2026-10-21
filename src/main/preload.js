const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blaube', {
  setIgnoreMouse: (ignore) => ipcRenderer.send('ignore-mouse', !!ignore),
  acknowledge: (id) => ipcRenderer.send('acknowledge', id || null),
  showAppMenu: () => ipcRenderer.send('app-menu'),
  showSessionMenu: (id) => ipcRenderer.send('session-menu', id),
  openSession: (id) => ipcRenderer.send('open-session', id),
  openTuning: () => ipcRenderer.send('open-tuning'),
  ready: () => ipcRenderer.send('ready'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onConfig: (cb) => ipcRenderer.on('config', (_e, c) => cb(c)),
  onWorld: (cb) => ipcRenderer.on('world', (_e, w) => cb(w)),
  onCommand: (cb) => ipcRenderer.on('command', (_e, c) => cb(c)),
});
