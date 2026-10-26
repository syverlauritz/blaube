// A helper that can't get to its mother gives up for a while, and goes to
// her happily once she comes near again:
//
//   BLAUBE_TEST=scripts/e2e/giveup.js BLAUBE_PORT=47950 npx electron .
//
// Puts the helper up on a window, its mother on the floor far off (it
// never jumps off a window after her), and counts its hops. Exits non-zero
// on a failure.
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
	// A window on the left, the helper on it; mum on the floor far right.
	const size = await js(`({ w: innerWidth, h: innerHeight })`);
	// Mum up on a window too high to jump to: the helper jumps, gets close
	// to her in the air and falls back. Those near misses mustn't count as
	// getting closer, and it gives up only once it's back on the ground.
	{
		const high = { id: 8, x0: 300, x1: 700, y: 80, wx: 300, at: Date.now() };
		win.webContents.send('ledges', [high]);
		await sleep(100);
		await js(`(() => { ${mom}.body.teleport(560, 0); ${kid}.body.teleport(380, ${size.h - 150}); })()`);
		check(await until(() => js(`!!${mom}.body.onLedge && ${kid}.body.onFloor()`), 3000), 'mum is up on a high window, her helper below');
		// Watch: how close it gets in the air, and where it is the moment it gives up.
		await js(`(() => {
			const k = ${kid}, m = ${mom}, t0 = __blaube.now();
			window.__air = Infinity; window.__ground = Infinity; window.__gave = null;
			window.__watch = setInterval(() => { const c = k.body.centroid(), mc = m.body.centroid(), d = Math.hypot(mc.x - c.x, mc.y - c.y) / m.body.o.radius; if (k.body.onFloor()) __ground = Math.min(__ground, d); else __air = Math.min(__air, d); }, 5);
			let g = null;
			Object.defineProperty(k, 'gaveUp', { configurable: true, get: () => g, set: (v) => { if (v && !g && !__gave) __gave = { grounded: k.body.onFloor(), after: __blaube.now() - t0 }; g = v; } });
		})()`);
		const gave = await until(() => js(`!!window.__gave`), 20000);
		const info = await js(`({ air: __air, ground: __ground, gave: __gave, onLedge: !!${kid}.body.onLedge })`);
		check(info.air < info.ground * 0.7, `in the air it gets much closer to her than it ever is on the ground (${info.air.toFixed(2)} against ${info.ground.toFixed(2)} of her radii)`);
		check(gave && info.gave.after < 16, `it still gives up in time (after ${gave ? info.gave.after.toFixed(1) : '-'} s)`);
		check(gave && info.gave.grounded && !info.onLedge, 'only once it has landed, below her');
		await js(`(() => { clearInterval(__watch); const k = ${kid}; delete k.gaveUp; k.gaveUp = null; k.gaveUps = 0; k.reach = null; })()`);
		win.webContents.send('ledges', []);
		await sleep(1500);
	}
	const ledge = { id: 9, x0: 80, x1: 440, y: Math.round(size.h * 0.45), wx: 80, at: Date.now() };
	win.webContents.send('ledges', [ledge]);
	await sleep(100);
	await js(`(() => { ${kid}.body.teleport(260, ${ledge.y - 120}); ${mom}.body.teleport(${size.w - 200}, ${size.h - 200}); })()`);
	check(await until(() => js(`${kid}.body.onLedge && ${kid}.body.onFloor() && ${mom}.body.onFloor() && ${mom}.body.centroid().x > ${size.w - 400}`), 3000), 'the helper is up on the window, mum on the floor far off');
	// Watch it try: it hops, and never gets any closer.
	await js(`(() => { const k = ${kid}; window.__hops = 0; const hop = k.hop.bind(k); k.hop = (vx, vy) => { window.__hops++; hop(vx, vy); }; })()`);
	const gave = await until(() => js(`!!${kid}.gaveUp`), 14000);
	const hops = await js(`window.__hops`);
	check(gave, `it gives up (after ${hops} hops)`);
	if (!gave) console.log(await js(`JSON.stringify({ reach: ${kid}.reach, now: __blaube.now(), r: ${kid}.body.o.radius, mx: ${mom}.body.centroid().x, kx: ${kid}.body.centroid().x, ledge: !!${kid}.body.onLedge })`));
	check(hops >= 3 && hops <= 9, `a few tries first, not endless (${hops})`);
	check(await js(`${kid}.body.onLedge != null`), 'still up on the window');
	check(await js(`__blaube.hearts().some((h) => h.broken)`), 'a breaking heart above it');
	check(await until(() => js(`!!(${kid}.bubble && /haah/.test(${kid}.bubble.lines[0].text))`), 2500), 'and a sigh');
	const rest = await js(`${kid}.gaveUp.until - __blaube.now()`);
	check(rest > 200 && rest < 8 * 60 + 1, `it won't try again for minutes (${Math.round(rest)} s)`);
	// Resting: no more hops for a good while.
	await js(`window.__hops = 0`);
	await sleep(6000);
	check(await js(`window.__hops === 0 && !!${kid}.gaveUp`), `it rests (${await js('window.__hops')} hops in 6 s)`);
	// Mum comes over to the window: it goes to her, happy.
	await js(`${mom}.body.teleport(${ledge.x0 + 300}, ${ledge.y - 200})`);
	check(await until(() => js(`!${kid}.gaveUp`), 4000), 'mum comes near: it stops sulking');
	check(await js(`${kid}.happyUntil > __blaube.now()`), 'and is happy to see her');
	// Done, but mum's out of reach again: it heads home, gives up, and after
	// its sad moment fades back into her from where it is.
	await sleep(2000);
	await js(`(() => { ${mom}.body.teleport(${size.w - 200}, ${size.h - 200}); ${kid}.body.teleport(260, ${ledge.y - 120}); })()`);
	await until(() => js(`${kid}.body.onLedge && ${kid}.body.onFloor()`), 3000);
	ev('g1', 'SubagentStop', { agent_id: 'gh1' });
	check(await until(() => js(`!!(${kid} && ${kid}.merging)`), 3000), 'the helper finishes and heads home');
	check(await until(() => js(`!!(${kid} && ${kid}.gaveUp)`), 9000), 'it can\'t get to her, and gives up');
	check(await until(() => js(`!${kid}`), 6000), 'then it fades back into her');
	check(await js(`__blaube.now() - (${mom}.gulpAt || -99) < 3`), 'and she gulps it in');
	check(errs.length === 0, `no errors (${errs.slice(0, 3).join(' | ')})`);
	return failed ? 1 : 0;
};
