// The snack jar: your Claude usage limits as a jar of cookies on the
// stage. Full when a limit window is fresh, emptier as you use it, empty
// with crumbs once the limit is hit; it fills up again when it resets.
// What the jar shows (the 5-hour limit, or the week when that's closer to
// running out), what its hover bubble says, and how often a cookie flies.
// The limits are main/limits.js's: { status, windows: [{ kind, used 0..1,
// resetsAt ms, status }] }.
(function (root) {
	'use strict';

	const NAMES = { five_hour: '5 hours', seven_day: 'Week', seven_day_opus: 'Opus this week', seven_day_sonnet: 'Sonnet this week' };
	const ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];
	// Nearly empty from here (blobs near it glance at it, worried).
	const LOW = 0.15;

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

	// The window the jar shows: the 5-hour one, unless the week's is closer
	// to running out (per-model weeks only limit that model: hover only).
	function pick(lim, now = Date.now()) {
		const ws = windows(lim, now).filter((w) => w.kind === 'five_hour' || w.kind === 'seven_day');
		if (!ws.length) return null;
		return ws.reduce((a, w) => (w.out && !a.out) || (w.out === a.out && w.used > a.used) ? w : a);
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
		const out = [{ text: `Snack jar · ${w.kind === 'five_hour' ? '5-hour limit' : 'weekly limit (closer to running out)'}` }];
		for (const x of windows(lim, now)) {
			const name = NAMES[x.kind] || (x.model ? `${x.model} this week` : x.kind.replace(/_/g, ' '));
			const resets = x.resetsAt ? ` · resets ${clock(x.resetsAt, now)}` : '';
			const what = x.reset ? 'fresh again' : x.out ? `limit reached${resets}` : `${Math.round(x.used * 100)}% used${resets}`;
			out.push({ text: `${name}: ${what}`, dim: x.kind !== 'five_hour' && x.kind !== 'seven_day' });
		}
		return out;
	}

	// Seconds until the next cookie flies: every 1 to 3 minutes while a
	// session works (sooner with more of them at it), 6 to 12 idle.
	function nextCookie(working, rnd = Math.random) {
		if (working > 0) return (60 + rnd() * 120) / Math.min(2, 1 + 0.25 * (working - 1));
		return 360 + rnd() * 360;
	}

	// Usage went up since the last report (tokens being spent): a cookie's
	// due soon. Rationed by the caller.
	function rose(before, after, now = Date.now()) {
		const a = pick(before, now), b = pick(after, now);
		return !!(a && b && a.kind === b.kind && b.used - a.used >= 0.01);
	}

	const api = { LOW, windows, pick, level, change, clock, lines, nextCookie, rose };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.BlaubeSnack = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
