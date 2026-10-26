// End-to-end check that slimes never nag, in the real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/quiet.js BLAUBE_PORT=47874 electron .
//   (QUIET_SECONDS=180 for a longer watch; 30 by default)
//
// A session that needs you says so once for that wait, however often
// Claude Code repeats it, with your cursor near it and away; and a session
// fed the same prompt in a loop (or a hook's <tagged> one) gets no "okay!"
// and no cheer for those.
const http = require('node:http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run({ win, PORT }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	const page = (js) => win.webContents.executeJavaScript(js);
	const hook = (id, payload) => new Promise((done) => {
		const req = http.request({ host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli' } }, (res) => { res.resume(); res.on('end', done); });
		req.end(JSON.stringify(Object.assign({ session_id: id, cwd: '/tmp/quiet' }, payload)));
	});
	// Every line a slime says out loud, counted from inside the page.
	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);
	await page(`(() => { window.__lines = []; let was = null; setInterval(() => { for (const b of __blaube.buddies.values()) { if (b.speech && b.speech !== b.__counted) { b.__counted = b.speech; const e = { id: b.key, at: performance.now(), text: '' }; window.__lines.push(e); setTimeout(() => { e.text = b.bubble ? b.bubble.lines.map((l) => l.text).join(' ') : '(no bubble)'; }, 400); } } }, 20); })()`);
	const lines = (id) => page(`window.__lines.filter((l) => l.id === ${JSON.stringify(id)})`);

	// Needs you, over and over.
	const A = 'quiet-wait-' + Date.now();
	await hook(A, { hook_event_name: 'SessionStart' });
	check(await until(() => page(`!!__blaube.buddies.get(${JSON.stringify(A)})`), 6000), 'a session has a slime');
	await sleep(1500);
	await hook(A, { hook_event_name: 'UserPromptSubmit', prompt: 'run the migration' });
	await sleep(2500);
	const before = (await lines(A)).length;
	await hook(A, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
	check(await until(() => page(`__blaube.buddies.get(${JSON.stringify(A)}).state === 'waiting'`), 3000), 'it needs you');
	const seconds = Number(process.env.QUIET_SECONDS) || 30;
	const end = Date.now() + seconds * 1000;
	let n = 0;
	while (Date.now() < end) {
		await sleep(5000);
		n++;
		await hook(A, n % 3 ? { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' } : { hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
		// Your cursor comes close, then goes away again.
		const c = await page(`(() => { const c = __blaube.buddies.get(${JSON.stringify(A)}).body.centroid(); return { x: Math.round(c.x), y: Math.round(c.y) }; })()`);
		win.webContents.sendInputEvent({ type: 'mouseMove', x: n % 2 ? c.x + 60 : 20, y: n % 2 ? c.y - 80 : 20 });
		// A long wait: the nudge, and the rain cloud.
		if (n === 2) await page(`(() => { const b = __blaube.buddies.get(${JSON.stringify(A)}); b.stateSince -= 900; })()`);
	}
	const waited = (await lines(A)).slice(before);
	console.log(`     waiting ${seconds}s, said: ${JSON.stringify(waited.map((l) => l.text))}`);
	check(waited.length <= 1, `a slime that needs you says so at most once in ${seconds}s (${waited.length})`);
	check(await page(`__blaube.buddies.get(${JSON.stringify(A)}).state === 'waiting'`), 'and is still waiting');

	// Fed the same prompt in a loop, and a hook's tagged one.
	const B = 'quiet-loop-' + Date.now();
	await hook(B, { hook_event_name: 'SessionStart' });
	await until(() => page(`!!__blaube.buddies.get(${JSON.stringify(B)})`), 6000);
	await sleep(1500);
	for (let i = 0; i < 6; i++) {
		await hook(B, { hook_event_name: 'UserPromptSubmit', prompt: i === 3 ? '<task-notification>done</task-notification>' : 'check the build again' });
		await sleep(1200);
		await hook(B, { hook_event_name: 'Stop', last_assistant_message: 'Still green.' });
		await sleep(1800);
	}
	const looped = await lines(B);
	console.log(`     looped, said: ${JSON.stringify(looped.map((l) => l.text))}`);
	check(looped.length <= 2, `a looped session: its first "okay!" and cheer at most, not one each time (${looped.length})`);
	console.log(failed ? `${failed} FAILED` : 'all ok');
	return failed ? 1 : 0;
};
