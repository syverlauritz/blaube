// Looks: a little something on top of each Blaube's head, picked at random
// for each session (the same session always gets the same one). A look sits
// on the skin straight above the face, so it rides every squish, and it
// hangs on a spring: hops, landings and drags make it wobble and settle.
(function (root) {
	'use strict';

	// [name, weight]. 'none' keeps a few Blaubes plain.
	const LOOKS = [
		['none', 3], ['curl', 2], ['bow', 2], ['antenna', 2], ['horns', 2],
		['catears', 2], ['bunny', 2], ['sprout', 2],
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
	// in twos or threes (antennas, sprouts, curls); pairs (ears, horns) get a
	// random spread instead.
	const MAX = { antenna: 3, curl: 2 }; // never more than one plant
	function partsOf(key, name) {
		let s = hash(key + '/' + name) || 1;
		const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ (s + 0x9e3779b9)) >>> 0) / 4294967296;
		const n = 1 + Math.floor(rnd() * (MAX[name] || 1) * 0.999);
		const parts = [];
		for (let i = 0; i < n; i++) {
			const slot = n === 1 ? 0 : (i / (n - 1) - 0.5) * 0.9; // spread over the crown
			parts.push({
				shift: slot + (rnd() - 0.5) * (n === 1 ? 0.5 : 0.2),
				spread: 0.8 + rnd() * 0.5,
				scale: (n === 1 ? 0.8 : 0.65) + rnd() * 0.45,
			});
		}
		return parts;
	}

	// The bit of skin on top of the head. The face leans with the body only
	// up to LEAN; while the body turns no more than that, a look stays
	// glued to the same bit of skin, and past that it slides round the skin
	// to stay on top of the face instead of ending up on its side.
	const LEAN = 0.18; // the same lean as the face
	function topOfHead(body) {
		const lean = Math.max(-LEAN, Math.min(LEAN, body.angle));
		return -Math.PI / 2 + lean - skinTurn(body);
	}

	// How far the skin itself has turned since the body was made: the best
	// fit rotation of the points onto their rest shape. (body.angle is not
	// this: it eases back to upright on its own.)
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

	// A spot on the skin itself: the skin point that sat at angle a when the
	// body was made (straight up is -90°), blended between its neighbours.
	// It's the same bit of skin every frame, so a look glued there moves,
	// squishes and turns with the body. Also says which way the skin faces.
	function skinAt(body, a) {
		const n = body.n;
		const f = ((((a / (Math.PI * 2)) * n) % n) + n) % n;
		const i = Math.floor(f) % n, j = (i + 1) % n, s = f - Math.floor(f);
		const x = body.px[i] + (body.px[j] - body.px[i]) * s;
		const y = body.py[i] + (body.py[j] - body.py[i]) * s;
		// The skin's direction here, from the points either side.
		const h = (i - 1 + n) % n, k = (j + 1) % n;
		const tx = body.px[k] - body.px[h], ty = body.py[k] - body.py[h];
		const len = Math.hypot(tx, ty) || 1;
		let nx = ty / len, ny = -tx / len;
		const c = body.centroid();
		if (nx * (x - c.x) + ny * (y - c.y) < 0) { nx = -nx; ny = -ny; }
		return { x, y, nx, ny };
	}

	// Where the skin is hit by a ray from the middle at angle a.
	function rayAt(body, a) {
		const c = body.centroid();
		const dx = Math.cos(a), dy = Math.sin(a);
		let best = -1, hit = { x: c.x, y: c.y, nx: dx, ny: dy };
		for (let i = 0; i < body.n; i++) {
			const j = (i + 1) % body.n;
			const ex = body.px[j] - body.px[i], ey = body.py[j] - body.py[i];
			const den = dx * ey - dy * ex;
			if (Math.abs(den) < 1e-9) continue;
			const qx = body.px[i] - c.x, qy = body.py[i] - c.y;
			const d = (qx * ey - qy * ex) / den, s = (qx * dy - qy * dx) / den;
			if (d > best && s >= 0 && s <= 1) {
				best = d;
				const len = Math.hypot(ex, ey) || 1;
				let nx = ey / len, ny = -ex / len;
				if (nx * dx + ny * dy < 0) { nx = -nx; ny = -ny; }
				hit = { x: c.x + dx * d, y: c.y + dy * d, nx, ny };
			}
		}
		return hit;
	}

	// The spot for a look `off` radians round from the crown: its own bit of
	// skin, unless squashing has carried that more than 0.4 rad away from
	// where the crown should be; then the nearest spot that isn't.
	const REACH = 0.4;
	function spotFor(body, off) {
		const p = skinAt(body, topOfHead(body) + off);
		const c = body.centroid();
		const want = -Math.PI / 2 + Math.max(-LEAN, Math.min(LEAN, body.angle)) + off;
		const d = Math.atan2(p.y - c.y, p.x - c.x) - want;
		const diff = Math.atan2(Math.sin(d), Math.cos(d));
		return Math.abs(diff) <= REACH ? p : rayAt(body, want + Math.sign(diff) * REACH);
	}

	// Each look hangs on two springs, like a pendulum on a pendulum: the
	// base swings when the head is shoved, and the tip (leaves, antenna
	// ball, ear tips) trails behind the base. The head's movement is
	// smoothed first, so the skin's tiny jitters don't shake it.
	const LOOSE = { antenna: 1.8, sprout: 2.2, bunny: 1.7 };
	function stepLook(b, dt) {
		const L = b.lookState || (b.lookState = { a: 0, w: 0, t: 0, tw: 0, vx: 0, vy: 0, ax: 0, ay: 0 });
		const p = spotFor(b.body, 0);
		if (L.px === undefined) { L.px = p.x; L.py = p.y; L.turn = skinTurn(b.body); L.spin = 0; }
		const vx = (p.x - L.px) / dt, vy = (p.y - L.py) / dt;
		L.px = p.x; L.py = p.y;
		const svx = L.vx + (vx - L.vx) * 0.25, svy = L.vy + (vy - L.vy) * 0.25;
		L.ax += ((svx - L.vx) / dt - L.ax) * 0.3;
		L.ay += ((svy - L.vy) / dt - L.ay) * 0.3;
		L.vx = svx; L.vy = svy;
		// Only shoves along the skin swing it (a pendulum feels its pivot's
		// acceleration, the other way).
		const along = L.ax * -p.ny + L.ay * p.nx;
		// The head spinning (a tumble, a shove) swings it the other way.
		const turn = skinTurn(b.body);
		const spin = Math.atan2(Math.sin(turn - L.turn), Math.cos(turn - L.turn)) / dt;
		L.turn = turn;
		const spinAcc = (spin - L.spin) / dt;
		L.spin += (spin - L.spin) * 0.3;
		const loose = LOOSE[b.look] || 1.3;
		const k = 55 / loose, damp = 5.5 / Math.sqrt(loose);
		L.w += (-k * L.a - damp * L.w - along * 0.0012 * loose - spinAcc * 0.004) * dt;
		L.w = Math.max(-2.5, Math.min(2.5, L.w));
		L.a += L.w * dt;
		// The tip follows the base, a little late and a little further.
		L.tw += (-40 / loose * (L.t - L.a) - 4 * L.tw - along * 0.0006 * loose) * dt;
		L.tw = Math.max(-6, Math.min(6, L.tw));
		L.t += L.tw * dt;
		const ft = b.faceTurn || { x: 0, y: 0 };
		if (L.hx === undefined) { L.hx = ft.x; L.hy = ft.y; L.hvx = 0; L.hvy = 0; }
		L.hvx += (30 * (ft.x - L.hx) - 9 * L.hvx) * dt;
		L.hvy += (30 * (ft.y - L.hy) - 9 * L.hvy) * dt;
		L.hx += L.hvx * dt;
		L.hy += L.hvy * dt;
	}

	// Swings ease into their limit instead of stopping dead at it.
	const soft = (v, max) => max * Math.tanh(v / max);

	// Draws a look: layer 'back' (in the body's colour, under the body so it
	// grows out of it seamlessly) or 'front' (its own colours, on top).
	function drawLook(ctx, b, layer, color) {
		const name = b.look;
		if (layer === 'back') b.body.lookTop = null; // how high it reaches; set below
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
			const p = spotFor(body, round);
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
			ctx.scale(Math.max(0.6, Math.cos(yaw)) * part.scale * near, Math.max(0.45, Math.cos(pitch)) * part.scale * near);
			// Its highest point, about 2.6 u out along the look.
			const reach = u * 2.6 * part.scale, ang = Math.atan2(p.ny, p.nx) + Math.PI / 2 + swing;
			const topY = p.y - p.ny * u * sink - reach * Math.cos(ang);
			if (body.lookTop == null || topY < body.lookTop) body.lookTop = topY;
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
					// Little pointed nubs in the body's colour, tips bending outward.
					if (back) for (const s of [-1, 1]) at(s * 0.5, () => {
						ctx.beginPath();
						ctx.moveTo(-u * 0.75, u * 0.8);
						ctx.quadraticCurveTo(-u * 0.45, -u * 0.6, s * u * 0.55, -u * 1.55);
						ctx.quadraticCurveTo(u * 0.45, -u * 0.6, u * 0.75, u * 0.8);
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
					// Long ears in the body's colour, pink inside; the right one
					// flops over a little.
					for (const s of [-1, 1]) at(s * 0.32, () => {
						ctx.rotate(-s * 0.12 + (s > 0 ? 0.3 : 0) + tip * 0.6);
						if (back) {
							ctx.beginPath();
							ctx.ellipse(0, -u * 1.9, u * 0.75, u * 2.4, 0, 0, Math.PI * 2);
							ctx.fill();
						} else {
							ctx.fillStyle = 'rgba(255,140,170,0.75)';
							ctx.beginPath();
							ctx.ellipse(0, -u * 2.0, u * 0.36, u * 1.7, 0, 0, Math.PI * 2);
							ctx.fill();
						}
					});
					break;
			}
		}

		ctx.restore();
	}

	// How far (radians) round from the crown a look sits: for
	// the shots script's checks.
	function offTop(b) {
		const p = spotFor(b.body, 0);
		const up = -Math.PI / 2 + Math.max(-LEAN, Math.min(LEAN, b.body.angle));
		const c = b.body.centroid();
		const d = Math.atan2(p.y - c.y, p.x - c.x) - up;
		return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
	}

	root.BlaubeLooks = { LOOKS, pickLook, lookOrder, stepLook, drawLook, offTop };
})(globalThis);
