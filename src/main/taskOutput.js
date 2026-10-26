// What a session's background task (a dev server, a watcher) has printed,
// read straight from the file Claude Code writes it to, so seeing it needs
// neither the terminal nor asking Claude: <temp>/claude-<uid>/<project>/
// <session id>/tasks/<task id>.output.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SAFE = /^[\w.-]{1,128}$/;

// Where Claude Code keeps its temporary files (its own CLAUDE_CODE_TMPDIR
// if set, else the system's), for this user.
function roots(env = process.env) {
  const tops = [...new Set([env.CLAUDE_CODE_TMPDIR, os.tmpdir(), '/tmp', '/private/tmp'].filter(Boolean))];
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  return tops.flatMap((t) => (uid == null ? [path.join(t, 'claude')] : [path.join(t, `claude-${uid}`), path.join(t, 'claude')]));
}

const found = new Map(); // `${session}/${task}` -> file
function find(sessionId, taskId, opts = {}) {
  if (!SAFE.test(String(sessionId)) || !SAFE.test(String(taskId)) || sessionId === '..' || taskId === '..') return '';
  const key = `${sessionId}/${taskId}`;
  if (found.has(key) && fs.existsSync(found.get(key))) return found.get(key);
  for (const root of opts.roots || roots()) {
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const d of dirs) {
      const f = path.join(root, d, sessionId, 'tasks', `${taskId}.output`);
      try { if (fs.statSync(f).isFile()) { found.set(key, f); return f; } } catch { /* not here */ }
    }
  }
  return '';
}

// Its last lines (at most `max` bytes), without terminal colour codes, and
// how it ended if it has: { text, exited: code | null, cut }.
function tail(file, max = 16 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const n = Math.min(size, max);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    let text = buf.toString('utf8').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r(?!\n)/g, '\n');
    if (size > n) text = text.slice(text.indexOf('\n') + 1); // (from a whole line)
    const m = /\n?\[exited with code (-?\d+)\]\s*$/.exec(text);
    if (m) text = text.slice(0, m.index);
    return { text: text.replace(/\s+$/, ''), exited: m ? Number(m[1]) : null, cut: size > n };
  } catch { return null; } finally { if (fd != null) fs.closeSync(fd); }
}

module.exports = { find, tail, roots };
