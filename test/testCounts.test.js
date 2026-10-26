const test = require('node:test');
const assert = require('node:assert');
const { testCounts, words } = require('../src/main/testCounts');

test('test counts from what each runner prints', () => {
  const cases = [
    ['Test Suites: 1 failed, 3 passed, 4 total\nTests:       2 failed, 1 skipped, 10 passed, 13 total\nTime: 1s', { pass: 10, fail: 2 }],
    [' ✓ a.test.ts (3)\n Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 10 passed (12)\n', { pass: 10, fail: 2 }],
    ['\x1b[32m      Tests  \x1b[39m12 passed (12)', { pass: 12, fail: 0 }],
    ['ok 1 - a\n# tests 12\n# pass 10\n# fail 2\n', { pass: 10, fail: 2 }],
    ['ℹ tests 3\nℹ pass 3\nℹ fail 0', { pass: 3, fail: 0 }],
    ['test result: FAILED. 10 passed; 2 failed; 0 ignored', { pass: 10, fail: 2 }],
    ['==== 2 failed, 10 passed in 0.31s ====', { pass: 10, fail: 2 }],
    ['========= 5 passed in 1.02s =========', { pass: 5, fail: 0 }],
    ['==== 1 passed, 1 error in 0.2s ====', { pass: 1, fail: 1 }],
    ['Finished in 0.5 seconds\n12 examples, 2 failures', { pass: 10, fail: 2 }],
    ['  10 passing (20ms)\n  2 failing\n', { pass: 10, fail: 2 }],
    ['  2 failed\n  10 passed (3.1s)', { pass: 10, fail: 2 }],
    ['=== RUN TestA\n--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.00s)\nFAIL', { pass: 1, fail: 1 }],
  ];
  for (const [text, want] of cases) assert.deepEqual(testCounts(text), want, text);
  assert.equal(testCounts('npm ERR! missing script: test'), null);
  assert.equal(testCounts(''), null);
  // The last run counts (watch mode, or ran twice).
  assert.deepEqual(testCounts('# pass 1\n# fail 1\n...\n# pass 2\n# fail 0\n'), { pass: 2, fail: 0 });
});

test('in a few words', () => {
  assert.equal(words({ pass: 10, fail: 2 }), ' · 2 failing');
  assert.equal(words({ pass: 10, fail: 0 }), ' · 10 pass');
  assert.equal(words(null), '');
  assert.equal(words({ pass: 0, fail: 0 }), '');
});
