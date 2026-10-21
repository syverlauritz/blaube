// Blaube's body: a ring of Verlet point masses held together by three soft
// constraints (edge springs, gas pressure, and shape matching), colliding
// with the screen edges. Plain script so it loads in the renderer with a
// <script> tag and in Node tests with require().
(function (root) {
  'use strict';

  const DEFAULTS = {
    points: 28,
    radius: 56,
    gravity: 2200, // px/s^2
    damping: 0.995, // per substep velocity retention
    iterations: 6,
    edgeStiffness: 0.5,
    pressure: 0.8,
    bending: 0.08, // pulls each point toward its neighbours' midpoint, smoothing out wrinkles
    shapeStiffness: 0.02,
    fullness: 0.9,
    upright: 0.04, // how hard the rest shape leans back to upright (a soft torque)
    bounce: 0.45, // restitution against walls
    friction: 0.18, // tangential loss on contact
    maxSpeed: 4200, // px/s, keeps a wild toss from exploding the body
    grabStiffness: 0.35,
    grabFalloff: 0.9, // grab influence radius, in body radii
  };

  class SoftBody {
    constructor(x, y, opts = {}) {
      this.o = Object.assign({}, DEFAULTS, opts);
      const { points: n, radius: r } = this.o;
      this.n = n;
      this.px = new Float64Array(n);
      this.py = new Float64Array(n);
      this.ox = new Float64Array(n); // previous positions
      this.oy = new Float64Array(n);
      this.rx = new Float64Array(n); // rest shape, relative to centroid
      this.ry = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.rx[i] = Math.cos(a) * r;
        this.ry[i] = Math.sin(a) * r;
        this.px[i] = this.ox[i] = x + this.rx[i];
        this.py[i] = this.oy[i] = y + this.ry[i];
      }
      this.restEdge = 2 * r * Math.sin(Math.PI / n);
      this.restArea = this.area() * this.o.fullness; // < 1 leaves the skin a bit slack so it sags
      this.areaScale = 1; // modulated for breathing
      this.bounds = { left: 0, top: 0, right: 1e9, bottom: 1e9 };
      this.grab = null;
      this.angle = 0;
      this.lastImpact = 0; // strongest wall hit speed in the last step, px/s
      this.contact = { left: false, right: false, top: false, bottom: false };
    }

    setBounds(left, top, right, bottom) {
      this.bounds = { left, top, right, bottom };
    }

    centroid() {
      let x = 0, y = 0;
      for (let i = 0; i < this.n; i++) { x += this.px[i]; y += this.py[i]; }
      return { x: x / this.n, y: y / this.n };
    }

    velocity(dt) {
      let x = 0, y = 0;
      for (let i = 0; i < this.n; i++) {
        x += this.px[i] - this.ox[i];
        y += this.py[i] - this.oy[i];
      }
      return { x: x / this.n / dt, y: y / this.n / dt };
    }

    area() {
      let a = 0;
      for (let i = 0, j = this.n - 1; i < this.n; j = i++) {
        a += this.px[j] * this.py[i] - this.px[i] * this.py[j];
      }
      return a / 2;
    }

    contains(x, y) {
      let inside = false;
      for (let i = 0, j = this.n - 1; i < this.n; j = i++) {
        const xi = this.px[i], yi = this.py[i], xj = this.px[j], yj = this.py[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }

    // Moves the whole body so its centroid sits at (x, y), keeping its velocity.
    teleport(x, y) {
      const c = this.centroid();
      for (let i = 0; i < this.n; i++) {
        this.px[i] += x - c.x; this.ox[i] += x - c.x;
        this.py[i] += y - c.y; this.oy[i] += y - c.y;
      }
    }

    // Adds a velocity (px/s) to every point.
    impulse(vx, vy, dt) {
      for (let i = 0; i < this.n; i++) {
        this.ox[i] -= vx * dt;
        this.oy[i] -= vy * dt;
      }
    }

    // Grows or shrinks the rest shape. Pressure and shape matching then
    // inflate or deflate the body toward the new size over a few frames.
    setRadius(r) {
      const k = r / this.o.radius;
      if (Math.abs(k - 1) < 1e-4) return;
      for (let i = 0; i < this.n; i++) { this.rx[i] *= k; this.ry[i] *= k; }
      this.o.radius = r;
      this.restEdge *= k;
      this.restArea *= k * k;
    }

    startGrab(x, y) {
      const fall = this.o.radius * this.o.grabFalloff;
      const w = new Float64Array(this.n);
      const dx = new Float64Array(this.n);
      const dy = new Float64Array(this.n);
      let maxW = 0;
      for (let i = 0; i < this.n; i++) {
        const ex = this.px[i] - x, ey = this.py[i] - y;
        w[i] = Math.exp(-(ex * ex + ey * ey) / (fall * fall));
        dx[i] = ex; dy[i] = ey;
        if (w[i] > maxW) maxW = w[i];
      }
      // Always hold on to at least the nearest bit of skin firmly.
      for (let i = 0; i < this.n; i++) w[i] = Math.min(1, w[i] / maxW) * this.o.grabStiffness;
      this.grab = { x, y, w, dx, dy };
    }

    moveGrab(x, y) {
      if (this.grab) { this.grab.x = x; this.grab.y = y; }
    }

    endGrab() {
      this.grab = null;
    }

    step(dt) {
      const o = this.o, n = this.n;
      const g = o.gravity * dt * dt;
      const vmax = o.maxSpeed * dt;
      for (let i = 0; i < n; i++) {
        let vx = (this.px[i] - this.ox[i]) * o.damping;
        let vy = (this.py[i] - this.oy[i]) * o.damping;
        const s = Math.hypot(vx, vy);
        if (s > vmax) { vx *= vmax / s; vy *= vmax / s; }
        this.ox[i] = this.px[i];
        this.oy[i] = this.py[i];
        this.px[i] += vx;
        this.py[i] += vy + (this.grab ? g * 0.25 : g);
      }

      this.lastImpact = 0;
      this.contact.left = this.contact.right = this.contact.top = this.contact.bottom = false;
      for (let k = 0; k < o.iterations; k++) {
        this.solveEdges();
        this.solveBending();
        this.solvePressure();
        this.solveShape();
        if (this.grab) this.solveGrab();
        this.collide(dt, k === 0);
      }
    }

    solveEdges() {
      const { n, px, py } = this;
      const L = this.restEdge, s = this.o.edgeStiffness * 0.5;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = px[j] - px[i], dy = py[j] - py[i];
        const d = Math.hypot(dx, dy) || 1e-6;
        const f = ((d - L) / d) * s;
        px[i] += dx * f; py[i] += dy * f;
        px[j] -= dx * f; py[j] -= dy * f;
      }
    }

    solveBending() {
      const { n, px, py } = this;
      const s = this.o.bending;
      const mx = new Float64Array(n), my = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const a = (i + n - 1) % n, b = (i + 1) % n;
        mx[i] = (px[a] + px[b]) / 2 - px[i];
        my[i] = (py[a] + py[b]) / 2 - py[i];
      }
      // Remove the part every point shares (the pull toward the centre on a
      // circle), so bending smooths kinks without shrinking the body.
      const c = this.centroid();
      const round = (this.restEdge * this.restEdge) / (2 * this.o.radius); // midpoint sag on a circle
      for (let i = 0; i < n; i++) {
        const rx = px[i] - c.x, ry = py[i] - c.y;
        const rl = Math.hypot(rx, ry) || 1;
        const k = round / rl;
        px[i] += (mx[i] + rx * k) * s;
        py[i] += (my[i] + ry * k) * s;
      }
    }

    solvePressure() {
      const { n, px, py } = this;
      let perim = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        perim += Math.hypot(px[j] - px[i], py[j] - py[i]);
      }
      const delta = ((this.restArea * this.areaScale - this.area()) / perim) * this.o.pressure;
      const nx = new Float64Array(n), ny = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const a = (i + n - 1) % n, b = (i + 1) % n;
        // Points wind clockwise on screen (y down), so (dy, -dx) points outward.
        const tx = px[b] - px[a], ty = py[b] - py[a];
        const l = Math.hypot(tx, ty) || 1e-6;
        nx[i] = ty / l; ny[i] = -tx / l;
      }
      for (let i = 0; i < n; i++) { px[i] += nx[i] * delta; py[i] += ny[i] * delta; }
    }

    // Pulls each point toward the rest shape, rotated to best fit the
    // current pose. This is what makes Blaube spring back to round.
    solveShape() {
      const { n, px, py, rx, ry } = this;
      const c = this.centroid();
      let dot = 0, cross = 0;
      for (let i = 0; i < n; i++) {
        const qx = px[i] - c.x, qy = py[i] - c.y;
        dot += rx[i] * qx + ry[i] * qy;
        cross += rx[i] * qy - ry[i] * qx;
      }
      this.angle = Math.atan2(cross, dot);
      // Aim slightly closer to upright than the current pose, unless held,
      // so Blaube rolls but rights itself like a weighted toy.
      const goal = this.grab ? this.angle : this.angle * (1 - this.o.upright);
      const cs = Math.cos(goal), sn = Math.sin(goal);
      const s = this.o.shapeStiffness;
      for (let i = 0; i < n; i++) {
        const gx = c.x + rx[i] * cs - ry[i] * sn;
        const gy = c.y + rx[i] * sn + ry[i] * cs;
        px[i] += (gx - px[i]) * s;
        py[i] += (gy - py[i]) * s;
      }
    }

    solveGrab() {
      const { n, px, py } = this;
      const g = this.grab;
      for (let i = 0; i < n; i++) {
        const w = g.w[i];
        if (w < 0.01) continue;
        px[i] += (g.x + g.dx[i] - px[i]) * w;
        py[i] += (g.y + g.dy[i] - py[i]) * w;
      }
    }

    collide(dt, first) {
      const { n, px, py } = this;
      const b = this.bounds;
      for (let i = 0; i < n; i++) {
        if (py[i] > b.bottom) this.hit(i, 'y', b.bottom, first, dt), (this.contact.bottom = true);
        else if (py[i] < b.top) this.hit(i, 'y', b.top, first, dt), (this.contact.top = true);
        if (px[i] > b.right) this.hit(i, 'x', b.right, first, dt), (this.contact.right = true);
        else if (px[i] < b.left) this.hit(i, 'x', b.left, first, dt), (this.contact.left = true);
      }
    }

    // Puts a point back on the wall, reflects its normal velocity with some
    // bounce, and bleeds off some tangential velocity as friction.
    hit(i, axis, wall, first, dt) {
      const o = this.o;
      const P = axis === 'y' ? this.py : this.px, O = axis === 'y' ? this.oy : this.ox;
      const T = axis === 'y' ? this.px : this.py, OT = axis === 'y' ? this.ox : this.oy;
      const vn = P[i] - O[i];
      if (first) this.lastImpact = Math.max(this.lastImpact, Math.abs(vn) / dt);
      P[i] = wall;
      O[i] = wall + vn * o.bounce;
      const vt = T[i] - OT[i];
      OT[i] = T[i] - vt * (1 - o.friction);
    }

    // Size of the body along its own (rotated) axes, relative to rest.
    // Used to squash the face along with the body.
    stretch() {
      const c = this.centroid();
      const cs = Math.cos(-this.angle), sn = Math.sin(-this.angle);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < this.n; i++) {
        const dx = this.px[i] - c.x, dy = this.py[i] - c.y;
        const x = dx * cs - dy * sn, y = dx * sn + dy * cs;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const d = this.o.radius * 2;
      return { x: (maxX - minX) / d, y: (maxY - minY) / d };
    }

    bbox() {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < this.n; i++) {
        const x = this.px[i], y = this.py[i];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return { minX, maxX, minY, maxY };
    }

    onFloor() {
      const b = this.bounds.bottom;
      for (let i = 0; i < this.n; i++) if (this.py[i] >= b - 1.5) return true;
      return false;
    }
  }

  // Pushes the skin of two bodies apart where they overlap. Each point of
  // one body that ended up inside the other is moved halfway out to the
  // nearest edge, and that edge takes the other half, so both squish.
  function collideBodies(a, b) {
    const ba = a.bbox(), bb = b.bbox();
    if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return false;
    const hitA = pushOut(a, b);
    const hitB = pushOut(b, a);
    return hitA || hitB;
  }

  function pushOut(a, b) {
    let hit = false;
    for (let i = 0; i < a.n; i++) {
      const x = a.px[i], y = a.py[i];
      if (!b.contains(x, y)) continue;
      hit = true;
      let best = Infinity, bj = 0, bt = 0, cx = 0, cy = 0;
      for (let j = 0; j < b.n; j++) {
        const k = (j + 1) % b.n;
        const ex = b.px[k] - b.px[j], ey = b.py[k] - b.py[j];
        const len2 = ex * ex + ey * ey || 1e-6;
        let t = ((x - b.px[j]) * ex + (y - b.py[j]) * ey) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = b.px[j] + ex * t, qy = b.py[j] + ey * t;
        const d = (qx - x) * (qx - x) + (qy - y) * (qy - y);
        if (d < best) { best = d; bj = j; bt = t; cx = qx; cy = qy; }
      }
      const dx = (cx - x) * 0.5, dy = (cy - y) * 0.5;
      a.px[i] += dx; a.py[i] += dy;
      const k = (bj + 1) % b.n;
      b.px[bj] -= dx * (1 - bt); b.py[bj] -= dy * (1 - bt);
      b.px[k] -= dx * bt; b.py[k] -= dy * bt;
    }
    return hit;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { SoftBody, DEFAULTS, collideBodies };
  else { root.SoftBody = SoftBody; root.collideBodies = collideBodies; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
