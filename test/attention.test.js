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

test('a session at a glance, in words', () => {
  const { glance } = require('../src/main/attention.js');
  const now = 1e12;
  assert.deepEqual(glance({ state: 'waiting', message: 'Claude needs your permission to use Bash' }), { status: 'Needs you: Claude needs your permission to use Bash', meta: '' });
  assert.deepEqual(glance({ state: 'working', doing: 'Editing face.js', turnStart: now - 4.5 * 60e3, now, todo: { done: 2, of: 4 }, context: 72, git: 'main · 3 changed' }),
    { status: 'Editing face.js · 4m', meta: '2 of 4 on its list · 72% context · main · 3 changed' });
  assert.equal(glance({ state: 'working', turnStart: now - 10e3, now }).status, 'Working');
  assert.equal(glance({ state: 'done', lastReply: '**All** tests pass.' }).status, 'Done: All tests pass.');
  assert.equal(glance({ state: 'idle' }).status, 'Idle');
  assert.equal(glance({ state: 'idle', context: 20 }).meta, '', 'a little context isn’t worth saying');
});

test('the overview says how much happened since you last looked', () => {
  const { glance } = require('../src/main/attention.js');
  assert.equal(glance({ state: 'done', lastReply: 'Ok.', unread: 3, git: 'main' }).meta, '3 new replies since you looked · main');
  assert.equal(glance({ state: 'done', unread: 1 }).meta, '1 new reply since you looked');
});
