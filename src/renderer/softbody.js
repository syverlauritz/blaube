// Blaube's body: a ring of Verlet point masses held together by soft
// constraints (edge springs, bending, gas pressure, shape matching),
// colliding with the screen edges and rectangular obstacles like the Dock. Plain script so it loads in the renderer with a
// <script> tag and in Node tests with require().
(function (root) {
  'use strict';

  const DEFAULTS = {
    points: 28,
    radius: 56,
    gravity: 2400, // px/s^2
    damping: 0.996, // per substep velocity retention
    iterations: 6,
    edgeStiffness: 0.3,
    pressure: 0.6,
    bending: 0.05, // pulls each point toward its neighbours' midpoint, smoothing out wrinkles
    shapeStiffness: 0.01,
    fullness: 0.8, // target area vs a full circle; < 1 leaves the skin slack so it sags
    upright: 0.03, // how hard the rest shape leans back to upright (a soft torque)
    bounce: 0.3, // restitution against walls
    friction: 0.3, // tangential loss on contact
    maxSpeed: 4500, // px/s, keeps a wild toss from exploding the body
    grabSpring: 700, // 1/s^2: the cursor pulls the grabbed spot through a spring
    grabDamping: 14, // 1/s, relative to the cursor's own motion
    grabRadius: 0.6, // how much skin around the grabbed spot the spring acts on, in radii
    grabGravity: 1, // gravity multiplier while held
  };

  // Area of a regular n-gon with circumradius r.
  const polyArea = (n, r) => 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);

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
      this.restArea = polyArea(n, r) * this.o.fullness;
      this.areaScale = 1; // modulated for breathing
      this.bounds = { left: 0, top: 0, right: 1e9, bottom: 1e9 };
      this.obstacles = []; // [{ x0, y0, x1, y1 }] solid rectangles
      this.ledges = []; // [{ x0, x1, y }] tops of windows: land on them from above
      this.onLedge = null; // the ledge it's standing on, if any
      this.grab = null;
      this.angle = 0;
      this.lastImpact = 0; // strongest wall hit speed in the last step, px/s
      this.contact = { left: false, right: false, top: false, bottom: false };
    }

    setBounds(left, top, right, bottom) {
      this.bounds = { left, top, right, bottom };
    }

    setLedges(list) {
      this.ledges = list || [];
    }

    setObstacles(rects) {
      this.obstacles = rects || [];
    }

    // Live-updates tuning parameters. Radius and point count are handled
    // by setRadius and by rebuilding the body.
    configure(opts) {
      for (const k of Object.keys(DEFAULTS)) {
        if (k === 'radius' || k === 'points' || !(k in opts)) continue;
        this.o[k] = opts[k];
      }
      this.restArea = polyArea(this.n, this.o.radius) * this.o.fullness;
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

    // Moves the whole body by (dx, dy), keeping its velocity.
    shift(dx, dy) {
      shift(this, dx, dy);
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

    // Sets it turning: adds a spin of omega (radians/s) about its middle.
    spin(omega, dt) {
      const c = this.centroid();
      for (let i = 0; i < this.n; i++) {
        this.ox[i] += (this.py[i] - c.y) * omega * dt;
        this.oy[i] -= (this.px[i] - c.x) * omega * dt;
      }
    }

    // How fast it's turning (radians/s), from how its skin is moving round
    // its middle.
    angularVelocity(dt) {
      const c = this.centroid();
      let num = 0, den = 0;
      for (let i = 0; i < this.n; i++) {
        const qx = this.px[i] - c.x, qy = this.py[i] - c.y;
        const vx = (this.px[i] - this.ox[i]) / dt, vy = (this.py[i] - this.oy[i]) / dt;
        num += qx * vy - qy * vx;
        den += qx * qx + qy * qy;
      }
      return den ? num / den : 0;
    }

    // Adds a velocity (px/s) to the skin around (x, y), fading out over
    // 'spread' px: a poke, a dent, a nudge in one place.
    pushAt(x, y, vx, vy, spread, dt) {
      const s2 = spread * spread;
      for (let i = 0; i < this.n; i++) {
        const ex = this.px[i] - x, ey = this.py[i] - y;
        const w = Math.exp(-(ex * ex + ey * ey) / s2);
        this.ox[i] -= vx * w * dt;
        this.oy[i] -= vy * w * dt;
      }
    }

    // Leans the body over: the top goes one way and the bottom the other,
    // while the side it leans toward lifts and the far side dips. That's a
    // pure shear, with no spin in it, so it leans (or kicks, held by its
    // top) instead of rolling away, and the body as a whole stays put.
    lean(vx, dt) {
      const c = this.centroid(), r = this.o.radius;
      for (let i = 0; i < this.n; i++) {
        this.ox[i] -= vx * ((c.y - this.py[i]) / r) * dt;
        this.oy[i] += vx * ((this.px[i] - c.x) / r) * dt;
      }
    }

    // Pushes the upper half of the body down (vy > 0) or up (vy < 0), more
    // the higher the point: a crouch, or a stretch up onto tiptoes.
    squashTop(vy, dt) {
      const c = this.centroid(), r = this.o.radius;
      for (let i = 0; i < this.n; i++) {
        const h = (c.y - this.py[i]) / r;
        if (h > 0) this.oy[i] -= vy * h * dt;
      }
    }

    // Pulls the body toward a shape 'ratio' times longer along (ux, uy)
    // than across it: a spring on its proportions, so it stretches out in
    // flight and the skin and pressure do the rest. Adds no net speed.
    stretchToward(ux, uy, ratio, k, dt) {
      const c = this.centroid();
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = 0; i < this.n; i++) {
        const dx = this.px[i] - c.x, dy = this.py[i] - c.y;
        const a = dx * ux + dy * uy, b = dy * ux - dx * uy;
        if (a < a0) a0 = a; if (a > a1) a1 = a;
        if (b < b0) b0 = b; if (b > b1) b1 = b;
      }
      const err = Math.max(-0.5, Math.min(0.5, ratio - (a1 - a0) / Math.max(1, b1 - b0)));
      for (let i = 0; i < this.n; i++) {
        const dx = this.px[i] - c.x, dy = this.py[i] - c.y;
        const a = (dx * ux + dy * uy) * err * k, b = (dy * ux - dx * uy) * -err * k * 0.5;
        this.ox[i] -= (a * ux - b * uy) * dt * dt;
        this.oy[i] -= (a * uy + b * ux) * dt * dt;
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
      this.restArea = polyArea(this.n, r) * this.o.fullness;
    }

    // Reshapes the rest shape partway (t from 0 to 1) from its circle toward
    // a heart. Shape matching then pulls the skin over toward it, pressure
    // keeping it plump; t = 0 is a plain circle again.
    morph(t) {
      const n = this.n, r = this.o.radius;
      if (!this.heart || this.heart.r !== r) {
        // Points on the classic heart curve, one per vertex in the same order
        // (from the top, clockwise on screen), centred and scaled to keep
        // about the same area.
        const hx = new Float64Array(n), hy = new Float64Array(n);
        let mx = 0, my = 0;
        for (let i = 0; i < n; i++) {
          const u = (i / n) * Math.PI * 2 + Math.PI / 2;
          hx[i] = 16 * Math.pow(Math.sin(u), 3);
          hy[i] = -(13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u));
          mx += hx[i] / n; my += hy[i] / n;
        }
        let area = 0, perim = 0;
        for (let i = 0; i < n; i++) { hx[i] -= mx; hy[i] -= my; }
        for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += hx[i] * hy[j] - hx[j] * hy[i]; perim += Math.hypot(hx[j] - hx[i], hy[j] - hy[i]); }
        const k = Math.sqrt(polyArea(n, r) / Math.abs(area / 2));
        for (let i = 0; i < n; i++) { hx[i] *= k; hy[i] *= k; }
        this.heart = { r, hx, hy, edge: (perim * k) / n };
      }
      const h = this.heart, circle = 2 * r * Math.sin(Math.PI / n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.rx[i] = Math.cos(a) * r * (1 - t) + h.hx[i] * t;
        this.ry[i] = Math.sin(a) * r * (1 - t) + h.hy[i] * t;
      }
      this.restEdge = circle * (1 - t) + h.edge * t;
    }

    // Grabs the body at (x, y). The grabbed spot is remembered in the body's
    // own frame, and a damped spring pulls it toward the cursor: the force is
    // spread over the skin near that spot, so the rest dangles and swings.
    startGrab(x, y) {
      const n = this.n;
      const sigma = this.o.radius * this.o.grabRadius;
      const w = new Float64Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const ex = this.px[i] - x, ey = this.py[i] - y;
        w[i] = Math.exp(-(ex * ex + ey * ey) / (sigma * sigma)) + 0.02;
        sum += w[i];
      }
      for (let i = 0; i < n; i++) w[i] /= sum;
      const a = this.anchorFrame(w);
      this.grab = { x, y, w, lx: x - a.x, ly: y - a.y, angle: this.angle, vx: 0, vy: 0, px: x, py: y };
    }

    moveGrab(x, y) {
      if (this.grab) { this.grab.x = x; this.grab.y = y; }
    }

    endGrab() {
      this.grab = null;
    }

    // Weighted centre and velocity (per step) of the grabbed region.
    anchorFrame(w) {
      let x = 0, y = 0, vx = 0, vy = 0;
      for (let i = 0; i < this.n; i++) {
        x += this.px[i] * w[i]; y += this.py[i] * w[i];
        vx += (this.px[i] - this.ox[i]) * w[i]; vy += (this.py[i] - this.oy[i]) * w[i];
      }
      return { x, y, vx, vy };
    }

    // Where the grabbed spot is now, in screen space.
    grabAnchor() {
      const g = this.grab;
      if (!g) return null;
      const a = this.anchorFrame(g.w);
      const t = this.angle - g.angle, c = Math.cos(t), s = Math.sin(t);
      return { x: a.x + g.lx * c - g.ly * s, y: a.y + g.lx * s + g.ly * c, vx: a.vx, vy: a.vy };
    }

    // Adds the grab spring's velocity change (per step) to each point.
    applyGrab(dt) {
      const g = this.grab, o = this.o, n = this.n;
      // Cursor velocity, smoothed: mouse events arrive once a frame, not every step.
      g.vx += ((g.x - g.px) / dt - g.vx) * 0.25;
      g.vy += ((g.y - g.py) / dt - g.vy) * 0.25;
      g.px = g.x; g.py = g.y;
      const a = this.grabAnchor();
      const ax = o.grabSpring * (g.x - a.x) - o.grabDamping * (a.vx / dt - g.vx);
      const ay = o.grabSpring * (g.y - a.y) - o.grabDamping * (a.vy / dt - g.vy);
      // Total force acts on the whole body's mass, concentrated near the
      // grabbed spot; capped per point so stiff springs stay stable.
      const cap = 0.45 / (o.grabSpring * dt * dt + 1e-9);
      for (let i = 0; i < n; i++) {
        const share = Math.min(cap, g.w[i] * n);
        this.ox[i] -= ax * share * dt * dt;
        this.oy[i] -= ay * share * dt * dt;
      }
    }

    step(dt) {
      const o = this.o, n = this.n;
      const g = o.gravity * dt * dt * (this.grab ? o.grabGravity : 1);
      const vmax = o.maxSpeed * dt;
      if (this.grab) this.applyGrab(dt);
      for (let i = 0; i < n; i++) {
        let vx = (this.px[i] - this.ox[i]) * o.damping;
        let vy = (this.py[i] - this.oy[i]) * o.damping;
        const s = Math.hypot(vx, vy);
        if (s > vmax) { vx *= vmax / s; vy *= vmax / s; }
        this.ox[i] = this.px[i];
        this.oy[i] = this.py[i];
        this.px[i] += vx;
        this.py[i] += vy + g;
      }

      if (this.shoving > 0) this.shoving--;
      this.onLedge = null;
      this.lastImpact = 0;
      this.contact.left = this.contact.right = this.contact.top = this.contact.bottom = false;
      for (let k = 0; k < o.iterations; k++) {
        this.solveEdges();
        this.solveBending();
        this.solvePressure();
        this.solveShape();
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
      const { n, px, py, ox, oy, rx, ry } = this;
      const c = this.centroid();
      let dot = 0, cross = 0;
      for (let i = 0; i < n; i++) {
        const qx = px[i] - c.x, qy = py[i] - c.y;
        dot += rx[i] * qx + ry[i] * qy;
        cross += rx[i] * qy - ry[i] * qx;
      }
      this.angle = Math.atan2(cross, dot);
      // Aim slightly closer to upright than the current pose, so Blaube
      // rolls but rights itself like a weighted toy. Held, it rights itself
      // harder, so it dangles face-up instead of lying on its side.
      const goal = this.angle * (1 - this.o.upright * (this.grab ? 4 : 1));
      const cs = Math.cos(goal), sn = Math.sin(goal);
      const s = this.o.shapeStiffness;
      for (let i = 0; i < n; i++) {
        const gx = c.x + rx[i] * cs - ry[i] * sn;
        const gy = c.y + rx[i] * sn + ry[i] * cs;
        px[i] += (gx - px[i]) * s;
        py[i] += (gy - py[i]) * s;
      }
      // Held: turn the whole body back toward upright a little every step,
      // so it leans with the drag but can't swing round like a pendulum.
      // Both the points and their previous positions turn together, so this
      // only re-orients the body and adds no speed (turning the points alone
      // pumped energy in every step and made held slimes shake).
      if (this.grab && Math.abs(this.angle) > 0.12) {
        const turn = -(this.angle - Math.sign(this.angle) * 0.12) * 0.03;
        const tc = Math.cos(turn), ts = Math.sin(turn);
        for (let i = 0; i < n; i++) {
          const qx = px[i] - c.x, qy = py[i] - c.y;
          px[i] = c.x + qx * tc - qy * ts;
          py[i] = c.y + qx * ts + qy * tc;
          const ux = ox[i] - c.x, uy = oy[i] - c.y;
          ox[i] = c.x + ux * tc - uy * ts;
          oy[i] = c.y + ux * ts + uy * tc;
        }
      }
    }

    collide(dt, first) {
      const { n, px, py } = this;
      const b = this.bounds;
      if (this.ledges.length && !this.grab) this.landOnLedges(dt, first);
      for (let i = 0; i < n; i++) {
        if (py[i] > b.bottom) this.hit(i, 'y', b.bottom, first, dt), (this.contact.bottom = true);
        else if (py[i] < b.top) this.hit(i, 'y', b.top, first, dt), (this.contact.top = true);
        if (px[i] > b.right) this.hit(i, 'x', b.right, first, dt), (this.contact.right = true);
        else if (px[i] < b.left) this.hit(i, 'x', b.left, first, dt), (this.contact.left = true);
        for (const r of this.obstacles) {
          const x = px[i], y = py[i];
          if (x <= r.x0 || x >= r.x1 || y <= r.y0 || y >= r.y1) continue;
          // Push out through the nearest side of the rectangle.
          const dl = x - r.x0, dr = r.x1 - x, dt2 = y - r.y0, db = r.y1 - y;
          const m = Math.min(dl, dr, dt2, db);
          if (m === dt2) this.hit(i, 'y', r.y0, first, dt), (this.contact.bottom = true);
          else if (m === db) this.hit(i, 'y', r.y1, first, dt), (this.contact.top = true);
          else if (m === dl) this.hit(i, 'x', r.x0, first, dt), (this.contact.right = true);
          else this.hit(i, 'x', r.x1, first, dt), (this.contact.left = true);
        }
      }
    }

    // Window tops only hold a body that comes down onto them from above:
    // going up, or standing in front of the window, it passes through. They
    // give a little, so landing is soft.
    landOnLedges(dt, first) {
      const { n, px, py } = this;
      let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        if (px[i] < minX) minX = px[i];
        if (px[i] > maxX) maxX = px[i];
        if (py[i] > maxY) maxY = py[i];
      }
      const depth = this.o.radius * 0.5;
      for (const l of this.ledges) {
        // Resting a hair above it still counts as standing on it.
        if (maxX < l.x0 || minX > l.x1 || maxY <= l.y - 2 || maxY > l.y + depth) continue;
        let held = false;
        for (let i = 0; i < n; i++) {
          const d = py[i] - l.y;
          if (d <= -2 || px[i] < l.x0 || px[i] > l.x1) continue;
          held = true;
          if (d > 0) this.hit(i, 'y', l.y + d * 0.35, first, dt);
        }
        if (held) { this.contact.bottom = true; this.onLedge = l; }
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

    // Resting on something: the screen bottom or the top of an obstacle.
    onFloor() {
      return this.contact.bottom;
    }
  }

  // Pushes the skin of two bodies apart where they overlap. Each point of
  // one body that ended up inside the other is moved halfway out to the
  // nearest edge, and that edge takes the other half, so both squish.
  function collideBodies(a, b) {
    const ba = a.bbox(), bb = b.bbox();
    if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return false;
    // Deep overlap (one centre inside the other): per-point pushing would
    // tear the inner body across the outer one, so slide them apart first.
    const ca = a.centroid(), cb = b.centroid();
    if (a.contains(cb.x, cb.y) || b.contains(ca.x, ca.y)) {
      let dx = cb.x - ca.x, dy = cb.y - ca.y;
      let d = Math.hypot(dx, dy);
      if (d < 1e-3) { dx = 1; dy = 0; d = 1; }
      const push = Math.min(6, (a.o.radius + b.o.radius) * 0.04);
      const wa = b.o.radius ** 2 / (a.o.radius ** 2 + b.o.radius ** 2); // lighter body moves more
      shift(a, (-dx / d) * push * wa, (-dy / d) * push * wa);
      shift(b, (dx / d) * push * (1 - wa), (dy / d) * push * (1 - wa));
      return true;
    }
    // A slime you're dragging (or one it is shoving along) pushes the other
    // aside as a whole, so the other keeps its shape instead of getting
    // dented. Pressing straight down on it still squishes it.
    const pa = !!a.grab || a.shoving > 0, pb = !!b.grab || b.shoving > 0;
    if (pa !== pb) {
      const r = pa ? shove(a, b) : shove(b, a);
      if (r !== null) return r;
    }
    // Otherwise most of the overlap is taken out by moving both bodies
    // apart whole (the lighter one more), and only the rest by denting:
    // squeezed between two others, a slime slides out instead of being
    // pinched into a wedge.
    const d = deepest(a, b);
    if (d) {
      const wa = b.o.radius ** 2 / (a.o.radius ** 2 + b.o.radius ** 2);
      shift(a, -d.x * 0.6 * wa, -d.y * 0.6 * wa);
      shift(b, d.x * 0.6 * (1 - wa), d.y * 0.6 * (1 - wa));
    }
    const hitA = pushOut(a, b);
    const hitB = pushOut(b, a);
    return hitA || hitB;
  }

  // The deepest overlap of two bodies, as the move that would take b out
  // of a; null when they don't overlap.
  function deepest(a, b) {
    let mx = 0, my = 0, deep = 0;
    for (let i = 0; i < b.n; i++) {
      if (!a.contains(b.px[i], b.py[i])) continue;
      const q = nearestEdge(a, b.px[i], b.py[i]);
      const dx = q.x - b.px[i], dy = q.y - b.py[i], dd = dx * dx + dy * dy;
      if (dd > deep) { deep = dd; mx = dx; my = dy; }
    }
    for (let i = 0; i < a.n; i++) {
      if (!b.contains(a.px[i], a.py[i])) continue;
      const q = nearestEdge(b, a.px[i], a.py[i]);
      const dx = a.px[i] - q.x, dy = a.py[i] - q.y, dd = dx * dx + dy * dy;
      if (dd > deep) { deep = dd; mx = dx; my = dy; }
    }
    return deep ? { x: mx, y: my } : null;
  }

  // The closest point on body b's skin to (x, y).
  function nearestEdge(b, x, y) {
    let best = Infinity, cx = x, cy = y;
    for (let j = 0; j < b.n; j++) {
      const k = (j + 1) % b.n;
      const ex = b.px[k] - b.px[j], ey = b.py[k] - b.py[j];
      const len2 = ex * ex + ey * ey || 1e-6;
      let t = ((x - b.px[j]) * ex + (y - b.py[j]) * ey) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = b.px[j] + ex * t, qy = b.py[j] + ey * t;
      const d = (qx - x) * (qx - x) + (qy - y) * (qy - y);
      if (d < best) { best = d; cx = qx; cy = qy; }
    }
    return { x: cx, y: cy };
  }

  // Moves body o out of the pusher p in one piece, by the deepest overlap.
  // If a wall is in the way, o squeezes out upwards instead, like a
  // pip pressed between two fingers. Returns null to fall back to normal
  // squishing (pressed down onto the floor).
  function shove(p, o) {
    const d = deepest(p, o);
    if (!d) return false;
    let mx = d.x, my = d.y;
    if (my > Math.abs(mx) && o.onFloor()) return null;
    // Up against (or nearly at) the edge it's being pushed toward: squeeze out.
    const box = o.bbox(), near = o.o.radius * 0.15;
    if ((mx > 0 && (o.contact.right || box.maxX > o.bounds.right - near)) || (mx < 0 && (o.contact.left || box.minX < o.bounds.left + near))) { my -= Math.abs(mx) * 3; mx = 0; }
    // Mostly a move, partly a push: it keeps some of the speed and slides on.
    for (let i = 0; i < o.n; i++) {
      o.px[i] += mx; o.py[i] += my;
      o.ox[i] += mx * 0.6; o.oy[i] += my * 0.6;
    }
    o.shoving = 3;
    return true;
  }

  // Moves a body's points without changing its velocity.
  function shift(body, dx, dy) {
    for (let i = 0; i < body.n; i++) {
      body.px[i] += dx; body.ox[i] += dx;
      body.py[i] += dy; body.oy[i] += dy;
    }
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
