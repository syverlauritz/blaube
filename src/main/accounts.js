// Your Claude Code accounts on this computer. Claude Code keeps each sign-in
// in a config folder: ~/.claude unless CLAUDE_CONFIG_DIR says another, which
// is how two accounts (work and personal, say) live side by side, each with
// its own command in your shell. Blaube looks for ~/.claude and every
// ~/.claude-<name> folder, and starts, connects and signs in each one with
// its own folder, so one account's sign-in never lands in the other's.
// Nothing here calls a model or reads a token: the email is what Claude Code
// itself wrote next to its settings.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };

// The default folder is '' (Claude Code's own default, ~/.claude).
function defaultDir(home = os.homedir()) { return path.join(home, '.claude'); }

// Claude Code's own state file for a folder: ~/.claude.json for the
// default one, <folder>/.claude.json for any other.
function stateFile(dir, home = os.homedir()) {
  return !dir || path.resolve(dir) === defaultDir(home) ? path.join(home, '.claude.json') : path.join(dir, '.claude.json');
}

// Who it was last signed in as, from that file ('' if not known).
function emailOf(dir, home = os.homedir()) {
  try {
    const a = JSON.parse(fs.readFileSync(stateFile(dir, home), 'utf8')).oauthAccount || {};
    return String(a.emailAddress || '');
  } catch { return ''; }
}

// A folder Claude Code has used (not just any folder named .claude-x).
const looksUsed = (dir) => ['settings.json', '.claude.json', 'projects', '.credentials.json'].some((f) => exists(path.join(dir, f)));

// [{ dir: '' | absolute folder, name, email }]: the default first, then the
// others by name. name: "personal" for ~/.claude-personal; "default" for
// ~/.claude.
function list(home = os.homedir()) {
  const out = [{ dir: '', name: 'default', email: emailOf('', home) }];
  let names = [];
  try { names = fs.readdirSync(home).filter((n) => /^\.claude-[^.]/.test(n)).sort(); } catch { /* none */ }
  for (const n of names) {
    const dir = path.join(home, n);
    if (!isDir(dir) || !looksUsed(dir)) continue;
    out.push({ dir, name: n.slice('.claude-'.length), email: emailOf(dir, home) });
  }
  return out;
}

// What a menu or dialog calls it: "personal (you@example.com)".
const label = (a) => `${a.dir ? a.name : 'Default (~/.claude)'}${a.email ? ` · ${a.email}` : ''}`;

// The environment changes for running Claude Code as this account.
const envFor = (dir) => (dir ? { CLAUDE_CONFIG_DIR: dir } : {});

// Its settings file, where Blaube's hooks go.
const settingsOf = (dir, home = os.homedir()) => path.join(dir || defaultDir(home), 'settings.json');

// The account a session belongs to, from where its transcript is
// (<folder>/projects/...): '' for the default one, or one not known.
function dirOfTranscript(file, home = os.homedir()) {
  const m = /^(.*?)[\\/]projects[\\/]/.exec(String(file || ''));
  if (!m) return '';
  const dir = path.resolve(m[1]);
  return dir === defaultDir(home) || path.dirname(dir) !== path.resolve(home) || !/^\.claude-./.test(path.basename(dir)) ? '' : dir;
}

module.exports = { list, label, envFor, settingsOf, emailOf, stateFile, dirOfTranscript, defaultDir };
