const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/renderer/voice.js');

test('a syllable per syllable of the words, with its vowel and the consonant before it', () => {
  const s = V.syllables('Pushed! Okay, tests pass?', 14);
  assert.deepEqual(s.map((y) => y.consonant + y.vowel), ['pa', 'o', 'ke', 'te', 'pa'], 'an -ed is no syllable of its own');
  assert.equal(s[0].gap, 'stop', 'a pause after the exclamation');
  assert.equal(s[2].gap, 'comma');
  assert.equal(s[s.length - 1].gap, 'end');
  assert.equal(s[0].end, '!');
  assert.equal(s[s.length - 1].end, '?', 'the phrase rises');
});

test('the shape of the words: syllables, vowels, stress, how each starts', () => {
  const shape = (t) => V.syllables(t, 14).map((y) => (y.stress ? '*' : '') + y.onset + y.vowel).join(' ');
  assert.equal(shape('okay'), 'wo *ke', 'oh-EH');
  assert.equal(shape('coffee'), '*ka wi', 'AH-ee');
  assert.equal(shape('hurray'), 'wa *le', 'uh-LEH');
  assert.equal(shape('time'), '*ka', 'a silent e is no syllable');
  assert.equal(shape('hehe'), '*we we');
  assert.equal(shape('little'), '*li le', 'an -le is one');
  assert.equal(shape('boxes'), '*bo ke', 'and an -es after an x');
});

test('a long reply is a short babble; an emoji or a number says nothing', () => {
  assert.equal(V.syllables('word '.repeat(80), 14).length, 14);
  assert.deepEqual(V.syllables('👍 42', 14), []);
});

test('bigger slimes have lower voices', () => {
  assert.ok(V.pitchFor(160) < V.pitchFor(78));
  assert.ok(V.pitchFor(78) < V.pitchFor(45));
  assert.ok(V.pitchFor(78, true) > V.pitchFor(78), 'a helper is higher than a mother its size');
  assert.ok(V.pitchFor(5000) >= 150 && V.pitchFor(1) <= 960, 'within a voice');
});

test('the mouth opens during a syllable and is shut between and after', () => {
  const line = { sylls: [{ t0: 0, t1: 0.1, vowel: 'a', open: 1 }, { t0: 0.2, t1: 0.3, vowel: 'i', open: 0.75 }] };
  assert.ok(V.mouthAt(line, 0.05).open > 0.5);
  assert.equal(V.mouthAt(line, 0.15).open, 0);
  assert.equal(V.mouthAt(line, 0.25).wide, V.VOWELS.i.wide, 'shaped for its vowel');
  assert.equal(V.mouthAt(line, 0.15).wide, V.VOWELS.i.wide, 'and shaped for the next one while shut');
  assert.equal(V.mouthAt(line, 0.5), null);
});
