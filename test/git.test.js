const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseStatus, summary, quickActions, status } = require('../src/main/git.js');

const OUT = `# branch.oid 4b89ff7
# branch.head feature/talk
# branch.upstream origin/feature/talk
# branch.ab +2 -1
1 .M N... 100644 100644 100644 a b src/a.js
2 R. N... 100644 100644 100644 a b R100 src/b.js\tsrc/old.js
u UU N... 100644 100644 100644 100644 a b c src/c.js
? notes.md
`;

test('git status is read the way you would say it', () => {
  const st = parseStatus(OUT);
  assert.deepEqual(st, { branch: 'feature/talk', ahead: 2, behind: 1, changed: 3, untracked: 1, upstream: true, conflicts: 1, files: [
    { path: 'src/a.js', how: 'changed' }, { path: 'src/b.js', how: 'renamed' }, { path: 'src/c.js', how: 'conflict' }, { path: 'notes.md', how: 'new' },
  ] });
  assert.deepEqual(parseStatus('1 A. N... 100644 100644 100644 a b my file.js\n1 .D N... 100644 100644 000000 a b gone.js\n').files, [{ path: 'my file.js', how: 'new' }, { path: 'gone.js', how: 'deleted' }]);
  assert.equal(summary(st), 'feature/talk · 1 conflict · 4 changed · 2 to push · 1 behind');
  assert.equal(summary(parseStatus('# branch.head main\n')), 'main');
});

test('quick actions fit the moment, and never while it works', () => {
  const labels = (st, state = 'done') => quickActions(st, state).map((a) => a.label);
  assert.deepEqual(labels(parseStatus(OUT)), ['Fix conflicts', 'Commit', 'Open a PR', 'Run tests']);
  assert.deepEqual(labels(parseStatus('# branch.head main\n# branch.ab +1 -0\n')), ['Push', 'Run tests']);
  assert.deepEqual(labels(parseStatus('# branch.head main\n1 .M N... x\n')), ['Commit', 'Run tests'], 'no PR from main');
  assert.deepEqual(labels(null), ['Run tests'], 'not a git folder');
  assert.deepEqual(labels(parseStatus('# branch.head feature/x\n')), ['Push', 'Open a PR', 'Run tests'], 'never pushed');
  assert.deepEqual(labels(parseStatus(OUT), 'working'), []);
  assert.deepEqual(labels(parseStatus(OUT), 'waiting'), []);
});

test('status reads a real repository', async (t) => {
  try { execFileSync('git', ['--version']); } catch { return t.skip('no git'); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-git-'));
  execFileSync('git', ['init', '-q', '-b', 'work'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hi');
  const st = await new Promise((r) => status(dir, r));
  assert.equal(st.branch, 'work');
  assert.equal(st.untracked, 1);
  const none = await new Promise((r) => status(os.tmpdir() + '/no-such-folder-blaube', r));
  assert.equal(none, null);
});

test('after failed tests it offers to fix them; nearly full, to compact', () => {
  const st = { branch: 'main', changed: 0, untracked: 0, ahead: 0, behind: 0, conflicts: 0, upstream: 'origin/main' };
  const labels = (more) => quickActions(st, 'done', more).map((q) => q.label);
  assert.deepEqual(labels({}), ['Run tests']);
  assert.deepEqual(labels({ stopped: true }), ['Carry on', 'Run tests']);
  assert.deepEqual(labels({ apiError: true }), ['Try again', 'Run tests']);
  assert.deepEqual(labels({ failedTests: 'npm test' }), ['Fix the tests']);
  assert.match(quickActions(st, 'done', { failedTests: 'npm test' })[0].prompt, /`npm test`/);
  assert.deepEqual(labels({ context: 85 }), ['Compact', 'Run tests']);
  assert.deepEqual(labels({ context: 50 }), ['Run tests']);
});

test('a file’s diff loses its headers, and long ones are cut', () => {
  const { compactDiff } = require('../src/main/git.js');
  const d = 'diff --git a/x.js b/x.js\nindex 1..2 100644\n--- a/x.js\n+++ b/x.js\n@@ -1,2 +1,2 @@\n-old\n+new\n same\n';
  assert.equal(compactDiff(d), '@@ -1,2 +1,2 @@\n-old\n+new\n same');
  assert.match(compactDiff('+' + 'x'.repeat(7000)), /…$/);
});

test('a real repository: the diff of a changed file, the start of a new one', async () => {
  const { diff } = require('../src/main/git.js');
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-diff-'));
  const g = (...a) => execFileSync('git', a, { cwd: root });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'a.js'), 'one\ntwo\n');
  g('add', '.'); g('commit', '-qm', 'x');
  fs.writeFileSync(path.join(root, 'a.js'), 'one\nthree\n');
  fs.writeFileSync(path.join(root, 'b.js'), 'fresh\n');
  const got = (rel, how) => new Promise((r) => diff(root, rel, how, r));
  assert.match(await got('a.js', 'changed'), /^@@ .*\n one\n-two\n\+three$/);
  assert.equal(await got('b.js', 'new'), '+fresh');
});

test('after a usage limit, it offers to carry on when it lifts, or to call that off', () => {
  const { quickActions } = require('../src/main/git');
  const at = Date.now() + 3600e3;
  const q = quickActions(null, 'done', { apiError: 'Claude Code: 5-hour limit reached ∙ resets 3pm', carryAt: { at, label: '3pm' } });
  assert.deepEqual(q.slice(0, 2).map((x) => x.label), ['Carry on at 3pm', 'Try again']);
  assert.equal(q[0].later, at);
  const set = quickActions(null, 'done', { apiError: 'x', carryAt: { at, label: '3pm', set: true } });
  assert.equal(set[0].label, 'Don’t carry on at 3pm');
  assert.equal(set[0].later, 0);
  assert.equal(quickActions(null, 'done', { apiError: 'x' })[0].label, 'Try again');
});

test('signed out of Claude Code: Sign in, then Try again', () => {
  const q = quickActions(null, 'done', { apiError: 'Claude Code: Invalid API key · Please run /login' });
  assert.deepEqual(q.map((a) => a.label).slice(0, 2), ['Sign in', 'Try again']);
  assert.equal(q[0].signIn, true);
});

test('branch names are checked the way git would', () => {
  const { branchName } = require('../src/main/git');
  assert.equal(branchName(' feature/login '), 'feature/login');
  assert.equal(branchName('fix-2.1'), 'fix-2.1');
  for (const bad of ['', '-x', '--force', 'a..b', 'a b', 'a//b', '/a', 'a/', 'a.', 'a.lock', '.hidden', 'a/.b', 'a@{1}', '@', 'a;rm', 'a~1', 'a^', 'a:b', 'x'.repeat(201)]) assert.equal(branchName(bad), '', bad);
});

test('branches are listed and switched to (and made) in a real repository', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const { branches, switchTo } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-git-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) }).toString().trim();
  try {
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a'), '1');
    g('add', 'a'); g('commit', '-qm', 'one');
    const sw = (n, c) => new Promise((r) => switchTo(dir, n, c, r));
    assert.equal(await sw('topic', true), '');
    assert.equal(g('branch', '--show-current'), 'topic');
    assert.deepEqual((await new Promise((r) => branches(dir, r))).sort(), ['main', 'topic']);
    assert.equal(await sw('main', false), '');
    assert.equal(g('branch', '--show-current'), 'main');
    assert.match(await sw('topic', true), /already exists/);
    assert.match(await sw('nope', false), /nope|invalid reference/);
    assert.equal(await sw('--orphan', true), 'That isn’t a name a branch can have');
    assert.deepEqual(await new Promise((r) => branches(path.join(dir, 'missing'), r)), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Push and Pull run git right there, until git fails at one: then Claude is asked', () => {
  const { command } = require('../src/main/git');
  const ahead = parseStatus('# branch.head main\n# branch.upstream origin/main\n# branch.ab +1 -2\n');
  const pick = (more) => quickActions(ahead, 'done', more).filter((a) => a.label === 'Push' || a.label === 'Pull').map((a) => a.label + ':' + (a.run || 'claude'));
  assert.deepEqual(pick({}), ['Push:push', 'Pull:pull']);
  assert.deepEqual(pick({ gitFailed: 'pull' }), ['Push:push', 'Pull:claude']);
  assert.deepEqual(pick({ gitFailed: 'push' }), ['Push:claude', 'Pull:pull']);
  const dirty = parseStatus('# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -2\n1 .M N... 100644 100644 100644 a b x.js\n');
  assert.equal(quickActions(dirty, 'done').find((a) => a.label === 'Pull').run, undefined, 'with changes, pulling is Claude’s');
  assert.equal(command('push', ahead), 'git push');
  assert.equal(command('push', parseStatus('# branch.head feature/x\n')), 'git push --set-upstream origin HEAD');
  assert.equal(command('pull', ahead), 'git pull --ff-only');
  assert.equal(command('rm -rf', ahead), '');
});

test('the Push command really pushes a never-pushed branch, with no prompt', async () => {
  const { command } = require('../src/main/git');
  const shellRun = require('../src/main/shellRun');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-push-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, env }).toString().trim();
  try {
    const bare = path.join(root, 'remote.git'), work = path.join(root, 'work');
    g(root, 'init', '-q', '--bare', bare);
    g(root, 'init', '-q', '-b', 'topic', work);
    g(work, 'remote', 'add', 'origin', bare);
    g(work, 'commit', '-q', '--allow-empty', '-m', 'one');
    const st = parseStatus(g(work, 'status', '--porcelain=v2', '--branch'));
    const [code, out] = await new Promise((r) => shellRun.run(command('push', st), work, (c, o) => r([c, o]), { env: Object.assign({}, env, { GIT_TERMINAL_PROMPT: '0' }) }));
    assert.equal(code, 0, out);
    assert.equal(g(bare, 'rev-parse', 'topic'), g(work, 'rev-parse', 'HEAD'));
    assert.equal(g(work, 'rev-parse', '--abbrev-ref', '@{u}'), 'origin/topic');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a commit reads as its message, then each file under its name', () => {
  const { commitText } = require('../src/main/git');
  const out = 'Fix the tax\n\nRounding was off.\n\ndiff --git a/src/tax.js b/src/tax.js\nindex 1..2 100644\n--- a/src/tax.js\n+++ b/src/tax.js\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/new.md b/new.md\nnew file mode 100644\n--- /dev/null\n+++ b/new.md\n@@ -0,0 +1 @@\n+hi\n';
  assert.equal(commitText(out), 'Fix the tax\n\nRounding was off.\n\n── src/tax.js\n@@ -1 +1 @@\n-a\n+b\n\n── new.md\n@@ -0,0 +1 @@\n+hi');
});

test('commits are read from a real repository, and shown by hash only', async () => {
  const { commits, show } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-log-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env }).toString().trim();
  try {
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n'); g('add', '.'); g('commit', '-qm', 'First');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n'); g('commit', '-qam', 'Second: two');
    const list = await new Promise((r) => commits(dir, r));
    assert.deepEqual(list.map((c) => c.subject), ['Second: two', 'First']);
    assert.ok(list[0].at > Date.now() - 60e3 && /^[0-9a-f]{40}$/.test(list[0].hash) && list[0].hash.startsWith(list[0].short));
    assert.equal(await new Promise((r) => show(dir, list[0].hash, r)), 'Second: two\n\n── a.txt\n@@ -1 +1 @@\n-one\n+two');
    assert.equal(await new Promise((r) => show(dir, '--output=/tmp/x', r)), '');
    assert.equal(await new Promise((r) => show(dir, 'HEAD', r)), '');
    assert.deepEqual(await new Promise((r) => commits(path.join(dir, 'nope'), r)), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('with a pull request: no Open a PR, and failing checks come first', () => {
  const { parse } = require('../src/main/pr');
  const st = parseStatus('# branch.head feature/x\n# branch.upstream origin/feature/x\n# branch.ab +0 -0\n');
  const pr = (o) => parse(JSON.stringify(Object.assign({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', statusCheckRollup: [] }, o)));
  assert.deepEqual(quickActions(st, 'done', { pr: pr({}) }).map((a) => a.label), ['Run tests']);
  const failing = quickActions(st, 'done', { pr: pr({ statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }) });
  assert.equal(failing[0].label, 'Fix the checks');
  assert.match(failing[0].prompt, /pull request #7 are failing.*gh pr checks 7/);
  assert.deepEqual(quickActions(st, 'done', { pr: pr({ state: 'MERGED' }) }).map((a) => a.label), ['Open a PR', 'Run tests'], 'merged: a new one can be opened');
});

test('changes requested on its pull request: Answer the review', () => {
  const { parse } = require('../src/main/pr');
  const st = parseStatus('# branch.head feature/x\n# branch.upstream origin/feature/x\n# branch.ab +0 -0\n');
  const pr = parse(JSON.stringify({ number: 9, url: 'https://github.com/o/r/pull/9', state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }));
  const q = quickActions(st, 'done', { pr });
  assert.deepEqual(q.map((a) => a.label), ['Fix the checks', 'Answer the review', 'Run tests']);
  assert.match(q[1].prompt, /changes on pull request #9.*gh pr view 9 --comments/);
});

test('a script the box ran that stopped with an error: Fix it, with its last lines', () => {
  const q = quickActions(null, 'done', { runFailed: { command: 'npm run dev', tail: 'Error: port 3000 in use' } });
  assert.equal(q[0].label, 'Fix it');
  assert.match(q[0].prompt, /^`npm run dev` stopped with an error\. Its last lines:\n\n```\nError: port 3000 in use\n```/);
});

test('what a branch changed since it left main, file by file', async () => {
  const { branchChanges, branchDiff, parseNameStatus } = require('../src/main/git');
  assert.deepEqual(parseNameStatus('M\tsrc/a.js\nA\tnew.md\nD\told.txt\nR100\tx.js\ty.js\n'), [{ path: 'src/a.js', how: 'changed' }, { path: 'new.md', how: 'new' }, { path: 'old.txt', how: 'deleted' }, { path: 'y.js', how: 'renamed' }]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-br-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env }).toString().trim();
  try {
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n'); g('add', '.'); g('commit', '-qm', 'base');
    assert.equal(await new Promise((r) => branchChanges(dir, 'main', r)), null, 'on main itself');
    g('switch', '-qc', 'topic');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n'); fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n'); g('add', '.'); g('commit', '-qm', 'work');
    g('switch', '-q', 'main'); fs.writeFileSync(path.join(dir, 'c.txt'), 'later on main\n'); g('add', '.'); g('commit', '-qm', 'main moved'); g('switch', '-q', 'topic');
    const ch = await new Promise((r) => branchChanges(dir, 'topic', r));
    assert.equal(ch.base, 'main');
    assert.deepEqual(ch.files, [{ path: 'a.txt', how: 'changed' }, { path: 'b.txt', how: 'new' }], 'only its own, not main’s since');
    assert.match(ch.stat, /2 files changed/);
    assert.equal(ch.behind, 1, 'main has a commit it hasn’t');
    assert.equal(await new Promise((r) => branchDiff(dir, 'main', 'a.txt', r)), '@@ -1 +1 @@\n-one\n+two');
    assert.equal(await new Promise((r) => branchDiff(dir, '--output=/tmp/x', 'a.txt', r)), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('discarding a file’s changes keeps them in git’s stash, to put back', async () => {
  const { discard, putBack } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-dis-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env }).toString().trim();
  const p = (f, ...a) => new Promise((r) => f(dir, ...a, r));
  try {
    g('init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(dir, 'sub'));
    for (const f of ['a.txt', 'b.txt', 'sub/c.txt']) fs.writeFileSync(path.join(dir, f), 'one\n');
    g('add', '.'); g('commit', '-qm', 'base');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'two\n');
    fs.writeFileSync(path.join(dir, 'new file.txt'), 'n\n');
    fs.rmSync(path.join(dir, 'sub/c.txt'));
    assert.equal(await p(discard, 'a.txt', 'changed'), '');
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\n', 'back as committed');
    assert.equal(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'two\n', 'the others are left alone');
    assert.equal(await p(discard, 'new file.txt', 'new'), '');
    assert.equal(fs.existsSync(path.join(dir, 'new file.txt')), false);
    assert.equal(await p(discard, 'sub/c.txt', 'deleted'), '');
    assert.equal(fs.existsSync(path.join(dir, 'sub/c.txt')), true);
    // Only the newest one discarded can be put back from here.
    assert.match(await p(putBack, 'a.txt'), /stash/);
    assert.equal(await p(putBack, 'sub/c.txt'), '');
    assert.equal(fs.existsSync(path.join(dir, 'sub/c.txt')), false);
    assert.equal(await p(discard, 'nothing.txt', 'changed'), 'Nothing to discard');
    for (const [rel, how] of [['../x', 'changed'], ['/etc/hosts', 'changed'], ['a.txt', 'conflict'], ['a.txt', 'renamed'], ['', 'new']]) assert.equal(await p(discard, rel, how), 'Can’t discard that one', rel + ' ' + how);
    assert.equal(g('status', '--porcelain'), 'M b.txt\n D sub/c.txt');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('nothing committed yet: nothing to discard back to, said so', async () => {
  const { discard } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-dis0-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'n.md'), 'x\n');
    assert.equal(await new Promise((r) => discard(dir, 'n.md', 'new', r)), 'Nothing’s committed yet, so there’s nothing to go back to');
    assert.equal(fs.existsSync(path.join(dir, 'n.md')), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('packages to install: Install packages, run right there', () => {
  const q = quickActions(null, 'idle', { install: 'pnpm install' });
  assert.deepEqual(q[0], { label: 'Install packages', prompt: 'Runs pnpm install right here', install: true });
  assert.equal(quickActions(null, 'working', { install: 'npm install' }).length, 0);
});

test('the newest commit, pushed nowhere, can be undone with its changes kept', async () => {
  const { canUndo, undoCommit, commits } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-undo-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env }).toString().trim();
  const p = (f, ...a) => new Promise((r) => f(dir, ...a, r));
  try {
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n'); g('add', '.'); g('commit', '-qm', 'first');
    assert.equal(await p(canUndo, g('rev-parse', 'HEAD')), false, 'not the first commit');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n'); g('add', '.'); g('commit', '-qm', 'second');
    const second = g('rev-parse', 'HEAD');
    assert.equal(await p(canUndo, g('rev-parse', 'HEAD~1')), false, 'not an older one');
    assert.equal(await p(canUndo, second), true);
    // Pushed: no.
    const bare = dir + '-remote.git';
    execFileSync('git', ['init', '-q', '--bare', bare]);
    g('remote', 'add', 'origin', bare); g('push', '-q', 'origin', 'main');
    assert.equal(await p(canUndo, second), false, 'it’s on a remote');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'three\n'); g('add', '.'); g('commit', '-qm', 'third');
    const third = g('rev-parse', 'HEAD');
    assert.equal(await p(undoCommit, third), '');
    assert.equal(g('rev-parse', 'HEAD'), second);
    assert.equal(g('status', '--porcelain'), 'M  a.txt', 'its changes kept, staged');
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'three\n');
    assert.match(await p(undoCommit, second), /pushed/);
    assert.equal((await new Promise((r) => commits(dir, r)))[0].subject, 'second');
    fs.rmSync(bare, { recursive: true, force: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('its pull request merged: Back to main, a step (git agreeing it’s merged)', () => {
  const { command } = require('../src/main/git');
  const st = { branch: 'feature/tax', ahead: 0, behind: 0, changed: 0, untracked: 0, upstream: true, conflicts: 0, files: [] };
  const merged = { number: 5, state: 'MERGED', base: 'main', review: '', checks: { pass: 1, fail: 0, pending: 0 } };
  const q = quickActions(st, 'idle', { pr: merged });
  assert.deepEqual(q[0], { label: 'Back to main', prompt: 'Its pull request is merged: switches to main, pulls it, and deletes feature/tax', run: 'home' });
  assert.ok(!q.some((x) => x.label === 'Open a PR'), 'no new PR offered for a merged branch');
  assert.equal(command('home', st, merged), 'git switch main && git pull --ff-only && git branch -d feature/tax');
  const head = 'a'.repeat(40);
  assert.equal(command('home', st, Object.assign({}, merged, { head }), 'darwin'), `git switch main && git pull --ff-only && { git branch -d feature/tax 2>/dev/null || { [ "$(git rev-parse feature/tax)" = ${head} ] && git branch -D feature/tax; }; }`, 'squashed: deleted if it is just what the PR had');
  assert.equal(command('home', st, Object.assign({}, merged, { head }), 'win32'), 'git switch main && git pull --ff-only && git branch -d feature/tax');
  assert.equal(command('home', st, Object.assign({}, merged, { head: 'x; rm -rf ~' }), 'darwin'), 'git switch main && git pull --ff-only && git branch -d feature/tax');
  assert.ok(!quickActions(Object.assign({}, st, { changed: 1 }), 'idle', { pr: merged }).some((x) => x.run === 'home'), 'not with changes');
  assert.ok(!quickActions(st, 'idle', { pr: merged, gitFailed: 'home' }).some((x) => x.run === 'home'));
  assert.ok(!quickActions(st, 'idle', { pr: Object.assign({}, merged, { state: 'OPEN' }) }).some((x) => x.run === 'home'));
  for (const base of ['', 'main; rm -rf ~', '-x', 'a..b']) assert.equal(command('home', st, Object.assign({}, merged, { base })), '', base);
  assert.equal(command('home', Object.assign({}, st, { branch: 'x$(id)' }), merged), '');
});

test('Back to main deletes a squash-merged branch only while it is just what the PR had', { skip: process.platform === 'win32' }, () => {
  const { command } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-home-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env }).toString().trim();
  const sh = (cmd) => { try { execFileSync('sh', ['-c', cmd], { cwd: dir, env, stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  const bare = dir + '-remote.git';
  try {
    execFileSync('git', ['init', '-q', '--bare', bare]);
    g('init', '-q', '-b', 'main'); g('remote', 'add', 'origin', bare);
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); g('add', '.'); g('commit', '-qm', 'base'); g('push', '-q', '-u', 'origin', 'main');
    const branchOff = (name) => { g('switch', '-q', '-c', name); fs.writeFileSync(path.join(dir, name + '.txt'), 'x\n'); g('add', '.'); g('commit', '-qm', name); return g('rev-parse', 'HEAD'); };
    const st = (branch) => ({ branch, changed: 0 });
    const pr = (head) => ({ state: 'MERGED', base: 'main', head });
    const t1 = branchOff('topic');
    assert.equal(sh(command('home', st('topic'), pr(t1), 'linux')), 0);
    assert.equal(g('branch', '--show-current'), 'main');
    assert.equal(g('branch', '--list', 'topic'), '', 'just what the PR had: deleted');
    branchOff('other');
    assert.notEqual(sh(command('home', st('other'), pr('b'.repeat(40)), 'linux')), 0);
    assert.equal(g('branch', '--list', 'other'), 'other', 'a commit GitHub never saw: kept');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(bare, { recursive: true, force: true }); }
});

test('changes set aside on their branch come back with it', async () => {
  const { park, unpark } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-park-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env }).toString().trim();
  const p = (f, ...a) => new Promise((r) => f(dir, ...a, (...out) => r(out)));
  try {
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); g('add', '.'); g('commit', '-qm', 'base');
    g('branch', 'topic');
    fs.writeFileSync(path.join(dir, 'a.txt'), '2\n');
    assert.deepEqual(await p(park, 'main'), ['']);
    assert.equal(g('status', '--porcelain'), '');
    g('switch', '-q', 'topic');
    assert.deepEqual(await p(unpark, 'topic'), ['', false], 'nothing set aside on topic');
    g('switch', '-q', 'main');
    assert.deepEqual(await p(unpark, 'main'), ['', true]);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), '2\n');
    assert.equal(g('stash', 'list'), '');
    assert.deepEqual(await p(park, '-x'), ['It isn’t on a branch']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
