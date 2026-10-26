const test = require('node:test');
const assert = require('node:assert');
const { edgeToward, tailShown } = require('../src/shared/talkTail.js');

const box = { x: 100, y: 100, w: 400, h: 300 }, R = 30;
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);

test('below, beside and above the box the tail leaves from the edge facing the slime', () => {
  const below = edgeToward(box, { x: 260, y: 500 }, R);
  near(below.x, 260, 'below x'); near(below.y, 400, 'below y'); near(below.ny, 1, 'down'); near(below.out, 100, 'how far');
  const left = edgeToward(box, { x: 20, y: 250 }, R);
  near(left.x, 100, 'left x'); near(left.y, 250, 'left y'); near(left.nx, -1, 'left');
  const right = edgeToward(box, { x: 600, y: 180 }, R);
  near(right.x, 500, 'right x'); near(right.y, 180, 'right y'); near(right.nx, 1, 'right');
  const above = edgeToward(box, { x: 300, y: 40 }, R);
  near(above.x, 300, 'above x'); near(above.y, 100, 'above y'); near(above.ny, -1, 'up');
});

test('diagonally off a corner it leaves from the rounded corner, pointing at the slime', () => {
  const e = edgeToward(box, { x: 30, y: 30 }, R);
  // On the corner's arc...
  near(Math.hypot(e.x - 130, e.y - 130), R, 'on the arc');
  // ...on the line to the slime.
  near(e.nx, -Math.SQRT1_2, 'nx'); near(e.ny, -Math.SQRT1_2, 'ny');
  assert.ok(e.out > 0);
});

test('it slides smoothly round a corner as the slime goes round it', () => {
  let prev = null;
  for (let a = 0; a <= Math.PI / 2; a += 0.05) {
    const e = edgeToward(box, { x: 470 + Math.cos(a) * 120, y: 370 + Math.sin(a) * 120 }, R);
    if (prev) assert.ok(Math.hypot(e.x - prev.x, e.y - prev.y) < 4, 'no jumps');
    prev = e;
  }
});

test('under the box, the slime is inside it', () => {
  assert.ok(edgeToward(box, { x: 300, y: 250 }, R).out < 0);
  assert.ok(edgeToward(box, { x: 300, y: 395 }, R).out < 0);
});

test('the tail shows near its slime and fades out smoothly as they part', () => {
  const r = 80;
  assert.equal(tailShown(0, r), 1);
  assert.equal(tailShown(2 * r, r), 1, 'all of it up to two radii away');
  assert.equal(tailShown(3 * r, r), 0, 'none of it from three');
  assert.equal(tailShown(900, r), 0);
  near(tailShown(2.5 * r, r), 0.5, 'half way');
  let prev = 1;
  for (let g = 2 * r; g <= 3 * r; g += 4) {
    const k = tailShown(g, r);
    assert.ok(k <= prev && prev - k < 0.08, 'smoothly');
    prev = k;
  }
});
