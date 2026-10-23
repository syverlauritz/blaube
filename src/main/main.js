const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, dialog, shell, clipboard, globalShortcut, systemPreferences } = require('electron');
const { SessionTracker } = require('./sessions');
const { Inbox } = require('./inbox');
const { placeTalk } = require('./talkPlace');
const { startHookServer, DEFAULT_PORT } = require('./hookServer');
const claudeHooks = require('./claudeHooks');
const { openResumeTerminal, resumeCommand, focusSessionApp } = require('./terminal');
const { startAgentsPoller, listAgents } = require('./agents');
const { startFocusWatcher, transcriptPath } = require('./focus');
const usage = require('./usage');
const { runningTasks } = require('./tasks');
const dock = require('./dock');
const { watchWindows, ledges } = require('./windows');
const BlaubeConfig = require('../shared/config');

const PORT = Number(process.env.BLAUBE_PORT) || DEFAULT_PORT;

// When Blaube is started from inside a Claude Code session (e.g. `npm start`
// run by Claude), it inherits that session's markers. A `claude --resume` it
// opens would then think it's a child session and stop saving transcripts.
for (const k of Object.keys(process.env)) {
  if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || /^CLAUDE_CODE_(CHILD_SESSION|SESSION_|MESSAGING_|ENTRYPOINT|EXECPATH)/.test(k)) delete process.env[k];
}
const ASSETS = path.join(__dirname, '..', '..', 'build');

const TUNING_SHORTCUT = 'CommandOrControl+Alt+Shift+B';

let win = null;
let tray = null;
let tuningWin = null;
let world = { obstacles: [] };
let dockWindows = [];
const tracker = new SessionTracker();
const inbox = new Inbox();
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
const TALK_W = 384, TALK_MIN_H = 190, TALK_MAX_H = 460;
const talkH = () => talkHeights.get(talkId) || 280;

// Puts the box where it belongs for its slime and its current height.
function placeTalkWin() {
  if (!talkWin || !talkSpot) return;
  const place = placeTalk(talkSpot, screen.getDisplayNearestPoint(talkSpot).workArea, TALK_W, talkH(), talkTail && talkTail.side);
  const moved = !talkTail || place.tail.side !== talkTail.side || Math.abs(place.tail.at - talkTail.at) > 0.5;
  talkTail = place.tail;
  talkWin.setBounds({ x: place.x, y: place.y, width: TALK_W, height: place.h });
  if (moved && talkId) talkWin.webContents.send('talk-tail', talkTail);
}

// Opens the talk box for a session, next to its slime (`at`: the top of the
// slime, in the overlay window's coordinates). Clicking the same slime
// again closes it.
function openTalk(id, at) {
  if (!tracker.sessions.get(id)) return;
  // Clicking its slime took focus and hid it: that click meant "close".
  if (talkHiddenId === id && Date.now() - talkHiddenAt < 350) { activateApp(talkBefore); return; }
  if (!talkWin) {
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
    talkWin.on('blur', () => {
      if (!talkWin || !talkWin.isVisible() || talkWin.webContents.isDevToolsFocused()) return;
      hideTalk();
      talkHiddenAt = Date.now(); // a click on its slime right now means "close"
      talkHiddenId = talkId;
    });
    talkWin.on('closed', () => { talkWin = null; talkId = null; });
  }
  if (talkWin.isVisible() && talkId === id) { hideTalk(); return; }
  if (talkWin.isVisible()) hideTalk(true);
  talkId = id;
  talkTail = null;
  const wb = win.getBounds();
  talkSpot = { x: wb.x + at.x, y: wb.y + at.y, r: at.r };
  // Fill it in while it's still hidden, and show it once it has measured
  // itself, so it never flashes the last slime's conversation or jumps.
  const show = () => {
    if (talkId !== id) return;
    placeTalkWin();
    talkWin.show(); // already filled in while hidden
    talkWin.focus();
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
  if (process.platform === 'darwin') {
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
  const onPurpose = talkWin.isFocused();
  talkWin.hide();
  if (win && !switching) win.webContents.send('talking', null);
  if (onPurpose && !switching && process.platform === 'darwin') activateApp(talkBefore);
}

let hooksOk = null; // whether Claude Code is connected, checked when the box opens
function pushTalk(id, focusField = false) {
  if (!talkWin || talkWin.isDestroyed() || id !== talkId) return;
  if (!talkWin.isVisible() && !talkReady) return; // it catches up when it opens
  if (hooksOk === null || talkReady) hooksOk = claudeHooks.isInstalled(undefined, PORT);
  const s = tracker.sessions.get(id);
  if (!s) { hideTalk(); return; }
  talkWin.webContents.send('talk-state', Object.assign({
    id,
    project: s.project,
    state: s.state,
    color: colorOf(s) || prefs.config.color || '#D97757',
    font: prefs.config.font,
    tail: talkTail,
    asks: inbox.asks.has(id) ? inbox.asks.get(id).length : 0,
    demo: id.startsWith('demo-'),
    connected: hooksOk,
    focus: focusField,
  }, inbox.view(id)));
}

// A reply's first sentence or so, for the slime's speech bubble.
function snippet(text) {
  const line = String(text).replace(/[`*_#>]+/g, '').split(/\n+/).map((l) => l.trim()).find(Boolean) || '';
  const sentence = (line.match(/^.{20,}?[.!?](\s|$)/) || [line])[0].trim();
  return sentence.length > 70 ? sentence.slice(0, 68).trimEnd() + '…' : sentence;
}

if (!app.requestSingleInstanceLock()) app.quit();

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
      effort: efforts.get(s.id) || defaultEffort(),
      agents: s.agents.map((a) => Object.assign({}, a, {
        description: agentDescription(s, a),
        effort: efforts.get(`${s.id}/${a.id}`) || efforts.get(s.id) || defaultEffort(),
      })),
    })),
    settings: { hooksInstalled: claudeHooks.isInstalled(undefined, PORT) },
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
function statusBubble({ session: s, agentId, payload: p }) {
  if (!win) return;
  const key = agentId ? `${s.id}/${agentId}` : s.id;
  const say = (text, seconds) => { if (text) win.webContents.send('say', { id: key, text, seconds, status: true }); };
  const event = p.hook_event_name;
  if (event === 'PreToolUse') {
    // Not every tool: a busy session would never stop talking.
    const now = Date.now();
    if (now - (lastBubble.get(key) || 0) < 4000) return;
    lastBubble.set(key, now);
    say(describeTool(p.tool_name, p.tool_input || {}), 2.5);
  } else if (event === 'Stop') {
    const said = p.last_assistant_message || usage.lastText(transcriptPath(s));
    // How long the turn took, when it was worth waiting for.
    const secs = s.turnStart ? (Date.now() - s.turnStart) / 1000 : 0;
    const took = secs < 20 ? '' : secs < 60 ? ` in ${Math.round(secs)}s` : secs < 3600 ? ` in ${Math.round(secs / 60)}m` : ` in ${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
    say(said ? `Done${took}: ` + shorten(said, 80) : `Done${took}!`, 6);
  } else if (event === 'Notification' && s.state === 'waiting') {
    say(shorten(p.message || 'I need you', 80), 6);
  }
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
    if (!ok && win) win.webContents.send('say', { id: s.id, text: "Can't find its window. Right-click me to resume it." });
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
    { label: 'Settings…', click: openSettings },
    { label: 'Come here', click: () => send('come-here') },
    { label: 'Everyone hop!', click: () => send('hop') },
    { label: 'Demo sessions', click: runDemo },
    { type: 'separator' },
    // Without Accessibility the Dock is a solid strip; with it, its icon row
    // is read so the slimes can bump into its ends.
    ...(process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)
      ? [{ label: 'Bump into the Dock’s sides…', click: askDockAccess }] : []),
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
  const effort = { low: 'Low effort', medium: 'Medium effort', high: 'High effort', xhigh: 'Extra high effort', max: 'Max effort' }[efforts.get(id) || defaultEffort()];
  const isDemo = id.startsWith('demo-');
  return Menu.buildFromTemplate([
    { label: s.project, enabled: false },
    { label: `${word}${s.message && s.state === 'waiting' ? ': ' + s.message : ''}`, enabled: false },
    ...(effort ? [{ label: effort, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Go to session', enabled: !isDemo, click: () => goToSession(s) },
    { label: 'Resume in new terminal', enabled: !isDemo, click: () => openResumeTerminal(s) },
    { label: 'Copy resume command', click: () => clipboard.writeText(`cd "${s.cwd}" && ${resumeCommand(s.id)}`) },
    { label: 'Open project folder', enabled: !!s.cwd, click: () => shell.openPath(s.cwd) },
    { type: 'separator' },
    { label: 'Colour', submenu: colorMenu(colorOf(s) || prefs.config.color, (hex) => { prefs.colors[colorKey(s)] = hex; savePrefs(); pushState(); }) },
    { label: 'Blaube', submenu: appMenuTemplate() },
    { type: 'separator' },
    { label: 'Merge back in', click: () => tracker.dismiss(id) },
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
    await startHookServer(tracker, PORT, inbox);
  } catch (e) {
    dialog.showErrorBox('Blaube', `Could not listen on 127.0.0.1:${PORT} (${e.code || e.message}). Is another Blaube running? Set BLAUBE_PORT to use a different port.`);
  }

  createWindow();
  if (!app.isPackaged) watchForChanges();

  tray = new Tray(trayIcon());
  tray.on('click', () => tray.popUpContextMenu(appMenu()));
  tray.on('right-click', () => tray.popUpContextMenu(appMenu()));
  refreshTray();

  focus = startFocusWatcher(() => { if (markFrontSeen()) pushState(); });
  tracker.on('change', () => {
    markFrontSeen();
    if (tracker.list().some((s) => !isReady(s))) refreshUsage();
    pushState();
    refreshTray();
  });
  tracker.on('prompt', (s) => { if (win) win.webContents.send('nod', s.id); });
  tracker.on('change', () => pushTalk(talkId));
  inbox.on('change', (id) => pushTalk(id));
  // A message from the slime went in: its turn starts, as if typed.
  inbox.on('delivered', (id) => {
    if (tracker.sessions.has(id)) tracker.handle({ session_id: id, hook_event_name: 'UserPromptSubmit' }, 'blaube');
  });
  // Replies to what you said from the slime pop up as a speech bubble,
  // unless its talk box is open (it shows them, and would cover the bubble).
  inbox.on('reply', (id, entry) => {
    const log = inbox.log(id), text = entry.text;
    let asked = null;
    for (let i = log.indexOf(entry) - 1; i >= 0 && !asked; i--) if (log[i].who !== 'note') asked = log[i];
    const open = talkWin && talkId === id && talkWin.isVisible();
    if (win && !open && asked && asked.who === 'you' && asked.via === 'blaube') win.webContents.send('say', { id, text: snippet(text), seconds: 7 });
  });
  tracker.on('activity', statusBubble);
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

  refreshDock();
  setInterval(refreshDock, 4 * 1000); // the Dock grows and shrinks as apps open and quit

  // The tops of other apps' windows are ledges a slime can land on.
  let lastLedges = '';
  watchWindows(process.pid, (list, at) => {
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

  startAgentsPoller(
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
    if (over !== clickable || (over && now - applied > 500)) {
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
  ipcMain.on('talk-send', (_e, id, text) => { if (id && id === talkId && tracker.sessions.has(id) && !id.startsWith('demo-')) inbox.send(id, text); });
  ipcMain.on('talk-unsend', (_e, id, n) => { if (id && id === talkId) inbox.unsend(id, n); });
  ipcMain.on('talk-close', () => hideTalk());
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
    const next = Math.round(Math.max(TALK_MIN_H, Math.min(TALK_MAX_H, Number(h) || talkH())));
    const changed = next !== talkHeights.get(id);
    talkHeights.set(id, next);
    if (talkReady) { const show = talkReady; talkReady = null; show(); return; }
    if (changed && talkWin && talkWin.isVisible()) placeTalkWin();
  });
  // If it wasn't decided (gone already, another session), the box is told
  // again what's really waiting.
  ipcMain.on('talk-permission', (_e, id, key, choice) => { if (!id || id !== talkId || !inbox.decide(id, key, choice)) pushTalk(talkId); });
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
});

app.on('second-instance', () => send('come-here'));
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (focus.stop) focus.stop(); });
