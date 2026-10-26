const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, screen, ipcMain, dialog, shell, clipboard, globalShortcut, systemPreferences } = require('electron');
const { SessionTracker } = require('./sessions');
const { Inbox, STYLE, failedTests } = require('./inbox');
const { classify } = require('../shared/actions');
const { SONGS } = require('../shared/songs');
const { placeTalk } = require('./talkPlace');
const { startHookServer, DEFAULT_PORT } = require('./hookServer');
const claudeHooks = require('./claudeHooks');
const history = require('./history');
const attention = require('./attention');
const markdown = require('./markdown');
const git = require('./git');
const { slashCommand } = require('./commands');
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
const TALK_SHORTCUT = 'CommandOrControl+Alt+B';

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

function setConfig(next) {
  prefs.config = BlaubeConfig.sanitize(next);
  savePrefs();
  applyOnTop();
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
  talkWin.on('blur', () => {
    if (!talkWin || !talkWin.isVisible() || talkWin.webContents.isDevToolsFocused()) return;
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
    tasks: (s.tasks || []).filter((t) => !t.demo).slice(0, 4).map((t) => ({ id: t.id, label: t.description || t.command, command: t.command })),
    helpers: s.state === 'working' || s.state === 'waiting' ? (s.agents || []).slice(0, 5).map((a) => ({ name: helperName(s, a), doing: helperDoing.get(`${id}/${a.id}`) || '', waiting: a.state === 'waiting' })) : [],
    focus: focusField,
    // Its git status and what you might ask for next (see git.js).
    git: gitStates.has(id) ? git.summary(gitStates.get(id)) : '',
    quick: id.startsWith('demo-') ? [] : git.quickActions(gitStates.get(id) || null, s.state, {
      failedTests: failedTests(inbox.log(id)),
      context: (() => { const tk = tokens.get(id); return tk && tk.limit && tk.context ? Math.round((tk.context / tk.limit) * 100) : 0; })(),
      canCompact: !owned.has(id), // (typed into its terminal, or handed over: see talk-send)
    }),
    // Every slime, to switch between them from the box.
    today: attention.today([...inbox.logs.values()]),
    others: tracker.list().filter(isReady).map((o) => Object.assign({ id: o.id, project: o.project, color: colorOf(o) || prefs.config.color || '#D97757', state: o.state }, glanceAt(o))),
  }, inbox.view(id)));
  if (s.cwd && !id.startsWith('demo-')) {
    git.status(s.cwd, (st) => {
      const before = JSON.stringify(gitStates.get(id) || null);
      gitStates.set(id, st);
      if (JSON.stringify(st) !== before) pushTalk(id);
    });
  }
}
let hubPast = [], hubFolders = [], hubCache = null; // what the overview last offered
const gitStates = new Map(); // session id -> its last git status (or null: not a repository)

// A session at a glance, for the overview in the talk box.
const looked = new Map(); // session id -> when you last had its talk box open
const glances = new Map(); // session id -> { at, state, g } (worked out at most once a second)
function glanceAt(o) {
  const hit = glances.get(o.id);
  if (hit && hit.state === o.state && Date.now() - hit.at < 1000) return hit.g;
  const g = glanceNow(o);
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

// Sessions that are gone for good (not just ended: forgotten by the
// tracker) leave nothing behind, however many come and go. Returns where
// anything was still kept (for the load check, scripts/e2e/many.js).
let sweepTimer = null;
function sweepSoon() { if (!sweepTimer) sweepTimer = setTimeout(() => { sweepTimer = null; sweep(); }, 2000); }
function sweep() {
  const live = (id) => tracker.sessions.has(id) || owned.has(id) || (id === talkId && !!talkWin && !talkWin.isDestroyed() && talkWin.isVisible());
  for (const id of [...inbox.logs.keys(), ...inbox.todos.keys(), ...inbox.steerable, ...inbox.typed.keys()]) if (!live(id)) inbox.forget(id);
  const maps = { gitStates, looked, glances, talkHeights, notified, doing, errorCounts };
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
function startSession(cwd, extra = [], resume = '') {
  if (!cwd) return null;
  // Not connected yet: give this session Blaube's hooks itself, so its
  // slime still knows what it's doing and can still ask you things.
  let settings = null;
  if (!claudeHooks.isInstalled(undefined, PORT)) {
    settings = claudeHooks.withBlaube({}, PORT);
    settings.hooks.Stop = settings.hooks.Stop.filter((g) => !g.hooks.some((h) => h.asyncRewake));
  }
  const id = owned.start(cwd, ['--append-system-prompt', STYLE, ...extra], settings, resume);
  prefs.recentFolders = [cwd, ...(prefs.recentFolders || []).filter((f) => f !== cwd)].slice(0, 5);
  savePrefs();
  log(`started a session in ${cwd}: ${id}`);
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
  inbox.add(id, { who: 'note', text: p.at ? `Picked up from ${history.ago(p.at)}` : 'Picked up here' });
}

// Past sessions you could pick up (not the ones running now).
function pastSessionsMenu() {
  let past = [];
  try { past = history.pastSessions(new Set(tracker.sessions.keys()), 8); } catch { /* none */ }
  if (!past.length) return [];
  return [{ label: 'Pick up a past session', submenu: past.map((p) => ({ label: p.title, sublabel: `${path.basename(p.cwd)} · ${history.ago(p.at)}`, click: () => pickUp(p) })) }];
}

async function newSession() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'New session',
    message: 'Pick the folder Claude should work in',
    buttonLabel: 'Start here',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: (prefs.recentFolders || [])[0],
  });
  if (!canceled && filePaths[0]) startSession(filePaths[0]);
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
function notify(s, event, text, secs = 0) {
  if (TEST || !Notification.isSupported() || s.id.startsWith('demo-')) return;
  const mode = prefs.config.notify || 'Behind windows';
  const seen = (talkWin && talkWin.isVisible() && talkId === s.id) || (mode !== 'Always' && prefs.config.onTop !== 'Off' && win && win.isVisible());
  const n = attention.notification({ event, project: s.project, title: usage.sessionInfo(transcriptPath(s)).title, text, secs, seen, enabled: mode !== 'Off' });
  if (!n || Date.now() - (notified.get(s.id) || 0) < 15000) return;
  notified.set(s.id, Date.now());
  const note = new Notification({ title: n.title, body: n.body });
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
  inbox.add(s.id, { who: 'note', text: `${cmd.split(/\s/)[0]} is for Claude Code itself, so it’s on your clipboard: paste it into its terminal.` });
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
    ]),
    { label: 'Copy resume command', click: () => clipboard.writeText(`cd "${s.cwd}" && ${resumeCommand(s.id)}`) },
    { label: 'Save conversation as Markdown', enabled: !isDemo && inbox.log(id).length > 0, click: () => { const f = saveConversation(id); if (f) shell.showItemInFolder(f); } },
    { label: 'Open project folder', enabled: !!s.cwd, click: () => shell.openPath(s.cwd) },
    { type: 'separator' },
    { label: 'Colour', submenu: colorMenu(colorOf(s) || prefs.config.color, (hex) => { prefs.colors[colorKey(s)] = hex; savePrefs(); pushState(); }) },
    { label: 'Blaube', submenu: appMenuTemplate() },
    { type: 'separator' },
    { label: 'Hide this slime', toolTip: 'Until its session ends', click: () => tracker.dismiss(id) },
  ]);
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
  return Menu.buildFromTemplate([...(rows.length ? [...rows, { type: 'separator' }] : []), ...appMenuTemplate()]);
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
  owned.on('result', (id, r) => {
    if (r.error && !r.text) inbox.add(id, { who: 'note', text: `Something went wrong${r.subtype ? ` (${r.subtype})` : ''}.` });
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
  if (!globalShortcut.register(TALK_SHORTCUT, talkShortcut)) log(`${TALK_SHORTCUT} is taken by another app: no talk shortcut`);
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
  ipcMain.on('talk-send', (_e, id, text) => {
    if (!id || id !== talkId || !tracker.sessions.has(id) || id.startsWith('demo-')) return;
    if (!prefs.talked) { prefs.talked = true; savePrefs(); pushState(); } // no more "click to talk" hints
    // A session Blaube started: straight in, and its turn starts.
    if (owned.has(id)) {
      if (!owned.send(id, text)) { inbox.add(id, { who: 'you', text: String(text), via: 'blaube', status: 'unsent' }); return; }
      inbox.say(id, text);
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
    const how = inbox.send(id, text);
    log(`message for ${tracker.sessions.get(id).project}: ${how} (inbox ${inbox.view(id).inbox})`);
    setTimeout(() => typeQueued(id), 1500); // a moment for its inbox hook to ask first
  });
  ipcMain.on('talk-stop', (_e, id) => {
    if (!id || id !== talkId || !tracker.sessions.has(id)) return;
    log(`stop ${tracker.sessions.get(id).project}: ${inbox.stop(id) ? 'at its next step' : 'can\'t'}`);
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
    // (Looking through past transcripts is slow-ish: at most every 30 s.)
    if (hubCache && Date.now() - hubCache.at < 30000) return hubCache.hub;
    const live = tracker.list();
    const folders = [...new Set([...(prefs.recentFolders || []), ...live.map((o) => o.cwd).filter(Boolean)])]
      .filter((f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } }).slice(0, 5);
    let past = [];
    try { past = history.pastSessions(new Set(live.map((o) => o.id)), 3); } catch { /* none */ }
    hubPast = past;
    hubFolders = folders;
    const hub = { folders: folders.map((f) => ({ path: f, name: path.basename(f) })), past: past.map((p) => ({ id: p.id, title: p.title, where: `${path.basename(p.cwd)} · ${history.ago(p.at)}` })) };
    hubCache = { at: Date.now(), hub };
    return hub;
  });
  // Only a folder the overview offered, and only if it's still there.
  ipcMain.on('talk-new', (_e, folder) => {
    if (folder === 'pick') return newSession();
    if (!hubFolders.includes(folder)) return;
    try { if (!fs.statSync(folder).isDirectory()) return; } catch { hubCache = null; return; }
    hideTalk();
    startSession(folder);
  });
  // A session that ended while its box was open, picked up right there.
  ipcMain.on('talk-continue', (_e, id) => {
    const last = talkLast && talkLast.id === id ? talkLast : null;
    if (!last || id !== talkId || tracker.sessions.has(id) || owned.has(id) || !last.cwd || last.demo) return;
    hideTalk();
    pickUp({ id, cwd: last.cwd, at: 0, title: last.project, file: null });
  });
  ipcMain.on('talk-pickup', (_e, id) => { const p = hubPast.find((x) => x.id === id); if (p) { hubCache = null; hideTalk(); pickUp(p); } });
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
  // A file a turn changed, shown in Finder (never opened: it could be a program).
  ipcMain.on('talk-reveal', (_e, id, file) => {
    if (!id || id !== talkId || typeof file !== 'string' || !path.isAbsolute(file)) return;
    if (!inbox.log(id).some((e) => e.who === 'step' && e.file === file)) return; // only files its steps named
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
  if (mine) lines.push(mine === 1 ? 'A session you started in Blaube will stop. You can pick it up later in a terminal with claude --resume.' : `${mine} sessions you started in Blaube will stop. You can pick them up later in a terminal with claude --resume.`);
  if (waiting) lines.push(waiting === 1 ? 'A message hasn’t gone in yet and won’t be sent.' : `${waiting} messages haven’t gone in yet and won’t be sent.`);
  dialog.showMessageBox({
    type: 'question',
    buttons: ['Quit anyway', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Quit Blaube?',
    detail: lines.join('\n\n'),
  }).then(({ response }) => { if (response === 0) { quitAnyway = true; app.quit(); } });
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (focus.stop) focus.stop(); owned.killAll(); });
