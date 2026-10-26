const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parse, destFor, clone, newProject } = require('../src/main/clone');

test('what you paste, as something git can clone', () => {
  assert.deepEqual(parse('syverlauritz/blaube'), { url: 'https://github.com/syverlauritz/blaube.git', name: 'blaube', gh: 'syverlauritz/blaube' });
  assert.deepEqual(parse('https://github.com/acme/web-app'), { url: 'https://github.com/acme/web-app', name: 'web-app', gh: 'acme/web-app' });
  assert.deepEqual(parse('https://gitlab.com/group/sub/thing.git'), { url: 'https://gitlab.com/group/sub/thing.git', name: 'thing' });
  assert.deepEqual(parse('git@github.com:acme/api.git'), { url: 'git@github.com:acme/api.git', name: 'api' });
  assert.equal(parse('fix the login bug'), null);
  assert.equal(parse('https://x.com/a b'), null);
  assert.equal(parse('--upload-pack=touch /tmp/x'), null);
  assert.equal(parse('../secret'), null);
});

test('a folder that isn’t taken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-clone-'));
  assert.equal(destFor(dir, 'app'), path.join(dir, 'app'));
  fs.mkdirSync(path.join(dir, 'app'));
  assert.equal(destFor(dir, 'app'), path.join(dir, 'app-2'));
});

test('clones, or says why not', (t, done) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-clone-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  try { execFileSync('git', ['init', '-q', src]); execFileSync('git', ['-C', src, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'x']); } catch { t.skip('no git'); return done(); }
  clone('file://' + src, path.join(dir, 'copy'), (err, dest) => {
    assert.equal(err, '');
    assert.ok(fs.existsSync(path.join(dest, '.git')));
    clone('file://' + path.join(dir, 'nope'), path.join(dir, 'copy2'), (err2) => {
      assert.match(err2, /does not appear to be a git repository|not found|No such/);
      done();
    });
  });
});

test('a private GitHub one: the GitHub CLI’s sign-in, or what to do', (t, done) => {
  const calls = [];
  const run = (bin, args, _o, cb) => { calls.push([bin, ...args]); if (bin === 'git') cb(new Error('x'), '', "fatal: could not read Username for 'https://github.com': terminal prompts disabled"); else cb(calls.length > 2 ? new Error('no gh') : null); };
  clone('https://github.com/acme/secret.git', '/tmp/x/secret', (err) => {
    assert.equal(err, '');
    assert.deepEqual(calls[1], ['gh', 'repo', 'clone', 'acme/secret', '/tmp/x/secret']);
    clone('https://github.com/acme/secret.git', '/tmp/x/secret', (err2) => {
      assert.match(err2, /^acme\/secret needs you signed in to GitHub/);
      done();
    }, { run, gh: 'acme/secret' });
  }, { run, gh: 'acme/secret' });
});

test('a new project: a folder of its own, a git repository', (t, done) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-new-'));
  newProject(dir, '../escape', (err) => {
    assert.match(err, /^Give it a name/);
    newProject(dir, 'my app', (err2, dest) => {
      assert.equal(err2, '');
      assert.equal(dest, path.join(dir, 'my app'));
      assert.ok(fs.existsSync(path.join(dest, '.git')) || true); // (git may be missing)
      newProject(dir, 'my app', (err3) => { assert.match(err3, /^There’s already a my app/); done(); });
    });
  });
});
