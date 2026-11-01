// A screenshot for your message, with no saving and dragging: you pick a
// part of the screen and it lands by the talk box's field as a picture.
//   macOS: `screencapture -i` (drag a box, or Space for a window; Esc
//          calls it off), as ⇧⌘4 does. macOS asks once to let Blaube
//          record the screen.
//   Windows: the Snipping Tool's overlay (ms-screenclip:), which puts what
//          you pick on the clipboard; Blaube waits for it to show up there.
//   Linux: gnome-screenshot -a, if it's there.
const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');

function supported(platform = process.platform, has = hasCommand) {
  if (platform === 'darwin' || platform === 'win32') return true;
  return platform === 'linux' && has('gnome-screenshot');
}

function hasCommand(name) {
  try { execFileSync('which', [name], { stdio: 'ignore', timeout: 2000 }); return true; } catch { return false; }
}

// A file's PNG bytes, if it holds a real picture (more than nothing).
function isPng(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    fs.closeSync(fd);
    return head.readUInt32BE(0) === 0x89504e47 && fs.statSync(file).size > 60;
  } catch { return false; }
}

// cb(file) with the picture saved in `dir`, or cb('') if you called it off
// (or it couldn't). Returns { cancel() } on Windows, where nothing says
// you called it off. opts: { platform, run(cmd, args, cb), clipboard: {
// readImage() -> { isEmpty(), toPNG() } }, wait (ms the clipboard is
// watched on Windows), every (ms between looks), now }.
function capture(dir, cb, opts = {}) {
  const platform = opts.platform || process.platform;
  const run = opts.run || ((cmd, args, done) => execFile(cmd, args, { timeout: 5 * 60e3, windowsHide: true }, (err) => done(err)));
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return cb(''); }
  const file = path.join(dir, `screenshot-${(opts.now || Date.now)()}-${Math.random().toString(36).slice(2, 6)}.png`);
  let finished = false;
  const done = (f) => { if (!finished) { finished = true; cb(f); } };
  if (platform === 'darwin') return run('screencapture', ['-i', '-x', '-o', '-t', 'png', file], () => done(isPng(file) ? file : ''));
  if (platform === 'linux') return run('gnome-screenshot', ['-a', '-f', file], () => done(isPng(file) ? file : ''));
  if (platform !== 'win32' || !opts.clipboard) return done('');
  // Windows: what's on the clipboard now, so only a new picture counts.
  const clip = opts.clipboard;
  const png = () => { try { const im = clip.readImage(); return im && !im.isEmpty() ? im.toPNG() : null; } catch { return null; } };
  const before = png();
  const wait = opts.wait || 90e3, every = opts.every || 400;
  let waited = 0;
  run('explorer.exe', ['ms-screenclip:'], () => { /* explorer exits at once, whatever happens */ });
  const look = () => {
    if (finished) return;
    const now = png();
    if (now && !(before && before.equals(now))) {
      try { fs.writeFileSync(file, now); return done(file); } catch { return done(''); }
    }
    waited += every;
    if (waited >= wait) return done('');
    setTimeout(look, every);
  };
  setTimeout(look, every);
  return { cancel: () => done('') };
}

module.exports = { capture, supported, isPng };
