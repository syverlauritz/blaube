const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rules = require('../src/main/permRules');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-home-'));
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-proj-'));
fs.mkdirSync(path.join(home, '.claude'));
fs.mkdirSync(path.join(proj, '.claude'));
const local = path.join(proj, '.claude', 'settings.local.json');
fs.writeFileSync(local, JSON.stringify({ permissions: { allow: ['Bash(npm test:*)', 'Edit'], deny: ['Bash(rm:*)'] }, model: 'opus' }, null, 2));
fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['WebFetch(domain:github.com)'] } }));
fs.writeFileSync(path.join(proj, '.claude', 'settings.json'), '{ not json');

test('lists what it may do without asking, the most local first', () => {
  assert.deepEqual(rules.list([proj, proj], home).map((r) => [r.rule, r.scope]), [
    ['Bash(npm test:*)', 'This project, just you'],
    ['Edit', 'This project, just you'],
    ['WebFetch(domain:github.com)', 'You, everywhere'],
  ]);
});

test('takes one back, keeping the rest of the file', () => {
  assert.equal(rules.remove(local, 'Bash(npm test:*)'), true);
  const j = JSON.parse(fs.readFileSync(local, 'utf8'));
  assert.deepEqual(j, { permissions: { allow: ['Edit'], deny: ['Bash(rm:*)'] }, model: 'opus' });
  assert.equal(rules.remove(local, 'Bash(npm test:*)'), false, 'already gone');
  assert.equal(rules.remove(path.join(proj, '.claude', 'settings.json'), 'Edit'), false, 'never rewrites a file it can’t read');
  assert.equal(fs.readFileSync(path.join(proj, '.claude', 'settings.json'), 'utf8'), '{ not json');
});

test('says each rule plainly', () => {
  assert.equal(rules.label('Bash(npm test:*)'), 'Run npm test…');
  assert.equal(rules.label('Edit'), 'Edit (anything)');
  assert.equal(rules.label('WebFetch(domain:github.com)'), 'WebFetch: domain:github.com');
});

test('adds an Always allow rule, keeping everything else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-perm-'));
  const file = path.join(dir, '.claude', 'settings.local.json');
  assert.equal(rules.add(file, 'Bash(npm test:*)'), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { permissions: { allow: ['Bash(npm test:*)'] } });
  fs.writeFileSync(file, JSON.stringify({ model: 'opus', permissions: { allow: ['Edit'], deny: ['Bash(rm:*)'] } }));
  assert.equal(rules.add(file, ' WebFetch(domain:example.com) '), true);
  assert.equal(rules.add(file, 'Edit'), false, 'there already');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { model: 'opus', permissions: { allow: ['Edit', 'WebFetch(domain:example.com)'], deny: ['Bash(rm:*)'] } });
  assert.throws(() => rules.add(file, 'rm -rf /'));
  assert.throws(() => rules.add(file, ''));
  fs.writeFileSync(file, 'not json');
  assert.throws(() => rules.add(file, 'Edit'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'not json');
});
