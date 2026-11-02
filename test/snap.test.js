const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const snap = require('../src/main/snap');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-snap-'));

test('where it can take one', () => {
  assert.ok(snap.supported('darwin'));
  assert.ok(snap.supported('win32'));
  assert.ok(!snap.supported('linux', () => false));
  assert.ok(snap.supported('linux', (n) => n === 'gnome-screenshot'));
});

test('macOS: screencapture picks a part, and the file comes back', async () => {
  const calls = [];
  const file = await new Promise((cb) => snap.capture(tmp(), cb, { platform: 'darwin', run: (cmd, args, done) => { calls.push([cmd, ...args]); fs.writeFileSync(args[args.length - 1], PNG); done(null); } }));
  assert.equal(calls[0][0], 'screencapture');
  assert.ok(calls[0].includes('-i'), 'interactive: you pick');
  assert.ok(file.endsWith('.png') && fs.existsSync(file));
});

test('macOS: called off with Esc (no file) is nothing', async () => {
  const file = await new Promise((cb) => snap.capture(tmp(), cb, { platform: 'darwin', run: (cmd, args, done) => done(null) }));
  assert.equal(file, '');
});

test('Windows: waits for a new picture on the clipboard, not the one already there', async () => {
  const old = Buffer.from('old'), fresh = Buffer.concat([PNG, Buffer.from('new')]);
  let now = old, looks = 0, ran = '';
  const clipboard = { readImage: () => ({ isEmpty: () => !now, toPNG: () => now }) };
  const file = await new Promise((cb) => snap.capture(tmp(), cb, {
    platform: 'win32', every: 5, clipboard,
    run: (cmd, args) => { ran = cmd + ' ' + args.join(' '); setTimeout(() => { looks++; now = fresh; }, 30); },
  }));
  assert.equal(ran, 'explorer.exe ms-screenclip:');
  assert.ok(looks === 1 && file && fs.readFileSync(file).equals(fresh));
});

test('Windows: gives up after a while, or when you call it off', async () => {
  const clipboard = { readImage: () => ({ isEmpty: () => true, toPNG: () => null }) };
  const late = await new Promise((cb) => snap.capture(tmp(), cb, { platform: 'win32', every: 5, wait: 30, clipboard, run: () => {} }));
  assert.equal(late, '');
  let h;
  const off = await new Promise((cb) => { h = snap.capture(tmp(), cb, { platform: 'win32', every: 5, clipboard, run: () => {} }); setTimeout(() => h.cancel(), 20); });
  assert.equal(off, '');
});
