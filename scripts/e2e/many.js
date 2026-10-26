// Load check, in the real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/many.js BLAUBE_PORT=47874 npx electron .
//
// A dozen sessions all working at once, each taking hundreds of steps
// (big outputs among them), with one talk box open and the overview up,
// then all ending. Checks that the app keeps up (its main loop never
// stalls for long, the box isn't redrawn for every event), that nothing
// is kept per session forever, and that the box still works afterwards.
// Prints the numbers. Exits non-zero on a failure.
const http = require('node:http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SESSIONS = 12, STEPS = 300;

module.exports = async function run({ win, inbox, tracker, PORT, talk, talkId }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	const page = (js) => win.webContents.executeJavaScript(js);
	const box = (js) => talk().webContents.executeJavaScript(js);
	const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
	const hook = (id, payload) => new Promise((done) => {
		const req = http.request({ agent, host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli', 'x-blaube-out': '1' } }, (res) => { res.resume(); res.on('end', done); });
		req.on('error', done);
		req.end(JSON.stringify(Object.assign({ session_id: id, cwd: `/tmp/project-${id.slice(-2)}` }, payload)));
	});
	const ids = Array.from({ length: SESSIONS }, (_, i) => `many-${Date.now()}-${String(i).padStart(2, '0')}`);

	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);
	for (const id of ids) {
		await hook(id, { hook_event_name: 'SessionStart' });
		await hook(id, { hook_event_name: 'UserPromptSubmit', prompt: `task for ${id.slice(-2)}` });
	}
	check(await until(async () => (await page(`__blaube.buddies.size`)) >= SESSIONS, 15000), `${SESSIONS} slimes appear`);
	await page(`window.blaube.talk(${JSON.stringify(ids[0])}, { x: 300, y: 600, r: 60 })`);
	check(await until(() => talk() && talk().isVisible() && talkId() === ids[0]), 'a talk box opens on one');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true }))`);
	check(await until(() => box(`document.body.classList.contains('overview')`)), 'with the overview up');

	// Count what the box is sent, and how long the main loop stalls.
	let sends = 0;
	const wc = talk().webContents, send = wc.send.bind(wc);
	wc.send = (ch, ...a) => { if (ch === 'talk-state') sends++; return send(ch, ...a); };
	let worst = 0, last = Date.now();
	const lag = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last - 10); last = now; }, 10);
	const heapBefore = process.memoryUsage().heapUsed;
	// And the longest stretch of work on the slimes' page and in the box
	// (frames can't be timed here: invisible windows draw once a second).
	const watch = `window.__long = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long = Math.max(window.__long, e.duration); }).observe({ type: 'longtask' })`;
	await page(watch);
	await box(watch);

	const big = 'x'.repeat(200e3);
	const t0 = Date.now();
	await Promise.all(ids.map(async (id) => {
		for (let i = 0; i < STEPS; i++) {
			const file = `/tmp/project/src/file${i % 17}.js`;
			const input = i % 3 === 0 ? { command: `npm test -- ${i}` } : { file_path: file, old_string: `a${i}`, new_string: `b${i}` };
			const name = i % 3 === 0 ? 'Bash' : 'Edit';
			await hook(id, { hook_event_name: 'PreToolUse', tool_name: name, tool_input: input });
			await hook(id, { hook_event_name: 'PostToolUse', tool_name: name, tool_input: input, tool_response: i % 50 === 0 ? { stdout: big } : { stdout: 'ok' } });
			if (i % 60 === 59) await hook(id, { hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: Array.from({ length: 8 }, (_, k) => ({ content: `item ${k}`, activeForm: `doing ${k}`, status: k <= i / 60 ? 'completed' : 'pending' })) } });
		}
		await hook(id, { hook_event_name: 'Stop', last_assistant_message: `Done with ${id.slice(-2)}.` });
	}));
	const took = Date.now() - t0;
	await sleep(500);
	clearInterval(lag);
	const events = SESSIONS * (STEPS * 2 + 6);
	console.log(`     ${events} hook events in ${took} ms (${Math.round(events / (took / 1000))}/s); talk box sent ${sends} updates; worst main-loop stall ${worst} ms`);
	const slimeLong = Math.round(await page('window.__long')), boxLong = Math.round(await box('window.__long'));
	check(slimeLong < 100 && boxLong < 100, `the slimes and the box never get stuck on one piece of work (longest ${slimeLong} ms and ${boxLong} ms)`);
	check(worst < 500, `the main loop never stalls for long (worst ${worst} ms)`);
	check(sends < events / 4, `the box isn’t sent every event (${sends} updates for ${events} events)`);
	const longest = Math.max(...ids.map((id) => inbox.log(id).length));
	check(longest <= 100, `each session keeps a bounded log (longest ${longest} entries)`);
	check(await box(`document.querySelectorAll('#overview .row:not(.past)').length`) >= SESSIONS, 'the overview lists every session');
	check(await until(async () => /Done with 00/.test(await box(`[...document.querySelectorAll('#inner .msg')].map((e) => e.textContent).join('|')`)) || await box(`document.body.classList.contains('overview')`)), 'the open box got its reply');

	// Every session ends; once they're forgotten, nothing is kept for them.
	for (const id of ids) await hook(id, { hook_event_name: 'SessionEnd' });
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	await until(() => !talk().isVisible());
	for (const id of ids) tracker.sessions.delete(id); // (as if forgotten after a while)
	tracker.emit('change');
	if (global.gc) global.gc();
	await sleep(300);
	const kept = (global.__blaubeSweep ? global.__blaubeSweep() : null);
	const left = ids.filter((id) => inbox.logs.has(id) || inbox.todos.has(id) || inbox.steerable.has(id) || inbox.typed.has(id));
	check(left.length === 0, `nothing is kept in the inbox for forgotten sessions (${left.length} left)`);
	if (kept) check(kept.length === 0, `nor anywhere else in the app (${kept.join(', ') || 'none'})`);
	const heapAfter = process.memoryUsage().heapUsed;
	console.log(`     main heap ${Math.round(heapBefore / 1e6)} MB before, ${Math.round(heapAfter / 1e6)} MB after`);

	agent.destroy();
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
