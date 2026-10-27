// Renders one blob with each eye style and each blush style (face.js's
// eyeKind and cheekKind), side by side, to pick from: shots/face-sheet.png.
// Run with: npx electron scripts/face-sheet.js
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  for (const f of ['shared/config.js', 'renderer/softbody.js', 'renderer/face.js']) await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, 'src', f), 'utf8'));
  const url = await win.webContents.executeJavaScript(`(${draw})()`);
  fs.mkdirSync(path.join(root, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shots', 'face-sheet.png'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote shots/face-sheet.png');
  app.quit();
});

function draw() {
  const CFG = Object.assign({}, BlaubeConfig.DEFAULTS);
  const rows = [
    ['', [['dot', 'oval', 'Opus'], ['tall', 'lines', 'Sonnet'], ['small', 'freckles', 'Haiku'], ['wide', 'hearts', 'Fable']]],
  ];
  const cw = 300, rh = 300, c = document.createElement('canvas');
  c.width = cw * 4; c.height = rh * rows.length;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1f2024'; ctx.fillRect(0, 0, c.width, c.height);
  rows.forEach(([title, cells], ri) => cells.forEach(([eyeKind, cheekKind, label], ci) => {
    const x0 = ci * cw, floor = ri * rh + rh - 70, r = 95;
    const body = new SoftBody(x0 + cw / 2, floor - r * 1.2, Object.assign({}, CFG, { points: CFG.mainPoints, radius: r }));
    body.setBounds(x0, ri * rh - 400, x0 + cw, floor);
    for (let i = 0; i < 900; i++) body.step(1 / 120);
    const off = x0 + cw / 2 - body.centroid().x;
    for (let i = 0; i < body.n; i++) body.px[i] += off;
    BlaubeDraw.drawBody(ctx, body, CFG.color);
    BlaubeDraw.drawFace(ctx, body, { expression: 'normal', mouth: 'smile', blink: 0, look: { x: x0 + cw / 2, y: floor + 400 }, lookAmount: 0, scale: CFG.faceScale, style: CFG, bodyColor: CFG.color, eyeKind, cheekKind });
    ctx.fillStyle = '#e8e8ea'; ctx.font = '600 20px -apple-system, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(title ? `${title}: ${label}` : label, x0 + cw / 2, floor + 45);
  }));
  return c.toDataURL('image/png');
}
