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
