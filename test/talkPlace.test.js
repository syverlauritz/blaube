const test = require('node:test');
const assert = require('node:assert');
const { placeTalk } = require('../src/main/talkPlace.js');

const area = { x: 0, y: 30, width: 1500, height: 900 };

test('the talk box sits above its slime, tail pointing down at it', () => {
  const p = placeTalk({ x: 700, y: 700, r: 60 }, area, 360, 280);
  assert.equal(p.tail.side, 'bottom');
  assert.equal(p.h, 300, 'content plus its tail');
  assert.ok(p.y + p.h - 10 <= 700, 'the tail tip is above the slime');
  assert.equal(p.x + p.tail.at, 700, 'tail right over it');
});

test('it shrinks to fit above before going beside', () => {
  const p = placeTalk({ x: 700, y: 330, r: 60 }, area, 360, 460);
  assert.equal(p.tail.side, 'bottom');
  assert.ok(p.h < 460 && p.h >= 240);
  assert.ok(p.y >= area.y);
});

test('with no room above it goes beside the slime, never over it', () => {
  const right = placeTalk({ x: 300, y: 120, r: 60 }, area, 360, 400);
  assert.equal(right.tail.side, 'left');
  assert.ok(right.x + 10 >= 300 + 60, 'the tail tip is clear of the slime');
  const left = placeTalk({ x: 1400, y: 120, r: 60 }, area, 360, 400);
  assert.equal(left.tail.side, 'right');
  assert.ok(left.x + 360 - 10 <= 1400 - 60, 'the tail tip is clear of the slime');
});

test('it stays on screen near the edges', () => {
  const p = placeTalk({ x: 20, y: 800, r: 50 }, area, 360, 300);
  assert.ok(p.x >= 0);
  assert.ok(p.tail.at >= 36);
});

test('near the top it keeps to its side instead of flipping', () => {
  const at = { x: 700, y: 275, r: 60 };
  const first = placeTalk(at, area, 360, 400);
  const again = placeTalk({ x: 700, y: 262, r: 60 }, area, 360, 400, first.tail.side);
  assert.equal(again.tail.side, first.tail.side);
});
