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
