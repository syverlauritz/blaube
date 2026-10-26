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
function commandNames(q = '', cwd = '', home = os.homedir()) {
  q = String(q || '').toLowerCase();
  const mine = yours(cwd, home);
  const about = (f) => { try { const m = /^---\r?\n[\s\S]*?^description:\s*(.+)$/m.exec(fs.readFileSync(f, 'utf8').slice(0, 2000)); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; } catch { return ''; } };
  const out = [...mine.keys()].sort().filter((n) => !BUILT_IN.has(n) && n.toLowerCase().startsWith(q)).slice(0, 50).map((name) => ({ name, mine: true, about: about(mine.get(name)) }));
  for (const name of [...BUILT_IN].sort()) out.push({ name, mine: false });
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
function control(text) {
  const m = /^\/(model|plan)(?:\s+(\S+))?\s*$/i.exec(String(text || '').trim());
  if (!m) return null;
  if (m[1].toLowerCase() === 'plan') return { request: { subtype: 'set_permission_mode', mode: 'plan' } };
  if (!m[2]) return { help: 'Say which: /model opus, /model sonnet or /model haiku (or a full model name).' };
  return { request: { subtype: 'set_model', model: m[2].toLowerCase() === 'default' ? 'default' : m[2] } };
}

module.exports = { slashCommand, commandNames, expand, control };
