// Where the talk box goes: floating a little above its slime (the slime's
// layer draws a soft tail from the bubble down to its head), shrinking to
// fit if it must; when even a short box won't fit above, beside it, never
// over it. `at` is the top of the slime (x, y, r) in screen coordinates,
// `content` the height the window would like, `prev` the side it was on (it
// keeps to it unless the room changes clearly, so it can't flip back and
// forth). `minAbove` is the shortest box worth putting above (a roomier
// box asks for more). Returns { x, y, h, tail } for the window; tail.side
// says which edge of the bubble the tail leaves from.
const MIN_ABOVE = 240; // shorter than this above the slime, it goes beside
const GAP = 34; // between the bubble and the slime's head: the tail's length
const PAD = 12; // the window reaches this far round the bubble (room for its wobble)
const STICKY = 30;

function placeTalk(at, area, w, content, prev, minAbove = MIN_ABOVE) {
  const r = at.r || 60;
  const room = at.y - GAP + PAD - area.y;
  const need = Math.min(content, minAbove) + (prev && prev !== 'bottom' ? STICKY : prev === 'bottom' ? -STICKY : 0);
  let x, y, h, side;
  if (room >= need) {
    side = 'bottom';
    h = Math.min(content, room);
    x = at.x - w / 2;
    y = at.y - GAP + PAD - h;
  } else {
    h = Math.min(content, area.height);
    // Level with the slime's upper body.
    const aim = at.y + r * 0.6;
    const right = area.x + area.width - (at.x + r + GAP - PAD) >= w;
    side = right ? 'left' : 'right';
    x = right ? at.x + r + GAP - PAD : at.x - r - GAP + PAD - w;
    y = aim - h * 0.5;
  }
  x = Math.round(Math.max(area.x, Math.min(area.x + area.width - w, x)));
  y = Math.round(Math.max(area.y, Math.min(area.y + area.height - h + PAD, y)));
  const tail = side === 'bottom'
    ? { side, at: Math.round(Math.max(40, Math.min(w - 40, at.x - x))) }
    : { side, at: Math.round(Math.max(40, Math.min(h - 40, at.y + r * 0.6 - y))) };
  return { x, y, h: Math.round(h), tail };
}

// Resizing the box by one of its edges or corners (`edge`: some of n, s, e,
// w), dragged (dx, dy) from where it was (`box`: { x, y, w, h }). The other
// edges stay put; it keeps to at least `min` ({ w, h }) and to the screen
// (its clear margin may hang off the bottom, as placeTalk lets it).
function resizeTalk(box, edge, dx, dy, area, min) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let { x, y, w, h } = box;
  const right = x + w, bottom = y + h;
  if (edge.includes('e')) w = clamp(w + dx, min.w, area.x + area.width - x);
  if (edge.includes('w')) { x = clamp(x + dx, Math.min(area.x, right - min.w), right - min.w); w = right - x; }
  if (edge.includes('s')) h = clamp(h + dy, min.h, area.y + area.height + PAD - y);
  if (edge.includes('n')) { y = clamp(y + dy, Math.min(area.y, bottom - min.h), bottom - min.h); h = bottom - y; }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

// Moving the box (dragged by its header) by (dx, dy): anywhere on the
// screen `area`, all of it on it (its clear margin may hang off the bottom).
function moveTalk(box, dx, dy, area) {
  const x = Math.max(area.x, Math.min(area.x + area.width - box.w, box.x + dx));
  const y = Math.max(area.y, Math.min(area.y + area.height + PAD - box.h, box.y + dy));
  return { x: Math.round(x), y: Math.round(y), w: box.w, h: box.h };
}

module.exports = { placeTalk, resizeTalk, moveTalk, GAP, PAD };
