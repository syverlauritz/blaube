// Claude Code's own defaults for new sessions (in ~/.claude/settings.json):
// the model they start on and how they ask before acting, picked from
// Blaube's menu instead of editing JSON in a terminal.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODES = [['default', 'Ask before acting'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan first']];
const fileOf = (home = os.homedir()) => path.join(home, '.claude', 'settings.json');

// { model, mode }: '' where Claude Code decides.
function read(home) {
  let j = null;
  try { j = JSON.parse(fs.readFileSync(fileOf(home), 'utf8')); } catch { /* none yet */ }
  return {
    model: j && typeof j.model === 'string' ? j.model : '',
    mode: j && j.permissions && typeof j.permissions.defaultMode === 'string' ? j.permissions.defaultMode : '',
  };
}

// Changes one or both ({ model, mode }; '' takes it back out), keeping
// everything else in the file as it was. False when the file isn't JSON
// Blaube can safely rewrite (it's left alone).
function write(change, home) {
  const file = fileOf(home);
  let j = {};
  if (fs.existsSync(file)) {
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  }
  if ('model' in change) { if (change.model) j.model = String(change.model); else delete j.model; }
  if ('mode' in change) {
    if (change.mode && !MODES.some(([m]) => m === change.mode)) return false;
    const p = j.permissions && typeof j.permissions === 'object' ? j.permissions : {};
    if (change.mode) p.defaultMode = change.mode; else delete p.defaultMode;
    if (Object.keys(p).length) j.permissions = p; else delete j.permissions;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.blaube-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return true;
}

module.exports = { read, write, MODES, fileOf };
