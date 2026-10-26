const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { slashCommand } = require('../src/main/commands.js');

test('slash commands, and messages that only start with a slash', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-cmd-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-proj-'));
  fs.mkdirSync(path.join(home, '.claude', 'commands', 'git'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'commands', 'git', 'ship.md'), 'x');
  fs.mkdirSync(path.join(proj, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'commands', 'deploy.md'), 'x');
  const is = (t) => slashCommand(t, proj, home);
  assert.equal(is('/compact'), '/compact');
  assert.equal(is('  /model opus'), '/model');
  assert.equal(is('/deploy staging'), '/deploy');
  assert.equal(is('/git:ship'), '/git:ship');
  assert.equal(is('/my-plugin:do-thing now'), '/my-plugin:do-thing');
  assert.equal(is('/api returns 500 now, can you fix it'), '');
  assert.equal(is('/tmp is full'), '');
  assert.equal(is('/usr/local/bin is missing'), '');
  assert.equal(is('hello /compact'), '');
});
