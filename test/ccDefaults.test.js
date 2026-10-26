const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { read, write, fileOf } = require('../src/main/ccDefaults');

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-cc-'));

test('no settings yet: Claude Code decides', () => {
  assert.deepEqual(read(home()), { model: '', mode: '' });
});

test('picks a model and a mode, keeping everything else in the file', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(fileOf(h), JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(ls)'] } }));
  assert.equal(write({ model: 'opus', mode: 'acceptEdits' }, h), true);
  assert.deepEqual(read(h), { model: 'opus', mode: 'acceptEdits' });
  assert.deepEqual(JSON.parse(fs.readFileSync(fileOf(h), 'utf8')), { theme: 'dark', permissions: { allow: ['Bash(ls)'], defaultMode: 'acceptEdits' }, model: 'opus' });
  assert.equal(write({ model: '', mode: '' }, h), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(fileOf(h), 'utf8')), { theme: 'dark', permissions: { allow: ['Bash(ls)'] } });
});

test('creates the file, drops an empty permissions block, refuses an unknown mode', () => {
  const h = home();
  assert.equal(write({ mode: 'plan' }, h), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(fileOf(h), 'utf8')), { permissions: { defaultMode: 'plan' } });
  assert.equal(write({ mode: '' }, h), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(fileOf(h), 'utf8')), {});
  assert.equal(write({ mode: 'bypassPermissions' }, h), false);
});

test('a settings file that isn’t JSON is left alone', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(fileOf(h), '{ "model": "opus", // a comment\n}');
  assert.equal(write({ model: 'haiku' }, h), false);
  assert.equal(fs.readFileSync(fileOf(h), 'utf8'), '{ "model": "opus", // a comment\n}');
});
