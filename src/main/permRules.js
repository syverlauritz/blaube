// What Claude Code lets a session do without asking ("Always allow" rules
// in its settings files), to see and take back without `/permissions` in
// the terminal.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Its settings files, the most local first.
function files(dirs, home = os.homedir()) {
  const out = [];
  for (const d of [...new Set(dirs.filter(Boolean))]) {
    out.push({ scope: 'This project, just you', file: path.join(d, '.claude', 'settings.local.json') });
    out.push({ scope: 'This project', file: path.join(d, '.claude', 'settings.json') });
  }
  out.push({ scope: 'You, everywhere', file: path.join(home, '.claude', 'settings.json') });
  return out.filter((f, i) => out.findIndex((g) => g.file === f.file) === i);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// [{ rule: 'Bash(npm test:*)', scope, file }]
function list(dirs, home) {
  const out = [];
  for (const f of files(dirs, home)) {
    const j = readJson(f.file);
    const allow = j && j.permissions && Array.isArray(j.permissions.allow) ? j.permissions.allow : [];
    for (const rule of allow) if (typeof rule === 'string') out.push({ rule, scope: f.scope, file: f.file });
  }
  return out;
}

// Takes one rule out of one file (everything else in it kept as it was).
// Returns whether it did.
function remove(file, rule) {
  const j = readJson(file);
  if (!j || !j.permissions || !Array.isArray(j.permissions.allow) || !j.permissions.allow.includes(rule)) return false;
  j.permissions.allow = j.permissions.allow.filter((r) => r !== rule);
  const tmp = `${file}.blaube-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return true;
}

// Lets it do something without asking: `rule` into `file`'s allow list
// (made if need be; everything else in it kept). Only a rule that looks
// like one: Tool or Tool(what). Returns whether it was added (false: it
// was there already). Throws if it can't.
const RULE = /^[A-Za-z][\w.-]*(?:\([^()\n]{1,300}\))?$/;
function add(file, rule) {
  rule = String(rule || '').trim();
  if (!RULE.test(rule)) throw new Error('that doesn’t look like a rule: Bash(npm test:*), Edit, WebFetch(domain:example.com)');
  let j = {};
  if (fs.existsSync(file)) { j = readJson(file); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`${file} isn’t settings Blaube can read`); }
  j.permissions = j.permissions && typeof j.permissions === 'object' ? j.permissions : {};
  const allow = Array.isArray(j.permissions.allow) ? j.permissions.allow : [];
  if (allow.includes(rule)) return false;
  j.permissions.allow = [...allow, rule];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.blaube-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return true;
}

// "Bash(npm test:*)" -> "npm test…" in Bash; "Edit" -> "Edit (anything)".
function label(rule) {
  const m = /^([\w.-]+)\((.*)\)$/.exec(rule);
  if (!m) return `${rule} (anything)`;
  const what = m[2].replace(/:\*$/, '…').replace(/\*$/, '…');
  return m[1] === 'Bash' ? `Run ${what}` : `${m[1]}: ${what}`;
}

module.exports = { files, list, remove, add, label };
