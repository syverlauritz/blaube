const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const taskOutput = require('../src/main/taskOutput');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-tasks-'));
const dir = path.join(root, '-Users-me-kalkis', 'sess-1', 'tasks');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'bash_7.output');

test('finds a background task’s output file under any project', () => {
  fs.writeFileSync(file, 'ready on :3000\n');
  assert.equal(taskOutput.find('sess-1', 'bash_7', { roots: [path.join(root, 'nope'), root] }), file);
  assert.equal(taskOutput.find('sess-1', 'bash_8', { roots: [root] }), '');
  assert.equal(taskOutput.find('..', 'bash_7', { roots: [root] }), '', 'no climbing out');
  assert.equal(taskOutput.find('sess-1', '../x', { roots: [root] }), '');
});

test('its tail, without colour codes, and how it ended', () => {
  fs.writeFileSync(file, '\x1b[32mready\x1b[0m on :3000\nGET / 200\n\n[exited with code 1]\n');
  assert.deepEqual(taskOutput.tail(file), { text: 'ready on :3000\nGET / 200', exited: 1, cut: false });
  fs.writeFileSync(file, 'still going\n');
  assert.equal(taskOutput.tail(file).exited, null);
});

test('a long one from a whole line near its end', () => {
  fs.writeFileSync(file, Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n'));
  const t = taskOutput.tail(file, 100);
  assert.ok(t.cut);
  assert.match(t.text, /^line \d+\n/);
  assert.match(t.text, /line 1999$/);
  assert.equal(taskOutput.tail(path.join(root, 'missing')), null);
});

test('looks in Claude Code’s own temp folder first', () => {
  const r = taskOutput.roots({ CLAUDE_CODE_TMPDIR: '/x/tmp' });
  assert.ok(r[0].startsWith(path.join('/x/tmp', 'claude')));
});

test('the local address a dev server says it’s on', () => {
  fs.writeFileSync(file, '\x1b[32m  VITE v5 ready\x1b[0m\n  ➜  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n  ➜  Network: use --host\n');
  assert.equal(taskOutput.url(file), 'http://localhost:5173/');
  fs.writeFileSync(file, 'Server listening on http://0.0.0.0:3000.\n');
  assert.equal(taskOutput.url(file), 'http://localhost:3000');
  fs.writeFileSync(file, 'see https://github.com/x/y for docs\nbuilt in 2s\n');
  assert.equal(taskOutput.url(file), '', 'not someone else’s site');
  assert.equal(taskOutput.url(path.join(root, 'missing')), '');
});
