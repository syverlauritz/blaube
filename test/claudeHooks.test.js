const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hooks = require('../src/main/claudeHooks.js');

test('installs alongside existing hooks and uninstalls cleanly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-'));
  const file = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file));
  const original = {
    model: 'opus',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
  };
  fs.writeFileSync(file, JSON.stringify(original));

  hooks.install(file);
  assert.ok(hooks.isInstalled(file));
  hooks.install(file); // idempotent
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.model, 'opus');
  assert.equal(s.hooks.Stop.length, 2);
  assert.equal(s.hooks.PreToolUse[0].matcher, '*');
  assert.ok(fs.existsSync(file + '.blaube-backup'));

  hooks.uninstall(file);
  assert.ok(!hooks.isInstalled(file));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
});

test('refuses to touch a settings file it cannot parse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => hooks.install(file));
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
});

test('hooks from an older Blaube count as needing an update', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-'));
  const file = path.join(dir, 'settings.json');
  const old = { type: 'command', command: 'curl -s --data-binary @- http://127.0.0.1:47821/blaube/hook || true' };
  fs.writeFileSync(file, JSON.stringify({ hooks: Object.fromEntries(hooks.EVENTS.map((e) => [e, [{ hooks: [old] }]])) }));
  assert.ok(!hooks.isInstalled(file));
  assert.ok(hooks.hasAnyBlaubeHooks(file));
  hooks.install(file);
  assert.ok(hooks.isInstalled(file));
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.hooks.Stop.length, 1, 'old hook replaced, not duplicated');
});
