const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const memory = require('../src/main/memory');

test('a message starting with "# " is a note to remember', () => {
  assert.equal(memory.noteIn('# always use pnpm'), 'always use pnpm');
  assert.equal(memory.noteIn('#  tests live in test/\n and run with npm test'), 'tests live in test/ and run with npm test');
  assert.equal(memory.noteIn('#1 priority is the login bug'), '');
  assert.equal(memory.noteIn('## Heading'), '');
  assert.equal(memory.noteIn('fix #12'), '');
});

test('it goes at the end of the project’s CLAUDE.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-mem-'));
  const file = memory.remember(dir, 'always use pnpm');
  assert.equal(fs.readFileSync(file, 'utf8'), '- always use pnpm\n');
  fs.writeFileSync(file, '# Project\n\nSome rules');
  memory.remember(dir, 'tests run with npm test');
  assert.equal(fs.readFileSync(file, 'utf8'), '# Project\n\nSome rules\n- tests run with npm test\n');
});
