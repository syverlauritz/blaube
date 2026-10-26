const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, dialog, shell, clipboard, globalShortcut, systemPreferences } = require('electron');
const { SessionTracker } = require('./sessions');
const { Inbox, STYLE } = require('./inbox');
const { classify } = require('../shared/actions');
const { SONGS } = require('../shared/songs');
const { placeTalk } = require('./talkPlace');
const { startHookServer, DEFAULT_PORT } = require('./hookServer');
const claudeHooks = require('./claudeHooks');
const { openResumeTerminal, resumeCommand, focusSessionApp, typeIntoSession } = require('./terminal');
const { startAgentsPoller, listAgents, findClaude } = require('./agents');
const { Owned } = require('./owned');
const history = require('./history');
const attention = require('./attention');
const markdown = require('./markdown');
const git = require('./git');
const projectFiles = require('./files');
const shellRun = require('./shellRun');
const { failedTests, stoppedLast, erredLast } = require('./inbox');
const { Notification } = require('electron');
const { skills: skillList, skillPrompt, slashCommand, commandNames, expand: expandCommand, control: controlFor, contextNote, EFFORTS } = require('./commands');
const limits = require('./limits');
const usageProbe = require('./usageProbe');
const auth = require('./auth');
const renamer = require('./rename');
const branch = require('./branch');
const ccDefaults = require('./ccDefaults');
const cloner = require('./clone');
const pulls = require('./pr');
const runs = require('./runs');
const editor = require('./editor');
// Your code editor (editor.js), looked for at most once a minute.
let editorSeen = { at: 0, ed: null };
const editorNow = () => {
  if (TEST) return global.__blaubeEditor || null;
  if (Date.now() - editorSeen.at > 60e3) editorSeen = { at: Date.now(), ed: editor.find() };
  return editorSeen.ed;
};
// Opens a session's file (at a line) or its folder ('') in your editor.
function openInEditor(id, rel, line = 0) {
  const s = tracker.sessions.get(id);
  const ed = editorNow();
  if (!s || !s.cwd || !ed) return;
  const st = gitStates.get(id);
  const target = rel ? sessionFile(id, rel) : (st && st.root) || s.cwd;
  if (!target) return;
  editor.open(ed, target, Number(line) > 0 ? Math.min(Number(line), 1e7) : 0, (err) => { if (err) inbox.add(id, { who: 'note', text: `Couldn’t open it in ${ed.name}: ${err}`, error: true }); });
}
const installer = require('./installer');
const away = require('./away');
const taskOutput = require('./taskOutput');
const permRules = require('./permRules');
const taskKill = require('./taskKill');
const memory = require('./memory');
const { startFocusWatcher, transcriptPath } = require('./focus');
const usage = require('./usage');
const { runningTasks } = require('./tasks');
const dock = require('./dock');
const { watchWindows, ledges } = require('./windows');
const BlaubeConfig = require('../shared/config');

const PORT = Number(process.env.BLAUBE_PORT) || DEFAULT_PORT;

// Test mode (BLAUBE_TEST=<script>): the real app, but invisible (every
// window fully transparent), never catching the real mouse or taking focus,
// with no tray icon, its own data folder, and none of your real sessions.
// The script is run with the app's insides once it's up (scripts/e2e).
const TEST = process.env.BLAUBE_TEST || '';
if (TEST) { app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'blaube-test-'))); app.setPath('downloads', path.join(app.getPath('userData'), 'Downloads')); fs.mkdirSync(app.getPath('downloads')); }

// When Blaube is started from inside a Claude Code session (e.g. `npm start`
// run by Claude), it inherits that session's markers. A `claude --resume` it
// opens would then think it's a child session and stop saving transcripts.
for (const k of Object.keys(process.env)) {
  if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || /^CLAUDE_CODE_(CHILD_SESSION|SESSION_|MESSAGING_|ENTRYPOINT|EXECPATH)/.test(k)) delete process.env[k];
}
const ASSETS = path.join(__dirname, '..', '..', 'build');

const TUNING_SHORTCUT = 'CommandOrControl+Alt+Shift+B';
// The talk shortcut, as picked in Settings.
const TALK_KEYS = { 'Ctrl/⌘+Alt+B': 'CommandOrControl+Alt+B', 'Alt+Shift+B': 'Alt+Shift+B' };
let talkKey = ''; // (the one registered now)

let win = null;
let tray = null;
let tuningWin = null;
let world = { obstacles: [] };
let dockWindows = [];
const tracker = new SessionTracker();
const inbox = new Inbox();
const owned = new Owned(findClaude);
let focus = { front: () => [] };

// Sessions whose window you're looking at count as seen, so their slimes
// stop jumping. Returns true if that changed anything.
function markFrontSeen() {
  let changed = false;
  for (const s of focus.front(tracker.list())) {
    if (!s.seen) { s.seen = true; changed = true; }
  }
  return changed;
}

// --- Preferences (config + chosen display), kept in the app's data folder ---

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
let prefs = { config: {}, displayId: null, colors: {} };

function loadPrefs() {
  try { prefs = Object.assign(prefs, JSON.parse(fs.readFileSync(prefsFile(), 'utf8'))); } catch { /* first run */ }
  if (prefs.notify === false && prefs.config && !prefs.config.notify) prefs.config.notify = 'Off'; // (from before it was a setting)
  prefs.config = BlaubeConfig.sanitize(prefs.config);
  if (!prefs.colors || typeof prefs.colors !== 'object') prefs.colors = {};
}

// A colour picked for a session sticks to its project folder, so the same
// project gets the same colour every time.
const colorKey = (s) => s.cwd || s.id;

// Sessions without a picked colour: the first one is the main colour
// (orange), each one after that gets a random other colour from the
// palette, for as long as it runs.
const autoColors = new Map(); // session id -> hex, or null for the main colour
function colorOf(s) {
  const picked = prefs.colors[colorKey(s)];
  if (picked) return picked;
  for (const id of autoColors.keys()) if (!tracker.sessions.has(id)) autoColors.delete(id);
  if (!autoColors.has(s.id)) {
    const main = prefs.config.color.toLowerCase();
    const used = new Set(tracker.list().filter((o) => o.id !== s.id && autoColors.has(o.id))
      .map((o) => (prefs.colors[colorKey(o)] || autoColors.get(o.id) || main).toLowerCase()));
    if (!used.has(main)) autoColors.set(s.id, null);
    else {
      const others = BlaubeConfig.PALETTE.map(([, hex]) => hex).filter((hex) => hex.toLowerCase() !== main);
      const free = others.filter((hex) => !used.has(hex.toLowerCase()));
      const from = free.length ? free : others;
      autoColors.set(s.id, from[Math.floor(Math.random() * from.length)]);
    }
  }
  return autoColors.get(s.id);
}

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

// In front of every window (the default), or behind them like the desktop,
// when you need to see all of a window. The talk box always opens in front.
function applyOnTop() {
  if (!win) return;
  const front = prefs.config.onTop !== 'Off';
  win.setAlwaysOnTop(front, 'floating');
  if (!front) win.blur();
}

function applyTalkKey() {
  const want = TALK_KEYS[prefs.config.talkKey] || '';
  if (want === talkKey || !app.isReady()) return;
  if (talkKey) globalShortcut.unregister(talkKey);
  talkKey = '';
  if (!want) return;
  if (globalShortcut.register(want, talkShortcut)) talkKey = want;
  else log(`${want} is taken by another app: no talk shortcut`);
}

function setConfig(next) {
  prefs.config = BlaubeConfig.sanitize(next);
  savePrefs();
  applyOnTop();
  applyTalkKey();
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
  hideTalk();
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

let settingsWin = null;
function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 360,
    height: 330,
    title: 'Blaube settings',
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: { preload: path.join(__dirname, 'tuningPreload.js'), contextIsolation: true, sandbox: true },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, '..', 'settings', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

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

// --- Talk box: message a session from its slime (see inbox.js) ---------------

let talkWin = null, talkId = null, talkTail = null;
let talkSpot = null; // the top of the slime, in screen coordinates
let talkHiddenAt = 0, talkHiddenId = null, talkReady = null, talkBefore = 0;
let lastOtherApp = 0; // the app in front before you reached for a slime (macOS)
let frontLookup = Promise.resolve(); // that lookup, while it runs
const talkHeights = new Map(); // session id -> how tall its box wants to be (without the tail)
const TALK_W = 384, TALK_MIN_H = 190, TALK_MAX_H = 580;
const talkH = () => talkHeights.get(talkId) || 280;

// Puts the box where it belongs for its slime and its current height.
// The box doesn't hang off its slime rigidly: it drifts after it on a slow,
// soft spring (easy to read while the slime hops about), and the slime's
// layer draws the tail from the bubble to its head, so they stay joined.
let talkGoal = null, talkAt = null, talkVel = { x: 0, y: 0 }, talkGlide = null;
function placeTalkWin(jump = false) {
  if (!talkWin || !talkSpot) return;
  const place = placeTalk(talkSpot, screen.getDisplayNearestPoint(talkSpot).workArea, TALK_W, talkH(), talkTail && talkTail.side);
  const moved = !talkTail || place.tail.side !== talkTail.side || Math.abs(place.tail.at - talkTail.at) > 0.5;
  // Switching sides isn't a drift: it goes straight there.
  if (talkTail && place.tail.side !== talkTail.side) jump = true;
  // Short of room above its slime, its height follows the slime's position:
  // small moves don't re-size it (that read as stretching while you read).
  if (!jump && talkGoal && talkWin.isVisible() && place.tail.side === talkGoal.tail.side && place.h !== talkGoal.h && place.h < talkH() && Math.abs(place.h - talkGoal.h) < 40) {
    if (place.tail.side === 'bottom') place.y += place.h - talkGoal.h;
    place.h = talkGoal.h;
  }
  // Growing or shrinking keeps the edge its tail leaves from where it is
  // (a taller box grows up, away from the slime, never down over it).
  if (!jump && talkAt && talkGoal && place.h !== talkGoal.h) {
    if (place.tail.side === 'bottom') talkAt.y -= place.h - talkGoal.h;
    else talkAt.y -= (place.h - talkGoal.h) / 2;
  }
  talkTail = place.tail;
  talkGoal = place;
  if (jump || !talkAt || !talkWin.isVisible()) { talkAt = { x: place.x, y: place.y }; talkVel = { x: 0, y: 0 }; }
  applyTalkBounds();
  if (moved && talkId) talkWin.webContents.send('talk-tail', talkTail);
  if (!talkGlide) talkGlide = setInterval(glideTalk, 16);
}

function applyTalkBounds() {
  talkWin.setBounds({ x: Math.round(talkAt.x), y: Math.round(talkAt.y), width: TALK_W, height: talkGoal.h });
  sendTalkRect();
}

// Where the bubble is, for the slime's layer to draw the tail to.
function sendTalkRect() {
  if (!win || !talkAt || !talkGoal) return;
  const wb = win.getBounds();
  const visible = talkWin && talkWin.isVisible();
  win.webContents.send('talk-rect', visible ? { id: talkId, x: talkAt.x - wb.x, y: talkAt.y - wb.y, w: TALK_W, h: talkGoal.h, side: talkTail.side, vx: talkVel.x } : null);
}

// A soft spring (like the balloons' settle in face.js, softer): it follows
// with a little overshoot and rests within about a second. On a leash: it
// never trails more than 120 px behind.
function glideTalk() {
  if (!talkWin || !talkWin.isVisible() || !talkGoal) { clearInterval(talkGlide); talkGlide = null; return; }
  const dt = 0.016;
  let dx = talkGoal.x - talkAt.x, dy = talkGoal.y - talkAt.y;
  if (Math.hypot(dx, dy) < 0.75 && Math.hypot(talkVel.x, talkVel.y) < 5) {
    if (dx || dy) { talkAt = { x: talkGoal.x, y: talkGoal.y }; talkVel = { x: 0, y: 0 }; applyTalkBounds(); }
    clearInterval(talkGlide); talkGlide = null; // at rest: no timer ticking
    return;
  }
  talkVel.x += (40 * dx - 11 * talkVel.x) * dt;
  talkVel.y += (40 * dy - 11 * talkVel.y) * dt;
  talkAt = { x: talkAt.x + talkVel.x * dt, y: talkAt.y + talkVel.y * dt };
  dx = talkGoal.x - talkAt.x; dy = talkGoal.y - talkAt.y;
  const far = Math.hypot(dx, dy);
  if (far > 120) talkAt = { x: talkGoal.x - dx * 120 / far, y: talkGoal.y - dy * 120 / far };
  applyTalkBounds();
}

// Opens the talk box for a session, next to its slime (`at`: the top of the
// slime, in the overlay window's coordinates). Clicking the same slime
// again closes it.
function openTalk(id, at) {
  if (!tracker.sessions.get(id)) return;
  // Clicking its slime took focus and hid it: that click meant "close".
  if (talkHiddenId === id && Date.now() - talkHiddenAt < 350) { if (!TEST) activateApp(talkBefore); return; }
  makeTalkWin();
  if (talkWin.isVisible() && talkId === id) { hideTalk(); return; }
  if (talkWin.isVisible()) hideTalk(true); // another slime's: it switches over
  talkId = id;
  talkTail = null;
  openTalkFor(id, at);
  fetchFor(id, true);
}

// The talk box's window: made once, ahead of time (so the first click
// opens it as quickly as the rest), and kept.
function makeTalkWin() {
  if (talkWin) return;
  talkWin = new BrowserWindow({
    width: TALK_W,
    height: 300,
    backgroundThrottling: false,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'talkPreload.js'), contextIsolation: true, sandbox: true },
  });
  talkWin.loadFile(path.join(__dirname, '..', 'talk', 'talk.html'));
  // Links in replies open in your browser (talk-link), never in here.
  talkWin.webContents.on('will-navigate', (e) => e.preventDefault());
  talkWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (TEST) talkWin.setOpacity(0);
  // Tests print the talk box's own errors, so a broken handler can't hide.
  if (TEST) talkWin.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('[talk error]', e.message, e.sourceId ? `${path.basename(e.sourceId)}:${e.lineNumber}` : ''); });
  talkWin.on('blur', () => {
    if (!talkWin || !talkWin.isVisible() || talkWin.webContents.isDevToolsFocused() || talkPicking) return;
    hideTalk();
    talkHiddenAt = Date.now(); // a click on its slime right now means "close"
    talkHiddenId = talkId;
  });
  talkWin.on('closed', () => { talkWin = null; talkId = null; });
}

function openTalkFor(id, at) {
  const wb = win.getBounds();
  talkSpot = { x: wb.x + at.x, y: wb.y + at.y, r: at.r };
  // Fill it in while it's still hidden, and show it once it has measured
  // itself, so it never flashes the last slime's conversation or jumps.
  const show = () => {
    if (talkId !== id) return;
    placeTalkWin(true);
    if (TEST) talkWin.showInactive(); // never takes your focus
    else { talkWin.show(); talkWin.focus(); } // already filled in while hidden
    sendTalkRect();
    pushTalk(id, true);
    if (win) win.webContents.send('talking', id);
  };
  const render = () => {
    talkReady = show;
    pushTalk(id, false);
    setTimeout(() => { if (talkReady === show) { talkReady = null; show(); } }, 250); // in case it never answers
  };
  const start = () => (talkWin.webContents.isLoading() ? talkWin.webContents.once('did-finish-load', render) : render());
  // Typing needs Blaube in front; remember who was (from when the cursor
  // reached the slime: a quick click may beat that lookup, so wait a bit).
  if (process.platform === 'darwin' && !TEST) {
    Promise.race([frontLookup, new Promise((r) => setTimeout(r, 500))]).then(() => {
      if (talkId !== id) return;
      talkBefore = lastOtherApp;
      app.focus({ steal: true });
      start();
    });
  } else start();
}

// The app in front (macOS), and giving focus back to it. No permissions.
function frontmostApp(cb) {
  require('node:child_process').execFile('osascript', ['-l', 'JavaScript', '-e', "ObjC.import('AppKit'); $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier"], { timeout: 1500 }, (err, out) => cb(err ? 0 : Number(String(out).trim()) || 0));
}
function activateApp(pid) {
  if (!pid || pid === process.pid) return;
  require('node:child_process').execFile('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit'); var a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); if (a) a.activateWithOptions(0);`], { timeout: 1500 }, () => {});
}

// Hides the talk box. Closed on purpose (Esc, ✕, clicking its slime) it
// hands focus back to the app you were in; when you clicked away, you're
// already there.
function hideTalk(switching = false) {
  if (!talkWin || !talkWin.isVisible()) return;
  if (talkId) looked.set(talkId, Date.now()); // you've read it up to now
  const onPurpose = talkWin.isFocused();
  talkWin.hide();
  if (win) win.webContents.send('talk-rect', null);
  if (win && !switching) win.webContents.send('talking', null);
  if (onPurpose && !switching && process.platform === 'darwin' && !TEST) activateApp(talkBefore);
}

let hooksOk = null; // whether Claude Code is connected, checked when the box opens
let talkLast = null; // the session the box last showed, for when it ends
function pushTalk(id, focusField = false) {
  if (!talkWin || talkWin.isDestroyed() || id !== talkId) return;
  if (!talkWin.isVisible() && !talkReady) return; // it catches up when it opens
  if (hooksOk === null || talkReady) hooksOk = claudeHooks.isInstalled(undefined, PORT);
  const s = tracker.sessions.get(id);
  // It ended while you were talking to it: say so, keep what you'd typed.
  if (!s) {
    if (!talkLast || talkLast.id !== id) { hideTalk(); return; }
    talkWin.webContents.send('talk-state', Object.assign({}, talkLast, inbox.view(id), { ended: true, state: 'ended', ask: null, asks: 0, tail: talkTail, focus: false }));
    return;
  }
  talkLast = {
    id, project: s.project, cwd: s.cwd, color: colorOf(s) || prefs.config.color || '#D97757', font: prefs.config.font, demo: id.startsWith('demo-'), connected: true,
  };
  talkWin.webContents.send('talk-state', Object.assign({
    id,
    project: s.project,
    title: id.startsWith('demo-') ? '' : usage.sessionInfo(transcriptPath(s)).title, // (its name: Claude's title, or yours from /rename)
    state: s.state,
    color: colorOf(s) || prefs.config.color || '#D97757',
    font: prefs.config.font,
    tail: talkTail,
    asks: inbox.asks.has(id) ? inbox.asks.get(id).length : 0,
    // No inbox hook, but Blaube can type into its terminal for it.
    typeable: process.platform === 'darwin' && !!s.pid && (s.term === 'Apple_Terminal' || s.term === 'iTerm.app'),
    demo: id.startsWith('demo-'),
    // Connected if the settings say so, or if this session's hooks already
    // reached us (it was started with them, whatever the file says now).
    connected: hooksOk || inbox.reachable.has(id) || inbox.steerable.has(id) || inbox.asks.has(id) || inbox.owned.has(id),
    doing: s.state === 'working' ? doing.get(id) || '' : '',
    mode: s.mode || '', // (its permission mode)
    model: modelName(pickedModel.get(id) || (id.startsWith('demo-') ? '' : usage.sessionInfo(transcriptPath(s)).model)),
    canBring: canBringIn(s), // (it could carry on in Blaube instead)
    offerBring: canBringIn(s) && ((inbox.log(id).slice(-1)[0] || {}).bring === true), // (a command it couldn't take: it could, here)
    context: contextOf(id), // (how full its context is, %)
    limit: limits.warn(usageLimits), // (your usage limits, once they're close)
    canBackground: !!foreground.get(id) && Date.now() - foreground.get(id).at >= 3000,
    mcp: (mcpStates.get(id) || []).filter((m) => m.status === 'failed' || m.status === 'needs-auth'), // (MCP servers that aren't there)
    usage: limits.line(usageLimits),
    signedOut: signedOutNow, signingIn: signingInNow(), // (Claude Code isn't signed in: see auth.js)
    canMode: owned.has(id), // (one Blaube started can be asked to change it)
    tasks: (s.tasks || []).filter((t) => !t.demo).slice(0, 4).map((t) => ({ id: t.id, label: t.description || t.command, command: t.command, url: taskUrls.get(`${id}/${t.id}`) || '' })).concat(runs.list(id)), // (and its scripts Blaube runs: runs.js)
    helpers: s.state === 'working' || s.state === 'waiting' ? (s.agents || []).slice(0, 5).map((a) => ({ name: helperName(s, a), doing: helperDoing.get(`${id}/${a.id}`) || '', waiting: a.state === 'waiting' })) : [],
    focus: focusField,
    // Its git status and what you might ask for next (see git.js).
    git: gitLine(id),
    turnStart: s.state === 'working' ? s.turnStart || 0 : 0, // (how long it's been at it, beside what it's doing)
    gitFiles: gitFiles(id),
    putBack: discarded.has(id) ? discarded.get(id).rel : '', // (the file whose changes you just discarded, to put back)
    editor: id.startsWith('demo-') || !editorNow() ? '' : editorNow().name, // (your code editor, to open its files in)
    scripts: s.cwd && !id.startsWith('demo-') ? runs.scripts(s.cwd).slice(0, 6).map((x) => x.name) : [], // (its package.json's, for Run)
    pr: prStates.get(id) ? { number: prStates.get(id).number, url: prStates.get(id).url, title: prStates.get(id).title } : null,
    earlier: !id.startsWith('demo-') && !!transcriptPath(s) && fs.existsSync(transcriptPath(s)), // (its transcript has what came before)
    lookedAt: looked.get(id) || 0, // (when its box was last closed: what's new since shows)
    quick: quickFor(id, s),
    // Every slime, to switch between them from the box.
    today: attention.today([...inbox.logs.values()]),
    others: tracker.list().filter(isReady).map((o) => Object.assign({ id: o.id, project: o.project, color: colorOf(o) || prefs.config.color || '#D97757', state: o.state, ask: askOf(o.id), urls: (o.tasks || []).map((t) => ({ label: t.description || t.command, url: taskUrls.get(`${o.id}/${t.id}`) || '' })).concat(runs.list(o.id)).filter((t) => t.url).slice(0, 2).map((t) => ({ label: t.label, url: t.url })) }, glanceAt(o))),
  }, inbox.view(id), owned.has(id) ? { stoppable: true } : {})); // (one Blaube started can always be stopped)
  if (s.cwd && !id.startsWith('demo-')) {
    git.status(s.cwd, (st) => {
      const before = JSON.stringify(gitStates.get(id) || null);
      gitStates.set(id, st);
      if (JSON.stringify(st) !== before) pushTalk(id);
    });
  }
}
let usageLimits = null; // (see limits.js)
let signedOutNow = false, signingInNow = () => false; // (Claude Code signed out; signing in now)
const mcpStates = new Map(); // id -> its MCP servers, for a session Blaube started
const rewound = new Map(); // id -> what Claude should hear with your next message (files you put back, notes you added)
const tellNext = (id, what) => rewound.set(id, [rewound.get(id), what].filter(Boolean).join(' '));
const endedTasks = new Set(); // `${session}/${task}` whose ending was seen (or caused)
const taskUrls = new Map(); // `${session}/${task}` -> the local address it said it's on
const foreground = new Map(); // id -> { tool, at, what }: a command it's waiting on, in a session Blaube started
// Sessions that hit a usage limit and carry on by themselves once it lifts.
const carryLater = new Map(); // id -> when
function carryFor(id, now = Date.now()) {
  if (carryLater.has(id)) return { at: carryLater.get(id), label: limits.when(carryLater.get(id), now), set: true };
  const at = limits.liftsAt(usageLimits, erredLast(inbox.log(id)), now);
  return at > now ? { at, label: limits.when(at, now) } : null;
}
let talkPicking = false; // (a file dialog from the box is open: it stays)
let hubPast = [], hubFolders = [], hubCache = null; // what the overview last offered
const gitStates = new Map(); // session id -> its last git status (or null: not a repository)
const installingPackages = new Set(); // sessions whose packages are being installed from the box
const reminded = new Map(); // session id -> { since, told }: reminders it's had while waiting on you
const nudged = new Map(); // session id -> the uncommitted changes its slime last mentioned
const discarded = new Map(); // session id -> { root, rel }: the file whose changes you last discarded in its box
const prStates = new Map(); // session id -> its branch's pull request, as gh last said (or null)
// What's new upstream (git.fetchQuietly): when its box opens, and now and
// then by itself (https remotes only); when that leaves its branch behind,
// its slime says so, and Pull is among its quick actions.
function fetchFor(id, asked) {
  const s = tracker.sessions.get(id), st = gitStates.get(id);
  if (!s || !s.cwd || id.startsWith('demo-') || !st || !st.upstream || s.state === 'working') return;
  git.fetchQuietly(st.root || s.cwd, (did) => {
    if (!did) return;
    git.status(s.cwd, (now) => {
      if (!now) return;
      const line = gitLine(id);
      gitStates.set(id, now);
      if (gitLine(id) !== line) pushState();
      if (id === talkId) pushTalk(id);
      if (asked || !(now.behind > st.behind) || now.branch !== st.branch || !win || (talkWin && talkWin.isVisible() && talkId === id)) return;
      const text = `${now.behind} new commit${now.behind === 1 ? '' : 's'} on ${now.branch} to pull`;
      win.webContents.send('say', { id, text, seconds: 5, status: true });
      if (TEST) global.__blaubeFetchNews = { id, text };
    });
  }, TEST ? { asked, every: 500, byItself: global.__blaubeFetchAll ? /./ : undefined } : { asked });
}
// Its git line: the branch and what's changed, and how its pull request stands.
const gitLine = (id) => [gitStates.has(id) ? git.summary(gitStates.get(id)) : '', pulls.words(prStates.get(id))].filter(Boolean).join(' · ');

// A session at a glance, for the overview in the talk box.
const looked = new Map(); // session id -> when you last had its talk box open
const glances = new Map(); // session id -> { at, state, g } (worked out at most once a second)
function glanceAt(o) {
  const hit = glances.get(o.id);
  const n = inbox.log(o.id).length; // (something new in its log: read afresh)
  if (hit && hit.state === o.state && hit.n === n && Date.now() - hit.at < 1000) return hit.g;
  // (With its title, "Add the 2027 brackets", to tell two in one project apart.)
  const g = Object.assign(glanceNow(o), { title: o.id.startsWith('demo-') ? '' : usage.sessionInfo(transcriptPath(o)).title });
  glances.set(o.id, { at: Date.now(), state: o.state, n, g });
  return g;
}
function glanceNow(o) {
  const tk = tokens.get(o.id);
  const todo = inbox.todos.get(o.id) || [];
  const last = [...inbox.log(o.id)].reverse().find((e) => e.who === 'claude');
  if (o.cwd && !o.id.startsWith('demo-') && o.id !== talkId) git.status(o.cwd, (st) => { const was = JSON.stringify(gitStates.get(o.id) || null); gitStates.set(o.id, st); if (JSON.stringify(st) !== was) pushTalk(talkId); });
  return attention.glance({
    state: o.state, doing: doing.get(o.id) || '', message: o.message,
    lastReply: last ? last.text : (o.id.startsWith('demo-') ? '' : usage.lastText(transcriptPath(o))),
    todo: todo.length ? { done: todo.filter((t) => t.status === 'completed').length, of: todo.length } : null,
    context: tk && tk.limit && tk.context ? Math.min(100, Math.round((tk.context / tk.limit) * 100)) : 0,
    git: gitLine(o.id),
    tests: lastTests(o.id), // (how its last test run went)
    turnStart: o.turnStart,
    waitingSince: o.state === 'waiting' ? o.updatedAt : 0,
    // Replies since its talk box was last open (never opened: since Blaube started).
    unread: o.id === talkId ? 0 : inbox.log(o.id).filter((e) => e.who === 'claude' && e.at > (looked.get(o.id) || 0)).length,
  });
}

// What a session asks permission for, to answer from the overview: its
// first tool request ({ key, tool, detail }), or null.
function askOf(id) {
  const a = (inbox.asks.get(id) || []).find((x) => x.kind === 'tool');
  return a ? { key: a.key, tool: a.tool, detail: a.detail } : null;
}

// How full a session's context window is (%), 0 when unknown.
function contextOf(id) {
  const tk = tokens.get(id);
  return tk && tk.limit && tk.context ? Math.round((tk.context / tk.limit) * 100) : 0;
}

// "claude-opus-5-5" -> "Opus 5.5" (what to call a model in the box).
function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(String(id || ''));
  if (!m) return '';
  return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] && m[3].length < 3 ? '.' + m[3] : '');
}
// A model you just switched a session to (until its transcript says so).
const pickedModel = new Map();
// What you ran with ! in a session's box, not yet sent along: id -> [{ cmd, code, out }].
const shellRan = new Map();

// A file a session's reply names (relative to its folder, or to the top of
// its repository), as a full path: only a file inside one of those, else ''.
function sessionFile(id, rel) {
  const s = tracker.sessions.get(id);
  if (!s || !s.cwd || typeof rel !== 'string' || !rel || rel.length > 500 || rel.includes('\0')) return '';
  const st = gitStates.get(id);
  const bases = [s.cwd, st && st.root].filter(Boolean);
  const want = rel.startsWith('~/') ? path.join(app.getPath('home'), rel.slice(2)) : rel;
  const real = (p) => { try { return fs.realpathSync(p); } catch { return ''; } };
  const roots = bases.map(real).filter(Boolean);
  const inside = (p) => roots.some((b) => { const r = path.relative(b, p); return r && !r.startsWith('..') && !path.isAbsolute(r); });
  for (const base of bases) {
    const abs = path.resolve(base, want);
    const r = real(abs); // (a link out of the folder doesn't count)
    try { if (r && inside(r) && fs.statSync(r).isFile()) return abs; } catch { /* not here */ }
  }
  return '';
}

// The files git says a session's folder has changed, as full paths.
// What git last failed at from Push or Pull, if the last of those failed
// (since Claude last replied: after that, git gets another go).
function gitFailed(log) {
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].who === 'claude') return '';
    if (log[i].gitRun && !log[i].running) return log[i].ok ? '' : log[i].gitRun;
  }
  return '';
}
// How its last test run went ({ pass, fail } or null), and in words.
const lastTests = (id) => ([...inbox.log(id)].reverse().find((e) => e.who === 'step' && e.tests) || {}).tests || null;
function testsWords(id) {
  const t = lastTests(id);
  return !t ? '' : t.fail ? `${t.fail} test${t.fail === 1 ? '' : 's'} failing` : t.pass ? 'tests pass' : '';
}
// What you might want next from its box (or the menu bar): see git.js.
function quickFor(id, s) {
  return id.startsWith('demo-') ? [] : git.quickActions(gitStates.get(id) || null, s.state, {
    stopped: stoppedLast(inbox.log(id)),
    apiError: erredLast(inbox.log(id)),
    carryAt: carryFor(id),
    failedTests: failedTests(inbox.log(id)),
    gitFailed: gitFailed(inbox.log(id)),
    runFailed: require('./inbox').runFailed(inbox.log(id)),
    install: s.cwd && !installingPackages.has(id) ? runs.needsInstall(s.cwd) : '',
    env: s.cwd ? runs.needsEnv(s.cwd) : '',
    pr: prStates.get(id) || null,
    context: contextOf(id),
  });
}
function gitFiles(id) {
  const st = gitStates.get(id);
  return st && st.root ? st.files.map((f) => ({ path: path.join(st.root, f.path), name: f.path, how: f.how })) : [];
}

// Sessions that are gone for good (not just ended: forgotten by the
// tracker) leave nothing behind, however many come and go. Returns where
// anything was still kept (for the load check, scripts/e2e/many.js).
let sweepTimer = null;
function sweepSoon() { if (!sweepTimer) sweepTimer = setTimeout(() => { sweepTimer = null; sweep(); }, 2000); }
function sweep() {
  const live = (id) => tracker.sessions.has(id) || owned.has(id) || (id === talkId && !!talkWin && !talkWin.isDestroyed() && talkWin.isVisible());
  for (const id of [...inbox.logs.keys(), ...inbox.todos.keys(), ...inbox.steerable, ...inbox.typed.keys()]) if (!live(id)) inbox.forget(id);
  const maps = { gitStates, prStates, discarded, nudged, reminded, looked, glances, talkHeights, notified, doing, errorCounts, apiErrorCounts, pickedModel, shellRan, carryLater, mcpStates, rewound, foreground };
  for (const id of [...muted]) if (!live(id)) muted.delete(id);
  for (const sid of runs.sessions()) if (!live(sid)) runs.stopAll(sid); // (its dev server goes with it)
  for (const m of Object.values(maps)) for (const id of [...m.keys()]) if (!live(id)) m.delete(id);
  for (const [k, at] of [...lastBubble]) if (Date.now() - at > 60e3) lastBubble.delete(k);
  for (const [id, c] of [...handedOver]) if (Date.now() - c.at > 30 * 60e3) handedOver.delete(id); // (kept past its end: bringing it here ends it first)
  while (agentDescriptions.size > 200) agentDescriptions.delete(agentDescriptions.keys().next().value);
  return Object.entries(maps).filter(([, m]) => [...m.keys()].some((id) => !live(id))).map(([name]) => name)
    .concat([...inbox.logs.keys()].some((id) => !live(id)) ? ['inbox'] : []);
}
if (TEST) global.__blaubeSweep = sweep;

// --- Sessions Blaube starts itself (owned.js) ----------------------------------

// Starts Claude Code in `cwd`, with no terminal: its slime pops out with
// its talk box open, ready for your first message.
function startSession(cwd, extra = [], resume = '', fork = '') {
  if (!cwd) return null;
  // (Its own worktree needs a git repository to make one in.)
  let noTree = false;
  if (extra.includes('--worktree')) {
    try { require('node:child_process').execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: 3000, stdio: 'ignore', windowsHide: true }); } catch { noTree = true; extra = extra.filter((a) => a !== '--worktree'); }
  }
  // Not connected yet: give this session Blaube's hooks itself, so its
  // slime still knows what it's doing and can still ask you things.
  let settings = null;
  if (!claudeHooks.isInstalled(undefined, PORT)) {
    settings = claudeHooks.withBlaube({}, PORT);
    settings.hooks.Stop = settings.hooks.Stop.filter((g) => !g.hooks.some((h) => h.asyncRewake));
  }
  const id = owned.start(cwd, ['--append-system-prompt', STYLE, ...extra], settings, resume, fork);
  prefs.recentFolders = [cwd, ...(prefs.recentFolders || []).filter((f) => f !== cwd)].slice(0, 5);
  savePrefs();
  log(`started a session in ${cwd}: ${id}`);
  if (noTree) inbox.add(id, { who: 'note', text: `${path.basename(cwd)} isn’t a git repository, so it works right in the folder, not in a worktree of its own` });
  // Open its talk box once its slime is out.
  let tries = 0;
  const open = setInterval(() => {
    if (++tries > 40 || !owned.has(id)) return clearInterval(open);
    if (!isReady(tracker.sessions.get(id) || {})) return;
    clearInterval(open);
    setTimeout(() => { if (win) win.webContents.send('open-talk', id); }, 900); // after it lands
  }, 150);
  return id;
}

// Picks up a past session in Blaube, no terminal: its slime pops out with
// how the conversation ended, ready for what's next.
async function pickUp(p) {
  if (tracker.sessions.has(p.id)) { if (win) win.webContents.send('open-talk', p.id); return; }
  // Written to a moment ago: it may still be open in a terminal Blaube
  // can't see, and two copies of one session would trip over each other.
  if (Date.now() - p.at < 2 * 60 * 1000) {
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: ['Pick it up', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `“${p.title}” was busy ${history.ago(p.at)}.`,
      detail: 'If it’s still open in a terminal, close it there first.',
    });
    if (response !== 0) return;
  }
  try { if (!fs.statSync(p.cwd).isDirectory()) throw new Error(); } catch {
    dialog.showMessageBox({ type: 'warning', message: `Can’t find its folder any more.`, detail: p.cwd });
    return;
  }
  const id = startSession(p.cwd, [], p.id);
  if (!id) return null;
  // (Ended while you watched: the conversation is still here.)
  // (Its box may have notes already, from before it was brought here.)
  if (p.file && !inbox.log(id).some((e) => e.who === 'you' || e.who === 'claude')) {
    const had = inbox.log(id).slice();
    inbox.logs.set(id, []);
    for (const m of history.recentMessages(p.file, 4)) inbox.add(id, m);
    inbox.logs.set(id, [...inbox.log(id), ...had]);
  }
  inbox.add(id, { who: 'note', text: p.note || (p.at ? `Picked up from ${history.ago(p.at)}` : 'Picked up here') });
  return id;
}

// "Bring it into Blaube": a session in a terminal ends there and carries on
// here, its conversation kept (for one that can't hear you, or when you'd
// rather not go back to the terminal). Only between turns.
function canBringIn(s) {
  return !!s && !owned.has(s.id) && !s.id.startsWith('demo-') && !!s.pid && !!s.cwd && (s.state === 'done' || s.state === 'idle');
}
async function bringIn(s) {
  if (!canBringIn(s)) return;
  if (!TEST) {
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: ['Bring it here', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Bring ${s.project} into Blaube?`,
      detail: 'Claude Code closes in its terminal, and the session carries on here with its whole conversation. You can move it back to a terminal any time.',
    });
    if (response !== 0) return;
  }
  const p = { id: s.id, cwd: s.cwd, at: 0, title: s.project, file: transcriptPath(s), note: 'Brought here from its terminal' };
  const alive = () => { try { process.kill(s.pid, 0); return true; } catch { return false; } };
  try { process.kill(s.pid, 'SIGTERM'); } catch (e) { log(`couldn't close ${s.project} in its terminal: ${e.message}`); return; }
  // Gone (a moment), then picked up here.
  let tries = 0;
  const wait = setInterval(() => {
    if (alive() && ++tries < 50) return;
    clearInterval(wait);
    if (alive()) { inbox.add(p.id, { who: 'note', text: 'It didn’t close in its terminal, so it stays there.' }); return; }
    if (tracker.sessions.has(p.id)) tracker.handle({ session_id: p.id, hook_event_name: 'SessionEnd' }, 'blaube');
    // (The command it couldn't take there goes in now, as you typed it.)
    const cmd = handedOver.get(p.id);
    handedOver.delete(p.id);
    pickUp(p).then((id) => { if (id && cmd && Date.now() - cmd.at < 30 * 60e3 && replyTo) replyTo(id, cmd.text); });
  }, 100);
}

// Past sessions you could pick up (not the ones running now).
function pastSessionsMenu() {
  let past = [];
  try { past = history.pastSessions(new Set(tracker.sessions.keys()), 8); } catch { /* none */ }
  if (!past.length) return [];
  return [{ label: 'Pick up a past session', submenu: past.map((p) => ({ label: p.title, sublabel: `${path.basename(p.cwd)} · ${history.ago(p.at)}`, click: () => pickUp(p) })) }];
}

async function newSession(extra = []) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'New session',
    message: 'Pick the folder Claude should work in',
    buttonLabel: 'Start here',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: (prefs.recentFolders || [])[0],
  });
  if (!canceled && filePaths[0]) startSession(filePaths[0], Array.isArray(extra) ? extra : []);
}

function newSessionMenu() {
  const recent = (prefs.recentFolders || []).filter((f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } });
  return [
    { label: 'New session…', click: newSession },
    ...(recent.length ? [{ label: 'New session in', submenu: recent.map((f) => ({ label: path.basename(f), sublabel: f, click: () => startSession(f) })) }] : []),
    ...pastSessionsMenu(),
  ];
}

// Ends a session Blaube started; in the middle of something, asks first.
async function endOwned(s, what = 'End it') {
  const cur = tracker.sessions.get(s.id);
  if (cur && (cur.state === 'working' || cur.state === 'waiting')) {
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: [`${what} now`, 'Cancel'], defaultId: 1, cancelId: 1,
      message: `${s.project} is in the middle of something.`,
      detail: 'Stopping now cuts off what it’s doing. The conversation so far is kept.',
    });
    if (response !== 0) return false;
  }
  owned.end(s.id);
  return true;
}

// "Continue in terminal": stops Blaube's copy, then resumes it there.
async function continueInTerminal(s) {
  if (!owned.has(s.id)) return openResumeTerminal(s);
  const id = s.id, snapshot = Object.assign({}, s);
  const resume = (gone) => { if (gone !== id) return; owned.removeListener('exit', resume); openResumeTerminal(snapshot); };
  owned.on('exit', resume);
  if (!(await endOwned(s, 'Move it'))) owned.removeListener('exit', resume);
}

// A session that has never asked for messages (it started before Blaube's
// inbox hook was installed) can't be handed them. When it's sitting at its
// prompt, type them into its terminal instead, like you would.
const typing = new Set();
function typeQueued(id) {
  const s = tracker.sessions.get(id), v = inbox.view(id);
  if (!s || typing.has(id) || TEST || owned.has(id) || !v.queued || v.inbox !== 'unknown') return;
  if (s.state !== 'done' && s.state !== 'idle') return;
  typing.add(id);
  const text = inbox.takeForTyping(id);
  typeIntoSession(s, text, (ok, why) => {
    typing.delete(id);
    log(`typed a message into ${s.project}'s terminal: ${ok ? 'ok' : 'no (' + why + ')'}`);
    if (ok) tracker.handle({ session_id: id, hook_event_name: 'UserPromptSubmit' }, 'blaube');
    else inbox.untake(id, text);
  });
}

// A reply's first sentence or so, for the slime's speech bubble.
function snippet(text) {
  const line = String(text).replace(/[`*_#>]+/g, '').split(/\n+/).map((l) => l.trim()).find(Boolean) || '';
  const sentence = (line.match(/^.{20,}?[.!?](\s|$)/) || [line])[0].trim();
  return sentence.length > 70 ? sentence.slice(0, 68).trimEnd() + '…' : sentence;
}

if (!TEST && !app.requestSingleInstanceLock()) app.quit();

// While developing (not in the packaged app): any code change restarts the
// app. A file with a syntax error is skipped, so a half-saved edit can't
// kill it.
function watchForChanges() {
  const vm = require('node:vm');
  const root = path.join(__dirname, '..');
  let pending = new Set(), timer = null;
  const compiles = (file) => {
    if (!file.endsWith('.js')) return true;
    try { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }); return true; } catch (e) { console.log('[dev] not reloading,', e.message); return false; }
  };
  const apply = () => {
    const files = [...pending].map((f) => path.join(root, f));
    pending = new Set();
    if (!files.every(compiles)) return;
    // Always a full restart: reloading just the window left its clicks
    // falling through to whatever was underneath.
    app.relaunch();
    app.exit(0);
  };
  try {
    fs.watch(root, { recursive: true }, (_e, file) => {
      if (!file || !/\.(js|html|css)$/.test(file)) return;
      pending.add(file);
      clearTimeout(timer);
      timer = setTimeout(apply, 400);
    });
  } catch (e) { console.log('[dev] no live reload:', e.message); }
}

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
  applyOnTop();
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  if (TEST) { win.setOpacity(0); win.webContents.setAudioMuted(true); } // tests are neither seen nor heard
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), TEST ? { query: { debug: '1' } } : undefined);

  // The screen changed shape (the Dock, a resolution): the box stays where it
  // is on screen; only the tail, drawn in this window, needs the new offset.
  const refit = () => { fitWindow(); refreshDock(); sendTalkRect(); };
  screen.on('display-metrics-changed', refit);
  screen.on('display-added', refit);
  screen.on('display-removed', () => { hideTalk(); refit(); }); // it may have been on that screen
  win.on('closed', () => { win = null; });
}

// A session's slime only appears once we know what it really looks like:
// its transcript read (effort, tokens, title) and the background tasks it
// left behind checked against what's actually running. Otherwise it would
// pop in wearing the wrong things and change a moment later.
const readySessions = new Set(), checkedTasks = new Set(), checkingTasks = new Set();
const isReady = (s) => readySessions.has(s.id);

function checkSeededTasks(s) {
  if (checkedTasks.has(s.id) || checkingTasks.has(s.id)) return;
  const live = s.tasks.filter((t) => !t.demo);
  if (!live.length) { checkedTasks.add(s.id); return; }
  checkingTasks.add(s.id);
  runningTasks(live.map((t) => Object.assign({ pid: s.pid }, t)), (alive) => {
    checkingTasks.delete(s.id);
    const cur = tracker.sessions.get(s.id);
    if (cur && alive) cur.tasks = cur.tasks.filter((t) => t.demo || alive.has(t.id));
    checkedTasks.add(s.id);
    refreshUsage();
  });
}

function pushState() {
  if (!win) return;
  const all = tracker.list();
  const send = (state) => { if (TEST) global.__blaubeState = state; win.webContents.send('state', state); };
  send({
    pending: all.filter((s) => !isReady(s)).length,
    sessions: all.filter(isReady).map((s) => Object.assign({}, s, {
      color: colorOf(s),
      tokens: tokens.get(s.id) || null,
      info: Object.assign(usage.sessionInfo(transcriptPath(s)), gitStates.get(s.id) ? { branch: [gitLine(s.id), testsWords(s.id)].filter(Boolean).join(' · ') } : {}), // (its git line on hover: branch, changes, its PR, its tests)
      todo: (() => { const t = inbox.todos.get(s.id) || []; const done = t.filter((x) => x.status === 'completed').length; return t.length && done < t.length ? { done, of: t.length } : null; })(),
      effort: efforts.get(s.id) || defaultEffort(),
      agents: s.agents.map((a) => Object.assign({}, a, {
        description: agentDescription(s, a),
        effort: efforts.get(`${s.id}/${a.id}`) || efforts.get(s.id) || defaultEffort(),
        // Its own tokens, so its slime grows with them too.
        tokens: demoTokens.has(s.id) ? Math.round(demoTokens.get(s.id).total / 8) : usage.helperTokens(transcriptPath(s), a.id),
      })),
    })),
    settings: { hooksInstalled: claudeHooks.isInstalled(undefined, PORT), talked: !!prefs.talked, noClaude: !claudeFound() },
  });
}

// Token usage per session id: { total, context, limit }. Re-read from the
// transcripts every few seconds; demo sessions get made-up numbers.
const tokens = new Map();
// Failed tool calls seen per session, to notice new ones.
const errorCounts = new Map();
const apiErrorCounts = new Map(); // (and API errors, to say new ones)
const demoTokens = new Map();
// Effort level per session id (and `${id}/${agentId}` for helpers), from
// the newest call in their transcripts.
const efforts = new Map();
const demoEfforts = new Map();
function refreshUsage() {
  let changed = false;
  const files = new Set();
  const live = new Set();
  const setEffort = (key, e) => {
    live.add(key);
    if (e && efforts.get(key) !== e) { efforts.set(key, e); changed = true; }
  };
  for (const s of tracker.list()) {
    const file = transcriptPath(s);
    if (file) files.add(file);
    for (const a of s.agents) {
      if (helperFinished(s, a)) { tracker.handle({ session_id: s.id, hook_event_name: 'SubagentStop', agent_id: a.id }); changed = true; }
    }
    // Not shown yet: finish reading it first, then check its old tasks.
    const caughtUp = readySessions.has(s.id) || s.id.startsWith('demo-') || usage.catchUp(file);
    setEffort(s.id, demoEfforts.get(s.id) || usage.sessionEffort(file));
    for (const a of s.agents) setEffort(`${s.id}/${a.id}`, demoEfforts.get(s.id) || usage.sessionEffort(file, a.id));
    const u = demoTokens.get(s.id) || usage.sessionUsage(file);
    // A tool just failed: the slime winces (and says so if it keeps failing).
    const errs = file ? usage.sessionErrors(file) : 0;
    if (readySessions.has(s.id) && errorCounts.has(s.id) && errs > errorCounts.get(s.id) && win) {
      win.webContents.send('react', { id: s.id, kind: 'oops', count: errs - errorCounts.get(s.id) });
    }
    errorCounts.set(s.id, errs);
    // Claude Code couldn't get an answer (overloaded, a usage limit): said in its box.
    const api = file ? usage.sessionApiErrors(file) : { count: 0 };
    if (readySessions.has(s.id) && apiErrorCounts.has(s.id) && api.count > apiErrorCounts.get(s.id)) {
      const last = inbox.log(s.id).slice(-1)[0];
      if (!(last && ((last.who === 'claude' && last.text.trim() === api.text) || last.text === `Claude Code: ${api.text}`))) inbox.add(s.id, { who: 'note', text: `Claude Code: ${api.text}`, error: true });
      // (And its slime says so, for when its box is closed.)
      if (win) win.webContents.send('say', { id: s.id, text: shorten(api.text, 80), seconds: 6, status: true, aloud: true });
      notify(s, 'error', api.text);
    }
    apiErrorCounts.set(s.id, api.count);
    if (caughtUp && !s.tasksSeeded && file && tracker.seedTasks(s.id, usage.sessionTasks(file))) changed = true;
    if (caughtUp && !readySessions.has(s.id)) {
      if (s.id.startsWith('demo-')) checkedTasks.add(s.id);
      else checkSeededTasks(s);
      if (checkedTasks.has(s.id)) { readySessions.add(s.id); changed = true; }
    }
    const old = tokens.get(s.id);
    if (u && (!old || old.total !== u.total || old.context !== u.context || old.limit !== u.limit)) {
      tokens.set(s.id, u);
      changed = true;
    }
  }
  for (const id of tokens.keys()) if (!tracker.sessions.has(id)) tokens.delete(id);
  for (const k of efforts.keys()) if (!live.has(k)) efforts.delete(k);
  for (const set of [readySessions, checkedTasks]) for (const id of set) if (!tracker.sessions.has(id)) set.delete(id);
  usage.forget(files);
  if (changed) pushState();
}

// The effort level set in ~/.claude/settings.json, for sessions whose
// transcript doesn't say yet. Re-read at most every 10 seconds.
let settingsEffort = { at: 0, effort: '' };
function defaultEffort() {
  if (Date.now() - settingsEffort.at < 10000) return settingsEffort.effort;
  let effort = '';
  try { effort = String(JSON.parse(fs.readFileSync(path.join(app.getPath('home'), '.claude', 'settings.json'), 'utf8')).effortLevel || '').toLowerCase(); } catch { /* none */ }
  settingsEffort = { at: Date.now(), effort };
  return effort;
}

// --- Status bubbles ---------------------------------------------------------
// Short speech bubbles for what a session (or one of its helpers) is up to.

const base = (p) => path.basename(String(p || '')) || 'a file';
const shorten = (s, n = 70) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function describeTool(name, input = {}) {
  switch (name) {
    case 'Bash': case 'PowerShell': return input.description ? shorten(input.description) : '$ ' + shorten(input.command, 50);
    case 'Read': return 'Reading ' + base(input.file_path);
    case 'Edit': case 'MultiEdit': return 'Editing ' + base(input.file_path);
    case 'Write': return 'Writing ' + base(input.file_path);
    case 'NotebookEdit': return 'Editing ' + base(input.notebook_path);
    case 'Grep': return 'Searching for "' + shorten(input.pattern, 30) + '"';
    case 'Glob': return 'Looking for ' + shorten(input.pattern, 40);
    case 'WebSearch': return 'Searching the web: ' + shorten(input.query, 40);
    case 'WebFetch': try { return 'Reading ' + new URL(input.url).hostname; } catch { return 'Reading a web page'; }
    case 'Agent': case 'Task': return 'Sending a helper: ' + shorten(input.description, 50);
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'Making a plan';
    case 'AskUserQuestion': return 'I have a question for you';
    default: return String(name || '').startsWith('mcp__') ? 'Using ' + String(name).split('__')[1] : name ? 'Using ' + name : '';
  }
}

const lastBubble = new Map(); // slime key -> time of its last tool bubble
const doing = new Map(); // session id -> what its last tool was ("Editing face.js"), for its talk box
const helperDoing = new Map(); // "session id/agent id" -> what that helper's last tool was
// A helper's name for the talk box: its description once Claude Code has
// written it (looked for at most every few seconds: the box updates often).
const helperNames = new Map(); // agent id -> { at, name }
function helperName(s, a) {
  const hit = helperNames.get(a.id);
  if (hit && (hit.found || Date.now() - hit.at < 5000)) return hit.name;
  const d = agentDescription(s, a);
  helperNames.set(a.id, { at: Date.now(), name: d || a.type, found: !!d });
  if (helperNames.size > 200) helperNames.delete(helperNames.keys().next().value);
  return d || a.type;
}
function statusBubble({ session: s, agentId, payload: p }) {
  if (!agentId) {
    if (p.hook_event_name === 'PreToolUse') doing.set(s.id, describeTool(p.tool_name, p.tool_input || {}));
    else if (p.hook_event_name === 'Stop') doing.delete(s.id);
    // A command it waits on (a dev server, a long build) in a session Blaube
    // started: after a few seconds, the box offers to background it (Ctrl+B).
    if (/^(PreToolUse|PostToolUse|PostToolUseFailure|Stop)$/.test(p.hook_event_name)) foreground.delete(s.id);
    if (p.hook_event_name === 'PreToolUse' && p.tool_name === 'Bash' && !(p.tool_input || {}).run_in_background && owned.has(s.id)) {
      const fg = { tool: String(p.tool_use_id || ''), at: Date.now(), what: shorten(String(p.tool_input.description || p.tool_input.command || 'that command'), 60) };
      foreground.set(s.id, fg);
      setTimeout(() => { if (foreground.get(s.id) === fg && talkId === s.id) pushTalk(s.id); }, 3100);
    }
    if (talkId === s.id) pushTalk(s.id);
  }
  if (!win) return;
  const key = agentId ? `${s.id}/${agentId}` : s.id;
  const say = (text, seconds, aloud = false) => { if (text) win.webContents.send('say', { id: key, text, seconds, status: true, aloud }); };
  const event = p.hook_event_name;
  if (event === 'PreToolUse') {
    // Not every tool: a busy session would never stop talking.
    const now = Date.now();
    if (now - (lastBubble.get(key) || 0) < 4000) return;
    lastBubble.set(key, now);
    // A helper murmurs it out loud too (softly); a session's own stay quiet.
    if (agentId) win.webContents.send('say', { id: key, text: describeTool(p.tool_name, p.tool_input || {}), seconds: 2.5, status: true, aloud: true, soft: true });
    else say(describeTool(p.tool_name, p.tool_input || {}), 2.5);
  } else if (event === 'Stop') {
    const said = p.last_assistant_message || usage.lastText(transcriptPath(s));
    // How long the turn took, when it was worth waiting for.
    const secs = s.turnStart ? (Date.now() - s.turnStart) / 1000 : 0;
    const took = secs < 20 ? '' : secs < 60 ? ` in ${Math.round(secs)}s` : secs < 3600 ? ` in ${Math.round(secs / 60)}m` : ` in ${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
    say(said ? `Done${took}: ` + shorten(said, 80) : `Done${took}!`, 6, true);
    if (!agentId) notify(s, 'done', said, secs);
  } else if (event === 'Notification' && s.state === 'waiting') {
    say(shorten(p.message || 'I need you', 80), 6, true);
    if (!agentId) notify(s, 'waiting', p.message);
  }
}

// A system notification when the slimes can't tell you themselves (they're
// behind your windows); clicking it opens that slime's talk box.
const notified = new Map(); // session id -> when it last notified
const shown = new Set(); // notifications still on screen
let replyTo = null; // sendMessage, once the app is up
let doQuick = null; // runs one of a session's quick actions, once the app is up
const muted = new Set(); // sessions you turned notifications off for (from its slime's menu)
function notify(s, event, text, secs = 0) {
  if (TEST || !Notification.isSupported() || s.id.startsWith('demo-')) return;
  if (muted.has(s.id)) return;
  const mode = prefs.config.notify || 'Behind windows';
  const seen = (talkWin && talkWin.isVisible() && talkId === s.id) || (mode !== 'Always' && prefs.config.onTop !== 'Off' && win && win.isVisible());
  // (Asking permission: Allow and Deny right in it, on macOS.)
  const ask = event === 'waiting' ? (inbox.asks.get(s.id) || []).slice(-1)[0] : null;
  // (Finished: what its turn came to, whether or not its reply is in yet.)
  const log = inbox.log(s.id), last = [...log].reverse().find((e) => e.who === 'claude');
  const t = event === 'done' ? require('./inbox').turnOf(log, Date.now()) || (last && Date.now() - last.at < 10e3 && last.turn) : null;
  const turn = event === 'done' ? { files: t ? t.files.length : 0, failed: !!failedTests(log) } : null;
  const n = attention.notification({ event, project: s.project, title: usage.sessionInfo(transcriptPath(s)).title, text, secs, seen, enabled: mode !== 'Off', ask, turn });
  if (!n || Date.now() - (notified.get(s.id) || 0) < 15000) return;
  notified.set(s.id, Date.now());
  // (On macOS you can answer one that's done right in the notification.)
  // (And a permission ask can be answered "no, do this instead" in words.)
  // (A question: a tap on an answer, or one in your own words.)
  const askReply = ask && ask.kind === 'tool' && n.actions;
  // (Done: its first two quick actions as buttons, Commit or Fix the tests, say.)
  const quick = event === 'done' && !n.actions && doQuick ? quickFor(s.id, s).filter((q) => !q.here && !q.signIn && !q.bring && !q.sure && !('later' in q)).slice(0, 2) : [];
  const buttons = n.actions || (quick.length ? quick.map((q) => q.label) : null);
  const answer = (label) => inbox.decide(s.id, ask.key, 'allow', { [n.question]: label });
  const note = new Notification(Object.assign({ title: n.title, body: n.body }, event === 'done' ? { hasReply: true, replyPlaceholder: `Reply to ${s.project}` } : askReply ? { hasReply: true, replyPlaceholder: 'Or say what to do instead' } : n.question ? { hasReply: true, replyPlaceholder: 'Or answer in your words' } : {},
    buttons ? { actions: buttons.map((text) => ({ type: 'button', text })) } : {}));
  note.on('action', (_e, i) => { shown.delete(note); if (quick[i] && tracker.sessions.has(s.id)) return doQuick(s.id, quick[i]); if (ask && n.actions && !(n.question ? answer(n.actions[i]) : inbox.decide(s.id, ask.key, i === 0 ? 'allow' : 'deny')) && win) win.webContents.send('open-talk', s.id); });
  note.on('reply', (_e, text) => {
    shown.delete(note);
    const said = String(text || '').trim();
    if (!said || !tracker.sessions.has(s.id)) return;
    if (askReply) { if (!inbox.decide(s.id, ask.key, 'deny', { message: said }) && win) win.webContents.send('open-talk', s.id); return; }
    if (n.question && ask) { if (!answer(said) && win) win.webContents.send('open-talk', s.id); return; }
    if (replyTo) replyTo(s.id, said);
  });
  // (Held on to until it's gone, or a click may never arrive.)
  shown.add(note);
  note.on('click', () => { shown.delete(note); if (win && tracker.sessions.has(s.id)) win.webContents.send('open-talk', s.id); });
  note.on('close', () => shown.delete(note));
  note.show();
}

// A slash command Blaube can't type in for you (Windows, or a terminal it
// can't drive): it goes on the clipboard and its terminal comes forward,
// so it's one paste away.
const handedOver = new Map(); // session id -> { text, at }: the command it couldn't take, for when it's brought here
function handOver(s, cmd) {
  clipboard.writeText(cmd);
  const bring = canBringIn(s);
  if (bring) handedOver.set(s.id, { text: cmd, at: Date.now() });
  inbox.add(s.id, { who: 'note', text: `${cmd.split(/\s/)[0]} is for Claude Code itself, so it’s on your clipboard: paste it into its terminal.${bring ? ' Or bring it here: it goes straight in then, and commands like it too.' : ''}`, bring });
  if (!TEST) goToSession(s);
}

// A conversation as Markdown (see markdown.js), and saved to Downloads
// (no dialog: it would take focus and close the talk box). Never over
// another file. Returns where it went, or ''.
function conversationMarkdown(id) {
  const s = tracker.sessions.get(id) || (talkLast && talkLast.id === id ? talkLast : null);
  return markdown.toMarkdown({ project: s ? s.project : '', cwd: s ? s.cwd : '', log: inbox.log(id) });
}
function saveConversation(id) {
  if (!inbox.log(id).length) return '';
  const s = tracker.sessions.get(id) || (talkLast && talkLast.id === id ? talkLast : {});
  try {
    const dir = app.getPath('downloads');
    const name = markdown.fileName(s.project);
    let file = path.join(dir, name);
    for (let n = 2; fs.existsSync(file) && n < 100; n++) file = path.join(dir, name.replace(/\.md$/, ` (${n}).md`));
    fs.writeFileSync(file, conversationMarkdown(id), { flag: 'wx' });
    log(`saved ${s.project}'s conversation to ${file}`);
    return file;
  } catch (e) { log(`couldn't save the conversation: ${e.message}`); return ''; }
}

// The talk shortcut: opens the talk box of the slime that needs you most
// (or closes the open one).
function talkShortcut() {
  if (talkWin && talkWin.isVisible()) { hideTalk(); return; }
  const s = attention.mostWanted(tracker.list().filter(isReady));
  if (!win) return;
  if (!s) { newSession(); return; } // nobody to talk to: start someone
  if (process.platform === 'darwin') app.focus({ steal: true }); // a shortcut from another app: the box takes the keyboard
  win.webContents.send('open-talk', s.id);
}

// A helper's own description ("Ring Globe: Manta logo mode") instead of its
// type ("general-purpose"). Claude Code keeps it in a small file next to the
// helper's transcript.
const agentDescriptions = new Map();
function agentDescription(s, a) {
  if (agentDescriptions.has(a.id)) return agentDescriptions.get(a.id);
  const file = transcriptPath(s);
  if (!file) return '';
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(file), s.id, 'subagents', `agent-${a.id}.meta.json`), 'utf8'));
    const d = String(meta.description || '');
    if (d) agentDescriptions.set(a.id, d);
    return d;
  } catch { return ''; }
}

// Claude Code marks a helper's info file "finished" when it's done. A
// background helper can finish without a SubagentStop reaching us, which
// would leave its slime out forever; this lets it go home.
function helperFinished(s, a) {
  const file = transcriptPath(s);
  if (!file) return false;
  try {
    return !!JSON.parse(fs.readFileSync(path.join(path.dirname(file), s.id, 'subagents', `agent-${a.id}.meta.json`), 'utf8')).finished;
  } catch { return false; }
}

// Brings the session's own window to the front. If we can't find it, the
// slime says so; it never opens a second copy of a running session.
// A log in the app's data folder (blaube.log), for problems that only
// show up on a real desktop.
const logFile = () => path.join(app.getPath('userData'), 'blaube.log');
function log(msg) {
  fs.appendFile(logFile(), `${new Date().toISOString()} ${msg}\n`, () => {});
}

// Watches the left and right mouse buttons system-wide (Windows), calling
// onButton(0 or 2, down, altHeld) on every change. A small PowerShell loop
// polls them; it restarts if it ever stops.
function startButtonWatcher(onButton) {
  if (process.platform !== 'win32') return;
  const script = `
Add-Type @"
using System.Runtime.InteropServices;
public static class BlaubeKeys { [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k); }
"@
$l = $false; $r = $false
while ($true) {
  $nl = ([BlaubeKeys]::GetAsyncKeyState(1) -band 0x8000) -ne 0
  $nr = ([BlaubeKeys]::GetAsyncKeyState(2) -band 0x8000) -ne 0
  if ($nl -ne $l -or $nr -ne $r) {
    $alt = ([BlaubeKeys]::GetAsyncKeyState(0x12) -band 0x8000) -ne 0
    if ($nl -ne $l) { $l = $nl; [Console]::Out.WriteLine("0 $([int]$nl) $([int]$alt)") }
    if ($nr -ne $r) { $r = $nr; [Console]::Out.WriteLine("2 $([int]$nr) $([int]$alt)") }
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 12
}`;
  const start = () => {
    const child = require('node:child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const [b, d, a] = buf.slice(0, i).trim().split(' ').map(Number);
        buf = buf.slice(i + 1);
        if (b === 0 || b === 2) onButton(b, d === 1, a === 1);
      }
    });
    child.on('exit', () => setTimeout(start, 2000));
    app.on('will-quit', () => child.kill());
  };
  start();
}

function goToSession(s) {
  const focus = () => focusSessionApp(s, (ok, info) => {
    log(`go to session ${s.id} pid=${s.pid || '-'}: ${ok ? 'found' : 'not found'} ${info || ''}`);
    if (!ok && win) win.webContents.send('say', { id: s.id, text: "Can't find its window. Right-click me to resume it in a new terminal." });
  });
  if (s.pid || process.platform !== 'win32') return focus();
  // No process id yet (older hooks, and the poller hasn't caught it):
  // ask Claude Code right now.
  listAgents((agents) => {
    const a = (agents || []).find((x) => x && x.sessionId === s.id);
    if (a && a.pid) s.pid = a.pid;
    focus();
  });
}

function send(cmd) {
  if (win) win.webContents.send('command', cmd);
}

function appMenu() {
  return Menu.buildFromTemplate(appMenuTemplate());
}

// Blaube's menu: what you came for first (connecting, a new session), then
// the toys, then how it looks and behaves, then quitting.
// Claude Code's own defaults for new sessions (its settings file), picked
// here instead of edited in a terminal.
function ccDefaultsMenu() {
  const home = (TEST && global.__blaubeCcHome) || undefined; // (tests: never your own settings)
  const now = ccDefaults.read(home);
  const models = (prefs.models && prefs.models.length ? prefs.models : [{ value: 'default', displayName: 'Default' }, { value: 'opus', displayName: 'Opus' }, { value: 'sonnet', displayName: 'Sonnet' }, { value: 'haiku', displayName: 'Haiku' }]);
  const set = (change) => { if (!ccDefaults.write(change, home) && !TEST) dialog.showMessageBox({ type: 'warning', message: 'Blaube can’t change your Claude Code settings', detail: `${ccDefaults.fileOf()} isn’t plain JSON, so Blaube leaves it alone.` }); };
  const known = models.some((m) => m.value === now.model || (!now.model && m.value === 'default'));
  return { label: 'Claude Code defaults', submenu: [
    { label: 'New sessions start on', enabled: false },
    ...models.map((m) => ({ label: String(m.displayName || m.value).replace(/\s*\(recommended\)/i, ''), type: 'radio', checked: m.value === 'default' ? !now.model : now.model === m.value, click: () => set({ model: m.value === 'default' ? '' : m.value }) })),
    ...(known ? [] : [{ label: now.model, type: 'radio', checked: true, enabled: false }]),
    { type: 'separator' },
    { label: 'And before acting they', enabled: false },
    ...ccDefaults.MODES.map(([mode, label]) => ({ label, type: 'radio', checked: (now.mode || 'default') === mode, click: () => set({ mode: mode === 'default' ? '' : mode }) })),
    { type: 'separator' },
    { label: 'Open the settings file', click: () => { const f = ccDefaults.fileOf(home); if (!fs.existsSync(f)) ccDefaults.write({}, home); if (!TEST) shell.openPath(f); } },
  ] };
}

function appMenuTemplate() {
  const installed = claudeHooks.isInstalled(undefined, PORT);
  const noClaude = !claudeFound();
  return [
    { label: `Blaube ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    ...(noClaude ? [{ label: installing ? 'Installing Claude Code…' : 'Install Claude Code…', enabled: !installing, click: installClaude }]
      : installed ? [] : [{ label: claudeHooks.hasAnyBlaubeHooks() ? 'Update Claude Code connection…' : 'Connect Claude Code…', click: installHooks }]),
    ...newSessionMenu(),
    ...(noClaude ? [] : [ccDefaultsMenu()]),
    { type: 'separator' },
    { label: 'Play', submenu: [
      { label: 'Come here', click: () => send('come-here') },
      { label: 'Everyone hop!', click: () => send('hop') },
      // Everyone sings, in parts: the more slimes, the fuller.
      { label: 'Choir', submenu: [
        ...SONGS.map((s) => ({ label: s.title, click: () => send('choir:' + s.id) })),
        { type: 'separator' },
        { label: 'Stop singing', click: () => send('choir-stop') },
      ] },
      { label: 'Demo sessions', click: runDemo },
    ] },
    { type: 'separator' },
    { label: 'Colour', submenu: colorMenu(prefs.config.color, (hex) => setConfig(Object.assign({}, prefs.config, { color: hex }))) },
    { label: 'Live on display', submenu: displayMenu() },
    { label: 'Notifications', submenu: ['Behind windows', 'Always', 'Off'].map((m) => ({ label: m === 'Behind windows' ? 'When they’re behind windows' : m, type: 'radio', checked: (prefs.config.notify || 'Behind windows') === m, click: () => setConfig(Object.assign({}, prefs.config, { notify: m })) })) },
    { label: 'Sounds', type: 'checkbox', checked: prefs.config.voice !== 'Off', click: (i) => setConfig(Object.assign({}, prefs.config, { voice: i.checked ? 'On' : 'Off' })) },
    { label: 'Stay in front of other windows', type: 'checkbox', checked: prefs.config.onTop !== 'Off', click: (i) => setConfig(Object.assign({}, prefs.config, { onTop: i.checked ? 'On' : 'Off' })) },
    { label: 'Settings…', click: openSettings },
    // Without Accessibility the Dock is a solid strip; with it, its icon row
    // is read so the slimes can bump into its ends.
    ...(process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)
      ? [{ label: 'Bump into the Dock’s sides…', click: askDockAccess }] : []),
    { label: 'Open at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    ...(installed ? [{ label: 'Claude Code', submenu: [
      { label: 'Connected ✓', enabled: false },
      { label: 'Reconnect', click: installHooks },
      { label: 'Disconnect…', click: uninstallHooks },
    ] }] : []),
    { type: 'separator' },
    { label: 'Quit Blaube', role: 'quit' },
  ];
}

// Whether Claude Code is on this computer at all (where its installers put
// it, or on your shell's PATH).
const INSTALL_URL = 'https://docs.claude.com/en/docs/claude-code/setup';
const claudeFound = () => !!(findClaude() || owned.shellPath() || TEST);

function sessionMenu(id) {
  const s = tracker.sessions.get(id);
  if (!s) return null;
  const word = { working: 'Working', waiting: 'Needs you', done: 'Done', idle: 'Idle' }[s.state] || s.state;
  const effort = { low: 'Low effort', medium: 'Medium effort', high: 'High effort', xhigh: 'Extra high effort', max: 'Max effort' }[efforts.get(id) || defaultEffort()];
  const isDemo = id.startsWith('demo-');
  return Menu.buildFromTemplate([
    { label: s.project, enabled: false },
    { label: `${word}${s.message && s.state === 'waiting' ? ': ' + s.message : ''}`, enabled: false },
    ...(effort ? [{ label: effort, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Talk', enabled: !isDemo, click: () => win && win.webContents.send('open-talk', id) },
    ...(owned.has(id) ? [
      { label: 'Continue in terminal', click: () => continueInTerminal(s) },
      { label: 'End session', click: () => endOwned(s) },
    ] : [
      { label: 'Go to its terminal', sublabel: process.platform === 'darwin' ? '⌥-click the slime' : 'Alt-click the slime', enabled: !isDemo, click: () => goToSession(s) },
      { label: 'Resume in a new terminal', enabled: !isDemo, click: () => openResumeTerminal(s) },
      { label: 'Bring it into Blaube', enabled: canBringIn(s), click: () => bringIn(s) },
    ]),
    { label: 'Fork into a new session', toolTip: 'A copy of this conversation in a new session, to try something else; this one carries on as it is', enabled: !isDemo && !!s.cwd, click: () => forkSession(s) },
    { label: 'Copy resume command', click: () => clipboard.writeText(`cd "${s.cwd}" && ${resumeCommand(s.id)}`) },
    { label: 'Notify me about this one', type: 'checkbox', checked: !muted.has(id), enabled: !isDemo && (prefs.config.notify || 'Behind windows') !== 'Off', click: (item) => { if (item.checked) muted.delete(id); else muted.add(id); } },
    { label: 'Save conversation as Markdown', enabled: !isDemo && inbox.log(id).length > 0, click: () => { const f = saveConversation(id); if (f) shell.showItemInFolder(f); } },
    { label: 'Open project folder', enabled: !!s.cwd, click: () => shell.openPath(s.cwd) },
    ...(!isDemo && s.cwd && editorNow() ? [{ label: `Open in ${editorNow().name}`, click: () => openInEditor(id, '') }] : []),
    ...(isDemo || !s.cwd ? [] : [allowedMenu(s)]),
    { type: 'separator' },
    { label: 'Colour', submenu: colorMenu(colorOf(s) || prefs.config.color, (hex) => { prefs.colors[colorKey(s)] = hex; savePrefs(); pushState(); }) },
    { label: 'Blaube', submenu: appMenuTemplate() },
    { type: 'separator' },
    { label: 'Hide this slime', toolTip: 'Until its session ends', click: () => tracker.dismiss(id) },
  ]);
}

// A copy of its conversation in a new session (a new slime), to try
// something else while it carries on: --resume --fork-session.
function forkSession(s) {
  const id = startSession(s.cwd, [], '', s.id);
  if (!id) return null;
  inbox.add(id, { who: 'note', text: `A copy of ${s.title || s.project}’s conversation: try something else here, it carries on as it was` });
  inbox.add(s.id, { who: 'note', text: 'Forked into a new session' });
  return id;
}

// What it may do without asking (its "Always allow" rules), each a tap
// from being taken back, as /permissions does in the terminal.
function allowedMenu(s) {
  const st = gitStates.get(s.id);
  const list = permRules.list([s.cwd, st && st.root]);
  return {
    label: 'Allowed without asking',
    enabled: list.length > 0,
    submenu: list.length ? list.slice(0, 30).map((r) => ({ label: permRules.label(r.rule), sublabel: r.scope, toolTip: `${r.rule} in ${r.file}`, click: () => disallow(s, r) })) : [{ label: 'Nothing', enabled: false }],
  };
}
async function disallow(s, r) {
  if (!TEST) {
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: ['Ask first', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Ask before “${permRules.label(r.rule)}” again?`,
      detail: `Takes ${r.rule} out of ${r.file} (${r.scope.toLowerCase()}).`,
    });
    if (response !== 0) return;
  }
  try {
    if (permRules.remove(r.file, r.rule)) inbox.add(s.id, { who: 'note', text: `It asks first again before: ${permRules.label(r.rule)}` });
  } catch (e) { log(`couldn't change ${r.file}: ${e.message}`); }
}

async function askDockAccess() {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Open Settings', 'Cancel'],
    defaultId: 0,
    message: 'Let the slimes bump into the Dock’s sides?',
    detail: 'macOS only tells Blaube where the Dock’s icons are if Blaube is allowed under Privacy & Security → Accessibility. Blaube only reads the Dock’s size and position with it.\n\nTurn Blaube on there; the Dock’s ends become solid within a few seconds.',
  });
  if (response !== 0) return;
  systemPreferences.isTrustedAccessibilityClient(true);
  // Check back for a while, so it takes effect without a restart.
  let tries = 0;
  const poll = setInterval(() => {
    if (systemPreferences.isTrustedAccessibilityClient(false) || ++tries > 60) { clearInterval(poll); refreshDock(); }
  }, 2000);
}

// Installing Claude Code from the menu, no terminal: its official
// installer, after a dialog that says what runs (see installer.js). Then
// it signs in (afterInstall: your browser opens).
let installing = false, afterInstall = () => {};
async function installClaude() {
  if (installing) return;
  const line = installer.command()[2];
  const { response } = TEST ? { response: 0 } : await dialog.showMessageBox({
    type: 'question', buttons: ['Install', 'Show me how instead', 'Cancel'], defaultId: 0, cancelId: 2,
    message: 'Install Claude Code?',
    detail: `Blaube runs Claude Code's official installer, as its setup page has you do in a terminal:\n\n${line}\n\nIt goes in your home folder (no password needed). Then you sign in once, in your browser.`,
  });
  if (response === 1) { shell.openExternal(INSTALL_URL); return; }
  if (response !== 0) return;
  installing = true;
  refreshTray();
  installer.install((ok, last) => {
    installing = false;
    log(`install Claude Code: ${ok ? 'ok' : 'failed'}: ${last}`);
    refreshTray();
    if (TEST) global.__blaubeInstalled = { ok, last };
    if (ok && claudeFound()) { afterInstall(); return; }
    if (!TEST) dialog.showMessageBox({ type: 'warning', buttons: ['Show me how', 'OK'], defaultId: 0, cancelId: 1, message: 'Claude Code didn’t install.', detail: last || 'The installer stopped without saying why.' })
      .then(({ response: r }) => { if (r === 0) shell.openExternal(INSTALL_URL); });
  }, TEST && global.__blaubeInstallRun ? { run: global.__blaubeInstallRun } : {});
}
if (TEST) global.__blaubeInstall = installClaude;

async function installHooks() {
  const file = claudeHooks.settingsPath();
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Connect', 'Cancel'],
    defaultId: 0,
    message: 'Connect Blaube to Claude Code?',
    detail: `Blaube adds a few hooks to ${file} so Claude Code tells it when a session starts, is working, needs you, or is done.\n\nThe hooks only talk to Blaube on this computer (127.0.0.1:${PORT}). No API calls, no tokens. A backup is saved next to the file.\n\nSessions already running pick them up when you restart them (on macOS, Blaube can still talk to them in Terminal or iTerm meanwhile).`,
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

async function uninstallHooks() {
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: ['Disconnect', 'Cancel'], defaultId: 1, cancelId: 1,
    message: 'Disconnect Blaube from Claude Code?',
    detail: 'Blaube’s hooks come out of your Claude Code settings. The slimes stop knowing what your sessions are doing, and you can’t talk to them from here, until you connect again.',
  });
  if (response !== 0) return;
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
  // A light session, a hungry one, and one whose context is nearly full.
  demoTokens.set(a, { total: 40000, context: 30000, limit: 200000 });
  demoTokens.set(b, { total: 900000, context: 140000, limit: 200000 });
  demoTokens.set(c, { total: 3000000, context: 192000, limit: 200000 });
  at(36000, () => { for (const id of [a, b, c]) demoTokens.delete(id); });
  // One of each effort level.
  demoEfforts.set(a, 'low');
  demoEfforts.set(b, 'high');
  demoEfforts.set(c, 'max');
  // A dev server and a test watcher as pets.
  at(2200, () => {
    const s = tracker.sessions.get(b);
    if (!s) return;
    s.tasks = [
      { id: 'demo-t1', command: 'npm run dev', description: 'Dev server', startedAt: Date.now(), missing: 0, demo: true },
      { id: 'demo-t2', command: 'npm test -- --watch', description: 'Test watcher', startedAt: Date.now(), missing: 0, demo: true },
    ];
    pushState();
  });
  at(15000, () => { const s = tracker.sessions.get(b); if (s) { s.tasks = s.tasks.slice(1); pushState(); } });
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

function trayMenu() {
  const live = tracker.list().filter(isReady).filter((o) => !o.id.startsWith('demo-'));
  const mark = { waiting: '❓', working: '⏳', done: '✅', idle: '💤' };
  const rows = live.map((o) => {
    const g = glanceAt(o);
    // (Only macOS shows a sublabel: elsewhere the status goes on the line.)
    const row = { label: `${mark[o.state] || '•'}  ${o.project}${process.platform === 'darwin' || !g.status ? '' : `  ·  ${g.status.length > 40 ? g.status.slice(0, 39) + "…" : g.status}`}`, sublabel: g.status, toolTip: g.meta };
    const open = () => { if (!win) return; if (process.platform === 'darwin') app.focus({ steal: true }); win.webContents.send('open-talk', o.id); };
    // Answered or stopped right from the menu bar, without opening anything.
    const ask = o.state === 'waiting' ? (inbox.asks.get(o.id) || [])[0] : null;
    const acts = [];
    if (ask && ask.kind === 'tool') {
      const what = ask.detail ? `: ${ask.detail.length > 50 ? ask.detail.slice(0, 49) + '…' : ask.detail}` : '';
      acts.push({ label: `Allow ${ask.tool || 'it'}${what}`, click: () => inbox.decide(o.id, ask.key, 'allow') }, { label: 'Deny', click: () => inbox.decide(o.id, ask.key, 'deny') });
    }
    // (A question with one pick: its answers; a plan: go ahead with it.)
    const qs = ask && ask.kind === 'question' && ask.input && Array.isArray(ask.input.questions) ? ask.input.questions : [];
    if (qs.length === 1 && !qs[0].multiSelect) {
      const q = String(qs[0].question || '');
      acts.push({ label: q.length > 60 ? q.slice(0, 59) + '…' : q, enabled: false });
      for (const opt of (qs[0].options || []).slice(0, 6)) if (opt && opt.label) acts.push({ label: String(opt.label), click: () => inbox.decide(o.id, ask.key, 'allow', { [q]: String(opt.label) }) });
    }
    if (ask && ask.kind === 'plan') acts.push({ label: 'Go ahead with the plan', click: () => inbox.decide(o.id, ask.key, 'allow') });
    if (o.state === 'working' && (owned.has(o.id) || inbox.steerable.has(o.id))) {
      acts.push({ label: 'Stop', click: () => {
        const asked = inbox.stop(o.id);
        if (owned.has(o.id)) { if (!asked && !inbox.stops.has(o.id)) inbox.add(o.id, { who: 'note', text: 'You asked it to stop', stop: true }); owned.control(o.id, { subtype: 'interrupt' }, () => {}); }
      } });
    }
    // Free: its quick actions (Commit, Push, Fix the checks…), as in its box.
    if ((o.state === 'done' || o.state === 'idle') && doQuick) {
      for (const q of quickFor(o.id, o).filter((x) => !x.here && !x.signIn && !x.bring && !x.sure && !('later' in x))) acts.push({ label: q.label, toolTip: q.prompt, click: () => doQuick(o.id, q) });
    }
    return acts.length ? Object.assign(row, { submenu: [{ label: 'Open', click: open }, { type: 'separator' }, ...acts] }) : Object.assign(row, { click: open });
  });
  // (And your usage limits, as /usage says them, once Blaube has heard.)
  const used = limits.line(usageLimits).replace(/^Usage: /, '');
  const usage = used ? [{ label: `Usage: ${used}`, enabled: false }, { type: 'separator' }] : [];
  return Menu.buildFromTemplate([...(rows.length ? [...rows, { type: 'separator' }] : []), ...usage, ...appMenuTemplate()]);
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
  // Windows shows (and routes clicks on) notifications by app id: the
  // installer's, or this Electron's own when run from the source folder.
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'app.blaube.desktop' : process.execPath);

  loadPrefs();

  try {
    await startHookServer(tracker, PORT, inbox);
  } catch (e) {
    dialog.showErrorBox('Blaube', `Could not listen on 127.0.0.1:${PORT} (${e.code || e.message}). Is another Blaube running? Set BLAUBE_PORT to use a different port.`);
  }

  createWindow();
  makeTalkWin();
  if (!app.isPackaged && !TEST) watchForChanges();

  if (!TEST) {
    tray = new Tray(trayIcon());
    // The menu bar icon: every session first (a click opens its talk box,
    // even with the slimes hidden), then Blaube's menu.
    tray.on('click', () => tray.popUpContextMenu(trayMenu()));
    tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  }
  refreshTray();

  focus = startFocusWatcher(() => { if (markFrontSeen()) pushState(); });
  tracker.on('change', () => {
    markFrontSeen();
    if (tracker.list().some((s) => !isReady(s))) refreshUsage();
    pushState();
    refreshTray();
  });
  tracker.on('prompt', (s) => { doing.delete(s.id); if (win) win.webContents.send('nod', s.id); });
  tracker.on('change', () => pushTalk(talkId));
  // A turn ended: anything waiting for a session without an inbox hook can be typed now.
  const typeSoon = new Map();
  tracker.on('change', (c) => {
    for (const id of inbox.queue.keys()) {
      if (typeSoon.has(id)) continue; // one check per session, not one per event
      typeSoon.set(id, setTimeout(() => { typeSoon.delete(id); typeQueued(id); }, 1500));
    }
    // A session gone without saying so (killed, merged back in): its inbox too.
    if (c && c.to === 'gone' && c.session && inbox.logs.has(c.session.id) && !owned.has(c.session.id)) inbox.observe({ session_id: c.session.id, hook_event_name: 'SessionEnd' });
  });
  inbox.on('change', (id) => pushTalk(id));
  // (A test run's result changed: its slime's hover says so.)
  const testsSaid = new Map();
  inbox.on('change', (id) => {
    const w = testsWords(id);
    if (w === (testsSaid.get(id) || '')) return;
    if (w) testsSaid.set(id, w); else testsSaid.delete(id);
    pushState();
  });
  // Another session asking (or no longer asking): the overview answers it.
  const askCounts = new Map();
  inbox.on('change', (id) => {
    const n = (inbox.asks.get(id) || []).length;
    if (id === talkId || n === (askCounts.get(id) || 0)) return;
    if (n) askCounts.set(id, n); else askCounts.delete(id);
    pushTalk(talkId);
  });
  // What each helper is on, for its mother's talk box.
  tracker.on('activity', ({ session: s, agentId, payload: p }) => {
    if (!agentId || p.hook_event_name !== 'PreToolUse') return;
    helperDoing.set(`${s.id}/${agentId}`, describeTool(p.tool_name, p.tool_input || {}));
    if (helperDoing.size > 200) helperDoing.delete(helperDoing.keys().next().value);
    if (talkId === s.id) pushTalk(s.id);
  });
  tracker.on('change', sweepSoon);
  // A message from the slime went in: its turn starts, as if typed.
  // One went in at its next step, mid-turn: it nods, as when you type.
  inbox.on('heard', (id) => { if (win) win.webContents.send('nod', id); });
  // A to-do item ticked off, or Stop pressed: the slime feels it.
  inbox.on('ticked', (id, t) => { if (win) win.webContents.send('react', { id, kind: t.done === t.of ? 'listdone' : 'tick', done: t.done, of: t.of }); });
  inbox.on('stopping', (id) => { if (win) win.webContents.send('react', { id, kind: 'brace' }); });
  inbox.on('delivered', (id) => {
    if (tracker.sessions.has(id)) tracker.handle({ session_id: id, hook_event_name: 'UserPromptSubmit' }, 'blaube');
  });
  // Replies to what you said from the slime pop up as a speech bubble,
  // unless its talk box is open (it shows them, and would cover the bubble).
  inbox.on('reply', (id, entry) => {
    const log = inbox.log(id), text = entry.text;
    let asked = null;
    for (let i = log.indexOf(entry) - 1; i >= 0 && !asked; i--) if (log[i].who !== 'note' && log[i].who !== 'step') asked = log[i];
    const open = talkWin && talkId === id && talkWin.isVisible();
    if (win && !open && asked && asked.who === 'you' && asked.via === 'blaube') win.webContents.send('say', { id, text: snippet(text), seconds: 7 });
    // Open, the box shows it; the slime still says it out loud.
    else if (win && open) win.webContents.send('say', { id, text: snippet(text), voiceOnly: true });
  });
  tracker.on('activity', statusBubble);
  // A few moments worth a reaction (most tools get just their icon): a push
  // sent off, tests that pass or fail, a commit, something deleted.
  tracker.on('tooldone', ({ session: s, agentId, payload: p, failed }) => {
    const kind = classify(p.tool_name, p.tool_input);
    const react = failed ? (kind === 'test' ? 'testfail' : '') : { push: 'push', test: 'cheer', commit: 'commit' }[kind];
    if (win && react) win.webContents.send('react', { id: agentId ? `${s.id}/${agentId}` : s.id, kind: react });
    // Tests that fail: its slime says how many (when the box is closed).
    if (win && failed && kind === 'test' && !agentId && !(talkWin && talkId === s.id && talkWin.isVisible())) {
      const c = require('./testCounts').testCounts(require('./inbox').stepDetail(Object.assign({}, p, { hook_event_name: 'PostToolUseFailure' })));
      if (c && c.fail) win.webContents.send('say', { id: s.id, text: `${c.fail} test${c.fail === 1 ? '' : 's'} failing`, seconds: 4, status: true });
    }
  });

  // Sessions Blaube started: their slime, their replies, their end.
  owned.on('start', (id, cwd) => {
    inbox.owned.add(id);
    tracker.handle({ session_id: id, hook_event_name: 'SessionStart', cwd, _entry: 'blaube' }, 'blaube');
  });
  owned.on('renamed', (id, to) => {
    log(`session ${id} carries on as ${to}`);
    // Its hooks may have got there first, as a session of their own.
    if (tracker.sessions.has(to)) { tracker.sessions.delete(to); readySessions.delete(to); }
    tracker.rename(id, to);
    inbox.rename(id, to);
    if (doing.has(id)) { doing.set(to, doing.get(id)); doing.delete(id); }
    if (readySessions.has(id)) { readySessions.delete(id); readySessions.add(to); }
    if (talkId === id) talkId = to;
    pushState();
  });
  owned.on('mode', (id, mode) => tracker.setMode(id, mode));
  // Your usage limits, as Claude Code tells a session Blaube started.
  const setLimits = (l) => {
    if (!l) return;
    // (Getting to 90%, or running out: a notification, once per window.)
    const told = new Set(prefs.limitsTold || []);
    const news = limits.news(l, told);
    if (news) {
      prefs.limitsTold = [...told].slice(-12);
      savePrefs();
      if (TEST) global.__blaubeLimitNews = news;
      else if (Notification.isSupported() && (prefs.config.notify || 'Behind windows') !== 'Off') new Notification({ title: news.title, body: news.body }).show();
    }
    const before = JSON.stringify(usageLimits);
    usageLimits = l;
    if (JSON.stringify(usageLimits) !== before && talkId) pushTalk(talkId);
  };
  owned.on('limits', (info) => setLimits(limits.read(info)));
  // (And asked for now and then: get_usage, which calls no model.)
  const askUsage = () => {
    const id = owned.list()[0];
    if (id) owned.control(id, { subtype: 'get_usage', skip_behaviors: true }, (ok, r) => { if (ok && r) setLimits(limits.fromUsage(r.rate_limits)); });
  };
  owned.on('result', askUsage);
  // With none of Blaube's running, a Claude Code of its own is asked (one
  // that calls no model), when the overview opens: at most every 10 minutes.
  let lastProbe = 0, noPlanLimits = false;
  const probeUsage = () => {
    if (TEST || noPlanLimits || owned.list().length || Date.now() - lastProbe < 10 * 60e3) return;
    const bin = owned.findClaude() || owned.shellPath();
    if (!bin) return;
    lastProbe = Date.now();
    usageProbe.probe(bin, (r) => {
      if (r && r.rate_limits_available === false) noPlanLimits = true; // (an API key: no plan limits to show)
      setLimits(limits.fromUsage(r && r.rate_limits));
    });
  };
  // Whether Claude Code is signed in (asked when the overview opens, at
  // most every 5 minutes), and signing it in from the box: Sign in runs
  // `claude auth login`, which opens your browser, as /login does.
  let lastAuth = 0, signingIn = false;
  signingInNow = () => signingIn;
  const checkAuth = (force) => {
    const bin = owned.findClaude() || owned.shellPath();
    if (!bin || signingIn || (!force && Date.now() - lastAuth < 5 * 60e3)) return;
    lastAuth = Date.now();
    auth.status(bin, (ok) => { if (ok === null || ok === !signedOutNow) return; signedOutNow = !ok; if (talkId) pushTalk(talkId); });
  };
  ipcMain.on('talk-sign-in', (_e, id) => signIn(id));
  // Just installed: signed in yet? If not, sign in (your browser opens).
  afterInstall = () => {
    const bin = owned.findClaude() || owned.shellPath();
    auth.status(bin, (ok) => {
      if (ok === false) { signedOutNow = true; signIn(''); }
      if (TEST) global.__blaubeAfterInstall = ok;
      if (!TEST && ok !== false) dialog.showMessageBox({ type: 'info', message: 'Claude Code is installed.', detail: 'Start a session from Blaube’s menu (New session…).' });
    });
  };
  const signIn = (id) => {
    const bin = owned.findClaude() || owned.shellPath();
    if (signingIn || !bin) return;
    signingIn = true;
    const say = (text, error) => { if (id && tracker.sessions.has(id)) inbox.add(id, Object.assign({ who: 'note', text }, error ? { error: true } : {})); if (talkId) pushTalk(talkId); };
    say('Signing Claude Code in: finish in your browser');
    auth.login(bin, (ok, why) => {
      signingIn = false;
      if (ok) signedOutNow = false;
      say(ok ? 'Signed in. Try again to carry on.' : `It didn’t sign in: ${why}`);
      checkAuth(true);
    }, (url) => say(`If your browser didn’t open, the page is ${url}`));
  };
  // Back after ten minutes or more away from the computer: what happened
  // in the meantime, once (a notification; a click opens whoever wants you).
  let awaySince = 0;
  const checkAway = (idle = require('electron').powerMonitor.getSystemIdleTime()) => {
    if (idle >= 600) { if (!awaySince) awaySince = Date.now() - idle * 1000; return; }
    if (!awaySince || idle > 30) return;
    const since = awaySince;
    awaySince = 0;
    const text = away.recap(tracker.list().filter(isReady).map((o) => ({ id: o.id, project: o.project, title: o.id.startsWith('demo-') ? '' : usage.sessionInfo(transcriptPath(o)).title, state: o.state })), inbox.logs, since);
    if (!text) return;
    log(`while you were away: ${text}`);
    if (TEST) { global.__blaubeAway = text; return; }
    if (!Notification.isSupported() || (prefs.config.notify || 'Behind windows') === 'Off') return;
    const n = new Notification({ title: 'While you were away', body: text });
    n.on('click', () => { if (!(talkWin && talkWin.isVisible())) talkShortcut(); });
    n.show();
  };
  setInterval(() => checkAway(), 30e3).unref();
  // (The box's "4m" and "waiting 5m" keep up even when nothing else happens.)
  setInterval(() => { if (talkWin && talkWin.isVisible() && talkId && tracker.list().some((o) => o.state === 'waiting' || o.state === 'working')) pushTalk(talkId); }, 30e3).unref();
  // Its scripts Blaube runs: its slime says where one is up, and one that
  // stops by itself says so, with its last line.
  runs.events.on('url', (r) => {
    if (talkId === r.session) pushTalk(r.session);
    if (win) win.webContents.send('say', { id: r.session, text: `Up on ${r.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`, seconds: 5, status: true });
  });
  runs.events.on('exit', (r) => {
    if (!r.stopped) {
      const last = runs.lastLine(r.out);
      const tail = { text: String(r.out).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\s+$/, '') }; // (it has ended: what it printed last)
      inbox.add(r.session, Object.assign({ who: 'note', text: `${r.command} stopped${r.code ? ` (code ${r.code})` : ''}${last ? `: ${last.slice(0, 200)}` : ''}`, error: !!r.code }, r.code ? { runFailed: { command: r.command, tail: tail.text.split('\n').slice(-30).join('\n').slice(-3000) } } : {}));
      if (r.code && win) win.webContents.send('say', { id: r.session, text: `${r.name} stopped`, seconds: 5, status: true });
    }
    if (talkId === r.session) pushTalk(r.session);
  });
  // Each session's pull request (its branch's, from gh): how it stands on
  // its git line, and its slime says when its checks finish, or it's
  // approved or merged. gh is asked at most once a minute per branch.
  const ghBin = TEST ? '' : pulls.findGh();
  setInterval(() => {
    const bin = TEST ? global.__blaubeGh : ghBin; // (tests: a stand-in, never the real gh)
    // (Every session's git status too, box open or not: its slime's hover
    // says where it stands, and its PR is looked up.)
    for (const o of tracker.list()) {
      if (o.id.startsWith('demo-') || !o.cwd) continue;
      // (Still waiting on you, 10 and 30 minutes on: its slime reminds you.)
      const r = reminded.get(o.id);
      const told = r && r.since === o.updatedAt ? r.told : 0;
      const ask = (inbox.asks.get(o.id) || [])[0];
      const still = attention.stillWaiting({ state: o.state, since: o.updatedAt, now: Date.now() + (TEST ? global.__blaubeWaitAhead || 0 : 0), told, what: ask && ask.kind === 'tool' ? `${ask.tool || 'a tool'}${ask.detail ? ` ${String(ask.detail).slice(0, 40)}` : ''}?` : '' });
      if (still && win && !(talkWin && talkWin.isVisible() && talkId === o.id)) {
        reminded.set(o.id, { since: o.updatedAt, told: still.told });
        win.webContents.send('say', { id: o.id, text: still.text, seconds: 6, status: true });
        if (TEST) global.__blaubeReminded = { id: o.id, text: still.text };
      }
      git.status(o.cwd, (st) => {
        if (!st) return;
        const line = gitLine(o.id);
        gitStates.set(o.id, st);
        if (gitLine(o.id) !== line) { pushState(); if (o.id === talkId) pushTalk(o.id); }
        // (Finished a while ago with its changes uncommitted: its slime says so, once.)
        const left = attention.leftUncommitted({ state: o.state, git: st, idleFor: Date.now() - (o.updatedAt || Date.now()) }, TEST && global.__blaubeNudgeAfter != null ? global.__blaubeNudgeAfter : 20 * 60e3);
        if (left && nudged.get(o.id) !== left.key && win && !(talkWin && talkWin.isVisible() && talkId === o.id)) {
          nudged.set(o.id, left.key);
          win.webContents.send('say', { id: o.id, text: left.text, seconds: 5, status: true });
          if (TEST) global.__blaubeNudged = { id: o.id, text: left.text };
        }
        fetchFor(o.id, false);
        if (!bin || !st.branch) return;
        pulls.look(o.cwd, st.branch, (now) => {
          const was = prStates.get(o.id);
          if (JSON.stringify(was || null) === JSON.stringify(now || null)) return;
          prStates.set(o.id, now);
          const said = pulls.news(was, now);
          if (said) {
            inbox.add(o.id, { who: 'note', text: said });
            if (win) win.webContents.send('say', { id: o.id, text: said, seconds: 6, status: true, aloud: true });
            // (And feels it: a wince for failing checks or asked-for changes, a nod for good news.)
            if (win) { if (/failed|changes requested/.test(said)) win.webContents.send('react', { id: o.id, kind: 'oops', count: 1 }); else win.webContents.send('nod', o.id); }
            notify(o, 'pr', said); // (only if you can't see its slime)
          }
          if (o.id === talkId) pushTalk(o.id);
          pushState();
        }, { bin, fresh: TEST ? 500 : 60e3 });
      });
    }
  }, TEST ? 1000 : 20e3).unref();
  // Its git line keeps up while the box is open (a commit made elsewhere,
  // a push): git status every few seconds, the box only told of a change.
  setInterval(() => {
    const s = talkWin && talkWin.isVisible() && talkId && !talkId.startsWith('demo-') && tracker.sessions.get(talkId);
    if (!s || !s.cwd) return;
    const id = talkId;
    git.status(s.cwd, (st) => { if (JSON.stringify(st) === JSON.stringify(gitStates.get(id) || null)) return; gitStates.set(id, st); pushTalk(id); });
  }, 5e3).unref();
  if (TEST) global.__blaubeCheckAway = checkAway;
  setTimeout(probeUsage, 20e3).unref();
  setInterval(probeUsage, 15 * 60e3).unref();
  // Its MCP servers, as /mcp shows them: one that couldn't connect shows
  // in its box with Reconnect.
  const askMcp = (id) => owned.control(id, { subtype: 'mcp_status' }, (ok, r) => {
    if (!ok || !r || !Array.isArray(r.mcpServers)) return;
    const list = r.mcpServers.map((m) => ({ name: String(m.name || ''), status: String(m.status || ''), error: String(m.error || '').slice(0, 200) })).filter((m) => m.name);
    const before = JSON.stringify(mcpStates.get(id) || []);
    mcpStates.set(id, list);
    if (JSON.stringify(list) !== before) pushTalk(id);
  });
  owned.on('start', (id) => setTimeout(() => { if (owned.has(id)) { askMcp(id); modelsFor(id, () => {}); } }, 5000));
  owned.on('result', (id) => askMcp(id));
  // "undo all" under a reply, in a session Blaube started: its files put
  // back as they were before that turn by Claude Code itself (rewind_files),
  // no asking Claude. false: the box asks Claude instead.
  ipcMain.handle('talk-rewind', (_e, id, uuid) => new Promise((done) => {
    if (!id || id !== talkId || !owned.has(id) || typeof uuid !== 'string' || !inbox.log(id).some((e) => e.uuid === uuid)) return done(false);
    owned.control(id, { subtype: 'rewind_files', user_message_id: uuid, dry_run: true }, (ok, r) => {
      if (!ok || !r || !r.canRewind) { log(`rewind ${id}: ${ok ? (r && r.error) || 'no' : r}`); return done(false); }
      owned.control(id, { subtype: 'rewind_files', user_message_id: uuid }, (ok2, r2) => {
        if (!ok2 || (r2 && r2.canRewind === false)) return done(false);
        const files = (r.filesChanged || []).map((f) => path.basename(f));
        const what = files.length ? files.join(', ') : 'its files';
        inbox.add(id, { who: 'note', text: `Put back ${what} as they were before that turn` });
        tellNext(id, `I put ${files.length ? (r.filesChanged || []).join(', ') : 'the files you changed'} back as they were before your last turn: those changes are gone now.`);
        done(true);
      });
    });
  }));
  // "Run in background" (Ctrl+B in the terminal): the command it's waiting
  // on carries on in the background and it gets on with the rest.
  ipcMain.on('talk-background', (_e, id) => {
    const fg = id === talkId && owned.has(id) && foreground.get(id);
    if (!fg) return;
    owned.control(id, Object.assign({ subtype: 'background_tasks' }, fg.tool ? { tool_use_id: fg.tool } : {}), (ok, r) => {
      if (ok) foreground.delete(id);
      if (ok && r && r.backgrounded === false) { log(`background ${id}: nothing to move`); return pushTalk(id); } // (it had just finished)
      inbox.add(id, ok ? { who: 'note', text: `Running in the background now: ${fg.what}` } : { who: 'note', text: `Couldn’t move it to the background: ${r}`, error: true });
      pushTalk(id);
    });
  });
  ipcMain.handle('talk-mcp-reconnect', (_e, id, name) => new Promise((done) => {
    if (!id || id !== talkId || !owned.has(id) || !(mcpStates.get(id) || []).some((m) => m.name === name)) return done(false);
    owned.control(id, { subtype: 'mcp_reconnect', serverName: name }, (ok, r) => {
      inbox.add(id, { who: 'note', text: ok ? `Reconnected ${name}` : `Couldn’t reconnect ${name}: ${r}`, error: !ok });
      askMcp(id);
      done(ok);
    });
  }));
  // An MCP server that needs you to sign in: Claude Code gives the address
  // (mcp_authenticate) and waits for the browser to come back to it.
  ipcMain.handle('talk-mcp-sign-in', (_e, id, name) => new Promise((done) => {
    if (!id || id !== talkId || !owned.has(id) || !(mcpStates.get(id) || []).some((m) => m.name === name)) return done(false);
    owned.control(id, { subtype: 'mcp_authenticate', serverName: name }, (ok, r) => {
      if (!ok) { inbox.add(id, { who: 'note', text: `Couldn’t sign in to ${name}: ${r}`, error: true }); return done(false); }
      if (r && r.authUrl && /^https?:\/\//.test(r.authUrl)) {
        if (TEST) global.__blaubeMcpAuthUrl = r.authUrl; else shell.openExternal(r.authUrl);
        inbox.add(id, { who: 'note', text: `Finish signing in to ${name} in your browser` });
      }
      // (Asked again for a while, until it's connected.)
      let n = 0;
      const look = setInterval(() => {
        if (!owned.has(id) || ++n > 36) return clearInterval(look);
        askMcp(id);
        const m = (mcpStates.get(id) || []).find((x) => x.name === name);
        if (m && m.status === 'connected') { clearInterval(look); inbox.add(id, { who: 'note', text: `Signed in to ${name}: it’s connected` }); if (win) win.webContents.send('nod', id); }
      }, TEST ? 300 : 5000);
      look.unref();
      done(true);
    }, 30e3);
  }));
  setInterval(askUsage, 5 * 60e3).unref();
  // While Claude Code waits to try again, the box says so, not just dots.
  owned.on('retry', (id, r) => {
    const why = r.status === 429 || /rate/i.test(r.error) ? 'busy (rate limited)' : r.status === 529 || /overload/i.test(r.error) ? 'overloaded' : r.status ? `answering ${r.status}` : 'not answering';
    const secs = Math.round(r.delay / 1000);
    const said = `Claude’s servers are ${why}: trying again${secs >= 2 ? ` in ${secs}s` : ''}${r.attempt && r.max ? ` (${r.attempt} of ${r.max})` : ''}`;
    doing.set(id, said);
    // (And its slime says so, once a retry, when you can't see its box.)
    if (win && !(talkWin && talkWin.isVisible() && talkId === id)) win.webContents.send('say', { id, text: `Claude’s busy: trying again${secs >= 2 ? ` in ${secs}s` : ''}…`, seconds: Math.min(6, Math.max(2.5, secs)), status: true });
    setTimeout(() => { if (doing.get(id) === said) { doing.delete(id); if (talkId === id) pushTalk(id); } }, r.delay + 5000).unref(); // (it went through)
    pushState();
    if (talkId === id) pushTalk(id);
  });
  // Something it saved to its memory, as the terminal shows it.
  owned.on('remembered', (id, files) => (win && win.webContents.send('nod', id), inbox.add(id, { who: 'note', text: `Remembered in ${files.slice(0, 3).map((f) => path.basename(f)).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}` })));
  owned.on('fallback', (id, f) => inbox.add(id, { who: 'note', text: f.text ? f.text.replace(/\s+/g, ' ').trim().slice(0, 300) : `It switched to ${modelName(f.to) || f.to}${f.from ? `, as ${modelName(f.from) || f.from} couldn’t answer` : ''}` }));
  owned.on('compacted', (id) => inbox.add(id, { who: 'note', text: 'Compacted: it carries on from a summary of the conversation so far' }));
  owned.on('result', (id, r) => {
    pickedModel.delete(id); // (its transcript says now)
    if (r.interrupted && !r.text) inbox.observe({ session_id: id, hook_event_name: 'Stop' }); // (stopped: nothing went wrong)
    else if (!r.text && r.said) inbox.add(id, { who: 'note', text: r.said.replace(/^Error:\s*/, '') }); // (Claude Code itself answered a command)
    else if (r.error && !r.text) inbox.add(id, { who: 'note', text: `Something went wrong${r.subtype ? ` (${r.subtype})` : ''}.` });
    else if (r.error) inbox.add(id, { who: 'note', text: `Claude Code: ${r.text.trim()}`, error: true }); // (it couldn't get an answer: signed out, overloaded, a usage limit)
    else inbox.replied(id, r.text);
    tracker.handle({ session_id: id, hook_event_name: 'Stop', last_assistant_message: r.text }, 'blaube');
  });
  owned.on('exit', (id, code, err, signal) => {
    const s = tracker.sessions.get(id);
    log(`session ${id} ended (${signal || code})${err ? ': ' + err.slice(0, 300) : ''}`);
    // It stopped with an error before you could say anything: say why.
    if ((code || signal) && s && !TEST && inbox.log(id).length === 0) {
      if (/ENOENT|not found/i.test(err) && !claudeFound()) {
        dialog.showMessageBox({ type: 'warning', buttons: ['Install Claude Code…', 'OK'], defaultId: 0, cancelId: 1, message: 'Blaube can’t find Claude Code on this computer.', detail: 'Install it, then try New session again.' })
          .then(({ response }) => { if (response === 0) installClaude(); });
      } else {
        dialog.showMessageBox({ type: 'warning', message: 'Claude Code couldn’t start there.', detail: err || `It stopped right away (${signal || `exit code ${code}`}).` });
      }
    }
    tracker.handle({ session_id: id, hook_event_name: 'SessionEnd' }, 'blaube');
    inbox.observe({ session_id: id, hook_event_name: 'SessionEnd' });
    inbox.owned.delete(id);
  });
  setInterval(() => { if (tracker.prune()) { pushState(); refreshTray(); } }, 30 * 1000);
  setInterval(refreshUsage, 3000);
  setInterval(() => {
    const live = tracker.allTasks().filter((t) => !t.demo);
    if (!live.length) return;
    runningTasks(live, (alive) => {
      if (!alive) return;
      for (const t of tracker.allTasks()) if (t.demo) alive.add(t.id);
      if (tracker.pruneTasks(alive)) pushState();
    });
  }, 4000);

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
  applyTalkKey();
  // Pasted images from more than a week ago go.
  fs.readdir(path.join(app.getPath('temp'), 'blaube-pastes'), (err, names) => {
    if (err) return;
    for (const n of names) { const f = path.join(app.getPath('temp'), 'blaube-pastes', n); fs.stat(f, (e, st) => { if (!e && Date.now() - st.mtimeMs > 7 * 86400e3) fs.rm(f, { force: true }, () => {}); }); }
  });

  refreshDock();
  setInterval(refreshDock, 4 * 1000); // the Dock grows and shrinks as apps open and quit

  // The tops of other apps' windows are ledges a slime can land on.
  let lastLedges = '';
  if (!TEST) watchWindows(process.pid, (list, at) => {
    if (!win || win.isDestroyed()) return;
    const area = currentDisplay().workArea, wb = win.getBounds();
    // Windows reports physical pixels; macOS already reports points.
    const dip = process.platform === 'win32' ? list.map((w) => Object.assign({ id: w.id }, screen.screenToDipRect(null, w))) : list;
    const out = ledges(dip, area).map((l) => ({ id: l.id, x0: l.x0 - wb.x, x1: l.x1 - wb.x, y: l.y - wb.y, wx: l.wx - wb.x, at }));
    const json = JSON.stringify(out);
    if (json === lastLedges) return;
    lastLedges = json;
    if (out.length !== (watchWindows.count || 0)) log(`window ledges: ${out.length} (from ${list.length} windows)`);
    watchWindows.count = out.length;
    win.webContents.send('ledges', out);
  });

  if (!TEST) startAgentsPoller(
    (agents) => tracker.applyAgents(agents),
    () => prefs.config.pollClaudeAgents,
  );
  // Clicks: the window is see-through to the mouse except over a slime, pet
  // or anything else you can grab. The window says where those are; this
  // side watches the cursor itself and switches click-catching on and off.
  // While the cursor is over a slime it re-applies that every half second,
  // so a switch Windows dropped can't leave the slimes unclickable. It also
  // tells the window where the cursor is, so the eyes can follow it.
  let hitAreas = [], holding = false, clickable = false, applied = 0, cursorX = NaN, cursorY = NaN;
  const cursorInWindow = () => {
    const p = screen.getCursorScreenPoint(), wb = win.getContentBounds();
    const x = p.x - wb.x, y = p.y - wb.y;
    return { x, y, over: hitAreas.some((r) => x >= r[0] && y >= r[1] && x <= r[2] && y <= r[3]) };
  };
  // On Windows the window stops getting its own mouse events after a while
  // (it still catches the clicks, so they don't fall through), so presses
  // are watched here and passed on. A press counts if it starts over a
  // slime; its release always follows it.
  const pressed = { 0: false, 2: false };
  startButtonWatcher((button, down, alt) => {
    if (!win || win.isDestroyed()) return;
    const { x, y, over } = cursorInWindow();
    if (down && (over || holding)) {
      pressed[button] = true;
      win.webContents.send('pointer', { kind: 'down', button, x, y, alt });
    } else if (!down && pressed[button]) {
      pressed[button] = false;
      win.webContents.send('pointer', { kind: 'up', button, x, y, alt });
    }
  });
  ipcMain.on('hit-areas', (_e, rects, hold) => { hitAreas = Array.isArray(rects) ? rects : []; holding = !!hold; });
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const c = cursorInWindow(), x = c.x, y = c.y;
    const over = holding || c.over;
    const now = Date.now();
    if (TEST) { /* invisible: never catches the real mouse (tests send clicks to the page) */ } else if (over !== clickable || (over && now - applied > 500)) {
      if (over !== clickable) log(`clickable ${over} at ${x},${y}`);
      // Reaching for a slime: note the app in front, to give focus back to
      // after you've talked to it.
      if (over && !clickable && process.platform === 'darwin' && !(talkWin && talkWin.isVisible())) {
        frontLookup = new Promise((done) => frontmostApp((pid) => { if (pid && pid !== process.pid) lastOtherApp = pid; done(); }));
      }
      win.setIgnoreMouseEvents(!over, { forward: true });
      clickable = over;
      applied = now;
    }
    if (x !== cursorX || y !== cursorY) {
      cursorX = x; cursorY = y;
      win.webContents.send('cursor', { x, y });
    }
  }, 16);
  // Lines the window logs with a [blaube] tag go to blaube.log in the app's
  // data folder, for finding problems we can't see from here.
  try { if (fs.statSync(logFile()).size > 1 << 20) fs.unlinkSync(logFile()); } catch { /* none yet */ }
  win.webContents.on('console-message', (e) => {
    const msg = String(e.message || '');
    if (msg.startsWith('[blaube]')) log(msg.slice(9));
  });
  ipcMain.on('acknowledge', (_e, id) => {
    if (id) { const s = tracker.sessions.get(id); if (s) s.seen = true; }
    else tracker.acknowledge();
    pushState();
  });
  ipcMain.on('open-session', (_e, id) => {
    const s = tracker.sessions.get(id);
    log(`open session ${id}: ${s ? 'known' : 'unknown'}`);
    if (!s || id.startsWith('demo-')) return;
    goToSession(s);
  });
  ipcMain.on('talk', (_e, id, at) => openTalk(id, at || { x: 0, y: 0 }));
  // What a background task has printed, from Claude Code's own file for it
  // (null: not found, so the box asks Claude instead).
  // A background task that ended (its output file says how) leaves the
  // list, and one that failed says so, with its last line, in its box and
  // from its slime: the dev server that crashed while you looked away.
  const checkTasks = () => {
    for (const s of tracker.sessions.values()) {
      for (const t of [...(s.tasks || [])]) {
        const key = `${s.id}/${t.id}`;
        if (endedTasks.has(key) || t.demo) continue;
        const file = taskOutput.find(s.id, t.id);
        // (A dev server: where it says it's on, to open with a tap.)
        if (file && !taskUrls.has(key)) {
          const u = taskOutput.url(file);
          if (u) {
            taskUrls.set(key, u);
            if (taskUrls.size > 200) taskUrls.delete(taskUrls.keys().next().value);
            if (talkId === s.id) pushTalk(s.id);
            // (And its slime says it's up.)
            else if (win && readySessions.has(s.id)) win.webContents.send('say', { id: s.id, text: `Up on ${u.replace(/^https?:\/\//, '').replace(/\/$/, '')}`, seconds: 5, status: true });
          }
        }
        const r = file && taskOutput.tail(file, 4096);
        if (!r || r.exited == null) continue;
        endedTasks.add(key);
        if (endedTasks.size > 500) endedTasks.delete(endedTasks.values().next().value);
        tracker.handleTask(s, { hook_event_name: 'PreToolUse', tool_name: 'KillShell', tool_input: { shell_id: t.id } });
        const name = t.description || t.command;
        const last = r.text.split('\n').filter((l) => l.trim()).pop() || '';
        if (r.exited === 0) inbox.add(s.id, { who: 'note', text: `${name} finished` });
        else {
          inbox.add(s.id, { who: 'note', text: `${name} stopped with an error (code ${r.exited})${last ? ': ' + shorten(last.trim(), 120) : ''}`, error: true });
          if (win && readySessions.has(s.id)) win.webContents.send('say', { id: s.id, text: shorten(`${name} stopped`, 60), seconds: 5, status: true });
          if (readySessions.has(s.id)) notify(s, 'task', name);
        }
        pushState();
        if (talkId === s.id) pushTalk(s.id);
      }
    }
  };
  setInterval(checkTasks, 4000).unref();
  if (TEST) global.__blaubeCheckTasks = checkTasks;
  ipcMain.handle('talk-task-output', (_e, id, taskId) => {
    if (String(taskId).startsWith('run:')) return id === talkId && runs.list(id).some((r) => r.id === taskId) ? runs.output(taskId) : null;
    const s = id === talkId && tracker.sessions.get(id);
    if (!s || !(s.tasks || []).some((t) => t.id === taskId)) return null;
    const file = taskOutput.find(id, taskId);
    return file ? taskOutput.tail(file) : null;
  });
  // "Carry on at 3pm" (at: when) after a usage limit, or not (at: 0).
  ipcMain.on('talk-later', (_e, id, at) => {
    if (!id || id !== talkId || !tracker.sessions.has(id) || id.startsWith('demo-')) return;
    const was = carryLater.delete(id);
    const lifts = carryFor(id);
    if (at && lifts && Math.abs(lifts.at - at) < 60e3) {
      carryLater.set(id, lifts.at);
      inbox.add(id, { who: 'note', text: `It’ll carry on by itself at ${lifts.label}, when your usage limit lifts (keep Blaube open)` });
    } else if (!at && was) inbox.add(id, { who: 'note', text: 'It won’t carry on by itself' });
    pushTalk(id);
  });
  // (Checked against the clock, so a Mac that slept through it catches up.)
  function carryTick(now = Date.now()) {
    for (const [id, at] of carryLater) {
      if (now < at + 30e3) continue;
      carryLater.delete(id);
      const s = tracker.sessions.get(id);
      if (!s || s.state === 'working' || s.state === 'waiting') continue; // (gone, or already going)
      inbox.add(id, { who: 'note', text: 'Your usage limit lifted: carrying on' });
      sendMessage(id, 'Carry on where you left off.');
    }
  }
  setInterval(() => carryTick(), 30e3).unref();
  if (TEST) global.__blaubeCarryTick = carryTick;
  if (TEST) global.__blaubeSessionMenu = sessionMenu;
  if (TEST) global.__blaubeMoveAll = moveAllToTerminals;
  if (TEST) global.__blaubeTrayMenu = trayMenu;
  // A reply passed on to another session, as if pasted into its terminal.
  ipcMain.on('talk-forward', (_e, from, to, text) => {
    const a = from === talkId && tracker.sessions.get(from);
    const b = tracker.sessions.get(to);
    if (!a || !b || from === to || to.startsWith('demo-') || !isReady(b) || typeof text !== 'string' || !text.trim() || text.length > 50000) return;
    sendMessage(to, `(This is from ${a.title || a.project}, another Claude Code session working in ${a.cwd || 'another folder'}; I'm passing it on:)\n\n${text}`);
    inbox.add(from, { who: 'note', text: `Sent to ${b.title || b.project}` });
    if (win) win.webContents.send('nod', to);
  });
  ipcMain.on('talk-send', (_e, id, text) => {
    if (!id || id !== talkId || !tracker.sessions.has(id) || id.startsWith('demo-')) return;
    sendMessage(id, text);
  });
  // Editing something you said, in a session Blaube started (Esc Esc in the
  // terminal): its files put back as they were before it, the conversation
  // cut there (a copy of it, cut, takes its slime), then the new words go.
  ipcMain.handle('talk-edit', (_e, id, uuid, text) => new Promise((done) => {
    const sess = tracker.sessions.get(id);
    const log = inbox.log(id);
    const idx = typeof uuid === 'string' ? log.findIndex((e) => e.who === 'you' && e.uuid === uuid) : -1;
    if (!sess || id !== talkId || !owned.has(id) || idx < 0 || typeof text !== 'string' || !text.trim()) return done(false);
    const at = branch.before(transcriptPath(sess), uuid);
    if (at === undefined) { inbox.add(id, { who: 'note', text: 'Couldn’t go back there: Claude Code hasn’t saved that message yet', error: true }); return done(false); }
    owned.control(id, { subtype: 'rewind_files', user_message_id: uuid }, (ok, r) => {
      const put = ok && !(r && r.canRewind === false);
      const to = owned.clear(id, sess.cwd, at || '');
      const now = to && tracker.sessions.get(to);
      if (!now) return done(false);
      Object.assign(now, { transcript: '', tasks: [], agents: [] });
      inbox.logs.set(to, log.slice(0, idx));
      inbox.todos.delete(to);
      for (const m of [mcpStates, foreground, pickedModel, shellRan, rewound]) m.delete(to); // (it starts on the model it was started on)
      inbox.add(to, { who: 'note', text: `Went back to before that message${put ? ', and put its files back' : ''}. The conversation as it was is under Pick up where you left off.` });
      hubCache = null;
      sendMessage(to, text);
      pushState();
      done(to);
    });
  }));
  // What you say to a session (from its box, or a notification's reply).
  function sendMessage(id, text) {
    if (!prefs.talked) { prefs.talked = true; savePrefs(); pushState(); } // no more "click to talk" hints
    // "!git log": run right here, in its folder, as the terminal's bash
    // mode does; what it printed goes along with your next message.
    if (/^!\S/.test(String(text).trim())) return runForSession(id, String(text).trim().slice(1).trim());
    const sess = tracker.sessions.get(id);
    // "/memory": its project's CLAUDE.md, opened in your editor.
    if (/^\/memory\s*$/i.test(String(text).trim()) && sess && sess.cwd) {
      const st = gitStates.get(id);
      const file = path.join((st && st.root) || sess.cwd, 'CLAUDE.md');
      try { if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${path.basename(path.dirname(file))}\n\n`); } catch (e) { inbox.add(id, { who: 'note', text: `Couldn’t make CLAUDE.md: ${e.message}`, error: true }); return; }
      if (!TEST) shell.openPath(file);
      inbox.add(id, { who: 'note', text: `Opened ${path.basename(path.dirname(file))}/CLAUDE.md, what every session there reads first` });
      // (One Blaube started: what else it reads, and what it has remembered
      // on its own, as the terminal's /memory lists them.)
      if (owned.has(id)) owned.control(id, { subtype: 'get_memory_dialog' }, (ok, r) => {
        if (!ok || !r) return;
        const reads = (Array.isArray(r.files) ? r.files : []).filter((f) => f && f.exists && f.path).map((f) => String(f.path).replace(os.homedir(), '~'));
        const kept = (Array.isArray(r.memories) ? r.memories : []).filter((m) => m && m.name).slice(0, 12).map((m) => `${path.basename(String(m.name), '.md')}${m.description ? ` (${String(m.description).slice(0, 60)})` : ''}`);
        const parts = [reads.length ? `It reads ${reads.join(', ')}` : '', kept.length ? `It remembers: ${kept.join(' · ')}${r.memories.length > 12 ? ` and ${r.memories.length - 12} more` : ''}` : ''].filter(Boolean);
        if (parts.length) inbox.add(id, { who: 'note', text: parts.join('. ') });
      });
      return;
    }
    // "/run dev": one of its scripts (package.json). A dev server or a
    // watcher keeps running in the background, Blaube's own (its box lists
    // it with Output, Open and Stop); anything else runs as a step.
    const toRun = /^\/run(?:\s+(\S+))?\s*$/i.exec(String(text).trim());
    if (toRun && sess && sess.cwd && !id.startsWith('demo-') && require('./commands').blaubeCommand('run', sess.cwd)) {
      const list = runs.scripts(sess.cwd);
      const names = list.map((x) => x.name).join(', ');
      const sc = toRun[1] && list.find((x) => x.name === toRun[1]);
      if (!sc) { inbox.add(id, { who: 'note', text: !list.length ? 'It has no scripts to run here (no package.json scripts, Makefile, Cargo.toml, go.mod or compose file in its folder)' : toRun[1] ? `It has no script called ${toRun[1].slice(0, 60)}: it has ${names}` : `Its scripts: ${names}. /run ${list[0].name} runs one.` }); return; }
      if (!sc.long) return runForSession(id, sc.command, `Ran ${sc.command}`);
      const r = runs.start(id, sess.cwd, sc.name);
      inbox.add(id, r ? { who: 'note', text: `Started ${sc.command}: it keeps running in the background, with Stop beside it` } : { who: 'note', text: `Couldn’t start ${sc.command}`, error: true });
      pushTalk(id);
      return;
    }
    // "/rename tax rewrite": its name, written where Claude Code keeps it.
    const newName = renamer.command(text);
    if (newName !== null && sess && !id.startsWith('demo-')) {
      if (!newName) { inbox.add(id, { who: 'note', text: 'Give it a name: /rename tax rewrite' }); return; }
      try { inbox.add(id, { who: 'note', text: `Named it “${renamer.rename(transcriptPath(sess), id, newName)}”` }); } catch (e) { inbox.add(id, { who: 'note', text: `Couldn’t name it: ${e.message}`, error: true }); }
      hubCache = null;
      refreshTray();
      pushTalk(id);
      return;
    }
    // "/mcp disable linear" (or enable), in a session Blaube started: turned
    // off or on right away, as /mcp does in the terminal (mcp_toggle).
    const toggle = /^\/mcp\s+(enable|disable|on|off)\s+(\S{1,200})\s*$/i.exec(String(text).trim());
    if (toggle && sess) {
      const on = /^(enable|on)$/i.test(toggle[1]), name = toggle[2];
      if (!owned.has(id)) { inbox.add(id, { who: 'note', text: `Turning an MCP server ${on ? 'on' : 'off'} works in a session Blaube started; in its terminal, /mcp does it.` }); return; }
      if (!(mcpStates.get(id) || []).some((m) => m.name === name)) { inbox.add(id, { who: 'note', text: `It has no MCP server called ${name}`, error: true }); return; }
      owned.control(id, { subtype: 'mcp_toggle', serverName: name, enabled: on }, (ok, r) => {
        inbox.add(id, ok ? { who: 'note', text: `Turned ${name} ${on ? 'on' : 'off'}` } : { who: 'note', text: `Couldn’t turn ${name} ${on ? 'on' : 'off'}: ${r}`, error: true });
        askMcp(id);
      }, 15e3);
      return;
    }
    // "/plugin install x", enable, disable, uninstall, update, and
    // "/plugin marketplace add owner/repo": Claude Code's own plugin
    // commands, run right there as a step. One that installs by running a
    // command of its own shows you that command first.
    const plug = /^\/plugins?\s+(install|i|uninstall|remove|enable|disable|update)\s+([\w@][\w.@\/:+-]{0,199})\s*$/i.exec(String(text).trim());
    const market = !plug && /^\/plugins?\s+marketplace\s+(add|remove|rm|update)\s+([\w.@\/~][\w.@\/:~+#=-]{0,299})\s*$/i.exec(String(text).trim());
    if ((plug || market) && sess && !id.startsWith('demo-')) {
      const bin = owned.findClaude() || owned.shellPath() || 'claude';
      const sq = (a) => (process.platform === 'win32' ? `"${a.replace(/"/g, '')}"` : `'${a.replace(/'/g, `'\\''`)}'`);
      const verb = { i: 'install', remove: 'uninstall', rm: 'remove' }[(plug || market)[1].toLowerCase()] || (plug || market)[1].toLowerCase();
      const name = (plug || market)[2];
      const loaded = () => { if (owned.has(id)) owned.control(id, { subtype: 'reload_plugins' }, () => {}); };
      if (market) return runForSession(id, `${sq(bin)} plugin marketplace ${verb} ${sq(name)}`, `Marketplace ${name}: ${verb === 'add' ? 'added' : verb === 'update' ? 'updated' : 'removed'} (claude plugin marketplace ${verb})`, (code) => { if (code === 0) loaded(); });
      if (verb !== 'install') return runForSession(id, `${sq(bin)} plugin ${verb} ${sq(name)}`, `${name}: ${{ uninstall: 'uninstalled', enable: 'turned on', disable: 'turned off', update: 'updated' }[verb]} (claude plugin ${verb})`, (code) => { if (code === 0) loaded(); });
      const install = (accept) => runForSession(id, `${sq(bin)} plugin install ${sq(name)} --json${accept ? ` --accept-command ${sq(accept)}` : ''}`, `Installed ${name} (claude plugin install)`, (code, out, step) => {
        let r = null;
        for (const line of String(out || '').split('\n').reverse()) { try { r = JSON.parse(line); break; } catch { /* not it */ } }
        if (code === 0) { loaded(); inbox.add(id, { who: 'note', text: owned.has(id) ? `It can use ${name} now` : `${name} is installed: sessions started from now on have it` }); if (win) win.webContents.send('nod', id); return; }
        const sc = r && r.shownCommand;
        if (!accept && sc && /^[0-9a-f]{16,128}$/i.test(String(sc.sha256 || ''))) {
          const what = String(sc.command || sc.text || '').slice(0, 2000);
          Object.assign(step, { ok: true, text: `${name} installs by running a command: asked you first` }); // (not a failure: it's waiting on you)
          inbox.emit('change', id);
          const go = () => install(String(sc.sha256));
          if (TEST) { global.__blaubePluginCommand = what; if (global.__blaubeAcceptPluginCommand) go(); return; }
          dialog.showMessageBox({ type: 'warning', buttons: ['Run it and install', 'Cancel'], defaultId: 1, cancelId: 1, message: `${name} installs by running this command:`, detail: `${what}\n\nOnly go ahead if you trust where this plugin comes from.` }).then(({ response }) => { if (response === 0) go(); else inbox.add(id, { who: 'note', text: `Didn’t install ${name}` }); });
          return;
        }
        if (r && r.message) inbox.add(id, { who: 'note', text: `Couldn’t install ${name}: ${String(r.message).slice(0, 300)}`, error: true });
      });
      return install('');
    }
    // "/mcp add linear https://mcp.linear.app/mcp" (or "/mcp add name --
    // npx some-server"), "/mcp remove linear": Claude Code's own `claude mcp
    // add` and `remove`, for this project, as a step. A session Blaube
    // started is started again to have it (same conversation).
    const mcpAdd = /^\/mcp\s+add\s+([\w.-]{1,60})\s+(?:(https?:\/\/\S{1,500})|--\s+(\S[^\n]{0,500}))\s*$/i.exec(String(text).trim());
    const mcpRemove = /^\/mcp\s+(?:remove|rm)\s+([\w.-]{1,60})\s*$/i.exec(String(text).trim());
    if ((mcpAdd || mcpRemove) && sess && sess.cwd && !id.startsWith('demo-')) {
      const bin = TEST ? global.__blaubeClaudeBin : owned.findClaude() || owned.shellPath() || 'claude'; // (tests: a stand-in, never your real settings)
      if (!bin) return;
      const sq = (a) => (process.platform === 'win32' ? `"${a.replace(/"/g, '')}"` : `'${a.replace(/'/g, `'\\''`)}'`);
      const name = (mcpAdd || mcpRemove)[1];
      const cmd = mcpRemove ? `${sq(bin)} mcp remove ${sq(name)}`
        : mcpAdd[2] ? `${sq(bin)} mcp add --transport http ${sq(name)} ${sq(mcpAdd[2])}`
        : `${sq(bin)} mcp add ${sq(name)} -- ${mcpAdd[3].trim().split(/\s+/).map(sq).join(' ')}`;
      return runForSession(id, cmd, mcpRemove ? `Removed ${name} (claude mcp remove)` : `Added ${name} (claude mcp add)`, (code) => {
        if (code !== 0) return;
        if (owned.has(id)) {
          inbox.add(id, { who: 'note', text: `Claude Code starts again ${mcpRemove ? 'without' : 'with'} ${name}, same conversation${tracker.sessions.get(id) && tracker.sessions.get(id).state === 'working' ? ', once this turn is done' : ''}` });
          owned.reopen(id, [], sess.cwd, (done) => { if (done) inbox.add(id, { who: 'note', text: mcpRemove ? `${name} is gone` : `It can use ${name} now (/mcp says if it connects)` }); });
        } else inbox.add(id, { who: 'note', text: `Sessions started in ${path.basename(sess.cwd)} from now on ${mcpRemove ? 'won’t have' : 'have'} ${name}` });
      });
    }
    // "/doctor" and "/upgrade": Claude Code's own checkup and update
    // (`claude doctor`, `claude update`), run right there as a step.
    // ("/mcp" in a terminal's session: `claude mcp list`, its MCP servers
    // and whether they connect; in one Blaube started, its box shows them.)
    // ("/logout": `claude auth logout`, as the terminal's /logout.)
    const own = /^\/(doctor|upgrade|update|mcp|plugins?|logout)\s*$/i.exec(String(text).trim());
    if (own && sess && !id.startsWith('demo-') && !(own[1].toLowerCase() === 'mcp' && owned.has(id))) {
      const bin = owned.findClaude() || owned.shellPath() || 'claude';
      const q = process.platform === 'win32' ? `"${bin}"` : `'${bin.replace(/'/g, `'\\''`)}'`;
      const what = { doctor: ['doctor', 'Checked Claude Code (claude doctor)'], mcp: ['mcp list', 'Its MCP servers (claude mcp list)'], plugin: ['plugin list', 'Your plugins (claude plugin list)'], plugins: ['plugin list', 'Your plugins (claude plugin list)'], logout: ['auth logout', 'Signed Claude Code out (claude auth logout)'] }[own[1].toLowerCase()] || ['update', 'Updated Claude Code (claude update)'];
      return runForSession(id, `${q} ${what[0]}`, what[1], () => { if (what[0] === 'auth logout') checkAuth(true); });
    }
    if (own && owned.has(id)) {
      const list = mcpStates.get(id) || [];
      inbox.add(id, { who: 'note', text: list.length ? `Its MCP servers: ${list.map((m) => `${m.name} (${m.status === 'connected' ? 'connected' : m.status === 'needs-auth' ? 'needs you to sign in' : m.status === 'failed' ? 'couldn’t connect' : m.status === 'disabled' ? 'turned off' : m.status})`).join(' · ')}` : 'It has no MCP servers.' });
      askMcp(id);
      return;
    }
    // "/permissions": what it may do without asking; "allow Bash(npm
    // test:*)" adds a rule (this project, just you), "remove …" takes one back.
    const perm = /^\/(?:permissions|allowed-tools)(?:\s+(allow|add|remove)\s+(.+))?\s*$/i.exec(String(text).trim());
    if (perm && sess && sess.cwd && !id.startsWith('demo-')) {
      const st = gitStates.get(id);
      const root = (st && st.root) || sess.cwd;
      const list = permRules.list([sess.cwd, root]);
      const rule = perm[2] ? perm[2].trim() : '';
      if (!perm[1]) {
        inbox.add(id, { who: 'note', text: list.length
          ? `Allowed without asking: ${list.slice(0, 20).map((r) => `${permRules.label(r.rule)} (${r.scope.toLowerCase()})`).join(' · ')}. Add one with /permissions allow Bash(npm test:*), take one back with /permissions remove and the rule.`
          : 'It asks before everything that needs asking. Add a rule with /permissions allow Bash(npm test:*).' });
      } else if (/^(allow|add)$/i.test(perm[1])) {
        try {
          const added = permRules.add(path.join(root, '.claude', 'settings.local.json'), rule);
          inbox.add(id, { who: 'note', text: added ? `It may do this without asking now (this project, just you): ${permRules.label(rule)}` : `It could already: ${permRules.label(rule)}` });
        } catch (e) { inbox.add(id, { who: 'note', text: `Couldn’t add it: ${e.message}`, error: true }); }
      } else {
        const r = list.find((x) => x.rule === rule);
        if (r && permRules.remove(r.file, r.rule)) inbox.add(id, { who: 'note', text: `It asks first again before: ${permRules.label(r.rule)}` });
        else inbox.add(id, { who: 'note', text: `There’s no rule ${rule} to take back (/permissions lists them)`, error: true });
      }
      return;
    }
    // "/config" and "/hooks": your Claude Code settings file, opened in your
    // editor; "/agents": the project's own agents (.claude/agents).
    const cfg = /^\/(config|settings|hooks|agents)\s*$/i.exec(String(text).trim());
    if (cfg && sess && !id.startsWith('demo-')) {
      const st = gitStates.get(id);
      const root = (st && st.root) || sess.cwd;
      try {
        if (cfg[1].toLowerCase() === 'agents') {
          if (!root) return;
          const dir = path.join(root, '.claude', 'agents');
          const names = [dir, path.join(os.homedir(), '.claude', 'agents')].flatMap((d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)); } catch { return []; } });
          fs.mkdirSync(dir, { recursive: true });
          if (!TEST) shell.openPath(dir);
          inbox.add(id, { who: 'note', text: `${names.length ? `Its agents: ${[...new Set(names)].join(', ')}. ` : 'No agents of its own yet. '}Opened ${path.basename(root)}/.claude/agents: each .md there is one (a name, what it's for, its instructions).` });
        } else {
          const file = path.join(os.homedir(), '.claude', 'settings.json');
          if (!fs.existsSync(file) && !TEST) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}\n'); }
          if (!TEST) shell.openPath(file);
          inbox.add(id, { who: 'note', text: `Opened your Claude Code settings (~/.claude/settings.json)${cfg[1].toLowerCase() === 'hooks' ? ', where hooks go' : ''}` });
        }
      } catch (e) { inbox.add(id, { who: 'note', text: `Couldn’t open it: ${e.message}`, error: true }); }
      return;
    }
    // "/help": what works here, in words.
    if (/^\/help\s*$/i.test(String(text).trim())) {
      inbox.add(id, { who: 'note', text: `Talk to it as you would in its terminal. Start with ! to run a command here, # to remember something in CLAUDE.md, @ for its files, / for commands (each says what it does; /run dev runs its dev server)${owned.has(id) ? '' : '; the ones only its terminal can take go there, or bring it here and they go straight in'}. ${process.platform === 'darwin' ? '⌘0 shows every session, ⌘F finds things, ⌘S saves the conversation, ⌘. stops it' : 'Ctrl+0 shows every session, Ctrl+F finds things, Ctrl+S saves the conversation, Ctrl+. stops it'}.${owned.has(id) ? ' To go back, tap edit under something you said; undo all under a reply puts its files back.' : ''}` });
      return;
    }
    // "/rewind" (Esc Esc in the terminal), in a session Blaube started: it's
    // under each thing you said.
    if (/^\/rewind\s*$/i.test(String(text).trim()) && owned.has(id)) {
      inbox.add(id, { who: 'note', text: 'To go back, tap edit under something you said: its files are put back and the conversation goes back to before it. Undo all under a reply puts just its files back.' });
      return;
    }
    // "/todos": its to-do list, in full.
    if (/^\/todos\s*$/i.test(String(text).trim())) {
      const t = inbox.todos.get(id) || [];
      inbox.add(id, { who: 'note', text: t.length ? `Its to-do list: ${t.map((x) => `${x.status === 'completed' ? '✓' : x.status === 'in_progress' ? '→' : '○'} ${x.text || ''}`).join(' · ')}` : 'It has no to-do list right now' });
      return;
    }
    // "/release-notes": what's new in Claude Code, in your browser.
    if (/^\/release-notes\s*$/i.test(String(text).trim())) {
      if (!TEST) shell.openExternal('https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md');
      inbox.add(id, { who: 'note', text: 'Opened Claude Code’s release notes in your browser' });
      return;
    }
    // "/bug": a new Claude Code issue, in your browser, its version filled in.
    if (/^\/bug(\s|$)/i.test(String(text).trim())) {
      const bin = owned.findClaude() || owned.shellPath();
      const open = (version) => {
        const url = require('./commands').bugUrl(text, version);
        if (TEST) global.__blaubeBugUrl = url; else shell.openExternal(url);
        inbox.add(id, { who: 'note', text: 'Opened a new Claude Code issue in your browser, its version and system filled in' });
      };
      if (!bin) return open('');
      require('node:child_process').execFile(bin, ['--version'], { timeout: 8000, encoding: 'utf8', windowsHide: true }, (err, out) => open(err ? '' : String(out).trim().split(/\s/)[0]));
      return;
    }
    // "/exit" in a session Blaube started: it ends (its conversation is
    // kept, to pick up later).
    if (/^\/(exit|quit)\s*$/i.test(String(text).trim()) && owned.has(id)) {
      inbox.add(id, { who: 'note', text: 'Ended. Its conversation is kept: pick it up from the overview.' });
      owned.end(id);
      return;
    }
    // "/skills": the skills it can use (yours and the project's).
    if (/^\/skills\s*$/i.test(String(text).trim()) && sess) {
      const st = gitStates.get(id);
      const list = skillList((st && st.root) || sess.cwd);
      inbox.add(id, { who: 'note', text: list.length ? `Skills it can use: ${list.slice(0, 30).map((k) => `${k.name}${k.about ? ` (${k.about.length > 70 ? k.about.slice(0, 69) + '…' : k.about})` : ''}`).join(' · ')}. Ask for one by name, or it picks one when it fits.` : 'No skills of yours or this project’s (they go in .claude/skills).' });
      return;
    }
    // "/cost" in a terminal's session: what it has used, from its
    // transcript (one Blaube started asks Claude Code itself).
    if (/^\/cost\s*$/i.test(String(text).trim()) && sess && !owned.has(id) && !id.startsWith('demo-')) {
      const u = usage.sessionUsage(transcriptPath(sess));
      const turns = inbox.log(id).filter((e) => e.who === 'claude' && e.turn);
      const took = turns.reduce((n, e) => n + (e.turn.took || 0), 0);
      inbox.add(id, u ? { who: 'note', text: `It has used ${require('./commands').kTokens(u.total)} tokens (new input, cache writes and output, its helpers’ too)${u.context ? ` · its context is ${Math.round(100 * u.context / u.limit)}% full` : ''}${turns.length ? ` · ${turns.length} ${turns.length === 1 ? 'turn' : 'turns'} here, ${Math.max(1, Math.round(took / 60e3))}m working` : ''}` } : { who: 'note', text: 'Nothing to show yet: Claude Code hasn’t saved any of it.' });
      return;
    }
    // ... and in one Blaube started, Claude Code's own count (get_session_cost).
    if (/^\/cost\s*$/i.test(String(text).trim()) && owned.has(id)) {
      owned.control(id, { subtype: 'get_session_cost' }, (ok, r) => {
        const lines = ok && r && typeof r.text === 'string' ? r.text.split('\n').map((l) => l.replace(/:\s+/, ': ').trim()).filter(Boolean) : [];
        inbox.add(id, lines.length ? { who: 'note', text: lines.join(' · ') } : { who: 'note', text: `Couldn’t ask what it has used${ok ? '' : `: ${r}`}`, error: true });
      });
      return;
    }
    // Ones only the terminal itself has any use for.
    const termOnly = /^\/(vim|terminal-setup|statusline)\s*$/i.exec(String(text).trim());
    if (termOnly) { inbox.add(id, { who: 'note', text: `/${termOnly[1].toLowerCase()} is for Claude Code’s terminal screen; the box doesn’t need it.` }); return; }
    // "/export": the conversation as Markdown, to Downloads (as ⌘S).
    if (/^\/export\s*$/i.test(String(text).trim())) {
      const file = saveConversation(id);
      inbox.add(id, file ? { who: 'note', text: `Saved the conversation to ${path.basename(path.dirname(file))}/${path.basename(file)}`, file } : { who: 'note', text: 'Couldn’t save it', error: true });
      return;
    }
    // "/status": what it's running on, as Claude Code's /status says.
    if (/^\/status\s*$/i.test(String(text).trim()) && sess && !id.startsWith('demo-')) {
      const bin = owned.findClaude() || owned.shellPath();
      const say = (version, sections) => {
        const st = gitStates.get(id);
        const mode = { acceptEdits: 'accepting edits', plan: 'planning first', bypassPermissions: 'not asking', default: 'asking first' }[sess.mode || 'default'] || sess.mode;
        inbox.add(id, Object.assign(sections ? { sections } : {}, { who: 'note', text: [
          version ? `Claude Code ${version}` : '',
          modelName(pickedModel.get(id) || usage.sessionInfo(transcriptPath(sess)).model),
          mode,
          signedOutNow ? 'signed out' : '',
          sess.cwd ? `in ${sess.cwd.replace(os.homedir(), '~')}${st && st.branch ? ` (${st.branch})` : ''}` : '',
          owned.has(id) ? 'started by Blaube' : 'in a terminal',
        ].filter(Boolean).join(' · ') }));
      };
      // (One Blaube started: everything Claude Code's own /status says too,
      // a tap away: how it's signed in, its MCP servers, its settings.)
      if (owned.has(id)) {
        return owned.control(id, { subtype: 'get_status' }, (ok, r) => {
          const sections = ok && r && Array.isArray(r.sections) ? r.sections.slice(0, 12).map((x) => ({ title: String(x.title || '').slice(0, 60), rows: (Array.isArray(x.rows) ? x.rows : []).slice(0, 30).map((w) => ({ label: String(w.label || '').slice(0, 60), value: String(w.value == null ? '' : w.value).slice(0, 300) })) })).filter((x) => x.rows.length) : null;
          const v = sections && ((sections[0] || { rows: [] }).rows.find((w) => w.label === 'Version') || {}).value;
          if (v) return say(v, sections);
          if (!bin) return say('', sections);
          require('node:child_process').execFile(bin, ['--version'], { timeout: 8000, encoding: 'utf8', windowsHide: true }, (err, out) => say(err ? '' : String(out).trim().split(/\s/)[0], sections));
        });
      }
      if (!bin) return say('');
      require('node:child_process').execFile(bin, ['--version'], { timeout: 8000, encoding: 'utf8', windowsHide: true }, (err, out) => say(err ? '' : String(out).trim().split(/\s/)[0]));
      return;
    }
    // "/login": Claude Code signed in through your browser (see auth.js).
    if (/^\/login\s*$/i.test(String(text).trim())) {
      if (owned.findClaude() || owned.shellPath()) return signIn(id);
      inbox.add(id, { who: 'note', text: 'Blaube can’t find Claude Code to sign it in', error: true });
      return;
    }
    // "/usage": your usage limits, as Blaube last heard them.
    if (/^\/usage\s*$/i.test(String(text).trim())) {
      const line = limits.line(usageLimits);
      inbox.add(id, { who: 'note', text: line ? line.replace(/^Usage: /, 'Used: ') : 'Blaube hasn’t heard your usage limits yet (with an API key there are none). The overview shows them once it has.' });
      return;
    }
    // "# always use pnpm": remembered in its project's CLAUDE.md, as the
    // terminal's # does.
    const note = memory.noteIn(text);
    if (note && sess && sess.cwd) {
      const st = gitStates.get(id);
      try {
        const file = memory.remember((st && st.root) || sess.cwd, note);
        inbox.add(id, { who: 'note', text: `Remembered in ${path.basename(path.dirname(file))}/CLAUDE.md: ${note}`, file });
        tellNext(id, `I added this to ${file}, for you to keep in mind from now on: ${note}`); // (it read CLAUDE.md when it started)
      } catch (e) { inbox.add(id, { who: 'note', text: `Couldn’t write CLAUDE.md: ${e.message}`, error: true }); }
      return;
    }
    // One of your own commands (/deploy staging) is only a prompt: it goes
    // as a message, so it needs no terminal.
    const prompt = expandCommand(text, (tracker.sessions.get(id) || {}).cwd);
    if (prompt) { inbox.add(id, { who: 'note', text: `${String(text).trim().split(/\s/)[0]}: sent what it says` }); text = prompt; }
    // One of your skills by name (/release v2): Claude Code starts it itself
    // in a session Blaube started; a terminal's hears the same ask in words.
    if (!owned.has(id)) {
      const st = gitStates.get(id);
      const ask = sess && skillPrompt(text, (st && st.root) || sess.cwd);
      if (ask) { inbox.add(id, { who: 'note', text: `${String(text).trim().split(/\s/)[0]}: asked for that skill` }); text = ask; }
      const words = !ask && sess && require('./commands').askInWords(text);
      if (words) { inbox.add(id, { who: 'note', text: `${String(text).trim().split(/\s/)[0].toLowerCase()}: asked in words, as Claude Code’s command asks` }); text = words; }
    }
    // A session Blaube started: straight in, and its turn starts.
    if (owned.has(id)) {
      // "/btw what's the port?": a quick question on the side, as the
      // terminal's /btw: answered from the conversation so far, even while
      // it works, without becoming part of it.
      const btw = /^\/btw(?:\s+([\s\S]*))?$/i.exec(String(text).trim());
      if (btw) {
        const q = (btw[1] || '').trim();
        if (!q) { inbox.add(id, { who: 'note', text: 'Ask it something on the side: /btw what port does it run on?' }); return; }
        const asked = inbox.add(id, { who: 'note', text: `Asked on the side: ${q.length > 80 ? q.slice(0, 79) + '…' : q}` });
        owned.control(id, { subtype: 'side_question', question: q }, (ok, r) => {
          if (!ok || !r || typeof r.response !== 'string' || !r.response.trim()) { inbox.add(id, { who: 'note', text: `Couldn’t ask on the side: ${ok ? 'no answer' : r}`, error: true }); return; }
          Object.assign(asked, { aside: { question: q, answer: r.response }, text: `On the side: ${q} — ${r.response}` }); // (the line saying it asked becomes the answer)
          inbox.emit('change', id);
        }, 120e3);
        return;
      }
      // "/clear": a fresh conversation, as in the terminal: a new session in
      // the same place takes over its slime (the old one can be picked up).
      if (/^\/clear\s*$/i.test(String(text).trim())) {
        const to = owned.clear(id, sess && sess.cwd);
        const now = to && tracker.sessions.get(to);
        if (!now) return;
        Object.assign(now, { transcript: '', tasks: [], agents: [] });
        inbox.logs.set(to, []);
        inbox.todos.delete(to);
        for (const m of [mcpStates, foreground, pickedModel, shellRan, rewound]) m.delete(to);
        inbox.add(to, { who: 'note', text: 'Cleared: a fresh conversation. The last one is under Pick up where you left off.' });
        hubCache = null;
        pushState();
        return;
      }
      // "/add-dir ../api": another folder it may work in. Claude Code takes
      // that when it starts, so it's started again (same conversation).
      const addDir = /^\/add-dir(?:\s+(.+))?$/i.exec(String(text).trim());
      if (addDir) {
        const add = (dir) => {
          let full = dir.replace(/^~(?=$|[\\/])/, os.homedir());
          full = path.resolve((sess && sess.cwd) || os.homedir(), full);
          let ok = false;
          try { ok = fs.statSync(full).isDirectory(); } catch { /* not there */ }
          if (!ok) { inbox.add(id, { who: 'note', text: `There’s no folder at ${full}`, error: true }); return; }
          inbox.add(id, { who: 'note', text: `Adding ${path.basename(full)}: Claude Code starts again with it, same conversation${tracker.sessions.get(id) && tracker.sessions.get(id).state === 'working' ? ', once this turn is done' : ''}` });
          owned.reopen(id, ['--add-dir', full], sess && sess.cwd, (done) => inbox.add(id, done ? { who: 'note', text: `It can work in ${full} too` } : { who: 'note', text: 'It had stopped, so nothing was added', error: true }));
        };
        if (addDir[1]) add(addDir[1].trim().replace(/^["']|["']$/g, ''));
        else if (!TEST) dialog.showOpenDialog({ title: 'Another folder it may work in', defaultPath: (sess && sess.cwd) || undefined, properties: ['openDirectory'] }).then(({ canceled, filePaths }) => { if (!canceled && filePaths[0]) add(filePaths[0]); });
        return;
      }
      // (/model, /plan, /context and /effort are for Claude Code: it's asked directly.)
      const c = controlFor(text);
      if (c && c.help) { inbox.add(id, { who: 'note', text: c.help }); return; }
      if (c) {
        inbox.add(id, { who: 'you', text: String(text).trim(), via: 'blaube', status: 'sent' });
        owned.control(id, c.request, (ok, r) => {
          if (c.request.subtype === 'get_context_usage') {
            const n = ok && contextNote(r);
            inbox.add(id, n ? Object.assign({ who: 'note' }, n) : { who: 'note', text: `Couldn’t see its context: ${ok ? 'no answer' : r}`, error: true });
            return pushTalk(id);
          }
          if (c.request.subtype === 'apply_flag_settings') {
            const level = c.request.settings.effortLevel;
            if (ok) { efforts.set(id, level); pushState(); }
            inbox.add(id, { who: 'note', text: ok ? `Effort: ${level}` : `Couldn’t change its effort: ${r}`, error: !ok });
            return pushTalk(id);
          }
          const what = c.request.subtype === 'set_model' ? (ok ? `Now using ${modelName(r.model) || r.model || c.request.model}` : `Couldn’t switch to ${c.request.model}: ${r}`)
            : ok ? 'Plan mode: it shows you a plan before it changes anything' : `Couldn’t switch to plan mode: ${r}`;
          if (ok && c.request.mode) tracker.setMode(id, r.mode || c.request.mode);
          if (ok && r.model) pickedModel.set(id, r.model);
          inbox.add(id, { who: 'note', text: what });
          pushTalk(id);
        });
        return;
      }
      if (!slashCommand(text, (tracker.sessions.get(id) || {}).cwd)) text = withWhatYouRan(id, text);
      const uuid = require('node:crypto').randomUUID();
      if (!owned.send(id, text, uuid)) { inbox.add(id, { who: 'you', text: String(text), via: 'blaube', status: 'unsent' }); return; }
      inbox.say(id, text, uuid);
      tracker.handle({ session_id: id, hook_event_name: 'UserPromptSubmit' }, 'blaube');
      return;
    }
    // A slash command (/compact, /model...) is for Claude Code, not Claude:
    // typed into its terminal when it's free, if Blaube can; never sent as
    // a message.
    const slash = slashCommand(text, (tracker.sessions.get(id) || {}).cwd);
    if (slash) {
      const s = tracker.sessions.get(id);
      const cmd = String(text).trim();
      const typeable = process.platform === 'darwin' && !!s.pid && (s.term === 'Apple_Terminal' || s.term === 'iTerm.app');
      if (!typeable) return handOver(s, cmd);
      if (s.state === 'working' || s.state === 'waiting') { inbox.add(id, { who: 'note', text: `${cmd.split(/\s/)[0]} has to wait until it’s free. Send it again then.` }); return; }
      inbox.add(id, { who: 'you', text: cmd, via: 'blaube', status: 'sent' });
      typeIntoSession(s, cmd, (ok, why) => {
        log(`typed ${cmd.split(/\s/)[0]} into ${s.project}'s terminal: ${ok ? 'ok' : 'no (' + why + ')'}`);
        if (!ok) handOver(s, cmd);
        else inbox.typed.set(id, { text: cmd, entries: [] }); // its echo isn't logged twice
      });
      return;
    }
    const how = inbox.send(id, withWhatYouRan(id, text));
    log(`message for ${tracker.sessions.get(id).project}: ${how} (inbox ${inbox.view(id).inbox})`);
    setTimeout(() => typeQueued(id), 1500); // a moment for its inbox hook to ask first
  }
  // A message, with what you ran with ! since the last one ahead of it
  // (as the terminal's bash mode adds it to the conversation).
  function withWhatYouRan(id, text) {
    const put = rewound.get(id);
    rewound.delete(id);
    if (put) text = `(${put})\n\n${text}`;
    const ran = shellRan.get(id);
    if (!ran || !ran.length) return text;
    shellRan.delete(id);
    return ran.map((r) => `(I ran \`${r.cmd}\` myself${r.code === 0 ? '' : r.code == null ? ' (stopped: it took too long)' : ` (exit code ${r.code})`}. It printed:\n\`\`\`\n${r.out.slice(-3000) || '(nothing)'}\n\`\`\`)`).join('\n\n') + '\n\n' + text;
  }
  // (What you ran with ! in a session's box, for its next message.)
  // `as`: what to call it, for one of Claude Code's own (its output is for
  // you, so it doesn't go along with your next message).
  function runForSession(id, cmd, as = '', then = () => {}, env = null, timeout = 120e3) {
    const s = tracker.sessions.get(id);
    if (!s || !s.cwd || !cmd) return;
    const entry = inbox.add(id, { who: 'step', text: as || `You ran ${cmd.length > 60 ? cmd.slice(0, 59) + '…' : cmd}`, ok: true, kind: classify('Bash', { command: cmd }), detail: `$ ${cmd}\n…`, cmd: cmd.slice(0, 200), running: true });
    shellRun.run(cmd, s.cwd, (code, out) => {
      const shown = out.replace(/\s+$/, '');
      entry.ok = code === 0;
      entry.running = false;
      entry.detail = `$ ${cmd}\n${shown.length > 4000 ? '…' + shown.slice(-4000) : shown}${code == null ? '\n(stopped: it took over two minutes)' : ''}`;
      if (as) entry.text = `${as}${code === 0 ? '' : code == null ? ' (stopped)' : ' (failed)'}`;
      else {
        const list = shellRan.get(id) || [];
        list.push({ cmd, code, out: shown });
        shellRan.set(id, list.slice(-3));
      }
      inbox.emit('change', id);
      then(code, shown, entry);
    }, Object.assign({ timeout }, env ? { env } : {}));
    return entry;
  }
  replyTo = sendMessage;
  // Push and Pull from its quick actions: git itself, right there (a step
  // with what it printed; no model call). It never waits on a password.
  ipcMain.on('talk-git-run', (_e, id, run) => { if (id === talkId) gitRunFor(id, run); });
  function gitRunFor(id, run) {
    const s = tracker.sessions.get(id);
    const st = gitStates.get(id);
    const pr = prStates.get(id);
    const cmd = s && st && s.state !== 'working' && s.state !== 'waiting' && git.command(run, st, pr);
    if (!cmd) return;
    const as = run === 'push' ? `Pushed ${st.branch || 'it'}` : run === 'home' ? `Back on ${pr.base}, up to date, ${st.branch} deleted` : run === 'finish' ? (st.midway === 'rebase' ? 'Carried on with the rebase' : 'Finished the merge') : run === 'abort' ? `Called off the ${st.midway}: back to how it was before` : `Pulled into ${st.branch || 'it'}`;
    const entry = runForSession(id, cmd, as, (code) => {
      if (code === 0 && win) win.webContents.send('nod', id);
      if (code === 0 && run === 'push') pulls.forget(s.cwd, st.branch); // (its checks start again)
      if (code !== 0) entry.text = run === 'abort' ? `git couldn’t call off the ${st.midway} (tap for why); tapping it again asks Claude to` : run === 'finish' ? 'git couldn’t finish it (tap for why); tapping it again asks Claude to' : run === 'push' ? 'git couldn’t push (tap for why); Push again asks Claude to' : run === 'home' ? `git couldn’t do all of it (tap for why): ${st.branch} may still be there` : 'git couldn’t pull without a merge (tap for why); Pull again asks Claude to';
      if (run === 'home') { prStates.delete(id); pulls.forget(s.cwd, st.branch); }
      git.forget(s.cwd);
      git.status(s.cwd, (now) => {
        // (A rebase that stopped at its next conflict didn't fail: settle that one too.)
        if (code !== 0 && run === 'finish' && now && now.conflicts) { entry.text = `Stopped at the next conflict: settle it, then Continue the rebase again`; delete entry.gitRun; }
        gitStates.set(id, now);
        pushTalk(id);
      });
    }, { GIT_TERMINAL_PROMPT: '0' });
    if (entry) entry.gitRun = run;
  }
  // Install packages, from its quick actions: npm install (or pnpm, yarn,
  // bun, as its lockfile says) right there, a step, up to ten minutes.
  ipcMain.on('talk-install', (_e, id) => { if (id === talkId) installFor(id); });
  function installFor(id) {
    const s = tracker.sessions.get(id);
    const cmd = s && s.cwd && s.state !== 'working' && s.state !== 'waiting' && !installingPackages.has(id) && runs.needsInstall(s.cwd);
    if (!cmd) return;
    installingPackages.add(id);
    runForSession(id, cmd, `Installed its packages (${cmd})`, (code) => {
      installingPackages.delete(id);
      if (code === 0 && win) win.webContents.send('nod', id);
      pushTalk(id);
    }, null, 10 * 60e3);
    pushTalk(id);
  }
  // Make .env, from its quick actions: its template copied (never over a
  // .env that's there), and opened in your editor to fill in.
  ipcMain.on('talk-make-env', (_e, id) => { if (id === talkId) envFor(id); });
  function envFor(id) {
    const s = tracker.sessions.get(id);
    const from = s && s.cwd && runs.needsEnv(s.cwd);
    if (!from) return;
    try { fs.copyFileSync(path.join(s.cwd, from), path.join(s.cwd, '.env'), fs.constants.COPYFILE_EXCL); } catch (err) {
      inbox.add(id, { who: 'note', text: `Couldn’t make .env: ${err.code === 'EEXIST' ? 'it’s there already' : err.message}`, error: true });
      return pushTalk(id);
    }
    inbox.add(id, { who: 'note', text: `Made .env from ${from}: fill in its values${editorNow() ? ` (it’s open in ${editorNow().name})` : ''}` });
    openInEditor(id, '.env');
    pushTalk(id);
  }
  // A quick action from the menu bar, as a tap on it in the box would.
  doQuick = (id, q) => (q.run ? gitRunFor(id, q.run) : q.install ? installFor(id) : q.env ? envFor(id) : sendMessage(id, q.prompt));
  // Stops a background task: in a session Blaube started, asked of Claude
  // Code itself (stop_task); in a terminal's, the processes writing its
  // output (its own, under its claude process). false: the box asks Claude.
  ipcMain.handle('talk-stop-task', (_e, id, taskId) => new Promise((done) => {
    // (One of its scripts Blaube runs: Blaube stops it.)
    if (String(taskId).startsWith('run:')) return done(id === talkId && runs.list(id).some((r) => r.id === taskId) && runs.stop(taskId));
    const s = id === talkId && tracker.sessions.get(id);
    const t = s && (s.tasks || []).find((x) => x.id === taskId);
    if (!t) return done(false);
    if (!owned.has(id)) {
      const file = taskOutput.find(id, taskId);
      if (!file || !s.pid) return done(false);
      return taskKill.stop(file, s.pid, (n) => {
        log(`stop task ${taskId} directly: ${n} processes`);
        if (!n) return done(false);
        endedTasks.add(`${id}/${taskId}`); // (its ending is no news)
        tracker.handleTask(s, { hook_event_name: 'PreToolUse', tool_name: 'KillShell', tool_input: { shell_id: taskId } });
        inbox.add(id, { who: 'note', text: `Stopped ${t.description || t.command}` });
        pushState();
        done(true);
      });
    }
    owned.control(id, { subtype: 'stop_task', task_id: taskId }, (ok, r) => {
      log(`stop task ${taskId}: ${ok ? 'ok' : r}`);
      if (!ok) return done(false);
      const cur = tracker.sessions.get(id);
      if (cur) tracker.handleTask(cur, { hook_event_name: 'PreToolUse', tool_name: 'KillShell', tool_input: { shell_id: taskId } });
      inbox.add(id, { who: 'note', text: `Stopped ${t.description || t.command}` });
      pushState();
      done(true);
    });
  }));
  ipcMain.on('talk-stop', (_e, id) => {
    if (!id || id !== talkId || !tracker.sessions.has(id)) return;
    const asked = inbox.stop(id);
    // One Blaube started stops right away, even mid-sentence.
    if (owned.has(id)) {
      if (!asked && !inbox.stops.has(id)) inbox.add(id, { who: 'note', text: 'You asked it to stop', stop: true });
      owned.control(id, { subtype: 'interrupt' }, (ok, r) => log(`interrupt ${id}: ${ok ? 'ok' : r}`));
    }
    log(`stop ${tracker.sessions.get(id).project}: ${owned.has(id) ? 'now' : asked ? 'at its next step' : 'can\'t'}`);
    pushTalk(id); // (refused: the button comes back)
  });
  // An image pasted into the talk box: saved where Claude can open it.
  ipcMain.handle('talk-paste', (_e, id, bytes, type) => {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[type];
    if (!id || id !== talkId || !ext || !(bytes instanceof Uint8Array) || bytes.length > 20e6) return '';
    try {
      const dir = path.join(app.getPath('temp'), 'blaube-pastes');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
      fs.writeFileSync(file, bytes);
      return file;
    } catch { return ''; }
  });
  // What's waiting for you on GitHub (gh search): issues assigned to you,
  // reviews asked of you. A tap starts a session on one (talk-issue).
  ipcMain.handle('talk-github-todo', () => new Promise((done) => {
    const bin = (TEST ? global.__blaubeGh : pulls.findGh()) || ''; // (tests: a stand-in, never the real gh)
    require('./ghTodo').look((list) => done(list.map((x) => ({ kind: x.kind, number: x.number, title: x.title, url: x.url, repo: x.repo, when: x.at ? history.ago(x.at) : '' }))), { bin, fresh: TEST ? 0 : 5 * 60e3 });
  }));
  // The overview's lower half: folders to start a session in, and recent
  // past sessions to pick up (read only when the overview opens).
  ipcMain.handle('talk-hub', () => {
    probeUsage();
    checkAuth();
    // (Looking through past transcripts is slow-ish: at most every 30 s.)
    if (hubCache && Date.now() - hubCache.at < 30000) return hubCache.hub;
    const live = tracker.list();
    const folders = [...new Set([...(prefs.recentFolders || []), ...live.map((o) => o.cwd).filter(Boolean)])]
      .filter((f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } }).slice(0, 5);
    let past = [];
    try { past = history.pastSessions(new Set(live.map((o) => o.id)), 3); } catch { /* none */ }
    hubPast = past;
    hubFolders = folders;
    const models = prefs.models && prefs.models.length ? prefs.models : [{ value: 'default', displayName: 'Default' }, { value: 'opus', displayName: 'Opus' }, { value: 'sonnet', displayName: 'Sonnet' }, { value: 'haiku', displayName: 'Haiku' }];
    const hub = { models, folders: folders.map((f) => ({ path: f, name: path.basename(f) })), past: past.map((p) => ({ id: p.id, title: p.title, where: `${path.basename(p.cwd)} · ${history.ago(p.at)}` })) };
    hubCache = { at: Date.now(), hub };
    return hub;
  });
  // Only a folder the overview offered, and only if it's still there.
  ipcMain.on('talk-new', (_e, folder, opts) => {
    const model = opts && typeof opts.model === 'string' && /^[\w.\-[\]]{1,60}$/.test(opts.model) && opts.model !== 'default' ? opts.model : '';
    const extra = [...(opts && opts.plan === true ? ['--permission-mode', 'plan'] : []), ...(opts && opts.worktree === true ? ['--worktree'] : []), ...(model ? ['--model', model] : [])]; // (Plan first, Own worktree, its model)
    if (folder === 'pick') return newSession(extra);
    if (!hubFolders.includes(folder)) return;
    try { if (!fs.statSync(folder).isDirectory()) return; } catch { hubCache = null; return; }
    hideTalk();
    startSession(folder, extra);
  });
  // "Clone a repository…": git clone next to your other projects, then a
  // session in it. Resolves with '' when it's started, or why not.
  const projectsDir = () => { const docs = path.join(os.homedir(), 'Documents'); return (TEST && global.__blaubeCloneParent) || (hubFolders[0] ? path.dirname(hubFolders[0]) : fs.existsSync(docs) ? docs : os.homedir()); };
  const startNew = (dest, opts) => {
    const model = opts && typeof opts.model === 'string' && /^[\w.\-[\]]{1,60}$/.test(opts.model) && opts.model !== 'default' ? opts.model : '';
    hubCache = null;
    hideTalk();
    return startSession(dest, [...(opts && opts.plan === true ? ['--permission-mode', 'plan'] : []), ...(model ? ['--model', model] : [])]);
  };
  // "Work on an issue…": a GitHub issue's link (or owner/repo#42). A
  // session starts in your clone of its repository (cloned first if you
  // have none) and is asked to read the issue and fix it.
  ipcMain.handle('talk-issue', (_e, text, opts) => new Promise((done) => workOn(text, opts, done)));
  function workOn(text, opts, done) {
    const r = cloner.issue(text);
    if (!r) return done('Paste the issue’s or pull request’s link, or owner/repo#42');
    const go = (dest) => {
      const id = startNew(dest, opts);
      if (id && r.pr && opts && opts.mine === true) sendMessage(id, `Get my GitHub pull request ${r.gh}#${r.number} ready to merge. Check it out (\`gh pr checkout ${r.number}\`), see how its checks are doing (\`gh pr checks ${r.number}\`) and what reviewers said (\`gh pr view ${r.number} --comments\`). Fix what's needed, push, and tell me what you did and anything left for me.`);
      else if (id && r.pr) sendMessage(id, `Review GitHub pull request ${r.gh}#${r.number}. Check it out (\`gh pr checkout ${r.number}\`) and read it with its comments (\`gh pr view ${r.number} --comments\`). Then tell me what it does, whether it's correct, and any bugs, risks or missing tests, each with its file and line. Don't push or comment on GitHub.`);
      else if (id) sendMessage(id, `Work on GitHub issue ${r.gh}#${r.number}. Read it first, with its comments (\`gh issue view ${r.number} --repo ${r.gh} --comments\`). Then make a branch for it, fix it, and tell me what you changed. If it's unclear or big, tell me your plan before changing anything.`);
      done('');
    };
    const places = [...(prefs.recentFolders || []), ...tracker.list().map((o) => o.cwd), ...hubFolders];
    cloner.findRepo(places, r.gh, (found) => {
      if (found) return go(found);
      const dest = cloner.destFor(projectsDir(), r.name);
      if (!dest) return done(`There’s no free folder name for ${r.name} in ${projectsDir()}`);
      cloner.clone(r.url, dest, (err) => (err ? done(`Couldn’t clone ${r.gh}: ${err}`) : go(dest)), { gh: r.gh });
    });
  }
  // Something new for you on GitHub (a review asked of you, an issue given
  // you), looked for every five minutes: a notification, with a button to
  // start a session on it. What was there when Blaube started isn't news.
  let ghSeen = null;
  setInterval(() => {
    const bin = (TEST ? global.__blaubeGh : pulls.findGh()) || ''; // (tests: a stand-in, never the real gh)
    if (!bin) return;
    require('./ghTodo').look((list) => {
      if (ghSeen) for (const x of list) if (!ghSeen.has(x.url) && x.kind !== 'mine') newOnGitHub(x); // (your own new PR isn't news)
      ghSeen = new Set([...(ghSeen || []), ...list.map((x) => x.url)]);
    }, { bin, fresh: TEST ? 0 : 5 * 60e3 });
  }, TEST ? 1000 : 5 * 60e3).unref();
  function newOnGitHub(x) {
    const title = x.kind === 'review' ? `${x.repo}#${x.number} wants your review` : `${x.repo}#${x.number} is yours now`;
    const button = x.kind === 'review' ? 'Review it' : 'Start on it';
    if (TEST) { global.__blaubeGhNews = { title, body: x.title, button, start: () => workOn(x.url, {}, () => {}) }; return; }
    if (!Notification.isSupported() || (prefs.config.notify || 'Behind windows') === 'Off') return;
    const note = new Notification({ title, body: x.title, actions: [{ type: 'button', text: button }] });
    note.on('action', () => { shown.delete(note); workOn(x.url, {}, (err) => { if (err) log(`github: ${err}`); }); });
    note.on('click', () => { shown.delete(note); shell.openExternal(x.url); });
    note.on('close', () => shown.delete(note));
    shown.add(note);
    note.show();
  }
  // "New project…": a folder of its own next to your others, then a session in it.
  ipcMain.handle('talk-new-project', (_e, name, opts) => new Promise((done) => {
    cloner.newProject(projectsDir(), name, (err, dest) => { if (err) return done(err); startNew(dest, opts); done(''); });
  }));
  ipcMain.handle('talk-clone', (_e, text, opts) => new Promise((done) => {
    const r = cloner.parse(text);
    if (!r) return done('That doesn’t look like a repository: paste its address, or owner/repo for GitHub');
    const parent = projectsDir();
    const dest = cloner.destFor(parent, r.name);
    if (!dest) return done(`There’s no free folder name for ${r.name} in ${parent}`);
    cloner.clone(r.url, dest, (err) => {
      if (err) return done(`Couldn’t clone it: ${err}`);
      startNew(dest, opts);
      done('');
    }, { gh: r.gh || '' });
  }));
  // 📎 in the box: files to go with the next message (the box stays open
  // while you pick).
  ipcMain.handle('talk-attach', async (_e, id) => {
    const s = id === talkId && tracker.sessions.get(id);
    if (!s || TEST) return [];
    talkPicking = true;
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({ title: `Files for ${s.project}`, defaultPath: s.cwd || undefined, properties: ['openFile', 'multiSelections'] });
      return canceled ? [] : filePaths.slice(0, 20);
    } finally {
      talkPicking = false;
      if (talkWin && talkWin.isVisible()) talkWin.focus();
    }
  });
  // What was said before the box's own log, from its transcript.
  ipcMain.handle('talk-earlier', (_e, id) => {
    const s = id === talkId && tracker.sessions.get(id);
    const file = s && !id.startsWith('demo-') && transcriptPath(s);
    if (!file) return [];
    const first = inbox.log(id).find((e) => e.at);
    try { return history.messagesBefore(file, first ? first.at : Date.now(), 30); } catch { return []; }
  });
  // One changed file's diff, for the git line's file list.
  ipcMain.handle('talk-diff', (_e, id, file) => new Promise((done) => {
    const st = gitStates.get(id);
    const f = id === talkId && st && st.root && st.files.find((x) => path.join(st.root, x.path) === file);
    if (!f || f.how === 'deleted') return done('');
    git.diff(st.root, f.path, f.how, done);
  }));
  // Discard: a file's changes go (into git's stash, so Put back can bring
  // them back), not while it's working (it may be changing it).
  ipcMain.handle('talk-discard', (_e, id, file) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    const st = gitStates.get(id);
    const f = s && st && st.root && st.files.find((x) => path.join(st.root, x.path) === file);
    if (!f) return done('Can’t discard that one');
    if (s.state === 'working' || s.state === 'waiting') return done('Not while it’s working: wait for it to finish');
    git.discard(st.root, f.path, f.how, (err) => {
      if (err) { inbox.add(id, { who: 'note', text: `Couldn’t discard ${f.path}: ${err}` }); return done(err); }
      discarded.set(id, { root: st.root, rel: f.path });
      inbox.add(id, { who: 'note', text: `Discarded your changes to ${f.path} (Put back, under its git line, brings them back)` });
      git.forget(s.cwd);
      git.status(s.cwd, (now) => { gitStates.set(id, now); pushTalk(id); });
      done('');
    });
  }));
  // A file in conflict, settled from its box: your version or theirs.
  ipcMain.handle('talk-settle', (_e, id, file, side) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    const st = gitStates.get(id);
    const f = s && st && st.root && st.files.find((x) => x.how === 'conflict' && path.join(st.root, x.path) === file);
    if (!f) return done('Can’t settle that one');
    if (s.state === 'working' || s.state === 'waiting') return done('Not while it’s working: wait for it to finish');
    git.settle(st.root, f.path, side, (err) => {
      if (err) { inbox.add(id, { who: 'note', text: `Couldn’t settle ${f.path}: ${err}` }); return done(err); }
      git.status(s.cwd, (now) => {
        const left = now ? now.conflicts : 0;
        inbox.add(id, { who: 'note', text: `Kept ${side === 'mine' ? 'your' : 'their'} version of ${f.path}${left ? ` (${left} more in conflict)` : `: no conflicts left, ${now && now.midway === 'rebase' ? 'Continue the rebase' : 'Finish the merge'} finishes it`}` });
        gitStates.set(id, now);
        pushTalk(id);
        done('');
      });
    });
  }));
  ipcMain.handle('talk-put-back', (_e, id) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    const d = discarded.get(id);
    if (!s || !d) return done('Nothing to put back');
    git.putBack(d.root, d.rel, (err) => {
      discarded.delete(id);
      inbox.add(id, { who: 'note', text: err ? `Couldn’t put back ${d.rel}: ${err}` : `Put back your changes to ${d.rel}` });
      git.forget(s.cwd);
      git.status(s.cwd, (now) => { gitStates.set(id, now); pushTalk(id); });
      done(err);
    });
  }));
  // The git line's branches: which there are, and switching (or making a
  // new one) while it isn't busy and nothing tracked is changed.
  ipcMain.handle('talk-branches', (_e, id) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    if (!s || !s.cwd || id.startsWith('demo-')) return done([]);
    git.branches(s.cwd, done);
  }));
  // The branches with changes set aside on them (see talk-switch-branch).
  ipcMain.handle('talk-parked', (_e, id) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    if (!s || !s.cwd || id.startsWith('demo-')) return done([]);
    git.parked(s.cwd, done);
  }));
  // What its branch changed since it left main (all of it, to look over
  // before a pull request), and one file's change.
  const branchSeen = new Map(); // id -> its last branchChanges
  ipcMain.handle('talk-branch-changes', (_e, id) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    const st = gitStates.get(id);
    if (!s || !s.cwd || !st || !st.branch) return done(null);
    git.branchChanges(s.cwd, st.branch, (ch) => { if (ch) branchSeen.set(id, ch); else branchSeen.delete(id); while (branchSeen.size > 20) branchSeen.delete(branchSeen.keys().next().value); done(ch); });
  }));
  ipcMain.handle('talk-branch-diff', (_e, id, rel) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    const ch = branchSeen.get(id);
    const f = s && ch && ch.files.find((x) => x.path === rel);
    if (!f || f.how === 'deleted') return done('');
    git.branchDiff((gitStates.get(id) || {}).root || s.cwd, ch.base, f.path, done);
  }));
  // Its latest commits (which aren't pushed yet), and what one changed.
  ipcMain.handle('talk-commits', (_e, id) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    if (!s || !s.cwd || id.startsWith('demo-')) return done([]);
    const st = gitStates.get(id);
    git.commits(s.cwd, (list) => {
      const out = list.map((c, i) => Object.assign(c, { when: history.ago(c.at), unpushed: !!(st && st.upstream && i < st.ahead) }));
      // (The newest, if it's pushed nowhere: Undo takes it back.)
      if (!out.length || s.state === 'working' || s.state === 'waiting') return done(out);
      git.canUndo(s.cwd, out[0].hash, (ok) => { out[0].undoable = ok; done(out); });
    });
  }));
  // Undo on its newest commit: taken back, its changes kept, uncommitted.
  ipcMain.handle('talk-undo-commit', (_e, id, hash) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    if (!s || !s.cwd) return done('Can’t undo that one');
    if (s.state === 'working' || s.state === 'waiting') return done('Not while it’s working: wait for it to finish');
    git.commits(s.cwd, (list) => {
      const c = list[0];
      if (!c || c.hash !== hash) return done('It isn’t the newest commit any more');
      git.undoCommit(s.cwd, hash, (err) => {
        inbox.add(id, err ? { who: 'note', text: `Couldn’t undo “${c.subject}”: ${err}` } : { who: 'note', text: `Undid the commit “${c.subject}”: its changes are back, not committed (it’s still in git reflog, ${c.short})` });
        git.status(s.cwd, (now) => { gitStates.set(id, now); pushTalk(id); });
        done(err);
      });
    }, 1);
  }));
  ipcMain.handle('talk-commit', (_e, id, hash) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    if (!s || !s.cwd) return done('');
    git.show(s.cwd, hash, done);
  }));
  // (A new branch takes its changes along; switching to another sets them
  // aside on this one, to come back when you switch back: git's stash.)
  ipcMain.handle('talk-switch-branch', (_e, id, name, create) => new Promise((done) => {
    const s = id === talkId && tracker.sessions.get(id);
    const st = gitStates.get(id);
    if (!s || !s.cwd || !st) return done('It isn’t in a git repository');
    if (s.state === 'working' || s.state === 'waiting') return done('Not while it’s working: wait for it to finish');
    const from = st.branch, parking = !create && st.changed > 0 && !st.conflicts;
    if (!create && st.conflicts) return done('It’s in the middle of a merge: sort out the conflicts first');
    const go = () => git.switchTo(s.cwd, name, !!create, (err) => {
      if (err) {
        // (Couldn't switch: its changes come straight back.)
        if (parking) git.unpark(s.cwd, from, () => git.status(s.cwd, (now) => { gitStates.set(id, now); pushTalk(id); }));
        return done(err);
      }
      if (win) win.webContents.send('nod', id);
      const b = git.branchName(name);
      inbox.add(id, { who: 'note', text: create ? `Made a new branch, ${b}, and switched to it` : parking ? `Switched to ${b}; your changes on ${from} are set aside until you switch back to it` : `Switched to ${b}` });
      const after = () => git.status(s.cwd, (now) => { gitStates.set(id, now); pushTalk(id); });
      if (create) { after(); return done(''); }
      // (Changes set aside on the one it's back on: they come back.)
      git.unpark(s.cwd, b, (e2, found) => {
        if (found) inbox.add(id, { who: 'note', text: e2 ? `Couldn’t bring back your changes on ${b}: ${e2} (they’re in git stash)` : `Brought back your changes on ${b}` });
        after();
        done('');
      });
    });
    if (!parking) return go();
    git.park(s.cwd, from, (err) => (err ? done(err) : go()));
  }));
  // ⌘F in the overview: what every session said.
  // Files named in its replies: which are real (they become tappable), and
  // one's start, to read right in the box.
  ipcMain.handle('talk-files-exist', (_e, id, paths) => {
    if (!id || id !== talkId || !Array.isArray(paths)) return [];
    return paths.slice(0, 40).filter((p) => sessionFile(id, p));
  });
  const PEEK = 64 << 10;
  ipcMain.on('talk-open-editor', (_e, id, rel, line) => { if (id === talkId && typeof rel === 'string') openInEditor(id, rel, line); });
  ipcMain.handle('talk-peek', (_e, id, rel) => {
    const file = id === talkId ? sessionFile(id, rel) : '';
    if (!file) return null;
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, PEEK));
      fs.readSync(fd, buf, 0, buf.length, 0);
      if (buf.subarray(0, 8000).includes(0)) return { path: file, name: rel, text: '(not text)', cut: false };
      return { path: file, name: rel, text: buf.toString('utf8').replace(/\n$/, ''), cut: size > PEEK };
    } catch { return null; } finally { if (fd != null) fs.closeSync(fd); }
  });
  // How a session Blaube started asks before it acts (⇧⇥ in its box).
  const MODES = new Set(['default', 'acceptEdits', 'plan']);
  ipcMain.on('talk-mode', (_e, id, mode) => {
    if (!id || id !== talkId || !owned.has(id) || !MODES.has(mode)) return;
    owned.control(id, { subtype: 'set_permission_mode', mode }, (ok, r) => {
      if (!ok) { inbox.add(id, { who: 'note', text: `Couldn’t change how it asks: ${r}` }); return; }
      tracker.setMode(id, r.mode || mode); // (shown under its field)
    });
  });
  // "@" and "/" in the box: the session's files, and the commands you could type.
  // The models a session Blaube started can switch to, asked of its Claude
  // Code (list_models) once.
  const modelLists = new Map(); // id -> [{ value, displayName, description }]
  function modelsFor(id, cb) {
    if (!owned.has(id)) return cb([]);
    if (modelLists.has(id)) return cb(modelLists.get(id));
    owned.control(id, { subtype: 'list_models' }, (ok, r) => {
      const list = ok && r && Array.isArray(r.models) ? r.models.filter((m) => m && typeof m.value === 'string').map((m) => ({ value: m.value, displayName: String(m.displayName || m.value), description: String(m.description || '') })) : [];
      if (list.length) modelLists.set(id, list);
      // (Kept, for choosing a model for a new session.)
      const keep = list.slice(0, 8).map((m) => ({ value: m.value, displayName: m.displayName }));
      if (keep.length && JSON.stringify(keep) !== JSON.stringify(prefs.models || [])) { prefs.models = keep; savePrefs(); hubCache = null; }
      cb(list);
    });
  }
  owned.on('exit', (id) => modelLists.delete(id));
  ipcMain.handle('talk-complete', (_e, id, kind, q) => new Promise((resolve) => {
    const s = id === talkId && tracker.sessions.get(id);
    q = typeof q === 'string' ? q.slice(0, 200) : '';
    if (!s || !s.cwd || id.startsWith('demo-')) return resolve([]);
    if (kind === 'command') return resolve(commandNames(q, s.cwd).slice(0, 8).map((c) => ({ insert: '/' + c.name + ' ', label: '/' + c.name, about: c.about || '' })));
    if (kind === 'script') return resolve(s && s.cwd ? runs.scripts(s.cwd).filter((x) => x.name.startsWith(q)).slice(0, 8).map((x) => ({ insert: x.name, label: x.name, about: x.long ? `${x.command}, kept running` : x.command })) : []);
    if (kind === 'effort') return resolve(owned.has(id) ? EFFORTS.filter((e) => e.startsWith(q.toLowerCase())).map((e) => ({ insert: e, label: e, about: e === (efforts.get(id) || '') ? 'now' : '' })) : []);
    if (kind === 'model') return modelsFor(id, (models) => {
      const want = q.toLowerCase();
      resolve(models.filter((m) => !want || m.value.toLowerCase().startsWith(want) || m.displayName.toLowerCase().startsWith(want)).slice(0, 8)
        .map((m) => ({ insert: m.value, label: m.value, about: m.description || m.displayName })));
    });
    if (kind !== 'file') return resolve([]);
    projectFiles.list(s.cwd, (all) => resolve(projectFiles.match(all, q).map((p) => ({ insert: '@' + p + ' ', label: p, about: '' }))));
  }));
  ipcMain.handle('talk-search', (_e, q) => attention.search(tracker.list().filter(isReady).filter((o) => !o.id.startsWith('demo-')).map((o) => ({ id: o.id, project: o.project, log: inbox.log(o.id) })), typeof q === 'string' ? q.slice(0, 200) : '').slice(0, 10));
  // A session that ended while its box was open, picked up right there.
  ipcMain.on('talk-continue', (_e, id) => {
    const last = talkLast && talkLast.id === id ? talkLast : null;
    if (!last || id !== talkId || tracker.sessions.has(id) || owned.has(id) || !last.cwd || last.demo) return;
    hideTalk();
    pickUp({ id, cwd: last.cwd, at: 0, title: last.project, file: null });
  });
  ipcMain.on('talk-bring', (_e, id) => { const s = id === talkId && tracker.sessions.get(id); if (canBringIn(s)) bringIn(s); });
  ipcMain.on('talk-pickup', (_e, id) => { const p = hubPast.find((x) => x.id === id) || pastHits.find((x) => x.id === id); if (p) { hubCache = null; hideTalk(); pickUp(p); } });
  // ⌘F in the overview also looks through past sessions, to pick one up.
  let pastHits = [];
  ipcMain.handle('talk-search-past', async (_e, q) => {
    let found = [];
    try { found = await history.searchPast(typeof q === 'string' ? q.slice(0, 200) : '', new Set(tracker.list().map((o) => o.id).concat(owned.list()))); } catch { /* none */ }
    pastHits = found;
    return found.map((p) => ({ id: p.id, title: p.title, where: `${path.basename(p.cwd)} · ${history.ago(p.at)}`, hits: p.hits, snippet: p.snippet }));
  });
  // A web link in a reply, opened in your browser (web links only).
  ipcMain.on('talk-link', (_e, url) => {
    let u = null;
    try { u = new URL(String(url)); } catch { return; }
    if ((u.protocol === 'https:' || u.protocol === 'http:') && !TEST) shell.openExternal(u.href);
  });
  ipcMain.on('talk-copy', (_e, text) => { if (typeof text === 'string' && text.length < 1e6) clipboard.writeText(text); });
  ipcMain.handle('talk-save', (_e, id) => (id && id === talkId ? saveConversation(id) : ''));
  ipcMain.on('talk-copy-all', (_e, id) => { if (id && id === talkId) clipboard.writeText(conversationMarkdown(id)); });
  ipcMain.on('talk-show-file', (_e, file) => { if (typeof file === 'string' && path.dirname(file) === app.getPath('downloads') && /\.md$/.test(file)) shell.showItemInFolder(file); });
  // A changed file dragged out of the box, into another app (only files its
  // steps named, as for revealing them).
  ipcMain.on('talk-drag', (e, id, file) => {
    if (!id || id !== talkId || typeof file !== 'string' || !path.isAbsolute(file)) return;
    if (!inbox.log(id).some((x) => x.who === 'step' && x.file === file)) return;
    try { if (!fs.statSync(file).isFile()) return; } catch { return; }
    e.sender.startDrag({ file, icon: nativeImage.createFromPath(path.join(ASSETS, 'icon.png')).resize({ width: 32, height: 32 }) });
  });
  // An image a step looked at, shown in its box (only images its steps named).
  ipcMain.handle('talk-image', (_e, id, file) => {
    if (!id || id !== talkId || typeof file !== 'string' || !path.isAbsolute(file) || !/\.(png|jpe?g|gif|webp)$/i.test(file)) return null;
    if (!inbox.log(id).some((x) => x.who === 'step' && x.file === file)) return null;
    let size = 0;
    try { size = fs.statSync(file).size; } catch { return null; }
    // (Small ones as they are, so a GIF still moves; big ones made smaller.)
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[path.extname(file).slice(1).toLowerCase()];
    if (size <= 4e6) { try { return { url: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` }; } catch { return null; } }
    if (size > 30e6) return null;
    let img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return null;
    const { width } = img.getSize();
    if (width > 800) img = img.resize({ width: 800, quality: 'good' });
    return { url: img.toDataURL() };
  });
  // A file a turn changed, shown in Finder (never opened: it could be a program).
  ipcMain.on('talk-reveal', (_e, id, file) => {
    if (!id || id !== talkId || typeof file !== 'string' || !path.isAbsolute(file)) return;
    // (Only files its steps named, git says are changed, or in its folder.)
    if (!inbox.log(id).some((e) => e.who === 'step' && e.file === file) && !gitFiles(id).some((f) => f.path === file) && sessionFile(id, file) !== file) return;
    try { if (fs.statSync(file).isFile()) shell.showItemInFolder(file); } catch { /* gone */ }
  });
  // Another slime picked in the box (its dot, or a shortcut).
  ipcMain.on('talk-switch', (_e, id) => { if (id && id !== talkId && tracker.sessions.has(id) && win) win.webContents.send('open-talk', id); });
  ipcMain.on('talk-unsend', (_e, id, n) => { if (id && id === talkId) inbox.unsend(id, n); });
  ipcMain.on('talk-close', () => hideTalk());
  // It's shrinking shut: the tail goes first.
  ipcMain.on('talk-closing', () => { if (win) win.webContents.send('talk-rect', null); });
  // The slime moved: the box follows it.
  ipcMain.on('talk-at', (_e, id, at) => {
    if (id !== talkId || !talkWin || !talkWin.isVisible() || !at) return;
    const wb = win.getBounds();
    talkSpot = { x: wb.x + at.x, y: wb.y + at.y, r: at.r };
    placeTalkWin();
  });
  // The box grew or shrank to fit what's in it (its first measurement is
  // what it opens at).
  ipcMain.on('talk-height', (_e, id, h) => {
    if (!id || id !== talkId) return;
    // A question or plan may need more room than a chat; the screen decides.
    const max = inbox.asks.has(id) ? 900 : TALK_MAX_H;
    const next = Math.round(Math.max(TALK_MIN_H, Math.min(max, Number(h) || talkH())));
    const changed = next !== talkHeights.get(id);
    talkHeights.set(id, next);
    if (talkReady) { const show = talkReady; talkReady = null; show(); return; }
    if (changed && talkWin && talkWin.isVisible()) placeTalkWin();
  });
  // If it wasn't decided (gone already, another session), the box is told
  // again what's really waiting.
  // Allow or Deny from the overview, for any session.
  ipcMain.on('talk-answer', (_e, id, key, choice) => {
    if (typeof id !== 'string' || !tracker.sessions.has(id) || (choice !== 'allow' && choice !== 'deny')) return;
    if (!inbox.decide(id, key, choice)) pushTalk(talkId);
  });
  ipcMain.on('talk-permission', (_e, id, key, choice, answers) => {
    if (id && id === talkId && inbox.decide(id, key, choice, answers)) return;
    if (talkWin) talkWin.webContents.send('talk-refused', key);
    pushTalk(talkId);
  });
  ipcMain.on('talk-terminal', () => {
    const s = talkId && tracker.sessions.get(talkId);
    hideTalk();
    if (s && !s.id.startsWith('demo-')) goToSession(s);
  });
  ipcMain.on('app-menu', () => appMenu().popup({ window: win }));
  ipcMain.on('session-menu', (_e, id) => {
    const m = sessionMenu(id);
    if (m) m.popup({ window: win });
  });

  if (process.env.BLAUBE_DEMO) runDemo();
  if (TEST) {
    const run = require(path.resolve(TEST));
    Promise.resolve(run({ app, win, tracker, inbox, owned, startSession, PORT, talk: () => talkWin, talkId: () => talkId, log }))
      .then((code) => app.exit(code || 0), (e) => { console.error(e); app.exit(1); });
  }
});

app.on('second-instance', () => send('come-here'));
app.on('window-all-closed', () => app.quit());
// Messages still waiting to go in would be lost: ask first.
let quitAnyway = false;
app.on('before-quit', (e) => {
  const waiting = [...inbox.queue.values()].reduce((n, q) => n + q.length, 0);
  const mine = owned.list().length;
  if (TEST || quitAnyway || (!waiting && !mine)) return;
  e.preventDefault();
  const lines = [];
  if (mine) lines.push(mine === 1 ? 'A session you started in Blaube will stop, unless you move it to a terminal, where it carries on with its conversation.' : `${mine} sessions you started in Blaube will stop, unless you move them to terminals, where each carries on with its conversation.`);
  if (waiting) lines.push(waiting === 1 ? 'A message hasn’t gone in yet and won’t be sent.' : `${waiting} messages haven’t gone in yet and won’t be sent.`);
  // (Sessions it started can carry on in terminals instead.)
  const buttons = mine ? ['Quit anyway', mine === 1 ? 'Move it to a terminal' : 'Move them to terminals', 'Cancel'] : ['Quit anyway', 'Cancel'];
  dialog.showMessageBox({
    type: 'question',
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    message: 'Quit Blaube?',
    detail: lines.join('\n\n'),
  }).then(async ({ response }) => {
    if (response === buttons.length - 1) return;
    if (response === 1) await moveAllToTerminals();
    quitAnyway = true;
    app.quit();
  });
});
// Every session Blaube started, stopped here and resumed in a terminal
// of its own (as Continue in terminal does, for all of them at once).
async function moveAllToTerminals(open = openResumeTerminal) {
  const list = owned.list().map((id) => tracker.sessions.get(id)).filter(Boolean).map((s) => Object.assign({}, s));
  await Promise.all(list.map((s) => new Promise((done) => {
    const gone = (id) => { if (id !== s.id) return; owned.removeListener('exit', gone); done(); };
    owned.on('exit', gone);
    owned.end(s.id);
    setTimeout(() => { owned.removeListener('exit', gone); done(); }, 5000);
  })));
  for (const s of list) { try { open(s); } catch (e) { log(`couldn't move ${s.id} to a terminal: ${e.message}`); } }
}
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (focus.stop) focus.stop(); owned.killAll(); runs.stopAll(); });
