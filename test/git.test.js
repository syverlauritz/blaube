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
  assert.deepEqual(labels({ failedTests: 'npm test' }), ['Fix the tests']);
  assert.match(quickActions(st, 'done', { failedTests: 'npm test' })[0].prompt, /`npm test`/);
  assert.deepEqual(labels({ context: 85, canCompact: true }), ['Compact', 'Run tests']);
  assert.deepEqual(labels({ context: 85, canCompact: false }), ['Run tests']);
  assert.deepEqual(labels({ context: 50, canCompact: true }), ['Run tests']);
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
