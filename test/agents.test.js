const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../src/main/agents');

test('agents list is read from plain output', () => {
  assert.deepStrictEqual(parse('[{"id":"a"}]'), [{ id: 'a' }]);
  assert.strictEqual(parse('nothing here'), null);
  assert.strictEqual(parse(''), null);
});

test('agents list survives a login shell printing colour codes first', () => {
  const out = '\x1b[0m\x1b[32mWelcome back [user]\x1b[0m\n[\n  {"id":"a","status":"busy"}\n]\nlogout\n';
  assert.deepStrictEqual(parse(out), [{ id: 'a', status: 'busy' }]);
});
