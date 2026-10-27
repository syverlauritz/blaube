// Renders Blaube's app and tray icons with the same drawing code the app
// uses: a real softbody blob, settled on a floor so it's the dome the app
// shows, with its everyday face. The app icon puts it on a dark rounded
// square (the macOS icon grid: an 824 px square in 1024, corners as a
// superellipse); the tray icons are its silhouette with its eyes cut out.
// Run with: npx electron scripts/make-icons.js
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const scripts = ['shared/config.js', 'renderer/softbody.js', 'renderer/face.js'].map((f) => path.join(root, 'src', f));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  for (const f of scripts) await win.webContents.executeJavaScript(fs.readFileSync(f, 'utf8'));
  const render = (size, mode) => win.webContents.executeJavaScript(`(${draw})(${size}, ${JSON.stringify(mode)})`);
  const out = (name, url) => fs.writeFileSync(path.join(root, 'build', name), Buffer.from(url.split(',')[1], 'base64'));
  out('icon.png', await render(1024, 'app'));
  out('tray.png', await render(32, 'app-small'));
  out('trayTemplate.png', await render(16, 'tray'));
  out('trayTemplate@2x.png', await render(32, 'tray'));
  console.log('wrote build/icon.png, tray.png, trayTemplate.png, trayTemplate@2x.png');
  app.quit();
});

// (Runs in the page.)
function draw(size, mode) {
  const CFG = Object.assign({}, BlaubeConfig.DEFAULTS);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const app = mode === 'app';
  // The rounded square, and where the blob stands in it.
  const sq = app ? size * 824 / 1024 : size, inset = (size - sq) / 2;
  const floor = app ? inset + sq * 0.76 : size;
  const r = app ? sq * 0.38 : size * 0.47;
  // Dropped onto the floor and left a moment: it settles into its dome.
  const body = new SoftBody(size / 2, floor - r * 1.2, Object.assign({}, CFG, { points: CFG.mainPoints, radius: r, gravity: CFG.gravity * r / 60 }));
  body.setBounds(0, -size, size, floor);
  for (let i = 0; i < 1200; i++) body.step(1 / 120);
  // Made exactly symmetric (the skin settles a touch to one side): each
  // point and its mirror image across the middle, averaged.
  const mid = body.centroid().x, xs = Array.from(body.px), ys = Array.from(body.py);
  const ang = (i) => Math.atan2(ys[i] - (floor - r), xs[i] - mid);
  for (let i = 0; i < body.n; i++) {
    const want = Math.PI - ang(i);
    let j = 0, best = Infinity;
    for (let k = 0; k < body.n; k++) { const d = Math.abs(Math.atan2(Math.sin(ang(k) - want), Math.cos(ang(k) - want))); if (d < best) { best = d; j = k; } }
    body.px[i] = mid + ((xs[i] - mid) - (xs[j] - mid)) / 2;
    body.py[i] = (ys[i] + ys[j]) / 2;
  }
  body.angle = 0;
  if (mode === 'tray' || mode === 'app-small') {
    // (Small: scaled to fill the icon, its bottom on the bottom edge.)
    const box = body.bbox(), k = (size * 0.94) / (box.maxX - box.minX);
    for (let i = 0; i < body.n; i++) { body.px[i] = size / 2 + (body.px[i] - size / 2) * k; body.py[i] = size - 0.5 - (box.maxY - body.py[i]) * k; }
    body.o.radius *= k;
  }
  const face = { expression: 'normal', mouth: 'smile', blink: 0, look: { x: size / 2, y: size * 2 }, lookAmount: 0, scale: CFG.faceScale, style: CFG, bodyColor: CFG.color || '#D97757' };
  if (app) {
    // A superellipse (n = 5), close to Apple's icon shape.
    ctx.fillStyle = '#25272D';
    ctx.beginPath();
    const a = sq / 2, cx = size / 2, cy = size / 2;
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * Math.PI * 2, co = Math.cos(t), si = Math.sin(t);
      ctx.lineTo(cx + a * Math.sign(co) * Math.pow(Math.abs(co), 2 / 5), cy + a * Math.sign(si) * Math.pow(Math.abs(si), 2 / 5));
    }
    ctx.fill();
    ctx.save();
    ctx.clip();
    // The floor it stands on, and its soft shadow.
    ctx.fillStyle = '#1A1B1F';
    ctx.fillRect(0, floor, size, size);
    BlaubeDraw.drawShadow(ctx, body, floor);
    ctx.restore();
  }
  if (mode === 'tray') {
    ctx.fillStyle = '#000';
    BlaubeDraw.bodyPath(ctx, body);
    ctx.fill();
    // Its eyes, cut out.
    const m = body.centroid(), rr = body.o.radius;
    ctx.globalCompositeOperation = 'destination-out';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(m.x + s * rr * 0.3, m.y - rr * 0.02, rr * 0.11, rr * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    BlaubeDraw.drawBody(ctx, body, '#D97757');
    BlaubeDraw.drawFace(ctx, body, face);
  }
  return c.toDataURL('image/png');
}
