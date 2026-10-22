const test = require('node:test');
const assert = require('node:assert');
const { ledges, parse } = require('../src/main/windows.js');

const area = { x: 0, y: 0, width: 1000, height: 800 };

test('parse reads the helper\'s lines', () => {
	assert.deepStrictEqual(parse('12 10 20 110 220;34 0 0 50 50;'), [
		{ id: 12, x: 10, y: 20, width: 100, height: 200 },
		{ id: 34, x: 0, y: 0, width: 50, height: 50 },
	]);
});

test('a lone window makes one ledge along its top', () => {
	assert.deepStrictEqual(ledges([{ id: 1, x: 100, y: 300, width: 400, height: 300 }], area), [{ id: 1, x0: 100, x1: 500, y: 300, wx: 100 }]);
});

test('a window in front hides part of the ledge behind it', () => {
	const front = { id: 1, x: 250, y: 200, width: 100, height: 300 };
	const back = { id: 2, x: 100, y: 300, width: 400, height: 300 };
	const out = ledges([front, back], area);
	assert.deepStrictEqual(out.filter((l) => l.id === 2).map((l) => [l.x0, l.x1]), [[100, 250], [350, 500]]);
});

test('maximised windows and windows at the very top make no ledge', () => {
	assert.deepStrictEqual(ledges([{ id: 1, x: 0, y: 0, width: 1000, height: 800 }], area), []);
	assert.deepStrictEqual(ledges([{ id: 1, x: 100, y: 2, width: 300, height: 300 }], area), []);
});

test('a maximised window hides every window behind it', () => {
	assert.deepStrictEqual(ledges([{ id: 1, x: 0, y: 0, width: 1000, height: 800 }, { id: 2, x: 100, y: 300, width: 300, height: 300 }], area), []);
});

test('ledges are cut to the screen', () => {
	assert.deepStrictEqual(ledges([{ id: 1, x: -200, y: 300, width: 400, height: 300 }], area), [{ id: 1, x0: 0, x1: 200, y: 300, wx: -200 }]);
});
