// Whether something typed in the talk box is a Claude Code slash command
// (/compact, /model opus, /my-plugin:thing) rather than a message that
// happens to start with a slash ("/api returns 500", "/tmp is full").
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUILT_IN = new Set(['add-dir', 'agents', 'bug', 'clear', 'compact', 'config', 'context', 'cost', 'doctor', 'effort', 'exit', 'export', 'fast', 'help', 'hooks', 'init', 'login', 'logout', 'mcp', 'memory', 'model', 'output-style', 'permissions', 'plan', 'plugin', 'pr-comments', 'release-notes', 'rename', 'resume', 'review', 'rewind', 'security-review', 'skills', 'status', 'statusline', 'terminal-setup', 'todos', 'upgrade', 'usage', 'vim']);

// Your own commands: .md files in ~/.claude/commands and the project's
// .claude/commands (folders make "folder:name"). name -> file.
function custom(dir) {
  const out = new Map();
  const walk = (d, prefix) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + ':');
      else if (e.name.endsWith('.md')) {
        const f = path.join(d, e.name), n = e.name.slice(0, -3);
        out.set(prefix + n, f);
        if (!out.has(n)) out.set(n, f);
      }
    }
  };
  walk(dir, '');
  return out;
}
// Yours and the project's (the project's win).
function yours(cwd, home) {
  const mine = custom(path.join(home, '.claude', 'commands'));
  if (cwd) for (const [n, f] of custom(path.join(cwd, '.claude', 'commands'))) mine.set(n, f);
  return mine;
}

// The command's name if `text` is one, else ''.
function slashCommand(text, cwd = '', home = os.homedir()) {
  const m = /^\/([a-z][\w-]*(?::[\w-]+)*)(\s|$)/i.exec(String(text || '').trim());
  if (!m) return '';
  const name = m[1].toLowerCase();
  if (BUILT_IN.has(name) || name.includes(':')) return '/' + name; // a plugin's "plugin:command" too
  return yours(cwd, home).has(name) ? '/' + name : '';
}

// Every command you could type, for "/" in the talk box: [{ name, mine,
// about }] (yours first), the ones starting with `q`.
// What the box does with the built-in ones it handles itself, in words.
const ABOUT = {
  'add-dir': 'Another folder it may work in',
  agents: 'Opens the project’s agents folder',
  clear: 'A fresh conversation, same slime',
  compact: 'Frees up its context',
  config: 'Opens your Claude Code settings',
  context: 'What fills its context',
  doctor: 'Checks your Claude Code install',
  effort: 'How hard it thinks',
  hooks: 'Opens the settings file hooks go in',
  login: 'Signs Claude Code in, in your browser',
  memory: 'Opens the project’s CLAUDE.md',
  model: 'Switches its model',
  permissions: 'What it may do without asking',
  plan: 'Plans first, before changing anything',
  rename: 'Names this session',
  upgrade: 'Updates Claude Code',
  usage: 'How much of your limits you’ve used',
};

function commandNames(q = '', cwd = '', home = os.homedir()) {
  q = String(q || '').toLowerCase();
  const mine = yours(cwd, home);
  const about = (f) => { try { const m = /^---\r?\n[\s\S]*?^description:\s*(.+)$/m.exec(fs.readFileSync(f, 'utf8').slice(0, 2000)); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; } catch { return ''; } };
  const out = [...mine.keys()].sort().filter((n) => !BUILT_IN.has(n) && n.toLowerCase().startsWith(q)).slice(0, 50).map((name) => ({ name, mine: true, about: about(mine.get(name)) }));
  for (const name of [...BUILT_IN].sort()) out.push(Object.assign({ name, mine: false }, ABOUT[name] ? { about: ABOUT[name] } : {}));
  return out.filter((c) => c.name.toLowerCase().startsWith(q));
}

// One of your own commands is only a prompt: what it says, with what you
// typed after it in place of $ARGUMENTS ($1, $2... word by word), so it can
// go as a message without the terminal. '' when it isn't one of yours, or
// it runs shell commands first (!`...`), which only Claude Code can do.
function expand(text, cwd = '', home = os.homedir()) {
  const m = /^\/([a-z][\w-]*(?::[\w-]+)*)(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  if (!m) return '';
  if (BUILT_IN.has(m[1].toLowerCase())) return '';
  const mine = yours(cwd, home);
  const file = mine.get(m[1].toLowerCase()) || mine.get(m[1]);
  if (!file) return '';
  let body;
  try { body = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''); // (its settings)
  if (/!`/.test(body)) return '';
  const args = (m[2] || '').trim();
  const words = args ? args.split(/\s+/) : [];
  let used = false;
  body = body.replace(/\$ARGUMENTS|\$(\d)/g, (all, n) => { used = true; return n ? words[Number(n) - 1] || '' : args; });
  body = body.trim();
  if (args && !used) body += '\n\n' + args; // (as Claude Code does)
  return body;
}

// What a session Blaube started can do right away, without a terminal:
// /model sonnet switches its model, /plan makes it plan first. Returns {
// request } for Claude Code, { help } when something's missing, or null.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
function control(text) {
  const m = /^\/(model|plan|context|effort)(?:\s+(\S+))?\s*$/i.exec(String(text || '').trim());
  if (!m) return null;
  if (m[1].toLowerCase() === 'effort') {
    const level = (m[2] || '').toLowerCase();
    return EFFORTS.includes(level) ? { request: { subtype: 'apply_flag_settings', settings: { effortLevel: level } } } : { help: `Say how hard it should think: /effort ${EFFORTS.join(', /effort ')}.` };
  }
  if (m[1].toLowerCase() === 'context') return { request: { subtype: 'get_context_usage', detail: 'summary' } }; // (local estimates: no API calls)
  if (m[1].toLowerCase() === 'plan') return { request: { subtype: 'set_permission_mode', mode: 'plan' } };
  if (!m[2]) return { help: 'Say which: /model opus, /model sonnet or /model haiku (or a full model name).' };
  return { request: { subtype: 'set_model', model: m[2].toLowerCase() === 'default' ? 'default' : m[2] } };
}

// Claude Code's answer to get_context_usage, as the box shows it: "Context:
// 8% full (39.8k of 500k)" over a bar of what fills it, biggest first.
const kTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100e3 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));
function contextNote(r) {
  if (!r || !Array.isArray(r.categories) || !r.maxTokens) return null;
  const parts = r.categories.filter((c) => c && c.tokens > 0 && c.kind !== 'deferred').map((c) => ({ name: String(c.name || c.id), tokens: c.tokens, kind: c.kind === 'free' || c.kind === 'buffer' ? c.kind : 'used' }));
  parts.sort((a, b) => (a.kind === 'used' ? 0 : a.kind === 'buffer' ? 1 : 2) - (b.kind === 'used' ? 0 : b.kind === 'buffer' ? 1 : 2) || b.tokens - a.tokens);
  const used = r.totalTokens != null ? r.totalTokens : parts.filter((p) => p.kind === 'used').reduce((n, p) => n + p.tokens, 0);
  const pct = r.percentage != null ? Math.round(r.percentage) : Math.round(100 * used / r.maxTokens);
  return { text: `Context: ${pct}% full (${kTokens(used)} of ${kTokens(r.maxTokens)})`, context: { max: r.maxTokens, parts: parts.map((p) => Object.assign(p, { label: `${p.name} ${kTokens(p.tokens)}` })) } };
}

module.exports = { slashCommand, commandNames, expand, control, contextNote, EFFORTS };
