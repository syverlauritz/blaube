const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { command, install } = require('../src/main/installer');

test('runs the official installer the setup page has you paste', () => {
  assert.deepEqual(command('darwin'), ['/bin/bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'], 'curl -fsSL https://claude.ai/install.sh | bash']);
  assert.equal(command('win32')[2], 'irm https://claude.ai/install.ps1 | iex');
});

const fake = (code, said) => (bin, args) => {
  const p = new EventEmitter();
  p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
  p.kill = () => p.emit('close', null);
  p.args = [bin, ...args];
  if (code !== 'never') setTimeout(() => { p.stdout.emit('data', said); p.emit('close', code); }, 10);
  return p;
};

test('says how it went', async () => {
  assert.deepEqual(await new Promise((done) => install((ok, last) => done([ok, last]), { platform: 'linux', run: fake(0, 'Installing…\n✔ Claude Code installed\n') })), [true, 'Installing…\n✔ Claude Code installed']);
  assert.deepEqual(await new Promise((done) => install((ok, last) => done([ok, last]), { platform: 'linux', run: fake(1, 'curl: (6) Could not resolve host\n') })), [false, 'curl: (6) Could not resolve host']);
  const late = await new Promise((done) => install((ok, last) => done([ok, last]), { platform: 'linux', run: fake('never'), timeout: 30 }));
  assert.equal(late[0], false);
  assert.match(late[1], /over five minutes/);
});
