const test = require('node:test');
const assert = require('node:assert');
const { tokenCount, elapsed, helperStats } = require('../src/shared/helperStats.js');

test('tokens as the terminal writes them: k and m with one decimal', () => {
	assert.strictEqual(tokenCount(0), '0');
	assert.strictEqual(tokenCount(850), '850');
	assert.strictEqual(tokenCount(1000), '1.0k');
	assert.strictEqual(tokenCount(117040), '117.0k');
	assert.strictEqual(tokenCount(999949), '999.9k');
	assert.strictEqual(tokenCount(999990), '1.0m');
	assert.strictEqual(tokenCount(1234567), '1.2m');
});

test('time as the terminal writes it', () => {
	assert.strictEqual(elapsed(9400), '9s');
	assert.strictEqual(elapsed(134000), '2m 14s');
	assert.strictEqual(elapsed(3780000), '1h 3m');
	assert.strictEqual(elapsed(-5), '0s');
});

test("a helper's line: time and tokens, either left out when not known", () => {
	assert.strictEqual(helperStats(1000, 117040, 135000), '2m 14s · ↓ 117.0k tokens');
	assert.strictEqual(helperStats(0, 4200, 135000), '↓ 4.2k tokens');
	assert.strictEqual(helperStats(1000, 0, 11000), '10s');
	assert.strictEqual(helperStats(0, 0), '');
});
