const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { match, walk, list } = require('../src/main/files.js');

test('@ finds files the way you would guess them', () => {
  const paths = ['README.md', 'src/main/tax.js', 'src/taxes/rates.js', 'test/tax.test.js', 'docs/syntax.md', 'src/main/text.js'];
  assert.deepEqual(match(paths, 'tax').slice(0, 3), ['src/main/tax.js', 'test/tax.test.js', 'docs/syntax.md']);
  assert.ok(match(paths, 'tax').includes('src/taxes/rates.js'), 'a folder that has it');
  assert.deepEqual(match(paths, 'smt'), ['src/main/tax.js', 'src/main/text.js'], 'letters in order');
  assert.equal(match(paths, '')[0], 'README.md', 'nothing typed: the top of the project');
  assert.deepEqual(match(paths, 'zzz'), []);
  assert.equal(match(paths, 'TAX')[0], 'src/main/tax.js');
});

test('outside git, a walk that skips what nobody means', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-files-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), '');
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'b.js'), '');
  assert.deepEqual(walk(dir), ['src/a.js']);
  assert.deepEqual(await new Promise((r) => list(dir, r)), ['src/a.js']);
});
