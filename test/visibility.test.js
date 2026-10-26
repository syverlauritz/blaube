const test = require('node:test');
const assert = require('node:assert');
const { visibility, blocked } = require('../src/main/visibility');

const S = (id, state, updatedAt) => ({ id, state, updatedAt });
const shown = (vis) => [...vis].filter(([, v]) => v.shown).map(([id]) => id).sort();
const why = (vis, id) => vis.get(id).why;

test('with no max, every blob shows but the ones hidden by hand', () => {
	const list = [S('a', 'working', 1), S('b', 'idle', 2), S('c', 'done', 3)];
	assert.deepStrictEqual(shown(visibility(list)), ['a', 'b', 'c']);
	const vis = visibility(list, { hidden: { b: 5 } });
	assert.deepStrictEqual(shown(vis), ['a', 'c']);
	assert.strictEqual(why(vis, 'b'), 'hidden');
	assert.strictEqual(why(vis, 'a'), '');
});

test('over the max, idle and done ones heard from longest ago go first', () => {
	const list = [S('old', 'idle', 1), S('done', 'done', 5), S('work', 'working', 2), S('new', 'idle', 9)];
	const vis = visibility(list, { max: 2 });
	assert.deepStrictEqual(shown(vis), ['new', 'work']);
	assert.strictEqual(why(vis, 'old'), 'max');
	assert.strictEqual(why(vis, 'done'), 'max');
	assert.deepStrictEqual(shown(visibility(list, { max: 3 })), ['done', 'new', 'work']);
	assert.deepStrictEqual(shown(visibility(list, { max: 4 })), ['done', 'new', 'old', 'work']);
});

test('working ones stay over idle ones, however recent', () => {
	const list = [S('w1', 'working', 1), S('w2', 'working', 2), S('i', 'idle', 100)];
	assert.deepStrictEqual(shown(visibility(list, { max: 2 })), ['w1', 'w2']);
	assert.deepStrictEqual(shown(visibility(list, { max: 1 })), ['w2']);
});

test('one that needs you always shows, even over the max', () => {
	const list = [S('w', 'working', 9), S('q1', 'waiting', 1), S('q2', 'waiting', 2), S('q3', 'waiting', 3)];
	const vis = visibility(list, { max: 2 });
	assert.deepStrictEqual(shown(vis), ['q1', 'q2', 'q3']);
	assert.strictEqual(why(vis, 'w'), 'max');
	// (and it takes a spot before anything else)
	assert.deepStrictEqual(shown(visibility([S('w', 'working', 9), S('q', 'waiting', 1), S('i', 'idle', 5)], { max: 2 })), ['q', 'w']);
});

test('hidden by hand wins, even over needing you', () => {
	const vis = visibility([S('q', 'waiting', 1), S('i', 'idle', 2)], { hidden: { q: 1 }, max: 1 });
	assert.deepStrictEqual(shown(vis), ['i']);
	assert.strictEqual(why(vis, 'q'), 'hidden');
});

test('hidden by hand ones don’t count toward the max', () => {
	const list = [S('a', 'idle', 1), S('b', 'idle', 2), S('c', 'idle', 3)];
	assert.deepStrictEqual(shown(visibility(list, { hidden: { c: 1 }, max: 2 })), ['a', 'b']);
});

test('shown by hand over the max: a lower one goes instead', () => {
	const list = [S('w', 'working', 5), S('i1', 'idle', 9), S('i2', 'idle', 1)];
	assert.deepStrictEqual(shown(visibility(list, { max: 2 })), ['i1', 'w']);
	// You show i2: i1 (idle) makes way.
	assert.deepStrictEqual(shown(visibility(list, { max: 2, wanted: { i2: 10 } })), ['i2', 'w']);
	// With a max of one, it even takes the working one's spot.
	assert.deepStrictEqual(shown(visibility(list, { max: 1, wanted: { i2: 10 } })), ['i2']);
	// Two shown by hand and room for one: the latest you showed.
	assert.deepStrictEqual(shown(visibility(list, { max: 1, wanted: { i2: 10, i1: 20 } })), ['i1']);
});

test('shown by hand but the spots all need you: it says why', () => {
	const list = [S('q1', 'waiting', 1), S('q2', 'waiting', 2), S('i', 'idle', 3)];
	const vis = visibility(list, { max: 2, wanted: { i: 10 } });
	assert.deepStrictEqual(shown(vis), ['q1', 'q2']);
	assert.match(blocked(vis, 'i', 2), /need you/);
	assert.strictEqual(blocked(vis, 'q1', 2), '');
});

test('a nonsense max means no limit', () => {
	const list = [S('a', 'idle', 1), S('b', 'idle', 2)];
	assert.deepStrictEqual(shown(visibility(list, { max: 'x' })), ['a', 'b']);
	assert.deepStrictEqual(shown(visibility(list, { max: -3 })), ['a', 'b']);
});
