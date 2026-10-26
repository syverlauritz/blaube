const test = require('node:test');
const assert = require('node:assert');
const { sanitize, DEFAULTS } = require('../src/shared/config.js');

test('the talk shortcut can be moved off Ctrl+Alt (AltGr on Windows) or turned off', () => {
  assert.equal(DEFAULTS.talkKey, 'Ctrl/⌘+Alt+B');
  assert.equal(sanitize({ talkKey: 'Alt+Shift+B' }).talkKey, 'Alt+Shift+B');
  assert.equal(sanitize({ talkKey: 'Off' }).talkKey, 'Off');
  assert.equal(sanitize({ talkKey: 'Ctrl+Q' }).talkKey, 'Ctrl/⌘+Alt+B', 'unknown keys fall back');
});

test('helpers grow with their own tokens, and their mother with all of theirs, always the biggest', () => {
  const { childRadii, motherRadius, MOTHER_STEP } = require('../src/shared/config.js');
  const yours = Object.assign({}, DEFAULTS, { mainRadius: 129, childRadius: 86, tokenGrowth: 0.15, maxTokenGrowth: 1.6 });
  // [session total (its helpers' included), each helper's own tokens]
  const scenes = [
    [400000, [45000, 125000]],
    [1000000, [20000, 50000, 120000]],
    [3000000, [30000, 50000, 114000, 124000, 142000, 187000]],
    [5000000, [42000, 45000, 48000, 50000, 114000, 120000, 124000, 142000, 182000, 275000]],
    [150000, [5000, 80000, 600000]], // (more than the session: can't happen, but she still stays biggest)
  ];
  for (const cfg of [DEFAULTS, yours]) {
    for (const [total, tokens] of scenes) {
      const mother = motherRadius(cfg, total), kids = childRadii(cfg, total, tokens);
      for (const r of kids) assert.ok(mother >= r * MOTHER_STEP - 1e-9, `mother ${mother} vs child ${r} (${total}: ${tokens})`);
      // Each helper is its own size, bigger with more tokens.
      for (let i = 1; i < kids.length; i++) assert.ok(kids[i] > kids[i - 1], `${kids}`);
    }
    assert.ok(motherRadius(cfg, 3e6) > motherRadius(cfg, 1e6), 'she grows as they do');
    assert.ok(motherRadius(cfg, 1e12) <= cfg.mainRadius * cfg.maxTokenGrowth, 'up to a point');
  }
  // With room to spare a helper is just its own size, a step bigger at 20k.
  assert.deepEqual(childRadii(yours, 1e6, [0]), [86]);
  assert.ok(Math.abs(childRadii(yours, 1e6, [20000])[0] - 86 * 1.15) < 1e-9);
  assert.deepEqual(childRadii(yours, null, [1e8]), [86 * 1.6], 'no mother: only maxTokenGrowth');
  // Typical helpers (20k-150k) come out clearly different sizes.
  const typical = childRadii(yours, 3e6, [20000, 50000, 120000, 150000]);
  for (let i = 1; i < typical.length; i++) assert.ok(typical[i] > typical[i - 1] + 2, `${typical}`);
  // Crowding her, they're scaled down together: the same proportions.
  const squeezed = childRadii(yours, 0, [20000, 1e8]), free = childRadii(yours, null, [20000, 1e8]);
  assert.ok(Math.abs(squeezed[1] - 129 / MOTHER_STEP) < 1e-9);
  assert.ok(Math.abs(squeezed[0] / squeezed[1] - free[0] / free[1]) < 1e-9);
});
