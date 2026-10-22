// Drawing for Blaube: the jelly body, its face, a shadow, status dots and
// speech bubbles. Everything is drawn in CSS pixels on one canvas.
(function (root) {
  'use strict';

  const STATE_COLORS = { working: '#f5a623', waiting: '#ff4d6d', done: '#2ecc71', idle: '#a0aec0' };

  function bodyPath(ctx, b) {
    const n = b.n, px = b.px, py = b.py;
    ctx.beginPath();
    let mx = (px[n - 1] + px[0]) / 2, my = (py[n - 1] + py[0]) / 2;
    ctx.moveTo(mx, my);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      mx = (px[i] + px[j]) / 2; my = (py[i] + py[j]) / 2;
      ctx.quadraticCurveTo(px[i], py[i], mx, my);
    }
    ctx.closePath();
  }

  function drawShadow(ctx, b, floorY = b.bounds.bottom) {
    const c = b.centroid();
    const r = b.o.radius;
    const h = Math.max(0, floorY - (c.y + r));
    const k = Math.max(0, 1 - h / 500);
    if (k <= 0) return;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.1 * k})`;
    ctx.beginPath();
    ctx.ellipse(c.x, floorY - 2, r * (0.5 + 0.3 * k), r * 0.1 * k + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Flat fill in a single colour, nothing around it.
  function drawBody(ctx, b, color) {
    bodyPath(ctx, b);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Colour helpers. Colours are '#rrggbb' strings.
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360} ${Math.max(0, Math.min(100, s))}% ${Math.max(0, Math.min(100, l))}%)`;

  // Shifts a colour's hue (degrees) and lightness (percentage points).
  function vary(hex, dh, dl) {
    const c = hexToHsl(hex);
    return hsl(c.h + dh, c.s, c.l + dl);
  }

  const FACE_DEFAULTS = {
    faceInk: '#1b2440', eyeWhites: true, eyeShine: true, eyeSize: 1, pupilSize: 0.6, eyeSpacing: 1, eyeHeight: 0,
    eyeRoundness: 0.77, lookAround: 1, faceLine: 1, mouthSize: 1, mouthHeight: 0, brows: true, cheeks: 0.28, cheekColor: '#ff5a6e',
  };

  // Is a body colour in the red-orange-pink family, where the chosen blush
  // colour works? (On blue or green it turns muddy, so those get pink.)
  function isWarm(color) {
    if (!color) return true;
    let h;
    const m = /^hsl\(\s*([\d.]+)/.exec(color);
    if (m) h = Number(m[1]);
    else if (color[0] === '#') h = hexToHsl(color).h;
    else return true;
    return h < 45 || h > 300;
  }

  // face: { look: {x,y} in screen px, expression, blink 0..1, mouth, style,
  //         effort, glasses, squint, drool 0..1 or null }
  function drawFace(ctx, b, face) {
    const c = b.centroid();
    const r = b.o.radius;
    const st = b.stretch();
    ctx.save();
    const world = ctx.getTransform();
    ctx.translate(c.x, c.y);
    // The face leans with the body, but only so far: a face lying on its
    // side after a tumble looks broken, not cute.
    ctx.rotate(Math.max(-0.18, Math.min(0.18, b.angle)));
    const ref = (face.style && face.style.mainRadius) || r;
    const fs = (face.scale || 1) * Math.max(0.75, Math.min(1.5, Math.sqrt(ref / r)));
    ctx.scale(Math.min(1.4, st.x) * fs, Math.min(1.4, st.y) * fs);
    ctx.translate(0, -r * 0.08);
    if (face.nod) {
      // Nodding: the face dips down and tips forward a little.
      ctx.translate(0, face.nod * r * 0.14);
      ctx.scale(1, 1 - face.nod * 0.12);
    }
    if (face.shake) {
      // Trembling with strain.
      const k = r * 0.012 * face.shake;
      ctx.translate(Math.sin(performance.now() * 0.071) * k, Math.cos(performance.now() * 0.053) * k);
    }

    const s = Object.assign({}, FACE_DEFAULTS, face.style);
    const eh = r * 0.22 * s.eyeSize, ew = eh * s.eyeRoundness;
    const effort = face.effort || 'medium';
    // Low effort: eyes set a bit too far apart.
    const ex = r * 0.33 * s.eyeSpacing * (effort === 'low' ? 1.45 : 1), ey = -r * (0.1 + s.eyeHeight);
    // Look direction in the face's frame.
    let lx = face.look.x - c.x, ly = face.look.y - c.y;
    const ca = Math.cos(-b.angle), sa = Math.sin(-b.angle);
    [lx, ly] = [lx * ca - ly * sa, lx * sa + ly * ca];
    const ll = Math.hypot(lx, ly) || 1;
    const reach = Math.min(1, ll / (r * 3));
    const lookAmount = face.lookAmount ?? 1;
    const look = 0.45 * reach * s.lookAround * lookAmount;
    const pdx = (lx / ll) * ew * look, pdy = (ly / ll) * eh * look;
    let turnX = 0, turnY = 0; // how far the face has slid round the head
    const head = ctx.getTransform(); // the face's frame before it turns
    if (!s.eyeWhites) {
      // No whites to look around in, so the whole face turns: it slides
      // toward the mouse and squashes a little that way, like on a ball.
      const turn = reach * s.lookAround * lookAmount;
      const dir = Math.atan2(ly, lx);
      turnX = (lx / ll) * r * 0.32 * turn;
      turnY = (ly / ll) * r * 0.24 * turn;
      face.turnX = turnX * fs;
      face.turnY = turnY * fs;
      ctx.translate(turnX, turnY);
      const k = 0.22 * Math.min(1, turn);
      ctx.scale(1 - k * Math.abs(Math.cos(dir)), 1 - k * Math.abs(Math.sin(dir)));
    }

    const ink = s.faceInk;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = r * 0.06 * s.faceLine;
    ctx.strokeStyle = ink;

    for (const side of [-1, 1]) {
      const x = side * ex, y = ey;
      switch (face.expression) {
        case 'happy':
          ctx.beginPath();
          ctx.arc(x, y + eh * 0.25, ew * 0.85, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
          break;
        case 'dizzy':
          // Squeezed shut: > on the left eye, < on the right, tips pointing in.
          ctx.beginPath();
          ctx.moveTo(x + side * ew * 0.6, y - eh * 0.55);
          ctx.lineTo(x - side * ew * 0.6, y);
          ctx.lineTo(x + side * ew * 0.6, y + eh * 0.55);
          ctx.stroke();
          break;
        case 'concentrate':
          // Eyes squeezed shut in deep concentration: tight downward arcs.
          ctx.beginPath();
          ctx.arc(x, y - eh * 0.35, ew * 0.8, Math.PI * 0.2, Math.PI * 0.8);
          ctx.stroke();
          break;
        case 'pained':
          // Squeezed shut, slanting down toward the nose.
          ctx.beginPath();
          ctx.moveTo(x + side * ew * 0.75, y - eh * 0.35);
          ctx.quadraticCurveTo(x, y - eh * 0.05, x - side * ew * 0.75, y + eh * 0.2);
          ctx.stroke();
          break;
        case 'sleepy':
          ctx.beginPath();
          ctx.arc(x, y, ew * 0.8, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
          break;
        case 'annoyed': {
          // Narrowed eyes: the bottom half of an eye.
          ctx.fillStyle = ink;
          ctx.beginPath();
          ctx.ellipse(x, y + eh * 0.05, ew * 0.85, eh * 0.6, 0, 0, Math.PI);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'meditate':
          // Calm, half-closed white eyes.
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.ellipse(x, y - eh * 0.1, ew * 1.25, eh * 0.65, 0, 0, Math.PI);
          ctx.fill();
          break;
        default: {
          const open = Math.max(0.08, 1 - face.blink) * (face.squint ? 0.3 : 1);
          if (effort === 'low') {
            // Vacant little beads.
            ctx.fillStyle = ink;
            ctx.beginPath();
            ctx.ellipse(x, y + eh * 0.15, ew * 0.6, ew * 0.6 * Math.max(0.15, open), 0, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          if (effort === 'xhigh') {
            // Plain white eyes, no pupils.
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.ellipse(x, y, ew * 1.25, eh * 1.1 * open, 0, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          if (!s.eyeWhites) {
            // Solid eyes; the whole face turns to look around instead.
            ctx.fillStyle = ink;
            ctx.beginPath();
            ctx.ellipse(x, y, ew * 0.8, eh * 0.8 * open, 0, 0, Math.PI * 2);
            ctx.fill();
            if (s.eyeShine && open > 0.3) {
              ctx.fillStyle = '#fff';
              ctx.beginPath();
              ctx.arc(x - ew * 0.25, y - eh * 0.3 * open, ew * 0.22, 0, Math.PI * 2);
              ctx.fill();
            }
            break;
          }
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.ellipse(x, y, ew, eh * open, 0, 0, Math.PI * 2);
          ctx.fill();
          if (open > 0.3) {
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(x, y, ew, eh * open, 0, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = ink;
            ctx.beginPath();
            ctx.arc(x + pdx, y + pdy, ew * s.pupilSize, 0, Math.PI * 2);
            ctx.fill();
            if (s.eyeShine) {
              ctx.fillStyle = '#fff';
              ctx.beginPath();
              ctx.arc(x + pdx - ew * 0.22, y + pdy - ew * 0.25, ew * 0.2, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          }
        }
      }
      if (s.brows && (face.expression === 'worried' || face.expression === 'concentrate' || face.expression === 'pained' || face.expression === 'annoyed')) {
        // Concentrating: level brows that only sometimes pull together.
        // Annoyed: pulled down hard at the middle.
        const tilt = face.expression === 'concentrate' ? 0.9 * (face.furrow || 0) : face.expression === 'annoyed' ? 1.1 : -1;
        const lift = face.expression === 'concentrate' ? (face.raise || 0) * eh * 0.4 : 0;
        ctx.beginPath();
        ctx.moveTo(x - ew * side, y - eh * 1.35 + tilt * eh * 0.25 - lift);
        ctx.lineTo(x + ew * 0.7 * side, y - eh * 1.35 - tilt * eh * 0.25 - lift);
        ctx.stroke();
      }
    }

    if (face.glasses) glassesShape(ctx, r, s, 0, ey);

    // Cheeks.
    if (s.cheeks > 0) {
      ctx.save();
      const warm = isWarm(face.bodyColor);
      ctx.globalAlpha = warm ? s.cheeks : Math.max(s.cheeks, 0.7);
      ctx.fillStyle = warm ? s.cheekColor : '#ff86a6';
      // Cheeks sit on a round head, so they turn on a ball instead of
      // sliding with the rest of the face: one turning toward the edge moves
      // less and gets thinner, and they never show past the body's outline.
      ctx.setTransform(world);
      bodyPath(ctx, b);
      ctx.clip();
      ctx.setTransform(head);
      const R = r * 1.05;
      const angleOf = (v) => Math.asin(Math.max(-0.99, Math.min(0.99, v / R)));
      const yaw = angleOf(turnX), pitch = angleOf(turnY);
      for (const side of [-1, 1]) {
        const ax = angleOf(side * r * 0.55 * s.eyeSpacing), ay = angleOf(r * 0.14);
        const tx = ax + yaw, ty = ay + pitch;
        if (Math.abs(tx) > Math.PI / 2) continue; // turned out of sight
        const w = Math.min(1.1, Math.cos(tx) / Math.cos(ax)), h = Math.min(1.1, Math.cos(ty) / Math.cos(ay));
        ctx.beginPath();
        ctx.ellipse(R * Math.sin(tx), R * Math.sin(ty), r * 0.12 * w, r * 0.07 * h, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Mouth: drawn around its own centre so it can be resized.
    const my = r * (0.2 + s.mouthHeight);
    ctx.save();
    ctx.translate(0, my);
    ctx.scale(s.mouthSize, s.mouthSize);
    ctx.translate(0, -my);
    ctx.lineWidth = r * 0.06 * s.faceLine / s.mouthSize;
    ctx.beginPath();
    switch (face.mouth) {
      case 'o':
        ctx.fillStyle = ink;
        ctx.ellipse(0, my + r * 0.04, r * 0.08, r * 0.11, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'grin':
        ctx.fillStyle = ink;
        ctx.arc(0, my - r * 0.02, r * 0.14, 0, Math.PI);
        ctx.fill();
        break;
      case 'wobble': {
        // A shaky, clenched line.
        const w = r * 0.13;
        ctx.moveTo(-w, my);
        for (let i = 1; i <= 6; i++) ctx.lineTo(-w + (2 * w * i) / 6, my + (i % 2 ? -1 : 1) * r * 0.025);
        ctx.stroke();
        break;
      }
      case 'flat':
        ctx.moveTo(-r * 0.06, my); ctx.lineTo(r * 0.06, my);
        ctx.stroke();
        break;
      case 'worried':
        ctx.arc(0, my + r * 0.08, r * 0.08, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();
        break;
      case 'yawn':
        ctx.fillStyle = ink;
        ctx.ellipse(0, my + r * 0.05, r * 0.09, r * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'slack':
        // Hanging open, a little lopsided.
        ctx.fillStyle = ink;
        ctx.ellipse(r * 0.02, my + r * 0.02, r * 0.065, r * 0.045, 0.15, 0, Math.PI * 2);
        ctx.fill();
        break;
      default:
        ctx.arc(0, my - r * 0.06, r * 0.1, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
    }
    if (face.drool != null) drawDrool(ctx, r * 0.06, my + r * 0.05, r, face.drool);
    ctx.restore();
    ctx.restore();
  }

  // A drop of drool that slowly stretches down from the mouth corner, lets
  // go and falls. p runs 0..1 over one drip.
  function drawDrool(ctx, x, y, r, p) {
    const grow = Math.min(1, p / 0.8);
    const len = r * 0.4 * grow * grow;
    const fall = p > 0.8 ? ((p - 0.8) / 0.2) ** 2 * r * 0.8 : 0;
    const drop = r * (0.04 + 0.03 * grow);
    ctx.save();
    ctx.globalAlpha = p > 0.8 ? 1 - (p - 0.8) / 0.2 : 1;
    ctx.fillStyle = '#a9dcff';
    const strand = p > 0.8 ? len * (1 - (p - 0.8) / 0.2) : len;
    if (strand > 1) {
      ctx.beginPath();
      ctx.moveTo(x - drop * 0.55, y);
      ctx.quadraticCurveTo(x - drop * 0.3, y + strand * 0.6, x, y + strand);
      ctx.quadraticCurveTo(x + drop * 0.3, y + strand * 0.6, x + drop * 0.55, y);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y + len + fall, drop, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Round nerd glasses for a slime of radius r, the lenses centred on
  // (x ± eye spacing, y).
  function glassesShape(ctx, r, style, x, y) {
    const s = Object.assign({}, FACE_DEFAULTS, style);
    const ex = r * 0.33 * s.eyeSpacing, lr = r * (0.1 + 0.18 * s.eyeSize), rim = r * 0.05;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = s.faceInk;
    // Two rings (filled shapes, not lines) and a little bridge.
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(side * ex + lr + rim, 0);
      ctx.arc(side * ex, 0, lr + rim, 0, Math.PI * 2);
      ctx.moveTo(side * ex + lr, 0);
      ctx.arc(side * ex, 0, lr, 0, Math.PI * 2, true);
    }
    ctx.fill('evenodd');
    roundRect(ctx, -ex + lr, -rim * 0.9, (ex - lr) * 2, rim * 1.1, rim * 0.5);
    ctx.fill();
    ctx.restore();
  }

  function drawGlasses(ctx, x, y, r, angle, style) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    glassesShape(ctx, r, style, 0, 0);
    ctx.restore();
  }

  function drawDots(ctx, b, states, t) {
    if (!states.length) return;
    const c = b.centroid();
    const top = b.bbox().minY;
    const gap = 12, n = Math.min(states.length, 8);
    for (let i = 0; i < n; i++) {
      const s = states[i];
      const x = c.x + (i - (n - 1) / 2) * gap;
      const pulse = s === 'working' ? 1 + 0.25 * Math.sin(t * 6 + i) : s === 'waiting' ? 1 + 0.35 * Math.abs(Math.sin(t * 4)) : 1;
      ctx.beginPath();
      ctx.fillStyle = STATE_COLORS[s] || STATE_COLORS.idle;
      ctx.arc(x, top - 12, 4 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    }
  }

  const INK = '#1b2440';

  // --- Balloons ---------------------------------------------------------
  // Every bubble is the same white pill with the same short tail (or, for
  // a thought, two puffs), centred above its own slime's head and clear of
  // anything worn on it. Only what's inside differs: text, or a sign.

  // Balloons already placed this frame, so the next one can stack above
  // instead of overlapping. Cleared once a frame by setCrowd.
  let placed = [];
  function setCrowd() { placed = []; }

  const pillRadius = (h) => Math.min(h / 2, 16);
  const GAP = 8;

  function placeBalloon(b, w, h, W) {
    const c = b.centroid(), box = b.bbox();
    // The tail points down at the top of the head, or of what it's wearing.
    const top = b.lookTop != null ? Math.min(box.minY, b.lookTop) : box.minY;
    const tip = { x: c.x, y: top - 8 };
    const x = Math.max(8, Math.min(W - w - 8, c.x - w / 2));
    let y = tip.y - 14 - h;
    for (let tries = 0; tries < 6; tries++) {
      const hit = placed.find((o) => x < o.x + o.w + GAP && x + w + GAP > o.x && y < o.y + o.h + GAP && y + h + GAP > o.y);
      if (!hit) break;
      y = hit.y - GAP - h;
    }
    y = Math.max(8, y);
    placed.push({ x, y, w, h });
    return { tip, x, y };
  }

  // A balloon has weight: it chases its spot on a spring, so when its slime
  // hops or gets dragged it lags, swings and settles, and it's leashed to
  // the slime (never further than LEASH from its head). The state lives on
  // the slime's body. Returns where to draw it this frame.
  const LEASH = 150;
  function settle(body, target, w, h) {
    const now = performance.now() / 1000;
    const cx = target.x + w / 2, cy = target.y + h / 2;
    let s = body.balloon;
    if (!s || now - s.t > 0.5) s = body.balloon = { x: cx, y: cy, vx: 0, vy: 0, t: now, puffs: null };
    const dt = Math.min(0.05, now - s.t);
    s.t = now;
    s.vx += (150 * (cx - s.x) - 15 * s.vx) * dt;
    s.vy += (150 * (cy - s.y) - 15 * s.vy) * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const dx = s.x - target.tip.x, dy = s.y + h / 2 - target.tip.y, d = Math.hypot(dx, dy);
    if (d > LEASH) { s.x = target.tip.x + (dx / d) * LEASH; s.y = target.tip.y + (dy / d) * LEASH - h / 2; }
    // The leash is stiff the other way: the balloon never sinks onto the
    // head, even when the slime jumps up into it.
    const lowest = target.tip.y - 14 - h / 2;
    if (s.y > lowest) { s.y = lowest; if (s.vy > 0) s.vy = 0; }
    return { tip: target.tip, x: s.x - w / 2, y: s.y - h / 2, s };
  }

  // Draws the pill and what leashes it to its slime: a tail that stretches
  // and bends as the balloon lags, or for a thought, two puffs strung along
  // the leash that trail behind it.
  function drawBalloon(ctx, p, w, h, thought) {
    const { x, y, s } = p, rad = pillRadius(h);
    const mx = Math.max(x + rad, Math.min(x + w - rad, p.tip.x)), by = y + h - 4;
    // The leash ends a little way short of the head, at most 30px long.
    let tx = p.tip.x - mx, ty = p.tip.y - by;
    const len = Math.hypot(tx, ty) || 1, keep = Math.min(len, 30) / len;
    const tip = { x: mx + tx * keep, y: by + ty * keep };
    // It bends away from the way the balloon is moving.
    const bend = s ? Math.max(-18, Math.min(18, -s.vx * 0.05)) : 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    if (thought) {
      const ideal = [[0.4, 6.5], [0.85, 4]].map(([k, r]) => ({
        x: mx + (tip.x - mx) * k + bend * k * (1 - k) * 2, y: by + 6 + (tip.y - by - 6) * k, r,
      }));
      if (s && s.puffs) s.puffs.forEach((q, i) => { q.x += (ideal[i].x - q.x) * 0.25; q.y += (ideal[i].y - q.y) * 0.25; });
      else if (s) s.puffs = ideal.map((q) => ({ x: q.x, y: q.y }));
      const puffs = s ? s.puffs : ideal;
      puffs.forEach((q, i) => {
        ctx.moveTo(q.x + ideal[i].r, q.y);
        ctx.arc(q.x, q.y, ideal[i].r, 0, Math.PI * 2);
      });
    } else {
      const midX = (mx + tip.x) / 2 + bend, midY = (by + tip.y) / 2;
      ctx.moveTo(mx - 9, by);
      ctx.quadraticCurveTo(midX - 3, midY, tip.x, tip.y);
      ctx.quadraticCurveTo(midX + 4, midY, mx + 9, by);
      ctx.closePath();
    }
    ctx.fill();
    roundRect(ctx, x, y, w, h, rad);
    ctx.fill();
  }

  // A balloon with a sign in it ("!", "?", a gear...). draw(x, y, size)
  // draws the sign around the middle.
  function drawIconBalloon(ctx, b, t, W, thought, draw) {
    // One size for every sign balloon, to match a one-line text bubble.
    const h = 44, w = 58;
    const p = settle(b, placeBalloon(b, w, h, W), w, h);
    ctx.save();
    drawBalloon(ctx, p, w, h, thought);
    ctx.fillStyle = ctx.strokeStyle = INK;
    draw(p.x + w / 2, p.y + h / 2, h / 2);
    ctx.restore();
  }

  // While Claude works: a thought balloon with a spinning gear while it
  // thinks, a blinking >_ while it runs a tool.
  function drawThinking(ctx, b, t, running, W) {
    drawIconBalloon(ctx, b, t, W, true, (x, y, s) => {
      if (running) {
        // A prompt: a chunky > and a cursor bar that fades in and out.
        ctx.lineWidth = s * 0.3;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x - s * 0.62, y - s * 0.42);
        ctx.lineTo(x - s * 0.18, y);
        ctx.lineTo(x - s * 0.62, y + s * 0.42);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + s * 0.1, y + s * 0.42);
        ctx.lineTo(x + s * 0.62, y + s * 0.42);
        ctx.stroke();
        return;
      }
      // A gear: teeth around a ring, turning.
      const g = s * 0.72, teeth = 8;
      ctx.translate(x, y);
      ctx.rotate(t * 2.2);
      ctx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rr = i % 2 ? g * 0.78 : g;
        ctx.lineTo(Math.cos(a - 0.12) * rr, Math.sin(a - 0.12) * rr);
        ctx.lineTo(Math.cos(a + 0.12) * rr, Math.sin(a + 0.12) * rr);
      }
      ctx.closePath();
      ctx.moveTo(g * 0.32, 0);
      ctx.arc(0, 0, g * 0.32, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    });
  }

  // A background task's pet: a little rigid box with two black beady eyes
  // that keep watching its slime. p: { x, y, size, angle, sway, color,
  // lx, ly (toward its slime), blink, happy, heart (seconds since it
  // arrived back by its slime) }.
  function drawPet(ctx, p, floorY, shadow) {
    const size = p.size;
    if (size <= 1) return;
    const h = size / 2;
    if (shadow) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.25 - (floorY - p.y - h) / 600);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(p.x, floorY - 1, h * 1.1, h * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    // Sway rocks it on its bottom edge; angle tilts it around its middle.
    ctx.translate(p.x, p.y + h);
    ctx.rotate(p.sway);
    ctx.translate(0, -h);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.color;
    roundRect(ctx, -h, -h, size, size, size * 0.16);
    ctx.fill();
    ctx.fillStyle = ctx.strokeStyle = '#0d0f17';
    ctx.lineCap = 'round';
    ctx.lineWidth = size * 0.06;
    const er = size * 0.07;
    for (const sx of [-1, 1]) {
      const ex = sx * size * 0.2, ey = -size * 0.06;
      ctx.beginPath();
      if (p.happy) {
        // Happy eyes: little upturned arcs.
        ctx.arc(ex, ey + er * 0.6, er * 1.3, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      } else if (p.blink) {
        ctx.moveTo(ex - er, ey); ctx.lineTo(ex + er, ey);
        ctx.stroke();
      } else {
        // Beady eyes, glancing toward its slime.
        const ca = Math.cos(-p.angle - p.sway), sa = Math.sin(-p.angle - p.sway);
        const dx = p.lx * ca - p.ly * sa, dy = p.lx * sa + p.ly * ca;
        ctx.ellipse(ex + dx * size * 0.05, ey + dy * size * 0.04, er, er * 1.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    if (p.heart < 1.8) drawHeart(ctx, p.x, p.y - h - 8, size * 0.32, p.heart);
  }

  // A small heart that pops up, floats a little and fades.
  function drawHeart(ctx, x, y, s, t) {
    // Pops in with a little overshoot.
    const k = Math.min(1, t / 0.25) - 1;
    const pop = 1 + 2.7 * k * k * k + 1.7 * k * k;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1.8 - t) / 0.6);
    ctx.translate(x, y - t * 10);
    ctx.scale(pop, pop);
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath();
    ctx.moveTo(0, s * 0.9);
    ctx.bezierCurveTo(-s * 1.4, -s * 0.1, -s * 0.6, -s * 1.1, 0, -s * 0.35);
    ctx.bezierCurveTo(s * 0.6, -s * 1.1, s * 1.4, -s * 0.1, 0, s * 0.9);
    ctx.fill();
    ctx.restore();
  }

  // A red flush around the face, like a blush spreading out from it; amount
  // 0..1 makes it stronger and a little wider.
  // s: the flush settings (see the tuning panel); turn: how far the face
  // has slid round the head, so the flush can follow it.
  function drawFlush(ctx, b, amount, s, turn) {
    if (amount <= 0) return;
    const c = b.centroid(), r = b.o.radius;
    const n = parseInt(s.flushColor.slice(1), 16), rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    const x = c.x + r * s.flushX + (s.flushFollowFace && turn ? turn.x : 0);
    const y = c.y + r * s.flushY + (s.flushFollowFace && turn ? turn.y : 0);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * (s.flushRadius + s.flushGrow * amount));
    g.addColorStop(0, `rgba(${rgb},${s.flushCore * amount})`);
    g.addColorStop(s.flushMidAt, `rgba(${rgb},${s.flushMid * amount})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.save();
    ctx.fillStyle = g;
    bodyPath(ctx, b);
    ctx.fill();
    ctx.restore();
  }

  // Sweat drops that bead up on the upper sides of the body, then run down
  // it. More of them the more it sweats. Each drop sticks to one skin point
  // for its whole trip, so it moves with the body, and they're clipped to
  // the body so they never hang off its edge.
  const SWEAT_DROPS = 5;
  function drawSweat(ctx, b, t, amount) {
    const c = b.centroid();
    const r = b.o.radius;
    const drops = b.sweat || (b.sweat = []);
    ctx.save();
    bodyPath(ctx, b);
    ctx.clip();
    for (let i = 0; i < SWEAT_DROPS; i++) {
      const show = Math.max(0, Math.min(1, amount * SWEAT_DROPS - i));
      if (show <= 0) continue;
      const phase = t * 0.55 + i / SWEAT_DROPS;
      const cycle = Math.floor(phase), p = phase - cycle;
      const side = i % 2 ? 1 : -1;
      let d = drops[i];
      if (!d || d.cycle !== cycle || d.j >= b.n) {
        // A new drop: pick a spot up and to the side, a bit different each time.
        const a = -Math.PI / 2 + side * (0.55 + 0.5 * Math.random());
        const sx = c.x + Math.cos(a) * r, sy = c.y + Math.sin(a) * r;
        let j = 0, best = Infinity;
        for (let k = 0; k < b.n; k++) {
          const dd = Math.hypot(b.px[k] - sx, b.py[k] - sy);
          if (dd < best) { best = dd; j = k; }
        }
        d = drops[i] = { cycle, j };
      }
      // Starts just inside the skin and runs down the body.
      const sx = b.px[d.j], sy = b.py[d.j];
      const x = sx + (c.x - sx) * 0.12, y = sy + (c.y - sy) * 0.12 + p * p * r * 0.7;
      const s = r * 0.05 * (0.6 + Math.min(1, p * 4) * 0.6);
      ctx.globalAlpha = show * Math.min(1, p * 6) * (1 - p);
      ctx.fillStyle = '#9fd8ff';
      ctx.beginPath();
      ctx.moveTo(x, y - s * 2);
      ctx.quadraticCurveTo(x + s * 1.1, y - s * 0.2, x, y + s);
      ctx.quadraticCurveTo(x - s * 1.1, y - s * 0.2, x, y - s * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Z's that float up from a sleeping slime, growing as they fade away.
  function drawZzz(ctx, b, t) {
    const c = b.centroid();
    const r = b.o.radius;
    const top = b.bbox().minY;
    const k = Math.max(0.6, Math.min(1.4, r / 100));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.4 + i / 3) % 1;
      const a = Math.min(1, p * 5) * (1 - p);
      ctx.globalAlpha = a;
      ctx.font = `800 ${Math.round((11 + p * 13) * k)}px ${family}`;
      ctx.fillStyle = '#fff';
      ctx.fillText('Z', c.x + r * 0.45 + p * 34 * k + Math.sin(t * 2 + i * 2) * 4, top - p * 60 * k);
    }
    ctx.restore();
  }

  // A "!" balloon by a slime that finished its work, or a "?" one by a
  // slime waiting for your answer.
  function drawExclaim(ctx, b, t, W, glyph = '!') {
    drawIconBalloon(ctx, b, t, W, false, (x, y, s) => {
      if (glyph === 'check') {
        ctx.lineWidth = s * 0.3;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x - s * 0.5, y + s * 0.02);
        ctx.lineTo(x - s * 0.14, y + s * 0.36);
        ctx.lineTo(x + s * 0.52, y - s * 0.34);
        ctx.stroke();
        return;
      }
      ctx.font = `900 ${Math.round(s * 1.4)}px ${family}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, x, y + s * 0.06);
    });
  }

  // The font for all text: names, bubbles, Z's. Set from the Font setting.
  const SYSTEM_FONT = '-apple-system, "Segoe UI", system-ui, sans-serif';
  let family = SYSTEM_FONT;
  function setFont(name) {
    family = !name || name === 'System' ? SYSTEM_FONT : `"${name}", ${SYSTEM_FONT}`;
  }

  function drawLabel(ctx, b, text) {
    const c = b.centroid();
    const top = b.bbox().minY;
    ctx.save();
    ctx.font = `600 11px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(text).width + 12;
    const y = Math.max(2, top - 40);
    ctx.fillStyle = 'rgba(20,26,46,0.72)';
    roundRect(ctx, c.x - w / 2, y, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, c.x, y + 2.5);
    ctx.restore();
  }

  // A balloon with lines of text: [{ text, color?, size? }]. The first line
  // (a name) is bold in the chosen font; the rest are in the plain UI font
  // so they stay readable whatever the font. A line with a size is a lone
  // emoji.
  function drawBubble(ctx, b, lines, alpha, W) {
    if (!lines.length || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = 'middle';
    const padX = 18, padY = 11;
    const named = lines.length > 1;
    const font = (l, i) => (l.size ? `${l.size}px "Segoe UI Emoji", "Apple Color Emoji", system-ui, sans-serif`
      : named && i === 0 ? `700 17px ${family}` : l.dim ? `600 13px ${SYSTEM_FONT}` : `600 15px ${SYSTEM_FONT}`);
    const lineH = (l, i) => (l.size ? l.size + 8 : named && i === 0 ? 24 : 22);
    const w = Math.min(360, Math.max(...lines.map((l, i) => { ctx.font = font(l, i); return ctx.measureText(l.text).width + (l.color ? 16 : 0); })) + padX * 2);
    const h = lines.reduce((sum, l, i) => sum + lineH(l, i), 0) + padY * 2 - 2;
    const p = settle(b, placeBalloon(b, w, h, W), w, h);
    drawBalloon(ctx, p, w, h, false);
    let ly = p.y + padY - 1;
    lines.forEach((l, i) => {
      ctx.font = font(l, i);
      ly += lineH(l, i) / 2;
      let lx = p.x + padX;
      if (l.color) {
        ctx.fillStyle = l.color;
        ctx.beginPath();
        ctx.arc(lx + 5, ly, 5, 0, Math.PI * 2);
        ctx.fill();
        lx += 16;
      }
      ctx.fillStyle = l.dim ? '#6b7280' : INK;
      ctx.fillText(ellipsize(ctx, l.text, w - (lx - p.x) - padX), lx, ly);
      ly += lineH(l, i) / 2;
    });
    ctx.restore();
  }

  function ellipsize(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
    return text + '…';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  root.BlaubeDraw = { setFont, setCrowd, drawHeart, drawShadow, drawBody, vary, drawFace, drawGlasses, drawDots, drawThinking, drawZzz, drawFlush, drawSweat, drawPet, drawExclaim, drawLabel, drawBubble, STATE_COLORS };
})(globalThis);
