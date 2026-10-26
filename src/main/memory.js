// "# always use pnpm" in a session's box: a note for its project's
// CLAUDE.md, which every session there reads, as the terminal's # does.
const fs = require('node:fs');
const path = require('node:path');

// The note in a message, or '' if it isn't one ("# " and then words).
function noteIn(text) {
  const m = /^#\s+(\S[\s\S]*)$/.exec(String(text || '').trim());
  return m && !/^#/.test(m[1]) ? m[1].replace(/\s+/g, ' ').trim() : '';
}

// Adds it as a bullet at the end of <dir>/CLAUDE.md (made if there's
// none). Returns the file.
function remember(dir, note) {
  const file = path.join(dir, 'CLAUDE.md');
  let before = '';
  try { before = fs.readFileSync(file, 'utf8'); } catch { /* a new one */ }
  const gap = !before ? '' : before.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${gap}- ${note}\n`);
  return file;
}

module.exports = { noteIn, remember };
