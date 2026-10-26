// Whether something typed in the talk box is a Claude Code slash command
// (/compact, /model opus, /my-plugin:thing) rather than a message that
// happens to start with a slash ("/api returns 500", "/tmp is full").
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUILT_IN = new Set(['add-dir', 'agents', 'bug', 'clear', 'compact', 'config', 'context', 'cost', 'doctor', 'effort', 'exit', 'export', 'fast', 'help', 'hooks', 'init', 'login', 'logout', 'mcp', 'memory', 'model', 'output-style', 'permissions', 'plan', 'plugin', 'pr-comments', 'release-notes', 'rename', 'resume', 'review', 'rewind', 'security-review', 'skills', 'status', 'statusline', 'terminal-setup', 'todos', 'upgrade', 'usage', 'vim']);

// Your own commands: .md files in ~/.claude/commands and the project's
// .claude/commands (folders make "folder:name").
function custom(dir) {
  const out = new Set();
  const walk = (d, prefix) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + ':');
      else if (e.name.endsWith('.md')) { out.add(prefix + e.name.slice(0, -3)); out.add(e.name.slice(0, -3)); }
    }
  };
  walk(dir, '');
  return out;
}

// The command's name if `text` is one, else ''.
function slashCommand(text, cwd = '', home = os.homedir()) {
  const m = /^\/([a-z][\w-]*(?::[\w-]+)*)(\s|$)/i.exec(String(text || '').trim());
  if (!m) return '';
  const name = m[1].toLowerCase();
  if (BUILT_IN.has(name) || name.includes(':')) return '/' + name; // a plugin's "plugin:command" too
  const mine = custom(path.join(home, '.claude', 'commands'));
  if (cwd) for (const c of custom(path.join(cwd, '.claude', 'commands'))) mine.add(c);
  return mine.has(name) ? '/' + name : '';
}

module.exports = { slashCommand };
