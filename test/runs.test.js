const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runs = require('../src/main/runs');

const project = (scripts, lock) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-runs-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts }));
  if (lock) fs.writeFileSync(path.join(dir, lock), '');
  return dir;
};

test('its scripts, the usual ones first, the ones that keep running marked', () => {
  const dir = project({ lint: 'eslint .', build: 'vite build', 'dev:api': 'node api', test: 'node --test', dev: 'vite', prebuild: 'x', 'bad name': 'x', 'a;rm': 'x', '$(x)': 'x' });
  try {
    assert.deepEqual(runs.scripts(dir).map((s) => `${s.name}${s.long ? '*' : ''}`), ['dev*', 'test', 'build', 'lint', 'dev:api*']);
    assert.equal(runs.scripts(dir)[0].command, 'npm run dev');
    assert.deepEqual(runs.scripts(path.join(dir, 'nope')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the package manager its lockfile names', () => {
  for (const [lock, pm] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], [null, 'npm']]) {
    const dir = project({ dev: 'x' }, lock);
    try { assert.equal(runs.scripts(dir)[0].command, `${pm} run dev`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a dev server runs in the background: where it’s up, what it printed, and Stop', { skip: process.platform === 'win32' }, async () => {
  const dir = project({ dev: 'node server.js' });
  fs.writeFileSync(path.join(dir, 'server.js'), "const s = require('http').createServer((q, r) => r.end('hi')).listen(0, () => console.log('ready on http://localhost:' + s.address().port + '/'));");
  try {
    assert.equal(runs.start('s1', dir, 'nope'), null, 'only its own scripts');
    const r = runs.start('s1', dir, 'dev');
    assert.ok(r && r.id.startsWith('run:'));
    assert.equal(runs.start('s1', dir, 'dev'), r, 'started once');
    const url = await new Promise((done) => runs.events.on('url', function on(x) { if (x === r) { runs.events.off('url', on); done(x.url); } }));
    assert.match(url, /^http:\/\/localhost:\d+\/$/);
    assert.deepEqual(runs.list('s1').map((x) => [x.label, x.url, x.mine]), [['dev', url, true]]);
    assert.deepEqual(runs.list('s2'), []);
    assert.match(runs.output(r.id).text, /ready on http/);
    const ended = new Promise((done) => runs.events.on('exit', function on(x) { if (x === r) { runs.events.off('exit', on); done(x.code); } }));
    assert.equal(runs.stop(r.id), true);
    assert.equal(await ended, 0, 'stopped by you is no failure');
    assert.deepEqual(runs.list('s1'), []);
    assert.equal(runs.output(r.id), null);
  } finally { runs.stopAll(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('one that fails says so with its code', { skip: process.platform === 'win32' }, async () => {
  const dir = project({ dev: 'node -e "console.log(\'boom\'); process.exit(3)"' });
  try {
    const r = runs.start('s1', dir, 'dev');
    const code = await new Promise((done) => runs.events.on('exit', function on(x) { if (x === r) { runs.events.off('exit', on); done(x.code); } }));
    assert.equal(code, 3);
    assert.equal(runs.lastLine('\x1b[31mone\x1b[0m\n  two  \n\n'), 'two');
    assert.match(r.out, /boom/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
