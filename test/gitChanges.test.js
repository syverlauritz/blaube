const test = require('node:test');
const assert = require('node:assert');
const { createGitChanges, parseShortstat, changedIn } = require('../src/main/gitChanges.js');

test('reads git\'s short stat', () => {
  assert.deepStrictEqual(parseShortstat(' 3 files changed, 120 insertions(+), 30 deletions(-)\n'), { files: 3, add: 120, del: 30 });
  assert.deepStrictEqual(parseShortstat(' 1 file changed, 1 insertion(+)\n'), { files: 1, add: 1, del: 0 });
  assert.deepStrictEqual(parseShortstat(''), { files: 0, add: 0, del: 0 });
  assert.strictEqual(changedIn(' M a.js\n?? new.js\n?? other/\n'), 3);
});

test('counts new files too, caches, and says when it changed', () => {
  let t = 0, calls = 0;
  const out = { diff: ' 2 files changed, 5 insertions(+)\n', status: ' M a.js\n M b.js\n?? c.js\n' };
  const run = (cmd, args, opts, cb) => { calls++; cb(null, args.includes('diff') ? out.diff : out.status); };
  // (the diff counts lines; status counts files, new ones included)
  const g = createGitChanges({ run, now: () => t, every: 1000 });
  let changed = null;
  g.refresh('/x', (c) => { changed = c; });
  assert.deepStrictEqual(g.get('/x'), { files: 3, add: 5, del: 0 });
  assert.strictEqual(changed, true);
  g.refresh('/x', () => { changed = 'again'; });
  assert.strictEqual(calls, 2, 'not asked again so soon');
  t = 2000; changed = null;
  g.refresh('/x', (c) => { changed = c; });
  assert.strictEqual(changed, false, 'same as before');
});

test('before a first commit it still counts the files', () => {
  const run = (cmd, args, opts, cb) => (args.includes('diff') ? cb(new Error('bad revision HEAD')) : cb(null, '?? a.txt\n'));
  const g = createGitChanges({ run });
  g.refresh('/new');
  assert.deepStrictEqual(g.get('/new'), { files: 1, add: 0, del: 0 });
});

test('outside a repository it has nothing to say', () => {
  const g = createGitChanges({ run: (cmd, args, opts, cb) => cb(new Error('not a git repository')) });
  g.refresh('/tmp/nope');
  assert.strictEqual(g.get('/tmp/nope'), null);
});
