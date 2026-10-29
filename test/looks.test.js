const test = require('node:test');
const assert = require('node:assert');
require('../src/renderer/looks.js');
const { LOOKS, lookOrder, pickLook } = globalThis.BlaubeLooks;
const names = LOOKS.map(([n]) => n);

test('lookOrder is the same every time for a key', () => {
	assert.deepStrictEqual(lookOrder('session-1', false), lookOrder('session-1', false));
	assert.deepStrictEqual(lookOrder('session-1', true), lookOrder('session-1', true));
});

test('lookOrder holds every look exactly once', () => {
	for (const key of ['a', 'session-1', 'xyz', '']) {
		assert.deepStrictEqual([...lookOrder(key, false)].sort(), [...names].sort());
	}
});

test('lookOrder never includes bunny for a small Blaube', () => {
	for (let i = 0; i < 50; i++) {
		const order = lookOrder('k' + i, true);
		assert.ok(!order.includes('bunny'));
		assert.strictEqual(order.length, names.length - 1);
	}
});

test('lookOrder differs between keys', () => {
	const firsts = new Set();
	for (let i = 0; i < 50; i++) firsts.add(lookOrder('k' + i, false)[0]);
	assert.ok(firsts.size > 1);
});

test('pickLook returns a known look, never bunny when small', () => {
	for (let i = 0; i < 200; i++) {
		const key = 'k' + i;
		assert.ok(names.includes(pickLook(key, false)));
		assert.ok(names.includes(pickLook(key, true)));
		assert.notStrictEqual(pickLook(key, true), 'bunny');
		assert.strictEqual(pickLook(key, false), pickLook(key, false));
	}
});

test('about one Blaube in five is plain, and it is stable per key', () => {
	let plain = 0;
	for (let i = 0; i < 1000; i++) {
		if (lookOrder('session-' + i, false)[0] === 'none') plain++;
		assert.strictEqual(pickLook('session-' + i, true), pickLook('session-' + i, true));
	}
	assert.ok(plain > 120 && plain < 260, 'plain share ' + plain / 1000);
});
