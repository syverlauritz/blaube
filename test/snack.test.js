process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert');
const snack = require('../src/shared/snack');
const limits = require('../src/main/limits');

const NOW = Date.UTC(2026, 9, 26, 12, 0); // a Monday, noon
const H = 3600e3;
const lim = (five, week, more = {}) => ({ status: 'allowed', windows: [
	five != null && { kind: 'five_hour', used: five, resetsAt: NOW + 2 * H, status: five >= 1 ? 'rejected' : 'allowed' },
	week != null && { kind: 'seven_day', used: week, resetsAt: NOW + 4 * 24 * H, status: week >= 1 ? 'rejected' : 'allowed' },
	...(more.models || []),
].filter(Boolean) });

test('full when fresh, empties as usage rises', () => {
	assert.equal(snack.level(lim(0, 0), NOW), 1);
	assert.equal(snack.level(lim(0.62, 0.1), NOW).toFixed(2), '0.38');
	assert.equal(snack.level(lim(0.99, 0.1), NOW).toFixed(2), '0.01');
	assert.equal(snack.level(lim(1, 0.2), NOW), 0);
});

test('nothing known: no level', () => {
	assert.equal(snack.level(null, NOW), null);
	assert.equal(snack.level({ windows: [] }, NOW), null);
	assert.equal(snack.pick(null, NOW), null);
});

test('the 5-hour limit, unless the week is closer to running out', () => {
	assert.equal(snack.pick(lim(0.4, 0.2), NOW).kind, 'five_hour');
	assert.equal(snack.pick(lim(0.4, 0.4), NOW).kind, 'five_hour'); // (a tie: the 5-hour one)
	assert.equal(snack.pick(lim(0.3, 0.85), NOW).kind, 'seven_day');
	assert.equal(snack.level(lim(0.3, 0.85), NOW).toFixed(2), '0.15');
	assert.equal(snack.pick(lim(null, 0.5), NOW).kind, 'seven_day');
	// A per-model week only limits that model: not the jar.
	const opus = lim(0.2, 0.3, { models: [{ kind: 'seven_day_opus', used: 0.95, resetsAt: NOW + 3 * 24 * H, status: 'allowed' }] });
	assert.equal(snack.pick(opus, NOW).kind, 'seven_day');
	// Limited outright wins over a fuller number.
	const out = { windows: [{ kind: 'five_hour', used: 0.97, resetsAt: NOW + H, status: 'rejected' }, { kind: 'seven_day', used: 0.99, resetsAt: NOW + 50 * H, status: 'allowed' }] };
	assert.equal(snack.pick(out, NOW).kind, 'five_hour');
	assert.equal(snack.level(out, NOW), 0);
});

test('past its reset a window is fresh again, before anyone says so', () => {
	const l = lim(1, 0.3);
	assert.equal(snack.level(l, NOW), 0);
	assert.equal(snack.level(l, NOW + 2 * H + 1).toFixed(2), '0.70'); // (the week's 30% shows now)
	assert.equal(snack.level(lim(1, null), NOW + 3 * H), 1);
	assert.equal(snack.change(0, snack.level(lim(1, null), NOW + 3 * H)), 'refill');
});

test('changes: refill, empty, low', () => {
	assert.equal(snack.change(0.05, 0.95), 'refill');
	assert.equal(snack.change(0.1, 0), 'empty');
	assert.equal(snack.change(0.3, 0.1), 'low');
	assert.equal(snack.change(0.5, 0.45), '');
	assert.equal(snack.change(0.1, 0.05), ''); // (already low)
	assert.equal(snack.change(null, 1), '');
	assert.equal(snack.change(0, 0), '');
});

test('hover lines: how much of each window, and when it resets', () => {
	const l = lim(0.62, 0.41, { models: [{ kind: 'seven_day_opus', used: 0.12, resetsAt: NOW + 3 * 24 * H, status: 'allowed' }] });
	const out = snack.lines(l, NOW);
	assert.equal(out[0].text, 'Snack jar · 5-hour limit');
	assert.match(out[1].text, /^5 hours: 62% used · resets \S+/);
	assert.match(out[2].text, /^Week: 41% used · resets \S+ \S+/); // (a weekday and a time: days away)
	assert.match(out[3].text, /^Opus this week: 12% used/);
	assert.ok(out[3].dim && !out[1].dim);
	assert.match(snack.lines(lim(0.3, 0.9), NOW)[0].text, /weekly limit/);
	assert.match(snack.lines(lim(1, 0.2), NOW)[1].text, /^5 hours: limit reached · resets/);
	assert.equal(snack.lines(lim(1, 0.2), NOW + 3 * H)[1].text, '5 hours: fresh again');
});

test('hover lines when usage isn’t known: still checking, no answer, or an API key', () => {
	assert.deepEqual(snack.lines(null, NOW, { checking: true }).map((l) => l.text), ['Snack jar', 'Checking usage…']);
	assert.equal(snack.lines(null, NOW)[1].text, 'Couldn’t check usage');
	assert.doesNotMatch(snack.lines(null, NOW)[2].text, /API key/);
	assert.match(snack.lines(null, NOW, { noPlan: true })[2].text, /API key/);
	// (Known limits win over a stale "checking".)
	assert.match(snack.lines(lim(0.5, 0.1), NOW, { checking: true })[1].text, /^5 hours: 50% used/);
});

test('reset times on a 24-hour clock: "20:20", "Fri 09:00" days away', () => {
	assert.equal(snack.clock(Date.UTC(2026, 9, 26, 20, 20), NOW), '20:20');
	assert.equal(snack.clock(Date.UTC(2026, 9, 26, 13, 5), NOW), '13:05');
	assert.match(snack.clock(Date.UTC(2026, 9, 30, 9, 0), NOW), /^\S+ 09:00$/);
	assert.match(snack.lines(lim(0.62, 0.1), NOW)[1].text, /resets 14:00$/);
});

test('Claude Code’s newer answer (a subscription): per-model weeks as model_scoped', () => {
	// (As a Max plan's get_usage answers now: the old per-model fields null.)
	const rl = { five_hour: { utilization: 56, resets_at: '2026-10-26T14:19:59.856601+00:00' }, seven_day: { utilization: 31, resets_at: '2026-11-02T09:59:59.856621+00:00' }, seven_day_opus: null, seven_day_sonnet: null, model_scoped: [{ display_name: 'Fable', utilization: 4, resets_at: '2026-11-02T10:00:00+00:00' }] };
	const l = limits.fromUsage(rl);
	assert.deepEqual(l.windows.map((w) => w.kind), ['five_hour', 'seven_day', 'seven_day_fable']);
	assert.equal(snack.level(l, NOW).toFixed(2), '0.44');
	const out = snack.lines(l, NOW).map((x) => x.text);
	assert.deepEqual(out.slice(0, 2), ['Snack jar · 5-hour limit', '5 hours: 56% used · resets 14:19']);
	assert.match(out[2], /^Week: 31% used · resets \S+ 09:59$/);
	assert.match(out[3], /^Fable this week: 4% used · resets \S+ 10:00$/);
	assert.match(limits.line(l, NOW), /4% of the week \(Fable\)/);
});

test('from what Claude Code reports (limits.js) all the way to a level', () => {
	const rl = { five_hour: { utilization: 46, resets_at: new Date(NOW + H).toISOString() }, seven_day: { utilization: 79, resets_at: new Date(NOW + 90 * H).toISOString() } };
	const l = limits.fromUsage(rl);
	assert.equal(snack.pick(l, NOW).kind, 'seven_day');
	assert.equal(snack.level(l, NOW).toFixed(2), '0.21');
});

test('cookies: every 1-3 minutes at work, sooner with more at it, rarer idle', () => {
	assert.equal(snack.nextCookie(1, () => 0), 60);
	assert.equal(snack.nextCookie(1, () => 1), 180);
	assert.ok(snack.nextCookie(3, () => 0.5) < snack.nextCookie(1, () => 0.5));
	assert.ok(snack.nextCookie(20, () => 0) >= 30);
	assert.ok(snack.nextCookie(0, () => 0) >= 360 && snack.nextCookie(0, () => 1) <= 720);
});

test('usage rising (tokens spent) is noticed', () => {
	assert.equal(snack.rose(lim(0.4, 0.1), lim(0.42, 0.1), NOW), true);
	assert.equal(snack.rose(lim(0.4, 0.1), lim(0.4, 0.1), NOW), false);
	assert.equal(snack.rose(null, lim(0.4, 0.1), NOW), false);
	assert.equal(snack.rose(lim(0.9, 0.1), lim(0.1, 0.1), NOW), false); // (a reset is no snack)
});
