// End-to-end check of picking a slime up at any moment of a hop, a trick or
// a somersault, with no Claude Code and no tokens: a fake session, and the
// mouse driven through the page's own handlers (the real one is ignored).
//
//   npm run e2e:grab
//
// For each moment (crouching, taking off, rising, at the top, mid-somersault,
// mid-trick, tumbling from a throw) it grabs the slime, carries it, holds it
// still and lets go, measuring the body every frame: how far it's off its
// size, how fast it turns, how much its skin churns, how stretched it is, how
// far the held spot trails the cursor. Held, it must behave like a slime
// picked up at rest: nothing it was doing goes on, nothing it was about to
// do fires later. Prints the numbers; exits non-zero on a failure.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page: the moments, the grab, the measuring.
const PAGE = String.raw`(() => {
	const B = __blaube, DT = 1 / 120;
	B.ownMouse = true;
	const raf = () => new Promise((r) => requestAnimationFrame(r));
	const frames = async (n) => { for (let i = 0; i < n; i++) await raf(); };
	const until = async (fn, n = 600) => { for (let i = 0; i < n; i++) { if (fn()) return true; await raf(); } return false; };
	const measure = (b) => {
		const body = b.body, n = body.n, c = body.centroid();
		let nan = false, mx = 0, my = 0, vmax = 0;
		const vx = new Float64Array(n), vy = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			if (!Number.isFinite(body.px[i]) || !Number.isFinite(body.py[i])) nan = true;
			vx[i] = (body.px[i] - body.ox[i]) / DT; vy[i] = (body.py[i] - body.oy[i]) / DT;
			mx += vx[i] / n; my += vy[i] / n;
			vmax = Math.max(vmax, Math.hypot(vx[i], vy[i]));
		}
		// Churn: how fast the skin moves relative to the body as a whole.
		let churn = 0, sxx = 0, syy = 0, sxy = 0;
		for (let i = 0; i < n; i++) {
			churn += ((vx[i] - mx) ** 2 + (vy[i] - my) ** 2) / n;
			const dx = body.px[i] - c.x, dy = body.py[i] - c.y;
			sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
		}
		const tr = sxx + syy, det = sxx * syy - sxy * sxy, d = Math.sqrt(Math.max(0, tr * tr / 4 - det));
		const aspect = Math.sqrt((tr / 2 + d) / Math.max(1e-9, tr / 2 - d));
		const a = body.grab && body.grabAnchor();
		return {
			area: body.area() / (body.restArea * body.areaScale), omega: body.angularVelocity(DT), upright: body.o.upright,
			cx: c.x, cy: c.y, gx: body.grab ? body.grab.x : null, gy: body.grab ? body.grab.y : null, ang: body.angle, contact: Object.keys(body.contact).filter((k) => body.contact[k]).join(''),
			vmax, churn: Math.sqrt(churn), aspect, lag: a ? Math.hypot(a.x - body.grab.x, a.y - body.grab.y) : 0, nan,
			busy: [b.pendingHop && 'pendingHop', b.flip && 'flip', b.trick && 'trick', b.tumble && 'tumble', b.roll && 'roll', b.bounceAt && 'bounce'].filter(Boolean).join(','),
		};
	};
	const settle = (b) => until(() => b.body.onFloor() && !b.body.grab && !b.pendingHop && !b.flip && !b.trick && !b.tumble && Math.hypot(b.body.velocity(DT).x, b.body.velocity(DT).y) < 30 && Math.abs(b.body.angularVelocity(DT)) < 0.3, 900);
	const vy = (b) => b.body.velocity(DT).y;
	// When to grab, for each moment.
	const MOMENTS = {
		rest: async () => true,
		crouch: async (b) => { b.hop(0, -900); return !!b.pendingHop && (await frames(2), !!b.pendingHop); },
		takeoff: async (b) => { b.hop(0, -900); return until(() => !b.pendingHop, 60); },
		rising: async (b) => { b.hop(0, -900); return until(() => !b.pendingHop && !b.body.onFloor() && vy(b) < -400, 90); },
		apex: async (b) => { b.hop(0, -900); return (await until(() => !b.pendingHop && !b.body.onFloor(), 90)) && until(() => vy(b) > -60, 90); },
		somersault: async (b) => {
			b.flip = { dir: 1, vy: -900, at: B.now() }; b.hop(0, -900);
			return until(() => b.flip && b.flip.spun && B.now() - b.flip.spun > 0.12, 120);
		},
		// (The trick's own last hop, with a somersault in it.)
		trick: async (b) => {
			b.trick = { n: 0, next: B.now() }; b.forceFlip = true;
			// (Its last hop: the trick itself may count as done by then.)
			let last = false;
			return until(() => { last = last || (b.trick && b.trick.n === 3); return last && b.flip && b.flip.spun && B.now() - b.flip.spun > 0.1; }, 900);
		},
		// Flung, it tumbles; caught again mid-air.
		tumble: async (b) => {
			const c = b.body.centroid();
			let x = c.x, y = c.y;
			B.input.down({ button: 0, clientX: x, clientY: y });
			for (let i = 0; i < 14; i++) { y -= 14; B.input.move({ clientX: x, clientY: y }); await raf(); }
			for (let i = 0; i < 6; i++) { x += 70; B.input.move({ clientX: x, clientY: y }); await raf(); }
			B.input.up({ button: 0, clientX: x, clientY: y });
			return !!b.tumble && (await frames(5), !!b.tumble);
		},
	};
	// Anything but your hand and its own wriggle that moves it while it's
	// held, by who did it.
	const pushers = new Set();
	const watch = (body) => {
		if (body.watched) return;
		body.watched = true;
		for (const k of ['impulse', 'spin', 'lean', 'squashTop', 'pushAt', 'stretchToward', 'teleport', 'shift']) {
			const f = body[k];
			body[k] = function (...a) {
				if (this.grab) {
					const who = (new Error().stack.split(/\n/)[2] || '').trim().split(' ')[1] || '?';
					if (!/^(held|onDown)$/.test(who)) pushers.add(who + '.' + k);
				}
				return f.apply(this, a);
			};
		}
	};
	return async (id, name, trace) => {
		const b = B.buddies.get(id);
		watch(b.body);
		pushers.clear();
		B.input.move({ clientX: 4, clientY: 4 }); // (you're around: it stays awake, and up for tricks)
		// (From the middle of the screen, so a fling or a carry never ends up against a wall.)
		await settle(b);
		b.body.teleport(b.body.bounds.left + (b.body.bounds.right - b.body.bounds.left) * 0.4, b.body.bounds.bottom - b.body.o.radius * 1.2);
		if (!(await settle(b))) return { name, error: 'never settled' };
		const upright = b.body.o.upright;
		if (!(await MOMENTS[name](b))) return { name, error: 'never got to that moment ' + JSON.stringify({ state: b.state, trick: b.trick && { n: b.trick.n, up: b.trick.up }, flip: b.flip && { spun: !!b.flip.spun }, floor: b.body.onFloor(), sleep: b.sleep }) };
		const at = measure(b);
		const c = b.body.centroid();
		let x = c.x, y = c.y;
		B.input.down({ button: 0, clientX: x, clientY: y });
		if (!b.body.grab) return { name, error: 'missed it' };
		const held = [], after = [];
		// Carried up and across, then held still a moment, then let go.
		for (let f = 0; f < 110; f++) {
			if (f < 40) { x += 4; y -= 4; B.input.move({ clientX: x, clientY: y }); }
			await raf();
			held.push(measure(b));
		}
		B.input.up({ button: 0, clientX: x, clientY: y });
		for (let f = 0; f < 150; f++) { await raf(); after.push(measure(b)); }
		const max = (l, k) => Math.max(...l.map((m) => Math.abs(m[k])));
		const min = (l, k) => Math.min(...l.map((m) => m[k]));
		const still = held.slice(70); // (held still: it should have calmed down)
		return {
			name, upright, at: { omega: at.omega, aspect: at.aspect, busy: at.busy },
			held: {
				omega: max(held, 'omega'), omegaStill: max(still, 'omega'), churn: max(held.slice(3), 'churn'), churnStill: max(still, 'churn'),
				areaMin: min(held, 'area'), areaMax: max(held, 'area'), aspect: max(held.slice(10), 'aspect'), lagStill: max(still, 'lag'),
				uprightOff: held.filter((m) => m.upright !== upright).length, busy: [...new Set(held.map((m) => m.busy).filter(Boolean))].join(','),
				vmax: max(held, 'vmax'),
			},
			after: { busy: [...new Set(after.map((m) => m.busy).filter(Boolean))].join(','), omega: max(after, 'omega') },
			nan: held.concat(after).some((m) => m.nan),
			afterBusyAt: after.findIndex((m) => m.busy), pushers: [...pushers].join(' '),
			trace: trace ? held.concat(after) : undefined,
		};
	};
})()`;

module.exports = async function run({ win, tracker }) {
	let failed = 0; const errs = [];
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	win.webContents.on('console-message', (e) => { if (e.level === 'error') errs.push(e.message); });
	const js = (s) => win.webContents.executeJavaScript(s);
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false); // invisible, it would otherwise get no frames and nothing would move
	await sleep(1000);
	tracker.handle({ session_id: 'g1', cwd: '/tmp/p-g1', hook_event_name: 'SessionStart' });
	await sleep(2500);
	check(await js(`__blaube.buddies.has('g1')`), 'a session slime');
	await js(`window.__grab = ${PAGE}; 0`);
	const f = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : v);
	const results = {};
	for (const name of process.env.GRAB_ONLY ? ['rest', ...process.env.GRAB_ONLY.split(',')] : ['rest', 'crouch', 'takeoff', 'rising', 'apex', 'somersault', 'trick', 'tumble']) {
		const r = await js(`__grab('g1', ${JSON.stringify(name)}, ${JSON.stringify(process.env.GRAB_TRACE === name)})`);
		if (r.trace) for (const [i, m] of r.trace.entries()) console.log(`  ${i} c ${f(m.cx, 0)},${f(m.cy, 0)} g ${f(m.gx, 0)},${f(m.gy, 0)} lag ${f(m.lag)} asp ${f(m.aspect, 2)} ang ${f(m.ang, 2)} ω ${f(m.omega, 1)} churn ${f(m.churn, 0)} area ${f(m.area, 2)} [${m.contact}] ${m.busy}`);
		results[name] = r;
		if (r.error) { check(false, `${name}: ${r.error}`); continue; }
		const h = r.held;
		console.log(`     ${name.padEnd(10)} grabbed at ω ${f(r.at.omega)} aspect ${f(r.at.aspect, 2)} [${r.at.busy}] | held: ω ${f(h.omega)} (still ${f(h.omegaStill, 2)}) churn ${f(h.churn, 0)} (still ${f(h.churnStill, 0)}) area ${f(h.areaMin, 2)}-${f(h.areaMax, 2)} aspect ${f(h.aspect, 2)} lag ${f(h.lagStill)} vmax ${f(h.vmax, 0)} upright-off ${h.uprightOff} [${h.busy}] | after: [${r.after.busy}]@${r.afterBusyAt} ω ${f(r.after.omega)} | pushed by: ${r.pushers || 'nobody'}`);
	}
	const rest = results.rest && !results.rest.error ? results.rest.held : null;
	check(!!rest, 'grabbed at rest, as the yardstick');
	if (rest) for (const [name, r] of Object.entries(results)) {
		if (name === 'rest' || r.error) continue;
		const h = r.held;
		check(!r.nan, `${name}: no NaN`);
		check(!h.busy, `${name}: held, nothing it was doing goes on (${h.busy || 'none'})`);
		check(h.uprightOff === 0, `${name}: held, it rights itself as usual (${h.uprightOff} frames off)`);
		check(!r.after.busy, `${name}: let go, nothing it was about to do fires late (${r.after.busy || 'none'})`);
		check(h.omega < Math.max(2, rest.omega * 3), `${name}: held, it doesn't whirl round (ω ${f(h.omega)} vs ${f(rest.omega)} at rest)`);
		check(h.churnStill < Math.max(200, rest.churnStill * 2.5), `${name}: held still, its skin settles (churn ${f(h.churnStill, 0)} vs ${f(rest.churnStill, 0)})`);
		check(h.areaMin > 0.8 && h.areaMax < 1.2, `${name}: held, it keeps its size (${f(h.areaMin, 2)}-${f(h.areaMax, 2)})`);
		check(h.aspect < Math.max(1.9, rest.aspect + 0.4), `${name}: held, it isn't left stretched (${f(h.aspect, 2)} vs ${f(rest.aspect, 2)})`);
		check(h.lagStill < Math.max(15, rest.lagStill * 2), `${name}: held still, the spot you hold stays under the cursor (${f(h.lagStill)} px)`);
	}
	check(errs.length === 0, 'no renderer errors ' + errs.slice(0, 3).join(' | '));
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
