const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, dialog, shell, clipboard, globalShortcut } = require('electron');
const { SessionTracker } = require('./sessions');
const { startHookServer, DEFAULT_PORT } = require('./hookServer');
const claudeHooks = require('./claudeHooks');
const { openResumeTerminal, resumeCommand, focusSessionApp } = require('./terminal');
const { startAgentsPoller } = require('./agents');
const dock = require('./dock');
const BlaubeConfig = require('../shared/config');

const PORT = Number(process.env.BLAUBE_PORT) || DEFAULT_PORT;
const ASSETS = path.join(__dirname, '..', '..', 'build');

const TUNING_SHORTCUT = 'CommandOrControl+Alt+Shift+B';

let win = null;
let tray = null;
let tuningWin = null;
let world = { obstacles: [] };
let dockWindows = [];
const tracker = new SessionTracker();

// --- Preferences (config + chosen display), kept in the app's data folder ---

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
let prefs = { config: {}, displayId: null, colors: {} };

function loadPrefs() {
  try { prefs = Object.assign(prefs, JSON.parse(fs.readFileSync(prefsFile(), 'utf8'))); } catch { /* first run */ }
  prefs.config = BlaubeConfig.sanitize(prefs.config);
  if (!prefs.colors || typeof prefs.colors !== 'object') prefs.colors = {};
}

// A colour picked for a session sticks to its project folder, so the same
// project gets the same colour every time.
const colorKey = (s) => s.cwd || s.id;

function colorMenu(current, pick) {
  return BlaubeConfig.PALETTE.map(([name, hex]) => ({
    label: name,
    type: 'radio',
    checked: current.toLowerCase() === hex.toLowerCase(),
    click: () => pick(hex),
  }));
}

let saveTimer = null;
function savePrefs() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
      fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2));
    } catch { /* not fatal */ }
  }, 300);
}

function setConfig(next) {
  prefs.config = BlaubeConfig.sanitize(next);
  savePrefs();
  if (win) win.webContents.send('config', prefs.config);
  updateWorld();
}

// --- Display and Dock --------------------------------------------------------

function currentDisplay() {
  const all = screen.getAllDisplays();
  return all.find((d) => d.id === prefs.displayId) || screen.getPrimaryDisplay();
}

function fitWindow() {
  if (!win) return;
  win.setBounds(dock.windowBoundsFor(currentDisplay()));
  updateWorld();
}

function updateWorld() {
  if (!win) return;
  const display = currentDisplay();
  const rect = dock.dockRect(display, dockWindows);
  const next = { obstacles: rect ? [dock.toWindowCoords(rect, dock.windowBoundsFor(display))] : [] };
  if (JSON.stringify(next) === JSON.stringify(world)) return;
  world = next;
  win.webContents.send('world', world);
}

function refreshDock() {
  dock.readDockWindows((list) => { dockWindows = list; updateWorld(); });
}

function moveToDisplay(id) {
  prefs.displayId = id;
  savePrefs();
  fitWindow();
  send('come-here');
}

function displayMenu() {
  const cur = currentDisplay();
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    label: `${d.label || `Display ${i + 1}`} (${d.size.width}×${d.size.height})${d.id === primary.id ? ', main' : ''}`,
    type: 'radio',
    checked: d.id === cur.id,
    click: () => moveToDisplay(d.id),
  }));
}

// --- Tuning panel ------------------------------------------------------------

function openTuning() {
  if (tuningWin) { tuningWin.show(); tuningWin.focus(); return; }
  tuningWin = new BrowserWindow({
    width: 400,
    height: 760,
    title: 'Blaube tuning',
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'tuningPreload.js'), contextIsolation: true, sandbox: true },
  });
  tuningWin.setMenuBarVisibility(false);
  tuningWin.loadFile(path.join(__dirname, '..', 'tuning', 'tuning.html'));
  tuningWin.on('closed', () => { tuningWin = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const { x, y, width, height } = dock.windowBoundsFor(currentDisplay());
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

  const refit = () => { fitWindow(); refreshDock(); };
  screen.on('display-metrics-changed', refit);
  screen.on('display-added', refit);
  screen.on('display-removed', refit);
  win.on('closed', () => { win = null; });
}

function pushState() {
  if (!win) return;
  win.webContents.send('state', {
    sessions: tracker.list().map((s) => Object.assign({}, s, { color: prefs.colors[colorKey(s)] || null })),
    settings: { hooksInstalled: claudeHooks.isInstalled(undefined, PORT) },
  });
}

function send(cmd) {
  if (win) win.webContents.send('command', cmd);
}

function appMenu() {
  return Menu.buildFromTemplate(appMenuTemplate());
}

function appMenuTemplate() {
  const installed = claudeHooks.isInstalled(undefined, PORT);
  return [
    { label: `Blaube ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    installed
      ? { label: 'Claude Code connected ✓', enabled: false }
      : { label: claudeHooks.hasAnyBlaubeHooks() ? 'Update Claude Code connection…' : 'Connect Claude Code…', click: installHooks },
    { label: 'Colour', submenu: colorMenu(prefs.config.color, (hex) => setConfig(Object.assign({}, prefs.config, { color: hex }))) },
    { label: 'Live on display', submenu: displayMenu() },
    { label: 'Come here', click: () => send('come-here') },
    { label: 'Everyone hop!', click: () => send('hop') },
    { label: 'Demo sessions', click: runDemo },
    { type: 'separator' },
    { label: 'Open at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    ...(installed ? [{ label: 'Reconnect Claude Code', click: installHooks }, { label: 'Disconnect Claude Code', click: uninstallHooks }] : []),
    { type: 'separator' },
    { label: 'Quit Blaube', role: 'quit' },
  ];
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
    { label: 'Colour', submenu: colorMenu(prefs.colors[colorKey(s)] || prefs.config.color, (hex) => { prefs.colors[colorKey(s)] = hex; savePrefs(); pushState(); }) },
    { label: 'Blaube', submenu: appMenuTemplate() },
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
  at(3400, () => ev(a, '', 'SubagentStart', { agent_id: 'demo-a1', agent_type: 'Explore' }));
  at(4200, () => ev(a, '', 'SubagentStart', { agent_id: 'demo-a2', agent_type: 'general-purpose' }));
  at(5000, () => ev(c, '', 'SubagentStart', { agent_id: 'demo-c1', agent_type: 'Plan' }));
  at(7000, () => ev(a, '', 'SubagentStop', { agent_id: 'demo-a1', agent_type: 'Explore' }));
  at(8200, () => ev(a, '', 'SubagentStop', { agent_id: 'demo-a2', agent_type: 'general-purpose' }));
  at(12000, () => ev(c, '', 'SubagentStop', { agent_id: 'demo-c1', agent_type: 'Plan' }));
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

  loadPrefs();

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

  ipcMain.on('ready', () => {
    win.webContents.send('config', prefs.config);
    win.webContents.send('world', world);
    pushState();
  });
  ipcMain.on('open-tuning', openTuning);
  ipcMain.on('demo', runDemo);
  ipcMain.handle('config-get', () => prefs.config);
  ipcMain.on('config-set', (_e, partial) => setConfig(Object.assign({}, prefs.config, partial)));
  ipcMain.handle('config-replace', (_e, full) => { setConfig(full); return prefs.config; });
  ipcMain.handle('config-copy', () => {
    // Only the values that differ from the defaults, so it's easy to read.
    const changed = {};
    for (const [k, v] of Object.entries(prefs.config)) if (v !== BlaubeConfig.DEFAULTS[k]) changed[k] = v;
    clipboard.writeText(JSON.stringify({ blaube: prefs.config, changed }, null, 2));
  });
  globalShortcut.register(TUNING_SHORTCUT, openTuning);

  refreshDock();
  setInterval(refreshDock, 10 * 1000);

  startAgentsPoller(
    (agents) => tracker.applyAgents(agents),
    () => prefs.config.pollClaudeAgents,
  );
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
app.on('will-quit', () => globalShortcut.unregisterAll());
