// Opening the talk box over and over, in the real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/opens.js BLAUBE_PORT=47878 npx electron .
//
// On Windows a box opened from a click on a slime (a window that never
// takes focus) can lose the focus straight back to the app you were in: it
// blurs a moment after showing. Each time here it does, as there, and the
// box has to stay open until you click somewhere else after it opened. It
// also has to start invisible and fade in: the first frame anyone sees is
// its start state, never the last conversation at full strength. Prints
// what happened, in order, when something's wrong. Exits non-zero on a
// failure.
const http = require('node:http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMES = 20;

module.exports = async function run({ win, PORT, talk, talkId }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(20); } return false; };
	const page = (js) => win.webContents.executeJavaScript(js);
	const hook = (id, payload) => new Promise((done) => {
		const req = http.request({ host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli' } }, (res) => { res.resume(); res.on('end', done); });
		req.on('error', done);
		req.end(JSON.stringify(Object.assign({ session_id: id, cwd: `/tmp/opens-${id.slice(-1)}` }, payload)));
	});
	const A = `opens-${Date.now()}-a`, B = `opens-${Date.now()}-b`;
	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);
	for (const id of [A, B]) {
		await hook(id, { hook_event_name: 'SessionStart' });
		await hook(id, { hook_event_name: 'UserPromptSubmit', prompt: `a task for ${id.slice(-1)}` });
		await hook(id, { hook_event_name: 'Stop', last_assistant_message: Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of what ${id.slice(-1)} did.`).join('\n') });
	}
	check(await until(async () => (await page(`__blaube.buddies.size`)) >= 2, 8000), 'two slimes appear');
	const ob = win.getBounds();
	const open = (id) => page(`window.blaube.talk(${JSON.stringify(id)}, { x: ${Math.round(ob.width / 2)}, y: ${Math.round(ob.height - 330)}, r: 60 })`);
	// How much of a picture of the box is drawn (its pixels' alpha, all added up).
	const ink = (img) => { const b = img.toBitmap(); let n = 0; for (let i = 3; i < b.length; i += 4) n += b[i]; return n / 255; };

	// What happens to the box, in order, with the time.
	let events = [], t0 = Date.now();
	const note = (what) => events.push(`${String(Date.now() - t0).padStart(5)} ms ${what}`);
	const fade = global.__blaubeTalkFade = []; // (main notes when it lets the box be seen, and how it was drawn then)
	const watched = new Set();
	const watch = () => {
		const w = talk();
		if (!w || watched.has(w)) return;
		watched.add(w);
		for (const e of ['show', 'hide', 'focus', 'blur']) w.on(e, () => note(e));
	};
	watch();
	// Shown: what's on it right away, and Windows taking the focus back a
	// moment later, as when it opens from a click on a slime.
	let shownLit = [], firstInk = [], bounce = 0;
	const onShow = () => {
		const w = talk();
		shownLit.push(!!global.__blaubeTalkLit);
		w.webContents.capturePage().then((img) => firstInk.push(ink(img)), () => firstInk.push(-1));
		const wait = [0, 5, 30, 80, 150][bounce++ % 5];
		setTimeout(() => { if (!w.isDestroyed() && w.isVisible()) { w.emit('focus'); w.emit('blur'); note(`(Windows takes the focus back after ${wait} ms)`); } }, wait);
	};

	let stayed = 0, faded = 0, settledInk = 0;
	for (let i = 0; i < TIMES; i++) {
		const id = i % 4 === 3 ? B : A;
		events = []; t0 = Date.now();
		watch();
		talk().once('show', onShow);
		const lit = fade.length;
		note(`open ${id.slice(-1)}`);
		await open(id);
		const shown = await until(() => talk().isVisible() && talkId() === id);
		await sleep(700); // (long after anything Windows does on its own)
		const ok = shown && talk().isVisible() && talkId() === id;
		if (ok) stayed++;
		else console.log(`     open #${i + 1} closed by itself:\n       ${events.join('\n       ')}`);
		// The first frame anyone could see was its start state.
		const f = fade[lit];
		const start = !shownLit[i] && f && f.after >= 0 && f.drawn < 0.05;
		if (start) faded++;
		else console.log(`     open #${i + 1} showed at full strength: ${JSON.stringify({ litAtShow: shownLit[i], fade: f || null, ink: firstInk[i] })}`);
		if (i === 0 && talk().isVisible()) settledInk = ink(await talk().webContents.capturePage().catch(() => null) || { toBitmap: () => [] });
		// Then closed, a different way each time: its slime clicked again,
		// a click outside it, the focus going elsewhere, Esc.
		const how = i % 4;
		note(['click its slime', 'click outside it', 'focus goes elsewhere', 'Esc'][how]);
		if (how === 0) await open(id);
		else if (how === 1) { const b = talk().getBounds(); if (global.__blaubePressAt) global.__blaubePressAt({ x: b.x - 40, y: b.y + 10 }); else { talk().emit("focus"); talk().emit("blur"); } }
		else if (how === 2) { talk().emit('focus'); talk().emit('blur'); }
		else await talk().webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
		const closed = await until(() => !talk().isVisible(), 1500);
		if (!closed) { console.log(`     #${i + 1}: “${['click its slime', 'click outside it', 'focus goes elsewhere', 'Esc'][how]}” didn’t close it:\n       ${events.join('\n       ')}`); failed++; }
		await sleep(400); // (past “a click on its slime right now means close”)
	}
	check(stayed === TIMES, `opened ${TIMES} times with the focus bouncing back, it never closed by itself (${stayed} stayed open)`);
	check(faded === TIMES, `it was never seen before it had drawn its start state (${faded} of ${TIMES}, seen ${Math.min(...fade.map((f) => f.after))}–${Math.max(...fade.map((f) => f.after))} ms after showing, drawn at opacity ≤ ${Math.max(...fade.map((f) => f.drawn)).toFixed(2)})`);
	// (What a reused box has on it as it shows: its last conversation, at
	// full strength, until it draws again. Behind an unseen window, now.)
	console.log(`     first frames on showing: ${firstInk.map((n) => Math.round(n / Math.max(1, settledInk) * 100) + '%').join(' ')} of a settled box's ink`);

	// A press inside it, or on a slime, closes nothing.
	await open(A);
	await until(() => talk().isVisible());
	await sleep(300);
	const b = talk().getBounds();
	if (global.__blaubePressAt) global.__blaubePressAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
	await sleep(300);
	check(talk().isVisible(), 'a press inside it leaves it open');

	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
