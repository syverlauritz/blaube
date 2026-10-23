// Where the talk box goes: above its slime with the tail pointing down at
// it, shrinking to fit if it must; when even a short box won't fit above,
// beside it (tail pointing left or right at the slime), never over it.
// `at` is the top of the slime (x, y, r) in screen coordinates, `content`
// the height the bubble would like (without its tail), `prev` the side it
// was on (it keeps to it unless the room changes clearly, so it can't flip
// back and forth). Returns { x, y, h, tail } for the whole window.
const MIN_ABOVE = 240; // shorter than this above the slime, it goes beside
const TAIL = 20; // the extra height a tail below the bubble needs
const GAP = 4;
const STICKY = 30;
const PAD = 10; // the window reaches this far past the tail's tip (room for the bubble to wobble)

function placeTalk(at, area, w, content, prev) {
  const r = at.r || 60;
  const room = at.y - GAP - area.y;
  const want = content + TAIL;
  const need = Math.min(want, MIN_ABOVE) + (prev && prev !== 'bottom' ? STICKY : prev === 'bottom' ? -STICKY : 0);
  let x, y, h, side;
  if (room >= need) {
    side = 'bottom';
    h = Math.min(want, room + PAD);
    x = at.x - w / 2;
    y = at.y - GAP - h + PAD;
  } else {
    h = Math.min(content, area.height);
    // The tail points at the slime's upper body.
    const aim = at.y + r * 0.6;
    const right = area.x + area.width - (at.x + r + GAP) >= w;
    side = right ? 'left' : 'right';
    x = right ? at.x + r + GAP - PAD : at.x - r - GAP - w + PAD;
    y = aim - h * 0.6;
  }
  // (The bubble itself sits 12 px inside the window, so it stays off the
  // screen's edges like the other bubbles.)
  x = Math.round(Math.max(area.x, Math.min(area.x + area.width - w, x)));
  y = Math.round(Math.max(area.y, Math.min(area.y + area.height - h + PAD, y)));
  const tail = side === 'bottom'
    ? { side, at: Math.round(Math.max(44, Math.min(w - 44, at.x - x))) }
    : { side, at: Math.round(Math.max(48, Math.min(h - 48, at.y + r * 0.6 - y))) };
  return { x, y, h: Math.round(h), tail };
}

module.exports = { placeTalk, TAIL };
