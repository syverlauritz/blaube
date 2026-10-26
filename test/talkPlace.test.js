const test = require('node:test');
const assert = require('node:assert');
const { placeTalk, resizeTalk, GAP, PAD } = require('../src/main/talkPlace.js');

const area = { x: 0, y: 30, width: 1500, height: 900 };

test('the talk box floats above its slime, leaving room for the tail', () => {
  const p = placeTalk({ x: 700, y: 700, r: 60 }, area, 384, 300);
  assert.equal(p.tail.side, 'bottom');
  assert.equal(p.h, 300);
  assert.equal(p.y + p.h - PAD, 700 - GAP, 'the bubble ends a tail’s length above the head');
  assert.equal(p.x + p.tail.at, 700, 'the tail leaves right over it');
});

test('it shrinks to fit above before going beside', () => {
  const p = placeTalk({ x: 700, y: 330, r: 60 }, area, 384, 460);
  assert.equal(p.tail.side, 'bottom');
  assert.ok(p.h < 460 && p.h >= 240);
  assert.ok(p.y >= area.y);
});

test('with no room above it goes beside the slime, never over it', () => {
  const right = placeTalk({ x: 300, y: 120, r: 60 }, area, 384, 400);
  assert.equal(right.tail.side, 'left');
  assert.ok(right.x + PAD >= 300 + 60, 'the bubble is clear of the slime');
  const left = placeTalk({ x: 1400, y: 120, r: 60 }, area, 384, 400);
  assert.equal(left.tail.side, 'right');
  assert.ok(left.x + 384 - PAD <= 1400 - 60, 'the bubble is clear of the slime');
});

test('it stays on screen near the edges', () => {
  const p = placeTalk({ x: 20, y: 800, r: 50 }, area, 384, 300);
  assert.ok(p.x >= 0);
  assert.ok(p.tail.at >= 40);
});

test('near the top it keeps to its side instead of flipping', () => {
  const first = placeTalk({ x: 700, y: 300, r: 60 }, area, 384, 400);
  const again = placeTalk({ x: 700, y: 288, r: 60 }, area, 384, 400, first.tail.side);
  assert.equal(again.tail.side, first.tail.side);
});

test('a box that needs more room goes beside sooner, rather than squashed above', () => {
  const at = { x: 700, y: 330, r: 60 };
  assert.equal(placeTalk(at, area, 600, 460).tail.side, 'bottom');
  const p = placeTalk(at, area, 600, 460, undefined, 380);
  assert.notEqual(p.tail.side, 'bottom');
  assert.equal(p.h, 460, 'beside, it gets all the room it asked for');
});

test('resizing by an edge or corner moves only that edge, within its least size and the screen', () => {
  const box = { x: 400, y: 200, w: 600, h: 500 };
  const min = { w: 440, h: 360 };
  assert.deepEqual(resizeTalk(box, 'se', 50, 40, area, min), { x: 400, y: 200, w: 650, h: 540 });
  assert.deepEqual(resizeTalk(box, 'nw', -30, -20, area, min), { x: 370, y: 180, w: 630, h: 520 });
  assert.deepEqual(resizeTalk(box, 'w', 400, 0, area, min), { x: 560, y: 200, w: 440, h: 500 }, 'no smaller than its least size, the right edge staying');
  assert.deepEqual(resizeTalk(box, 'n', 0, -900, area, min), { x: 400, y: area.y, w: 600, h: 670 }, 'not above the screen');
  assert.equal(resizeTalk(box, 'e', 2000, 0, area, min).w, area.width - 400, 'not off its right edge');
  assert.equal(resizeTalk(box, 's', 0, 2000, area, min).h, area.y + area.height + PAD - 200, 'its clear margin may hang off the bottom');
});
