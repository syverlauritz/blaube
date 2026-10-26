const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const editor = require('../src/main/editor');

test('your editor is the first one installed', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-ed-'));
  try {
    assert.equal(!!(editor.find({ platform: 'darwin', home }) || { bin: '' }).bin.startsWith(home), false, 'none in this home');
    const cursor = path.join(home, 'Applications', 'Cursor.app/Contents/Resources/app/bin/cursor');
    fs.mkdirSync(path.dirname(cursor), { recursive: true });
    fs.writeFileSync(cursor, '');
    const c = editor.candidates('darwin', home).find((x) => x.bin === cursor);
    assert.deepEqual(c, { name: 'Cursor', bin: cursor, kind: 'code' });
    if (!fs.existsSync('/Applications')) assert.deepEqual(editor.find({ platform: 'darwin', home }), c);
    assert.equal(editor.find({ over: null }), null);
    assert.ok(editor.candidates('win32', home, { LOCALAPPDATA: 'C:\\L' }).some((x) => x.bin.endsWith('code.cmd')));
    assert.ok(editor.candidates('linux', home).some((x) => x.bin === '/usr/bin/code'));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('it opens a file at its line, or a folder', (t, done) => {
  assert.deepEqual(editor.args({ kind: 'code' }, '/p/a.js', 42), ['-g', '/p/a.js:42']);
  assert.deepEqual(editor.args({ kind: 'code' }, '/p', 0), ['/p']);
  assert.deepEqual(editor.args({ kind: 'zed' }, '/p/a.js', 7), ['/p/a.js:7']);
  const calls = [];
  const run = (bin, a, o, cb) => { calls.push([bin, ...a]); cb(null); };
  editor.open({ bin: '/x/code', kind: 'code' }, '/p/a.js', 3, (err) => {
    assert.equal(err, '');
    assert.deepEqual(calls[0], ['/x/code', '-g', '/p/a.js:3']);
    editor.open(null, '/p', 0, (e2) => { assert.equal(e2, 'No code editor found'); done(); });
  }, { run });
});
