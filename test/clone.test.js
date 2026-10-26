const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parse, destFor, clone } = require('../src/main/clone');

test('what you paste, as something git can clone', () => {
  assert.deepEqual(parse('syverlauritz/blaube'), { url: 'https://github.com/syverlauritz/blaube.git', name: 'blaube' });
  assert.deepEqual(parse('https://github.com/acme/web-app'), { url: 'https://github.com/acme/web-app', name: 'web-app' });
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
