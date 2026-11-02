const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/main/routines');

const at = (s) => new Date(s).getTime(); // (local time)

test('a routine needs a folder, something to say and when', () => {
  assert.ok(R.make({ cwd: '/p', prompt: 'look at my PRs', every: 'day', at: '09:00' }));
  assert.ok(R.make({ cwd: '/p', prompt: 'x', every: 'hour' }));
  assert.equal(R.make({ cwd: '/p', prompt: '  ', every: 'day', at: '09:00' }), null);
  assert.equal(R.make({ cwd: '/p', prompt: 'x', every: 'day', at: '25:00' }), null);
  assert.equal(R.make({ cwd: '/p', prompt: 'x', every: 'month', at: '09:00' }), null);
  assert.equal(R.make({ cwd: '', prompt: 'x', every: 'hour' }), null);
});

test('every day at a time: the next one after now', () => {
  const r = { every: 'day', at: '09:00' };
  assert.equal(R.next(r, at('2026-11-02T08:00')), at('2026-11-02T09:00'));
  assert.equal(R.next(r, at('2026-11-02T09:00')), at('2026-11-03T09:00'));
  assert.equal(R.next(r, at('2026-11-02T10:00')), at('2026-11-03T09:00'));
});

test('weekdays skip the weekend', () => {
  const r = { every: 'weekdays', at: '09:00' };
  assert.equal(R.next(r, at('2026-11-06T10:00')), at('2026-11-09T09:00'), 'Friday after nine: Monday');
  assert.equal(R.next(r, at('2026-11-07T08:00')), at('2026-11-09T09:00'), 'Saturday: Monday');
});

test('due once, even after missing several', () => {
  const r = R.make({ cwd: '/p', prompt: 'x', every: 'day', at: '09:00' }, at('2026-11-02T10:00'));
  assert.ok(!R.due(r, at('2026-11-02T23:00')));
  assert.ok(R.due(r, at('2026-11-03T09:00')));
  r.last = at('2026-11-05T12:00'); // (asleep for two days, ran on waking)
  assert.ok(!R.due(r, at('2026-11-05T12:01')));
  assert.ok(R.due(r, at('2026-11-06T09:00')));
  const h = R.make({ cwd: '/p', prompt: 'x', every: 'hour' }, at('2026-11-02T10:00'));
  assert.ok(!R.due(h, at('2026-11-02T10:59')) && R.due(h, at('2026-11-02T11:00')));
});

test('says when, in words', () => {
  assert.equal(R.when({ every: 'weekdays', at: '17:30' }), 'weekdays at 17:30');
  assert.equal(R.when({ every: 'hour' }), 'every hour');
  const r = { every: 'day', at: '09:00', created: at('2026-11-02T10:00') };
  assert.equal(R.nextLabel(r, at('2026-11-02T10:00')), 'tomorrow 09:00');
  assert.equal(R.nextLabel(r, at('2026-11-03T08:30')), 'in 30m');
});
