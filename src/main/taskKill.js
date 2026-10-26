// Stops a background task of a session in a terminal, without asking
// Claude: the processes writing to its output file (lsof), as long as they
// are that session's own (its claude process's descendants). Not on
// Windows (no lsof): the box asks Claude there.
const { execFile } = require('node:child_process');

// "pid ppid" lines (ps -A -o pid=,ppid=) -> Map pid -> ppid
function parents(text) {
  const map = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)/.exec(line);
    if (m) map.set(Number(m[1]), Number(m[2]));
  }
  return map;
}

// Is `pid` a descendant of `root`?
function under(map, pid, root) {
  for (let p = map.get(pid), n = 0; p && n < 64; p = map.get(p), n++) if (p === root) return true;
  return false;
}

// cb(stopped: number of processes signalled, or 0 if it couldn't)
function stop(file, root, cb, opts = {}) {
  if (process.platform === 'win32' || !file || !(root > 1)) return cb(0);
  execFile('lsof', ['-t', '--', file], { timeout: 3000 }, (err, out) => {
    const pids = [...new Set(String(out || '').split(/\s+/).map(Number).filter((p) => p > 1))];
    if (!pids.length) return cb(0);
    execFile('ps', ['-A', '-o', 'pid=,ppid='], { timeout: 3000 }, (e2, ps) => {
      if (e2) return cb(0);
      const map = parents(ps);
      const mine = pids.filter((p) => p !== root && p !== process.pid && under(map, p, root));
      let n = 0;
      for (const p of mine) { try { (opts.kill || process.kill)(p, 'SIGTERM'); n++; } catch { /* gone */ } }
      cb(n);
    });
  });
}

module.exports = { stop, parents, under };
