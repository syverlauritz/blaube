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
  assert.equal(glance({ state: 'done', tests: { pass: 10, fail: 2 }, git: 'main' }).meta, '2 tests failing · main');
  assert.equal(glance({ state: 'done', tests: { pass: 10, fail: 0 } }).meta, 'tests pass');
  assert.equal(glance({ state: 'done', lastReply: '**All** tests pass.' }).status, 'Done: All tests pass.');
  assert.equal(glance({ state: 'idle' }).status, 'Idle');
  assert.equal(glance({ state: 'idle', context: 20 }).meta, '', 'a little context isn’t worth saying');
});

test('the overview says how much happened since you last looked', () => {
  const { glance } = require('../src/main/attention.js');
  assert.equal(glance({ state: 'done', lastReply: 'Ok.', unread: 3, git: 'main' }).meta, '3 new replies since you looked · main');
  assert.equal(glance({ state: 'done', unread: 1 }).meta, '1 new reply since you looked');
});

test('the day so far, across sessions', () => {
  const { today } = require('../src/main/attention.js');
  const now = new Date(2026, 9, 26, 15, 0).getTime();
  const yesterday = new Date(2026, 9, 25, 23, 0).getTime();
  const logs = [
    [{ who: 'claude', at: yesterday, turn: { took: 3600e3, files: ['/old.js'] } }, { who: 'claude', at: now - 1e3, turn: { took: 90 * 60e3, files: ['/a.js', '/b.js'] } }],
    [{ who: 'you', at: now }, { who: 'claude', at: now, turn: { took: 40 * 60e3, files: ['/a.js'] } }, { who: 'claude', at: now }],
  ];
  assert.equal(today(logs, now), 'Today: 3 replies · 2h 10m of work · 2 files changed');
  assert.equal(today([[{ who: 'claude', at: yesterday }]], now), '');
});

test('search finds what was said in any session, most hits first, with a snippet', () => {
  const { search } = require('../src/main/attention.js');
  const sessions = [
    { id: 'a', project: 'kalkis', log: [{ who: 'you', text: 'add the tax brackets' }, { who: 'claude', text: 'The brackets for 2027 are in src/tax.js now.' }] },
    { id: 'b', project: 'website', log: [{ who: 'step', text: 'Ran npm test', detail: '$ npm test\nbrackets.test.js failed' }, { who: 'claude', text: 'Fixed the footer.' }] },
    { id: 'c', project: 'other', log: [{ who: 'claude', text: 'Nothing here.' }] },
  ];
  const r = search(sessions, 'Brackets');
  assert.deepEqual(r.map((x) => [x.id, x.hits]), [['a', 2], ['b', 1]]);
  assert.equal(r[0].snippet, 'The brackets for 2027 are in src/tax.js now.');
  assert.match(r[1].snippet, /brackets\.test\.js failed/);
  assert.deepEqual(search(sessions, 'x'), [], 'too short');
});

test('a permission it asks for can be answered from the notification', () => {
  const { notification } = require('../src/main/attention.js');
  const n = notification({ event: 'waiting', project: 'kalkis', text: 'Claude needs your permission to use Bash', ask: { kind: 'tool', tool: 'Bash', detail: 'Run `npm test`' } });
  assert.deepEqual(n, { title: 'kalkis asks to use Bash', body: 'Run npm test', actions: ['Allow', 'Deny'] });
  assert.equal(notification({ event: 'waiting', project: 'kalkis', text: 'Pick one', ask: { kind: 'question' } }).actions, undefined, 'a question needs the box');
});

test('an API error is worth a notification', () => {
  const { notification } = require('../src/main/attention.js');
  assert.deepEqual(notification({ event: 'error', project: 'kalkis', text: '5-hour limit reached ∙ resets 3pm' }), { title: 'kalkis couldn’t go on', body: '5-hour limit reached ∙ resets 3pm' });
});

test('a background task that crashed is worth a notification', () => {
  const { notification } = require('../src/main/attention');
  assert.deepEqual(notification({ event: 'task', project: 'kalkis', text: 'Dev server' }), { title: 'kalkis: Dev server stopped', body: 'It ended with an error. Its last lines are in its box.' });
  assert.equal(notification({ event: 'task', project: 'kalkis', text: 'Dev server', seen: true }), null);
});

test('the overview says how long it has been waiting on you', () => {
  const { glance } = require('../src/main/attention.js');
  const now = 10 * 3600e3;
  assert.equal(glance({ state: 'waiting', message: 'May I run npm test?', waitingSince: now - 5 * 60e3, now }).status, 'Needs you (5m): May I run npm test?');
  assert.equal(glance({ state: 'waiting', waitingSince: now - 130 * 60e3, now }).status, 'Needs you (2h)');
  assert.equal(glance({ state: 'waiting', waitingSince: now - 20e3, now }).status, 'Needs you');
});

test('a question in a notification: what it asks, its answers a tap away', () => {
  const ask = (questions) => ({ kind: 'question', input: { questions } });
  const n = notification({ event: 'waiting', project: 'kalkis', ask: ask([{ question: 'Which year?', options: [{ label: '2027' }, { label: '2028' }] }]) });
  assert.deepEqual(n, { title: 'kalkis asks', body: 'Which year?', question: 'Which year?', actions: ['2027', '2028'] });
  const many = notification({ event: 'waiting', project: 'kalkis', ask: ask([{ question: 'Pick some', multiSelect: true, options: [{ label: 'a' }] }]) });
  assert.deepEqual(many, { title: 'kalkis asks', body: 'Pick some' }, 'several picks: answered in its box');
  const four = notification({ event: 'waiting', project: 'kalkis', ask: ask([{ question: 'Which?', options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }] }]) });
  assert.equal(four.actions, undefined);
  assert.equal(four.question, 'Which?', 'still answerable in words');
});

test('a finished turn says what it came to in the title', () => {
  const { notification } = require('../src/main/attention');
  assert.equal(notification({ event: 'done', project: 'kalkis', text: 'Done.', secs: 90, turn: { files: 3, failed: false } }).title, 'kalkis is done · 3 files changed');
  assert.equal(notification({ event: 'done', project: 'kalkis', text: 'Done.', secs: 90, turn: { files: 1, failed: true } }).title, 'kalkis is done, but its tests fail · 1 file changed');
  assert.equal(notification({ event: 'done', project: 'kalkis', text: 'Done.', secs: 90, turn: { files: 0, failed: false } }).title, 'kalkis is done');
});

test('news of its pull request is a notification when its slime can’t be seen', () => {
  const { notification } = require('../src/main/attention');
  assert.deepEqual(notification({ event: 'pr', project: 'kalkis', text: 'PR #12: 1 check failed' }), { title: 'kalkis: PR #12: 1 check failed', body: 'Its box has a quick action for it.' });
  assert.deepEqual(notification({ event: 'pr', project: 'kalkis', text: 'PR #12 is merged' }), { title: 'kalkis: PR #12 is merged', body: 'On GitHub.' });
  assert.equal(notification({ event: 'pr', project: 'kalkis', text: 'PR #12 is merged', seen: true }), null);
});
