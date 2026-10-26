// Crowding, in the real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/crowd.js BLAUBE_PORT=47960 npx electron .
//
// Ten slimes packed together on the floor, two window tops above them. Over
// a couple of minutes they grumble a little and spread out, one at a time:
// crowding drops, some end up on the window tops, nobody keeps on moving,
// and they don't talk the whole time. Then a window top too crowded with
// slimes empties down to a few, and a slime that needs you hops down off a
// window top after your cursor (and up onto one). Prints the numbers.
// Exits non-zero on a failure.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function run({ win, tracker }) {
	let failed = 0; const errs = [];
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	win.webContents.on('console-message', (e) => { if (e.level === 'error') errs.push(e.message); });
	const js = (s) => win.webContents.executeJavaScript(s);
	const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false);
	// A narrow stage, like a portrait screen: not room on the floor for all.
	const full = win.getBounds();
	win.setBounds({ x: full.x, y: full.y, width: 1000, height: full.height });
	await sleep(1000);
	const ev = (id, hook_event_name, extra = {}) => tracker.handle({ session_id: id, cwd: '/tmp/c-' + id, hook_event_name, ...extra });
	const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
	for (const [i, id] of ids.entries()) {
		ev(id, 'SessionStart');
		if (i < 7) ev(id, 'UserPromptSubmit'); // (seven at work, three idle)
	}
	check(await until(() => js(`__blaube.buddies.size >= 10`), 8000), 'ten slimes appear');
	await sleep(3000);
	const size = await js(`({ w: innerWidth, h: innerHeight, r: __blaube.buddies.get('c0').body.o.radius })`);
	const { w: W, h: H, r } = size;
	console.log(`     stage ${W}x${H}, radius ${r.toFixed(0)}`);
	// Two window tops, a hop up off the floor.
	const tops = [
		{ id: 9001, x0: 20, x1: Math.round(W * 0.49), y: Math.round(H - r * 4.2), wx: 20, at: Date.now() },
		{ id: 9002, x0: Math.round(W * 0.51), x1: W - 20, y: Math.round(H - r * 5.6), wx: Math.round(W * 0.51), at: Date.now() },
	];
	// (Sent again every second: the real windows on this screen are watched
	// too, and a change in them would replace these.)
	let shown = [];
	const show = (list) => { shown = list; win.webContents.send('ledges', list); };
	const keep = setInterval(() => win.webContents.send('ledges', shown.map((l) => Object.assign({}, l, { at: Date.now() }))), 1000);
	show(tops);
	await sleep(200);
	// Packed in, in two rows, in the middle of the floor.
	await js(`(() => {
		const ids = ${JSON.stringify(ids)}, r = ${r}, W = ${W}, H = ${H}, gap = r * 1.6;
		ids.forEach((id, i) => { const b = __blaube.buddies.get(id), row = i % 2, k = Math.floor(i / 2); b.body.teleport(W / 2 + (k - 2) * gap + row * gap * 0.5, H - r * (row ? 3.2 : 1.1)); b.crowd = 0; b.crowdedFor = 0; });
	})()`);
	await sleep(6000);
	const stats = () => js(`(() => {
		const all = [...__blaube.buddies.values()].filter((b) => !b.dying);
		const cr = all.map((b) => b.crowd || 0);
		const on = {}; for (const b of all) { const l = b.body.onLedge; if (l) on[l.id] = (on[l.id] || 0) + 1; }
		return { mean: cr.reduce((a, v) => a + v, 0) / cr.length, max: Math.max(...cr), crowded: cr.filter((v) => v > 1.6).length, on };
	})()`);
	const before = await stats();
	console.log(`     before: mean crowding ${before.mean.toFixed(2)}, max ${before.max.toFixed(2)}, ${before.crowded} crowded, on tops ${JSON.stringify(before.on)}`);
	check(before.crowded >= 4, `packed in, several are crowded (${before.crowded})`);
	// Watch them for a couple of minutes: who moves, how many at once, how
	// often, grumbles and what's said.
	await js(`(() => {
		const B = __blaube; window.__w = { moves: {}, most: 0, grumbles: 0, saidAt: B.spoken.said, voicedAt: B.spoken.voiced, words: [] };
		const seen = new Map();
		window.__watch = setInterval(() => {
			let now = 0;
			for (const b of B.buddies.values()) {
				if (b.move) now++;
				if (b.move && seen.get(b) !== b.move) { seen.set(b, b.move); __w.moves[b.key] = (__w.moves[b.key] || 0) + 1; }
				if (b.grumble && b.grumble !== b.__g) { b.__g = b.grumble; __w.grumbles++; }
				if (b.bubble && b.bubble !== b.__bub) { b.__bub = b.bubble; __w.words.push(b.bubble.lines[0].text); }
			}
			__w.most = Math.max(__w.most, now);
		}, 50);
	})()`);
	await sleep(+(process.env.CROWD_WATCH || 150000)); // (CROWD_WATCH=ms: shorter, for a quick look)
	const w = await js(`(() => { clearInterval(__watch); return Object.assign({}, __w, { said: __blaube.spoken.said - __w.saidAt, voiced: __blaube.spoken.voiced - __w.voicedAt }); })()`);
	const after = await stats();
	const moved = Object.values(w.moves), onTops = Object.values(after.on).reduce((a, v) => a + v, 0);
	console.log(`     after:  mean crowding ${after.mean.toFixed(2)}, max ${after.max.toFixed(2)}, ${after.crowded} crowded, on tops ${JSON.stringify(after.on)}`);
	console.log(`     moves ${JSON.stringify(w.moves)}, ${w.grumbles} grumbles, words ${JSON.stringify(w.words)} (${w.voiced} said aloud)`);
	check(after.mean < before.mean * 0.8, `crowding drops (mean ${before.mean.toFixed(2)} -> ${after.mean.toFixed(2)})`);
	check(onTops >= 2, `some end up on the window tops (${onTops})`);
	check(w.most <= 1, `one moves at a time (at most ${w.most} at once)`);
	check(moved.length >= 3 && Math.max(...moved) <= 3, `several move, none over and over (${moved.length} moved, most ${Math.max(0, ...moved)} times)`);
	check(w.voiced <= 2 && w.words.length <= 4, `no chatter (${w.words.length} bubbles, ${w.voiced} aloud)`);
	check(w.grumbles >= 1 && w.grumbles <= 25, `a grumble now and then (${w.grumbles})`);

	// Back to the whole width (room on the floor again). A window top with
	// too many on it: it empties down to a few.
	win.setBounds(full);
	await sleep(1000);
	const W2 = await js('innerWidth');
	const small = { id: 9003, x0: Math.round(W2 * 0.3), x1: Math.round(W2 * 0.3 + r * 5.2), y: Math.round(H - r * 3.6), wx: Math.round(W2 * 0.3), at: Date.now() };
	show([small]);
	await sleep(2500); // (everyone back down on the floor)
	const three = ids.slice(0, 3);
	const onSmall = () => js(`[...__blaube.buddies.values()].filter((b) => b.body.onLedge && b.body.onLedge.id === 9003).length`);
	let up = 0;
	for (let k = 0; k < 3 && up < 3; k++) {
		// Set down on it one by one, side by side (any that slipped off, again).
		for (const [i, id] of three.entries()) {
			await js(`(() => { const b = __blaube.buddies.get('${id}'); b.stayUntil = 0; b.moves = 0; if ((b.body.onLedge || {}).id !== 9003) b.body.teleport(${small.x0 + r * (1 + i * 1.6)}, ${small.y - r * 1.1}); })()`);
			await sleep(400);
		}
		await sleep(3000);
		up = await onSmall();
	}
	console.log(`     ${up} on the small window top`);
	check(up >= 3, `a small window top crowded with slimes (${up}, one too many for it)`);
	await js(`(() => { window.__left = 0; const seen = new Map(); window.__watch = setInterval(() => { for (const b of __blaube.buddies.values()) if (b.move && seen.get(b) !== b.move && b.body.onLedge && b.body.onLedge.id === 9003) { seen.set(b, b.move); __left++; } }, 50); })()`);
	check(await until(() => js(`[...__blaube.buddies.values()].filter((b) => b.body.onLedge && b.body.onLedge.id === 9003).length <= 2 && ![...__blaube.buddies.values()].some((b) => b.body.onLedge && b.body.onLedge.id === 9003 && b.crowd > 1.6)`), 90000), 'it empties down till those left on it have room');
	const down = await js(`(() => { clearInterval(__watch); return __left; })()`);
	console.log(`     ${down} hopped down off it to get away from the crowd (the others slipped off)`);
	check(await js(`![...__blaube.buddies.values()].some((b) => __blaube.now() < (b.dizzyUntil || 0))`), 'nobody lands dizzy');

	// Needing you up on a window top, your cursor down on the floor off to
	// the side: it hops down and comes over. Then your cursor just over
	// another window top: up it goes.
	const left = { id: 9004, x0: W2 - 1500, x1: Math.round(W2 - 1500 + r * 5), y: Math.round(H - r * 4), wx: W2 - 1500, at: Date.now() };
	const right = { id: 9005, x0: W2 - 560, x1: Math.round(W2 - 560 + r * 5), y: Math.round(H - r * 4.5), wx: W2 - 560, at: Date.now() };
	show([left, right]);
	ev('c9', 'UserPromptSubmit'); ev('c9', 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
	check(await until(() => js(`__blaube.buddies.get('c9').state === 'waiting'`), 3000), 'one needs you');
	let perched = false;
	for (let i = 0; i < 3 && !perched; i++) {
		await js(`(() => { const b = __blaube.buddies.get('c9'); b.stateSince = __blaube.now() - 60; b.body.teleport(${(left.x0 + left.x1) / 2}, ${left.y} - ${r} * 1.5); })()`);
		perched = await until(() => js(`(__blaube.buddies.get('c9').body.onLedge || {}).id === 9004`), 3000);
	}
	check(perched, 'up on a window top');
	// (The cursor is held where the test puts it: your own mouse passing over
	// this invisible window would move it too.)
	let cursor = null;
	const pin = setInterval(() => { if (cursor) js(`__blaube.input.move({ clientX: ${cursor[0]}, clientY: ${cursor[1]} })`); }, 100);
	cursor = [Math.round(left.x1 + r * 3), H - 40];
	await js(`__blaube.ownMouse = true`);
	check(await until(() => js(`(() => { const b = __blaube.buddies.get('c9'); return !b.body.onLedge && b.body.onFloor() && Math.abs(b.body.centroid().x - ${left.x1 + r * 3}) < b.body.o.radius * 3; })()`), 25000), 'it hops down off the window top and comes over to your cursor');
	check(await js(`__blaube.now() > (__blaube.buddies.get('c9').dizzyUntil || 0)`), 'landing softly');
	cursor = [Math.round((right.x0 + right.x1) / 2), right.y - 30];
	check(await until(() => js(`(__blaube.buddies.get('c9').body.onLedge || {}).id === 9005`), 30000), 'your cursor just over another window top: it jumps up there');
	clearInterval(pin);
	await js(`__blaube.ownMouse = false`);
	clearInterval(keep);
	check(errs.length === 0, `no errors (${errs.slice(0, 3).join(' | ')})`);
	return failed ? 1 : 0;
};
