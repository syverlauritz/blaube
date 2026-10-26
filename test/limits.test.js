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
