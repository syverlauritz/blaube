// Which of a session's history (read from its transcript: see
// src/main/transcript.js) the talk box shows above its live log (from
// hooks: src/main/inbox.js), so nothing shows twice. The live log is what
// it saw happen; the transcript is the source for everything before that.
// A hook reports a step or a reply a moment after the transcript has it, so
// just before the live log begins the two can overlap: there, a history
// entry with a live twin (same kind, same words) is left out. Plain
// JavaScript, so it runs in the talk box and in its tests.
(function (root) {
	'use strict';

	const OVERLAP = 2 * 60e3; // how long before the live log a twin can be
	const LIVE = { you: true, claude: true, step: true };
	// (A step's words without how its tests went, which a hook and the
	// transcript may count a little differently.)
	const words = (e) => { const t = String(e.text || '').trim(); return e.who === 'step' ? t.replace(/ · \d+ (?:failing|pass)$/, '') : t; };

	// The history entries to show, oldest first.
	function shown(history, log) {
		history = Array.isArray(history) ? history : [];
		log = Array.isArray(log) ? log : [];
		let first = Infinity;
		for (const e of log) if (LIVE[e.who] && e.at && e.via !== 'blaube' && e.at < first) first = e.at;
		if (first === Infinity) for (const e of log) if (LIVE[e.who] && e.at && e.at < first) first = e.at;
		if (first === Infinity) return history;
		// (From the newest back, each live entry standing for one in history,
		// in the same order: the overlap is the end of one and the start of
		// the other.)
		const keep = history.map((h) => h.at < first);
		let limit = log.length;
		for (let i = history.length - 1; i >= 0; i--) {
			const h = history[i];
			if (!keep[i] || h.at < first - OVERLAP) continue;
			let twin = -1;
			for (let j = 0; j < limit; j++) {
				const e = log[j];
				if (e.who === h.who && e.at >= h.at - 1000 && e.at <= h.at + OVERLAP && words(e) === words(h)) { twin = j; break; }
			}
			if (twin >= 0) { keep[i] = false; limit = twin; }
		}
		return history.filter((_, i) => keep[i]);
	}

	const api = { shown, OVERLAP };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.BlaubeTalkHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
