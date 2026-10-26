process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert');
const limits = require('../src/main/limits');

const NOW = Date.UTC(2026, 9, 26, 12, 0); // a Monday, noon
const s = (ms) => Math.round(ms / 1000);
// As Claude Code sends it (stream-json rate_limit_event).
const info = {
  status: 'allowed_warning', resetsAt: s(Date.UTC(2026, 9, 30, 9)), rateLimitType: 'seven_day', utilization: 0.79, surpassedThreshold: 0.75,
  unifiedWindows: { five_hour: { utilization: 0.46, resetsAt: s(Date.UTC(2026, 9, 26, 15, 30)), status: 'allowed' }, seven_day: { utilization: 0.79, resetsAt: s(Date.UTC(2026, 9, 30, 9)), status: 'allowed' } },
};

test('reads both windows, the 5-hour one first', () => {
  const l = limits.read(info);
  assert.deepEqual(l.windows.map((w) => [w.kind, w.used]), [['five_hour', 0.46], ['seven_day', 0.79]]);
  assert.equal(limits.read(null), null);
  assert.equal(limits.read({}), null);
});

test('the overview line says how much and when each resets', () => {
  assert.equal(limits.line(limits.read(info), NOW), 'Usage: 46% of 5 hours (resets 3:30pm) · 79% of the week (resets Fri)');
  assert.equal(limits.line(null, NOW), '');
});

test('a window that has reset since drops out', () => {
  const later = Date.UTC(2026, 9, 26, 16);
  assert.equal(limits.line(limits.read(info), later), 'Usage: 79% of the week (resets Fri)');
});

test('warns under the field only from 75%, or once limited', () => {
  assert.equal(limits.warn(limits.read(info), NOW), '79% of the week used');
  const calm = { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.2 }, seven_day: { utilization: 0.5 } } };
  assert.equal(limits.warn(limits.read(calm), NOW), '');
  const out = { status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: s(Date.UTC(2026, 9, 26, 15)), unifiedWindows: { five_hour: { utilization: 1, resetsAt: s(Date.UTC(2026, 9, 26, 15)), status: 'rejected' }, seven_day: { utilization: 0.9, status: 'allowed' } } };
  assert.equal(limits.warn(limits.read(out), NOW), '5-hour limit reached · resets 3pm');
});

test('only the rateLimitType fields (no unifiedWindows) still count', () => {
  const l = limits.read({ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.8, resetsAt: s(Date.UTC(2026, 9, 26, 14)) });
  assert.equal(limits.line(l, NOW), 'Usage: 80% of 5 hours (resets 2pm)');
});

test('when a usage limit lifts: from its report, or from what Claude Code said', () => {
  const out = limits.read({ status: 'rejected', unifiedWindows: { five_hour: { utilization: 1, resetsAt: s(Date.UTC(2026, 9, 26, 15)), status: 'rejected' } } });
  assert.equal(limits.liftsAt(out, '', NOW), Date.UTC(2026, 9, 26, 15));
  assert.equal(limits.liftsAt(null, '5-hour limit reached ∙ resets 3pm', NOW), Date.UTC(2026, 9, 26, 15));
  assert.equal(limits.liftsAt(null, 'Claude usage limit reached. Your limit will reset at 9:30am (Europe/Oslo).', NOW), Date.UTC(2026, 9, 27, 9, 30), 'tomorrow, as it has passed today');
  assert.equal(limits.liftsAt(null, 'API Error: 529 overloaded', NOW), 0, 'not a limit');
  assert.equal(limits.liftsAt(limits.read(info), 'API Error: 500', NOW), 0, 'close to a limit isn’t at one');
});

test('reads get_usage’s rate_limits too (percentages, ISO times)', () => {
  const l = limits.fromUsage({ five_hour: { utilization: 46, resets_at: '2026-10-26T15:30:00Z' }, seven_day: { utilization: 79, resets_at: '2026-10-30T09:00:00Z' }, seven_day_opus: null, model_scoped: [] });
  assert.equal(limits.line(l, NOW), 'Usage: 46% of 5 hours (resets 3:30pm) · 79% of the week (resets Fri)');
  assert.equal(limits.warn(l, NOW), '79% of the week used');
  const full = limits.fromUsage({ five_hour: { utilization: 100, resets_at: '2026-10-26T15:00:00Z' } });
  assert.equal(limits.liftsAt(full, '', NOW), Date.UTC(2026, 9, 26, 15));
  assert.equal(limits.fromUsage(null), null);
  assert.equal(limits.fromUsage({ five_hour: null }), null);
});

test('a limit getting to 90%, or running out, is news once', () => {
  const now = new Date(2026, 9, 26, 12, 0).getTime();
  const at = new Date(2026, 9, 26, 15, 0).getTime();
  const lim = (used, kind = 'five_hour', status = 'allowed') => ({ status, windows: [{ kind, used, resetsAt: at, status }] });
  const told = new Set();
  assert.equal(limits.news(lim(0.5), told, now), null);
  assert.deepEqual(limits.news(lim(0.91), told, now), { title: '91% of your 5-hour limit used', body: 'It resets 3pm.' });
  assert.equal(limits.news(lim(0.95), told, now), null, 'said already');
  assert.equal(limits.news(lim(1, 'five_hour', 'rejected'), told, now).title, 'Your 5-hour limit is used up');
  assert.equal(limits.news(lim(1, 'five_hour', 'rejected'), told, now), null);
  assert.equal(limits.news(lim(0.92, 'seven_day_opus'), told, now).title, '92% of your weekly (Opus) limit used');
  assert.equal(limits.news(lim(0.92, 'seven_day'), told, at + 1), null, 'one that has reset is no news');
});
