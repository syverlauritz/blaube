// What a session has changed but not committed yet, from git in its folder:
// { files, add, del } (files changed, new or deleted; lines added and taken out) (null outside a repository). Read in the background
// and cached; asked again at most every few seconds per folder.

const { execFile } = require('child_process');

// `git diff --shortstat HEAD` -> { files, add, del }.
function parseShortstat(out) {
  const n = (re) => { const m = re.exec(out); return m ? Number(m[1]) : 0; };
  return { files: n(/(\d+) files? changed/), add: n(/(\d+) insertions?/), del: n(/(\d+) deletions?/) };
}

// `git status --porcelain` -> how many files are changed, new or gone.
function changedIn(out) {
  return String(out).split('\n').filter((l) => l.trim()).length;
}

function createGitChanges({ run = execFile, now = Date.now, every = 8000 } = {}) {
  const cache = new Map(); // cwd -> { at, busy, value }
  const git = (cwd, args, done) => run('git', ['-C', cwd, ...args], { timeout: 3000, windowsHide: true }, (err, out) => done(err ? null : String(out)));
  return {
    get(cwd) { const c = cache.get(cwd); return c ? c.value : null; },
    // Re-read it (unless it was just read); done(changed) when it's in.
    refresh(cwd, done = () => {}, force = false) {
      if (!cwd) return;
      const c = cache.get(cwd) || { at: -Infinity, busy: false, value: null };
      cache.set(cwd, c);
      if (c.busy || (!force && now() - c.at < every)) return;
      c.busy = true; c.at = now();
      git(cwd, ['status', '--porcelain'], (status) => {
        if (status === null) { c.busy = false; const was = c.value; c.value = null; done(was !== null); return; } // (not a repository)
        // Lines added and taken out (none to compare with before a first commit).
        git(cwd, ['diff', '--shortstat', 'HEAD'], (diff) => {
          c.busy = false;
          const v = Object.assign(parseShortstat(diff || ''), { files: changedIn(status) });
          const was = c.value;
          c.value = v;
          done(!was || was.files !== v.files || was.add !== v.add || was.del !== v.del);
        });
      });
    },
    forget(keep) { for (const k of cache.keys()) if (!keep.has(k)) cache.delete(k); },
  };
}

module.exports = { createGitChanges, parseShortstat, changedIn };
