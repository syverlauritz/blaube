// Stands in for the app's preload: the Blaube window gets the same API, but
// the shots script drives it instead of Claude Code.
const { contextBridge, ipcRenderer } = require('electron');

const handlers = {};
const on = (name) => (cb) => { handlers[name] = cb; };

contextBridge.exposeInMainWorld('blaube', {
	setHitAreas: () => {},
	acknowledge: () => {},
	showAppMenu: () => {},
	showSessionMenu: () => {},
	openSession: () => {},
	openTuning: () => {},
	thinking: (key) => ipcRenderer.invoke('thinking', key),
	ready: () => ipcRenderer.send('ready'),
	onState: on('state'),
	onConfig: on('config'),
	onWorld: on('world'),
	onLedges: on('ledges'),
	onCommand: on('command'),
	onSay: on('say'),
	onNod: on('nod'),
	onTalking: on('talking'),
	onTalkRect: on('talk-rect'),
	onLimits: on('limits'),
	onJarSpot: on('jar-spot'),
	setJarSpot: () => {},
	onCaret: on('caret'),
});

ipcRenderer.on('fire', (_e, name, value) => { if (handlers[name]) handlers[name](value); });
