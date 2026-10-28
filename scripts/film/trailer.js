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
//
// It runs on the defaults in src/shared/config.js (the current tuning), at the default Size.
// For blobs big enough on a phone, set the portrait screen's scale to 200%
// in Windows' display settings: everything grows together, physics and all.
// The layout is drawn for a 1440-wide screen and scales to the real one.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BrowserWindow, screen, ipcMain, app } = require('electron');
const { DEFAULTS } = require('../../src/shared/config');

const HERE = __dirname;
const OUT = path.join(HERE, 'out');
const SONG = process.env.FILM_SONG || 'la-vie-en-rose';
// FILM_ONLY=sings films just the choir: the four on a card singing the whole song.
const ONLY = process.env.FILM_ONLY || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The cast: one of each model, effort and look.
const CAST = {
	blaube: { model: 'claude-opus-4-5', effort: 'medium', look: 'curl', tokens: 600000 },
	api: { model: 'claude-sonnet-4-5', effort: 'low', look: 'bunny', tokens: 300000 },
	website: { model: 'claude-haiku-4-5', effort: 'high', look: 'none', tokens: 200000 },
	docs: { model: 'claude-fable-5', effort: 'max', look: 'catears', tokens: 250000 },
};

module.exports = async function run({ win, tracker, inbox, talk, moveToDisplay, otherWindows, demoTokens, demoEfforts, pickedModel, pushState, talkSize, setBlobHidden }) {
	win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('[film] renderer:', e.message); });
	const js = (s) => win.webContents.executeJavaScript(s).catch((err) => { console.log('[film] failed:', s.slice(0, 160)); throw err; });
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	const portrait = screen.getAllDisplays().find((d) => d.bounds.height > d.bounds.width) || screen.getPrimaryDisplay();
	const X0 = portrait.bounds.x, Y0 = portrait.bounds.y, SW = portrait.bounds.width;
	const U = SW / 1440, P = (n) => Math.round(n * U); // (the layout's pixels to the screen's)
	console.log(`[film] portrait screen ${SW}x${portrait.bounds.height} at scale ${portrait.scaleFactor}`);
	moveToDisplay(portrait.id);
	talkSize(P(1000), P(1000));
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false);
	// (status bubbles pop up by themselves, so you see what each is doing)
	ipcMain.emit('config-set', {}, { size: DEFAULTS.size, liveliness: 1, snackJar: 'Off', statusBubbles: DEFAULTS.statusBubbles, voice: 'On' });
	await js(`__blaube.ownMouse = true; __blaube.input.move({ clientX: ${SW / 2}, clientY: -600 })`);
	// The sound, taken straight from the blobs' own audio: whatever reaches
	// the speakers is also recorded, from the first sound on (its clock time
	// noted, for cut.js to line it up with the video).
	await js(`(() => {
		const connect = AudioNode.prototype.connect;
		window.__film = { chunks: [], at: 0, rec: null };
		AudioNode.prototype.connect = function (to, ...rest) {
			const out = connect.call(this, to, ...rest);
			if (to instanceof AudioDestinationNode) {
				const f = window.__film;
				if (!f.tap) {
					f.tap = to.context.createMediaStreamDestination();
					f.rec = new MediaRecorder(f.tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
					f.rec.ondataavailable = (e) => f.chunks.push(e.data);
					f.rec.start(1000);
					f.at = Date.now();
				}
				connect.call(this, f.tap);
			}
			return out;
		};
	})()`);
	await sleep(1500);
	const wb = () => win.getBounds();
	const floor = await js('innerHeight');

	// --- The cards: real windows, and their tops are ledges -------------------
	const cards = [];
	const pushLedges = () => otherWindows(cards.filter((c) => !c.isDestroyed() && c.isVisible()).reverse()
		.map((c) => Object.assign({ id: `card${c.id}` }, c.getBounds())));
	const ledgeTimer = setInterval(pushLedges, 16);
	// (x, y, w, h and size in the layout's pixels)
	async function card({ title, text, size = 84, sub = '', x, y, w, h }) {
		const c = new BrowserWindow({ x: X0 + (x === undefined ? Math.round((SW - P(w)) / 2) : P(x)), y: Y0 + P(y), width: P(w), height: P(h), show: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, title, backgroundColor: '#efe4cc', icon: path.join(HERE, '..', '..', 'build', 'icon.png') });
		c.removeMenu();
		c.on('page-title-updated', (e) => e.preventDefault());
		await c.loadFile(path.join(HERE, 'card.html'), { query: { text, size: String(size * U), sub, subSize: String(34 * U) } });
		if (!process.env.BLAUBE_FILM) c.setOpacity(0); // (a dry run as a test: unseen)
		c.showInactive();
		cards.push(c);
		return c;
	}
	const close = (...cs) => { for (const c of cs) if (c && !c.isDestroyed()) c.destroy(); };
	const closeAll = () => { close(...cards); cards.length = 0; };
	const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
	const top = (c) => c.getBounds().y - wb().y; // (its ledge, in the blobs' own y)
	// Moves a card by (dx, dy) layout pixels.
	async function slide(c, dx, dy, ms, curve = ease) {
		const b = c.getBounds(), t0 = Date.now();
		for (;;) {
			const t = Math.min(1, (Date.now() - t0) / ms), k = curve(t);
			if (c.isDestroyed()) return;
			c.setBounds({ x: Math.round(b.x + dx * U * k), y: Math.round(b.y + dy * U * k), width: b.width, height: b.height });
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
	const onFloor = async (id, fx) => place(id, SW * fx, floor - (await r(id)) * 1.4);
	// Like a hand: grab it, carry it along a path (the blobs' own pixels), let go (it flies on with the speed it had).
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
	const toss = async (id, c, fx = 0.5, ms = 650) => { const p = await js(`${B(id)}.body.centroid()`), b = c.getBounds(), x = b.x - wb().x + b.width * fx, y = top(c) - P(260); await carry(id, [[(p.x + x) / 2, Math.min(p.y, y) - P(250)], [x, y]], ms); };
	const clickBlob = async (id) => {
		const c = await js(`${B(id)}.body.centroid()`);
		for (const type of ['mouseDown', 'mouseUp']) { win.webContents.sendInputEvent({ type, x: Math.round(c.x), y: Math.round(c.y), button: 'left', clickCount: 1 }); await sleep(60); }
	};
	const look = (x, y) => js(`__blaube.input.move({ clientX: ${x}, clientY: ${y} })`);
	const lookAway = () => look(SW / 2, -600); // (the cursor out of the way: hovering a blob would show its details)
	let helpers = 0;
	const helper = (id, type = 'Explore') => { const a = `h${++helpers}`; ev(id, 'SubagentStart', { agent_id: a, agent_type: type }); return a; };
	const helperDone = (id, a) => ev(id, 'SubagentStop', { agent_id: a });

	// --- Recording ----------------------------------------------------------
	fs.mkdirSync(OUT, { recursive: true });
	const marks = [];
	let rec = null, t0 = Date.now();
	const sync = {};
	if (process.env.BLAUBE_FILM && !process.env.FILM_NO_REC) {
		rec = spawn('C:\\ffmpeg\\bin\\ffmpeg.exe', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'lavfi', '-i', `ddagrab=output_idx=${process.env.FILM_OUTPUT || 1}:framerate=60:draw_mouse=0,hwdownload,format=bgra,transpose=1`,
			'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', path.join(OUT, 'raw.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
		t0 = Date.now();
		await sleep(1500);
		// A magenta square in the corner for a moment: cut.js finds it in the
		// video, which ties the video's clock to this one (and so to the sound's).
		const flash = new BrowserWindow({ x: X0, y: Y0, width: P(60), height: P(60), frame: false, show: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, backgroundColor: '#ff00ff' });
		flash.showInactive();
		sync.flash = Date.now();
		await sleep(400);
		flash.destroy();
	}
	const scene = async (name, f) => {
		const start = (Date.now() - t0) / 1000;
		console.log(`[film] ${name} at ${start.toFixed(2)}s`);
		await f();
		marks.push({ name, start, end: (Date.now() - t0) / 1000 });
		console.log('[film]   blobs:', await js(`[...__blaube.buddies.entries()].map(([k, b]) => k + '@' + Math.round(b.body.centroid().x) + ',' + Math.round(b.body.centroid().y) + (b.body.onLedge ? '^' : '')).join(' ')`));
	};
	// A caption up top, or one low down that the blobs stand and play on.
	const caption = (text) => card({ title: 'readme.txt', text, size: 120, w: 1340, h: 300, y: 200 });
	const stage = (text) => card({ title: 'readme.txt', text, size: 120, w: 1400, h: 300, x: 20, y: 1500 });

	try {
		film: {
		if (ONLY === 'sings') {
			for (const id of Object.keys(CAST)) await arrive(id);
			const ALL = Object.keys(CAST);
			await sleep(2500);
			const cap = await stage('they sing');
			for (const [i, id] of ALL.entries()) await onCard(id, cap, 0.14 + i * 0.24);
			await settled(ALL, 6000);
			idle(...ALL);
			await sleep(1500);
			const seconds = await js(`(() => { const s = BlaubeSongs.SONGS.find((x) => x.id === ${JSON.stringify(SONG)}); return s.notes.trim().split(/\\s+/).reduce((n, x) => n + Number(x.split(':')[1]), 0) * 60 / s.bpm; })()`);
			console.log(`[film] ${SONG}: ${seconds.toFixed(1)} s`);
			await scene('sings', async () => {
				win.webContents.send('command', `choir:${SONG}`);
				await sleep(seconds * 1000 + 1500);
				win.webContents.send('command', 'choir-stop');
				await sleep(800);
			});
			close(cap);
			break film;
		}
		// 1. The painting: a blob sitting on "Ceci n'est pas un blob."
		const painting = await card({ title: 'ceci n\'est pas un blob.txt', text: 'Ceci n\'est pas un blob.', size: 130, w: 1340, h: 380, y: 1450 });
		await arrive('blaube');
		await sleep(2500);
		await onCard('blaube', painting);
		await settled(['blaube'], 6000);
		await sleep(600);
		await scene('painting', async () => {
			await look(SW / 2 + P(260), P(1250));
			await sleep(2200);
			// Yanked away: it hangs there a moment, then falls.
			await slide(painting, -1640, 0, 120, (t) => t);
			close(painting);
			await sleep(1800);
		});
		await lookAway();

		// 2. The name: tossed up onto it, and its family splits off.
		const title = await card({ title: 'blaube.txt', text: 'blaube', size: 380, w: 1300, h: 620, y: 1250 });
		await settled(['blaube'], 4000);
		await scene('title', async () => {
			await sleep(300);
			await toss('blaube', title, 0.5, 600);
			await sleep(900);
			const a = helper('blaube'), b = helper('blaube', 'Plan');
			await sleep(1500);
			await arrive('api');
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
		const w1 = await card({ title: 'api — server.js', text: 'api', size: 90, x: 60, y: 1350, w: 620, h: 260 });
		const w2 = await card({ title: 'website — npm test', text: 'website', size: 90, x: 760, y: 1000, w: 620, h: 260 });
		const w3 = await card({ title: 'docs — README.md', text: 'docs', size: 90, x: 760, y: 1800, w: 620, h: 260 });
		await onCard('api', w1, 0.35); await onCard('website', w2); await onCard('docs', w3, 0.6); await onFloor('blaube', 0.2);
		await settled(ALL, 6000);
		await sleep(500);
		await scene('watches', async () => {
			ev('api', 'UserPromptSubmit', { prompt: 'fix the login' });
			inbox.todos.set('api', [{ content: 'Read the code', status: 'completed' }, { content: 'Fix the login', status: 'in_progress' }, { content: 'Run the tests', status: 'pending' }]);
			ev('api', 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\code\\api\\server.js' } });
			ev('website', 'UserPromptSubmit', { prompt: 'run the tests' });
			ev('website', 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
			ev('docs', 'UserPromptSubmit', { prompt: 'write the docs' });
			const h1 = helper('docs'), h2 = helper('docs', 'general-purpose');
			ev('blaube', 'UserPromptSubmit', { prompt: 'make them sing' });
			await sleep(1800);
			ev('website', 'Notification', { message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' });
			inbox.todos.set('api', [{ content: 'Read the code', status: 'completed' }, { content: 'Fix the login', status: 'completed' }, { content: 'Run the tests', status: 'in_progress' }]);
			ev('api', 'PostToolUse', { tool_name: 'Edit' });
			await sleep(1200);
			ev('blaube', 'Stop', { last_assistant_message: 'Done! Five parts, the biggest blob takes the bass.' });
			helperDone('docs', h1);
			await sleep(1500);
			helperDone('docs', h2);
			await sleep(1200);
		});
		close(cap1, w1, w2, w3);
		inbox.todos.delete('api');
		for (const id of ALL) ev(id, 'Stop');
		idle(...ALL);
		await sleep(1500);

		// 3b. Talk to it: its box opens, and another one hops up onto it.
		const cap2 = await caption('talk to it');
		await onFloor('blaube', 0.25); await onFloor('api', 0.75); await onFloor('website', 0.55); await onFloor('docs', 0.9);
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
			await sleep(1500);
			const box = await js(`__blaube.ledges().find((l) => l.talk)`), boxTop = box.y; // (the flat of the bubble's top)
			const k = await js(`${B('api')}.body.centroid()`);
			await carry('api', [[k.x, boxTop - P(380)], [box.x0 + (box.x1 - box.x0) * 0.65, boxTop - P(230)]], 700);
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
		await js(`(() => { const j = __blaube.jar(); j.x = ${SW * 0.3}; j.y = ${top(cap3) - P(200)}; j.vx = 0; j.vy = 0; j.placed = true; })()`);
		await onCard('api', cap3, 0.62);
		await onFloor('docs', 0.15); await onFloor('blaube', 0.5); await onFloor('website', 0.85);
		await settled(ALL, 4000);
		await scene('cookies', async () => {
			await sleep(400);
			global.__blaubeSetLimits(usage(0.45));
			await sleep(3200);
		});
		close(cap3);
		ipcMain.emit('config-set', {}, { snackJar: 'Off' });
		idle(...ALL);

		// 3d. They play, they yearn, they chase, they fly.
		const cap4 = await stage('they play');
		const pair = async (c, a, b2, at = 0.38, gap = 1.3) => { const ra = await r(a), rb = await r(b2); await onCard(a, c, at); await onCard(b2, c, at + (ra + rb) * gap / c.getBounds().width); };
		await pair(cap4, 'blaube', 'api'); await onFloor('website', 0.12); await onFloor('docs', 0.88);
		await settled(ALL, 4000);
		await scene('play', async () => { await js(`__blaube.play.tower(${B('blaube')}, ${B('api')})`); await sleep(3600); });
		close(cap4);
		idle(...ALL);

		// (Not docs: at max effort her little ones float and meditate.)
		// Just a mother up on a window higher than they can jump, and her
		// little ones on the floor below jumping for her again and again. (A helper's legs reach about 700 px up, so she's well above that.)
		// (the caption is her window: nothing higher for her to hop up onto)
		const high = await card({ title: 'readme.txt', text: 'they yearn', size: 110, w: 720, h: 260, x: 360, y: 760 });
		ev('website', 'UserPromptSubmit', { prompt: 'run the tests' }); // (busy up there, so she stays put)
		for (const id of ALL) if (id !== 'website') setBlobHidden(id, true); // (the others off the stage for the shot)
		await onCard('website', high, 0.5);
		const kids = [helper('website'), helper('website', 'general-purpose'), helper('website', 'Plan')];
		await until(async () => (await Promise.all(kids.map((k) => has(`website/${k}`)))).every(Boolean), 6000);
		await sleep(1500);
		for (const [i, k] of kids.entries()) await onFloor(`website/${k}`, 0.25 + i * 0.25);
		await settled(['website', ...kids.map((k) => `website/${k}`)], 4000);
		await until(() => js(`[...__blaube.buddies.keys()].every((k) => k.startsWith('website'))`), 6000); // (the others gone for the shot)
		console.log('[film]   yearn: on screen', await js(`[...__blaube.buddies.keys()].join(' ')`), 'mum ledge', await js(`(${B('website')}.body.onLedge || {}).y`), 'floor', floor);
		await scene('yearn', async () => {
			for (let i = 0; i < 7; i++) { // (they jump for her, and fall short)
				await sleep(1000);
				if (process.env.FILM_DEBUG) console.log('[film]   kid:', await js(`(() => { const k = ${B(`website/${kids[0]}`)}, m = ${B('website')}, t = __blaube.now(); return JSON.stringify({ y: Math.round(k.body.centroid().y), floor: k.body.onFloor(), next: +(k.nextHop - t).toFixed(1), trying: !!k.trying, gave: !!k.gaveUp, merging: !!k.merging, move: !!k.move, grab: !!k.body.grab, state: k.state, mumLedge: !!m.body.onLedge, rise: Math.round(k.body.bbox().maxY - m.body.bbox().maxY) }); })()`));
			}
		});
		for (const k of kids) helperDone('website', k);
		ev('website', 'Stop');
		close(high);
		await sleep(3000); // (they get home once the window's gone)
		for (const id of ALL) setBlobHidden(id, false);
		await until(async () => (await Promise.all(ALL.map(has))).every(Boolean), 6000);
		idle(...ALL);

		const cap6 = await stage('they chase');
		await pair(cap6, 'website', 'docs', 0.3, 1.6); await onFloor('blaube', 0.12); await onFloor('api', 0.88);
		await settled(ALL, 4000);
		await scene('chase', async () => { await js(`__blaube.play.tag(${B('website')}, ${B('docs')})`); await sleep(4200); });
		close(cap6);
		idle(...ALL);

		const cap7 = await stage('they fly');
		await onCard('blaube', cap7, 0.5); await onFloor('api', 0.12); await onFloor('website', 0.5); await onFloor('docs', 0.88);
		await settled(ALL, 4000);
		await scene('fly', async () => { await js(`__blaube.play.balloon(${B('blaube')})`); await sleep(7500); });
		close(cap7);
		idle(...ALL);

		// 3e. They sing.
		const cap8 = await stage('they sing');
		for (const [i, id] of ALL.entries()) await onCard(id, cap8, 0.14 + i * 0.24);
		await settled(ALL, 5000);
		await scene('sings', async () => {
			win.webContents.send('command', `choir:${SONG}`);
			await sleep(6000);
			win.webContents.send('command', 'choir-stop');
		});
		close(cap8);
		idle(...ALL);

		// 3f. They get dizzy (and then some).
		const cap9 = await caption('they get dizzy');
		for (const [i, id] of ALL.entries()) await onFloor(id, 0.14 + i * 0.24);
		await settled(ALL, 4000);
		await scene('dizzy', async () => {
			const c = await js(`${B('website')}.body.centroid()`), hx = SW / 2, hy = P(1200);
			await carry('website', [[c.x, c.y - P(400)], [hx, hy]], 600);
			await js(`(async () => {
				const b = ${B('website')}, raf = () => new Promise((r) => requestAnimationFrame(r));
				const c = b.body.centroid(); b.body.startGrab(c.x, c.y);
				const t0 = performance.now();
				while (performance.now() - t0 < 6000 && !b.barf) { const t = (performance.now() - t0) / 1000; b.body.moveGrab(${hx} + Math.sin(t * 2 * Math.PI * 3.4) * ${P(180)}, ${hy} + Math.cos(t * 2 * Math.PI * 1.7) * ${P(40)}); await raf(); }
				for (let i = 0; i < 20; i++) { b.body.moveGrab(${hx}, ${hy}); await raf(); }
			})()`);
			console.log('[film]   barfed:', await js(`!!${B('website')}.barf`));
			await sleep(2200);
			await js(`${B('website')}.body.endGrab()`);
			await sleep(1500);
		});
		close(cap9);
		idle(...ALL);

		// 4. And they are soft: a lift up, a shake, a flick, and onto the shelf.
		const soft = await card({ title: 'thicc.txt', text: 'and they are thicc.', size: 150, w: 1000, h: 340, x: 60, y: 1900 });
		const shelf = await card({ title: 'shelf.txt', text: 'a shelf', size: 80, w: 560, h: 200, x: 840, y: 700 });
		await onCard('blaube', soft, 0.25); await onCard('api', soft, 0.5); await onCard('docs', soft, 0.75); await onFloor('website', 0.9);
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
		const end = await card({ title: 'ceci est un blaube.txt', text: 'Ceci est un blaube.', size: 140, sub: 'github.com/syverlauritz/blaube', w: 1340, h: 460, y: 820 });
		const mac = await card({ title: 'mac.txt', text: 'for Mac', size: 100, w: 560, h: 220, x: 60, y: 1900 });
		const pc = await card({ title: 'windows.txt', text: 'and Windows', size: 100, w: 600, h: 220, x: 780, y: 1750 });
		await onCard('blaube', end, 0.5);
		await onCard('api', mac, 0.5); await onCard('docs', pc, 0.4); await onFloor('website', 0.5);
		await settled(ALL, 6000);
		await scene('end', async () => {
			await sleep(800);
			helper('blaube');
			await sleep(3200);
		});
		close(end, mac, pc);
		}
	} finally {
		clearInterval(ledgeTimer);
		closeAll();
		const sound = await js(`(async () => {
			const f = window.__film;
			if (!f || !f.rec) return null;
			await new Promise((r) => { f.rec.onstop = r; f.rec.stop(); });
			const buf = new Uint8Array(await new Blob(f.chunks, { type: 'audio/webm' }).arrayBuffer());
			let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
			return { at: f.at, data: btoa(s) };
		})()`).catch(() => null);
		if (sound) { fs.writeFileSync(path.join(OUT, 'sound.webm'), Buffer.from(sound.data, 'base64')); sync.sound = sound.at; }
		fs.writeFileSync(path.join(HERE, 'marks.json'), JSON.stringify({ t0, ...sync, scenes: marks }, null, '\t'));
		if (rec) { rec.stdin.write('q'); await new Promise((r) => rec.on('exit', r)); }
	}
	return 0;
};
