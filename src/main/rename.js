// Naming a session, as /rename does in the terminal: Claude Code keeps a
// session's name as a line in its transcript ({ type: 'custom-title' }),
// so Blaube writes the same line. `claude --resume` lists it by that name
// too, and so does everything in Blaube that shows its title.
const fs = require('node:fs');

// The name tidied (one line, at most 80 characters), or '' if there's none.
function clean(title) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? t.slice(0, 80).trim() : t;
}

// What follows /rename, or null if it isn't one.
function command(text) {
  const m = /^\/rename(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  return m ? clean(m[1]) : null;
}

// Names it. Returns the name used; throws if the transcript can't be written.
function rename(file, sessionId, title) {
  const name = clean(title);
  if (!name) throw new Error('no name given');
  if (!file || !fs.existsSync(file)) throw new Error('it has no transcript yet');
  fs.appendFileSync(file, JSON.stringify({ type: 'custom-title', customTitle: name, sessionId: String(sessionId) }) + '\n');
  return name;
}

module.exports = { clean, command, rename };
