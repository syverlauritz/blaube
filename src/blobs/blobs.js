// The Blobs overview: every live session as a row of a table (its name,
// how it is, what it's on, and an eye to show or hide its blob), its
// helpers tucked in under it with eyes of their own; Max blobs as a
// stepper; Show all / Hide all idle. Updated in place with every update
// from the app, so nothing flickers and the list keeps its scroll.
(function () {
	'use strict';
	const api = window.blaubeBlobs;
	const $ = (id) => document.getElementById(id);
	const NS = 'http://www.w3.org/2000/svg';
	let last = null;
	// Sessions whose helpers you've folded away (kept for next time).
	const folded = new Set((() => { try { return JSON.parse(localStorage.getItem('folded') || '[]'); } catch { return []; } })());
	const keepFolded = () => { try { localStorage.setItem('folded', JSON.stringify([...folded])); } catch { /* not kept */ } };

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
	// (Only touched when it changes: no flicker, hover and focus kept.)
	const text = (el, t) => { if (el.textContent !== t) el.textContent = t; };
	const attr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
	const cls = (el, c) => { if (el.className !== c) el.className = c; };

	// One row, made once per session or helper, then kept up to date.
	const made = new Map(); // key -> { li, parts }
	function rowFor(key, kid) {
		if (made.has(key)) return made.get(key);
		const li = document.createElement('li');
		li.dataset.id = key;
		const name = document.createElement('div');
		name.className = 'cell name';
		const fold = document.createElement('button');
		fold.type = 'button';
		fold.className = 'fold';
		fold.innerHTML = '<svg viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
		fold.onclick = () => { if (folded.has(key)) folded.delete(key); else folded.add(key); keepFolded(); if (last) draw(last); };
		const dot = document.createElement('i');
		dot.className = 'dot';
		const who = document.createElement('button');
		who.type = 'button';
		who.className = 'who';
		if (!kid) who.onclick = () => api.talk(key);
		else who.tabIndex = -1;
		name.append(...(kid ? [dot, who] : [fold, dot, who]));
		const status = document.createElement('div');
		status.className = 'cell status';
		const word = document.createElement('span');
		const small = document.createElement('small');
		status.append(word, small);
		const doing = document.createElement('div');
		doing.className = 'cell doing';
		const eye = document.createElement('button');
		eye.type = 'button';
		eye.className = 'eye';
		eye.append(eyes());
		eye.onclick = () => (kid ? api.toggleHelper(key) : api.toggle(key));
		li.append(name, status, doing, eye);
		const r = { li, fold, who, word, small, status, doing, eye };
		made.set(key, r);
		return r;
	}

	function fill(r, o, kid, s) {
		cls(r.li, `row${kid ? ' kid' : ''}${o.onStage ? '' : ' off'}`);
		if (r.li.style.getPropertyValue('--c') !== o.color) r.li.style.setProperty('--c', o.color);
		text(r.who, o.name);
		attr(r.who, 'title', kid ? o.name : `${o.name}: talk to it`);
		if (!kid) {
			r.who.disabled = !o.talk;
			r.fold.classList.toggle('none', !o.kids.length);
			attr(r.fold, 'aria-expanded', String(!folded.has(o.id)));
			attr(r.fold, 'title', folded.has(o.id) ? 'Show its helpers' : 'Fold its helpers away');
		}
		text(r.word, o.word);
		cls(r.status, `cell status${o.state === 'waiting' ? ' wants' : ''}`);
		const bits = [];
		if (!kid && o.helpers) bits.push(`${o.helpers} helper${o.helpers === 1 ? '' : 's'}`);
		if (kid && o.byParent) bits.push('hidden with it');
		else if (kid && !o.shown) bits.push('hidden');
		if (!kid && o.why === 'hidden') bits.push('hidden');
		else if (!kid && o.why === 'max') bits.push('hidden (over max)');
		else if (!kid && o.state === 'waiting' && s.over) bits.push('shows over the max');
		text(r.small, bits.join(' · '));
		attr(r.status, 'title', [o.word, ...bits].join(' · '));
		r.small.hidden = !bits.length;
		text(r.doing, o.doing || '');
		attr(r.doing, 'title', o.doing || '');
		// The eye: its own choice; off with its session, dimmed.
		attr(r.eye, 'aria-pressed', String(!!o.shown));
		r.eye.classList.toggle('byparent', !!(kid && o.byParent));
		const label = kid ? (o.byParent ? (o.shown ? 'Hidden with its session (it comes back with it); click to keep it hidden' : 'Hidden with its session, and kept hidden after; click to let it come back') : o.shown ? 'Hide this helper’s blob' : 'Show this helper’s blob')
			: o.shown ? 'Hide its blob (its session carries on)' : o.why === 'max' ? 'Show it (a less busy one makes way)' : 'Show its blob';
		attr(r.eye, 'title', label);
		attr(r.eye, 'aria-label', `${o.name}: ${label}`);
	}

	function draw(s) {
		last = s;
		document.body.classList.toggle('dark', !!s.dark);
		const rows = s.rows || [];
		const off = rows.filter((r) => !r.shown).length;
		text($('sub'), rows.length ? `${s.shown} on the screen${off ? ` · ${off} hidden` : ''}` : 'No sessions right now');
		const ul = $('rows');
		const want = [];
		for (const o of rows) {
			const r = rowFor(o.id, false);
			fill(r, Object.assign({ onStage: o.shown }, o), false, s);
			want.push(r.li);
			if (folded.has(o.id)) continue;
			for (const k of o.kids || []) {
				const kr = rowFor(k.key, true);
				fill(kr, Object.assign({ color: o.color, onStage: o.shown && k.shown }, k), true, s);
				want.push(kr.li);
			}
		}
		// Gone ones out; the rest in order (moved only where they must).
		const keys = new Set(want.map((li) => li.dataset.id));
		for (const [key, r] of made) if (!keys.has(key)) { r.li.remove(); if (!rows.some((o) => o.id === key || (o.kids || []).some((k) => k.key === key))) made.delete(key); }
		const empty = ul.querySelector('.empty');
		if (rows.length && empty) empty.remove();
		if (!rows.length && !empty) { const p = document.createElement('li'); p.className = 'empty'; p.textContent = 'Start a session and its blob shows up here.'; ul.append(p); }
		want.forEach((li, i) => { if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null); });
		// Max blobs: a number, or none (no limit).
		const input = $('max');
		if (document.activeElement !== input) input.value = s.max ? String(s.max) : '';
		$('less').disabled = !s.max;
		$('more').disabled = s.max >= 20;
		$('noLimit').classList.toggle('on', !s.max);
		attr($('noLimit'), 'aria-pressed', String(!s.max));
		$('maxHint').hidden = !s.max;
		$('note').hidden = !s.note;
		text($('note'), s.note ? s.note.text : '');
		$('showAll').disabled = !rows.some((r) => r.why === 'hidden' || (r.kids || []).some((k) => !k.shown));
		$('hideIdle').disabled = !rows.some((r) => r.shown && (r.state === 'idle' || r.state === 'done'));
		fit();
	}

	// Max blobs: − and + step it (+ from no limit starts at as many as there
	// are, so nothing hides at once); typed in, it's set on Enter, on leaving
	// the field, or after a moment; empty or 0 is no limit.
	const setMax = (n) => api.setMax(Math.max(0, Math.min(20, Math.floor(Number(n) || 0))));
	const count = () => (last && last.rows ? last.rows.length : 1);
	$('less').onclick = () => { if (last && last.max) setMax(last.max - 1); };
	$('more').onclick = () => { if (!last) return; setMax(last.max ? last.max + 1 : Math.max(1, Math.min(20, count()))); };
	$('noLimit').onclick = () => { $('max').value = ''; setMax(0); };
	let typing = null;
	const commit = () => { clearTimeout(typing); typing = null; const v = $('max').value.trim(); setMax(v === '' ? 0 : v); };
	$('max').addEventListener('input', () => {
		const clean = $('max').value.replace(/\D/g, '').slice(0, 2);
		if (clean !== $('max').value) $('max').value = clean;
		clearTimeout(typing);
		typing = setTimeout(commit, 800);
	});
	$('max').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { commit(); $('max').blur(); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); $('more').click(); }
		else if (e.key === 'ArrowDown') { e.preventDefault(); $('less').click(); }
		else if (e.key === 'Escape') { e.stopPropagation(); $('max').value = last && last.max ? String(last.max) : ''; $('max').blur(); }
	});
	$('max').addEventListener('blur', () => { if (typing) commit(); });

	$('close').onclick = () => api.close();
	$('showAll').onclick = () => api.showAll();
	$('hideIdle').onclick = () => api.hideIdle();
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.activeElement !== $('max')) api.close(); });

	// Its edges resize it (the app keeps the size).
	for (const g of document.querySelectorAll('.grip')) {
		g.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			g.setPointerCapture(e.pointerId);
			api.resize('start', g.dataset.edge, e.screenX, e.screenY);
			const move = (m) => api.resize('move', g.dataset.edge, m.screenX, m.screenY);
			const up = (u) => { api.resize('end', g.dataset.edge, u.screenX, u.screenY); g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); };
			g.addEventListener('pointermove', move);
			g.addEventListener('pointerup', up);
		});
	}

	// The window is as tall as what's in it (up to the height you gave it).
	function fit() {
		requestAnimationFrame(() => {
			const card = $('card');
			const list = $('rows');
			api.setHeight(card.offsetHeight - list.clientHeight + list.scrollHeight + 16);
		});
	}
	api.onState(draw);
})();
