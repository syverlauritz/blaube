const test = require('node:test');
const assert = require('node:assert');
const { splitAt, caretPoint, wordBefore, burst, LONG_WORD, FAST } = require('../src/shared/caret.js');

const box = { left: 20, top: 300, width: 400, height: 72 };

test('the marker holds the rest of the word the caret is in, so a word about to wrap wraps in the mirror too', () => {
	assert.deepStrictEqual(splitAt('hello wonderful world', 8), { before: 'hello wo', word: 'nderful', after: ' world' });
	assert.deepStrictEqual(splitAt('hello world', 11), { before: 'hello world', word: '', after: '' });
	assert.deepStrictEqual(splitAt('one\ntwo', 4), { before: 'one\n', word: 'two', after: '' });
	assert.deepStrictEqual(splitAt('a b', 1), { before: 'a', word: '', after: ' b' });
	assert.deepStrictEqual(splitAt('abc', 99), { before: 'abc', word: '', after: '' }, 'past the end: at the end');
	assert.deepStrictEqual(splitAt('', 0), { before: '', word: '', after: '' });
});

test('the caret goes on the field where the marker sits in the mirror, halfway down its line', () => {
	assert.deepStrictEqual(caretPoint({ box, mark: { left: 6, top: 2 }, lineHeight: 24 }), { x: 26, y: 314 });
	// The third line of a wrapped message, a long way along.
	assert.deepStrictEqual(caretPoint({ box, mark: { left: 310, top: 50 }, lineHeight: 24 }), { x: 330, y: 362 });
});

test('scrolled, the caret moves up with the text; out of sight it stays at the edge of the field', () => {
	assert.deepStrictEqual(caretPoint({ box, mark: { left: 100, top: 98 }, scroll: { left: 0, top: 48 }, lineHeight: 24 }), { x: 120, y: 362 });
	assert.deepStrictEqual(caretPoint({ box, mark: { left: 100, top: 2 }, scroll: { left: 0, top: 48 }, lineHeight: 24 }), { x: 120, y: 300 });
	assert.deepStrictEqual(caretPoint({ box, mark: { left: 900, top: 2 }, lineHeight: 24 }), { x: 420, y: 314 });
});

test('a new line, a long word (once) or typing fast is something to get excited about', () => {
	assert.strictEqual(wordBefore('so excited', 10), 7);
	assert.strictEqual(wordBefore('so excited', 2), 2);
	assert.strictEqual(wordBefore('line\n', 5), 0);
	assert.strictEqual(burst({ key: 'Enter', value: 'hi\n', end: 3, rate: 1 }), 'newline');
	assert.strictEqual(burst({ key: 'Enter', value: 'hi', end: 2, rate: 1 }), null, 'Enter that sent it: no new line');
	const long = 'x'.repeat(LONG_WORD);
	assert.strictEqual(burst({ key: 'x', value: 'a ' + long, end: 2 + LONG_WORD, rate: 3 }), 'long word');
	assert.strictEqual(burst({ key: 'x', value: 'a ' + long + 'x', end: 3 + LONG_WORD, rate: 3 }), null, 'only as it gets long');
	assert.strictEqual(burst({ key: 'a', value: 'abc', end: 3, rate: FAST }), 'fast');
	assert.strictEqual(burst({ key: 'a', value: 'abc', end: 3, rate: 4 }), null);
});
