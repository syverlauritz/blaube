const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../src/main/shellRun.js');

const ran = (cmd, cwd, opts) => new Promise((r) => run(cmd, cwd, (code, out) => r({ code, out }), opts));

test('!commands run in the session’s folder, and say how they went', async (t) => {
  if (process.platform === 'win32') return t.skip('unix shell');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-run-'));
  fs.writeFileSync(path.join(dir, 'here.txt'), '');
  assert.deepEqual(await ran('ls', dir), { code: 0, out: 'here.txt\n' });
  const bad = await ran('echo oops >&2; exit 3', dir);
  assert.equal(bad.code, 3);
  assert.equal(bad.out, 'oops\n');
  const slow = await ran('sleep 5; echo never', dir, { timeout: 300 });
  assert.equal(slow.code, null, 'too long: stopped');
  assert.equal(slow.out, '');
});
