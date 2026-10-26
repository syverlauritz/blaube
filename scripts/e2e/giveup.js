// A helper that truly can't get to its mother (she's up on a window too
// high to jump to) gives up for a while, rests without trying, and goes to
// her happily once she comes to it; one that's merely far off, or up on a
// window she isn't on, never gives up:
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
	const high = { id: 8, x0: 300, x1: 700, y: 80, wx: 300, at: Date.now() };
	// Counts the helper's hops toward her (each one goes through hopToMum,
	// which marks it as heading for her).
	await js(`(() => { const k = ${kid}; window.__toMum = 0; const hop = k.hop.bind(k); k.hop = (vx, vy) => { if (k.toMum) __toMum++; hop(vx, vy); }; })()`);

	// Mum up on a window too high to jump to (the battery's nearly flat, so
	// it's tired and hops low): the helper jumps, gets close to her in the
	// air and falls back. Those near misses mustn't count as getting closer,
	// and it gives up only once it's back on the ground and standing still.
	const tired = async (yes) => {
		await js(`__blaube.sys.battery = ${yes ? '{ level: 0.05, charging: false }' : '{ level: 1, charging: true }'}`);
		return until(() => js(yes ? '__blaube.sys.low > 0.75' : '__blaube.sys.low < 0.02'), 15000);
	};
	check(await tired(true), 'the battery runs low: tired, low hops');
	win.webContents.send('ledges', [high]);
	await sleep(100);
	await js(`(() => { ${mom}.body.teleport(560, 0); ${kid}.body.teleport(380, ${size.h - 150}); })()`);
	check(await until(() => js(`!!${mom}.body.onLedge && ${kid}.body.onFloor()`), 3000), 'mum is up on a high window, her helper below');
	await js(`(() => {
		const k = ${kid}, m = ${mom}, t0 = __blaube.now();
		window.__air = Infinity; window.__ground = Infinity; window.__gave = null; __toMum = 0;
		window.__watch = setInterval(() => { const c = k.body.centroid(), mc = m.body.centroid(), d = Math.hypot(mc.x - c.x, mc.y - c.y) / m.body.o.radius; if (k.body.onFloor()) __ground = Math.min(__ground, d); else __air = Math.min(__air, d); }, 5);
		let g = null;
		Object.defineProperty(k, 'gaveUp', { configurable: true, get: () => g, set: (v) => { if (v && !g && !__gave) __gave = { grounded: k.body.onFloor(), vy: k.body.velocity(1 / 120).y, after: __blaube.now() - t0, tries: __toMum }; g = v; } });
	})()`);
	const gave = await until(() => js(`!!window.__gave`), 40000);
	const info = await js(`({ air: __air, ground: __ground, gave: __gave })`);
	check(info.air < info.ground * 0.7, `in the air it gets much closer to her than it ever is on the ground (${info.air.toFixed(2)} against ${info.ground.toFixed(2)} of her radii)`);
	check(gave && info.gave.after < 35, `it gives up (after ${gave ? info.gave.after.toFixed(1) : '-'} s)`);
	check(gave && info.gave.tries >= 4 && info.gave.tries <= 7, `after five jumps for her (${gave ? info.gave.tries : '-'})`);
	check(gave && info.gave.grounded && Math.abs(info.gave.vy) < 60, `only once it has landed and stands still (${gave ? Math.round(info.gave.vy) : '-'} px/s)`);
	await js(`clearInterval(__watch)`);
	check(await js(`__blaube.hearts().some((h) => h.broken)`), 'a breaking heart above it');
	check(await until(() => js(`__blaube.hearts().some((h) => h.puff)`), 2000), 'a sigh: a little puff of breath out');
	check(await js(`!${kid}.bubble`), 'and no words');
	const rest = await js(`${kid}.gaveUp.until - __blaube.now()`);
	check(rest > 200 && rest < 8 * 60 + 1, `it won't try again for minutes (${Math.round(rest)} s)`);
	// Resting while she stays up there (hopping about on her window now and
	// then): not one hop toward her.
	await js(`__toMum = 0`);
	for (let i = 0; i < 5; i++) { await sleep(5000); win.webContents.send('command', 'hop'); }
	check(await js(`__toMum === 0 && !!${kid}.gaveUp`), `it rests: no hop toward her in 25 s (${await js('__toMum')})`);
	// She comes down to it: it's glad.
	await js(`${mom}.body.teleport(${await js(`${kid}.body.centroid().x`)} + 260, ${size.h - 250})`);
	const came = await until(() => js(`!${kid}.gaveUp`), 5000);
	check(came, 'mum comes to it: it stops sulking');
	if (!came) console.log(await js(`JSON.stringify({ k: ${kid}.body.centroid(), kf: ${kid}.body.onFloor(), kl: !!${kid}.body.onLedge, kb: ${kid}.body.bbox().maxY, m: ${mom}.body.centroid(), mf: ${mom}.body.onFloor(), ml: !!${mom}.body.onLedge, mb: ${mom}.body.bbox().maxY, mh: !!${mom}.pendingHop, still: ${kid}.stillSince, now: __blaube.now() })`));
	check(await js(`${kid}.happyUntil > __blaube.now()`), 'and is happy to see her');
	await js(`(() => { const k = ${kid}; delete k.gaveUp; k.gaveUp = null; k.gaveUps = 0; k.tries = k.trying = null; })()`);
	win.webContents.send('ledges', []);
	await sleep(1500);
	await tired(false);

	// Charged, it makes that jump after all.
	win.webContents.send('ledges', [high]);
	await sleep(100);
	await js(`(() => { ${mom}.body.teleport(560, 0); ${kid}.body.teleport(380, ${size.h - 150}); })()`);
	check(await until(() => js(`${kid}.body.onLedge && ${mom}.body.onLedge && ${kid}.body.onLedge.id === ${mom}.body.onLedge.id && ${kid}.body.onFloor()`), 15000), 'charged, it jumps right up onto her high window');
	check(await js(`!${kid}.gaveUp`), 'without giving up');
	win.webContents.send('ledges', []);
	await sleep(1500);

	// A chase that's just taking a while (mum keeps moving off along the
	// floor) is no reason to give up.
	await js(`(() => { ${kid}.body.teleport(300, ${size.h - 150}); ${mom}.body.teleport(1200, ${size.h - 200}); })()`);
	let x = 1200;
	for (let i = 0; i < 10; i++) { await sleep(2000); x = x > size.w - 600 ? 900 : x + 350; await js(`${mom}.body.teleport(${x}, ${size.h - 200})`); }
	check(await js(`!${kid}.gaveUp`), 'chasing mum along the floor for 20 s, it never gives up');

	// Up on a window with mum on the floor far off: it hops down after her.
	const ledge = { id: 9, x0: 80, x1: 440, y: Math.round(size.h * 0.45), wx: 80, at: Date.now() };
	win.webContents.send('ledges', [ledge]);
	await sleep(100);
	await js(`(() => { ${kid}.body.teleport(260, ${ledge.y - 120}); ${mom}.body.teleport(${size.w - 500}, ${size.h - 200}); })()`);
	check(await until(() => js(`${kid}.body.onLedge && ${kid}.body.onFloor()`), 3000), 'the helper is up on a window, mum on the floor far off');
	check(await until(() => js(`${kid}.body.onFloor() && !${kid}.body.onLedge && ${kid}.body.centroid().x > ${ledge.x1}`), 10000), 'it hops down off the window after her');
	check(await js(`!${kid}.gaveUp`), 'without giving up');
	win.webContents.send('ledges', []);
	await sleep(1000);

	// Done, but mum's up out of reach (tired again): it heads home, gives
	// up, and after its sad moment fades back into her from where it is.
	await tired(true);
	win.webContents.send('ledges', [high]);
	await sleep(100);
	await js(`(() => { ${mom}.body.teleport(560, 0); ${kid}.body.teleport(380, ${size.h - 150}); })()`);
	await until(() => js(`!!${mom}.body.onLedge && ${kid}.body.onFloor()`), 3000);
	ev('g1', 'SubagentStop', { agent_id: 'gh1' });
	check(await until(() => js(`!!(${kid} && ${kid}.merging)`), 3000), 'the helper finishes and heads home');
	check(await until(() => js(`!!(${kid} && ${kid}.gaveUp)`), 30000), 'it can\'t get to her, and gives up');
	check(await until(() => js(`!${kid}`), 6000), 'then it fades back into her');
	check(await js(`__blaube.now() - (${mom}.gulpAt || -99) < 3`), 'and she gulps it in');
	check(errs.length === 0, `no errors (${errs.slice(0, 3).join(' | ')})`);
	return failed ? 1 : 0;
};
