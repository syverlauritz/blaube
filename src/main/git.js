// A session's git status, read locally (`git status`), for its talk box:
// the branch, what's changed, what isn't pushed yet; and the one-tap
// requests that make sense from there (commit, push, open a PR...).
const { execFile } = require('node:child_process');

// `git status --porcelain=v2 --branch` -> { branch, ahead, behind, changed, untracked, upstream }
function parseStatus(out) {
  const st = { branch: '', ahead: 0, behind: 0, changed: 0, untracked: 0, upstream: false, conflicts: 0 };
  for (const line of String(out || '').split('\n')) {
    if (line.startsWith('# branch.head ')) st.branch = line.slice(14).trim() === '(detached)' ? '' : line.slice(14).trim();
    else if (line.startsWith('# branch.upstream ')) st.upstream = true;
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) { st.ahead = Number(m[1]); st.behind = Number(m[2]); }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) st.changed++;
    else if (line.startsWith('u ')) { st.changed++; st.conflicts++; }
    else if (line.startsWith('? ')) st.untracked++;
  }
  return st;
}

// "main · 3 changed · 2 to push"
function summary(st) {
  if (!st) return '';
  const n = st.changed + st.untracked;
  return [st.branch || 'detached', st.conflicts ? `${st.conflicts} conflict${st.conflicts === 1 ? '' : 's'}` : '', n ? `${n} changed` : '', st.ahead ? `${st.ahead} to push` : '', st.behind ? `${st.behind} behind` : ''].filter(Boolean).join(' · ');
}

const MAIN = /^(main|master|trunk|develop)$/;

// What you might want next, as { label, prompt }: only while it isn't busy.
// `more`: { failedTests: the test command that failed last turn,
// context: how full its context is, in %, canCompact }.
function quickActions(st, state, more = {}) {
  if (state === 'working' || state === 'waiting') return [];
  const out = [];
  if (more.failedTests) out.push({ label: 'Fix the tests', prompt: `The tests failed (\`${more.failedTests}\`). Fix them, then run them again and tell me what was wrong.` });
  const n = st ? st.changed + st.untracked : 0;
  if (st && st.conflicts) out.push({ label: 'Fix conflicts', prompt: 'There are merge conflicts. Resolve them, keeping both sides’ intent, then tell me what you chose.' });
  if (n) out.push({ label: 'Commit', prompt: 'Commit the current changes with a clear message (split them into a few commits if they are unrelated).' });
  // (A branch that was never pushed has no upstream to count from.)
  const unpushed = st && st.branch && !st.upstream && !MAIN.test(st.branch);
  if (st && !n && (st.ahead || unpushed)) out.push({ label: 'Push', prompt: unpushed ? 'Push this branch and set its upstream.' : 'Push this branch.' });
  if (st && st.branch && !MAIN.test(st.branch)) out.push({ label: 'Open a PR', prompt: 'Open a pull request for this branch (commit and push first if needed) and give me the link.' });
  if (!more.failedTests) out.push({ label: 'Run tests', prompt: 'Run the tests and tell me what fails, if anything.' });
  if (st && st.behind) out.push({ label: 'Pull', prompt: 'Pull the latest changes into this branch and tell me if anything conflicts.' });
  // Nearly out of room: tidy up before it has to (first, so it's seen).
  if (more.canCompact && more.context >= 80) out.unshift({ label: 'Compact', prompt: '/compact' });
  return out.slice(0, 4);
}

// Reads it (at most once every few seconds per folder).
// One git at a time per folder: callers that ask meanwhile get its answer.
const cache = new Map(); // cwd -> { at, st }
const asking = new Map(); // cwd -> [cb]
function status(cwd, cb, now = Date.now()) {
  const hit = cache.get(cwd);
  if (hit && now - hit.at < 4000) return cb(hit.st);
  if (asking.has(cwd)) { asking.get(cwd).push(cb); return; }
  asking.set(cwd, [cb]);
  execFile('git', ['status', '--porcelain=v2', '--branch'], { cwd, timeout: 3000, windowsHide: true }, (err, out) => {
    const st = err ? null : parseStatus(out);
    cache.set(cwd, { at: Date.now(), st });
    const waiting = asking.get(cwd) || [];
    asking.delete(cwd);
    for (const f of waiting) f(st);
  });
}

module.exports = { parseStatus, summary, quickActions, status };
