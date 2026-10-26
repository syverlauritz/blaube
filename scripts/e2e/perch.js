// Slimes sitting on talk boxes, in the real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/perch.js BLAUBE_PORT=47879 npx electron .
//
// A box's top is a ledge, like another app's window: a slime dropped onto
// it rests on it (on the flat of the bubble's top, not its clear margin),
// rides along when the box is dragged by its header, has no tail while it
// sits on its own box, and falls to the floor when the box closes. In front
// of other windows, the slimes are in front of the boxes too (Windows: the
// stacking order is read back); behind them, the boxes are in front.
// Saves pictures to shots/e2e-perch-*.png. Exits non-zero on a failure.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { BrowserWindow, ipcMain } = require('electron');

const OUT = path.join(__dirname, '..', '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Where each window is in the stacking order, front first (Windows only).
const ORDER = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class BlaubeZ {
	delegate bool EnumProc(IntPtr h, IntPtr p);
	[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
	public static string List() { var l = new List<string>(); EnumWindows((h, p) => { l.Add(h.ToInt64().ToString()); return true; }, IntPtr.Zero); return String.Join(" ", l); }
}
"@
[BlaubeZ]::List()`;
const handle = (w) => { const h = w.getNativeWindowHandle(); return String(h.length >= 8 ? h.readBigUInt64LE(0) : h.readUInt32LE(0)); };
const stacking = (wins) => new Promise((done) => {
	if (process.platform !== 'win32') { done(null); return; }
	execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ORDER], { windowsHide: true, timeout: 20000 }, (err, out) => {
		const all = err ? [] : String(out).trim().split(/\s+/);
		done(wins.map((w) => all.indexOf(handle(w))));
	});
});

module.exports = async function run({ win, PORT, talk, talkId, pinned }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(30); } return false; };
	const page = (js) => win.webContents.executeJavaScript(js);
	const hook = (id, payload) => new Promise((done) => {
		const req = http.request({ host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli' } }, (res) => { res.resume(); res.on('end', done); });
		req.on('error', done);
		req.end(JSON.stringify(Object.assign({ session_id: id, cwd: `/tmp/perch-${id.slice(-1)}` }, payload)));
	});
	const A = `perch-${Date.now()}-a`, B = `perch-${Date.now()}-b`;
	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);
	for (const id of [A, B]) {
		await hook(id, { hook_event_name: 'SessionStart' });
		await hook(id, { hook_event_name: 'UserPromptSubmit', prompt: `a task for ${id.slice(-1)}` });
		// (A keeps working: a slime that's done hops for attention now and then.)
		if (id === B) await hook(id, { hook_event_name: 'Stop', last_assistant_message: `Done with ${id.slice(-1)}.` });
	}
	check(await until(async () => (await page(`__blaube.buddies.size`)) >= 2, 8000), 'two slimes appear');
	await sleep(2500); // (landed, grown)
	const sw = win.getBounds();
	const boxWin = (id) => (pinned().get(id) ? pinned().get(id).win : talkId() === id && talk() && talk().isVisible() ? talk() : null);
	const ledgeOf = (id) => page(`(__blaube.ledges().find((l) => l.talk === ${JSON.stringify(id)}) || null)`);
	const slime = (id) => page(`(() => { const b = __blaube.buddies.get(${JSON.stringify(id)}); if (!b) return null; const c = b.body.centroid(), bb = b.body.bbox(); return { x: c.x, y: c.y, bottom: bb.maxY, r: b.body.o.radius, on: b.body.onLedge && (b.body.onLedge.talk || b.body.onLedge.id), floor: b.body.onFloor(), tail: __blaube.talkTail(${JSON.stringify(id)}) }; })()`);
	// Carries a slime to a spot, holds it still there and lets go (or keeps hold).
	const carry = (id, to, keep = false) => page(`(async () => {
		const B = __blaube, b = B.buddies.get(${JSON.stringify(id)}), raf = () => new Promise((r) => requestAnimationFrame(r));
		B.ownMouse = true;
		const c = b.body.centroid(), to = ${JSON.stringify(to)};
		B.input.down({ button: 0, clientX: c.x, clientY: c.y });
		for (let i = 1; i <= 30; i++) { B.input.move({ clientX: c.x + (to.x - c.x) * i / 30, clientY: c.y + (to.y - c.y) * i / 30 }); await raf(); }
		for (let i = 0; i < 240; i++) { B.input.move({ clientX: to.x, clientY: to.y }); await raf(); const p = b.body.centroid(); if (i > 40 && Math.hypot(p.x - to.x, p.y - to.y) < 30) break; }
		for (let i = 0; i < 20; i++) { B.input.move({ clientX: to.x, clientY: to.y }); await raf(); }
		if (${keep}) return true;
		B.input.up({ button: 0, clientX: to.x, clientY: to.y });
		B.ownMouse = false;
		return true;
	})()`);
	// Puts a slime on its box (a slime busy with a hop of its own when it's
	// picked up may slip off: then again, as a person would).
	// It stays up there a while, as if you were talking to it (left alone, a
	// slime hops down again now and then).
	const seat = async (id, at) => {
		await page(`__blaube.buddies.get(${JSON.stringify(id)}).talkHold = __blaube.now() + 60`);
		for (let i = 0; i < 3; i++) {
			await carry(id, at);
			if (await until(async () => { const t = await slime(id); return t && t.on === id; }, 2000)) return true;
		}
		return false;
	};
	const letGo = () => page(`(() => { const B = __blaube; B.input.up({ button: 0, clientX: 0, clientY: 0 }); B.ownMouse = false; })()`);
	// A picture of the slimes and the boxes, cropped round a box: the boxes
	// first and the slimes' layer over them (in front), or the other way.
	const shot = async (name, around, front = true) => {
		const ink = [{ img: (await win.webContents.capturePage()).toDataURL(), x: 0, y: 0, w: sw.width, h: sw.height, stage: true }];
		for (const w of BrowserWindow.getAllWindows()) {
			if (w === win || !w.isVisible() || !(pinned().get(A) && pinned().get(A).win === w || pinned().get(B) && pinned().get(B).win === w || w === talk())) continue;
			const b = w.getBounds();
			ink.push({ img: (await w.webContents.capturePage()).toDataURL(), x: b.x - sw.x, y: b.y - sw.y, w: b.width, h: b.height });
		}
		if (front) ink.push(ink.shift());
		const x0 = Math.max(0, around.x - sw.x - 60), y0 = Math.max(0, around.y - sw.y - 260), cw = Math.min(around.width + 120, sw.width - x0), ch = Math.min(around.height + 320, sw.height - y0);
		const cv = new BrowserWindow({ width: 400, height: 300, show: false });
		await cv.loadURL('about:blank');
		const png = await cv.webContents.executeJavaScript(`(async () => {
			const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
			const ink = ${JSON.stringify(ink)};
			const first = await load(ink.find((i) => i.stage).img), k = first.width / ${sw.width};
			const c = document.createElement('canvas'); c.width = ${cw} * k; c.height = ${ch} * k;
			const g = c.getContext('2d');
			g.fillStyle = '#3a3d44'; g.fillRect(0, 0, c.width, c.height);
			for (const i of ink) g.drawImage(await load(i.img), (i.x - ${x0}) * k, (i.y - ${y0}) * k, i.w * k, i.h * k);
			return c.toDataURL('image/png');
		})()`);
		cv.destroy();
		fs.mkdirSync(OUT, { recursive: true });
		const file = path.join(OUT, `e2e-perch-${name}.png`);
		fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
		console.log(`     saved ${file}`);
	};

	// A's box, open (not pinned yet): its top is a ledge, the flat of the
	// bubble's top.
	await page(`window.blaube.talk(${JSON.stringify(A)}, { x: ${Math.round(sw.width * 0.35)}, y: ${Math.round(sw.height - 300)}, r: 60 })`);
	check(await until(() => talkId() === A && talk().isVisible()), 'a box opens');
	await sleep(500);
	let tb = talk().getBounds(), l = await ledgeOf(A);
	check(!!l && l.y === tb.y - sw.y + 12 && l.x0 === tb.x - sw.x + 12 + 30 && l.x1 === tb.x - sw.x + tb.width - 12 - 30, `its top is a ledge: the flat of the bubble (${JSON.stringify(l)}, box ${JSON.stringify(tb)})`);
	// A dropped onto its own box rests on it.
	check(await seat(A, { x: (l.x0 + l.x1) / 2, y: l.y - 160 }), 'dropped onto its own box, it rests on its top');
	await sleep(600);
	let s = await slime(A);
	check(s && s.on === A && Math.abs(s.bottom - l.y) < 6, `and stays sitting there (bottom ${s && s.bottom.toFixed(1)}, top ${l.y})`);
	check(s && !s.tail, `sitting on its own box: no tail (${JSON.stringify(s && s.tail)})`);
	// Pinned, then dragged by its header: it rides along.
	await talk().webContents.executeJavaScript(`document.getElementById('pin').click()`);
	check(await until(() => !!pinned().get(A)), 'pinned');
	const pa = () => pinned().get(A).win;
	s = await slime(A);
	tb = pa().getBounds();
	const sx = tb.x + 200, sy = tb.y + 40;
	await pa().webContents.executeJavaScript(`(async () => { blaubeTalk.resize('start', 'move', ${sx}, ${sy}); for (let i = 1; i <= 30; i++) { blaubeTalk.resize('move', 'move', ${sx} + i * 6, ${sy} - i * 2); await new Promise((r) => setTimeout(r, 16)); } blaubeTalk.resize('end', 'move', ${sx + 180}, ${sy - 60}); })()`);
	// (Stopped going up, it's tossed a hair; stopped going sideways, it slides on a little.)
	await until(async () => (await slime(A)).on === A, 2000);
	const moved = pa().getBounds(), s2 = await slime(A);
	l = await ledgeOf(A);
	check(moved.x - tb.x === 180 && moved.y - tb.y === -60, `the box moved (${tb.x},${tb.y} → ${moved.x},${moved.y})`);
	check(s2 && s2.on === A && Math.abs(s2.x - s.x - 180) < 50 && Math.abs(s2.bottom - l.y) < 6, `its rider moved with it (${s.x.toFixed(0)} → ${s2 && s2.x.toFixed(0)}), still sitting on it`);
	// Made wider from its left edge: the ledge follows; its rider stays put.
	tb = moved;
	await sleep(1000); // (it slid on a little as the box stopped)
	await until(async () => (await slime(A)).on === A, 2000);
	s = await slime(A);
	// (80 px wider: carried, the rider would jump 80 px left the moment
	// the edge moves; looked at straight after.)
	await pa().webContents.executeJavaScript(`(() => { blaubeTalk.resize('start', 'w', ${tb.x}, ${tb.y + 100}); blaubeTalk.resize('end', 'w', ${tb.x - 80}, ${tb.y + 100}); })()`);
	await until(async () => { const m = await ledgeOf(A); return m && m.x0 < l.x0 - 40; }, 1000);
	const s3 = await slime(A);
	l = await ledgeOf(A);
	check(l && l.x0 === pa().getBounds().x - sw.x + 42, `resized, its ledge goes with its edge (${JSON.stringify(l)})`);
	check(s3 && s3.on === A && Math.abs(s3.x - s.x) < 12, `and its rider isn't carried by the edge (${s.x.toFixed(0)} → ${s3 && s3.x.toFixed(0)})`);
	// (Sat in the middle, for the pictures.)
	await seat(A, { x: l.x0 + (l.x1 - l.x0) * 0.4, y: l.y - 160 });
	await sleep(1200);
	await until(async () => (await slime(A)).on === A, 2000);
	await shot('light', pa().getBounds());
	ipcMain.emit('talk-dark', {}, true);
	await sleep(500);
	await shot('dark', pa().getBounds());
	ipcMain.emit('talk-dark', {}, false);

	// The other slime's box, not pinned: in front of other windows, the
	// slimes are in front of both boxes; behind, the boxes are in front.
	await page(`window.blaube.talk(${JSON.stringify(B)}, { x: ${Math.round(sw.width * 0.75)}, y: ${Math.round(sw.height - 300)}, r: 60 })`);
	check(await until(() => talkId() === B && talk().isVisible()), 'another slime’s box opens');
	await sleep(400);
	let z = await stacking([win, pa(), talk()]);
	if (z) check(z.every((i) => i >= 0) && z[0] < z[1] && z[0] < z[2], `in front: the slimes are in front of the pinned and the open box (order ${z})`);
	ipcMain.emit('config-set', {}, { onTop: 'Off' });
	await sleep(400);
	z = await stacking([win, pa(), talk()]);
	if (z) check(z.every((i) => i >= 0) && z[0] > z[1] && z[0] > z[2], `behind: both boxes are in front of the slimes (order ${z})`);
	ipcMain.emit('config-set', {}, { onTop: 'On' });
	await sleep(400);
	z = await stacking([win, pa(), talk()]);
	if (z) check(z.every((i) => i >= 0) && z[0] < z[1] && z[0] < z[2], `in front again: the slimes in front (order ${z})`);
	if (!z) console.log('     (stacking order not checked: Windows only)');
	// B held up in front of A's box.
	const pb = pa().getBounds();
	await carry(B, { x: pb.x - sw.x + pb.width * 0.7, y: pb.y - sw.y + pb.height * 0.55 }, true);
	await sleep(200);
	await shot('front', pb);
	await letGo();
	await sleep(300);

	// Closing the box: its rider falls to the floor.
	// (It may have hopped down by now: up it goes again.)
	l = await ledgeOf(A);
	if ((await slime(A)).on !== A) await seat(A, { x: (l.x0 + l.x1) / 2, y: l.y - 160 });
	s = await slime(A);
	check(s.on === A, 'sitting on the box before it closes');
	await pa().webContents.executeJavaScript(`document.getElementById('close').click()`);
	check(await until(() => !pinned().get(A)), 'its ✕ closes it');
	check(await until(async () => (await ledgeOf(A)) === null, 1000), 'and its ledge goes');
	check(await until(async () => { const t = await slime(A); return t && t.floor && t.on !== A && t.bottom > sw.height - 200; }, 4000), 'its rider falls to the floor');

	for (const id of [A, B]) await hook(id, { hook_event_name: 'SessionEnd' });
	console.log(failed ? `${failed} FAILED` : 'all ok');
	return failed ? 1 : 0;
};
