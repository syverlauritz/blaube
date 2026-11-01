// Writes a file whole or not at all: to a temporary file beside it, then
// renamed over it, so a crash or a full disk halfway never leaves half a
// settings file (Claude Code can't start with a broken settings.json).
// A file that's a link (dotfiles kept in a repo, say) is written where it
// points, so the link stays a link; its permissions are kept.
const fs = require('node:fs');
const path = require('node:path');

function writeWhole(file, text) {
  let target = file, mode;
  try { target = fs.realpathSync(file); mode = fs.statSync(target).mode & 0o777; } catch { /* new */ }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.blaube-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    // (Windows won't rename over a file another program has open: then
    // straight over it, as before.)
    try { fs.unlinkSync(tmp); } catch { /* gone */ }
    if (e.code !== 'EPERM' && e.code !== 'EACCES' && e.code !== 'EBUSY') throw e;
    fs.writeFileSync(target, text);
  }
}

module.exports = { writeWhole };
