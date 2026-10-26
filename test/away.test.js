const test = require('node:test');
const assert = require('node:assert');
const { recap } = require('../src/main/away');

test('says what happened while you were away', () => {
  const since = 1000;
  const sessions = [
    { id: 'a', project: 'kalkis', state: 'done' },
    { id: 'b', project: 'web', name: 'web · Hero rework', state: 'waiting' },
    { id: 'c', project: 'api', state: 'working' },
    { id: 'demo-1', project: 'demo', state: 'waiting' },
  ];
  const logs = new Map([
    ['a', [{ who: 'claude', at: 500 }, { who: 'claude', at: 1500, turn: { files: ['tax.js', 'tests.js'] } }]],
    ['b', [{ who: 'claude', at: 1200, turn: { files: ['Hero.tsx'] } }]],
    ['c', [{ who: 'claude', at: 1300 }]],
  ]);
  assert.equal(recap(sessions, logs, since), 'kalkis finished · web · Hero rework needs you · 3 replies · 3 files changed');
  assert.equal(recap(sessions.slice(0, 1), logs, 2000), '', 'nothing since');
  assert.equal(recap([{ id: 'x', project: 'p', state: 'waiting' }], new Map(), since), 'p needs you');
  const many = ['a', 'b', 'c', 'd'].map((id) => ({ id, project: id, state: 'done' }));
  assert.equal(recap(many, new Map(many.map((s) => [s.id, [{ who: 'claude', at: 2000 }]])), since), 'a, b and 2 more finished · 4 replies');
});
