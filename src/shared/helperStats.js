// A helper's time and tokens the way Claude Code's terminal shows them:
// "2m 14s · ↓ 117.0k tokens". Used by the talk box, the hover bubble and
// the Blobs overview (and its tests). Plain JavaScript, so it runs in all.
(function (root) {
	'use strict';

	// 850, 117.0k, 1.2m (one decimal, as the terminal has it).
	function tokenCount(n) {
		n = Math.max(0, Math.round(Number(n) || 0));
		if (n < 1000) return String(n);
		if (n < 999950) return (n / 1000).toFixed(1) + 'k';
		return (n / 1e6).toFixed(1) + 'm';
	}

	// 9s, 2m 14s, 1h 3m.
	function elapsed(ms) {
		const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
		if (s < 60) return `${s}s`;
		if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
		return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
	}

	// The whole line for a helper: since (ms, 0 if not known), tokens, now.
	function helperStats(since, tokens, now = Date.now()) {
		const bits = [];
		if (since > 0) bits.push(elapsed(now - since));
		if (tokens > 0) bits.push(`↓ ${tokenCount(tokens)} tokens`);
		return bits.join(' · ');
	}

	const api = { tokenCount, elapsed, helperStats };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.BlaubeHelperStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
