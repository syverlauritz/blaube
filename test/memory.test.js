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

test('/memory: what it reads and what it has remembered, from the files themselves', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-reads-'));
  const config = path.join(root, 'config'), repo = path.join(root, 'repo'), cwd = path.join(repo, 'web');
  const proj = path.join(config, 'projects', 'key');
  for (const d of [config, path.join(repo, '.claude'), cwd, path.join(proj, 'memory')]) fs.mkdirSync(d, { recursive: true });
  for (const f of [path.join(config, 'CLAUDE.md'), path.join(repo, 'CLAUDE.md'), path.join(repo, '.claude', 'CLAUDE.md'), path.join(cwd, 'CLAUDE.local.md')]) fs.writeFileSync(f, '# x\n');
  fs.writeFileSync(path.join(proj, 'memory', 'MEMORY.md'), '- [[pnpm]]\n');
  fs.writeFileSync(path.join(proj, 'memory', 'pnpm.md'), '---\nname: pnpm\ndescription: "This repo uses pnpm, not npm"\n---\n\nUse pnpm.\n');
  fs.writeFileSync(path.join(proj, 'memory', 'plain.md'), 'No front matter.\n');
  const r = memory.whatItReads(cwd, config, path.join(proj, 'abc.jsonl'));
  assert.deepEqual(r.reads, [path.join(config, 'CLAUDE.md'), path.join(repo, 'CLAUDE.md'), path.join(repo, '.claude', 'CLAUDE.md'), path.join(cwd, 'CLAUDE.local.md')]);
  assert.deepEqual(r.memories, [{ name: 'plain', description: '' }, { name: 'pnpm', description: 'This repo uses pnpm, not npm' }]);
  assert.deepEqual(memory.whatItReads(cwd, '', '').memories, []);
});
