// A helper that truly can't get to its mother gives up for a while (she's
// up on a window or a talk box too high to jump to, a wall's in the way,
// she's held up out of its reach), rests without trying, and goes to her
// happily once she comes to it; one that can get to her, however long it
// takes, never gives up:
//
//   BLAUBE_TEST=scripts/e2e/giveup.js BLAUBE_PORT=47950 npx electron .
//
// Exits non-zero on a failure.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function run({ win, tracker }) {
	let failed = 0; const errs = [];
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	win.webContents.on('console-message', (e) => { if (e.level === 'error') errs.push(e.message); });
	const js = (s) => win.webContents.executeJavaScript(s);
	const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false);
	await sleep(1000);
	const ev = (id, hook_event_name, extra = {}) => tracker.handle({ session_id: id, cwd: '/tmp/p-' + id, hook_event_name, ...extra });
	ev('g1', 'SessionStart');
	ev('g1', 'UserPromptSubmit');
	ev('g1', 'SubagentStart', { agent_id: 'gh1', agent_type: 'Explore' });
	const kid = `[...__blaube.buddies.values()].find((b) => b.kind === 'child')`, mom = `__blaube.buddies.get('g1')`;
	check(await until(() => js(`!!${kid} && !${kid}.splitting`), 6000), 'a helper splits off');
	await sleep(1500);
	const size = await js(`({ w: innerWidth, h: innerHeight })`);
	// Counts the helper's hops toward her (each one goes through hopToMum,
	// which marks it as heading for her).
	await js(`(() => { const k = ${kid}; window.__toMum = 0; const hop = k.hop.bind(k); k.hop = (vx, vy) => { if (k.toMum) __toMum++; hop(vx, vy); }; })()`);
	// Where the floor is (a helper's bottom, standing on it).
	await js(`${kid}.body.teleport(300, ${size.h - 150})`);
	await until(() => js(`${kid}.body.onFloor()`), 3000);
	await sleep(500);
	const floor = Math.round(await js(`${kid}.body.bbox().maxY`));
	// Mum set down on a ledge this far above the floor, her helper below.
	const ledgeAt = (rise, extra = {}) => Object.assign({ id: 8, x0: 500, x1: 900, y: floor - rise, wx: 500, at: Date.now() }, extra);
	const put = async (l, kx = 300) => {
		win.webContents.send('ledges', l ? [l] : []);
		await sleep(100);
		await js(`(() => { ${l ? `${mom}.body.teleport(${(l.x0 + l.x1) / 2}, ${l.y - 200});` : ''} ${kid}.body.teleport(${kx}, ${size.h - 150}); })()`);
		return until(() => js(`${l ? `!!${mom}.body.onLedge && ` : ''}${kid}.body.onFloor()`), 4000);
	};
	const fresh = () => js(`(() => { const k = ${kid}; delete k.gaveUp; k.gaveUp = null; k.gaveUps = 0; k.tries = k.trying = null; k.heldOut = 0; })()`);
	// Watches for it giving up: when, after how many hops toward her, and
	// whether it was standing still on something at that moment.
	const watch = () => js(`(() => {
		const k = ${kid}, m = ${mom}, t0 = __blaube.now();
		window.__air = Infinity; window.__ground = Infinity; window.__gave = null; __toMum = 0;
		clearInterval(window.__watch);
		window.__watch = setInterval(() => { const c = k.body.centroid(), mc = m.body.centroid(), d = Math.hypot(mc.x - c.x, mc.y - c.y) / m.body.o.radius; if (k.body.onFloor()) __ground = Math.min(__ground, d); else __air = Math.min(__air, d); }, 5);
		let g = null;
		Object.defineProperty(k, 'gaveUp', { configurable: true, get: () => g, set: (v) => { if (v && !g && !__gave) __gave = { grounded: k.body.onFloor(), vy: k.body.velocity(1 / 120).y, after: __blaube.now() - t0, tries: __toMum }; g = v; } });
	})()`);
	// It must give up, standing still, and then rest for minutes.
	const givesUp = async (what, ms = 45000) => {
		const gave = await until(() => js(`!!window.__gave`), ms);
		const info = await js(`({ gave: __gave, rest: ${kid}.gaveUp ? ${kid}.gaveUp.until - __blaube.now() : 0 })`);
		check(gave, `${what}: it gives up (${gave ? `after ${info.gave.after.toFixed(1)} s, ${info.gave.tries} hops toward her` : 'never'})`);
		check(gave && info.gave.grounded && Math.abs(info.gave.vy) < 60, `  only once it has landed and stands still (${gave ? Math.round(info.gave.vy) : '-'} px/s)`);
		check(gave && info.rest > 200 && info.rest < 8 * 60 + 1, `  then rests for minutes (${Math.round(info.rest)} s)`);
		await js(`clearInterval(__watch)`);
		return gave;
	};

	// Mum up on a window just too high to jump to: the helper jumps, gets
	// close to her in the air and falls back. Those near misses mustn't
	// count as getting closer.
	check(await put(ledgeAt(760)), 'mum is up on a window just out of reach, her helper below');
	await watch();
	await givesUp('too high');
	const air = await js(`({ air: __air, ground: __ground })`);
	check(air.air < air.ground * 0.8, `in the air it got closer to her than ever on the ground (${air.air.toFixed(2)} against ${air.ground.toFixed(2)} of her radii)`);
	check(await js(`__blaube.hearts().some((h) => h.broken)`), 'a breaking heart above it');
	check(await until(() => js(`__blaube.hearts().some((h) => h.puff)`), 2000), 'a sigh: a little puff of breath out');
	check(await js(`!${kid}.bubble`), 'and no words');
	// Resting while she stays up there (hopping about on her window now and
	// then): not one hop toward her.
	await js(`__toMum = 0`);
	for (let i = 0; i < 5; i++) { await sleep(5000); win.webContents.send('command', 'hop'); }
	check(await js(`__toMum === 0 && !!${kid}.gaveUp`), `it rests: no hop toward her in 25 s (${await js('__toMum')})`);
	// She comes down to it: it's glad.
	win.webContents.send('ledges', []);
	await js(`${mom}.body.teleport(${await js(`${kid}.body.centroid().x`)} + 260, ${size.h - 250})`);
	check(await until(() => js(`!${kid}.gaveUp`), 6000), 'mum comes to it: it stops sulking');
	check(await js(`${kid}.happyUntil > __blaube.now()`), 'and is happy to see her');
	await fresh();
	await sleep(1500);

	// Mum on top of a talk box it can't reach.
	check(await put(ledgeAt(820, { id: 'talk:g1', talk: 'g1', x0: 700, x1: 1200, wx: 0 }), 200), 'mum is up on a talk box, out of reach');
	await watch();
	await givesUp('talk box');
	win.webContents.send('ledges', []);
	await fresh();
	await sleep(1500);

	// Something in the way: a wall it can't get over between them.
	win.webContents.send('world', { obstacles: [{ x: 900, y: floor - 900, width: 80, height: 900 }] });
	await put(null, 400);
	await js(`${mom}.body.teleport(1700, ${size.h - 200})`);
	await watch();
	await givesUp('a wall in the way');
	win.webContents.send('world', { obstacles: [] });
	await fresh();
	await sleep(1500);

	// Held up out of its reach, over its head, for a good while.
	await put(null, 600);
	await js(`(() => { const b = ${mom}.body; b.teleport(640, ${size.h - 300}); const c = b.centroid(); b.startGrab(c.x, c.y); b.moveGrab(640, ${floor - 900}); })()`);
	await watch();
	await givesUp('held up out of reach', 25000);
	await js(`${mom}.body.endGrab()`);
	await fresh();
	await sleep(2000);

	// Reachable: never gives up. A window it can jump to:
	check(await put(ledgeAt(380)), 'mum up on a window it can reach');
	check(await until(() => js(`${kid}.body.onLedge && ${mom}.body.onLedge && ${kid}.body.onLedge.id === ${mom}.body.onLedge.id && ${kid}.body.onFloor()`), 15000), '  it jumps up onto it, to her');
	check(await js(`!${kid}.gaveUp`), '  without giving up');
	win.webContents.send('ledges', []);
	await sleep(1500);

	// A chase that's just taking a while (mum keeps moving off along the
	// floor):
	await js(`(() => { ${kid}.body.teleport(300, ${size.h - 150}); ${mom}.body.teleport(1200, ${size.h - 200}); })()`);
	let x = 1200;
	for (let i = 0; i < 10; i++) { await sleep(2000); x = x > size.w - 600 ? 900 : x + 350; await js(`${mom}.body.teleport(${x}, ${size.h - 200})`); }
	check(await js(`!${kid}.gaveUp`), 'chasing mum along the floor for 20 s, it never gives up');

	// Up on a window with mum on the floor far off: it hops down after her.
	const ledge = { id: 9, x0: 80, x1: 440, y: Math.round(size.h * 0.45), wx: 80, at: Date.now() };
	win.webContents.send('ledges', [ledge]);
	await sleep(100);
	await js(`(() => { ${kid}.body.teleport(260, ${ledge.y - 120}); ${kid}.nextHop = __blaube.now() + 2.5; ${mom}.body.teleport(${size.w - 500}, ${size.h - 200}); })()`);
	check(await until(() => js(`${kid}.body.onLedge && ${kid}.body.onFloor()`), 3000), 'the helper is up on a window, mum on the floor far off');
	check(await until(() => js(`${kid}.body.onFloor() && !${kid}.body.onLedge && ${kid}.body.centroid().x > ${ledge.x1}`), 10000), '  it hops down off the window after her');
	check(await js(`!${kid}.gaveUp`), '  without giving up');
	win.webContents.send('ledges', []);
	await sleep(1000);

	// Done, but mum's up out of reach: it heads home, gives up, and after
	// its sad moment fades back into her from where it is.
	await put(ledgeAt(760));
	ev('g1', 'SubagentStop', { agent_id: 'gh1' });
	check(await until(() => js(`!!(${kid} && ${kid}.merging)`), 3000), 'the helper finishes and heads home');
	check(await until(() => js(`!!(${kid} && ${kid}.gaveUp)`), 30000), 'it can\'t get to her, and gives up');
	check(await until(() => js(`!${kid}`), 6000), 'then it fades back into her');
	check(await js(`__blaube.now() - (${mom}.gulpAt || -99) < 3`), 'and she gulps it in');
	check(errs.length === 0, `no errors (${errs.slice(0, 3).join(' | ')})`);
	return failed ? 1 : 0;
};
