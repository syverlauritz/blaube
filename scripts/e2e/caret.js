// Typing to a slime in its talk box: its eyes follow the caret along the
// line (left at the start, right at the end), and now and then it makes a
// little "ooh!", but not every few seconds:
//
//   BLAUBE_TEST=scripts/e2e/caret.js BLAUBE_PORT=47930 npx electron .
//
// Exits non-zero on a failure.
const path = require('node:path');
const os = require('node:os');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function run({ win, tracker, inbox, talk, talkId }) {
	let failed = 0; const errs = [];
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	win.webContents.on('console-message', (e) => { if (e.level === 'error') errs.push(e.message); });
	const js = (s) => win.webContents.executeJavaScript(s);
	const box = (s) => talk().webContents.executeJavaScript(s);
	const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false);
	await sleep(1000);

	const id = 'caret' + Date.now();
	tracker.handle({ session_id: id, cwd: path.join(os.tmpdir(), 'blaube-caret'), hook_event_name: 'SessionStart' });
	inbox.reachable.add(id); // (as if its inbox hook had asked: a box you can type in)
	const ID = JSON.stringify(id);
	check(await until(() => js(`!!__blaube.buddies.get(${ID})`), 6000), 'its slime is there');
	await sleep(1500);
	const at = await js(`(() => { const b = __blaube.buddies.get(${ID}), c = b.body.centroid(); return { x: c.x, y: c.y, r: b.body.o.radius }; })()`);
	await js(`window.blaube.talk(${ID}, ${JSON.stringify(at)})`);
	check(await until(() => talk() && talk().isVisible() && talkId() === id, 8000), 'its talk box opens');
	talk().webContents.setBackgroundThrottling(false);
	await sleep(800);
	await box(`document.getElementById('text').focus()`);

	// Where the caret is, on the slimes' layer (as the box measures it).
	const caretOnStage = async () => {
		const p = await box(`BlaubeCaret.measure(document.getElementById('text'))`);
		const cb = talk().getContentBounds(), wb = win.getBounds();
		return { x: cb.x + p.x - wb.x, y: cb.y + p.y - wb.y };
	};
	const eyes = () => js(`(() => { const b = __blaube.buddies.get(${ID}); return { target: b.gazeTarget, gaze: b.gaze && { x: b.gaze.x, y: b.gaze.y }, drift: b.body.o.radius * 0.25 + 8, oohs: b.oohs || 0, ooh: __blaube.now() < (b.oohUntil || 0) }; })()`);
	// (Typed in the page: the field gets each key and its letter, the caret
	// moving on, as from the keyboard.)
	const type = async (s, every = 160) => {
		for (const ch of s) {
			await box(`(() => { const f = document.getElementById('text'); f.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(ch)}, bubbles: true })); document.execCommand('insertText', false, ${JSON.stringify(ch)}); f.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(ch)}, bubbles: true })); })()`);
			await sleep(every);
		}
	};

	// A long line, typed: its eyes end up on the caret, at the end of it.
	await type('Squishy little friends that keep an eye on', 90);
	await sleep(1300); // (its gaze glides there: see updateGaze)
	const end = await caretOnStage(), e1 = await eyes();
	const off = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
	check(off(e1.target, end) < 3, `its eyes aim at the caret (${e1.target && Math.round(e1.target.x)},${e1.target && Math.round(e1.target.y)} vs ${Math.round(end.x)},${Math.round(end.y)})`);
	check(off(e1.gaze, end) < e1.drift, `and get there, smoothly (${Math.round(off(e1.gaze, end))} px off; real eyes drift a little)`);
	// Back to the start of the line: they follow it left.
	await box(`(() => { const f = document.getElementById('text'); f.setSelectionRange(0, 0); f.dispatchEvent(new Event('select')); })()`);
	await sleep(1300); // (its gaze glides there: see updateGaze)
	const start = await caretOnStage(), e2 = await eyes();
	check(end.x - start.x > 150, `the line is long (${Math.round(end.x - start.x)} px)`);
	check(off(e2.target, start) < 3 && off(e2.gaze, start) < e2.drift, `the caret at the start: its eyes go left with it (aim ${Math.round(off(e2.target, start))} px off, eyes ${Math.round(off(e2.gaze, start))} px, allowed ${Math.round(e2.drift)})`);
	// A couple of seconds after the last key, back to its own business.
	await sleep(3000);
	const e3 = await eyes();
	check(off(e3.target, start) > 3, 'stopped typing a while: its eyes are its own again');

	// Twenty seconds of typing: an "ooh!" or two, never one every few seconds.
	await box(`(() => { const f = document.getElementById('text'); f.setSelectionRange(f.value.length, f.value.length); })()`);
	await js(`__blaube.buddies.get(${ID}).oohs = 0; __blaube.buddies.get(${ID}).typedFor = 0`);
	const words = ' your sessions while you work on the fun stuff and they sing when it is done';
	const t0 = Date.now();
	let seen = false;
	const watch = (async () => { while (Date.now() - t0 < 20500) { if ((await eyes()).ooh) seen = true; await sleep(100); } })();
	while (Date.now() - t0 < 20000) {
		await type(words.slice(0, 12), 150);
		await box(`(() => { const f = document.getElementById('text'); if (f.value.length > 400) { f.value = ''; f.dispatchEvent(new Event('input')); } })()`);
	}
	await watch;
	const n = (await eyes()).oohs;
	check(n >= 1 && n <= 3, `in 20 s of typing it oohed ${n} time(s) (1 to 3)`);
	check(seen, 'and the "ooh" shows on its face');

	check(errs.length === 0, `no errors (${errs.slice(0, 3).join(' | ')})`);
	return failed ? 1 : 0;
};
