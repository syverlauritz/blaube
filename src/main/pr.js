// A branch's pull request on GitHub, from the GitHub CLI you're signed in
// to (`gh pr view`): its number, whether its checks pass, what reviewers
// said. Blaube holds no token of its own; without gh it just isn't shown.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

// Apps opened from Finder don't get your shell's PATH: look where gh is
// usually installed first.
function findGh() {
  const home = os.homedir();
  const places = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe')]
    : ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', path.join(home, '.local', 'bin', 'gh')];
  return places.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || 'gh';
}

const FIELDS = 'number,url,state,isDraft,title,reviewDecision,statusCheckRollup,baseRefName,headRefOid';

// `gh pr view --json …` -> { number, url, state, draft, title, review,
// checks: { pass, fail, pending }, base (the branch it goes into), head (its
// last commit) }, or null.
function parse(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j.number !== 'number' || !/^https:\/\//.test(String(j.url || ''))) return null;
  const checks = { pass: 0, fail: 0, pending: 0 };
  for (const c of Array.isArray(j.statusCheckRollup) ? j.statusCheckRollup : []) {
    const how = String((c && (c.conclusion || c.state || c.status)) || '').toUpperCase();
    if (c && c.status && String(c.status).toUpperCase() !== 'COMPLETED' && !c.conclusion) checks.pending++;
    else if (/^(SUCCESS|NEUTRAL|SKIPPED)$/.test(how)) checks.pass++;
    else if (/^(FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED|STARTUP_FAILURE)$/.test(how)) checks.fail++;
    else checks.pending++;
  }
  return { number: j.number, url: String(j.url), state: String(j.state || 'OPEN').toUpperCase(), draft: !!j.isDraft, title: String(j.title || ''), review: String(j.reviewDecision || '').toUpperCase(), checks, base: /^[\w][\w./-]{0,100}$/.test(String(j.baseRefName || '')) && !/\.\./.test(j.baseRefName) ? String(j.baseRefName) : '', head: /^[0-9a-f]{40,64}$/.test(String(j.headRefOid || '')) ? String(j.headRefOid) : '' };
}

// How it stands, in a few words: "PR #12 · checks failing".
function words(pr) {
  if (!pr) return '';
  const n = `PR #${pr.number}`;
  if (pr.state === 'MERGED') return `${n} merged`;
  if (pr.state === 'CLOSED') return `${n} closed`;
  const c = pr.checks;
  const how = c.fail ? `${c.fail} check${c.fail === 1 ? '' : 's'} failing`
    : c.pending ? 'checks running'
    : pr.review === 'CHANGES_REQUESTED' ? 'changes requested'
    : pr.review === 'APPROVED' ? (c.pass ? 'approved, checks pass' : 'approved')
    : c.pass ? 'checks pass' : '';
  return [pr.draft ? `${n} (draft)` : n, how].filter(Boolean).join(' · ');
}

// What changed worth saying aloud (by its slime), from `was` to `now`.
function news(was, now) {
  if (!was || !now || was.number !== now.number) return '';
  if (was.state !== 'MERGED' && now.state === 'MERGED') return `PR #${now.number} is merged`;
  if (was.checks.pending && !now.checks.pending) return now.checks.fail ? `PR #${now.number}: ${now.checks.fail} check${now.checks.fail === 1 ? '' : 's'} failed` : `PR #${now.number}: checks passed`;
  if (was.review !== now.review && now.review === 'APPROVED') return `PR #${now.number} is approved`;
  if (was.review !== now.review && now.review === 'CHANGES_REQUESTED') return `PR #${now.number}: changes requested`;
  return '';
}

// Looks it up (at most once a minute per folder and branch). cb(pr or null).
const MAIN = /^(main|master|trunk|develop)$/;
const cache = new Map(); // `${cwd}\n${branch}` -> { at, pr }
const asking = new Map();
function look(cwd, branch, cb, { run = execFile, bin = findGh(), now = Date.now(), fresh = 60e3 } = {}) {
  if (!cwd || !branch || MAIN.test(branch)) return cb(null);
  const key = `${cwd}\n${branch}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < fresh) return cb(hit.pr);
  if (asking.has(key)) { asking.get(key).push(cb); return; }
  asking.set(key, [cb]);
  const done = (err, out) => {
    const pr = err ? null : parse(out);
    // (No gh, not signed in, no PR: asked again in a while, not every time.)
    cache.set(key, { at: Date.now(), pr });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    const waiting = asking.get(key) || [];
    asking.delete(key);
    for (const f of waiting) f(pr);
  };
  // (A gh this system can't run, say a script on Windows, throws right
  // away instead of calling back.)
  try {
    run(bin, ['pr', 'view', '--json', FIELDS], { cwd, timeout: 10000, windowsHide: true, env: Object.assign({}, process.env, { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }) }, done);
  } catch (e) { done(e); }
}
function known(cwd, branch) { const hit = cache.get(`${cwd}\n${branch}`); return hit ? hit.pr : undefined; }
function forget(cwd, branch) { cache.delete(`${cwd}\n${branch}`); }

module.exports = { findGh, parse, words, news, look, known, forget };
