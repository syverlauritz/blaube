// Adds/removes Blaube's hooks in ~/.claude/settings.json. Each hook just
// pipes Claude Code's event JSON to Blaube's local server with curl, and
// never blocks or fails Claude if Blaube isn't running. One more, on Stop,
// runs in the background and waits for a message typed into the slime
// (see inbox.js).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_PORT, HOOK_PATH, INBOX_PATH, PERMISSION_PATH } = require('./hookServer');

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd'];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const MARKER = HOOK_PATH;

function settingsPath(home = os.homedir()) {
  return path.join(home, '.claude', 'settings.json');
}

function hookCommand(port = DEFAULT_PORT) {
  // X-Blaube-Pid is the Windows process id of the hook's shell, so Blaube
  // can find the claude.exe above it (and later, its terminal window).
  return `curl -s -m 2 -X POST -H "Content-Type: application/json" -H "X-Blaube-Term: $TERM_PROGRAM" -H "X-Blaube-Entry: $CLAUDE_CODE_ENTRYPOINT" -H "X-Blaube-Pid: $(cat /proc/$$/winpid 2>/dev/null)" --data-binary @- http://127.0.0.1:${port}${HOOK_PATH} >/dev/null 2>&1 || true`;
}

// Waits for a message from the slime. Blaube holds the request open; a
// message comes back as text, which goes to stderr with exit code 2 so
// Claude wakes up and reads it (asyncRewake). An empty answer means stop
// waiting. If Blaube isn't running (or quits) it tries again every few
// seconds, so a session reconnects when Blaube comes back. Only the
// newest one per session keeps trying: each writes its pid to a file named
// after the session, and an older one that finds someone else's there quits.
const INBOX_TIMEOUT = 86400; // Claude Code kills an asyncRewake hook after this

function inboxCommand(port = DEFAULT_PORT) {
  return `in=$(cat); sid=$(printf '%s' "$in" | sed -n 's/.*"session_id" *: *"\\([^"]*\\)".*/\\1/p' | tr -cd 'A-Za-z0-9-'); f="\${TMPDIR:-/tmp}/blaube-inbox-$sid"; echo $$ > "$f"; while :; do out=$(printf '%s' "$in" | curl -s -m ${INBOX_TIMEOUT - 60} -X POST -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:${port}${INBOX_PATH}); rc=$?; if [ $rc -eq 0 ]; then [ -n "$out" ] && { printf '%s\\n' "$out" >&2; exit 2; }; exit 0; fi; [ $rc -eq 28 ] && exit 0; kill -0 $PPID 2>/dev/null || { rm -f "$f"; exit 0; }; sleep 5; [ "$(cat "$f" 2>/dev/null)" = "$$" ] || exit 0; done`;
}

// Asks Blaube whether to allow a tool, so you can answer from the slime.
// The terminal shows its own prompt at the same time and whichever is
// answered first wins (answering in the terminal cancels this hook). No
// answer, or no Blaube, prints nothing and the terminal prompt carries on.
const PERMISSION_TIMEOUT = 600;

function permissionCommand(port = DEFAULT_PORT) {
  // (curl runs in the background so that when Claude Code stops this hook,
  // because the terminal answered, curl stops too and the card goes.)
  return `in=$(cat); o=$(mktemp); printf '%s' "$in" | curl -s -m ${PERMISSION_TIMEOUT - 10} -X POST -H "Content-Type: application/json" -H "X-Blaube-Term: $TERM_PROGRAM" -H "X-Blaube-Entry: $CLAUDE_CODE_ENTRYPOINT" --data-binary @- -o "$o" http://127.0.0.1:${port}${PERMISSION_PATH} & p=$!; trap 'kill $p 2>/dev/null; rm -f "$o"; exit 0' TERM INT HUP; wait $p; [ -s "$o" ] && cat "$o" && echo; rm -f "$o"; exit 0`;
}

const permissionHook = (port) => ({ type: 'command', command: permissionCommand(port), timeout: PERMISSION_TIMEOUT });

const inboxHook = (port) => ({ type: 'command', command: inboxCommand(port), asyncRewake: true, timeout: INBOX_TIMEOUT });

const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes(MARKER);

function withoutBlaube(settings) {
  const out = Object.assign({}, settings);
  if (!out.hooks || typeof out.hooks !== 'object') return out;
  out.hooks = Object.assign({}, out.hooks);
  for (const ev of Object.keys(out.hooks)) {
    if (!Array.isArray(out.hooks[ev])) continue;
    const groups = out.hooks[ev]
      .map((g) => (g && Array.isArray(g.hooks) ? Object.assign({}, g, { hooks: g.hooks.filter((h) => !isOurs(h)) }) : g))
      .filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
    if (groups.length) out.hooks[ev] = groups;
    else delete out.hooks[ev];
  }
  if (Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
}

function withBlaube(settings, port = DEFAULT_PORT) {
  const out = withoutBlaube(settings);
  out.hooks = Object.assign({}, out.hooks);
  const hook = { type: 'command', command: hookCommand(port), timeout: 3 };
  for (const ev of EVENTS) {
    const group = TOOL_EVENTS.has(ev) ? { matcher: '*', hooks: [hook] } : { hooks: [hook] };
    out.hooks[ev] = [...(out.hooks[ev] || []), group];
  }
  out.hooks.Stop.push({ hooks: [inboxHook(port)] });
  out.hooks.PermissionRequest = [...(out.hooks.PermissionRequest || []), { matcher: '*', hooks: [permissionHook(port)] }];
  return out;
}

function read(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  return JSON.parse(text); // throws on a broken file: we never overwrite what we can't parse
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.blaube-backup');
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function isInstalled(file = settingsPath(), port = DEFAULT_PORT) {
  try {
    const s = read(file);
    // Exact match, so an older Blaube's hooks show up as needing an update.
    const cmd = hookCommand(port);
    const has = (ev, c) => (s.hooks?.[ev] || []).some((g) => (g.hooks || []).some((h) => isOurs(h) && h.command === c));
    return EVENTS.every((ev) => has(ev, cmd)) && has('Stop', inboxCommand(port)) && has('PermissionRequest', permissionCommand(port));
  } catch {
    return false;
  }
}

function hasAnyBlaubeHooks(file = settingsPath()) {
  try {
    const s = read(file);
    return Object.values(s.hooks || {}).some((groups) => Array.isArray(groups) && groups.some((g) => (g.hooks || []).some(isOurs)));
  } catch {
    return false;
  }
}

function install(file = settingsPath(), port = DEFAULT_PORT) {
  write(file, withBlaube(read(file), port));
}

function uninstall(file = settingsPath()) {
  if (!fs.existsSync(file)) return;
  write(file, withoutBlaube(read(file)));
}

module.exports = { install, uninstall, isInstalled, hasAnyBlaubeHooks, withBlaube, withoutBlaube, hookCommand, inboxCommand, permissionCommand, settingsPath, EVENTS };
