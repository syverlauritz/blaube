// Pictures in the talk box: what you attached and what Claude points at
// show (only image files named in the conversation or in its folder, never
// anything else), a tap shows one big, and a drawing on one goes with your
// next message:
//
//   BLAUBE_TEST=scripts/e2e/media.js BLAUBE_PORT=47960 npx electron .
//
// Exits non-zero on a failure.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function run({ win, tracker, inbox, talk, talkId }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const js = (s) => win.webContents.executeJavaScript(s);
	const box = (s) => talk().webContents.executeJavaScript(s);
	const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false);
	await sleep(1000);

	// Its folder, with a picture and a text file called .png; and a folder
	// elsewhere with one picture you attached and one nobody named.
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-media-'));
	const folder = path.join(tmp, 'project'), elsewhere = path.join(tmp, 'elsewhere');
	fs.mkdirSync(folder); fs.mkdirSync(elsewhere);
	const png = fs.readFileSync(path.join(__dirname, '..', '..', 'build', 'icon.png'));
	fs.writeFileSync(path.join(folder, 'shot.png'), png);
	fs.writeFileSync(path.join(folder, 'fake.png'), 'not a picture at all');
	fs.writeFileSync(path.join(folder, 'notes.txt'), 'hello');
	const attached = path.join(elsewhere, 'mine.png'), secret = path.join(elsewhere, 'secret.png');
	fs.writeFileSync(attached, png);
	fs.writeFileSync(secret, png);

	const id = 'media' + Date.now(), ID = JSON.stringify(id);
	tracker.handle({ session_id: id, cwd: folder, hook_event_name: 'SessionStart' });
	inbox.reachable.add(id); // (as if its inbox hook had asked: a box you can type in)
	inbox.add(id, { who: 'you', text: `make the icon rounder\n\nAttached file (open with your Read tool): ${attached}`, via: 'blaube', status: 'sent' });
	inbox.add(id, { who: 'claude', text: 'Here it is now:\n\n![the icon](shot.png)\n\nI left `fake.png` alone.' });
	check(await until(() => js(`!!__blaube.buddies.get(${ID})`), 6000), 'its slime is there');
	await sleep(1500);
	const at = await js(`(() => { const b = __blaube.buddies.get(${ID}), c = b.body.centroid(); return { x: c.x, y: c.y, r: b.body.o.radius }; })()`);
	await js(`window.blaube.talk(${ID}, ${JSON.stringify(at)})`);
	check(await until(() => talk() && talk().isVisible() && talkId() === id, 8000), 'its talk box opens');
	talk().webContents.setBackgroundThrottling(false);

	// What shows.
	const shown = (sel) => box(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((p) => !p.hidden && p.querySelector('img').complete && p.querySelector('img').naturalWidth > 0).length`);
	check(await until(async () => (await shown('.msg.claude .pic')) === 1), 'Claude’s reply shows the picture it points at (and not the text file called .png)');
	check(await until(async () => (await shown('.msg.you .pic')) === 1), 'your message shows the picture you attached');
	check(!(await box(`document.querySelector('.msg.you').textContent.includes('Attached file')`)), 'and not the line saying where it is');
	check(!(await box(`/!\\[/.test(document.querySelector('.msg.claude').textContent)`)), 'the markdown for the picture isn’t shown as text');

	// What the app will and won't read.
	const image = (p) => box(`blaubeTalk.image(${ID}, ${JSON.stringify(p)})`);
	const ok = (r) => !!(r && /^data:image\/png;base64,/.test(r.url));
	check(ok(await image('shot.png')), 'a picture in its folder, by its relative path');
	check(ok(await image(path.join(folder, 'shot.png'))), 'and by its full path');
	check(ok(await image(attached)), 'a picture named in what you said, from elsewhere');
	check(!(await image(secret)), 'not a picture elsewhere that nobody named');
	check(!(await image(path.join(folder, 'fake.png'))), 'not a file called .png that isn’t a picture');
	check(!(await image(path.join(folder, 'notes.txt'))), 'not a file that isn’t a picture');
	check(!(await image('../elsewhere/secret.png')), 'not out of its folder by ..');
	check(!(await image(42)), 'not nonsense');

	// Tap: big; Esc: back (the box stays).
	await box(`document.querySelector('.msg.claude .pic .show').click()`);
	check(await until(() => box(`!document.getElementById('viewer').hidden && document.getElementById('viewImg').naturalWidth > 0`)), 'a tap shows it big');
	await box(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	check(await until(() => box(`document.getElementById('viewer').hidden`)), 'Esc puts it away');
	await sleep(400);
	check(talk().isVisible(), 'and the box stays open');

	// The pencil: draw on it, add it to the message.
	await box(`document.querySelector('.msg.claude .pic .draw').click()`);
	check(await until(() => box(`!document.getElementById('markup').hidden && document.getElementById('markCanvas').width > 0`)), 'the pencil opens it for drawing');
	const drew = await box(`(async () => {
		const c = document.getElementById('markCanvas'), r = c.getBoundingClientRect();
		const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: r.left + x * r.width, clientY: r.top + y * r.height }));
		ev('pointerdown', 0.2, 0.2); ev('pointermove', 0.5, 0.45); ev('pointermove', 0.8, 0.7); ev('pointerup', 0.8, 0.7); // (the arrow: a straight line from the first to the last)
		await new Promise((done) => requestAnimationFrame(done));
		const px = c.getContext('2d').getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.45), 1, 1).data;
		return { undo: !document.getElementById('markUndo').disabled, px: [...px] };
	})()`);
	check(drew.undo && drew.px[0] > 235 && drew.px[1] < 90 && drew.px[2] > 60 && drew.px[2] < 130, `an arrow goes on, in red (${drew.px.slice(0, 3)})`);
	await box(`document.getElementById('markUndo').click()`);
	check(await box(`document.getElementById('markUndo').disabled`), 'undo takes it off');
	await box(`(() => { const c = document.getElementById('markCanvas'), r = c.getBoundingClientRect(); const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: r.left + x * r.width, clientY: r.top + y * r.height })); ev('pointerdown', 0.3, 0.3); ev('pointermove', 0.6, 0.6); ev('pointerup', 0.6, 0.6); })()`);
	await box(`document.getElementById('markAdd').click()`);
	check(await until(() => box(`document.getElementById('markup').hidden && !!document.querySelector('#files .file.haspic img')`)), '“Add to message” puts it by the field, as a little picture');
	const saved = await box(`document.querySelector('#files .file').title`);
	let real = false;
	try { real = fs.readFileSync(saved).subarray(0, 4).toString('latin1') === '\x89PNG'; } catch { /* checked below */ }
	check(real, `saved as a PNG where Claude can read it (${saved})`);
	check(!(await box(`document.getElementById('send').disabled`)), 'and Send is ready for it');
	// Esc while drawing closes the drawing, not the box.
	await box(`document.querySelector('#files .file .draw').click()`);
	await until(() => box(`!document.getElementById('markup').hidden`));
	await box(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	check(await until(() => box(`document.getElementById('markup').hidden`)), 'Esc while drawing puts the drawing away');
	await sleep(400);
	check(talk().isVisible(), 'and the box stays open');

	fs.rmSync(tmp, { recursive: true, force: true });
	try { fs.rmSync(saved, { force: true }); } catch { /* gone */ }
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
