// Adds/removes Blaube's hooks in ~/.claude/settings.json. Each hook just
// pipes Claude Code's event JSON to Blaube's local server with curl, and
// never blocks or fails Claude if Blaube isn't running.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_PORT, HOOK_PATH } = require('./hookServer');

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
    return EVENTS.every((ev) => (s.hooks?.[ev] || []).some((g) => (g.hooks || []).some((h) => isOurs(h) && h.command === cmd)));
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

module.exports = { install, uninstall, isInstalled, hasAnyBlaubeHooks, withBlaube, withoutBlaube, hookCommand, settingsPath, EVENTS };
