// Works out where Blaube's window should sit on a display, and which parts
// of it are solid (the macOS Dock) so the slimes can land on and bump into it.
const { execFile } = require('node:child_process');

// On macOS the window covers the whole display below the menu bar, including
// the Dock area; elsewhere it covers the work area (the taskbar is the floor).
function windowBoundsFor(display, platform = process.platform) {
  const { bounds: b, workArea: w } = display;
  if (platform !== 'darwin') return { ...w };
  return { x: b.x, y: w.y, width: b.width, height: b.y + b.height - w.y };
}

// The strip the Dock reserves, from the gap between the display bounds and
// its work area. Returns null when the Dock is hidden or on another display.
function dockStrip(display) {
  const { bounds: b, workArea: w } = display;
  const bottom = b.y + b.height - (w.y + w.height);
  const left = w.x - b.x;
  const right = b.x + b.width - (w.x + w.width);
  if (bottom > 0) return { side: 'bottom', x: b.x, y: w.y + w.height, width: b.width, height: bottom };
  if (left > 0) return { side: 'left', x: b.x, y: w.y, width: left, height: w.height };
  if (right > 0) return { side: 'right', x: w.x + w.width, y: w.y, width: right, height: w.height };
  return null;
}

// Narrows the strip to the Dock's actual length using its window bounds,
// when we could read them; otherwise the whole strip is solid.
function dockRect(display, dockWindows) {
  const strip = dockStrip(display);
  if (!strip) return null;
  const overlaps = (r) => r.x < strip.x + strip.width && r.x + r.width > strip.x && r.y < strip.y + strip.height && r.y + r.height > strip.y;
  const candidates = (dockWindows || [])
    .filter((r) => r.width > 40 && r.height > 20 && overlaps(r))
    .filter((r) => (strip.side === 'bottom' ? r.width < strip.width - 4 : r.height < strip.height - 4));
  if (!candidates.length) return strip;
  const best = candidates.reduce((a, r) => (r.width * r.height < a.width * a.height ? r : a));
  if (strip.side === 'bottom') return { ...strip, x: best.x, width: best.width };
  return { ...strip, y: best.y, height: best.height };
}

function toWindowCoords(rect, win) {
  return { x: rect.x - win.x, y: rect.y - win.y, width: rect.width, height: rect.height };
}

// Reads the Dock's on-screen window bounds through CoreGraphics (via
// JavaScript for Automation). Needs no permissions; reports [] on failure.
// Newer macOS gives the Dock one window as big as the screen, which says
// nothing about where the icons are; with Accessibility allowed, the
// Dock's icon row itself is read too, so its ends can be solid.
const JXA = `
ObjC.import('CoreGraphics');
ObjC.import('ApplicationServices');
ObjC.import('AppKit');
var raw = $.CGWindowListCopyWindowInfo(17, 0);
var list = ObjC.deepUnwrap(ObjC.castRefToObject(raw)) || [];
var out = list.filter(function (w) { return w.kCGWindowOwnerName === 'Dock'; })
  .map(function (w) { var b = w.kCGWindowBounds; return { x: b.X, y: b.Y, width: b.Width, height: b.Height, layer: w.kCGWindowLayer }; });
try {
  if ($.AXIsProcessTrusted()) {
    var attr = function (el, name) { var r = Ref(); return $.AXUIElementCopyAttributeValue(el, $(name), r) === 0 ? r[0] : null; };
    var dock = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.apple.dock').firstObject;
    var kids = ObjC.castRefToObject(attr($.AXUIElementCreateApplication(dock.processIdentifier), 'AXChildren'));
    for (var i = 0; i < kids.count; i++) {
      var el = kids.objectAtIndex(i);
      if (ObjC.unwrap(ObjC.castRefToObject(attr(el, 'AXRole'))) !== 'AXList') continue;
      // An AXValue can't be unpacked from here, but its description can be read.
      var m = /x:([-\\d.]+) y:([-\\d.]+) w:([\\d.]+) h:([\\d.]+)/.exec(ObjC.castRefToObject(attr(el, 'AXFrame')).description.js);
      if (m) out.push({ x: +m[1], y: +m[2], width: +m[3], height: +m[4], layer: 'icons' });
    }
  }
} catch (e) {}
JSON.stringify(out);
`;

function readDockWindows(cb) {
  if (process.platform !== 'darwin') return cb([]);
  execFile('osascript', ['-l', 'JavaScript', '-e', JXA], { timeout: 4000 }, (err, stdout) => {
    if (err) return cb([]);
    try { cb(JSON.parse(String(stdout).trim()) || []); } catch { cb([]); }
  });
}

module.exports = { windowBoundsFor, dockStrip, dockRect, toWindowCoords, readDockWindows };
