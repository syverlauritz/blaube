const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, dialog, shell, clipboard } = require('electron');
const { SessionTracker } = require('./sessions');
const { startHookServer, DEFAULT_PORT } = require('./hookServer');
const claudeHooks = require('./claudeHooks');
const { openResumeTerminal, resumeCommand, focusSessionApp } = require('./terminal');

const PORT = Number(process.env.BLAUBE_PORT) || DEFAULT_PORT;
const ASSETS = path.join(__dirname, '..', '..', 'build');

let win = null;
let tray = null;
const tracker = new SessionTracker();

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: process.platform !== 'win32', // on Windows, never steal focus from what you're doing
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const fit = () => {
    if (!win) return;
    const d = screen.getPrimaryDisplay().workArea;
    win.setBounds(d);
  };
  screen.on('display-metrics-changed', fit);
  screen.on('display-added', fit);
  screen.on('display-removed', fit);
  win.on('closed', () => { win = null; });
}

function pushState() {
  if (!win) return;
  win.webContents.send('state', {
    sessions: tracker.list(),
    settings: { hooksInstalled: claudeHooks.isInstalled() },
  });
}

function send(cmd) {
  if (win) win.webContents.send('command', cmd);
}

function appMenu() {
  const installed = claudeHooks.isInstalled();
  return Menu.buildFromTemplate([
    { label: 'Blaube', enabled: false },
    { type: 'separator' },
    installed
      ? { label: 'Claude Code connected ✓', enabled: false }
      : { label: 'Connect Claude Code…', click: installHooks },
    { label: 'Come here', click: () => send('come-here') },
    { label: 'Everyone hop!', click: () => send('hop') },
    { label: 'Demo sessions', click: runDemo },
    { type: 'separator' },
    { label: 'Open at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    ...(installed ? [{ label: 'Disconnect Claude Code', click: uninstallHooks }] : []),
    { type: 'separator' },
    { label: 'Quit Blaube', role: 'quit' },
  ]);
}

function sessionMenu(id) {
  const s = tracker.sessions.get(id);
  if (!s) return null;
  const word = { working: 'Working', waiting: 'Needs you', done: 'Done', idle: 'Idle' }[s.state] || s.state;
  const isDemo = id.startsWith('demo-');
  return Menu.buildFromTemplate([
    { label: s.project, enabled: false },
    { label: `${word}${s.message && s.state === 'waiting' ? ': ' + s.message : ''}`, enabled: false },
    { type: 'separator' },
    { label: 'Open session', enabled: !isDemo, click: () => { if (!focusSessionApp(s)) openResumeTerminal(s); } },
    { label: 'Resume in new terminal', enabled: !isDemo, click: () => openResumeTerminal(s) },
    { label: 'Copy resume command', click: () => clipboard.writeText(`cd "${s.cwd}" && ${resumeCommand(s.id)}`) },
    { label: 'Open project folder', enabled: !!s.cwd, click: () => shell.openPath(s.cwd) },
    { type: 'separator' },
    { label: 'Merge back in', click: () => { tracker.handle({ session_id: id, hook_event_name: 'SessionEnd' }); } },
  ]);
}

async function installHooks() {
  const file = claudeHooks.settingsPath();
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Connect', 'Cancel'],
    defaultId: 0,
    message: 'Connect Blaube to Claude Code?',
    detail: `Blaube adds a few hooks to ${file} so Claude Code tells it when a session starts, is working, needs you, or is done.\n\nThe hooks only talk to Blaube on this computer (127.0.0.1:${PORT}). No API calls, no tokens. A backup is saved next to the file.\n\nRestart any running Claude Code sessions to pick them up.`,
  });
  if (response !== 0) return;
  try {
    claudeHooks.install(file, PORT);
  } catch (e) {
    dialog.showErrorBox('Could not update Claude Code settings', `${file}\n\n${e.message}`);
  }
  refreshTray();
  pushState();
}

function uninstallHooks() {
  try {
    claudeHooks.uninstall();
  } catch (e) {
    dialog.showErrorBox('Could not update Claude Code settings', e.message);
  }
  refreshTray();
  pushState();
}

// Fakes a few sessions so you can see the split/merge without Claude running.
function runDemo() {
  const at = (ms, f) => setTimeout(f, ms);
  const ev = (id, cwd, hook_event_name, extra = {}) => tracker.handle({ session_id: id, cwd, hook_event_name, ...extra });
  const home = app.getPath('home');
  const a = 'demo-a', b = 'demo-b', c = 'demo-c';
  at(0, () => ev(a, path.join(home, 'code', 'blaube'), 'SessionStart'));
  at(900, () => ev(a, path.join(home, 'code', 'blaube'), 'UserPromptSubmit'));
  at(1800, () => ev(b, path.join(home, 'code', 'kalkis'), 'UserPromptSubmit'));
  at(2600, () => ev(c, path.join(home, 'code', 'website'), 'UserPromptSubmit'));
  at(6000, () => ev(b, '', 'Notification', { message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' }));
  at(9000, () => ev(a, '', 'Stop'));
  at(13000, () => ev(b, '', 'PostToolUse'));
  at(16000, () => ev(c, '', 'Stop'));
  at(20000, () => ev(b, '', 'Stop'));
  at(26000, () => ev(c, '', 'SessionEnd'));
  at(30000, () => ev(a, '', 'SessionEnd'));
  at(34000, () => ev(b, '', 'SessionEnd'));
}

function trayIcon() {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(path.join(ASSETS, file));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function refreshTray() {
  if (!tray) return;
  const busy = tracker.list().filter((s) => s.state === 'working').length;
  const waiting = tracker.list().filter((s) => s.state === 'waiting').length;
  tray.setToolTip(`Blaube: ${busy} working, ${waiting} need you`);
  if (process.platform === 'darwin') tray.setTitle(waiting ? ` ${waiting}!` : busy ? ` ${busy}` : '');
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  try {
    await startHookServer(tracker, PORT);
  } catch (e) {
    dialog.showErrorBox('Blaube', `Could not listen on 127.0.0.1:${PORT} (${e.code || e.message}). Is another Blaube running? Set BLAUBE_PORT to use a different port.`);
  }

  createWindow();

  tray = new Tray(trayIcon());
  tray.on('click', () => tray.popUpContextMenu(appMenu()));
  tray.on('right-click', () => tray.popUpContextMenu(appMenu()));
  refreshTray();

  tracker.on('change', () => { pushState(); refreshTray(); });
  setInterval(() => { if (tracker.prune()) { pushState(); refreshTray(); } }, 30 * 1000);

  ipcMain.on('ready', pushState);
  ipcMain.on('ignore-mouse', (_e, ignore) => {
    if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
  });
  ipcMain.on('acknowledge', (_e, id) => {
    if (id) { const s = tracker.sessions.get(id); if (s) s.seen = true; }
    else tracker.acknowledge();
    pushState();
  });
  ipcMain.on('open-session', (_e, id) => {
    const s = tracker.sessions.get(id);
    if (!s || id.startsWith('demo-')) return;
    if (!focusSessionApp(s)) openResumeTerminal(s);
  });
  ipcMain.on('app-menu', () => appMenu().popup({ window: win }));
  ipcMain.on('session-menu', (_e, id) => {
    const m = sessionMenu(id);
    if (m) m.popup({ window: win });
  });

  if (process.env.BLAUBE_DEMO) runDemo();
});

app.on('second-instance', () => send('come-here'));
app.on('window-all-closed', () => app.quit());
