// Past Claude Code sessions on this computer, from their transcripts in
// ~/.claude/projects: which ones you could pick up again, and how their
// conversation ended (so a picked-up session's talk box isn't blank).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Reads up to `len` bytes of a file from `from` (negative: from the end).
function slice(file, from, len) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = from < 0 ? Math.max(0, size + from) : Math.min(from, size);
    const buf = Buffer.alloc(Math.min(len, size - start));
    fs.readSync(fd, buf, 0, buf.length, start);
    return { text: buf.toString('utf8'), whole: start === 0 && buf.length === size, cut: start > 0 };
  } catch { return { text: '', whole: true, cut: false }; } finally { if (fd != null) fs.closeSync(fd); }
}

const lines = (part) => {
  const all = part.text.split('\n');
  if (part.cut) all.shift(); // the first line started before what was read
  const out = [];
  for (const l of all) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* half a line */ } }
  return out;
};

// What a transcript line says, as a person would read it: what you typed
// (not tool results, commands or reminders) or Claude's words.
function said(e) {
  if (!e || e.isSidechain || e.isMeta || !e.message) return null;
  const c = e.message.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : '';
  if (!text.trim()) return null;
  const at = Date.parse(e.timestamp);
  const when = at ? { at } : {}; // (when it was said, if the transcript says)
  if (e.type === 'user') {
    if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return null;
    if (/^\s*</.test(text)) return null; // <command-name>, <local-command-stdout>, <task-notification>...
    return Object.assign({ who: 'you', text: text.trim() }, when, typeof e.uuid === 'string' ? { uuid: e.uuid } : {}); // (uuid: to go back to before it)
  }
  if (e.type === 'assistant') return Object.assign({ who: 'claude', text: text.trim() }, when);
  return null;
}

// The last `n` things said in a session, oldest first. Claude's words in
// one turn come in several pieces; only the last of a run is kept (that's
// its answer).
function recentMessages(file, n = 6) {
  const out = [];
  for (const e of lines(slice(file, -(1 << 20), 1 << 20))) {
    const m = said(e);
    if (!m) continue;
    if (m.who === 'claude' && out.length && out[out.length - 1].who === 'claude') out[out.length - 1] = m;
    else out.push(m);
  }
  return out.slice(-n);
}

// Its folder and title, from the start and end of its transcript.
function describe(file) {
  const head = lines(slice(file, 0, 64 << 10));
  const tail = lines(slice(file, -(256 << 10), 256 << 10));
  let cwd = '', title = '', first = '';
  for (const e of head) {
    if (!cwd && e.cwd) cwd = String(e.cwd);
    if (!first) { const m = said(e); if (m && m.who === 'you') first = m.text; }
  }
  let custom = '', ai = '';
  for (const e of [...head, ...tail]) {
    if (e.cwd) cwd = String(e.cwd);
    if (e.customTitle) custom = String(e.customTitle);
    if (e.aiTitle) ai = String(e.aiTitle);
  }
  title = custom || ai || first.split('\n')[0]; // a /rename wins, as in Claude Code
  if (!cwd) return null;
  return { cwd, title: title.length > 60 ? title.slice(0, 59) + '…' : title };
}

// The newest sessions you could pick up again (not `live` ones): [{ id,
// cwd, title, at }], newest first.
function pastSessions(live = new Set(), n = 8, home = os.homedir()) {
  const root = path.join(home, '.claude', 'projects');
  const found = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch { return []; }
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, d)); } catch { continue; }
    for (const f of names) {
      const id = f.replace(/\.jsonl$/, '');
      if (id === f || live.has(id) || !/^[0-9a-f-]{36}$/i.test(id)) continue;
      try { found.push({ id, file: path.join(root, d, f), at: fs.statSync(path.join(root, d, f)).mtimeMs }); } catch { /* gone */ }
    }
  }
  found.sort((a, b) => b.at - a.at);
  const out = [];
  // (Only so many are opened to look inside: a menu has to be quick.)
  for (const s of found.slice(0, n * 4)) {
    if (out.length >= n) break;
    const info = describe(s.file);
    // (Nothing said in it yet: nothing to pick up.)
    if (info && info.title) out.push({ id: s.id, cwd: info.cwd, title: info.title, at: s.at, file: s.file });
  }
  return out;
}

// Past sessions that said something (⌘F in the overview, beyond the ones
// running now): newest first, [{ id, cwd, title, at, file, hits, snippet }].
// Looks at the `look` newest transcripts, the last 2 MB of each, without
// holding everything else up.
async function searchPast(q, live = new Set(), { n = 6, look = 40, home = os.homedir() } = {}) {
  q = String(q || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const root = path.join(home, '.claude', 'projects');
  const found = [];
  let dirs = [];
  try { dirs = await fs.promises.readdir(root); } catch { return []; }
  for (const d of dirs) {
    let names = [];
    try { names = await fs.promises.readdir(path.join(root, d)); } catch { continue; }
    for (const f of names) {
      const id = f.replace(/\.jsonl$/, '');
      if (id === f || live.has(id) || !/^[0-9a-f-]{36}$/i.test(id)) continue;
      try { found.push({ id, file: path.join(root, d, f), at: (await fs.promises.stat(path.join(root, d, f))).mtimeMs }); } catch { /* gone */ }
    }
  }
  found.sort((a, b) => b.at - a.at);
  const out = [];
  for (const s of found.slice(0, look)) {
    let text = '', cut = false;
    try {
      const fh = await fs.promises.open(s.file, 'r');
      try {
        const size = (await fh.stat()).size, len = Math.min(size, 2 << 20);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, size - len);
        text = buf.toString('utf8'); cut = size > len;
      } finally { await fh.close(); }
    } catch { continue; }
    if (!text.toLowerCase().includes(q)) continue; // (most don't: skip the parsing)
    let hits = 0, snippet = '';
    const words = lines({ text, cut }).map(said).filter(Boolean);
    for (let i = words.length - 1; i >= 0; i--) {
      const t = words[i].text, at = t.toLowerCase().indexOf(q);
      if (at < 0) continue;
      hits++;
      if (!snippet) { const from = Math.max(0, at - 30); snippet = (from ? '…' : '') + t.slice(from, at + q.length + 50).replace(/\s+/g, ' ').trim() + (at + q.length + 50 < t.length ? '…' : ''); }
    }
    if (!hits) continue;
    const info = describe(s.file);
    if (info) out.push({ id: s.id, cwd: info.cwd, title: info.title, at: s.at, file: s.file, hits, snippet });
    if (out.length >= n) break;
  }
  return out;
}

// "5 min ago", "yesterday", "3 days ago".
function ago(at, now = Date.now()) {
  const m = Math.round((now - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

module.exports = { pastSessions, recentMessages, searchPast, ago, said };
