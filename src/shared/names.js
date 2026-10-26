// What a session (a mother slime) is called wherever it is named: its
// repo (project) name, first. Only when two or more live sessions share a
// repo does the chat name (its title) come in, to tell them apart: "blaube
// · Fix the login bug", or as a second line where there is room for one.
// Helpers keep their own descriptions; this is for mothers only. Plain
// JavaScript, so it runs in both.
(function (root) {
	'use strict';

	const key = (p) => String(p || '').trim().toLowerCase();

	// sessions: [{ id, project, title? }] (the live ones); titleOf(s): its chat
	// name, asked only for sessions that share a repo with another.
	// -> Map id -> { name: the repo, sub: the chat name ('' if no need), full: name · sub }
	function names(sessions, titleOf) {
		const count = new Map();
		for (const s of sessions) count.set(key(s.project), (count.get(key(s.project)) || 0) + 1);
		const out = new Map();
		for (const s of sessions) {
			const name = s.project || 'Claude';
			let sub = '';
			if (count.get(key(s.project)) > 1) {
				sub = String((titleOf ? titleOf(s) : s.title) || '').trim();
				if (key(sub) === key(name)) sub = '';
			}
			out.set(s.id, { name, sub, full: sub ? `${name} · ${sub}` : name });
		}
		return out;
	}

	const api = { names };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.BlaubeNames = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
