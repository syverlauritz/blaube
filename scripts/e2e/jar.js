// The snack jar (your usage limits as cookies), in the real app but
// invisible, with made-up usage:
//
//   BLAUBE_TEST=scripts/e2e/jar.js BLAUBE_PORT=47953 npx electron .
//
// It shows up on the floor; hovering it gives the usage in a status bubble
// (and "Couldn't check usage" before anything's known); dragged somewhere
// else it stays there, kept in prefs (and back there after a reload); a
// cookie flies from it into a slime's mouth, which chews; at 100% it's
// empty and throws nothing, and a reset fills it again. The Settings
// toggle hides it. Exits non-zero on a failure.
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function run({ app, win, tracker }) {
	let failed = 0; const errs = [];
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	win.webContents.on('console-message', (e) => { if (e.level === 'error') errs.push(e.message); });
	const js = (s) => win.webContents.executeJavaScript(s);
	const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false);
	await sleep(1000);
	const H = 3600e3;
	const usage = (five, week) => ({ status: five >= 1 ? 'rejected' : 'allowed', windows: [
		{ kind: 'five_hour', used: five, resetsAt: Date.now() + 2 * H, status: five >= 1 ? 'rejected' : 'allowed' },
		{ kind: 'seven_day', used: week, resetsAt: Date.now() + 90 * H, status: 'allowed' },
		{ kind: 'seven_day_opus', used: 0.12, resetsAt: Date.now() + 90 * H, status: 'allowed' },
	] });
	const jar = () => js(`(() => { const j = __blaube.jar(); return { x: j.x, y: j.y, placed: j.placed, level: j.level, shown: j.shown, held: !!j.held, hover: j.hoverSeen, balloon: !!j.body.balloon, tumbles: 0 }; })()`);

	// A session at work, for cookies to go to.
	const ev = (id, hook_event_name, extra = {}) => tracker.handle({ session_id: id, cwd: '/tmp/jar-' + id, hook_event_name, ...extra });
	ev('j1', 'SessionStart'); ev('j1', 'UserPromptSubmit', { prompt: 'go' });
	check(await until(() => js(`__blaube.buddies.has('j1')`), 5000), 'a slime appears');
	await sleep(2500);

	// It's there, on the floor.
	let j = await jar();
	const floor = await js(`innerHeight`);
	check(j.placed && Number.isFinite(j.x) && j.y > floor - 120, `the jar stands on the floor (${Math.round(j.x)}, ${Math.round(j.y)} of ${floor})`);

	// Nothing known yet: hovering says it couldn't check.
	const hover = async (x, y) => { await js(`(() => { __blaube.ownMouse = true; __blaube.input.move({ clientX: ${x}, clientY: ${y} }); })()`); await sleep(300); };
	await js(`(() => { const j = __blaube.jar(); j.body.balloon = null; })()`);
	await hover(j.x, j.y - 30);
	check((await jar()).balloon, 'hovering it shows a bubble');
	check((await js(`__blaube.jarLines().map((l) => l.text).join(' | ')`)).includes('Couldn’t check usage'), 'before any usage is known: "Couldn’t check usage"');
	await hover(5, 5);

	// Usage comes in: 62% of the 5-hour limit.
	global.__blaubeSetLimits(usage(0.62, 0.41));
	check(await until(async () => Math.abs(((await jar()).level ?? -1) - 0.38) < 0.01, 2000), 'the jar is 38% full at 62% used');
	check(await until(async () => Math.abs((await jar()).shown - 0.38) < 0.05, 6000), 'and eases there');
	await hover(j.x, j.y - 30);
	const lines = await js(`__blaube.jarLines().map((l) => l.text)`);
	check(lines[0] === 'Snack jar · 5-hour limit' && /^5 hours: 62% used · resets \S/.test(lines[1]) && /^Week: 41% used/.test(lines[2]) && /^Opus this week: 12%/.test(lines[3]), `hovering gives the details (${lines.join(' | ')})`);
	await hover(5, 5);

	// Dragged somewhere else and let go: it falls, lands, and stays.
	const to = { x: Math.round(j.x > 600 ? 300 : j.x + 300), y: Math.round(floor - 300) };
	await js(`(async () => {
		const B = __blaube, j = B.jar(), raf = () => new Promise((r) => requestAnimationFrame(r));
		B.ownMouse = true;
		const from = { x: j.x, y: j.y - 20 };
		B.input.down({ button: 0, clientX: from.x, clientY: from.y });
		for (let i = 1; i <= 30; i++) { B.input.move({ clientX: from.x + (${to.x} - from.x) * i / 30, clientY: from.y + (${to.y} - from.y) * i / 30 }); await raf(); }
		for (let i = 0; i < 240; i++) { B.input.move({ clientX: ${to.x}, clientY: ${to.y} }); await raf(); if (i > 10 && Math.hypot(j.x - ${to.x}, j.y - ${to.y} + 20) < 3) break; } // (held still till it's caught up: no throw)
	})()`);
	check((await jar()).held, 'it can be picked up');
	await js(`(() => { __blaube.input.up({ button: 0, clientX: ${to.x}, clientY: ${to.y} }); __blaube.ownMouse = false; })()`);
	check(await until(async () => { const k = await jar(); return !k.held && Math.abs(k.x - to.x) < 30 && k.y > floor - 120; }, 4000), 'let go, it drops to the floor where it was carried');
	await sleep(2500); // (settled, kept, saved)
	j = await jar();
	const prefsFile = path.join(app.getPath('userData'), 'prefs.json');
	const kept = (() => { try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')).jarSpots || {}; } catch { return {}; } })();
	const spot = Object.values(kept)[0];
	check(!!spot && Math.abs(spot.x - j.x) < 4 && Math.abs(spot.y - j.y) < 4, `its spot is kept in prefs, per screen (${JSON.stringify(kept)})`);
	// A restart of the stage: it's back where it was left.
	win.webContents.reload();
	await sleep(500);
	while (win.webContents.isLoading()) await sleep(100);
	await sleep(1500);
	const back = await jar();
	check(back.placed && Math.abs(back.x - j.x) < 4 && Math.abs(back.y - j.y) < 6, `after a reload it's where it was left (${Math.round(back.x)}, ${Math.round(back.y)})`);
	check(await until(async () => Math.abs(((await jar()).level ?? -1) - 0.38) < 0.01, 2000), 'and still knows the usage');

	// A cookie: out of the jar, into the slime's mouth, chewed.
	await until(() => js(`__blaube.buddies.get('j1').body.onFloor()`), 4000);
	const flight = await js(`(async () => {
		const B = __blaube, b = B.buddies.get('j1'), raf = () => new Promise((r) => requestAnimationFrame(r));
		if (!B.throwCookie('j1')) return { thrown: false };
		const k = B.cookies()[0], j = B.jar();
		let last = null, opened = false, high = Infinity;
		const start = { x: k.x, y: k.y };
		for (let i = 0; i < 400 && B.cookies().includes(k); i++) {
			const m = B.mouthAt(b);
			last = { d: Math.hypot(k.x - m.x, k.y - m.y), r: b.body.o.radius };
			high = Math.min(high, k.y);
			if (b.snack && b.snack.open) opened = true;
			await raf();
		}
		return { thrown: true, start, fromJar: Math.abs(start.x - j.x) < 20 && start.y < j.y, last, opened, arc: start.y - high, chew: !!(b.snack && b.snack.stage === 'chew') };
	})()`);
	check(flight.thrown && flight.fromJar, 'a cookie flies out of the jar');
	check(flight.arc > 40, `in an arc (${Math.round(flight.arc)} px up)`);
	check(flight.opened, 'its slime opens its mouth for it');
	check(flight.last && flight.last.d < flight.last.r * 0.25, `it lands in the mouth (${flight.last && flight.last.d.toFixed(1)} px off)`);
	check(flight.chew, 'and it chews');

	// 100% used: empty, crumbs, no cookies.
	global.__blaubeSetLimits(usage(1, 0.5));
	check(await until(async () => (await jar()).level === 0, 2000), 'at 100% the jar is empty');
	check(await until(async () => (await jar()).shown < 0.02, 6000), 'and shows empty');
	check(!(await js(`__blaube.throwCookie('j1')`)), 'an empty jar throws no cookies');
	check((await js(`__blaube.jarLines()[1].text`)).startsWith('5 hours: limit reached'), 'its bubble says the limit is reached');
	// The limit resets: it fills up again, cookies tumbling in.
	global.__blaubeSetLimits(usage(0, 0.1));
	check(await until(async () => Math.abs((await jar()).level - 0.9) < 0.01, 2000), 'reset: it fills up again (to the week’s 90% left)');
	check(await js(`__blaube.jar().refillUntil > __blaube.now()`), 'cookies tumble in');
	check(await js(`__blaube.buddies.get('j1').happyUntil > __blaube.now()`), 'and the slime perks up');

	// The Settings toggle hides it.
	ipcMain.emit('config-set', {}, { snackJar: 'Off' });
	check(await until(() => js(`!__blaube.jarOn()`), 2000), 'Settings can hide it');
	ipcMain.emit('config-set', {}, { snackJar: 'On' });
	check(await until(() => js(`__blaube.jarOn()`), 2000), 'and show it again');

	check(await js(`[...__blaube.buddies.values()].every((b) => [...b.body.px].every(Number.isFinite))`), 'bodies finite');
	check(errs.length === 0, `no errors (${errs.slice(0, 3).join(' | ')})`);
	return failed ? 1 : 0;
};
