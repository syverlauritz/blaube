const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sessionsInFront, cleanTitle } = require('../src/main/focus.js');

// terminal 100 -> shell 200 -> claude 300, and shell 210 -> claude 310 in the same terminal.
const parents = new Map([[300, 200], [200, 100], [310, 210], [210, 100], [900, 1]]);

function transcript(title) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-')), 't.jsonl');
  fs.writeFileSync(file, `{"type":"user"}\n{"type":"ai-title","aiTitle":"Old"}\n{"type":"ai-title","aiTitle":${JSON.stringify(title)}}\n`);
  return file;
}

test('strips the spinner from window titles', () => {
  assert.equal(cleanTitle('◐ Mother blaube subagent hierarchy'), 'Mother blaube subagent hierarchy');
  assert.equal(cleanTitle('✳ Fix the bug'), 'Fix the bug');
});

test('one session in the window in front is the one you see', () => {
  const s = [{ id: 'a', pid: 300 }, { id: 'b', pid: 900 }];
  assert.deepEqual(sessionsInFront(s, { pid: 100, title: 'Whatever' }, parents).map((x) => x.id), ['a']);
  assert.deepEqual(sessionsInFront(s, { pid: 555, title: 'Chrome' }, parents), []);
});

test('tabs in one window are told apart by title', () => {
  const s = [{ id: 'a', pid: 300, transcript: transcript('Fix the bug') }, { id: 'b', pid: 310, transcript: transcript('Write docs') }];
  assert.deepEqual(sessionsInFront(s, { pid: 100, title: '✳ Write docs' }, parents).map((x) => x.id), ['b']);
  // Can't tell which tab: nobody counts as seen.
  assert.deepEqual(sessionsInFront(s, { pid: 100, title: 'Claude Code' }, parents), []);
});
