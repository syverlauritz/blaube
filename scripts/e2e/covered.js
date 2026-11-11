// The talk box keeps drawing when a window of ours goes in front of it, in
// the real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/covered.js BLAUBE_PORT=47879 npx electron .
//
// On Windows Chromium stops drawing a window it thinks other windows cover.
// The slimes' layer is full-screen and see-through, but while it catches
// the mouse (over a slime, as you click one) it counts as covering, and it
// goes in front of the talk box as the box opens: the box froze on its
// first frames, half faded in. Here a see-through window that catches the
// mouse goes in front of the open box, as the slimes' layer does (the test
// one never catches the mouse), and the box must still draw. Exits non-zero
// on a failure.
const http = require('node:http');
const { BrowserWindow } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMES = 4;

module.exports = async function run({ win, PORT, talk, talkId }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(20); } return false; };
	const page = (js) => win.webContents.executeJavaScript(js);
	const hook = (id, payload) => new Promise((done) => {
		const req = http.request({ host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli' } }, (res) => { res.resume(); res.on('end', done); });
		req.on('error', done);
		req.end(JSON.stringify(Object.assign({ session_id: id, cwd: '/tmp/covered' }, payload)));
	});
	const A = `covered-${Date.now()}`;
	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);
	await hook(A, { hook_event_name: 'SessionStart' });
	await hook(A, { hook_event_name: 'UserPromptSubmit', prompt: 'a task' });
	await hook(A, { hook_event_name: 'Stop', last_assistant_message: 'Done.' });
	check(await until(async () => (await page(`__blaube.buddies.size`)) >= 1, 8000), 'a slime appears');
	const ob = win.getBounds();
	const open = () => page(`window.blaube.talk(${JSON.stringify(A)}, { x: ${Math.round(ob.width / 2)}, y: ${Math.round(ob.height - 330)}, r: 60 })`);
	// Whether the box is drawing: seen as visible, and its frames coming.
	const drawing = () => talk().webContents.executeJavaScript(`new Promise((done) => {
		let n = 0;
		const t0 = performance.now();
		const f = () => { n++; if (performance.now() - t0 < 300) requestAnimationFrame(f); };
		requestAnimationFrame(f);
		setTimeout(() => done({ state: document.visibilityState, frames: n }), 400);
	})`);

	// Where the box opens (it opens there each time).
	await open();
	await until(() => talk().isVisible() && talkId() === A);
	const b = talk().getBounds();
	await open(); // (its slime again: closes it)
	await until(() => !talk().isVisible(), 1500);
	await sleep(400);
	// See-through, catching the mouse (so not "layered"), over where the box
	// opens: the slimes' layer, as you click a slime.
	const cover = new BrowserWindow({ x: b.x - 20, y: b.y - 20, width: b.width + 40, height: b.height + 40, show: false, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, hasShadow: false });
	await cover.loadURL('data:text/html,<body style="background:transparent"></body>');
	cover.showInactive();

	let kept = 0;
	for (let i = 0; i < TIMES; i++) {
		talk().once('show', () => cover.moveTop()); // (as raiseStage does)
		await open();
		const shown = await until(() => talk().isVisible() && talkId() === A);
		await sleep(600); // (Chromium works out what's covered a moment later)
		const d = await drawing();
		const ok = shown && d.state === 'visible' && d.frames > 3;
		if (ok) kept++;
		else console.log(`     open #${i + 1}: ${JSON.stringify(Object.assign({ shown }, d))}`);
		await open(); // (its slime again: closes it)
		await until(() => !talk().isVisible(), 1500);
		await sleep(400);
	}
	cover.destroy();
	check(kept === TIMES, `with a window in front, the box kept drawing (${kept} of ${TIMES})`);
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
