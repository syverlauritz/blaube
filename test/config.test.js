const test = require('node:test');
const assert = require('node:assert');
const { sanitize, DEFAULTS } = require('../src/shared/config.js');

test('the talk shortcut can be moved off Ctrl+Alt (AltGr on Windows) or turned off', () => {
  assert.equal(DEFAULTS.talkKey, 'Ctrl/⌘+Alt+B');
  assert.equal(sanitize({ talkKey: 'Alt+Shift+B' }).talkKey, 'Alt+Shift+B');
  assert.equal(sanitize({ talkKey: 'Off' }).talkKey, 'Off');
  assert.equal(sanitize({ talkKey: 'Ctrl+Q' }).talkKey, 'Ctrl/⌘+Alt+B', 'unknown keys fall back');
});

test('a helper grows with its own tokens, counted from 20k, under its mother', () => {
  const { childRadius, tokenGrowth } = require('../src/shared/config.js');
  const cfg = Object.assign({}, DEFAULTS, { mainRadius: 129, childRadius: 86, tokenGrowth: 0.15, maxTokenGrowth: 1.6 });
  assert.equal(childRadius(cfg, 0, 1e6), 86);
  assert.ok(Math.abs(childRadius(cfg, 20000, 1e6) - 86 * 1.15) < 1e-9, 'a step bigger at 20k');
  // Typical helpers (20k-150k) each come out a different size.
  const sizes = [20000, 50000, 120000, 150000].map((t) => childRadius(cfg, t, 3e6));
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] > sizes[i - 1] + 2, `${sizes}`);
  assert.equal(childRadius(cfg, 1e8, null), 86 * 1.6, 'no bigger than maxTokenGrowth');
  // Never past three quarters of what its mother's tokens make her...
  assert.equal(childRadius(cfg, 1e8, 0), 0.75 * 129);
  assert.equal(childRadius(cfg, 1e8, 100000), 0.75 * 129 * tokenGrowth(cfg, 100000, 100000));
  // ...but never held below its own size.
  assert.equal(childRadius(Object.assign({}, cfg, { childRadius: 110 }), 1e8, 0), 110);
});
