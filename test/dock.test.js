const test = require('node:test');
const assert = require('node:assert');
const { windowBoundsFor, dockRect, toWindowCoords } = require('../src/main/dock.js');

// A 1512x982 MacBook display: 37px menu bar, 70px Dock at the bottom.
const mac = { bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 875 } };

test('on macOS the window reaches under the Dock, not the menu bar', () => {
  assert.deepEqual(windowBoundsFor(mac, 'darwin'), { x: 0, y: 37, width: 1512, height: 945 });
  assert.deepEqual(windowBoundsFor(mac, 'win32'), mac.workArea);
});

test('the Dock is narrowed to its real width when its window is known', () => {
  const win = windowBoundsFor(mac, 'darwin');
  const full = toWindowCoords(dockRect(mac, []), win);
  assert.deepEqual(full, { x: 0, y: 875, width: 1512, height: 70 });
  const dockWin = [{ x: 0, y: 0, width: 1512, height: 982 }, { x: 400, y: 908, width: 712, height: 74 }];
  const narrow = toWindowCoords(dockRect(mac, dockWin), win);
  assert.deepEqual(narrow, { x: 400, y: 875, width: 712, height: 70 });
});

test('no Dock rect when the Dock is hidden', () => {
  const hidden = { bounds: mac.bounds, workArea: { x: 0, y: 37, width: 1512, height: 945 } };
  assert.equal(dockRect(hidden, []), null);
});
