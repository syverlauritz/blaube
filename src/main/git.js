// A session's git status, read locally (`git status`), for its talk box:
// the branch, what's changed, what isn't pushed yet; and the one-tap
// requests that make sense from there (commit, push, open a PR...).
const fs = require('node:fs');
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
// 'pull' when that's what git last failed at here; install: the command
// that installs its packages when they need it (runs.needsInstall); env: the .env template to copy when its .env is missing (runs.needsEnv); carryAt: { at, label, set }
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
  // (Its packages aren't installed, or a pull brought new ones: installed
  // right there, no model call.)
  if (more.install) out.push({ label: 'Install packages', prompt: `Runs ${more.install} right here`, install: true });
  // (Its .env isn't there, its template is: copied for you to fill in.)
  if (more.env) out.push({ label: 'Make .env', prompt: `Copies ${more.env} to .env, for you to fill in`, env: true });
  const n = st ? st.changed + st.untracked : 0;
  if (st && st.conflicts) out.push({ label: 'Fix conflicts', prompt: 'There are merge conflicts. Resolve them, keeping both sides’ intent, then tell me what you chose.' });
  if (n && !(st && st.midway)) out.push({ label: 'Commit', prompt: 'Commit the current changes with a clear message (split them into a few commits if they are unrelated).' });
  // (A branch that was never pushed has no upstream to count from.)
  const unpushed = st && st.branch && !st.upstream && !MAIN.test(st.branch);
  // Push and Pull run git right there (no model call); if git couldn't
  // (`more.gitFailed`), the next tap asks Claude to sort it out instead.
  const direct = (run) => (more.gitFailed === run ? {} : { run });
  // (A merge or rebase midway, its conflicts settled: finished right there.)
  if (st && st.midway && !st.conflicts) out.unshift(Object.assign(st.midway === 'rebase' ? { label: 'Continue the rebase', prompt: 'A rebase is under way and its conflicts are settled: continue it (resolving any new conflicts, keeping both sides’ intent), then tell me what you chose.' } : { label: 'Finish the merge', prompt: 'A merge is under way and its conflicts are settled: finish it with a commit, then tell me what it brought in.' }, direct('finish')));
  // (Or called off, back to before it started: a second tap to be sure.)
  if (st && st.midway && more.gitFailed !== 'abort') out.splice(st.conflicts ? out.findIndex((q) => q.label === 'Fix conflicts') + 1 : 1, 0, { label: `Call off the ${st.midway}`, prompt: `Runs git ${st.midway} --abort right here: back to how it was before the ${st.midway} started`, run: 'abort', sure: 'Call it off?' });
  if (st && !n && (st.ahead || unpushed)) out.push(Object.assign({ label: 'Push', prompt: unpushed ? 'Push this branch and set its upstream.' : 'Push this branch.' }, direct('push')));
  // (Its pull request, if it has one (see pr.js): failing checks first.)
  const pr = more.pr && more.pr.state === 'OPEN' ? more.pr : null;
  if (pr && pr.review === 'CHANGES_REQUESTED') out.unshift({ label: 'Answer the review', prompt: `A reviewer asked for changes on pull request #${pr.number}. Read the review and its comments (\`gh pr view ${pr.number} --comments\`, and the inline ones with \`gh api repos/{owner}/{repo}/pulls/${pr.number}/comments\`), make the changes that are right, push, and tell me what you changed and anything you disagreed with.` });
  // (Merged: back to where it went, a step, no model call.)
  const merged = more.pr && more.pr.state === 'MERGED' && more.pr.base && st && st.branch && st.branch !== more.pr.base && !st.changed ? more.pr : null; // (new files go along)
  if (merged && more.gitFailed !== 'home') out.unshift({ label: `Back to ${merged.base}`, prompt: `Its pull request is merged: switches to ${merged.base}, pulls it, and deletes ${st.branch}`, run: 'home' });
  if (pr && pr.checks.fail) out.unshift({ label: 'Fix the checks', prompt: `The checks on pull request #${pr.number} are failing. Find out why (\`gh pr checks ${pr.number}\` and the failing run's log), fix it, push, and tell me what was wrong.` });
  if (st && st.branch && !MAIN.test(st.branch) && !pr && !merged) out.push({ label: 'Open a PR', prompt: 'Open a pull request for this branch (commit and push first if needed) and give me the link.' });
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
    // (A merge or rebase under way: 'merge' or 'rebase', from git's own files.)
    const midway = (dir) => { st.midway = !dir ? '' : ['rebase-merge', 'rebase-apply'].some((d) => fs.existsSync(path.join(dir, d))) ? 'rebase' : fs.existsSync(path.join(dir, 'MERGE_HEAD')) ? 'merge' : ''; };
    // Its files are named from the top of the repository: where that is.
    if (roots.has(cwd)) { st.root = roots.get(cwd); midway(gitDirs.get(cwd)); return done(st); }
    execFile('git', ['rev-parse', '--show-toplevel', '--absolute-git-dir'], { cwd, timeout: 3000, windowsHide: true }, (e2, top) => {
      const [root, dir] = e2 ? [] : String(top).trim().split('\n');
      st.root = root ? path.resolve(root.trim()) : '';
      if (st.root) { roots.set(cwd, st.root); gitDirs.set(cwd, dir ? dir.trim() : ''); }
      midway(dir && dir.trim());
      done(st);
    });
  });
}
const roots = new Map(); // cwd -> the top of its repository
const gitDirs = new Map(); // cwd -> its repository's .git folder

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
// Home: its pull request merged, back to the branch it went into, that
// brought up to date, and the merged one deleted: if git agrees it's merged
// (-d), or, squashed on GitHub, if it's still just what the PR had (its
// last commit the PR's: nothing of yours that GitHub doesn't have).
function command(run, st, pr = null, platform = process.platform) {
  if (run === 'push') return st && !st.upstream ? 'git push --set-upstream origin HEAD' : 'git push';
  if (run === 'pull') return 'git pull --ff-only';
  if (run === 'abort') return st && st.midway ? `git ${st.midway} --abort` : '';
  if (run === 'finish') return !st || !st.midway || st.conflicts ? '' : st.midway === 'rebase' ? 'git -c core.editor=true rebase --continue' : 'git commit --no-edit';
  if (run === 'home') {
    const base = pr && pr.state === 'MERGED' && branchName(pr.base), branch = st && branchName(st.branch);
    if (!base || !branch || base === branch) return '';
    const del = /^[0-9a-f]{40,64}$/.test(String(pr.head || '')) && platform !== 'win32'
      ? `{ git branch -d ${branch} 2>/dev/null || { [ "$(git rev-parse ${branch})" = ${pr.head} ] && git branch -D ${branch}; }; }`
      : `git branch -d ${branch}`;
    return `git switch ${base} && git pull --ff-only && ${del}`;
  }
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
// or main or master): cb({ base, files: [{ path, how }], stat, behind }) or null
// (behind: commits on its base it doesn't have yet)
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
      execFile('git', ['diff', '--shortstat', `${base}...HEAD`], { cwd, timeout: 5000, windowsHide: true }, (e3, stat) => {
        // (And how far its base has moved on since: commits it doesn't have.)
        execFile('git', ['rev-list', '--count', `HEAD..${base}`], { cwd, timeout: 5000, windowsHide: true }, (e4, n) => cb({ base, files, stat: e3 ? '' : String(stat).trim(), behind: e4 ? 0 : Number(String(n).trim()) || 0 }));
      });
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

// Throws away your changes to one file (a tap in its box, not `git restore`
// in a terminal), but into git's stash, so they can be put back. cb(error
// or ''). Not a file in a conflict, or one git moved (renamed).
const PUT_BACK = 'Blaube: put back ';
function discard(root, rel, how, cb) {
  if (!/^(changed|deleted|new)$/.test(how) || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return cb('Can’t discard that one');
  execFile('git', ['stash', 'push', '--include-untracked', '-m', PUT_BACK + rel, '--', rel], { cwd: root, timeout: 10000, windowsHide: true }, (err, out, errOut) => {
    forget(root);
    if (err) return cb(/initial commit/.test(String(out) + errOut) ? 'Nothing’s committed yet, so there’s nothing to go back to' : gitSaid(errOut) || 'git couldn’t discard it');
    if (/No local changes/i.test(String(out))) return cb('Nothing to discard');
    cb('');
  });
}
// Puts back the last one discarded, if it's still the newest stash.
function putBack(root, rel, cb) {
  execFile('git', ['stash', 'list', '-n', '1', '--format=%gs'], { cwd: root, timeout: 5000, windowsHide: true }, (err, out) => {
    if (err || !String(out).trim().endsWith(PUT_BACK + rel)) return cb('It isn’t the newest thing in git’s stash any more: `git stash list` has it');
    execFile('git', ['stash', 'pop', '--index'], { cwd: root, timeout: 10000, windowsHide: true }, (e2, _o, errOut) => {
      forget(root);
      cb(e2 ? (gitSaid(errOut) || 'git couldn’t put it back') : '');
    });
  });
}
// The newest commit taken back, its changes kept (`git reset --soft
// HEAD~1`), as long as it's pushed nowhere, isn't a merge and isn't the
// first: canUndo cb(bool), undoCommit cb(error or '').
function canUndo(cwd, hash, cb) {
  execFile('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd, timeout: 3000, windowsHide: true }, (err, out) => {
    const ids = String(out || '').trim().split(/\s+/);
    if (err || !/^[0-9a-f]{40,64}$/.test(String(hash)) || ids[0] !== hash || ids.length !== 2) return cb(false);
    execFile('git', ['branch', '-r', '--contains', 'HEAD'], { cwd, timeout: 3000, windowsHide: true }, (e2, remote) => cb(!e2 && !String(remote).trim()));
  });
}
function undoCommit(cwd, hash, cb) {
  canUndo(cwd, hash, (ok) => {
    if (!ok) return cb('It’s been pushed, or isn’t the newest commit any more');
    execFile('git', ['reset', '--soft', 'HEAD~1'], { cwd, timeout: 5000, windowsHide: true }, (err, _o, errOut) => {
      forget(cwd);
      cb(err ? gitSaid(errOut) || 'git couldn’t undo it' : '');
    });
  });
}
// Switching branches with changes: they're set aside on the branch they
// were made on (git's stash, named for it), and come back when you switch
// back to it. park cb(error or ''); unpark cb(error or '', whether any were).
const PARKED = 'Blaube: parked on ';
function park(cwd, branch, cb) {
  if (!branchName(branch)) return cb('It isn’t on a branch');
  execFile('git', ['stash', 'push', '-m', PARKED + branch], { cwd, timeout: 10000, windowsHide: true }, (err, _o, errOut) => {
    cache.delete(cwd);
    cb(err ? gitSaid(errOut) || 'git couldn’t set them aside' : '');
  });
}
// The branches that have changes set aside: cb([name]).
function parked(cwd, cb) {
  execFile('git', ['stash', 'list', '--format=%gs'], { cwd, timeout: 5000, windowsHide: true }, (err, out) => {
    if (err) return cb([]);
    const names = String(out).split('\n').map((l) => { const i = l.indexOf(PARKED); return i < 0 ? '' : branchName(l.slice(i + PARKED.length)); }).filter(Boolean);
    cb([...new Set(names)]);
  });
}
function unpark(cwd, branch, cb) {
  execFile('git', ['stash', 'list', '--format=%gd%x1f%gs'], { cwd, timeout: 5000, windowsHide: true }, (err, out) => {
    const line = !err && String(out).split('\n').find((l) => l.split('\x1f')[1] && l.split('\x1f')[1].endsWith(PARKED + branch));
    if (!line) return cb('', false);
    const ref = line.split('\x1f')[0];
    if (!/^stash@\{\d+\}$/.test(ref)) return cb('', false);
    execFile('git', ['stash', 'pop', '--index', ref], { cwd, timeout: 10000, windowsHide: true }, (e2, _o, errOut) => {
      cache.delete(cwd);
      cb(e2 ? gitSaid(errOut) || 'git couldn’t bring them back' : '', true);
    });
  });
}
// What's new upstream, fetched quietly (`git fetch`), so "N behind" and
// Pull show without you fetching: never asking for a password, at most
// every few minutes per repository. `asked`: you opened its box (any
// remote); otherwise only an https one, so an ssh key's agent never pops
// up a prompt out of nowhere. cb(whether it fetched).
const fetched = new Map(); // root -> when
const remotes = new Map(); // root -> its remote's address
function fetchQuietly(root, cb, { asked = false, every = asked ? 2 * 60e3 : 10 * 60e3, now = Date.now(), byItself = /^https:\/\//i } = {}) {
  if (!root || (fetched.has(root) && now - fetched.get(root) < every)) return cb(false);
  const known = remotes.get(root);
  if (known != null && !asked && !byItself.test(known)) return cb(false); // (no git asked for it)
  execFile('git', ['ls-remote', '--get-url'], { cwd: root, timeout: 3000, windowsHide: true }, (e1, url) => {
    url = e1 ? '' : String(url || '').trim();
    remotes.set(root, url);
    if (!url || (!asked && !byItself.test(url))) return cb(false);
    fetched.set(root, now);
    const env = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' });
    execFile('git', ['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head'], { cwd: root, env, timeout: 30000, windowsHide: true }, (err) => {
      for (const [cwd, r] of roots) if (r === root) cache.delete(cwd);
      cache.delete(root);
      cb(!err);
    });
  });
}
// A file in conflict, settled one way: your version or theirs (`git
// checkout --ours/--theirs`, then `git add`; or `git rm` when that side
// deleted it). During a rebase git's "ours" is the branch it's rebasing
// onto, so yours is its "theirs". cb(error or '').
function settle(root, rel, side, cb) {
  if (!['mine', 'theirs'].includes(side) || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return cb('Can’t settle that one');
  const o = { cwd: root, timeout: 5000, windowsHide: true };
  const done = (err, errOut, what) => { forget(root); cb(err ? gitSaid(errOut) || what : ''); };
  execFile('git', ['rev-parse', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply'], o, (e0, out) => {
    const rebase = !e0 && String(out).split('\n').filter(Boolean).some((p) => fs.existsSync(path.resolve(root, p)));
    execFile('git', ['checkout', (side === 'mine') !== rebase ? '--ours' : '--theirs', '--', rel], o, (err, _o, errOut) => {
      if (err && /does not have (our|their) version/.test(errOut)) return execFile('git', ['rm', '-q', '--', rel], o, (e2, _o2, errOut2) => done(e2, errOut2, 'git couldn’t delete it'));
      if (err) return done(err, errOut, 'git couldn’t keep that version');
      execFile('git', ['add', '--', rel], o, (e2, _o2, errOut2) => done(e2, errOut2, 'git couldn’t mark it settled'));
    });
  });
}
const gitSaid = (errOut) => (String(errOut || '').split('\n').find((l) => /^(fatal|error):/.test(l)) || '').replace(/^(fatal|error):\s*/, '');

module.exports = { settle, fetchQuietly, park, parked, unpark, canUndo, undoCommit, discard, putBack, parseStatus, summary, quickActions, status, compactDiff, diff, branchName, branches, switchTo, command, forget, commits, commitText, show, parseNameStatus, branchChanges, branchDiff };
