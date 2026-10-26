// Going back to before something you said (as Esc Esc does in the
// terminal): Claude Code can resume a conversation cut at any entry
// (--resume-session-at), so the cut goes at the entry your message
// followed, read from its transcript.
const fs = require('node:fs');

// The entry `uuid` (your message) came after: its id, null if it was the
// first, undefined if the transcript doesn't have it.
function before(file, uuid) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return undefined; }
  const at = text.indexOf(`"uuid":"${uuid}"`);
  if (at < 0) return undefined;
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at);
  try {
    const e = JSON.parse(text.slice(start, end < 0 ? undefined : end));
    return e.uuid === uuid ? (e.parentUuid || null) : undefined;
  } catch { return undefined; }
}

module.exports = { before };
