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

  function drawShadow(ctx, b) {
    const c = b.centroid();
    const r = b.o.radius;
    const h = Math.max(0, b.bounds.bottom - (c.y + r));
    const k = Math.max(0, 1 - h / 500);
    if (k <= 0) return;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.18 * k})`;
    ctx.beginPath();
    ctx.ellipse(c.x, b.bounds.bottom - 2, r * (0.6 + 0.4 * k), r * 0.12 * k + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBody(ctx, b, hue, glow) {
    const c = b.centroid();
    const r = b.o.radius;
    ctx.save();
    if (glow) {
      ctx.shadowColor = glow + '99';
      ctx.shadowBlur = 14;
    }
    const g = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.45, r * 0.1, c.x, c.y, r * 1.25);
    g.addColorStop(0, `hsl(${hue} 100% 82%)`);
    g.addColorStop(0.45, `hsl(${hue} 92% 62%)`);
    g.addColorStop(1, `hsl(${hue} 80% 44%)`);
    bodyPath(ctx, b);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `hsl(${hue} 70% 34% / 0.55)`;
    ctx.stroke();
    // Glossy highlight that rides along with the body's rotation.
    ctx.translate(c.x, c.y);
    ctx.rotate(b.angle);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.38, -r * 0.52, r * 0.26, r * 0.13, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(-r * 0.62, -r * 0.3, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // face: { look: {x,y} in screen px, expression, blink 0..1, mouth }
  function drawFace(ctx, b, face) {
    const c = b.centroid();
    const r = b.o.radius;
    const st = b.stretch();
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(b.angle);
    ctx.scale(Math.min(1.4, st.x), Math.min(1.4, st.y));
    ctx.translate(0, -r * 0.08);

    const ex = r * 0.33, ey = -r * 0.1, ew = r * 0.17, eh = r * 0.22;
    // Look direction in the face's frame.
    let lx = face.look.x - c.x, ly = face.look.y - c.y;
    const ca = Math.cos(-b.angle), sa = Math.sin(-b.angle);
    [lx, ly] = [lx * ca - ly * sa, lx * sa + ly * ca];
    const ll = Math.hypot(lx, ly) || 1;
    const reach = Math.min(1, ll / (r * 3));
    const pdx = (lx / ll) * ew * 0.45 * reach, pdy = (ly / ll) * eh * 0.45 * reach;

    const ink = '#1b2440';
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.06;
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
          ctx.beginPath();
          ctx.moveTo(x - ew * 0.7, y - eh * 0.5); ctx.lineTo(x + ew * 0.5 * side, y);
          ctx.lineTo(x - ew * 0.7, y + eh * 0.5);
          if (side < 0) {
            ctx.moveTo(x + ew * 0.7, y - eh * 0.5); ctx.lineTo(x - ew * 0.5, y); ctx.lineTo(x + ew * 0.7, y + eh * 0.5);
          }
          ctx.stroke();
          break;
        case 'concentrate':
          // Eyes squeezed shut in deep concentration: tight downward arcs.
          ctx.beginPath();
          ctx.arc(x, y - eh * 0.35, ew * 0.8, Math.PI * 0.2, Math.PI * 0.8);
          ctx.stroke();
          break;
        case 'sleepy':
          ctx.beginPath();
          ctx.arc(x, y, ew * 0.8, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
          break;
        default: {
          const open = Math.max(0.08, 1 - face.blink);
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
            ctx.arc(x + pdx, y + pdy, ew * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(x + pdx - ew * 0.22, y + pdy - ew * 0.25, ew * 0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
      if (face.expression === 'worried' || face.expression === 'concentrate') {
        const tilt = face.expression === 'worried' ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(x - ew * side, y - eh * 1.35 + tilt * eh * 0.25);
        ctx.lineTo(x + ew * 0.7 * side, y - eh * 1.35 - tilt * eh * 0.25);
        ctx.stroke();
      }
    }

    // Cheeks.
    ctx.fillStyle = 'rgba(255,120,160,0.35)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * r * 0.55, r * 0.14, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mouth.
    const my = r * 0.2;
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
      case 'flat':
        ctx.moveTo(-r * 0.08, my); ctx.lineTo(r * 0.08, my);
        ctx.stroke();
        break;
      default:
        ctx.arc(0, my - r * 0.06, r * 0.1, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
    }
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

  // "..." thought puff while Claude is working.
  function drawThinking(ctx, b, t) {
    const c = b.centroid();
    const r = b.o.radius;
    const top = b.bbox().minY;
    for (let i = 0; i < 3; i++) {
      const a = Math.max(0, Math.sin(t * 5 - i * 0.7));
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.6 * a})`;
      ctx.arc(c.x + r * 0.55 + i * 9, top - 4 - i * 7 - a * 3, 3 + i * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Little "!" bubble that bobs above a slime that finished its work.
  function drawExclaim(ctx, b, t, color) {
    const c = b.centroid();
    const top = b.bbox().minY;
    const x = c.x + b.o.radius * 0.95, y = top - 6 + Math.sin(t * 7) * 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.moveTo(x - 7, y + 8); ctx.lineTo(x - 11, y + 17); ctx.lineTo(x - 1, y + 11);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.font = '800 17px -apple-system, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', x, y + 1);
    ctx.restore();
  }

  function drawLabel(ctx, b, text) {
    const c = b.centroid();
    const top = b.bbox().minY;
    ctx.save();
    ctx.font = '600 11px -apple-system, "Segoe UI", system-ui, sans-serif';
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

  // lines: [{ text, color? }]
  function drawBubble(ctx, b, lines, alpha, W) {
    if (!lines.length || alpha <= 0) return;
    const c = b.centroid();
    const top = b.bbox().minY - 48;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '500 13px -apple-system, "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const lh = 19, pad = 10;
    const w = Math.min(320, Math.max(...lines.map((l) => ctx.measureText(l.text).width + (l.color ? 14 : 0))) + pad * 2);
    const h = lines.length * lh + pad * 2 - 4;
    let x = c.x - w / 2;
    x = Math.max(8, Math.min(W - w - 8, x));
    let y = top - h;
    const below = y < 8;
    if (below) y = b.bbox().maxY + 14;
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    // Tail.
    const tx = Math.max(x + 14, Math.min(x + w - 14, c.x));
    ctx.beginPath();
    if (below) { ctx.moveTo(tx - 7, y + 1); ctx.lineTo(tx, y - 8); ctx.lineTo(tx + 7, y + 1); }
    else { ctx.moveTo(tx - 7, y + h - 1); ctx.lineTo(tx, y + h + 8); ctx.lineTo(tx + 7, y + h - 1); }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    lines.forEach((l, i) => {
      const ly = y + pad + i * lh + lh / 2 - 2;
      let lx = x + pad;
      if (l.color) {
        ctx.fillStyle = l.color;
        ctx.beginPath();
        ctx.arc(lx + 4, ly, 4, 0, Math.PI * 2);
        ctx.fill();
        lx += 14;
      }
      ctx.fillStyle = '#1b2440';
      ctx.fillText(ellipsize(ctx, l.text, w - (lx - x) - pad), lx, ly);
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

  root.BlaubeDraw = { drawShadow, drawBody, drawFace, drawDots, drawThinking, drawExclaim, drawLabel, drawBubble, STATE_COLORS };
})(globalThis);
