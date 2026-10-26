// Drawing the snack jar (your usage limits, see shared/snack.js and the
// jar in renderer.js): a small glass cookie jar with a lid, a pile of
// cookies inside you can count (twenty when full, one fewer for each 5%
// used), crumbs when it's empty. Flat like everything else: no outlines, no
// glow, no shine; the glass is a pale see-through fill.
(function (root) {
	'use strict';

	const GLASS = 'rgba(206, 228, 242, 0.34)', GLASS_RIM = 'rgba(206, 228, 242, 0.62)';
	const LID = '#5B8DEF', COOKIE = '#DDA35F', CHIP = '#6E4026';
	// Each cookie a touch lighter or darker than the next, so a pile reads as
	// so many cookies and not one lump.
	const TONES = ['#DDA35F', '#D39752', '#E4AE6C'];
	const CAP = 20;

	function roundRect(ctx, x, y, w, h, r) {
		r = Math.min(r, w / 2, h / 2);
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	// The jar's parts, for a jar h tall (w wide), its bottom middle at 0, 0.
	// in: the inside of the glass (what the cookies are clipped to).
	function shape(w, h) {
		const bodyH = h * 0.8, neckW = w * 0.7, neckH = h * 0.07, lidW = w * 0.82, lidH = h * 0.1;
		const inside = { x: -w * 0.45, y: -bodyH + h * 0.03, w: w * 0.9, h: bodyH - h * 0.06, r: w * 0.26 };
		return { w, h, bodyH, neckW, neckH, lidW, lidH, cr: w * 0.165, top: -bodyH - neckH, inside };
	}

	// Where the cookies sit, bottom first: each dropped in where it comes to
	// rest lowest, on the glass's rounded bottom or on the ones below, so
	// they settle into a pile. Sized so a full jar's twenty fit below the
	// shoulder. { r, at: [{ x, y, a, tone }] } (in jar space, y up negative).
	const pileFor = new Map();
	function pile(w, h) {
		const key = `${Math.round(w)}x${Math.round(h)}`;
		if (pileFor.has(key)) return pileFor.get(key);
		const s = shape(w, h), inn = s.inside;
		const bottom = -(inn.y + inn.h); // (the inside's floor, as a height above the jar's bottom)
		const ceiling = -inn.y - h * 0.02;
		let r = w * 0.115, at = [];
		for (let tries = 0; tries < 30; tries++, r *= 0.96) {
			at = drop(r, inn.w / 2, inn.r, bottom, CAP);
			if (at.length === CAP && at.every((p) => p.u + r <= ceiling)) break;
		}
		const out = { r, at: at.map((p, i) => ({ x: p.x, y: -p.u, a: ((i * 7) % 10) / 10 * Math.PI * 2, tone: TONES[(i * 2 + (i >> 2)) % TONES.length] })) };
		pileFor.set(key, out);
		return out;
	}
	// n cookies of radius r into a box half as wide as hw with rounded bottom
	// corners (radius rc), its floor at height floor. A small gap between
	// them, so each one shows.
	function drop(r, hw, rc, floor, n) {
		const gap = r * 2.1, out = [];
		const cw = hw - r, cr = Math.max(0, rc - r); // (where a cookie's middle can be)
		const lowest = (x) => {
			const d = Math.abs(x) - (cw - cr);
			return floor + r + (d > 0 ? cr - Math.sqrt(Math.max(0, cr * cr - d * d)) : 0);
		};
		const STEPS = 48;
		for (let k = 0; k < n; k++) {
			let best = null;
			for (let i = 0; i <= STEPS; i++) {
				const x = -cw + (2 * cw * i) / STEPS;
				let u = lowest(x);
				for (const p of out) {
					const dx = Math.abs(x - p.x);
					if (dx < gap) u = Math.max(u, p.u + Math.sqrt(gap * gap - dx * dx));
				}
				// (lowest wins; between equals, nearer the middle, a little to
				// one side or the other by turns)
				const score = u + Math.abs(x + (k % 2 ? 0.2 : -0.2) * r) * 0.01;
				if (!best || score < best.score - 1e-6) best = { x, u, score };
			}
			out.push({ x: best.x, u: best.u });
		}
		return out;
	}

	// A cookie: a golden round with a few chips.
	function drawCookie(ctx, x, y, r, a, tone) {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(a || 0);
		ctx.fillStyle = tone || COOKIE;
		ctx.beginPath();
		ctx.arc(0, 0, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = CHIP;
		for (const [cx, cy, k] of [[-0.38, -0.22, 0.2], [0.32, -0.3, 0.16], [0.05, 0.36, 0.18], [0.42, 0.25, 0.12]]) {
			ctx.beginPath();
			ctx.arc(cx * r, cy * r, k * r, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}

	function drawCrumb(ctx, x, y, r, alpha) {
		ctx.save();
		ctx.globalAlpha *= alpha;
		ctx.fillStyle = COOKIE;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	const jig = (j, i) => {
		const k = (j.rattle || 0) * pile(j.w, j.h).r * 0.25, t = j.t || 0;
		return { dx: Math.sin(t * 37 + i * 1.7) * k, dy: Math.cos(t * 41 + i * 2.3) * k, da: (j.rattle || 0) * Math.sin(t * 23 + i) };
	};

	// j: { x, y (its bottom middle), w, h, angle (a wobble, rocking on its
	// bottom), count (cookies in it, 0..20; or level 0..1, null: unknown,
	// drawn full), lid (0 shut .. 1 popped right up), rattle 0..1, t
	// (seconds, for the rattle) }.
	function drawJar(ctx, j) {
		const s = shape(j.w, j.h), inn = s.inside;
		const x0 = -s.w / 2, bodyTop = -s.bodyH;
		const n = countOf(j);
		ctx.save();
		ctx.translate(j.x, j.y);
		ctx.rotate(j.angle || 0);
		// The glass, at the back.
		ctx.fillStyle = GLASS;
		roundRect(ctx, x0, bodyTop, s.w, s.bodyH, s.w * 0.3);
		ctx.fill();
		// What's inside, clipped to the glass.
		ctx.save();
		roundRect(ctx, inn.x, inn.y, inn.w, inn.h, inn.r);
		ctx.clip();
		const p = pile(s.w, s.h);
		for (let i = 0; i < n; i++) {
			const c = p.at[i], g = jig(j, i);
			drawCookie(ctx, c.x + g.dx, c.y + g.dy, p.r, c.a + g.da, c.tone);
		}
		// Empty: just crumbs on the bottom.
		if (n < 1) for (const [cx, k] of [[-0.24, 0.05], [-0.06, 0.035], [0.12, 0.05], [0.27, 0.03], [0.02, 0.025]]) drawCrumb(ctx, cx * s.w, -s.h * 0.055 - k * s.w * 0.4, k * s.w, 1);
		ctx.restore();
		// The neck.
		ctx.fillStyle = GLASS_RIM;
		roundRect(ctx, -s.neckW / 2, bodyTop - s.neckH, s.neckW, s.neckH + s.h * 0.02, s.neckH * 0.4);
		ctx.fill();
		// The lid, popping up and tipping back on its hinge side.
		const lid = Math.max(0, j.lid || 0);
		ctx.translate(s.lidW / 2, s.top - lid * s.h * 0.28);
		ctx.rotate(lid * 0.55);
		ctx.fillStyle = LID;
		roundRect(ctx, -s.lidW, -s.lidH, s.lidW, s.lidH, s.lidH * 0.45);
		ctx.fill();
		ctx.beginPath();
		ctx.arc(-s.lidW / 2, -s.lidH - s.w * 0.05, s.w * 0.085, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}
	function countOf(j) {
		if (Number.isFinite(j.count)) return Math.max(0, Math.min(CAP, Math.round(j.count)));
		return j.level == null ? CAP : Math.max(0, Math.min(CAP, Math.round(j.level * CAP)));
	}

	// Where a cookie leaves the jar: just over its opening.
	const mouthOf = (j) => ({ x: j.x, y: j.y + shape(j.w, j.h).top - j.h * 0.04 });

	// Where cookie i of the pile is on the screen (the jar tilted as it is),
	// and how big: { x, y, r, a, tone }. The top one (count - 1) is the one
	// that leaves next, and a cookie tumbling in lands at the next free one.
	function cookieAt(j, i) {
		const p = pile(j.w, j.h), c = p.at[Math.max(0, Math.min(CAP - 1, i))], a = j.angle || 0;
		const cos = Math.cos(a), sin = Math.sin(a);
		return { x: j.x + c.x * cos - c.y * sin, y: j.y + c.x * sin + c.y * cos, r: p.r, a: c.a + a, tone: c.tone };
	}

	root.BlaubeJar = { drawJar, drawCookie, drawCrumb, mouthOf, cookieAt, shape, pile, CAP };
})(globalThis);
