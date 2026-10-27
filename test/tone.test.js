const test = require('node:test');
const assert = require('node:assert');
const { toneOf } = require('../src/main/tone.js');

test('thanks and praise', () => {
  for (const t of ['thanks!', 'Thank you', 'perfect', 'nice work', 'Great job, ship it', 'love it 🎉', 'takk']) assert.equal(toneOf(t), 'praise', t);
});

test('swearing, anywhere in a prompt, even a long one', () => {
  for (const t of ['why the fuck would it rise from the bottom?', 'shit', 'wtf', 'FFS', 'faen, igjen?', 'this is fucking broken', 'add a test '.repeat(30) + 'damn it']) assert.equal(toneOf(t), 'curse', t);
  for (const t of ['the shitake mushroom', 'class Fuchsia', 'scrap the old one', 'damnation is a word']) assert.notEqual(toneOf(t), 'curse', t);
});

test('a telling-off', () => {
  for (const t of ["no, that's wrong", 'you broke the build', 'no, use the other one', 'ugh, again?']) assert.equal(toneOf(t), 'scold', t);
});

test('plain instructions, and long prompts, are neither', () => {
  for (const t of ['add a test for the parser', 'now do the same for windows', 'no need for tests here', '', null]) assert.equal(toneOf(t), '', String(t));
  assert.equal(toneOf('thanks! '.padEnd(200, 'and then refactor the module ')), '');
});
