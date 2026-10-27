// The 9:16 trailer, played on the portrait screen and recorded with ffmpeg:
//
//   BLAUBE_FILM=scripts/film/trailer.js BLAUBE_PORT=47890 npx electron .
//
// (FILM_NO_REC=1 plays it without recording; BLAUBE_TEST instead of
// BLAUBE_FILM plays it unseen.) The blobs only ever move by physics: fake
// sessions and helpers, the games and tricks on cue (as Show off starts
// them), and grabbing and flinging them like a hand would. The cards are
// real windows, so the blobs land on them, ride them and fall off them.
// Between scenes things are set up off camera; cut.js keeps only the scenes
// (scripts/film/marks.json says when each one played).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BrowserWindow, screen, ipcMain } = require('electron');

const HERE = __dirname;
const OUT = path.join(HERE, 'out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The cast: one of each model, effort and look.
const CAST = {
	blaube: { model: 'claude-opus-4-5', effort: 'medium', look: 'curl', tokens: 600000 },
	kalkis: { model: 'claude-sonnet-4-5', effort: 'low', look: 'bunny', tokens: 300000 },
	website: { model: 'claude-haiku-4-5', effort: 'high', look: 'none', tokens: 200000 },
	docs: { model: 'claude-fable-5', effort: 'max', look: 'catears', tokens: 250000 },
};

module.exports = async function run({ win, tracker, inbox, talk, moveToDisplay, otherWindows, demoTokens, demoEfforts, pickedModel, pushState, talkSize }) {
	win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('[film] renderer:', e.message); });
	const js = (s) => win.webContents.executeJavaScript(s).catch((err) => { console.log('[film] failed:', s.slice(0, 160)); throw err; });
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	const portrait = screen.getAllDisplays().find((d) => d.bounds.height > d.bounds.width) || screen.getPrimaryDisplay();
	const X0 = portrait.bounds.x, Y0 = portrait.bounds.y, SW = portrait.bounds.width;
	moveToDisplay(portrait.id);
	talkSize(1000, 1000);
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false);
	ipcMain.emit('config-set', {}, { size: 1.6, liveliness: 1, snackJar: 'Off' });
	await js(`__blaube.ownMouse = true; __blaube.input.move({ clientX: ${SW / 2}, clientY: 200 })`);
	await sleep(1500);
	const wb = () => win.getBounds();
	const floor = await js('innerHeight');

	// --- The cards: real windows, and their tops are ledges -------------------
	const cards = [];
	const pushLedges = () => otherWindows(cards.filter((c) => !c.isDestroyed() && c.isVisible()).reverse()
		.map((c) => Object.assign({ id: `card${c.id}` }, c.getBounds())));
	const ledgeTimer = setInterval(pushLedges, 16);
	async function card({ title, text, size = 84, sub = '', x, y, w, h }) {
		const c = new BrowserWindow({ x: Math.round(X0 + (x === undefined ? (SW - w) / 2 : x)), y: Math.round(Y0 + y), width: w, height: h, show: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, title, backgroundColor: '#efe4cc', icon: path.join(HERE, '..', '..', 'build', 'icon.png') });
		c.removeMenu();
		c.on('page-title-updated', (e) => e.preventDefault());
		await c.loadFile(path.join(HERE, 'card.html'), { query: { text, size: String(size), sub } });
		if (!process.env.BLAUBE_FILM) c.setOpacity(0); // (a dry run as a test: unseen)
		c.showInactive();
		cards.push(c);
		return c;
	}
	const close = (...cs) => { for (const c of cs) if (c && !c.isDestroyed()) c.destroy(); };
	const closeAll = () => { close(...cards); cards.length = 0; };
	const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
	const top = (c) => c.getBounds().y - wb().y; // (its ledge, in the blobs' own y)
	async function slide(c, dx, dy, ms, curve = ease) {
		const b = c.getBounds(), t0 = Date.now();
		for (;;) {
			const t = Math.min(1, (Date.now() - t0) / ms), k = curve(t);
			if (c.isDestroyed()) return;
			c.setBounds({ x: Math.round(b.x + dx * k), y: Math.round(b.y + dy * k), width: b.width, height: b.height });
			if (t >= 1) return;
			await sleep(8);
		}
	}

	// --- The blobs --------------------------------------------------------------
	const ev = (id, hook_event_name, extra = {}) => tracker.handle({ session_id: id, cwd: path.join('C:\\code', id), hook_event_name, ...extra });
	const idle = (...ids) => { for (const id of ids) { const s = tracker.sessions.get(id); if (s) { s.state = 'idle'; s.seen = true; } } pushState(); };
	const B = (id) => `__blaube.buddies.get(${JSON.stringify(id)})`;
	const has = (id) => js(`!!${B(id)}`);
	const settled = (ids, ms = 5000) => until(() => js(`[${ids.map(B).join(',')}].every((b) => b && !b.body.grab && Math.hypot(b.body.velocity(1 / 120).x, b.body.velocity(1 / 120).y) < 30)`), ms);
	async function arrive(id) {
		const c = CAST[id];
		demoEfforts.set(id, c.effort);
		pickedModel.set(id, c.model);
		demoTokens.set(id, { total: c.tokens, context: 40000, limit: 200000 });
		ev(id, 'SessionStart');
		await until(() => has(id), 8000);
		await js(`(() => { const b = ${B(id)}; b.chosenLook = ${JSON.stringify(c.look)}; b.chosenLookFor = b.key; })()`);
	}
	// Off camera: put a blob somewhere, still.
	const place = (id, x, y) => js(`(() => { const b = ${B(id)}; b.body.teleport(${x}, ${y}); const v = b.body.velocity(1 / 120); b.body.impulse(-v.x, -v.y, 1 / 120); })()`);
	const r = (id) => js(`${B(id)}.body.o.radius`);
	// Sitting on a card: dropped just above it.
	const onCard = async (id, c, fx = 0.5) => { const b = c.getBounds(); await place(id, b.x - wb().x + b.width * fx, top(c) - (await r(id)) * 1.6); };
	const onFloor = async (id, x) => place(id, x, floor - (await r(id)) * 1.4);
	// Like a hand: grab it, carry it along a path, let go (it flies on with the speed it had).
	const carry = (id, pts, ms) => js(`(async () => {
		const b = ${B(id)}, raf = () => new Promise((r) => requestAnimationFrame(r)), pts = ${JSON.stringify(pts)};
		const c = b.body.centroid();
		b.body.startGrab(c.x, c.y);
		const all = [[c.x, c.y], ...pts], t0 = performance.now();
		for (;;) {
			const t = Math.min(1, (performance.now() - t0) / ${ms}), f = t * (all.length - 1), i = Math.min(all.length - 2, Math.floor(f)), k = f - i;
			b.body.moveGrab(all[i][0] + (all[i + 1][0] - all[i][0]) * k, all[i][1] + (all[i + 1][1] - all[i][1]) * k);
			if (t >= 1) break;
			await raf();
		}
		b.body.endGrab();
	})()`);
	// Tossed onto a card: a lob that comes down onto its top.
	const toss = async (id, c, fx = 0.5, ms = 650) => { const p = await js(`${B(id)}.body.centroid()`), b = c.getBounds(), x = b.x - wb().x + b.width * fx, y = top(c) - 260; await carry(id, [[(p.x + x) / 2, Math.min(p.y, y) - 250], [x, y]], ms); };
	const clickBlob = async (id) => {
		const c = await js(`${B(id)}.body.centroid()`);
		for (const type of ['mouseDown', 'mouseUp']) { win.webContents.sendInputEvent({ type, x: Math.round(c.x), y: Math.round(c.y), button: 'left', clickCount: 1 }); await sleep(60); }
	};
	const look = (x, y) => js(`__blaube.input.move({ clientX: ${x}, clientY: ${y} })`);
	let helpers = 0;
	const helper = (id, type = 'Explore') => { const a = `h${++helpers}`; ev(id, 'SubagentStart', { agent_id: a, agent_type: type }); return a; };
	const helperDone = (id, a) => ev(id, 'SubagentStop', { agent_id: a });

	// --- Recording ----------------------------------------------------------
	fs.mkdirSync(OUT, { recursive: true });
	const marks = [];
	let rec = null, t0 = Date.now();
	if (process.env.BLAUBE_FILM && !process.env.FILM_NO_REC) {
		rec = spawn('C:\\ffmpeg\\bin\\ffmpeg.exe', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'lavfi', '-i', `ddagrab=output_idx=${process.env.FILM_OUTPUT || 1}:framerate=60:draw_mouse=0,hwdownload,format=bgra,transpose=1`,
			'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', path.join(OUT, 'raw.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
		t0 = Date.now();
		await sleep(1500);
	}
	const scene = async (name, f) => {
		const start = (Date.now() - t0) / 1000;
		console.log(`[film] ${name} at ${start.toFixed(2)}s`);
		await f();
		marks.push({ name, start, end: (Date.now() - t0) / 1000 });
		console.log('[film]   blobs:', await js(`[...__blaube.buddies.entries()].map(([k, b]) => k + '@' + Math.round(b.body.centroid().x) + ',' + Math.round(b.body.centroid().y) + (b.body.onLedge ? '^' : '')).join(' ')`));
	};
	// A caption the blobs stand on and play on.
	const stage = (text) => card({ title: 'readme.txt', text, size: 120, w: 1400, h: 300, x: 20, y: 1500 });
	const caption = (text) => card({ title: 'readme.txt', text, size: 120, w: 1340, h: 300, y: 200 });

	try {
		// 1. The painting: a blob sitting on "Ceci n'est pas un blob."
		const painting = await card({ title: 'ceci n\'est pas un blob.txt', text: 'Ceci n\'est pas un blob.', size: 130, w: 1340, h: 380, y: 1450 });
		await arrive('blaube');
		await sleep(2500);
		await onCard('blaube', painting);
		await settled(['blaube'], 6000);
		await sleep(600);
		await scene('painting', async () => {
			await look(SW / 2 + 260, 1250);
			await sleep(2200);
			// Yanked away: it hangs there a moment, then falls.
			await slide(painting, -SW - 200, 0, 120, (t) => t);
			close(painting);
			await sleep(1800);
		});
		await look(SW / 2, -600); // (the cursor out of the way: hovering a blob would show its details)

		// 2. The name: tossed up onto it, and its family splits off.
		const title = await card({ title: 'blaube.txt', text: 'blaube', size: 380, w: 1300, h: 620, y: 1250 });
		await settled(['blaube'], 4000);
		await scene('title', async () => {
			await sleep(300);
			await toss('blaube', title, 0.5, 600);
			await sleep(900);
			const a = helper('blaube'), b = helper('blaube', 'Plan');
			await sleep(1500);
			await arrive('kalkis');
			await sleep(1600);
			helperDone('blaube', a);
			await sleep(700);
			helperDone('blaube', b);
			await sleep(900);
		});
		await sleep(2000);
		close(title);

		// 3a. It watches your Claude Code: each on its own window, at work.
		await arrive('website');
		await arrive('docs');
		const ALL = Object.keys(CAST);
		const cap1 = await caption('it watches your Claude Code');
		const w1 = await card({ title: 'kalkis — tax.js', text: 'kalkis', size: 90, x: 60, y: 1350, w: 620, h: 260 });
		const w2 = await card({ title: 'website — npm test', text: 'website', size: 90, x: 760, y: 1000, w: 620, h: 260 });
		const w3 = await card({ title: 'docs — README.md', text: 'docs', size: 90, x: 760, y: 1800, w: 620, h: 260 });
		await onCard('kalkis', w1, 0.35); await onCard('website', w2); await onCard('docs', w3, 0.6); await onFloor('blaube', 300);
		await settled(ALL, 6000);
		await sleep(500);
		await scene('watches', async () => {
			ev('kalkis', 'UserPromptSubmit', { prompt: 'fix the tax table' });
			inbox.todos.set('kalkis', [{ content: 'Read the table', status: 'completed' }, { content: 'Fix the rounding', status: 'in_progress' }, { content: 'Run the tests', status: 'pending' }]);
			ev('kalkis', 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\code\\kalkis\\tax.js' } });
			ev('website', 'UserPromptSubmit', { prompt: 'run the tests' });
			ev('website', 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
			ev('docs', 'UserPromptSubmit', { prompt: 'write the docs' });
			const h1 = helper('docs'), h2 = helper('docs', 'general-purpose');
			ev('blaube', 'UserPromptSubmit', { prompt: 'make them sing' });
			await sleep(1800);
			ev('website', 'Notification', { message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' });
			inbox.todos.set('kalkis', [{ content: 'Read the table', status: 'completed' }, { content: 'Fix the rounding', status: 'completed' }, { content: 'Run the tests', status: 'in_progress' }]);
			ev('kalkis', 'PostToolUse', { tool_name: 'Edit' });
			await sleep(1200);
			ev('blaube', 'Stop', { last_assistant_message: 'Done! Five parts, the biggest blob takes the bass.' });
			helperDone('docs', h1);
			await sleep(1500);
			helperDone('docs', h2);
			await sleep(1200);
		});
		close(cap1, w1, w2, w3);
		inbox.todos.delete('kalkis');
		for (const id of ALL) ev(id, 'Stop');
		idle(...ALL);
		await sleep(1500);

		// 3b. Talk to it: its box opens, and another one hops up onto it.
		const cap2 = await caption('talk to it');
		await onFloor('blaube', SW * 0.25); await onFloor('kalkis', SW * 0.75); await onFloor('website', SW * 0.55); await onFloor('docs', SW * 0.9);
		inbox.reachable.add('blaube'); // (as if its hooks were connected: no "connect" note)
		inbox.add('blaube', { who: 'you', text: 'can the blobs sing together?' });
		inbox.add('blaube', { who: 'claude', text: 'Yes! Every blob takes a part: the tune, a bass, an alto, a tenor and a high "oo" over it all.' });
		inbox.add('blaube', { who: 'you', text: 'make them sing in parts' });
		inbox.add('blaube', { who: 'step', text: 'Read choir.js' });
		inbox.add('blaube', { who: 'step', text: 'Edited choir.js' });
		inbox.add('blaube', { who: 'step', text: 'Ran npm test · 42 passed' });
		inbox.add('blaube', { who: 'claude', text: 'Done! Five parts now: one sings the tune, the biggest blobs take the bass.' });
		await settled(ALL, 5000);
		await scene('talk', async () => {
			await clickBlob('blaube');
			await sleep(400);
			talk().webContents.setZoomFactor(1.35); // (readable on a phone)
			await sleep(1100);
			const box = await js(`__blaube.ledges().find((l) => l.talk)`), boxTop = box.y; // (the flat of the bubble's top)
			const k = await js(`${B('kalkis')}.body.centroid()`);
			await carry('kalkis', [[k.x, boxTop - 380], [box.x0 + (box.x1 - box.x0) * 0.65, boxTop - 230]], 700);
			await sleep(2200);
		});
		await clickBlob('blaube'); // (clicked again, its box closes)
		close(cap2);
		idle(...ALL);

		// 3c. It counts your cookies.
		ipcMain.emit('config-set', {}, { snackJar: 'On' });
		const HR = 3600e3;
		const usage = (five) => ({ status: 'allowed', windows: [{ kind: 'five_hour', used: five, resetsAt: Date.now() + 2 * HR, status: 'allowed' }, { kind: 'seven_day', used: 0.3, resetsAt: Date.now() + 90 * HR, status: 'allowed' }] });
		global.__blaubeSetLimits(usage(0.3));
		const cap3 = await stage('it counts your cookies');
		await sleep(1500);
		// The jar up on the card (as if dragged there), one blob beside it, the rest below.
		await js(`(() => { const j = __blaube.jar(); j.x = ${SW * 0.3}; j.y = ${top(cap3) - 200}; j.vx = 0; j.vy = 0; j.placed = true; })()`);
		await onCard('kalkis', cap3, 0.62);
		await onFloor('docs', SW * 0.15); await onFloor('blaube', SW * 0.5); await onFloor('website', SW * 0.85);
		await settled(ALL, 4000);
		await scene('cookies', async () => {
			await sleep(400);
			global.__blaubeSetLimits(usage(0.45));
			await sleep(3200);
		});
		close(cap3);
		ipcMain.emit('config-set', {}, { snackJar: 'Off' });
		idle(...ALL);

		// 3d. It plays: quick cuts of the games.
		const cap4 = await stage('it plays');
		const pair = async (a, b2, gap = 1.3) => { const ra = await r(a), rb = await r(b2); await onCard(a, cap4, 0.38); await onCard(b2, cap4, 0.38 + (ra + rb) * gap / 1400); };
		await pair('blaube', 'kalkis'); await onFloor('website', SW * 0.1); await onFloor('docs', SW * 0.9);
		await settled(ALL, 4000);
		await scene('tower', async () => { await js(`__blaube.play.tower(${B('blaube')}, ${B('kalkis')})`); await sleep(3600); });
		await pair('website', 'docs', 1.15); await onFloor('blaube', SW * 0.1); await onFloor('kalkis', SW * 0.9);
		await settled(ALL, 4000);
		await scene('leapfrog', async () => { await js(`__blaube.play.frog(${B('website')}, ${B('docs')})`); await sleep(3200); });
		await onCard('blaube', cap4, 0.5); await onCard('kalkis', cap4, 0.2); await onCard('website', cap4, 0.8); await onFloor('docs', SW * 0.5);
		await settled(ALL, 4000);
		await scene('rope', async () => { await js(`__blaube.play.rope(${B('blaube')}, ${B('kalkis')}, ${B('website')})`); await sleep(4200); });
		await onCard('docs', cap4, 0.5); await onCard('blaube', cap4, 0.2); await onCard('kalkis', cap4, 0.8); await onFloor('website', SW * 0.5);
		await settled(ALL, 4000);
		await scene('dogpile', async () => { await js(`__blaube.play.pile(${B('docs')}, [${B('blaube')}, ${B('kalkis')}, ${B('website')}])`); await sleep(5000); });
		close(cap4);
		idle(...ALL);

		// 3e. It sings.
		const cap5 = await stage('it sings');
		for (const [i, id] of ALL.entries()) await onCard(id, cap5, 0.14 + i * 0.24);
		await settled(ALL, 5000);
		await scene('sings', async () => {
			win.webContents.send('command', 'choir:' + (await js(`BlaubeSongs.SONGS[0].id`)));
			await sleep(4500);
			win.webContents.send('command', 'choir-stop');
		});
		close(cap5);
		idle(...ALL);

		// 3f. Don't shake it.
		const cap6 = await caption('don\'t shake it');
		for (const [i, id] of ALL.entries()) await onFloor(id, SW * (0.14 + i * 0.24));
		await settled(ALL, 4000);
		await scene('shake', async () => {
			const c = await js(`${B('website')}.body.centroid()`);
			await carry('website', [[c.x, c.y - 400], [SW / 2, 1200]], 600);
			await js(`(async () => {
				const b = ${B('website')}, raf = () => new Promise((r) => requestAnimationFrame(r));
				const c = b.body.centroid(); b.body.startGrab(c.x, c.y);
				const t0 = performance.now();
				while (performance.now() - t0 < 6000 && !b.barf) { const t = (performance.now() - t0) / 1000; b.body.moveGrab(${SW / 2} + Math.sin(t * 2 * Math.PI * 3.4) * 180, 1200 + Math.cos(t * 2 * Math.PI * 1.7) * 40); await raf(); }
				for (let i = 0; i < 20; i++) { b.body.moveGrab(${SW / 2}, 1200); await raf(); }
			})()`);
			console.log('[film]   barfed:', await js(`!!${B('website')}.barf`));
			await sleep(2200);
			await js(`${B('website')}.body.endGrab()`);
			await sleep(1500);
		});
		close(cap6);
		idle(...ALL);

		// 4. And it is soft: a lift up, a shake, a flick, and onto the next one.
		const soft = await card({ title: 'soft.txt', text: 'and it is soft.', size: 150, w: 1000, h: 340, x: 60, y: 1900 });
		const shelf = await card({ title: 'shelf.txt', text: '', size: 10, w: 560, h: 200, x: 840, y: 700 });
		await onCard('blaube', soft, 0.25); await onCard('kalkis', soft, 0.5); await onCard('docs', soft, 0.75); await onFloor('website', SW * 0.9);
		await settled(ALL, 6000);
		await sleep(400);
		await scene('soft', async () => {
			// Up it goes, like a lift.
			await slide(soft, 0, -700, 1100);
			await sleep(300);
			for (let i = 0; i < 5; i++) await slide(soft, i % 2 ? 220 : -220, 0, 150, (t) => Math.sin(t * Math.PI / 2));
			await sleep(700);
			// Flicked: up and stop, they fly, some land on the shelf.
			await slide(soft, 120, -320, 90, (t) => t);
			await slide(soft, 0, 320, 380);
			await sleep(2400);
		});
		close(soft, shelf);

		// 5. The end.
		const end = await card({ title: 'ceci est un blaube.txt', text: 'Ceci est un blaube.', size: 140, sub: 'for Mac and Windows\ngithub.com/syverlauritz/blaube', w: 1340, h: 520, y: 1250 });
		await onCard('blaube', end, 0.5);
		await onFloor('kalkis', SW * 0.2); await onFloor('website', SW * 0.5); await onFloor('docs', SW * 0.8);
		await settled(ALL, 6000);
		await scene('end', async () => {
			await sleep(800);
			helper('blaube');
			await sleep(3200);
		});
		close(end);
	} finally {
		clearInterval(ledgeTimer);
		closeAll();
		fs.writeFileSync(path.join(HERE, 'marks.json'), JSON.stringify(marks, null, '\t'));
		if (rec) { rec.stdin.write('q'); await new Promise((r) => rec.on('exit', r)); }
	}
	return 0;
};
