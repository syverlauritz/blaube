// The snack jar: your Claude usage limits as a jar of cookies on the
// stage. Twenty cookies when a limit window is fresh, one fewer for each 5%
// you use (each one flies out to a slime as it goes), empty with crumbs once
// the limit is hit; it fills up again when it resets. What the jar shows
// (the 5-hour limit, or the week once that's nearly used up), how
// many cookies that is, and what its hover bubble says.
// The limits are main/limits.js's: { status, windows: [{ kind, used 0..1,
// resetsAt ms, status }] }.
(function (root) {
	'use strict';

	const NAMES = { five_hour: '5 hours', seven_day: 'Week', seven_day_opus: 'Opus this week', seven_day_sonnet: 'Sonnet this week' };
	const ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];
	// Nearly empty from here (blobs near it glance at it, worried).
	const LOW = 0.15;
	// The week takes over the jar only once this much of it is used (and
	// more than of the 5 hours): before that the week isn't what stops you.
	const WEEK_SHOWS = 0.75;

	// Each window as it is now: one whose reset has passed is fresh again
	// (nothing used), even before anyone has said so.
	function windows(lim, now) {
		if (!lim || !Array.isArray(lim.windows)) return [];
		return lim.windows.filter((w) => w && typeof w.used === 'number').map((w) => {
			const reset = !!w.resetsAt && w.resetsAt <= now;
			return { kind: w.kind, model: w.model || '', used: reset ? 0 : Math.max(0, Math.min(1, w.used)), resetsAt: reset ? 0 : w.resetsAt || 0, out: !reset && (w.status === 'rejected' || w.used >= 1), reset };
		}).sort((a, b) => rank(a.kind) - rank(b.kind));
	}
	const rank = (kind) => (ORDER.includes(kind) ? ORDER.indexOf(kind) : ORDER.length);

	// The window the jar shows: the 5-hour one (your session), unless the
	// week is nearly used up and closer to running out, or out (per-model
	// weeks only limit that model: hover only).
	function pick(lim, now = Date.now()) {
		const ws = windows(lim, now);
		const five = ws.find((w) => w.kind === 'five_hour'), week = ws.find((w) => w.kind === 'seven_day');
		if (!five || !week) return five || week || null;
		if (five.out || week.out) return five.out ? five : week;
		return week.used >= WEEK_SHOWS && week.used > five.used ? week : five;
	}

	// How full the jar is, 0..1 (null: nothing known, see lines).
	function level(lim, now = Date.now()) {
		const w = pick(lim, now);
		if (!w) return null;
		return w.out ? 0 : Math.max(0, Math.min(1, 1 - w.used));
	}

	// What a change of level means: 'refill' (it reset: cookies tumble in),
	// 'empty' (the limit's hit), 'low' (nearly empty now) or ''.
	function change(before, after) {
		if (before == null || after == null) return '';
		if (after - before > 0.25) return 'refill'; // (usage only drops like that when a window resets)
		if (after <= 0 && before > 0) return 'empty';
		if (after < LOW && before >= LOW) return 'low';
		return '';
	}

	// "20:20" (a 24-hour clock), or "Fri 09:00" once it's more than a day
	// away.
	function clock(at, now) {
		const d = new Date(at);
		const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
		return at - now > 24 * 3600e3 ? `${d.toLocaleDateString([], { weekday: 'short' })} ${t}` : t;
	}

	// The hover bubble: which limit the jar shows, then each window, "62%
	// used · resets 20:20". With none known, how come: { noPlan } (Claude
	// Code says there are no plan limits: an API key), { checking } (still
	// asking), or neither (asked, and no answer).
	function lines(lim, now = Date.now(), why = {}) {
		const w = pick(lim, now);
		if (!w && why.checking) return [{ text: 'Snack jar' }, { text: 'Checking usage…' }];
		if (!w) return [{ text: 'Snack jar' }, { text: 'Couldn’t check usage' }, { text: why.noPlan ? 'With an API key there are no plan limits' : 'Claude Code didn’t answer; it tries again soon', dim: true }];
		const out = [{ text: `Snack jar · ${w.kind === 'five_hour' ? '5-hour limit' : 'weekly limit (nearly used up)'}` }];
		for (const x of windows(lim, now)) {
			const name = NAMES[x.kind] || (x.model ? `${x.model} this week` : x.kind.replace(/_/g, ' '));
			const resets = x.resetsAt ? ` · resets ${clock(x.resetsAt, now)}` : '';
			const what = x.reset ? 'fresh again' : x.out ? `limit reached${resets}` : `${Math.round(x.used * 100)}% used${resets}`;
			out.push({ text: `${name}: ${what}`, dim: x.kind !== 'five_hour' && x.kind !== 'seven_day' });
		}
		return out;
	}

	// A full jar's cookies: one for each 5% of the limit.
	const CAP = 20;
	// Most thrown one after another for one jump in usage; past that the
	// rest just go (a jump that big is the jar switching to the week's
	// limit, not twenty cookies' worth eaten at once).
	const MAX_THROWS = 5;

	// How many cookies are in the jar at this level (null, nothing known:
	// full).
	const cookies = (lv) => (lv == null ? CAP : Math.max(0, Math.min(CAP, Math.round(lv * CAP))));

	// What the jar does to get from `have` cookies (and `coming` tumbling
	// in) to `want`: { throws (out to slimes, one by one), drop (gone at
	// once), cancel (tumbling ones not wanted after all), tumble (more to
	// tumble in) }.
	function plan(have, coming, want) {
		const out = { throws: 0, drop: 0, cancel: 0, tumble: 0 };
		if (want > have + coming) out.tumble = want - have - coming;
		else if (want < have + coming) {
			out.cancel = Math.min(coming, have + coming - want);
			const less = Math.max(0, have - want);
			out.throws = Math.min(MAX_THROWS, less);
			out.drop = less - out.throws;
		}
		return out;
	}

	const api = { LOW, WEEK_SHOWS, CAP, MAX_THROWS, windows, pick, level, change, clock, lines, cookies, plan };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.BlaubeSnack = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
