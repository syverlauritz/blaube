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
    g('init', '-q', '-b', 'main'); g('config', 'core.autocrlf', 'false');
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

test('a .env to make: Make .env, after Install packages', () => {
  const q = quickActions(null, 'idle', { install: 'npm install', env: '.env.example' });
  assert.deepEqual(q.slice(0, 2).map((x) => x.label), ['Install packages', 'Make .env']);
  assert.deepEqual(q[1], { label: 'Make .env', prompt: 'Copies .env.example to .env, for you to fill in', env: true });
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
    g('init', '-q', '-b', 'main'); g('config', 'core.autocrlf', 'false');
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

test('which branches have changes set aside', async () => {
  const { park, parked } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-parked-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env }).toString().trim();
  try {
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); g('add', '.'); g('commit', '-qm', 'base');
    assert.deepEqual(await new Promise((r) => parked(dir, r)), []);
    fs.writeFileSync(path.join(dir, 'a.txt'), '2\n');
    await new Promise((r) => park(dir, 'main', r));
    fs.writeFileSync(path.join(dir, 'a.txt'), '3\n');
    g('stash', 'push', '-q', '-m', 'mine');
    assert.deepEqual(await new Promise((r) => parked(dir, r)), ['main'], 'yours aren’t counted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('what’s new upstream, fetched quietly: behind shows without you fetching', async () => {
  const { fetchQuietly, status } = require('../src/main/git');
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-fetch-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, env, stdio: 'pipe' }).toString().trim();
  const mine = path.join(top, 'mine'), theirs = path.join(top, 'theirs'), hub = path.join(top, 'hub.git');
  const fetch = (o) => new Promise((r) => fetchQuietly(mine, r, o));
  try {
    g(top, 'init', '-q', '--bare', '-b', 'main', hub);
    g(top, 'clone', '-q', hub, theirs);
    fs.writeFileSync(path.join(theirs, 'a.txt'), '1\n'); g(theirs, 'add', '.'); g(theirs, 'commit', '-qm', 'base'); g(theirs, 'push', '-q', 'origin', 'HEAD:main');
    g(top, 'clone', '-q', hub, mine);
    fs.writeFileSync(path.join(theirs, 'a.txt'), '2\n'); g(theirs, 'commit', '-qam', 'theirs'); g(theirs, 'push', '-q');
    assert.equal(await fetch({ now: 1 }), false, 'not by itself: a local (not https) remote');
    assert.equal(await fetch({ asked: true, now: 1 }), true, 'you opened its box');
    assert.equal(await fetch({ asked: true, now: 60e3 }), false, 'once every few minutes');
    const st = await new Promise((r) => status(mine, r));
    assert.equal(st.behind, 1);
    assert.equal(await fetch({ asked: true, now: 3 * 60e3 }), true);
    assert.equal(await new Promise((r) => fetchQuietly('', r)), false);
  } finally { fs.rmSync(top, { recursive: true, force: true }); }
});

test('a file in conflict, settled: your version or theirs (flipped in a rebase), or deleted', async () => {
  const { settle } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-settle-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => { try { return execFileSync('git', a, { cwd: dir, env, stdio: 'pipe' }).toString().trim(); } catch (e) { return 'failed'; } };
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const p = (rel, side) => new Promise((r) => settle(dir, rel, side, r));
  try {
    g('init', '-q', '-b', 'main'); g('config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n'); fs.writeFileSync(path.join(dir, 'b.txt'), 'base\n'); g('add', '.'); g('commit', '-qm', 'base');
    g('switch', '-q', '-c', 'theirs');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'theirs\n'); g('rm', '-q', 'b.txt'); g('commit', '-qam', 'theirs');
    g('switch', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'mine\n'); fs.writeFileSync(path.join(dir, 'b.txt'), 'mine\n'); g('commit', '-qam', 'mine');
    assert.equal(g('merge', '-q', 'theirs'), 'failed');
    assert.equal(await p('a.txt', 'mine'), '');
    assert.equal(read('a.txt'), 'mine\n');
    assert.equal(await p('b.txt', 'theirs'), '', 'they deleted it: deleted');
    assert.equal(fs.existsSync(path.join(dir, 'b.txt')), false);
    assert.equal(g('diff', '--name-only', '--diff-filter=U'), '', 'nothing left in conflict');
    g('merge', '--abort');
    // A rebase of main onto theirs: "mine" is still main's version.
    assert.equal(g('rebase', 'theirs'), 'failed');
    assert.equal(await p('a.txt', 'mine'), '');
    assert.equal(read('a.txt'), 'mine\n');
    assert.equal(await p('a.txt', 'yours'), 'Can’t settle that one');
    assert.equal(await p('../a.txt', 'mine'), 'Can’t settle that one');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a merge or rebase midway, its conflicts settled: finished right there', () => {
  const { quickActions, command } = require('../src/main/git');
  const st = (o) => Object.assign({ branch: 'main', ahead: 0, behind: 0, changed: 1, untracked: 0, upstream: true, conflicts: 0, files: [] }, o);
  const merge = quickActions(st({ midway: 'merge' }), 'idle');
  assert.deepEqual([merge[0].label, merge[0].run], ['Finish the merge', 'finish']);
  assert.ok(!merge.some((q) => q.label === 'Commit'), 'not Commit: that’s what Finish does');
  assert.equal(command('finish', st({ midway: 'merge' })), 'git commit --no-edit');
  assert.equal(quickActions(st({ midway: 'rebase', branch: '' }), 'idle')[0].label, 'Continue the rebase');
  assert.equal(command('finish', st({ midway: 'rebase' })), 'git -c core.editor=true rebase --continue');
  assert.equal(command('finish', st({ midway: 'merge', conflicts: 1 })), '', 'not with conflicts left');
  assert.ok(!quickActions(st({ midway: 'merge', conflicts: 1 }), 'idle').some((q) => q.run === 'finish'));
  assert.deepEqual(merge[1], { label: 'Call off the merge', prompt: 'Runs git merge --abort right here: back to how it was before the merge started', run: 'abort', sure: 'Call it off?' });
  assert.deepEqual(quickActions(st({ midway: 'rebase', conflicts: 1 }), 'idle').slice(0, 2).map((q) => q.label), ['Fix conflicts', 'Call off the rebase']);
  assert.equal(command('abort', st({ midway: 'rebase' })), 'git rebase --abort');
  assert.equal(command('abort', st({})), '');
  const failed = quickActions(st({ midway: 'merge' }), 'idle', { gitFailed: 'finish' })[0];
  assert.ok(failed.label === 'Finish the merge' && !failed.run && /finish it with a commit/.test(failed.prompt), 'when git couldn’t, Claude is asked');
});

test('git status says when a merge or rebase is under way', async () => {
  const { status, forget } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-midway-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => { try { return execFileSync('git', a, { cwd: dir, env, stdio: 'pipe' }).toString().trim(); } catch { return 'failed'; } };
  const now = () => { forget(dir); return new Promise((r) => status(dir, r)); };
  try {
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n'); g('add', '.'); g('commit', '-qm', 'base');
    g('switch', '-q', '-c', 'b'); fs.writeFileSync(path.join(dir, 'a.txt'), 'b\n'); g('commit', '-qam', 'b');
    g('switch', '-q', 'main'); fs.writeFileSync(path.join(dir, 'a.txt'), 'main\n'); g('commit', '-qam', 'main');
    assert.equal((await now()).midway, '');
    g('merge', 'b');
    assert.deepEqual([(await now()).midway, (await now()).conflicts], ['merge', 1]);
    g('merge', '--abort');
    g('rebase', 'b');
    assert.equal((await now()).midway, 'rebase');
    g('rebase', '--abort');
    assert.equal((await now()).midway, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('branches already merged, to tidy away: not one just made, nor the one it’s on', async () => {
  const { merged, deleteMerged, park } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-merged-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env, stdio: 'pipe' }).toString().trim();
  const work = (b, f) => { g('switch', '-q', '-c', b, 'main'); fs.writeFileSync(path.join(dir, f), b); g('add', '.'); g('commit', '-qm', b); g('switch', '-q', 'main'); };
  const p = () => new Promise((r) => merged(dir, r));
  try {
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); g('add', '.'); g('commit', '-qm', 'base');
    work('done-one', 'b.txt'); g('merge', '-q', '--no-ff', '-m', 'merge one', 'done-one');
    work('done-two', 'c.txt'); g('merge', '-q', '--no-ff', '-m', 'merge two', 'done-two');
    work('not-yet', 'd.txt');
    g('branch', 'just-made');
    work('kept', 'e.txt'); g('merge', '-q', '--no-ff', '-m', 'merge kept', 'kept');
    g('switch', '-q', 'kept'); fs.writeFileSync(path.join(dir, 'a.txt'), 'wip\n'); await new Promise((r) => park(dir, 'kept', r)); g('switch', '-q', 'main');
    work('on-it', 'f.txt'); g('merge', '-q', '--no-ff', '-m', 'merge on-it', 'on-it'); g('switch', '-q', 'on-it');
    assert.deepEqual(await p(), { base: 'main', names: ['done-one', 'done-two'] }, 'not not-yet, just-made, kept (changes set aside) or on-it (it’s on it)');
    g('switch', '-q', 'main');
    assert.deepEqual((await p()).names.sort(), ['done-one', 'done-two', 'on-it']);
    assert.deepEqual(await new Promise((r) => deleteMerged(dir, ['done-one', 'not-yet', 'main'], r)), ['done-one'], 'only those still merged');
    assert.equal(g('branch', '--list', 'done-one'), '');
    assert.notEqual(g('branch', '--list', 'not-yet'), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('its repository on GitHub, and the link its branches show', () => {
  const { githubOf, webLink } = require('../src/main/git');
  for (const u of ['https://github.com/o/r.git', 'https://github.com/o/r', 'git@github.com:o/r.git', 'ssh://git@github.com/o/r.git', 'https://x-access@github.com/o/r.git\n']) assert.equal(githubOf(u), 'https://github.com/o/r', u);
  for (const u of ['https://gitlab.com/o/r.git', '/tmp/r.git', '', 'https://github.com/o', 'https://github.com/o/r/x']) assert.equal(githubOf(u), '', u);
  const repo = 'https://github.com/o/r';
  const st = (o) => Object.assign({ branch: 'feature/tax', upstream: true }, o);
  assert.deepEqual(webLink(repo, st(), null), { label: 'Open a PR on GitHub ↗', url: 'https://github.com/o/r/compare/feature/tax?expand=1' });
  assert.equal(webLink(repo, st(), { number: 4, state: 'MERGED' }).label, 'Open a PR on GitHub ↗', 'its last one is merged');
  assert.deepEqual(webLink(repo, st(), { number: 5, state: 'OPEN' }), { label: 'o/r on GitHub ↗', url: 'https://github.com/o/r/tree/feature/tax' });
  assert.deepEqual(webLink(repo, st({ upstream: false }), null), { label: 'o/r on GitHub ↗', url: repo }, 'not pushed yet');
  assert.deepEqual(webLink(repo, st({ branch: 'main' }), null).url, 'https://github.com/o/r/tree/main');
  assert.equal(webLink('', st(), null), null);
});

test('a pushed commit reverted with a new one; a conflict leaves a revert to finish', async () => {
  const { revert, status, forget, command, quickActions } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-revert-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env, stdio: 'pipe' }).toString().trim();
  const p = (h) => new Promise((r) => revert(dir, h, (err, conflict) => r([err, conflict])));
  const was = process.env.GIT_COMMITTER_NAME;
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  try {
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); g('add', '.'); g('commit', '-qm', 'base');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'x\n'); g('add', '.'); g('commit', '-qm', 'add b');
    const addB = g('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(dir, 'a.txt'), '2\n'); g('commit', '-qam', 'two');
    const two = g('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(dir, 'a.txt'), '3\n'); g('commit', '-qam', 'three');
    assert.deepEqual(await p(addB), ['', false]);
    assert.equal(fs.existsSync(path.join(dir, 'b.txt')), false);
    assert.match(g('log', '-1', '--format=%s'), /^Revert "add b"/);
    assert.deepEqual(await p(two), ['', true], 'three changed the same line');
    forget(dir);
    const st = await new Promise((r) => status(dir, r));
    assert.deepEqual([st.midway, st.conflicts], ['revert', 1]);
    assert.equal(command('finish', Object.assign({}, st, { conflicts: 0 })), 'git -c core.editor=true revert --continue');
    assert.equal(quickActions(Object.assign({}, st, { conflicts: 0 }), 'idle')[0].label, 'Finish the revert');
    g('revert', '--abort');
    assert.deepEqual(await p('nope'), ['Can’t find that commit', false]);
    assert.deepEqual(await p(g('rev-list', '--max-parents=0', 'HEAD')), ['It’s the first commit', false]);
  } finally {
    if (was == null) for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete process.env[k];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('changes you set aside yourself (git stash), and bringing them back', async () => {
  const { stashes, bringBack, park } = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-stash-'));
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env, stdio: 'pipe' }).toString().trim();
  const list = () => new Promise((r) => stashes(dir, r));
  try {
    g('init', '-q', '-b', 'main'); g('config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); g('add', '.'); g('commit', '-qm', 'base');
    assert.deepEqual(await list(), []);
    fs.writeFileSync(path.join(dir, 'a.txt'), '2\n'); g('stash', 'push', '-q');
    fs.writeFileSync(path.join(dir, 'a.txt'), '3\n'); await new Promise((r) => park(dir, 'main', r));
    fs.writeFileSync(path.join(dir, 'a.txt'), '4\n'); g('stash', 'push', '-q', '-m', 'try the tax idea');
    const l = await list();
    assert.deepEqual(l.map((x) => [x.ref, x.subject]), [['stash@{0}', 'try the tax idea'], ['stash@{2}', 'Work in progress on main: base']], 'not the one Blaube set aside');
    assert.ok(l[0].at > 0);
    assert.equal(await new Promise((r) => bringBack(dir, 'stash@{2}', 1, r)), 'It isn’t there any more');
    assert.equal(await new Promise((r) => bringBack(dir, l[1].ref, l[1].at, r)), '');
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), '2\n');
    assert.deepEqual((await list()).map((x) => x.subject), ['try the tax idea']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
