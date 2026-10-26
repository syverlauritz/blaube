// A session's git status, read locally (`git status`), for its talk box:
// the branch, what's changed, what isn't pushed yet; and the one-tap
// requests that make sense from there (commit, push, open a PR...).
const path = require('node:path');
const { execFile } = require('node:child_process');
const { signedOut } = require('./auth');

// `git status --porcelain=v2 --branch` -> { branch, ahead, behind, changed,
// untracked, upstream, conflicts, files: [{ path, how }] } (paths relative to
// the repository, the first 30; how: changed, new, deleted, renamed, conflict).
const FILES = 30;
function parseStatus(out) {
  const st = { branch: '', ahead: 0, behind: 0, changed: 0, untracked: 0, upstream: false, conflicts: 0, files: [] };
  const file = (p, how) => { if (p && st.files.length < FILES) st.files.push({ path: p, how }); };
  const field = (line, n) => line.split(' ').slice(n).join(' '); // (a path may have spaces)
  for (const line of String(out || '').split('\n')) {
    if (line.startsWith('# branch.head ')) st.branch = line.slice(14).trim() === '(detached)' ? '' : line.slice(14).trim();
    else if (line.startsWith('# branch.upstream ')) st.upstream = true;
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) { st.ahead = Number(m[1]); st.behind = Number(m[2]); }
    } else if (line.startsWith('1 ')) { st.changed++; file(field(line, 8), line[2] === 'A' ? 'new' : /D/.test(line.slice(2, 4)) ? 'deleted' : 'changed'); }
    else if (line.startsWith('2 ')) { st.changed++; file(field(line, 9).split('\t')[0], 'renamed'); }
    else if (line.startsWith('u ')) { st.changed++; st.conflicts++; file(field(line, 10), 'conflict'); }
    else if (line.startsWith('? ')) { st.untracked++; file(line.slice(2), 'new'); }
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
// `more`: { stopped: you stopped its last turn, runFailed: { command, tail }
// of a script the box ran that stopped with an error, failedTests: the test
// command that failed in it, context: how full its context is (%),
// apiError: its last turn ended on an API error; pr: its branch's pull
// request (pr.js); gitFailed: 'push' or
// 'pull' when that's what git last failed at here; carryAt: { at, label, set }
// when that was a usage limit that lifts then (set: it'll carry on by itself) }.
function quickActions(st, state, more = {}) {
  if (state === 'working' || state === 'waiting') return [];
  const out = [];
  if (more.stopped) out.push({ label: 'Carry on', prompt: 'Carry on where you stopped.' });
  else if (more.apiError && signedOut(more.apiError)) {
    // Signed out of Claude Code: sign in (in your browser), then try again.
    out.push({ label: 'Sign in', prompt: 'Signs Claude Code in, in your browser, as /login does', signIn: true });
    out.push({ label: 'Try again', prompt: 'Carry on where you left off.' });
  } else if (more.apiError) {
    // A usage limit: it can carry on by itself once the limit lifts.
    if (more.carryAt && more.carryAt.set) out.push({ label: `Don’t carry on at ${more.carryAt.label}`, prompt: 'It won’t carry on by itself', later: 0 });
    else if (more.carryAt) out.push({ label: `Carry on at ${more.carryAt.label}`, prompt: 'Carries on by itself when your usage limit lifts', later: more.carryAt.at });
    out.push({ label: 'Try again', prompt: 'Carry on where you left off.' });
  }
  // (A dev server it runs from the box that stopped with an error: its last
  // lines go along.)
  if (more.runFailed) out.push({ label: 'Fix it', prompt: `\`${more.runFailed.command}\` stopped with an error. Its last lines:\n\n\`\`\`\n${more.runFailed.tail}\n\`\`\`\n\nFind out why and fix it, then tell me what was wrong.` });
  if (more.failedTests) out.push({ label: 'Fix the tests', prompt: `The tests failed (\`${more.failedTests}\`). Fix them, then run them again and tell me what was wrong.` });
  const n = st ? st.changed + st.untracked : 0;
  if (st && st.conflicts) out.push({ label: 'Fix conflicts', prompt: 'There are merge conflicts. Resolve them, keeping both sides’ intent, then tell me what you chose.' });
  if (n) out.push({ label: 'Commit', prompt: 'Commit the current changes with a clear message (split them into a few commits if they are unrelated).' });
  // (A branch that was never pushed has no upstream to count from.)
  const unpushed = st && st.branch && !st.upstream && !MAIN.test(st.branch);
  // Push and Pull run git right there (no model call); if git couldn't
  // (`more.gitFailed`), the next tap asks Claude to sort it out instead.
  const direct = (run) => (more.gitFailed === run ? {} : { run });
  if (st && !n && (st.ahead || unpushed)) out.push(Object.assign({ label: 'Push', prompt: unpushed ? 'Push this branch and set its upstream.' : 'Push this branch.' }, direct('push')));
  // (Its pull request, if it has one (see pr.js): failing checks first.)
  const pr = more.pr && more.pr.state === 'OPEN' ? more.pr : null;
  if (pr && pr.review === 'CHANGES_REQUESTED') out.unshift({ label: 'Answer the review', prompt: `A reviewer asked for changes on pull request #${pr.number}. Read the review and its comments (\`gh pr view ${pr.number} --comments\`, and the inline ones with \`gh api repos/{owner}/{repo}/pulls/${pr.number}/comments\`), make the changes that are right, push, and tell me what you changed and anything you disagreed with.` });
  if (pr && pr.checks.fail) out.unshift({ label: 'Fix the checks', prompt: `The checks on pull request #${pr.number} are failing. Find out why (\`gh pr checks ${pr.number}\` and the failing run's log), fix it, push, and tell me what was wrong.` });
  if (st && st.branch && !MAIN.test(st.branch) && !pr) out.push({ label: 'Open a PR', prompt: 'Open a pull request for this branch (commit and push first if needed) and give me the link.' });
  if (!more.failedTests) out.push({ label: 'Run tests', prompt: 'Run the tests and tell me what fails, if anything.' });
  if (st && st.behind) out.push(Object.assign({ label: 'Pull', prompt: 'Pull the latest changes into this branch and tell me if anything conflicts.' }, n ? {} : direct('pull')));
  // Nearly out of room: tidy up before it has to (first, so it's seen).
  if (more.context >= 80) out.unshift({ label: 'Compact', prompt: '/compact' });
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
  const done = (st) => {
    cache.set(cwd, { at: Date.now(), st });
    const waiting = asking.get(cwd) || [];
    asking.delete(cwd);
    for (const f of waiting) f(st);
  };
  execFile('git', ['status', '--porcelain=v2', '--branch', '--untracked-files=all'], { cwd, timeout: 3000, windowsHide: true }, (err, out) => {
    if (err) return done(null);
    const st = parseStatus(out);
    // Its files are named from the top of the repository: where that is.
    if (roots.has(cwd)) { st.root = roots.get(cwd); return done(st); }
    execFile('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 3000, windowsHide: true }, (e2, top) => {
      st.root = e2 ? '' : path.resolve(String(top).trim());
      if (st.root) roots.set(cwd, st.root);
      done(st);
    });
  });
}
const roots = new Map(); // cwd -> the top of its repository

// What changed in one file, for the talk box: the diff against the last
// commit without its headers (a new file: its start). Calls back with text.
const DIFF = 6000;
function compactDiff(text) {
  const out = String(text || '').split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(l)).join('\n').replace(/\s+$/, '');
  return out.length > DIFF ? out.slice(0, DIFF) + '\n…' : out;
}
function diff(root, rel, how, cb) {
  const fs = require('node:fs');
  const file = path.join(root, rel);
  if (how === 'new') {
    fs.readFile(file, (err, buf) => {
      if (err) return cb('');
      if (buf.subarray(0, 8000).includes(0)) return cb('(not text)');
      const t = buf.toString('utf8', 0, Math.min(buf.length, DIFF));
      cb(t.replace(/\n$/, '').split('\n').map((l) => '+' + l).join('\n') + (buf.length > DIFF ? '\n…' : ''));
    });
    return;
  }
  execFile('git', ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--', rel], { cwd: root, timeout: 4000, maxBuffer: 4e6, windowsHide: true }, (err, out) => cb(err ? '' : compactDiff(out) || '(no changes in the text)'));
}

// What Push and Pull run (fixed commands: nothing of yours in them). A
// branch that was never pushed goes up to origin under its own name.
function command(run, st) {
  if (run === 'push') return st && !st.upstream ? 'git push --set-upstream origin HEAD' : 'git push';
  if (run === 'pull') return 'git pull --ff-only';
  return '';
}
// Its latest commits, newest first: [{ hash, short, at, subject }].
function commits(cwd, cb, n = 6) {
  execFile('git', ['log', `-n${n}`, '--no-color', '--format=%H%x1f%h%x1f%ct%x1f%s'], { cwd, timeout: 3000, windowsHide: true }, (err, out) => {
    if (err) return cb([]);
    cb(String(out).split('\n').filter(Boolean).map((l) => { const [hash, short, at, subject] = l.split('\x1f'); return { hash, short, at: Number(at) * 1000, subject: subject || '' }; }));
  });
}
// What a commit changed, for the git line: its message, then each file's
// diff under its name (`── src/a.js`), without the rest of the headers.
function commitText(out) {
  const lines = [];
  for (const l of String(out || '').split('\n')) {
    const m = /^diff --git a\/.* b\/(.*)$/.exec(l);
    if (m) { lines.push('', `── ${m[1]}`); continue; }
    if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) |old mode|new mode)/.test(l)) continue;
    lines.push(l);
  }
  const t = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  return t.length > DIFF * 2 ? t.slice(0, DIFF * 2) + '\n…' : t;
}
function show(cwd, hash, cb) {
  if (!/^[0-9a-f]{7,40}$/.test(String(hash))) return cb('');
  execFile('git', ['show', '--no-color', '--no-ext-diff', '--format=%B', hash], { cwd, timeout: 4000, maxBuffer: 8e6, windowsHide: true }, (err, out) => cb(err ? '' : commitText(out)));
}

// What its branch changed since it left its base (origin's default branch,
// or main or master): cb({ base, files: [{ path, how }], stat }) or null
// (on the base itself, or no base found).
function baseOf(cwd, cb) {
  execFile('git', ['rev-parse', '--abbrev-ref', 'origin/HEAD'], { cwd, timeout: 3000, windowsHide: true }, (err, out) => {
    const remote = !err && String(out).trim();
    const tries = [remote, 'main', 'master', 'origin/main', 'origin/master'].filter((b) => b && /^[\w./-]+$/.test(b) && !b.startsWith('-'));
    const next = (i) => {
      if (i >= tries.length) return cb('');
      execFile('git', ['rev-parse', '--verify', '--quiet', tries[i]], { cwd, timeout: 3000, windowsHide: true }, (e2) => (e2 ? next(i + 1) : cb(tries[i])));
    };
    next(0);
  });
}
function parseNameStatus(out) {
  return String(out || '').split('\n').filter(Boolean).slice(0, 60).map((l) => {
    const [code, ...rest] = l.split('\t');
    const how = /^A/.test(code) ? 'new' : /^D/.test(code) ? 'deleted' : /^R/.test(code) ? 'renamed' : 'changed';
    return { path: rest[rest.length - 1] || '', how };
  }).filter((f) => f.path);
}
function branchChanges(cwd, branch, cb) {
  baseOf(cwd, (base) => {
    if (!base || !branch || base === branch || base.endsWith('/' + branch)) return cb(null);
    execFile('git', ['diff', '--name-status', '--no-color', `${base}...HEAD`], { cwd, timeout: 5000, maxBuffer: 4e6, windowsHide: true }, (err, out) => {
      if (err) return cb(null);
      const files = parseNameStatus(out);
      execFile('git', ['diff', '--shortstat', `${base}...HEAD`], { cwd, timeout: 5000, windowsHide: true }, (e3, stat) => cb({ base, files, stat: e3 ? '' : String(stat).trim() }));
    });
  });
}
// One file's change on its branch (`base` from branchChanges, `rel` one of
// its files): the diff without its headers.
function branchDiff(cwd, base, rel, cb) {
  if (!/^[\w./-]+$/.test(String(base)) || String(base).startsWith('-')) return cb('');
  execFile('git', ['diff', '--no-color', '--no-ext-diff', `${base}...HEAD`, '--', rel], { cwd, timeout: 5000, maxBuffer: 4e6, windowsHide: true }, (err, out) => cb(err ? '' : compactDiff(out) || '(no changes in the text)'));
}

// Forgets what it read (something just changed it).
function forget(cwd) { cache.delete(cwd); }

// Branches, from the git line: which there are, and switching to one (or a
// new one) without a terminal. Names are checked here as git would (no
// leading -, no .., no spaces...), and git runs without a shell.
function branchName(name) {
  name = String(name || '').trim();
  if (!name || name.length > 200 || name.startsWith('-') || name === '@') return '';
  if (!/^[\w.\/@+-]+$/.test(name) || /\.\.|\/\/|@\{|^\/|\/$|\.$|\.lock$|(^|\/)\./.test(name)) return '';
  return name;
}
// Local branches, the most recently committed to first (the first 30).
function branches(cwd, cb) {
  execFile('git', ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'], { cwd, timeout: 3000, windowsHide: true }, (err, out) => {
    if (err) return cb([]);
    cb(String(out).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 30));
  });
}
// Calls back with '' once it's on `name` (made from here when `create`), or
// what git said was wrong.
function switchTo(cwd, name, create, cb) {
  const b = branchName(name);
  if (!b) return cb('That isn’t a name a branch can have');
  execFile('git', create ? ['switch', '-c', b] : ['switch', '--no-guess', b], { cwd, timeout: 10000, windowsHide: true }, (err, _out, errText) => {
    cache.delete(cwd);
    if (!err) return cb('');
    const lines = String(errText || err.message || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const said = lines.find((l) => /^(fatal|error):/.test(l)) || lines[0] || 'git couldn’t switch';
    cb(said.replace(/^(fatal|error):\s*/, ''));
  });
}

module.exports = { parseStatus, summary, quickActions, status, compactDiff, diff, branchName, branches, switchTo, command, forget, commits, commitText, show, parseNameStatus, branchChanges, branchDiff };
