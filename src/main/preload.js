const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blaube', {
  setHitAreas: (rects, holding) => ipcRenderer.send('hit-areas', rects, !!holding),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
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
  onSay: (cb) => ipcRenderer.on('say', (_e, m) => cb(m)),
  onNod: (cb) => ipcRenderer.on('nod', (_e, id) => cb(id)),
});
