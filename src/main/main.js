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
const history = require('./history');
const attention = require('./attention');
const markdown = require('./markdown');
const git = require('./git');
const projectFiles = require('./files');
const shellRun = require('./shellRun');
const { failedTests, stoppedLast, erredLast } = require('./inbox');
const { Notification } = require('electron');
const { slashCommand, commandNames, expand: expandCommand, control: controlFor, contextNote, EFFORTS } = require('./commands');
const limits = require('./limits');
const usageProbe = require('./usageProbe');
const auth = require('./auth');
const renamer = require('./rename');
const taskOutput = require('./taskOutput');
const permRules = require('./permRules');
const taskKill = require('./taskKill');
const memory = require('./memory');
const { openResumeTerminal, resumeCommand, focusSessionApp, typeIntoSession } = require('./terminal');
const { startAgentsPoller, listAgents, findClaude } = require('./agents');
const { Owned } = require('./owned');
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
    tasks: (s.tasks || []).filter((t) => !t.demo).slice(0, 4).map((t) => ({ id: t.id, label: t.description || t.command, command: t.command, url: taskUrls.get(`${id}/${t.id}`) || '' })),
    helpers: s.state === 'working' || s.state === 'waiting' ? (s.agents || []).slice(0, 5).map((a) => ({ name: helperName(s, a), doing: helperDoing.get(`${id}/${a.id}`) || '', waiting: a.state === 'waiting' })) : [],
    focus: focusField,
    // Its git status and what you might ask for next (see git.js).
    git: gitStates.has(id) ? git.summary(gitStates.get(id)) : '',
    gitFiles: gitFiles(id),
    earlier: !id.startsWith('demo-') && !!transcriptPath(s) && fs.existsSync(transcriptPath(s)), // (its transcript has what came before)
    lookedAt: looked.get(id) || 0, // (when its box was last closed: what's new since shows)
    quick: id.startsWith('demo-') ? [] : git.quickActions(gitStates.get(id) || null, s.state, {
      stopped: stoppedLast(inbox.log(id)),
      apiError: erredLast(inbox.log(id)),
      carryAt: carryFor(id),
      failedTests: failedTests(inbox.log(id)),
      context: contextOf(id),
    }),
    // Every slime, to switch between them from the box.
    today: attention.today([...inbox.logs.values()]),
    others: tracker.list().filter(isReady).map((o) => Object.assign({ id: o.id, project: o.project, color: colorOf(o) || prefs.config.color || '#D97757', state: o.state, ask: askOf(o.id), urls: (o.tasks || []).map((t) => ({ label: t.description || t.command, url: taskUrls.get(`${o.id}/${t.id}`) || '' })).filter((t) => t.url).slice(0, 2) }, glanceAt(o))),
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

// A session at a glance, for the overview in the talk box.
const looked = new Map(); // session id -> when you last had its talk box open
const glances = new Map(); // session id -> { at, state, g } (worked out at most once a second)
function glanceAt(o) {
  const hit = glances.get(o.id);
  if (hit && hit.state === o.state && Date.now() - hit.at < 1000) return hit.g;
  // (With its title, "Add the 2027 brackets", to tell two in one project apart.)
  const g = Object.assign(glanceNow(o), { title: o.id.startsWith('demo-') ? '' : usage.sessionInfo(transcriptPath(o)).title });
  glances.set(o.id, { at: Date.now(), state: o.state, g });
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
    git: gitStates.has(o.id) ? git.summary(gitStates.get(o.id)) : '',
    turnStart: o.turnStart,
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
  const maps = { gitStates, looked, glances, talkHeights, notified, doing, errorCounts, apiErrorCounts, pickedModel, shellRan, carryLater, mcpStates, rewound, foreground };
  for (const id of [...muted]) if (!live(id)) muted.delete(id);
  for (const m of Object.values(maps)) for (const id of [...m.keys()]) if (!live(id)) m.delete(id);
  for (const [k, at] of [...lastBubble]) if (Date.now() - at > 60e3) lastBubble.delete(k);
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
  if (!id) return;
  // (Ended while you watched: the conversation is still here.)
  if (p.file && !inbox.log(id).length) for (const m of history.recentMessages(p.file, 4)) inbox.add(id, m);
  inbox.add(id, { who: 'note', text: p.note || (p.at ? `Picked up from ${history.ago(p.at)}` : 'Picked up here') });
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
    pickUp(p);
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
  win.webContents.send('state', {
    pending: all.filter((s) => !isReady(s)).length,
    sessions: all.filter(isReady).map((s) => Object.assign({}, s, {
      color: colorOf(s),
      tokens: tokens.get(s.id) || null,
      info: usage.sessionInfo(transcriptPath(s)),
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
const muted = new Set(); // sessions you turned notifications off for (from its slime's menu)
function notify(s, event, text, secs = 0) {
  if (TEST || !Notification.isSupported() || s.id.startsWith('demo-')) return;
  if (muted.has(s.id)) return;
  const mode = prefs.config.notify || 'Behind windows';
  const seen = (talkWin && talkWin.isVisible() && talkId === s.id) || (mode !== 'Always' && prefs.config.onTop !== 'Off' && win && win.isVisible());
  // (Asking permission: Allow and Deny right in it, on macOS.)
  const ask = event === 'waiting' && process.platform === 'darwin' ? (inbox.asks.get(s.id) || []).slice(-1)[0] : null;
  const n = attention.notification({ event, project: s.project, title: usage.sessionInfo(transcriptPath(s)).title, text, secs, seen, enabled: mode !== 'Off', ask });
  if (!n || Date.now() - (notified.get(s.id) || 0) < 15000) return;
  notified.set(s.id, Date.now());
  // (On macOS you can answer one that's done right in the notification.)
  // (And a permission ask can be answered "no, do this instead" in words.)
  const askReply = ask && ask.kind === 'tool' && n.actions;
  const note = new Notification(Object.assign({ title: n.title, body: n.body }, event === 'done' ? { hasReply: true, replyPlaceholder: `Reply to ${s.project}` } : askReply ? { hasReply: true, replyPlaceholder: 'Or say what to do instead' } : {},
    n.actions ? { actions: n.actions.map((text) => ({ type: 'button', text })) } : {}));
  note.on('action', (_e, i) => { shown.delete(note); if (ask && n.actions && !inbox.decide(s.id, ask.key, i === 0 ? 'allow' : 'deny') && win) win.webContents.send('open-talk', s.id); });
  note.on('reply', (_e, text) => {
    shown.delete(note);
    const said = String(text || '').trim();
    if (!said || !tracker.sessions.has(s.id)) return;
    if (askReply) { if (!inbox.decide(s.id, ask.key, 'deny', { message: said }) && win) win.webContents.send('open-talk', s.id); return; }
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
function handOver(s, cmd) {
  clipboard.writeText(cmd);
  const bring = canBringIn(s);
  inbox.add(s.id, { who: 'note', text: `${cmd.split(/\s/)[0]} is for Claude Code itself, so it’s on your clipboard: paste it into its terminal.${bring ? ' Or bring it here, and commands like it go straight in.' : ''}`, bring });
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
function appMenuTemplate() {
  const installed = claudeHooks.isInstalled(undefined, PORT);
  const noClaude = !claudeFound();
  return [
    { label: `Blaube ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    ...(noClaude ? [{ label: 'Install Claude Code…', click: () => shell.openExternal(INSTALL_URL) }]
      : installed ? [] : [{ label: claudeHooks.hasAnyBlaubeHooks() ? 'Update Claude Code connection…' : 'Connect Claude Code…', click: installHooks }]),
    ...newSessionMenu(),
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
    return { label: `${mark[o.state] || '•'}  ${o.project}${process.platform === 'darwin' || !g.status ? '' : `  ·  ${g.status.length > 40 ? g.status.slice(0, 39) + "…" : g.status}`}`, sublabel: g.status, toolTip: g.meta, click: () => { if (!win) return; if (process.platform === 'darwin') app.focus({ steal: true }); win.webContents.send('open-talk', o.id); } };
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
  setInterval(askUsage, 5 * 60e3).unref();
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
          .then(({ response }) => { if (response === 0) shell.openExternal(INSTALL_URL); });
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
    // "/doctor" and "/upgrade": Claude Code's own checkup and update
    // (`claude doctor`, `claude update`), run right there as a step.
    // ("/mcp" in a terminal's session: `claude mcp list`, its MCP servers
    // and whether they connect; in one Blaube started, its box shows them.)
    const own = /^\/(doctor|upgrade|update|mcp)\s*$/i.exec(String(text).trim());
    if (own && sess && !id.startsWith('demo-') && !(own[1].toLowerCase() === 'mcp' && owned.has(id))) {
      const bin = owned.findClaude() || owned.shellPath() || 'claude';
      const q = process.platform === 'win32' ? `"${bin}"` : `'${bin.replace(/'/g, `'\\''`)}'`;
      const what = { doctor: ['doctor', 'Checked Claude Code (claude doctor)'], mcp: ['mcp list', 'Its MCP servers (claude mcp list)'] }[own[1].toLowerCase()] || ['update', 'Updated Claude Code (claude update)'];
      return runForSession(id, `${q} ${what[0]}`, what[1]);
    }
    if (own && owned.has(id)) {
      const list = mcpStates.get(id) || [];
      inbox.add(id, { who: 'note', text: list.length ? `Its MCP servers: ${list.map((m) => `${m.name} (${m.status === 'connected' ? 'connected' : m.status === 'needs-auth' ? 'needs you to sign in' : m.status === 'failed' ? 'couldn’t connect' : m.status})`).join(' · ')}` : 'It has no MCP servers.' });
      askMcp(id);
      return;
    }
    // "/permissions": what it may do without asking; "allow Bash(npm
    // test:*)" adds a rule (this project, just you), "remove …" takes one back.
    const perm = /^\/(?:permissions|allowed-tools)(?:\s+(allow|add|remove|deny)\s+(.+))?\s*$/i.exec(String(text).trim());
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
    // "/export": the conversation as Markdown, to Downloads (as ⌘S).
    if (/^\/export\s*$/i.test(String(text).trim())) {
      const file = saveConversation(id);
      inbox.add(id, file ? { who: 'note', text: `Saved the conversation to ${path.basename(path.dirname(file))}/${path.basename(file)}`, file } : { who: 'note', text: 'Couldn’t save it', error: true });
      return;
    }
    // "/status": what it's running on, as Claude Code's /status says.
    if (/^\/status\s*$/i.test(String(text).trim()) && sess && !id.startsWith('demo-')) {
      const bin = owned.findClaude() || owned.shellPath();
      const say = (version) => {
        const st = gitStates.get(id);
        const mode = { acceptEdits: 'accepting edits', plan: 'planning first', bypassPermissions: 'not asking', default: 'asking first' }[sess.mode || 'default'] || sess.mode;
        inbox.add(id, { who: 'note', text: [
          version ? `Claude Code ${version}` : '',
          modelName(pickedModel.get(id) || usage.sessionInfo(transcriptPath(sess)).model),
          mode,
          signedOutNow ? 'signed out' : '',
          sess.cwd ? `in ${sess.cwd.replace(os.homedir(), '~')}${st && st.branch ? ` (${st.branch})` : ''}` : '',
          owned.has(id) ? 'started by Blaube' : 'in a terminal',
        ].filter(Boolean).join(' · ') });
      };
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
    // A session Blaube started: straight in, and its turn starts.
    if (owned.has(id)) {
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
  function runForSession(id, cmd, as = '') {
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
    });
  }
  replyTo = sendMessage;
  // Stops a background task: in a session Blaube started, asked of Claude
  // Code itself (stop_task); in a terminal's, the processes writing its
  // output (its own, under its claude process). false: the box asks Claude.
  ipcMain.handle('talk-stop-task', (_e, id, taskId) => new Promise((done) => {
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
  // ⌘F in the overview: what every session said.
  // Files named in its replies: which are real (they become tappable), and
  // one's start, to read right in the box.
  ipcMain.handle('talk-files-exist', (_e, id, paths) => {
    if (!id || id !== talkId || !Array.isArray(paths)) return [];
    return paths.slice(0, 40).filter((p) => sessionFile(id, p));
  });
  const PEEK = 64 << 10;
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
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (focus.stop) focus.stop(); owned.killAll(); });
