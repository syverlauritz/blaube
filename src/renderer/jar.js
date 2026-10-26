// Drawing the snack jar (your usage limits, see shared/snack.js and the
// jar in renderer.js): a small glass cookie jar with a lid, cookies piled
// inside up to how much is left, crumbs when it's empty. Flat like
// everything else: no outlines, no glow; the glass is a pale see-through
// fill with one flat shine down its side.
(function (root) {
	'use strict';

	const GLASS = 'rgba(206, 228, 242, 0.34)', GLASS_RIM = 'rgba(206, 228, 242, 0.62)', SHINE = 'rgba(255, 255, 255, 0.5)';
	const LID = '#5B8DEF', COOKIE = '#DDA35F', CHIP = '#6E4026';

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
	function shape(w, h) {
		const bodyH = h * 0.8, neckW = w * 0.7, neckH = h * 0.07, lidW = w * 0.82, lidH = h * 0.1;
		return { w, h, bodyH, neckW, neckH, lidW, lidH, cr: w * 0.165, top: -bodyH - neckH };
	}

	// Where the cookies sit, bottom row first: rows of three and two, a
	// little overlapped, up to the shoulder.
	const spotsFor = new Map();
	function spots(w, h) {
		const key = `${Math.round(w)}x${Math.round(h)}`;
		if (spotsFor.has(key)) return spotsFor.get(key);
		const s = shape(w, h), out = [], step = s.cr * 1.55;
		for (let row = 0, y = -s.cr * 1.15; y > -s.bodyH + s.cr * 0.6; row++, y -= s.cr * 1.25) {
			const n = row % 2 ? 2 : 3;
			for (let i = 0; i < n; i++) out.push({ x: (i - (n - 1) / 2) * step + (row % 4 === 1 ? -s.cr * 0.08 : row % 4 === 3 ? s.cr * 0.08 : 0), y, a: ((row * 7 + i * 3) % 10) / 10 * Math.PI * 2 });
		}
		spotsFor.set(key, out);
		return out;
	}

	// A cookie: a golden round with three chips.
	function drawCookie(ctx, x, y, r, a) {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(a || 0);
		ctx.fillStyle = COOKIE;
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

	// j: { x, y (its bottom middle), w, h, angle (a wobble, rocking on its
	// bottom), level 0..1 (how much is left; null: unknown, drawn full), lid
	// (0 shut .. 1 popped right up), rattle 0..1, t (seconds, for the
	// rattle) }.
	function drawJar(ctx, j) {
		const s = shape(j.w, j.h);
		const x0 = -s.w / 2, bodyTop = -s.bodyH;
		ctx.save();
		ctx.translate(j.x, j.y);
		ctx.rotate(j.angle || 0);
		// The glass, at the back.
		ctx.fillStyle = GLASS;
		roundRect(ctx, x0, bodyTop, s.w, s.bodyH, s.w * 0.3);
		ctx.fill();
		// What's inside, clipped to the glass.
		ctx.save();
		roundRect(ctx, x0 + s.w * 0.05, bodyTop + s.h * 0.03, s.w * 0.9, s.bodyH - s.h * 0.06, s.w * 0.26);
		ctx.clip();
		const all = spots(s.w, s.h), level = j.level == null ? 1 : Math.max(0, Math.min(1, j.level));
		const n = level * all.length;
		for (let i = 0; i < all.length && i < n - 0.1; i++) {
			const p = all[i], part = Math.min(1, n - i); // (the top one grows in and out as the level eases)
			const jig = (j.rattle || 0) * s.cr * 0.18;
			drawCookie(ctx, p.x + Math.sin((j.t || 0) * 37 + i * 1.7) * jig, p.y + Math.cos((j.t || 0) * 41 + i * 2.3) * jig, s.cr * (0.4 + 0.6 * part), p.a + (j.rattle || 0) * Math.sin((j.t || 0) * 23 + i));
		}
		// Empty: just crumbs on the bottom.
		if (n < 1) for (const [cx, k] of [[-0.24, 0.05], [-0.06, 0.035], [0.12, 0.05], [0.27, 0.03], [0.02, 0.025]]) drawCrumb(ctx, cx * s.w, -s.h * 0.055 - k * s.w * 0.4, k * s.w, 1 - n);
		ctx.restore();
		// The shine down its left side, and the neck.
		ctx.fillStyle = SHINE;
		roundRect(ctx, x0 + s.w * 0.12, bodyTop + s.bodyH * 0.16, s.w * 0.08, s.bodyH * 0.5, s.w * 0.04);
		ctx.fill();
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

	// Where a cookie leaves the jar: just over its opening.
	const mouthOf = (j) => ({ x: j.x, y: j.y + shape(j.w, j.h).top - j.h * 0.04 });

	root.BlaubeJar = { drawJar, drawCookie, drawCrumb, mouthOf, shape };
})(globalThis);
