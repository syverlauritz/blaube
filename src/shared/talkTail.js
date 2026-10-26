// Where the talk box's tail leaves the box: the point of the bubble's
// rounded outline that faces its slime, so the tail slides along the bottom,
// round the corners, up the sides and over the top as the slime is carried
// about. Used by the slime's layer (which draws the tail) and its tests.
// Plain JavaScript, so it runs in both.
(function (root) {
	'use strict';

	// The point of a rounded rectangle's outline nearest p (so the one facing
	// it), the outward normal there, and how far p is outside the outline
	// (`out`, negative when p is inside the bubble).
	function edgeToward(box, p, radius) {
		const R = Math.max(0, Math.min(radius, box.w / 2, box.h / 2));
		const qx = Math.max(box.x + R, Math.min(box.x + box.w - R, p.x));
		const qy = Math.max(box.y + R, Math.min(box.y + box.h - R, p.y));
		const dx = p.x - qx, dy = p.y - qy, d = Math.hypot(dx, dy);
		if (d < 1e-6) {
			// Deep inside: towards the nearest side.
			const sides = [[p.x - box.x, -1, 0], [box.x + box.w - p.x, 1, 0], [p.y - box.y, 0, -1], [box.y + box.h - p.y, 0, 1]];
			const [far, nx, ny] = sides.sort((a, b) => a[0] - b[0])[0];
			return { x: nx ? (nx < 0 ? box.x : box.x + box.w) : p.x, y: ny ? (ny < 0 ? box.y : box.y + box.h) : p.y, nx, ny, out: -far };
		}
		const nx = dx / d, ny = dy / d;
		return { x: qx + nx * R, y: qy + ny * R, nx, ny, out: d - R };
	}

	const api = { edgeToward };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.BlaubeTalkTail = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
