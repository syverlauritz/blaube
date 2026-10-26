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

test('packages need installing: no node_modules, or older than its lockfile', () => {
  const { needsInstall } = require('../src/main/runs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-inst-'));
  const at = (f, s) => { const t = new Date(Date.now() + s * 1000); fs.utimesSync(path.join(dir, f), t, t); };
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { left: '1' } }));
    assert.equal(needsInstall(dir), '', 'no lockfile here: maybe a package in a workspace');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    assert.equal(needsInstall(dir), 'npm install', 'never installed');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', '.package-lock.json'), '{}');
    at('package-lock.json', -60);
    assert.equal(needsInstall(dir), '', 'installed since');
    at('package-lock.json', 60);
    assert.equal(needsInstall(dir), 'npm install', 'a pull brought a newer lockfile');
    fs.rmSync(path.join(dir, 'package-lock.json'));
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    at('pnpm-lock.yaml', -60); at('node_modules', -120);
    assert.equal(needsInstall(dir), 'pnpm install', 'pnpm: its marker missing, node_modules older');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'x' } }));
    assert.equal(needsInstall(dir), '', 'nothing to install');
    fs.writeFileSync(path.join(dir, 'package.json'), 'not json');
    assert.equal(needsInstall(dir), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a Makefile’s targets, and Cargo’s and Go’s own, after package.json’s', () => {
  const dir = project({ dev: 'vite', test: 'node --test' });
  try {
    fs.writeFileSync(path.join(dir, 'Makefile'), '.PHONY: serve lint\nCC=gcc\nserve:\n\tpython -m http.server\nlint: deps\n\truff .\ntest:\n\tpytest\n%.o: %.c\n\t$(CC)\nmain.o: main.c\nX := 1\n');
    assert.deepEqual(runs.scripts(dir).map((s) => `${s.name}${s.long ? '*' : ''} ${s.command}`), ['dev* npm run dev', 'test npm run test', 'serve* make serve', 'lint make lint']);
    fs.rmSync(path.join(dir, 'package.json'));
    fs.rmSync(path.join(dir, 'Makefile'));
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "x"\n');
    assert.deepEqual(runs.scripts(dir).map((s) => `${s.name}${s.long ? '*' : ''} ${s.command}`), ['run* cargo run', 'test cargo test', 'build cargo build']);
    fs.rmSync(path.join(dir, 'Cargo.toml'));
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module x\n');
    assert.equal(runs.scripts(dir)[1].command, 'go test ./...');
    fs.rmSync(path.join(dir, 'go.mod'));
    fs.writeFileSync(path.join(dir, 'compose.yaml'), 'services: {}\n');
    assert.deepEqual(runs.scripts(dir).map((s) => `${s.name}${s.long ? '*' : ''} ${s.command}`), ['up* docker compose up']);
    fs.rmSync(path.join(dir, 'compose.yaml'));
    assert.deepEqual(runs.scripts(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a Python project uv keeps: uv sync when its .venv is missing', () => {
  const { needsInstall } = require('../src/main/runs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-uv-'));
  try {
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    assert.equal(needsInstall(dir), '', 'no lockfile');
    fs.writeFileSync(path.join(dir, 'uv.lock'), '');
    assert.equal(needsInstall(dir), 'uv sync');
    fs.mkdirSync(path.join(dir, '.venv'));
    fs.writeFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), '');
    assert.equal(needsInstall(dir), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a .env to make: missing, with a template beside it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-env-'));
  try {
    assert.equal(runs.needsEnv(dir), '', 'no template');
    fs.writeFileSync(path.join(dir, '.env.sample'), 'KEY=\n');
    assert.equal(runs.needsEnv(dir), '.env.sample');
    fs.writeFileSync(path.join(dir, '.env.example'), 'KEY=\n');
    assert.equal(runs.needsEnv(dir), '.env.example', 'the usual one first');
    fs.writeFileSync(path.join(dir, '.env.local'), 'KEY=1\n');
    assert.equal(runs.needsEnv(dir), '', 'its values are in .env.local');
    fs.rmSync(path.join(dir, '.env.local'));
    fs.writeFileSync(path.join(dir, '.env'), 'KEY=1\n');
    assert.equal(runs.needsEnv(dir), '');
    assert.equal(runs.needsEnv(''), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
