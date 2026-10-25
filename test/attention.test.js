const test = require('node:test');
const assert = require('node:assert');
const { mostWanted, notification } = require('../src/main/attention.js');

test('the talk shortcut goes to whoever needs you most', () => {
  const s = (id, state, updatedAt, seen) => ({ id, state, updatedAt, seen });
  assert.equal(mostWanted([s('a', 'working', 5), s('b', 'waiting', 1), s('c', 'done', 9)]).id, 'b');
  assert.equal(mostWanted([s('a', 'working', 5), s('c', 'done', 1)]).id, 'c');
  assert.equal(mostWanted([s('a', 'working', 5), s('c', 'done', 9, true)]).id, 'a');
  assert.equal(mostWanted([s('a', 'idle', 5), s('b', 'idle', 9)]).id, 'b');
  assert.equal(mostWanted([s('demo-1', 'waiting', 9)]), null);
});

test('notifications only when the slimes can’t be seen, and finishing only after a wait', () => {
  assert.deepEqual(notification({ event: 'waiting', project: 'kalkis', text: 'Claude needs your permission to use Bash' }),
    { title: 'kalkis needs you', body: 'Claude needs your permission to use Bash' });
  assert.equal(notification({ event: 'waiting', project: 'kalkis', seen: true }), null);
  assert.equal(notification({ event: 'waiting', project: 'kalkis', enabled: false }), null);
  assert.equal(notification({ event: 'done', project: 'kalkis', secs: 5 }), null);
  assert.deepEqual(notification({ event: 'done', project: 'kalkis', title: 'Fix login', text: '**All** tests pass.', secs: 90 }), { title: 'Fix login is done', body: 'All tests pass.' });
});
