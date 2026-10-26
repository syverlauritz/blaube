const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { clean, command, rename } = require('../src/main/rename');
const usage = require('../src/main/usage');

test('reads /rename and tidies the name', () => {
  assert.equal(command('/rename  tax\n helper '), 'tax helper');
  assert.equal(command('/rename'), '');
  assert.equal(command('/renamed it'), null);
  assert.equal(command('rename it'), null);
  assert.equal(clean('x'.repeat(100)).length, 80);
});

test('names a session in its transcript, as Claude Code does', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-rename-'));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'ai-title', aiTitle: 'Fix the tax code', sessionId: 's' }) + '\n');
  assert.equal(usage.sessionInfo(file).title, 'Fix the tax code');
  assert.equal(rename(file, 's', ' Tax rewrite '), 'Tax rewrite');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').pop()), { type: 'custom-title', customTitle: 'Tax rewrite', sessionId: 's' });
  assert.equal(usage.sessionInfo(file).title, 'Tax rewrite');
  assert.throws(() => rename(file, 's', '  '));
  assert.throws(() => rename(path.join(dir, 'none.jsonl'), 's', 'x'));
});
