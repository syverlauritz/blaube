const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/renderer/voice.js');

test('a syllable per vowel group, with its vowel and the consonant before it', () => {
  const s = V.syllables('Pushed! Okay, tests pass?', 14);
  assert.deepEqual(s.map((y) => y.consonant + y.vowel), ['pu', 'he', 'o', 'ki', 'te', 'pa']);
  assert.equal(s[1].gap, 'stop', 'a pause after the exclamation');
  assert.equal(s[3].gap, 'comma');
  assert.equal(s[s.length - 1].gap, 'end');
});

test('a long reply is a short babble; an emoji is a hum', () => {
  assert.equal(V.syllables('word '.repeat(80), 14).length, 14);
  assert.deepEqual(V.syllables('👍', 14).map((y) => y.vowel), ['u']);
});

test('bigger slimes have lower voices', () => {
  assert.ok(V.pitchFor(160) < V.pitchFor(78));
  assert.ok(V.pitchFor(78) < V.pitchFor(45));
  assert.ok(V.pitchFor(78, true) > V.pitchFor(78), 'a helper is higher than a mother its size');
  assert.ok(V.pitchFor(5000) >= 120 && V.pitchFor(1) <= 760, 'within a voice');
});

test('the mouth opens during a syllable and is shut between and after', () => {
  const line = { sylls: [{ t0: 0, t1: 0.1, vowel: 'a', open: 1 }, { t0: 0.2, t1: 0.3, vowel: 'i', open: 0.75 }] };
  assert.ok(V.mouthAt(line, 0.05).open > 0.5);
  assert.equal(V.mouthAt(line, 0.15).open, 0);
  assert.equal(V.mouthAt(line, 0.25).wide, V.VOWELS.i.wide, 'shaped for its vowel');
  assert.equal(V.mouthAt(line, 0.15).wide, V.VOWELS.i.wide, 'and shaped for the next one while shut');
  assert.equal(V.mouthAt(line, 0.5), null);
});
