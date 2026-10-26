const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before } = require('../src/main/branch');

test('finds the entry your message came after, to cut the conversation there', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-branch-')), 's.jsonl');
  fs.writeFileSync(file, [
    { type: 'user', uuid: 'u1', parentUuid: null, message: { content: 'first' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [] } },
    { type: 'user', uuid: 'u2', parentUuid: 'a1', message: { content: 'second' } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  assert.equal(before(file, 'u2'), 'a1');
  assert.equal(before(file, 'u1'), null, 'the first: nothing before it');
  assert.equal(before(file, 'nope'), undefined);
  assert.equal(before(path.join(path.dirname(file), 'none.jsonl'), 'u1'), undefined);
});
