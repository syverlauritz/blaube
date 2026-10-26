// The Blobs overview: every live session, its colour, name, how it is and
// its helpers, with an eye to show or hide its blob; Max blobs; and Show
// all / Hide all idle. Redrawn with every update from the app.
(function () {
	'use strict';
	const api = window.blaubeBlobs;
	const $ = (id) => document.getElementById(id);
	const NS = 'http://www.w3.org/2000/svg';
	let last = null;

	// Two eyes in the blobs' own style: ink ovals, or asleep (soft arcs).
	function eyes() {
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('viewBox', '0 0 30 16');
		for (const x of [8, 22]) {
			const open = document.createElementNS(NS, 'ellipse');
			Object.entries({ class: 'open', cx: x, cy: 7, rx: 3.3, ry: 4 }).forEach(([k, v]) => open.setAttribute(k, v));
			const shut = document.createElementNS(NS, 'path');
			shut.setAttribute('class', 'shut');
			shut.setAttribute('d', `M${x - 4} 7 Q${x} 11.5 ${x + 4} 7`);
			svg.append(open, shut);
		}
		return svg;
	}

	const max = $('max');
	for (let n = 0; n <= 20; n++) max.add(new Option(n ? String(n) : 'No limit', String(n)));
	max.onchange = () => api.setMax(Number(max.value));
	$('close').onclick = () => api.close();
	$('showAll').onclick = () => api.showAll();
	$('hideIdle').onclick = () => api.hideIdle();
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close(); });

	function draw(s) {
		last = s;
		document.body.classList.toggle('dark', !!s.dark);
		const rows = s.rows || [];
		const off = rows.filter((r) => !r.shown).length;
		$('sub').textContent = rows.length ? `${s.shown} on the screen${off ? ` · ${off} hidden` : ''}` : 'No sessions right now';
		const ul = $('rows');
		const keep = new Map([...ul.children].map((li) => [li.dataset.id, li]));
		ul.textContent = '';
		if (!rows.length) { const p = document.createElement('li'); p.className = 'empty'; p.textContent = 'Start a session and its blob shows up here.'; ul.append(p); }
		for (const r of rows) {
			const li = keep.get(r.id) || document.createElement('li');
			li.textContent = '';
			li.dataset.id = r.id;
			li.className = r.shown ? '' : 'off';
			li.style.setProperty('--c', r.color);
			const dot = document.createElement('i');
			dot.className = 'dot';
			const who = document.createElement('button');
			who.type = 'button';
			who.className = 'who';
			who.disabled = !r.talk;
			who.title = r.talk ? `Talk to ${r.name}` : r.name;
			const name = document.createElement('b');
			name.textContent = r.name;
			const how = document.createElement('small');
			const word = document.createElement('span');
			word.textContent = r.word;
			if (r.state === 'waiting') word.className = 'wants';
			const bits = [];
			if (r.helpers) bits.push(`${r.helpers} helper${r.helpers === 1 ? '' : 's'}`);
			if (r.why === 'hidden') bits.push('hidden');
			else if (r.why === 'max') bits.push('hidden (over max)');
			else if (r.state === 'waiting' && s.over) bits.push('shows even over the max');
			how.append(word, bits.length ? ` · ${bits.join(' · ')}` : '');
			who.append(name, how);
			who.onclick = () => api.talk(r.id);
			const eye = document.createElement('button');
			eye.type = 'button';
			eye.className = 'eye';
			eye.setAttribute('aria-pressed', String(!!r.shown));
			eye.setAttribute('aria-label', r.shown ? `Hide ${r.name}’s blob` : `Show ${r.name}’s blob`);
			eye.title = r.shown ? 'Hide its blob (its session carries on)' : r.why === 'max' ? 'Show it (a less busy one makes way)' : 'Show its blob';
			eye.append(eyes());
			eye.onclick = () => { eye.classList.remove('boing'); void eye.offsetWidth; eye.classList.add('boing'); api.toggle(r.id); };
			li.append(dot, who, eye);
			ul.append(li);
		}
		max.value = String(s.max || 0);
		$('maxHint').hidden = !s.max;
		$('note').hidden = !s.note;
		$('note').textContent = s.note ? s.note.text : '';
		$('showAll').disabled = !rows.some((r) => r.why === 'hidden');
		$('hideIdle').disabled = !rows.some((r) => r.shown && (r.state === 'idle' || r.state === 'done'));
		fit();
	}

	// The window is as tall as what's in it (the app keeps it on the screen).
	function fit() {
		requestAnimationFrame(() => {
			const card = $('card');
			const list = $('rows');
			const h = card.offsetHeight - list.clientHeight + list.scrollHeight + 16;
			api.setHeight(h);
		});
	}
	window.addEventListener('resize', () => { if (last) fit(); });
	api.onState(draw);
})();
