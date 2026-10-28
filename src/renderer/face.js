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
    // side after a tumble looks broken, not cute. Held up, though, it turns
    // all the way with the body.
    // (Held, it turns with the body as far as turnAmt says: see faceFor.)
    const lean = Math.max(-0.18, Math.min(0.18, b.angle));
    ctx.rotate(face.fullTurn ? b.angle : lean + (b.angle - lean) * (face.turnAmt || 0));
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
    const eh0 = eh, ew0 = ew;
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
      // Not past the edge of the body (a narrow, stretched one has less room).
      const bx = b.bbox(), roomX = ((bx.maxX - bx.minX) / 2) / (Math.min(1.4, st.x) * fs) * 0.92 - ex - ew;
      turnX = Math.max(-Math.max(0, roomX), Math.min(Math.max(0, roomX), turnX));
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

    // Hovered while it works, its eyes open (peek eases 0..1): past a
    // squeeze they're open eyes, opening the rest of the way.
    const peek = face.peek || 0;
    const eyes = (face.expression === 'concentrate' || face.expression === 'meditate') && peek > 0.15 ? 'open' : face.expression;
    const opening = eyes === 'open' ? 0.15 + 0.85 * Math.min(1, (peek - 0.15) / 0.7) : 1;
    for (const side of [-1, 1]) {
      const x = side * ex, y = ey;
      switch (eyes) {
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
          ctx.beginPath();
          if (face.squeeze) {
					// Holding its breath (the balloon trick): > on the left eye, < on the right, tips pointing in.
					ctx.moveTo(x + side * ew * 0.6, y - eh * 0.55);
					ctx.lineTo(x - side * ew * 0.6, y);
					ctx.lineTo(x + side * ew * 0.6, y + eh * 0.55);
				} else {
					// Squeezed shut, slanting down toward the nose.
					ctx.moveTo(x + side * ew * 0.75, y - eh * 0.35);
					ctx.quadraticCurveTo(x, y - eh * 0.05, x - side * ew * 0.75, y + eh * 0.2);
				}
          ctx.stroke();
          break;
        case 'sleepy':
          ctx.beginPath();
          ctx.arc(x, y, ew * 0.8, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
          break;
        case 'annoyed':
        case 'peek': {
          // Narrowed eyes: the bottom half of an eye (annoyed, or a busy
          // slime peeking up at you from its work).
          ctx.fillStyle = ink;
          ctx.beginPath();
          ctx.ellipse(x, y + eh * 0.05, ew * 0.85, eh * 0.6, 0, 0, Math.PI);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'sad': {
          // Droopy: the top lid comes down, lower at the outer corner, and
          // it looks down.
          const open = Math.max(0.08, 1 - face.blink);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x - side * ew * 1.3, y - eh * 0.2);
          ctx.lineTo(x + side * ew * 1.3, y + eh * 0.25);
          ctx.lineTo(x + side * ew * 1.3, y + eh * 2);
          ctx.lineTo(x - side * ew * 1.3, y + eh * 2);
          ctx.closePath();
          ctx.clip();
          ctx.fillStyle = s.eyeWhites ? '#fff' : ink;
          ctx.beginPath();
          ctx.ellipse(x, y + eh * 0.1, ew * (s.eyeWhites ? 1 : 0.8), eh * (s.eyeWhites ? 1 : 0.8) * open, 0, 0, Math.PI * 2);
          ctx.fill();
          if (s.eyeWhites && open > 0.3) {
            ctx.fillStyle = ink;
            ctx.beginPath();
            ctx.arc(x, y + eh * 0.45, ew * s.pupilSize, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
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
          const open = Math.max(0.08, (1 - face.blink) * opening) * (face.squint ? 0.3 : 1);
          const wk = 1 + 0.35 * (face.wide || 0); // wide eyes when startled
          const ew = ew0 * wk, eh = eh0 * wk;
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
            // face.eyeKind picks a shape (to tell models apart), always
            // solid ink: round 'dot's, 'tall' ovals, 'wide' ones, or 'small'.
            const kind = face.eyeKind || 'dot';
            const [kw, kh] = { tall: [0.8, 1.45], wide: [1.35, 0.75], small: [0.72, 0.72] }[kind] || [1, 1];
            ctx.fillStyle = ink;
            ctx.beginPath();
            ctx.ellipse(x, y, ew * 0.8 * kw, eh * 0.8 * kh * open, 0, 0, Math.PI * 2);
            ctx.fill();
            if (s.eyeShine && open > 0.3 && kind === 'dot') {
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
      if (s.brows && !face.squeeze && (face.expression === 'worried' || face.expression === 'concentrate' || face.expression === 'pained' || face.expression === 'annoyed' || face.expression === 'peek' || face.expression === 'sad')) {
        // Concentrating: level brows that only sometimes pull together.
        // Annoyed: pulled down hard at the middle. Peeking: level and calm.
        // Sad: steeply up at the middle.
        const tilt = face.expression === 'concentrate' ? 0.9 * (face.furrow || 0) : face.expression === 'annoyed' ? 1.1 : face.expression === 'peek' ? 0 : face.expression === 'sad' ? -2 : -1;
        const lift = face.expression === 'concentrate' ? (face.raise || 0) * eh * 0.4 : 0;
        ctx.beginPath();
        ctx.moveTo(x - ew * side, y - eh * 1.35 + tilt * eh * 0.25 - lift);
        ctx.lineTo(x + ew * 0.7 * side, y - eh * 1.35 - tilt * eh * 0.25 - lift);
        ctx.stroke();
      }
    }

    if (face.glasses) glassesShape(ctx, r, s, 0, ey);

    // Cheeks.
		// (Full of air, they puff out: bigger, rounder, further out, and they show
		// even on a face that has none.)
		const puffed = face.puffed || 0;
		if (s.cheeks > 0 || puffed > 0) {
      ctx.save();
      const warm = isWarm(face.bodyColor);
			ctx.globalAlpha = Math.max(warm ? s.cheeks : Math.max(s.cheeks, 0.7), 0.55 * puffed);
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
				const ax = angleOf(side * r * (0.55 + 0.14 * puffed) * s.eyeSpacing), ay = angleOf(r * (0.14 + 0.1 * puffed));
        const tx = ax + yaw, ty = ay + pitch;
        if (Math.abs(tx) > Math.PI / 2) continue; // turned out of sight
        const w = Math.min(1.1, Math.cos(tx) / Math.cos(ax)), h = Math.min(1.1, Math.cos(ty) / Math.cos(ay));
        const cx = R * Math.sin(tx), cy = R * Math.sin(ty), cw = r * (0.12 + 0.11 * puffed) * w, ch = r * (0.07 + 0.15 * puffed) * h; // (full of air: big round cheeks)
        // face.cheekKind picks a blush (to tell models apart): soft 'oval's,
        // three slanted 'lines', 'freckles', or little 'hearts'.
        const ck = puffed > 0.3 ? 'oval' : face.cheekKind || 'oval';
        ctx.beginPath();
        if (ck === 'lines') {
          ctx.save();
          ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 2.2);
          ctx.strokeStyle = ctx.fillStyle; ctx.lineCap = 'round'; ctx.lineWidth = r * 0.028;
          for (let k = -1; k <= 1; k++) { ctx.moveTo(cx + k * cw * 0.55 - cw * 0.18, cy + ch * 0.55); ctx.lineTo(cx + k * cw * 0.55 + cw * 0.18, cy - ch * 0.55); }
          ctx.stroke();
          ctx.restore();
        } else if (ck === 'freckles') {
          ctx.save();
          ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 2.2);
          for (const [fx, fy] of [[-0.45, -0.2], [0.1, 0.25], [0.5, -0.25]]) { ctx.moveTo(cx + fx * cw + r * 0.03, cy + fy * ch); ctx.arc(cx + fx * cw, cy + fy * ch, r * 0.03, 0, Math.PI * 2); }
          ctx.fill();
          ctx.restore();
        } else if (ck === 'hearts') {
          ctx.save();
          ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 1.8);
          const k = ch * 1.35;
          ctx.moveTo(cx, cy + k * 0.9);
          ctx.bezierCurveTo(cx - k * 1.4, cy - k * 0.1, cx - k * 0.6, cy - k * 1.1, cx, cy - k * 0.35);
          ctx.bezierCurveTo(cx + k * 0.6, cy - k * 1.1, cx + k * 1.4, cy - k * 0.1, cx, cy + k * 0.9);
          ctx.fill();
          ctx.restore();
        } else {
				ctx.ellipse(cx, cy, cw, ch, 0, 0, Math.PI * 2);
        ctx.fill();
        }
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
      case 'talk': {
        // Babbling: the jaw drops with each syllable (the top lip stays),
        // a little wider for "ee", rounder for "oo", never bigger than a
        // yawn. Shut, the slime's own mouth is drawn instead.
        const m = face.talk || {}, open = m.open || 0, wide = m.wide ?? 0.6, round = m.round ?? 0.3;
        const h = r * (0.045 + 0.075 * open);
        let w = r * (0.075 + 0.03 * (wide - 0.6) * open);
        w += (h * 0.85 - w) * round * open * 0.6;
        w = Math.max(w, h / 1.5);
        const cy = my - ctx.lineWidth / 2 + h;
        ctx.fillStyle = ink;
        ctx.ellipse(0, cy, w, h, 0, 0, Math.PI * 2);
        ctx.fill();
        if (open > 0.6) {
          // The tongue rises from the bottom lip as it opens.
          const k = Math.min(1, (open - 0.6) * 4);
          ctx.save();
          ctx.clip();
          ctx.fillStyle = '#e86a82';
          ctx.beginPath();
          ctx.ellipse(0, cy + h * (1.05 - 0.5 * k), w * 0.75 * k, h * 0.5 * k, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        break;
      }
      case 'raspberry': {
        // Pursed lips with the tongue stuck out, fluttering; blowing the air
        // out of a balloon, it flaps about wildly (face.blow).
        const blow = face.blow ? 1 : 0;
        const flap = Math.sin((face.t ?? performance.now() / 1000) * 70) * r * 0.012 + blow * (Math.random() - 0.5) * r * 0.07;
        if (blow) ctx.translate((Math.random() - 0.5) * r * 0.035, (Math.random() - 0.5) * r * 0.02);
        ctx.moveTo(-r * 0.1, my); ctx.lineTo(r * 0.1, my);
        ctx.stroke();
        ctx.fillStyle = '#e86a82';
        ctx.beginPath();
        ctx.ellipse(0, my, r * 0.085, r * 0.12 + flap, 0, 0, Math.PI);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth *= 0.5;
        ctx.beginPath();
        ctx.moveTo(0, my); ctx.lineTo(0, my + r * 0.07 + flap);
        ctx.stroke();
        break;
      }
			case 'puffed':
				// Lips pressed tight on a mouthful of air: short and squeezed,
				// the corners pinched down a touch.
				ctx.moveTo(-r * 0.05, my + r * 0.015);
				ctx.quadraticCurveTo(0, my - r * 0.02, r * 0.05, my + r * 0.015);
				ctx.stroke();
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

  function placeBalloon(b, w, h, W, gap = 14) {
    const c = b.centroid(), box = b.bbox();
    // The tail points down at the top of the head, or of what it's wearing.
    const top = b.lookTop != null ? Math.min(box.minY, b.lookTop) : box.minY;
    const tip = { x: c.x, y: top - 8 };
    const x = Math.max(8, Math.min(W - w - 8, c.x - w / 2));
    let y = tip.y - gap - h;
    for (let tries = 0; tries < 6; tries++) {
      const hit = placed.find((o) => x < o.x + o.w + GAP && x + w + GAP > o.x && y < o.y + o.h + GAP && y + h + GAP > o.y);
      if (!hit) break;
      y = hit.y - GAP - h;
    }
    y = Math.max(8, y);
    placed.push({ x, y, w, h });
    return { tip, x, y, gap };
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
    s.dt = dt;
    s.vx += (150 * (cx - s.x) - 15 * s.vx) * dt;
    s.vy += (150 * (cy - s.y) - 15 * s.vy) * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const dx = s.x - target.tip.x, dy = s.y + h / 2 - target.tip.y, d = Math.hypot(dx, dy);
    if (d > LEASH) { s.x = target.tip.x + (dx / d) * LEASH; s.y = target.tip.y + (dy / d) * LEASH - h / 2; }
    // The leash is stiff the other way: the balloon never sinks onto the
    // head, even when the slime jumps up into it.
    const lowest = target.tip.y - (target.gap || 14) - h / 2;
    if (s.y > lowest) { s.y = lowest; if (s.vy > 0) s.vy = 0; }
    // And never off the top of the screen.
    if (s.y < 8 + h / 2) { s.y = 8 + h / 2; if (s.vy < 0) s.vy = 0; }
    return { tip: target.tip, x: s.x - w / 2, y: s.y - h / 2, s };
  }

  // Draws the pill and what leashes it to its slime: a tail that stretches
  // and bends as the balloon lags, or for a thought, two puffs strung along
  // the leash that trail behind it.
  function drawBalloon(ctx, p, w, h, thought) {
    const { x, y, s } = p, rad = pillRadius(h);
    const mx = Math.max(x + rad, Math.min(x + w - rad, p.tip.x)), by = y + h - 4;
    // The leash ends a little way short of the head, at most 24px long.
    let tx = p.tip.x - mx, ty = p.tip.y - by;
    const len = Math.hypot(tx, ty) || 1, keep = Math.min(len, 24) / len;
    const tip = { x: mx + tx * keep, y: by + ty * keep };
    // It bends away from the way the balloon is moving.
    const bend = s ? Math.max(-18, Math.min(18, -s.vx * 0.05)) : 0;
    ctx.fillStyle = '#fff';
    let tail = false;
    ctx.beginPath();
    if (thought) {
      // Two separate puffs at set places under the bubble (not along the
      // leash, which can be short: they'd merge or land on the head), never
      // below the top of the head.
      const dir = Math.max(-0.6, Math.min(0.6, (tip.x - mx) / 30));
      const low = Math.min(y + h + 22, p.tip.y - 4.5); // the small one, clear of the head
      const high = Math.min(y + h + 9, low - 11); // the bigger one, always apart from it
      const ideal = [[high, 6, 0.4, 10], [low, 3.8, 1, 22]].map(([py, r, k, down]) => ({
        x: mx + dir * down + bend * k * 0.3, y: py, r,
      }));
      const follow = 1 - Math.pow(0.75, (s ? s.dt || 0 : 0) * 144); // (a quarter of the way per 144 Hz frame, however often it's drawn)
      if (s && s.puffs) s.puffs.forEach((q, i) => { q.x += (ideal[i].x - q.x) * follow; q.y += (ideal[i].y - q.y) * follow; });
      else if (s) s.puffs = ideal.map((q) => ({ x: q.x, y: q.y }));
      const puffs = s ? s.puffs : ideal;
      puffs.forEach((q, i) => {
        ctx.moveTo(q.x + ideal[i].r, q.y);
        ctx.arc(q.x, q.y, ideal[i].r, 0, Math.PI * 2);
      });
    } else {
		// A pointed wedge, the talk box's tail made small: wide where it joins
		// the bubble, narrowing to a sharp point (softened by a pixel below).
		const midX = (mx + tip.x) / 2 + bend, midY = (by + tip.y) / 2;
		const dx = tip.x - mx, dy = tip.y - by, l = Math.hypot(dx, dy) || 1;
		const nx = -dy / l, ny = dx / l, k = 7;
		ctx.moveTo(mx - 12, by);
		ctx.quadraticCurveTo(midX + nx * k, midY + ny * k, tip.x, tip.y);
		ctx.quadraticCurveTo(midX - nx * k, midY - ny * k, mx + 12, by);
		ctx.closePath();
		tail = true;
    }
    ctx.fill();
    if (tail) { ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round'; ctx.lineWidth = 1.5; ctx.stroke(); } // same white: only rounds the point by under a pixel
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, rad);
    ctx.fill();
  }

  // A balloon with a sign in it ("!", "?", a gear...). draw(x, y, size)
  // draws the sign around the middle.
  function drawIconBalloon(ctx, b, t, W, thought, draw) {
    // One size for every sign balloon, to match a one-line text bubble.
    const h = 44, w = 58;
    const p = settle(b, placeBalloon(b, w, h, W, thought ? 30 : 14), w, h);
    ctx.save();
    drawBalloon(ctx, p, w, h, thought);
    ctx.fillStyle = ctx.strokeStyle = INK;
    draw(p.x + w / 2, p.y + h / 2, h / 2);
    ctx.restore();
  }

  // Fast asleep, a dream: what it was last working on.
  function drawDream(ctx, b, t, W, what) {
    return drawThinking(ctx, b, t, what, W);
  }

  // While Claude works: a thought balloon with what it's doing in it. A
  // spinning gear while it thinks; while a tool runs, a sign for what the
  // tool is about (shared/actions.js): a magnifier that scans, a pencil
  // that scribbles, a test tube that bubbles, a tick, arrows for a push or
  // a pull, a box, a bin, a folder, a globe, a checklist, two little
  // slimes for a helper, a plug for a connected app, and the prompt >_ for
  // any other command. All flat ink, chunky and round.
  function drawThinking(ctx, b, t, act, W) {
    drawIconBalloon(ctx, b, t, W, true, (x, y, s0) => {
      const s = act === 'thinking' || !act ? s0 : s0 * 1.18; // the signs a touch bigger than the gear
      ctx.lineWidth = s * 0.2;
      ctx.lineCap = ctx.lineJoin = 'round';
      const line = (pts) => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * s, y + py * s) : ctx.moveTo(x + px * s, y + py * s))); ctx.stroke(); };
      const ring = (cx, cy, r) => { ctx.beginPath(); ctx.arc(x + cx * s, y + cy * s, r * s, 0, Math.PI * 2); ctx.stroke(); };
      const dot = (cx, cy, r) => { ctx.beginPath(); ctx.arc(x + cx * s, y + cy * s, r * s, 0, Math.PI * 2); ctx.fill(); };
      const box = (x0, y0, w, h, rr) => { ctx.beginPath(); roundRect(ctx, x + x0 * s, y + y0 * s, w * s, h * s, rr * s); ctx.stroke(); };
      switch (act) {
        case 'read': { // a magnifier, scanning side to side
          const dx = Math.sin(t * 3) * 0.12;
          ctx.lineWidth = s * 0.26;
          ring(-0.12 + dx, -0.1, 0.34);
          ctx.lineWidth = s * 0.28;
          line([[0.16 + dx, 0.18], [0.5 + dx, 0.52]]);
          return;
        }
        case 'edit': { // a pencil, scribbling: body, a sharpened tip, an eraser
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(2.36 + Math.sin(t * 9) * 0.1); // tip down to the left
          const w = 0.23 * s;
          ctx.beginPath(); roundRect(ctx, -0.72 * s, -w, 1.0 * s, w * 2, 0.07 * s); ctx.fill(); // body
          ctx.beginPath(); ctx.moveTo(0.28 * s, -w); ctx.lineTo(0.66 * s, 0); ctx.lineTo(0.28 * s, w); ctx.closePath(); ctx.fill(); // tip
          ctx.fillStyle = '#fff'; // a gap before the eraser (the bubble's white)
          ctx.fillRect(-0.5 * s, -w * 1.2, 0.1 * s, w * 2.4);
          ctx.restore();
          return;
        }
        case 'test': { // a round flask, half full, bubbles rising out of it
          ctx.beginPath();
          ctx.moveTo(x - 0.13 * s, y - 0.56 * s); ctx.lineTo(x - 0.13 * s, y - 0.2 * s);
          ctx.arc(x, y + 0.18 * s, 0.4 * s, -Math.PI / 2 - 0.33, -Math.PI / 2 + 0.33 + Math.PI * 2 - 0.0001, true);
          ctx.lineTo(x + 0.13 * s, y - 0.56 * s);
          ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y + 0.18 * s, 0.4 * s, 0.05, Math.PI - 0.05); ctx.closePath(); ctx.fill(); // what's in it
          for (let i = 0; i < 2; i++) { const k = (t * 0.8 + i * 0.5) % 1; ctx.globalAlpha = 1 - k; dot(i ? 0.08 : -0.06, 0.05 - k * 0.7, 0.07); ctx.globalAlpha = 1; }
          return;
        }
        case 'commit': // a commit: a dot on its line
          ctx.lineWidth = s * 0.2;
          line([[-0.6, 0], [0.6, 0]]);
          dot(0, 0, 0.27);
          return;
        case 'push': case 'pull': { // an arrow going up (sent off) or down (fetched)
          const up = act === 'push', bob = Math.sin(t * 4) * 0.08 * (up ? -1 : 1);
          ctx.lineWidth = s * 0.28;
          line([[0, (up ? 0.55 : -0.55) + bob], [0, (up ? -0.45 : 0.45) + bob]]);
          line([[-0.36, (up ? -0.1 : 0.1) + bob], [0, (up ? -0.48 : 0.48) + bob], [0.36, (up ? -0.1 : 0.1) + bob]]);
          return;
        }
        case 'install': // a parcel: a box with a band of tape
          ctx.beginPath(); roundRect(ctx, x - 0.52 * s, y - 0.42 * s, 1.04 * s, 0.86 * s, 0.12 * s); ctx.fill();
          ctx.save(); ctx.fillStyle = '#fff'; // cut in the bubble's white
          ctx.fillRect(x - 0.52 * s, y - 0.14 * s, 1.04 * s, 0.08 * s); // the lid's edge
          ctx.fillRect(x - 0.06 * s, y - 0.42 * s, 0.12 * s, 0.3 * s); // the tape
          ctx.restore();
          return;
        case 'delete': { // a bin: lid, handle, body with two slits
          line([[-0.55, -0.42], [0.55, -0.42]]);
          line([[-0.16, -0.56], [0.16, -0.56]]);
          ctx.beginPath(); ctx.moveTo(x - 0.42 * s, y - 0.26 * s); ctx.lineTo(x + 0.42 * s, y - 0.26 * s); ctx.lineTo(x + 0.32 * s, y + 0.56 * s); ctx.lineTo(x - 0.32 * s, y + 0.56 * s); ctx.closePath(); ctx.fill();
          ctx.save(); ctx.fillStyle = '#fff';
          for (const sx of [-0.13, 0.13]) ctx.fillRect(x + (sx - 0.045) * s, y - 0.1 * s, 0.09 * s, 0.5 * s);
          ctx.restore();
          return;
        }
        case 'folder':
          ctx.beginPath();
          ctx.moveTo(x - 0.56 * s, y + 0.44 * s); ctx.lineTo(x - 0.56 * s, y - 0.42 * s); ctx.lineTo(x - 0.16 * s, y - 0.42 * s); ctx.lineTo(x - 0.02 * s, y - 0.26 * s); ctx.lineTo(x + 0.56 * s, y - 0.26 * s); ctx.lineTo(x + 0.56 * s, y + 0.44 * s); ctx.closePath();
          ctx.stroke();
          ctx.fill();
          return;
        case 'web': { // a globe, turning
          ctx.lineWidth = s * 0.17;
          ring(0, 0, 0.52);
          line([[-0.54, 0], [0.54, 0]]);
          const k = 0.2 + Math.abs(Math.sin(t * 1.5)) * 0.1;
          ctx.beginPath(); ctx.ellipse(x, y, k * s, 0.52 * s, 0, 0, Math.PI * 2); ctx.stroke();
          return;
        }
        case 'todo': // a checklist
          for (let i = 0; i < 3; i++) {
            const yy = -0.4 + i * 0.4;
            dot(-0.45, yy, 0.09);
            line([[-0.2, yy], [0.52, yy]]);
          }
          return;
        case 'helper': // two little slimes, with eyes
          for (const [cx, r] of [[-0.24, 0.42], [0.38, 0.3]]) {
            ctx.beginPath(); ctx.arc(x + cx * s, y + 0.3 * s - r * 0.3 * s, r * s, Math.PI, 0); ctx.lineTo(x + (cx + r) * s, y + 0.32 * s); ctx.lineTo(x + (cx - r) * s, y + 0.32 * s); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#fff';
            for (const e of [-0.38, 0.38]) { ctx.beginPath(); ctx.arc(x + (cx + e * r) * s, y + (0.3 - r * 0.55) * s, r * 0.22 * s, 0, Math.PI * 2); ctx.fill(); }
            ctx.fillStyle = INK;
          }
          return;
        case 'app': // a plug
          line([[-0.16, -0.55], [-0.16, -0.25]]);
          line([[0.16, -0.55], [0.16, -0.25]]);
          ctx.beginPath(); roundRect(ctx, x - 0.36 * s, y - 0.25 * s, 0.72 * s, 0.5 * s, 0.14 * s); ctx.fill();
          line([[0, 0.25], [0, 0.55]]);
          return;
        case 'thinking': case undefined: case '': break;
        default: { // any other command: a prompt, its cursor blinking
          ctx.lineWidth = s * 0.3;
          line([[-0.62, -0.42], [-0.18, 0], [-0.62, 0.42]]);
          ctx.globalAlpha = 0.55 + 0.45 * Math.round((Math.sin(t * 5) + 1) / 2);
          line([[0.1, 0.42], [0.62, 0.42]]);
          ctx.globalAlpha = 1;
          return;
        }
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
  // A quaver (eighth note) about s px tall, its head at (0, 0): drawn
  // twice, a white edge under the colour.
  function drawNote(ctx, s, color) {
    const shape = () => {
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.3, s * 0.22, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.24, -s * 0.08);
      ctx.lineTo(s * 0.24, -s);
      ctx.quadraticCurveTo(s * 0.32, -s * 0.62, s * 0.66, -s * 0.5);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = ctx.strokeStyle = '#fff';
    ctx.lineWidth = s * 0.14 + 4;
    shape();
    ctx.save(); ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.3, s * 0.22, -0.4, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.14;
    shape();
  }

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

  // A heart breaking (a helper that couldn't get to its mum): it pops in,
  // shivers as a zigzag crack opens down the middle, then the two halves
  // tip apart and fall away, fading. t: seconds since it came (1.6 s in all).
  function drawBrokenHeart(ctx, x, y, s, t) {
    const k = Math.min(1, t / 0.25) - 1;
    const pop = 1 + 2.7 * k * k * k + 1.7 * k * k;
    const crack = Math.min(1, Math.max(0, (t - 0.3) / 0.2)), u = Math.max(0, t - 0.55);
    const shiver = t > 0.3 && t < 0.55 ? Math.sin(t * 90) * s * 0.04 : 0;
    const zig = [[0, -0.35], [-0.2, -0.05], [0.16, 0.22], [-0.12, 0.52], [0, 0.9]];
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (1.5 - t) / 0.6));
    ctx.translate(x + shiver, y);
    ctx.scale(pop, pop);
    ctx.fillStyle = '#ff4d6d';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * (s * 0.07 * crack + s * 1.5 * u), s * 1.8 * u * u);
      ctx.rotate(side * 0.7 * u);
      ctx.beginPath();
      ctx.moveTo(0, -s * 2);
      for (const [px, py] of zig) ctx.lineTo(px * s, py * s);
      ctx.lineTo(0, s * 2);
      ctx.lineTo(side * s * 2, s * 2);
      ctx.lineTo(side * s * 2, -s * 2);
      ctx.closePath();
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(0, s * 0.9);
      ctx.bezierCurveTo(-s * 1.4, -s * 0.1, -s * 0.6, -s * 1.1, 0, -s * 0.35);
      ctx.bezierCurveTo(s * 0.6, -s * 1.1, s * 1.4, -s * 0.1, 0, s * 0.9);
      ctx.fill();
      ctx.restore();
    }
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
    if (!fontsReady) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.4 + i / 3) % 1;
      const a = Math.min(1, p * 5) * (1 - p);
      ctx.globalAlpha = a;
      ctx.font = `800 ${Math.round((11 + p * 13) * k)}px ${TEXT_FONT}`;
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
      if (!fontsReady) return;
      ctx.font = `900 ${Math.round(s * 1.4)}px ${TEXT_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, x, y + s * 0.06);
    });
  }

  // Two fonts. Everything is in the readable rounded one (Nunito, bundled),
  // except what a slime says in its little speech bubbles, which is in the
  // fun one picked in Settings (Speech bubble font). The display fonts come
  // in one weight only (DynaPuff aside), so they're drawn at 400: asking
  // for bold would get a smeared fake bold.
  const TEXT_FONT = '"Nunito", -apple-system, "Segoe UI", system-ui, sans-serif';
  let fun = `700 16px ${TEXT_FONT}`;
  // Canvas text doesn't load a font by itself, and drawn before it's in it
  // falls back to another (and is measured in that one). So text waits
  // until both fonts are loaded; that's a moment, once.
  let fontsReady = !(root.document && root.document.fonts);
  let fontAsked = 0;
  function setFont(name) {
    const want = !name || name === 'System' ? `700 16px ${TEXT_FONT}` : `400 ${name === 'Concert One' ? 18 : 16}px "${name}", ${TEXT_FONT}`; // (Concert One's letters run small)
    if (want === fun && fontAsked) return;
    fun = want;
    if (!root.document || !root.document.fonts) return;
    const mine = ++fontAsked, fonts = root.document.fonts;
    const ready = () => { if (mine === fontAsked) fontsReady = true; };
    fontsReady = fonts.check(fun) && fonts.check(`600 15px ${TEXT_FONT}`);
    if (fontsReady) return;
    Promise.all([fun, ...[600, 700, 800, 900].map((w) => `${w} 15px "Nunito"`)].map((f) => fonts.load(f))).then(ready, ready);
  }

  function drawLabel(ctx, b, text) {
    const c = b.centroid();
    const top = b.bbox().minY;
    if (!fontsReady) return;
    ctx.save();
    ctx.font = `600 11px ${TEXT_FONT}`;
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

  // A balloon with lines of text: [{ text, color?, dim?, size? }]. Two
  // kinds, drawn alike (the same pill, tail and padding as a sign balloon):
  // - speech (what a slime says: "hehe", "coffee?", a short line), in the
  //   fun font. One line is exactly a sign balloon's size; a longer one
  //   wraps, up to three lines. A line with a size of 20 or more is a lone
  //   emoji.
  // - a status list (the hover bubble, a summary), in the readable font:
  //   the first line (a name) bold, a coloured dot before a state, dim
  //   lines in grey. A line with a small size is a dim one.
  const PAD_X = 16, PAD_Y = 12, ICON_W = 58, ICON_H = 44;
  const SPEECH_LINE = 20, SPEECH_MAX = 220, SPEECH_LINES = 3;
  const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  const emoji = (l) => l.size >= 20;
  function drawBubble(ctx, b, lines, alpha, W, speech) {
    if (!lines.length || alpha <= 0 || !fontsReady) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = 'middle';
    if (speech) drawSpeech(ctx, b, lines, W);
    else drawStatus(ctx, b, lines, W);
    ctx.restore();
  }

  function drawSpeech(ctx, b, lines, W) {
    // Each line wrapped to the most it can be, then all of it cut to three.
    let rows = [];
    for (const l of lines) {
      if (emoji(l)) { rows.push({ text: l.text, font: `${Math.min(22, l.size)}px ${EMOJI}` }); continue; }
      ctx.font = fun;
      for (const text of balanced(ctx, l.text, SPEECH_MAX)) rows.push({ text, font: fun });
    }
    if (rows.length > SPEECH_LINES) {
      rows = rows.slice(0, SPEECH_LINES);
      const last = rows[SPEECH_LINES - 1];
      ctx.font = last.font;
      last.text = ellipsize(ctx, last.text + '…', SPEECH_MAX);
    }
    const tw = Math.max(...rows.map((r) => { ctx.font = r.font; return ctx.measureText(r.text).width; }));
    const w = Math.max(ICON_W, Math.ceil(tw) + PAD_X * 2), h = rows.length * SPEECH_LINE + PAD_Y * 2;
    const p = settle(b, placeBalloon(b, w, h, W), w, h);
    drawBalloon(ctx, p, w, h, false);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    rows.forEach((r, i) => {
      ctx.font = r.font;
      ctx.fillText(r.text, p.x + w / 2, baseline(ctx, p.y + PAD_Y + (i + 0.5) * SPEECH_LINE));
    });
  }

  // The baseline that puts a line's capitals centred on y (display fonts
  // have lopsided boxes, so 'middle' sits them too high or too low).
  function baseline(ctx, y) {
    const m = ctx.measureText('H');
    return m.actualBoundingBoxAscent ? y + m.actualBoundingBoxAscent / 2 : y + 5;
  }

  function drawStatus(ctx, b, lines, W) {
    const named = lines.length > 1;
    const dim = (l) => l.dim || (l.size && !emoji(l));
    const font = (l, i) => (emoji(l) ? `${l.size}px ${EMOJI}`
      : named && i === 0 ? `700 17px ${TEXT_FONT}` : dim(l) ? `600 14px ${TEXT_FONT}` : `600 15px ${TEXT_FONT}`);
    const lineH = (l, i) => (emoji(l) ? l.size + 8 : named && i === 0 ? 24 : 22);
    const w = Math.min(360, Math.max(ICON_W, Math.max(...lines.map((l, i) => { ctx.font = font(l, i); return ctx.measureText(l.text).width + (l.color ? 16 : 0); })) + PAD_X * 2));
    const h = Math.max(ICON_H, lines.reduce((sum, l, i) => sum + lineH(l, i), 0) + PAD_Y * 2 - 2);
    const p = settle(b, placeBalloon(b, w, h, W), w, h);
    b.statusBox = { x: p.x, y: p.y, w, h, slot: placed[placed.length - 1] }; // (for a thought bubble beside it)
    drawBalloon(ctx, p, w, h, false);
    let ly = p.y + PAD_Y - 1;
    lines.forEach((l, i) => {
      ctx.font = font(l, i);
      ly += lineH(l, i) / 2;
      let lx = p.x + PAD_X;
      if (l.color) {
        ctx.fillStyle = l.color;
        ctx.beginPath();
        ctx.arc(lx + 5, ly, 5, 0, Math.PI * 2);
        ctx.fill();
        lx += 16;
      }
      ctx.fillStyle = dim(l) ? '#6b7280' : INK;
      ctx.fillText(ellipsize(ctx, l.text, w - (lx - p.x) - PAD_X), lx, ly);
      ly += lineH(l, i) / 2;
    });
  }

	// What it's thinking, while you hover it: the end of its newest thought
	// in a thought bubble (puffs, no tail) beside its status bubble, the side
	// with room, trailing its puffs down to its head. At most three lines of
	// the plain font, the newest words last. avoid: other slimes'
	// heads ({ x, y, w, h }), which it never covers. Drawn after drawStatus.
	// One spacing system for thought bubbles (a mother's and a helper's):
	// the same padding all round (text is centred on its capitals, so padY
	// plus half a line's leading comes out at padX), a line height that
	// gives wrapped lines air, and set gaps between the groups.
	const THINK = {
		padX: 16, padY: 11,
		task: `700 16px ${TEXT_FONT}`, taskLine: 22,
		state: `600 15px ${TEXT_FONT}`, stateLine: 21,
		dim: `600 14px ${TEXT_FONT}`, dimLine: 20,
		stats: `600 12.5px ${TEXT_FONT}`, statsLine: 18,
		afterTask: 6, afterState: 2, beforeStats: 3,
	};
	const PUFF_GAP = 36, PUFFS = [5.5, 3.5]; // (bubble bottom to head, and the two puffs in it)
	const THOUGHT_W = 250, THOUGHT_LINE = THINK.dimLine, THOUGHT_LINES = 3;
	function drawThought(ctx, b, text, W, avoid = []) {
		const S = b.statusBox;
		if (!text || !S || !fontsReady) return;
		ctx.save();
		ctx.font = THINK.dim;
		let rows = wrap(ctx, text, THOUGHT_W);
		if (rows.length > THOUGHT_LINES) {
			rows = rows.slice(-THOUGHT_LINES);
			if (!rows[0].startsWith('…')) rows[0] = '…' + rows[0];
		}
		const w = Math.max(ICON_W, Math.ceil(Math.max(...rows.map((r) => ctx.measureText(r).width))) + THINK.padX * 2);
		const h = rows.length * THOUGHT_LINE + THINK.padY * 2;
		const hits = (x, y) => x < 8 || x + w > W - 8 || y < 8
			|| placed.some((o) => o !== S.slot && x < o.x + o.w + GAP && x + w + GAP > o.x && y < o.y + o.h + 26 && y + h + GAP > o.y) // (and its tail or puffs)
			|| avoid.some((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y);
		// Beside it, bottoms level, on the side with more room (kept while
		// it's up, so it doesn't hop sides); above it if neither side has room.
		const roomy = W - (S.x + S.w) >= S.x ? 1 : -1;
		const first = b.thoughtSide && performance.now() - (b.thoughtSideAt || 0) < 500 ? b.thoughtSide : roomy;
		const y0 = Math.max(8, S.y + S.h - h);
		let side = 0, x = 0, y = y0;
		for (const sd of [first, -first]) {
			const cx = sd > 0 ? S.x + S.w + 14 : S.x - 14 - w;
			if (!hits(cx, y0)) { side = sd; x = cx; break; }
		}
		if (!side) {
			x = Math.max(8, Math.min(W - w - 8, S.x + S.w / 2 - w / 2));
			y = S.y - 34 - h;
			for (let tries = 0; tries < 6 && hits(x, y) && y > 8; tries++) y -= 20;
			y = Math.max(8, y);
		}
		b.thoughtSide = side || first;
		b.thoughtSideAt = performance.now();
		placed.push({ x, y, w, h });
		ctx.fillStyle = '#fff';
		ctx.beginPath();
		const rad = pillRadius(h);
		if (side) {
			// Two puffs on the way from its near corner down to its head.
			const c = b.centroid(), r = b.o.radius, top = b.bbox().minY;
			const from = { x: side > 0 ? x + rad * 0.9 : x + w - rad * 0.9, y: y + h - 2 };
			const to = { x: c.x + side * r * 0.5, y: top + r * 0.1 };
			for (const [k, pr] of [[0.36, PUFFS[0]], [0.7, PUFFS[1]]]) {
				const px = from.x + (to.x - from.x) * k, py = from.y + (to.y - from.y) * k;
				ctx.moveTo(px + pr, py);
				ctx.arc(px, py, pr, 0, Math.PI * 2);
			}
		} else {
			// Above it: the puffs trail down toward it, in the gap.
			const mx = Math.max(x + rad, Math.min(x + w - rad, S.x + S.w / 2));
			for (const [dy, pr] of [[11, PUFFS[0]], [23, PUFFS[1]]]) {
				ctx.moveTo(mx + pr, y + h + dy);
				ctx.arc(mx, y + h + dy, pr, 0, Math.PI * 2);
			}
		}
		ctx.fill();
		roundRect(ctx, x, y, w, h, rad);
		ctx.fill();
		ctx.fillStyle = INK;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		rows.forEach((row, i) => ctx.fillText(row, x + THINK.padX, baseline(ctx, y + THINK.padY + (i + 0.5) * THOUGHT_LINE)));
		ctx.restore();
	}

	// A helper, hovered: one thought bubble over its head, its puffs
	// trailing down to it, holding its task (bold, wrapped to three lines),
	// its state (dot and word) and what it's doing now (grey, two lines).
	// card: { task, status: { text, color }, action, fromEnd } (fromEnd: the
	// action is a thought's tail, so its newest words are the ones kept).
	// avoid: other slimes' heads, which it never covers, as with drawThought.
	const CARD_W = 260, TASK_LINES = 3, ACTION_LINES = 2;
	function drawHelperThought(ctx, b, card, W, avoid = []) {
		if (!card || !card.task || !fontsReady) return;
		ctx.save();
		const taskFont = THINK.task, stateFont = THINK.state, actionFont = THINK.dim;
		ctx.font = taskFont;
		let task = wrap(ctx, card.task, CARD_W);
		if (task.length <= TASK_LINES) task = balanced(ctx, card.task, CARD_W); // (evened out when it all fits)
		if (task.length > TASK_LINES) task = [...task.slice(0, TASK_LINES - 1), ellipsize(ctx, task.slice(TASK_LINES - 1).join(' '), CARD_W).replace(/\s+\S*…$/, '…')]; // (cut at a word)
		ctx.font = actionFont;
		let action = card.action ? wrap(ctx, card.action, CARD_W) : [];
		if (action.length > ACTION_LINES) {
			if (card.fromEnd) {
				action = action.slice(-ACTION_LINES);
				if (!action[0].startsWith('…')) action[0] = '…' + action[0];
			} else action = [action[0], ellipsize(ctx, action.slice(1).join(' ') + '…', CARD_W)];
		}
		const widest = (rows, font, extra = 0) => { ctx.font = font; return Math.max(0, ...rows.map((r) => ctx.measureText(r).width + extra)); };
		const status = card.status && card.status.text ? card.status : null;
		const stats = card.stats ? [card.stats] : []; // (its time and tokens, small and grey)
		const tw = Math.max(widest(task, taskFont), status ? widest([status.text], stateFont, status.color ? 16 : 0) : 0, widest(action, actionFont), widest(stats.map((t) => t.replace(/\d/g, '0')), THINK.stats)); // (measured as zeros, so it doesn't twitch as the seconds tick)
		const w = Math.max(ICON_W, Math.ceil(tw) + THINK.padX * 2);
		// The rows, top to bottom, each with the space it takes and the gap
		// before it: the task's lines, a gap, its state, a smaller one, the action.
		const rows = [
			...task.map((text, i) => ({ text, font: taskFont, lh: THINK.taskLine, gap: 0 })),
			...(status ? [{ text: status.text, font: stateFont, lh: THINK.stateLine, gap: THINK.afterTask, dot: status.color }] : []),
			...action.map((text, i) => ({ text, font: actionFont, lh: THINK.dimLine, gap: i ? 0 : status ? THINK.afterState : THINK.afterTask, dim: true })),
			...stats.map((text) => ({ text, font: THINK.stats, lh: THINK.statsLine, gap: THINK.beforeStats, dim: true, faint: true })),
		];
		const h = rows.reduce((sum, r) => sum + r.gap + r.lh, 0) + THINK.padY * 2;
		// Right over its head, its puffs between: shifted aside past a bubble
		// that's in the way (as long as it still sits over its own head),
		// else up past it, or past another slime's head.
		const c = b.centroid(), box = b.bbox();
		const top = b.lookTop != null ? Math.min(box.minY, b.lookTop) : box.minY;
		const tip = { x: c.x, y: top - 4 };
		const rad0 = pillRadius(h), clampX = (x) => Math.max(8, Math.min(W - w - 8, x));
		const over = (x) => x + rad0 + 6 <= tip.x && tip.x <= x + w - rad0 - 6;
		const hitAt = (x, y) => placed.find((o) => x < o.x + o.w + GAP && x + w + GAP > o.x && y < o.y + o.h + 26 && y + h + GAP > o.y)
			|| avoid.find((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y);
		let x = clampX(c.x - w / 2), y = tip.y - PUFF_GAP - h;
		for (let tries = 0; tries < 8 && y > 8; tries++) {
			const hit = hitAt(x, y);
			if (!hit) break;
			const aside = [clampX(hit.x - GAP - w), clampX(hit.x + hit.w + GAP)].find((sx) => over(sx) && !hitAt(sx, y));
			if (aside !== undefined) { x = aside; break; }
			y = hit.y - GAP - h;
		}
		y = Math.max(8, y);
		placed.push({ x, y, w, h });
		const p = settle(b, { tip, x, y, gap: PUFF_GAP }, w, h);
		ctx.fillStyle = '#fff';
		ctx.beginPath();
		const rad = pillRadius(h);
		// Puffs, evenly spaced from its bottom down to just over its head:
		// two, and more (getting smaller) when it had to go higher.
		const from = { x: Math.max(p.x + rad, Math.min(p.x + w - rad, tip.x)), y: p.y + h };
		const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
		const n = Math.max(2, Math.min(5, Math.round(len / 26)));
		const puffs = Array.from({ length: n }, (_, i) => PUFFS[0] + ((PUFFS[1] - PUFFS[0]) * i) / (n - 1));
		const space = Math.max(2, (len - 2 * puffs.reduce((s, r) => s + r, 0)) / (n + 1));
		let along = 0;
		for (const pr of puffs) {
			along += space + pr;
			const px = from.x + ((tip.x - from.x) * along) / len, py = from.y + ((tip.y - from.y) * along) / len;
			ctx.moveTo(px + pr, py);
			ctx.arc(px, py, pr, 0, Math.PI * 2);
			along += pr;
		}
		ctx.fill();
		roundRect(ctx, p.x, p.y, w, h, rad);
		ctx.fill();
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		let ly = p.y + THINK.padY;
		for (const r of rows) {
			ly += r.gap;
			ctx.font = r.font;
			const mid = ly + r.lh / 2;
			let lx = p.x + THINK.padX;
			if (r.dot) {
				ctx.fillStyle = r.dot;
				ctx.beginPath();
				ctx.arc(lx + 5, mid, 5, 0, Math.PI * 2);
				ctx.fill();
				lx += 16;
			}
			ctx.fillStyle = r.faint ? '#8d94a1' : r.dim ? '#6b7280' : INK;
			ctx.fillText(r.dot ? ellipsize(ctx, r.text, w - (lx - p.x) - THINK.padX) : r.text, lx, baseline(ctx, mid));
			ly += r.lh;
		}
		ctx.restore();
	}

  // Wrapped, then evened out: as narrow as it goes without taking another
  // line, so two lines come out about the same length, not a long one and
  // a word. (Kept, as a bubble is measured every frame.)
  const wrapped = new Map();
  function balanced(ctx, text, max) {
    const key = ctx.font + '|' + text;
    let out = wrapped.get(key);
    if (out) return out;
    out = wrap(ctx, text, max);
    const whole = out.join(' ');
    for (let m = max - 6; out.length > 1 && m > 40; m -= 6) {
      const t = wrap(ctx, text, m);
      if (t.length !== out.length || t.join(' ') !== whole) break;
      out = t;
    }
    if (wrapped.size > 200) wrapped.clear();
    wrapped.set(key, out);
    return out;
  }

  // Splits text into lines no wider than max, at spaces (a word longer
  // than that is cut).
  function wrap(ctx, text, max) {
    const out = [];
    let line = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width <= max || !line) line = next;
      else { out.push(line); line = word; }
      if (ctx.measureText(line).width > max) { out.push(ellipsize(ctx, line, max)); line = ''; }
    }
    if (line || !out.length) out.push(line);
    return out;
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

  root.BlaubeDraw = { bodyPath, setFont, setCrowd, drawHeart, drawBrokenHeart, drawNote, drawShadow, drawBody, vary, drawFace, drawGlasses, drawDots, drawThinking, drawDream, drawZzz, drawFlush, drawSweat, drawPet, drawExclaim, drawLabel, drawBubble, drawThought, drawHelperThought, STATE_COLORS };
})(globalThis);
