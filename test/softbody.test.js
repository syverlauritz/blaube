const test = require('node:test');
const assert = require('node:assert');
const { SoftBody } = require('../src/renderer/softbody.js');

const DT = 1 / 120;
const run = (b, seconds) => { for (let t = 0; t < seconds; t += DT) b.step(DT); };
const inBounds = (b) => {
  for (let i = 0; i < b.n; i++) {
    if (b.px[i] < b.bounds.left - 0.01 || b.px[i] > b.bounds.right + 0.01) return false;
    if (b.py[i] < b.bounds.top - 0.01 || b.py[i] > b.bounds.bottom + 0.01) return false;
  }
  return true;
};

test('falls, lands, and settles on the floor without losing its shape', () => {
  const b = new SoftBody(400, 100);
  b.setBounds(0, 0, 800, 600);
  run(b, 4);
  assert.ok(inBounds(b));
  assert.ok(b.onFloor());
  assert.ok(Math.abs(b.velocity(DT).y) < 5, 'should come to rest');
  assert.ok(b.area() / b.restArea > 0.85, 'area mostly preserved');
});

test('squashes on a hard landing', () => {
  const b = new SoftBody(400, 100);
  b.setBounds(0, 0, 800, 600);
  b.impulse(0, 3000, DT);
  let minY = Infinity, sawImpact = 0;
  for (let t = 0; t < 1; t += DT) {
    b.step(DT);
    minY = Math.min(minY, b.stretch().y);
    sawImpact = Math.max(sawImpact, b.lastImpact);
  }
  assert.ok(minY < 0.85, `expected visible squash, got ${minY}`);
  assert.ok(sawImpact > 1000);
});

test('a hard toss bounces off every wall and stays on screen', () => {
  const b = new SoftBody(400, 300);
  b.setBounds(0, 0, 800, 600);
  b.impulse(9000, -9000, DT);
  const touched = new Set();
  for (let t = 0; t < 3; t += DT) {
    b.step(DT);
    for (const k of Object.keys(b.contact)) if (b.contact[k]) touched.add(k);
    assert.ok(inBounds(b));
    for (let i = 0; i < b.n; i++) assert.ok(Number.isFinite(b.px[i]) && Number.isFinite(b.py[i]));
  }
  assert.ok(touched.has('right') && touched.has('top') && touched.has('bottom'));
});

test('grab drags the body and release keeps the toss velocity', () => {
  const b = new SoftBody(400, 500);
  b.setBounds(0, 0, 800, 600);
  run(b, 1);
  const c = b.centroid();
  b.startGrab(c.x, c.y);
  for (let k = 0; k < 30; k++) { b.moveGrab(c.x + k * 12, c.y - k * 10); b.step(DT); }
  const after = b.centroid();
  assert.ok(after.x > c.x + 200 && after.y < c.y - 150, 'followed the cursor');
  b.endGrab();
  const v = b.velocity(DT);
  assert.ok(v.x > 500 && v.y < -300, `kept momentum, got ${v.x},${v.y}`);
});

test('calm takes out spin and wobble but keeps the way it was going, up to a speed', () => {
  const b = new SoftBody(400, 300);
  b.setBounds(0, 0, 800, 600);
  b.spin(15, DT);
  b.impulse(1200, -300, DT);
  b.pushAt(400, 244, 0, 400, 20, DT);
  const shape = [...b.px];
  b.calm(400, DT);
  assert.ok(Math.abs(b.angularVelocity(DT)) < 1e-6, `no spin, got ${b.angularVelocity(DT)}`);
  const v = b.velocity(DT);
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 400) < 1e-6 && v.x > 0 && v.y < 0, `capped along its way, got ${v.x},${v.y}`);
  for (let i = 0; i < b.n; i++) assert.ok(Math.abs((b.px[i] - b.ox[i]) / DT - v.x) < 1e-6, 'every point moving together');
  assert.deepStrictEqual([...b.px], shape, 'same shape');
});

test('hit testing', () => {
  const b = new SoftBody(100, 100);
  assert.ok(b.contains(100, 100));
  assert.ok(!b.contains(100 + 70, 100));
});

test('two blobs dropped on each other stack instead of merging', () => {
  const { collideBodies } = require('../src/renderer/softbody.js');
  const a = new SoftBody(400, 500), b = new SoftBody(410, 300);
  for (const x of [a, b]) x.setBounds(0, 0, 800, 600);
  for (let t = 0; t < 4; t += DT) {
    a.step(DT); b.step(DT);
    for (let k = 0; k < 3; k++) collideBodies(a, b);
  }
  let overlap = 0;
  for (let i = 0; i < b.n; i++) if (a.contains(b.px[i], b.py[i])) overlap++;
  assert.ok(overlap <= 2, `overlapping points: ${overlap}`);
  assert.ok(Math.hypot(a.centroid().x - b.centroid().x, a.centroid().y - b.centroid().y) > 80);
});

test('setRadius inflates the body to the new size', () => {
  const b = new SoftBody(400, 300, { radius: 20 });
  b.setBounds(0, 0, 800, 600);
  b.setRadius(40);
  run(b, 1.5);
  const bb = b.bbox();
  assert.ok(Math.abs((bb.maxX - bb.minX) - 80) < 12, `width ${bb.maxX - bb.minX}`);
});

test('lands on top of an obstacle like the Dock and slides off its edge', () => {
  const b = new SoftBody(400, 100, { radius: 40 });
  b.setBounds(0, 0, 800, 600);
  b.setObstacles([{ x0: 300, y0: 540, x1: 500, y1: 600 }]);
  run(b, 2);
  assert.ok(b.onFloor());
  assert.ok(b.bbox().maxY <= 541, `rests on the dock, bottom at ${b.bbox().maxY}`);
  for (let i = 0; i < b.n; i++) assert.ok(!(b.px[i] > 300 && b.px[i] < 500 && b.py[i] > 541));
});

test('held by the skin, the body dangles below the cursor', () => {
  const b = new SoftBody(400, 300, { radius: 50 });
  b.setBounds(0, 0, 800, 600);
  run(b, 2);
  const top = b.bbox().minY;
  const c = b.centroid();
  b.startGrab(c.x, top + 4);
  for (let t = 0; t < 2; t += DT) { b.moveGrab(c.x, 150); b.step(DT); }
  const a = b.grabAnchor();
  assert.ok(Math.hypot(a.x - c.x, a.y - 150) < 30, `anchor near cursor: ${a.x},${a.y}`);
  assert.ok(b.centroid().y > 150 + 25, 'body hangs below the grab point');
  assert.ok(Math.abs(b.velocity(DT).y) < 200, 'wobbles but stays under control');
});

test('a small blob spawned inside a big one gets out', () => {
  const { collideBodies } = require('../src/renderer/softbody.js');
  const big = new SoftBody(400, 450, { radius: 96 }), small = new SoftBody(400, 450, { radius: 40 });
  for (const x of [big, small]) x.setBounds(0, 0, 800, 600);
  for (let t = 0; t < 3; t += DT) {
    big.step(DT); small.step(DT);
    for (let k = 0; k < 2; k++) collideBodies(big, small);
  }
  const c = small.centroid();
  assert.ok(!big.contains(c.x, c.y), 'small centre is outside the big one');
});

// The "life" forces: each must shape the body without pushing it anywhere.
const TUNED = { radius: 78, points: 29, edgeStiffness: 0.03, bending: 0.07, pressure: 0.4, fullness: 0.7, shapeStiffness: 0.002, upright: 0.01, bounce: 0.92, friction: 0.14, gravity: 1950, damping: 0.994, iterations: 5 };
const settled = () => {
  const b = new SoftBody(400, 500, TUNED);
  b.setBounds(0, 0, 800, 600);
  run(b, 3);
  return b;
};
const topX = (b) => { let i = 0; for (let k = 1; k < b.n; k++) if (b.py[k] < b.py[i]) i = k; return b.px[i] - b.centroid().x; };

test('lean, squashTop and stretchToward add no net speed', () => {
  const b = new SoftBody(400, 300);
  for (const f of [() => b.lean(500, DT), () => b.stretchToward(0.6, -0.8, 1.4, 400, DT)]) {
    const v0 = b.velocity(DT);
    f();
    const v = b.velocity(DT);
    assert.ok(Math.abs(v.x - v0.x) < 1e-6 && Math.abs(v.y - v0.y) < 1e-6);
  }
});

test('leaning tips the top over without rolling the slime away', () => {
  const b = settled();
  const x0 = b.centroid().x;
  let lean = 0, n = 0;
  for (let t = 0; t < 2; t += DT) {
    b.lean(78 * 25 * DT, DT);
    b.impulse(-b.velocity(DT).x * 0.15, 0, DT);
    b.step(DT);
    if (t > 1) { lean += topX(b); n++; }
  }
  assert.ok(lean / n > 8, `top should lean right, got ${lean / n}`);
  assert.ok(Math.abs(b.centroid().x - x0) < 15, 'stays about where it was');
  assert.ok(Math.abs(b.angle) < 0.4, `shouldn't roll, angle ${b.angle}`);
});

test('a crouch squashes it, and it springs back', () => {
  const b = settled();
  const rest = b.stretch().y;
  let low = rest;
  for (let t = 0; t < 0.1; t += DT) { b.squashTop(80 * 78 * DT, DT); b.step(DT); low = Math.min(low, b.stretch().y); }
  assert.ok(low < rest - 0.04, `expected a crouch, ${low} vs ${rest}`);
  run(b, 2);
  assert.ok(Math.abs(b.stretch().y - rest) < 0.05);
});

test('stretches out along the way it flies', () => {
  const b = new SoftBody(400, 300, Object.assign({}, TUNED, { gravity: 0 }));
  b.setBounds(0, 0, 1e5, 1e5);
  b.impulse(1500, 0, DT);
  const s0 = b.stretch();
  for (let t = 0; t < 0.3; t += DT) { b.stretchToward(1, 0, 1.3, 400, DT); b.step(DT); }
  const s = b.stretch();
  assert.ok(s.x / s.y > s0.x / s0.y + 0.15, `aspect ${s.x / s.y}`);
});

test('a poke dents the skin where it lands', () => {
  const b = settled();
  let j = 0;
  for (let i = 1; i < b.n; i++) if (b.px[i] > b.px[j]) j = i;
  const x0 = b.px[j] - b.centroid().x;
  b.pushAt(b.px[j], b.py[j], -78 * 12, 0, 39, DT);
  let least = x0;
  for (let t = 0; t < 0.5; t += DT) { b.step(DT); least = Math.min(least, b.px[j] - b.centroid().x); }
  assert.ok(x0 - least > 8, `dent ${x0 - least}`);
});

test('spin turns the body about its middle', () => {
  const b = new SoftBody(500, 300);
  b.spin(6, DT);
  assert.ok(Math.abs(b.angularVelocity(DT) - 6) < 0.5, 'spins at ' + b.angularVelocity(DT));
  let turned = 0, last = b.angle;
  for (let i = 0; i < 30; i++) { b.step(DT); let d = b.angle - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; turned += d; last = b.angle; }
  assert.ok(turned > 0.5, 'turned ' + turned);
  assert.ok([...b.px].every(Number.isFinite));
});

test('morph reshapes the rest shape into a heart and back to a circle', () => {
  const b = new SoftBody(500, 300), r = b.o.radius, n = b.n;
  const rx = [...b.rx], ry = [...b.ry], edge = b.restEdge;
  b.morph(1);
  // The top dips in (the vertex at the top sits lower than its neighbours a
  // quarter-turn away) and the bottom comes to a point.
  const top = Math.round(n * 0.75), bottom = Math.round(n * 0.25);
  assert.ok(b.ry[top] > b.ry[(top + 3) % n], 'a dip at the top');
  assert.ok(b.ry[bottom] > r, 'a point at the bottom');
  assert.ok(b.restEdge > edge);
  b.morph(0);
  assert.ok(b.rx.every((v, i) => Math.abs(v - rx[i]) < 1e-9) && b.ry.every((v, i) => Math.abs(v - ry[i]) < 1e-9));
  assert.ok(Math.abs(b.restEdge - edge) < 1e-9);
});
