// Which sessions have their blob on the stage. A session you hide stays
// tracked (its talk box, its notifications) but its blob and its helpers
// leave the stage until you show it again. With a Max blobs setting, the
// least relevant ones over the max are put away by themselves: one that
// needs you always shows (even over the max), then ones you showed by hand,
// then working ones, then done and idle ones, the most recent first. Your
// own hiding always wins.
'use strict';

// sessions: [{ id, state, updatedAt }]
// hidden: { id: when } hidden by hand
// wanted: { id: when } shown by hand while over the max
// max: how many blobs at most (0: no limit)
// -> Map id -> { shown, why } where why is '' (shown), 'hidden' (by hand)
//    or 'max' (put away for the max)
function visibility(sessions, { hidden = {}, wanted = {}, max = 0 } = {}) {
	const out = new Map();
	const rest = [];
	for (const s of sessions) {
		if (hidden[s.id]) out.set(s.id, { shown: false, why: 'hidden' });
		else rest.push(s);
	}
	const limit = Math.max(0, Math.floor(Number(max) || 0));
	if (!limit || rest.length <= limit) {
		for (const s of rest) out.set(s.id, { shown: true, why: '' });
		return out;
	}
	const ranked = rest.slice().sort((a, b) => rank(a, wanted) - rank(b, wanted) || recent(b, wanted) - recent(a, wanted));
	const waiting = ranked.filter((s) => s.state === 'waiting').length;
	let room = Math.max(0, limit - waiting);
	for (const s of ranked) {
		if (s.state === 'waiting') { out.set(s.id, { shown: true, why: '' }); continue; }
		if (room > 0) { room--; out.set(s.id, { shown: true, why: '' }); continue; }
		out.set(s.id, { shown: false, why: 'max' });
	}
	return out;
}

// Lower comes first (kept on the stage first).
function rank(s, wanted) {
	if (s.state === 'waiting') return 0;
	if (wanted[s.id]) return 1;
	if (s.state === 'working') return 2;
	return 3;
}
// (Shown by hand: the latest one you showed. Otherwise: heard from last.)
const recent = (s, wanted) => (wanted[s.id] && s.state !== 'waiting' ? wanted[s.id] : s.updatedAt || 0);

// Why one you just asked to show can't be: the max is taken up by blobs
// that need you. '' when it shows.
function blocked(vis, id, max) {
	const v = vis.get(id);
	if (!v || v.shown) return '';
	if (v.why !== 'max') return '';
	return `All ${max} spot${max === 1 ? ' is' : 's are'} taken by blobs that need you, and they always show. It comes out as soon as one is answered, or raise Max blobs.`;
}

module.exports = { visibility, blocked };
