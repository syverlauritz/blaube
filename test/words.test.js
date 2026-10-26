const test = require('node:test');
const assert = require('node:assert');
const W = require('../src/renderer/words.js');

const say = (text) => W.words(text).map((w) => w.phones.join(' '));

test('what slimes say is in the dictionary, with its stress', () => {
	assert.deepEqual(say('okay!'), ['OW2 K EY1']);
	assert.deepEqual(say('Hurray!'), ['HH AH0 R EY1']);
	assert.deepEqual(say('All done!'), ['AO1 L', 'D AH1 N']);
	assert.deepEqual(say('ta-da!'), ['T AH0 D AA1'], 'a hyphenated word is one word');
	assert.deepEqual(say('wheee!'), ['W IY1'], 'drawn out, it is looked up short');
	assert.equal(W.words('wheee!')[0].long, true, 'and said long');
});

test('other words are spelled out', () => {
	assert.deepEqual(say('time'), ['T AY1 M'], 'a silent e makes the vowel long');
	assert.deepEqual(say('stopped'), ['S T AA1 P T'], 'an ending d after a voiceless sound is a t');
	assert.deepEqual(say('likes'), ['L AY1 K S']);
	assert.deepEqual(say('phone'), ['F OW1 N']);
	assert.deepEqual(say('session'), ['S EH1 SH AH0 N']);
	assert.deepEqual(say('3'), ['TH R IY1'], 'numbers are said as words');
});

test('pauses, and what has nothing to say', () => {
	const w = W.words('Okay, done. Coffee?');
	assert.deepEqual(w.map((x) => x.pause), ['comma', 'stop', '?']);
	assert.deepEqual(W.words('👍 ⚡'), [], 'an emoji has no words');
});
