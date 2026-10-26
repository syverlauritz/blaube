const test = require('node:test');
const assert = require('node:assert');
const { sanitize, DEFAULTS } = require('../src/shared/config.js');

test('the talk shortcut can be moved off Ctrl+Alt (AltGr on Windows) or turned off', () => {
  assert.equal(DEFAULTS.talkKey, 'Ctrl/⌘+Alt+B');
  assert.equal(sanitize({ talkKey: 'Alt+Shift+B' }).talkKey, 'Alt+Shift+B');
  assert.equal(sanitize({ talkKey: 'Off' }).talkKey, 'Off');
  assert.equal(sanitize({ talkKey: 'Ctrl+Q' }).talkKey, 'Ctrl/⌘+Alt+B', 'unknown keys fall back');
});
