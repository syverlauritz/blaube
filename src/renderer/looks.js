// Looks: a little something on top of each Blaube's head, picked at random
// for each session (the same session always gets the same one). A look sits
// on the skin straight above the face, so it rides every squish, and it
// hangs on a spring: hops, landings and drags make it wobble and settle.
(function (root) {
	'use strict';

	// [name, weight]. 'none' keeps about half of the Blaubes plain.
	const LOOKS = [
		['none', 15], ['curl', 2], ['bow', 2], ['antenna', 2], ['horns', 2],
		['catears', 2], ['bunny', 3], ['sprout', 2],
	];

	const hash = (key) => {
		let h = 2166136261;
		for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
		return h;
	};

	// The looks a key would like, best first: the same order every time for
	// the same key.
	function lookOrder(key, small) {
		let s = hash(key) || 1;
		const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ (s + 0x9e3779b9)) >>> 0) / 4294967296;
		const left = (small ? LOOKS.filter(([n]) => n !== 'bunny') : LOOKS).slice();
		const order = [];
		while (left.length) {
			const total = left.reduce((sum, [, w]) => sum + w, 0);
			let pick = rnd() * total, i = 0;
			while ((pick -= left[i][1]) >= 0 && i < left.length - 1) i++;
			order.push(left.splice(i, 1)[0][0]);
		}
		return order;
	}

	// The same key always picks the same look.
	function pickLook(key, small) {
		const h = hash(key);
		const list = small ? LOOKS.filter(([n]) => n !== 'bunny') : LOOKS;
		const total = list.reduce((s, [, w]) => s + w, 0);
		let pick = (h % 1000) / 1000 * total;
		for (const [name, w] of list) { if ((pick -= w) < 0) return name; }
		return 'none';
	}

	// How many of a look a Blaube wears, and where and how big each one is:
	// random, but the same every time for the same Blaube. Some looks come
	// in twos or threes (antennas, sprouts, curls); ear pairs get a random
	// spread instead. Horns come one to five, evenly along the top of the
	// head (an odd number has one in the middle), each a little bigger or
	// smaller.
	const MAX = { antenna: 3, curl: 2 }; // never more than one plant
	const HORN_SPAN = [0, 0, 1, 1.35, 1.65, 1.9]; // radians round the head, first to last, by count
	function partsOf(key, name) {
		let s = hash(key + '/' + name) || 1;
		const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ (s + 0x9e3779b9)) >>> 0) / 4294967296;
		if (name === 'horns') {
			const n = 1 + Math.floor(rnd() * 4.999);
			return Array.from({ length: n }, (_, i) => ({
				shift: n === 1 ? 0 : (i / (n - 1) - 0.5) * HORN_SPAN[n],
				spread: 1,
				scale: (1.45 - n * 0.1) * (0.9 + rnd() * 0.2),
			}));
		}
		const n = 1 + Math.floor(rnd() * (MAX[name] || 1) * 0.999);
		const parts = [];
		for (let i = 0; i < n; i++) {
			const slot = n === 1 ? 0 : (i / (n - 1) - 0.5) * 0.9; // spread over the crown
			parts.push({
				// Ears stay near the crown, or the lower one flops out like a fin.
				shift: (slot + (rnd() - 0.5) * (n === 1 ? 0.5 : 0.2)) * (name === 'bunny' ? 0.35 : 1),
				spread: 0.8 + rnd() * 0.5,
				scale: (n === 1 ? 0.8 : 0.65) + rnd() * 0.45,
			});
		}
		return parts;
	}

	// Where on the skin a look sits: a spot `off` radians round from the
	// crown, given as a place along the skin (in the angle each bit of skin
	// had when the body was made, straight up being -90°). The face leans
	// with the body only up to LEAN; while the body turns no more than that,
	// a look stays glued to the same bit of skin, and past that it slides
	// round the skin to stay on top of the face instead of ending up on its
	// side. Mid-somersault it goes all the way round with the body.
	const LEAN = 0.18; // the same lean as the face
	const REACH = 0.4; // how far squashing may carry it off the crown
	const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
	const leanOf = (body) => body.fullTurn ? body.angle : Math.max(-LEAN, Math.min(LEAN, body.angle));

	// How far the skin itself has turned since the body was made: the best
	// fit rotation of all the points onto their rest shape (smooth: every
	// point counts). (body.angle is not quite this: it's worked out partway
	// through a step.)
	function skinTurn(body) {
		const c = body.centroid();
		let s = 0, k = 0;
		for (let i = 0; i < body.n; i++) {
			const qx = body.px[i] - c.x, qy = body.py[i] - c.y;
			s += body.rx[i] * qy - body.ry[i] * qx;
			k += body.rx[i] * qx + body.ry[i] * qy;
		}
		return Math.atan2(s, k);
	}

	// A spot on the outline exactly as it is drawn (face.js bodyPath: a
	// smooth curve through the midpoints between skin points, each point
	// pulling it), at place a along the skin, and which way the outline
	// faces there. Both slide smoothly as a moves: the old way (the nearest
	// two points, and the line between their neighbours) snapped 22° every
	// time the spot crossed a skin point.
	function skinAt(body, a) {
		const n = body.n, px = body.px, py = body.py;
		const g = ((((a / (Math.PI * 2)) * n) % n) + n) % n + 0.5;
		const i = Math.floor(g) % n, s = g - Math.floor(g);
		const h = (i - 1 + n) % n, j = (i + 1) % n;
		const w0 = (1 - s) * (1 - s) / 2, w1 = 0.5 + s - s * s, w2 = s * s / 2;
		const x = w0 * px[h] + w1 * px[i] + w2 * px[j];
		const y = w0 * py[h] + w1 * py[i] + w2 * py[j];
		const tx = (s - 1) * px[h] + (1 - 2 * s) * px[i] + s * px[j];
		const ty = (s - 1) * py[h] + (1 - 2 * s) * py[i] + s * py[j];
		const len = Math.hypot(tx, ty) || 1;
		return { x, y, nx: ty / len, ny: -tx / len };
	}

	// The place along the skin for a look `off` round from the crown: its own
	// bit of skin, eased back toward the crown when squashing has carried it
	// more than REACH away (smoothly: the further off, the more it slides).
	function placeFor(body, off) {
		const turn = skinTurn(body), lean = leanOf(body);
		const want = -Math.PI / 2 + lean + off;
		let a = want - turn;
		if (body.fullTurn) return a;
		const c = body.centroid();
		for (let k = 0; k < 2; k++) {
			const p = skinAt(body, a);
			const d = wrap(Math.atan2(p.y - c.y, p.x - c.x) - want);
			if (Math.abs(d) <= REACH) break;
			a -= d - Math.sign(d) * REACH;
		}
		return a;
	}

	// Each part of a look has an anchor: its place along the skin and the
	// way it faces (relative to the skin's turn), both following the head
	// through a critically damped spring in the fixed physics step. So the
	// skin's tiny wobbles (breathing, typing dips, the odd point nudged by a
	// neighbour) never shake it, while squashes, leans and tumbles still
	// carry it along. Drawing reads it off the skin as it is now, so it stays
	// glued to the outline.
	const ANCHOR_W = 30; // rad/s: follows anything slower than about 5 Hz
	function anchorsOf(b) {
		const L = b.lookState || (b.lookState = newState());
		if (!L.anchors || L.anchorsFor !== b.key + '/' + b.look) { L.anchors = new Map(); L.anchorsFor = b.key + '/' + b.look; }
		return L.anchors;
	}
	function anchorAt(b, off) {
		const anchors = anchorsOf(b), id = off.toFixed(4);
		let A = anchors.get(id);
		const body = b.body, turn = skinTurn(body);
		if (!A) {
			const a = placeFor(body, off), p = skinAt(body, a);
			A = { off, a, av: 0, q: wrap(Math.atan2(p.ny, p.nx) - turn), qv: 0 };
			anchors.set(id, A);
		}
		const p = skinAt(body, A.a), q = A.q + turn;
		return { x: p.x, y: p.y, nx: Math.cos(q), ny: Math.sin(q) };
	}
	function stepAnchors(b, dt) {
		const body = b.body, turn = skinTurn(body), w = ANCHOR_W;
		for (const A of anchorsOf(b).values()) {
			const da = wrap(placeFor(body, A.off) - A.a);
			A.av += (w * w * da - 2 * w * A.av) * dt;
			A.a += A.av * dt;
			const p = skinAt(body, A.a);
			const dq = wrap(Math.atan2(p.ny, p.nx) - turn - A.q);
			A.qv += (w * w * dq - 2 * w * A.qv) * dt;
			A.q = wrap(A.q + A.qv * dt);
		}
	}

	// The head's movement, as the springs feel it: its middle's velocity and
	// acceleration (and its spin), each smoothed over a few hundredths of a
	// second, and then a dead zone, so breathing, typing dips and the skin's
	// jitters do nothing at all while hops, landings, throws and drags give
	// a real shove.
	const ease = (dt, tau) => 1 - Math.exp(-dt / tau);
	const deadzone = (v, d) => Math.sign(v) * Math.max(0, Math.abs(v) - d);
	const DEAD_ACC = 150, DEAD_SPIN = 3; // px/s², rad/s²
	function stepHead(L, body, dt) {
		const c = body.centroid(), turn = skinTurn(body);
		// (Put somewhere new in one go, it hasn't moved: no shove.)
		if (L.cx === undefined || Math.hypot(c.x - L.cx, c.y - L.cy) > body.o.radius) { L.cx = c.x; L.cy = c.y; L.turn = turn; }
		const kv = ease(dt, 0.03), ka = ease(dt, 0.03);
		const vx = L.vx + ((c.x - L.cx) / dt - L.vx) * kv, vy = L.vy + ((c.y - L.cy) / dt - L.vy) * kv;
		L.rax += ((vx - L.vx) / dt - L.rax) * ka;
		L.ray += ((vy - L.vy) / dt - L.ray) * ka;
		L.vx = vx; L.vy = vy; L.cx = c.x; L.cy = c.y;
		const m = Math.hypot(L.rax, L.ray), keep = m > DEAD_ACC ? (m - DEAD_ACC) / m : 0;
		L.ax = L.rax * keep; L.ay = L.ray * keep;
		const spin = L.spin + (wrap(turn - L.turn) / dt - L.spin) * kv;
		L.rspinAcc += ((spin - L.spin) / dt - L.rspinAcc) * ka;
		L.spin = spin; L.turn = turn;
		L.spinAcc = deadzone(L.rspinAcc, DEAD_SPIN);
	}

	// A twitch plays as a smooth bump in where the spring wants to rest
	// (out and back in about a third of a second), never as a kick.
	const TWITCH_TIME = 0.36;
	const twitchNow = (L) => {
		const t = L.clock - (L.twitch ? L.twitch.at : -1e9);
		if (!L.twitch || t > TWITCH_TIME) return 0;
		const s = Math.sin(Math.PI * t / TWITCH_TIME);
		return L.twitch.amp * s * s;
	};

	const newState = () => ({ a: 0, w: 0, t: 0, tw: 0, vx: 0, vy: 0, rax: 0, ray: 0, ax: 0, ay: 0, spin: 0, rspinAcc: 0, spinAcc: 0, clock: 0 });

	// Each look hangs on two springs, like a pendulum on a pendulum: the
	// base swings when the head is shoved, and the tip (leaves, antenna
	// ball, ear tips) trails behind the base. It all runs in the fixed
	// physics step (b.look's springs never see the frame rate).
	const LOOSE = { antenna: 1.8, sprout: 2.2, bunny: 1.7 };
	function stepLook(b, dt) {
		const L = b.lookState || (b.lookState = newState());
		L.clock += dt;
		stepAnchors(b, dt);
		stepHead(L, b.body, dt);
		// Only shoves along the skin swing it (a pendulum feels its pivot's
		// acceleration, the other way): the middle's, and the head's spin
		// carrying the top of it round.
		const up = -Math.PI / 2 + leanOf(b.body);
		const along = L.ax * -Math.sin(up) + L.ay * Math.cos(up) + L.spinAcc * b.body.o.radius;
		const loose = LOOSE[b.look] || 1.3;
		const k = 55 / loose, damp = 5.5 / Math.sqrt(loose);
		const rest = b.look === 'bunny' ? 0 : twitchNow(L);
		// The head spinning (a tumble, a shove) swings it the other way.
		L.w += (-k * (L.a - rest) - damp * L.w - along * 0.0018 * loose - L.spinAcc * 0.004) * dt;
		L.w = Math.max(-2.5, Math.min(2.5, L.w));
		L.a += L.w * dt;
		// The tip follows the base, a little late and a little further.
		L.tw += (-40 / loose * (L.t - L.a) - 4 * L.tw - along * 0.0009 * loose) * dt;
		L.tw = Math.max(-6, Math.min(6, L.tw));
		L.t += L.tw * dt;
		const ft = b.faceTurn || { x: 0, y: 0 };
		if (L.hx === undefined) { L.hx = ft.x; L.hy = ft.y; L.hvx = 0; L.hvy = 0; }
		L.hvx += (30 * (ft.x - L.hx) - 9 * L.hvx) * dt;
		L.hvy += (30 * (ft.y - L.hy) - 9 * L.hvy) * dt;
		L.hx += L.hvx * dt;
		L.hy += L.hvy * dt;
		if (b.look === 'bunny') stepEars(b, L, dt);
	}

	// Bunny ears are chains of stiff-ish joints with real weight: gravity
	// pulls every joint over, the head's acceleration drags them the other
	// way (so they flop out on a landing, float up when thrown, and trail
	// when dragged), and each joint springs back toward a soft outward
	// curve. Stiffer at the root, floppier at the tip.
	const EAR_JOINTS = 6;
	const earSlope = (p) => { const a = Math.atan2(p.ny, p.nx) + Math.PI / 2; return Math.atan2(Math.sin(a), Math.cos(a)); };
	const EAR_K = [240, 210, 185, 165, 150, 140];
	function stepEars(b, L, dt) {
		const body = b.body, g = 2400;
		const parts = b.lookParts || partsOf(b.key, 'bunny');
		if (!L.ears) L.ears = [-1, 1].map(() => ({ a: new Array(EAR_JOINTS).fill(0), w: new Array(EAR_JOINTS).fill(0), base: null, bw: 0, ba: 0 }));
		[-1, 1].forEach((s, e) => {
			const E = L.ears[e];
			const p = anchorAt(b, s * 0.3 * parts[0].spread + parts[0].shift);
			// Ears follow only half the skin's slope, so they stand up from the
			// head instead of sticking out of its side.
			const base = earSlope(p) * 0.5 + soft(L.a, 0.45);
			if (E.base === null) E.base = base;
			// The root turning (the head tipping) swings the ear the other way:
			// smoothed, with a dead zone, like the head's shoves.
			const bw = E.bw + (wrap(base - E.base) / dt - E.bw) * ease(dt, 0.03);
			E.rba = (E.rba || 0) + ((bw - E.bw) / dt - (E.rba || 0)) * ease(dt, 0.03);
			E.ba = deadzone(E.rba, DEAD_SPIN);
			E.base = base; E.bw = bw;
			const twitch = L.twitch && (!L.twitch.side || L.twitch.side === s) ? twitchNow(L) : 0;
			let phi = base;
			// The whole ear bends at most about 1.6 rad (it never folds flat).
			const total = E.a.reduce((sum, x) => sum + x, 0);
			if (Math.abs(total) > 1.6) for (let i = 0; i < EAR_JOINTS; i++) E.a[i] *= 1 - (1 - 1.6 / Math.abs(total)) * 0.2;
			for (let i = 0; i < EAR_JOINTS; i++) {
				phi += E.a[i];
				// Weight and the head's shove, as a twist about this joint: about
				// 20 rad/s² per g, so standing still they only droop a little.
				const pull = ((g - L.ay) * Math.sin(phi) - L.ax * Math.cos(phi)) / g * 20;
				const rest = s * ((i === 0 ? -0.05 : 0.02) + twitch * (i === 0 ? 1 : i === 1 ? 0.6 : 0));
				const k = EAR_K[i], damp = 2.4 + 0.25 * Math.sqrt(k);
				E.w[i] += (pull - k * (E.a[i] - rest) - damp * E.w[i] - (i === 0 ? E.ba : 0)) * dt;
				E.w[i] = Math.max(-14, Math.min(14, E.w[i]));
				// A soft limit: it gets harder to bend near it, never a hard stop.
				E.a[i] = soft(E.a[i] + E.w[i] * dt, 0.6);
			}
		});
	}

	// A twitch (an ear twitch, an antenna perking up): the spring's resting
	// place bumps over and back, smoothly, and the look follows it. Rare on
	// purpose: one at a time, and not again for a few seconds. For bunny
	// ears, side picks one ear (-1 left, 1 right, 0 both), and w > 0 flicks
	// it out, w < 0 pricks it up. A plant doesn't twitch.
	const TWITCH_REST = 4; // seconds between twitches, at least
	function flick(b, w, side = 0) {
		const L = b.lookState;
		if (!L || b.look === 'sprout') return;
		if (L.twitch && L.clock - L.twitch.at < TWITCH_REST) return;
		const amp = L.ears ? w * 0.04 : w * 0.025 * (side || 1);
		L.twitch = { at: L.clock, amp: Math.max(-0.35, Math.min(0.35, amp)), side };
	}

	// Swings ease into their limit instead of stopping dead at it.
	const soft = (v, max) => max * Math.tanh(v / max);

	// Draws a look: layer 'back' (in the body's colour, under the body so it
	// grows out of it seamlessly) or 'front' (its own colours, on top).
	function drawLook(ctx, b, layer, color) {
		const name = b.look;
		if (layer === 'back') { b.body.lookTop = null; b.body.lookTips = []; } // how high it reaches, and where its tips are; set below
		if (!name || name === 'none') return;
		const body = b.body, r = body.o.radius, u = 0.16 * Math.sqrt(r * 110);
		const L = b.lookState || { a: 0, t: 0 };
		const swing = soft(L.a, 0.45); // the base
		const tip = soft(L.t, 0.9) - swing; // how far the tip trails it
		// Draws fn in a frame at the skin, angle `off` from straight up,
		// with -y pointing out of the head.
		// When the face turns to look around, the top of the head turns too:
		// a bit less far than the face (it's further round the ball), and
		// tipping the look the same way.
		const turn = b.lookState && b.lookState.hx !== undefined ? { x: b.lookState.hx, y: b.lookState.hy } : { x: 0, y: 0 };
		if (!b.lookParts || b.lookPartsFor !== b.key + name) { b.lookParts = partsOf(b.key, name); b.lookPartsFor = b.key + name; }
		let part = b.lookParts[0];
		const at = (off, fn, sink = 0.6) => {
			const round = off * part.spread + part.shift; // how far round from the crown
			const p = anchorAt(b, round);
			ctx.save();
			ctx.translate(p.x - p.nx * u * sink + turn.x * 0.35, p.y - p.ny * u * sink + turn.y * 0.15);
			ctx.rotate(Math.atan2(p.ny, p.nx) + Math.PI / 2 + swing + (turn.x / r) * 0.5);
			// Tipping the head up or down leans what's on top away from you or
			// toward you, so it looks shorter; turning sideways shows its edge,
			// so it looks narrower.
			const pitch = Math.min(1, Math.abs(turn.y / r) * 1.8), yaw = Math.min(1, Math.abs(turn.x / r) * 1.2);
			// Turning one way brings the other side of the head toward you:
			// turning left, a look on the right grows and one on the left
			// shrinks.
			const near = Math.max(0.55, Math.min(1.45, 1 - (turn.x / r) * 1.6 * Math.sin(round)));
			const shortest = name === 'bunny' ? 0.85 : 0.45;
			ctx.scale(Math.max(0.6, Math.cos(yaw)) * part.scale * near, Math.max(shortest, Math.cos(pitch)) * part.scale * near);
			// Its highest point, about 2.6 u out along the look.
			const reach = u * (name === 'bunny' ? 5 : 2.6) * part.scale, ang = Math.atan2(p.ny, p.nx) + Math.PI / 2 + swing;
			const topY = p.y - p.ny * u * sink - reach * Math.cos(ang);
			if (body.lookTop == null || topY < body.lookTop) body.lookTop = topY;
			body.lookTips.push({ x: p.x - p.nx * u * sink + reach * Math.sin(ang), y: topY, w: u * 1.6 * part.scale }); // (a sheet over it drapes over these)
			if (part === b.lookParts[0]) {
				const m = ctx.getTransform(), c = body.centroid();
				b.lookDrawn = { x: m.e - c.x, y: m.f - c.y, rot: Math.atan2(m.b, m.a), len: Math.hypot(m.c, m.d) };
			}
			fn();
			ctx.restore();
		};
		ctx.save();
		ctx.fillStyle = ctx.strokeStyle = color;
		ctx.lineCap = ctx.lineJoin = 'round';
		const back = layer === 'back', front = !back;
		for (part of b.lookParts) {
			switch (name) {
				case 'curl':
					if (back) at(-0.1, () => {
						// A tuft that curls over to one side.
						ctx.beginPath();
						ctx.moveTo(-u * 1.3, u * 0.9);
						ctx.quadraticCurveTo(-u * 1.3, -u * 1.2, -u * 0.1, -u * 2.1);
						ctx.quadraticCurveTo(-u * 0.9, -u * 0.9, u * 0.5, -u * 0.2);
						ctx.quadraticCurveTo(u * 1.2, u * 0.3, u * 1.3, u * 0.9);
						ctx.closePath();
						ctx.fill();
					}, 0.8);
					break;
				case 'antenna':
					if (back) at(0, () => {
						ctx.lineWidth = u * 0.32;
						ctx.beginPath();
						const bend = tip * u * 1.6;
						ctx.moveTo(0, u);
						ctx.quadraticCurveTo(u * 0.25, -u * 1.1, bend, -u * 2);
						ctx.stroke();
						ctx.beginPath();
						ctx.arc(bend * 1.1, -u * 2.25, u * 0.48, 0, Math.PI * 2);
						ctx.fill();
					});
					break;
				case 'catears':
					// Rounded triangles in the body's colour, pink inside.
					for (const s of [-1, 1]) at(s * 0.45, () => {
						if (back) {
							ctx.beginPath();
							ctx.moveTo(-u * 1.3, u);
							ctx.quadraticCurveTo(-u * 1.0, -u * 1.0, s * u * 0.35, -u * 2.1);
							ctx.quadraticCurveTo(u * 1.0, -u * 1.0, u * 1.3, u);
							ctx.closePath();
							ctx.fill();
						} else {
							ctx.fillStyle = '#ff9ab4'; // pink inside, so they read as ears, not horns
							ctx.beginPath();
							ctx.moveTo(-u * 0.7, u * 0.1);
							ctx.quadraticCurveTo(-u * 0.5, -u * 0.8, s * u * 0.25, -u * 1.5);
							ctx.quadraticCurveTo(u * 0.5, -u * 0.8, u * 0.7, u * 0.1);
							ctx.closePath();
							ctx.fill();
						}
					});
					break;
				case 'horns':
					// Little blunt nubs in the body's colour with rounded tips, the
					// ones off to the side bending outward (the middle one stands
					// straight).
					if (back) at(0, () => {
						const lean = Math.sign(part.shift) * Math.min(1, Math.abs(part.shift) * 2) * u * 0.3, tip = u * 0.34;
						ctx.beginPath();
						ctx.moveTo(-u * 0.75, u * 0.8);
						ctx.quadraticCurveTo(-u * 0.6, -u * 0.45, lean - tip, -u * 1.2);
						ctx.arc(lean, -u * 1.2, tip, Math.PI, 0);
						ctx.quadraticCurveTo(u * 0.6, -u * 0.45, u * 0.75, u * 0.8);
						ctx.closePath();
						ctx.fill();
					});
					break;
				case 'bow':
					if (front) at(-0.3, () => {
						ctx.fillStyle = '#d40f3c';
						for (const s of [-1, 1]) {
							ctx.beginPath();
							ctx.moveTo(0, -u * 0.3);
							ctx.quadraticCurveTo(s * u * 0.9, -u * 1.5, s * u * 1.6, -u * 0.9);
							ctx.quadraticCurveTo(s * u * 1.8, u * 0.3, 0, -u * 0.1);
							ctx.fill();
						}
						ctx.beginPath();
						ctx.ellipse(0, -u * 0.25, u * 0.42, u * 0.38, 0, 0, Math.PI * 2);
						ctx.fill();
					}, 0.1);
					break;
				case 'sprout':
					// Behind the head: a long bendy stem that the tip drags
					// sideways, with two leaves drooping off the end.
					if (back) at(0.2, () => {
						const bend = tip * u * 1.8, top = -u * 1.25;
						ctx.strokeStyle = '#5cc46f'; // one flat green for the whole plant
						ctx.lineWidth = u * 0.24;
						ctx.beginPath();
						ctx.moveTo(0, u * 0.6);
						ctx.quadraticCurveTo(u * 0.2, -u * 0.6, bend, top);
						ctx.stroke();
						ctx.fillStyle = '#5cc46f';
						for (const s of [-1, 1]) {
							ctx.save();
							ctx.translate(bend, top);
							ctx.rotate(s * 1.25 + tip * 1.4);
							ctx.beginPath();
							ctx.ellipse(0, -u * 0.6, u * 0.4, u * 0.66, 0, 0, Math.PI * 2);
							ctx.fill();
							ctx.restore();
						}
					}, 0.3);
					break;
				case 'bunny':
					// Long ears in the body's colour, one smooth shape each,
					// bending along the joints stepEars swings.
					if (back) [-1, 1].forEach((s, e) => at(s * 0.3, () => {
						const E = L.ears && L.ears[e];
						ctx.rotate(-earSlope(anchorAt(b, s * 0.3 * part.spread + part.shift)) * 0.5);
						const len = u * 5, w = u * 0.85, steps = 24;
						// The spine: the bend eases from joint to joint.
						const spine = [];
						let x = 0, y = u * 0.6, phi = 0;
						for (let k = 0; k <= steps; k++) {
							const t = k / steps;
							if (k > 0) {
								const f = t * EAR_JOINTS - 0.5, i = Math.max(0, Math.min(EAR_JOINTS - 1, Math.floor(f)));
								const bend = E ? E.a[i] + (E.a[Math.min(EAR_JOINTS - 1, i + 1)] - E.a[i]) * Math.max(0, Math.min(1, f - i)) : s * 0.08;
								phi += bend * EAR_JOINTS / steps;
								x += Math.sin(phi) * len / steps;
								y -= Math.cos(phi) * len / steps;
							}
							// Narrow at the root, fullest in the middle, a rounded point at the tip.
							const half = w * (0.5 + 0.55 * Math.sin(Math.PI * t)) * (1 - 0.32 * t * t * t);
							spine.push({ x, y, nx: Math.cos(phi), ny: Math.sin(phi), half, phi });
						}
						const end = spine[steps];
						ctx.beginPath();
						ctx.moveTo(spine[0].x - spine[0].nx * spine[0].half, spine[0].y - spine[0].ny * spine[0].half);
						for (const q of spine) ctx.lineTo(q.x - q.nx * q.half, q.y - q.ny * q.half);
						ctx.arc(end.x, end.y, end.half, end.phi + Math.PI, end.phi + Math.PI * 2);
						for (let k = steps; k >= 0; k--) ctx.lineTo(spine[k].x + spine[k].nx * spine[k].half, spine[k].y + spine[k].ny * spine[k].half);
						ctx.closePath();
						ctx.fill();
					}));
					break;
			}
		}

		ctx.restore();
	}

	// How far (radians) round from the crown a look sits: for
	// the shots script's checks.
	function offTop(b) {
		const p = anchorAt(b, 0), c = b.body.centroid();
		return Math.abs(wrap(Math.atan2(p.y - c.y, p.x - c.x) - (-Math.PI / 2 + leanOf(b.body))));
	}

	root.BlaubeLooks = { LOOKS, pickLook, lookOrder, stepLook, drawLook, offTop, flick };
})(globalThis);
