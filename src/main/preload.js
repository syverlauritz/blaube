const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blaube', {
  setHitAreas: (rects, holding) => ipcRenderer.send('hit-areas', rects, !!holding),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  // On Windows the app reports presses itself (the window's own mouse
  // events stop arriving after a while); elsewhere the window's are used.
  usesPointer: process.platform === 'win32',
  onPointer: (cb) => ipcRenderer.on('pointer', (_e, p) => cb(p)),
  acknowledge: (id) => ipcRenderer.send('acknowledge', id || null),
  showAppMenu: () => ipcRenderer.send('app-menu'),
  showSessionMenu: (id) => ipcRenderer.send('session-menu', id),
  openSession: (id) => ipcRenderer.send('open-session', id),
  talk: (id, at) => ipcRenderer.send('talk', id, at),
  talkAt: (id, at) => ipcRenderer.send('talk-at', id, at),
  openTuning: () => ipcRenderer.send('open-tuning'),
  ready: () => ipcRenderer.send('ready'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onConfig: (cb) => ipcRenderer.on('config', (_e, c) => cb(c)),
  onWorld: (cb) => ipcRenderer.on('world', (_e, w) => cb(w)),
  onLedges: (cb) => ipcRenderer.on('ledges', (_e, l) => cb(l)),
  onCommand: (cb) => ipcRenderer.on('command', (_e, c) => cb(c)),
  onSay: (cb) => ipcRenderer.on('say', (_e, m) => cb(m)),
  onReact: (cb) => ipcRenderer.on('react', (_e, m) => cb(m)),
  onOpenTalk: (cb) => ipcRenderer.on('open-talk', (_e, id) => cb(id)),
  onTalking: (cb) => ipcRenderer.on('talking', (_e, id) => cb(id)),
  onNod: (cb) => ipcRenderer.on('nod', (_e, id) => cb(id)),
});
