// Renders Blaube's app and tray icons with the same drawing code the app
// uses. Run with: node scripts/make-icons.js (needs playwright installed).
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(root, 'src', 'renderer', f), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body style="margin:0;background:transparent"></body></html>');
  await page.addScriptTag({ content: src('softbody.js') });
  await page.addScriptTag({ content: src('face.js') });

  const render = (size, mode) =>
    page.evaluate(({ size, mode }) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      const r = size * 0.4;
      const b = new SoftBody(size / 2, size / 2 + size * 0.04, { radius: r, points: 48 });
      // A touch of squash so it reads as a blob, not a circle.
      for (let i = 0; i < b.n; i++) {
        const dy = b.py[i] - size / 2;
        b.py[i] = size / 2 + dy * 0.9 + (dy > 0 ? size * 0.02 : 0);
        b.px[i] = size / 2 + (b.px[i] - size / 2) * 1.06;
      }
      if (mode === 'app') {
        BlaubeDraw.drawBody(ctx, b, '#D97757', {});
        BlaubeDraw.drawFace(ctx, b, { expression: 'normal', mouth: 'smile', blink: 0, look: { x: size * 0.55, y: size } });
      } else {
        ctx.fillStyle = '#000';
        const n = b.n;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) ctx.lineTo(b.px[i % n], b.py[i % n]);
        ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(size / 2 + s * r * 0.33, size / 2 - r * 0.12, r * 0.15, r * 0.22, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return c.toDataURL('image/png').split(',')[1];
    }, { size, mode });

  const out = (name, b64) => fs.writeFileSync(path.join(root, 'build', name), Buffer.from(b64, 'base64'));
  out('icon.png', await render(1024, 'app'));
  out('trayTemplate.png', await render(16, 'tray'));
  out('trayTemplate@2x.png', await render(32, 'tray'));
  out('tray.png', await render(32, 'app'));
  await browser.close();
})();
