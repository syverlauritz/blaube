// The 9:16 trailer ("Ceci n'est pas un blob."), played live on the portrait
// screen and recorded with ffmpeg:
//
//   BLAUBE_FILM=scripts/film/trailer.js BLAUBE_PORT=47890 npx electron .
//
//   FILM_ONLY=pipe,lift   just those shots
//   FILM_NO_REC=1         play it without recording
//   FILM_SKY=<file>       another sky (next to this file)
//   FILM_SONG=<id>        another song for the choir (src/shared/songs.js)
//   BLAUBE_TEST instead of BLAUBE_FILM plays it unseen (a dry run).
//
// Everything is the real app. The blobs only ever move by their physics:
// fake sessions and helpers, the games on cue (as Show off starts them), and
// a "hand" that grabs and lets go as the mouse would. The cards are real
// windows, so the blobs land on them, ride them, and are left in the air
// when one is yanked away. The sky is a window too, behind it all: no
// wallpaper or desktop setting is touched.
//
// Each shot is set up off camera, then played; marks.json says when each one
// played, and cut.js keeps only those bits. It runs on the defaults in
// src/shared/config.js. For blobs big enough on a phone, the portrait
// screen's scale is 200% in Windows' display settings (everything grows
// together, physics and all). The layout is in points on a 720-wide screen.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BrowserWindow, screen, ipcMain } = require('electron');
const { DEFAULTS, PALETTE } = require('../../src/shared/config');

const HERE = __dirname;
const OUT = path.join(HERE, 'out');
const FILM = !!process.env.BLAUBE_FILM;
const ONLY = (process.env.FILM_ONLY || '').split(',').filter(Boolean);
const SONG = process.env.FILM_SONG || 'film-waltz';
// The choir sings along with the film's music: a few bars written to its
// key, chords and beat (bars 22 to 26 of "Waltzing in Paris": D flat, A flat
// seventh, back and forth; cut.js lays it on those bars).
const WALTZ = { id: 'film-waltz', title: 'The film\x27s waltz', bpm: 60 / (1.0738 / 3),
	notes: 'F4:2:oh F4:1:la G#4:2:la A#4:1:la F4:1:oh G#4:1:la C#5:1:la A#4:2:la C5:1:la C#5:3:la F4:2:oh F4:1:la G#4:2:la A#4:1:la C#5:3:la',
	chords: 'C#:3 G#7:3 C#:3 G#7:3 C#:3 C#:3 G#7:3 C#:3' };
const BAR = 1073.8; // ms: a bar of the waltz the film is cut to
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (name) => PALETTE.find(([n]) => n === name)[1];

// The cast: every colour, model face and a look each.
const CAST = {
	blaube: { model: 'claude-opus-4-5', effort: 'medium', look: 'beret', color: 'Orange', tokens: 500000 },
	api: { model: 'claude-sonnet-4-5', effort: 'medium', look: 'bunny', color: 'Blue', tokens: 150000 },
	web: { model: 'claude-haiku-4-5', effort: 'high', look: 'sprout', color: 'Green', tokens: 60000 },
	docs: { model: 'claude-fable-5', effort: 'medium', look: 'catears', color: 'Purple', tokens: 150000 },
	shop: { model: 'claude-opus-4-5', effort: 'medium', look: 'bow', color: 'Pink', tokens: 60000 },
	game: { model: 'claude-sonnet-4-5', effort: 'medium', look: 'horns', color: 'Yellow', tokens: 100000 },
};
const ALL = Object.keys(CAST);

// What the props say: Frenglish, all in good humour. (Only the first card is a "Ceci n’est pas".)
const SAY = { lift: 'le lift', flick: 'la catapulte (oops)', shelf: 'le shelf', yank: 'le tablecloth trick', floor2: 'le plan B', tower: 'un petit tower', frog: 'le leapfrog', rain: ['il pleut', 'des', 'blobs'], balloon: 'le balloon', choir: 'la chorale, very pro', family: 'la petite family', dizzy: 'une very bad idée' };

module.exports = async function run({ win, tracker, moveToDisplay, otherWindows, demoTokens, demoEfforts, pickedModel, pushState, setBlobHidden, setColor }) {
	win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('[film] renderer:', e.message); });
	const js = (s) => win.webContents.executeJavaScript(s).catch((err) => { console.log('[film] failed:', s.slice(0, 160)); throw err; });
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	const portrait = screen.getAllDisplays().find((d) => d.bounds.height > d.bounds.width) || screen.getPrimaryDisplay();
	const area = portrait.workArea, X0 = area.x, Y0 = area.y, SW = area.width;
	const U = SW / 720, P = (n) => Math.round(n * U); // (the layout's points to the screen's)
	console.log(`[film] portrait screen ${portrait.bounds.width}x${portrait.bounds.height} at scale ${portrait.scaleFactor}, work area ${JSON.stringify(area)}`);
	moveToDisplay(portrait.id);
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false);
	// (main's defaults, whatever this machine had saved; no jar: its numbers would be made up; no leaves or other weather)
	ipcMain.emit('config-set', {}, Object.assign({}, DEFAULTS, { snackJar: 'Off', weather: 'Off' }));
	// The cursor is the film's own, parked out of the way: blobs look where they're told.
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
	await js(`BlaubeSongs.SONGS.push(${JSON.stringify(WALTZ)})`);
	// They say what they have to say: the little exclamations (a game's "tower!",
	// a "bleh!") are rationed to one every few minutes; here each one is heard.
	const chatty = setInterval(() => js('__blaube.spoken.flavour = -1e9; __blaube.spoken.react = -1e9').catch(() => {}), 250);
	await sleep(1000);
	const wb = () => win.getBounds();
	const floor = await js('innerHeight');

	// --- The sky: a window behind everything the film puts up -----------------
	let sky = null;
	if (FILM) {
		sky = new BrowserWindow({ x: area.x, y: area.y, width: area.width, height: area.height, frame: false, show: false, focusable: false, skipTaskbar: true, resizable: false, hasShadow: false, backgroundColor: '#a9cbe6' });
		await sky.loadFile(path.join(HERE, 'sky.html'), { query: { sky: process.env.FILM_SKY || 'sky.jpg' } });
		sky.showInactive();
		sky.setBounds(area);
	}

	// --- The cards: real windows, and their tops are ledges -------------------
	const cards = [];
	const pushLedges = () => otherWindows(cards.filter((c) => !c.isDestroyed() && c.isVisible()).reverse()
		.map((c) => Object.assign({ id: `card${c.id}` }, c.getBounds())));
	const ledgeTimer = setInterval(pushLedges, 16);
	// (x, y, w, h and size in the layout's points; x left out: centred)
	async function card({ title = 'blaube', text, size = 56, sub = '', x, y, w, h }) {
		const c = new BrowserWindow({ x: X0 + (x === undefined ? Math.round((SW - P(w)) / 2) : P(x)), y: Y0 + P(y), width: P(w), height: P(h), show: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, title, backgroundColor: '#eadfc6', icon: path.join(HERE, '..', '..', 'build', 'icon.png') });
		c.removeMenu();
		c.on('page-title-updated', (e) => e.preventDefault());
		await c.loadFile(path.join(HERE, 'card.html'), { query: { text, size: String(size * U), sub, subSize: String(17 * U) } });
		if (!FILM) c.setOpacity(0); // (a dry run: unseen)
		c.showInactive();
		cards.push(c);
		return c;
	}
	const close = (...cs) => { for (const c of cs) if (c && !c.isDestroyed()) c.destroy(); };
	const closeAll = () => { close(...cards); cards.length = 0; };
	const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
	const line = (t) => t;
	const out = (t) => 1 - Math.pow(1 - t, 3);
	const top = (c) => c.getBounds().y - wb().y; // (its ledge, in the blobs' own y)
	// Moves a card by (dx, dy) points.
	async function slide(c, dx, dy, ms, curve = ease) {
		const b = c.getBounds(), t0 = Date.now();
		for (;;) {
			const t = Math.min(1, (Date.now() - t0) / ms), k = curve(t);
			if (c.isDestroyed()) return;
			c.setBounds({ x: Math.round(b.x + P(dx) * k), y: Math.round(b.y + P(dy) * k), width: b.width, height: b.height });
			if (t >= 1) return;
			await sleep(6);
		}
	}
	// Yanked away to the left, off the screen, and gone.
	const yank = async (c) => { await slide(c, -(c.getBounds().x - X0 + c.getBounds().width + 40) / U, 0, 110, line); close(c); };

	// --- The blobs --------------------------------------------------------------
	const cwd = (id) => path.join('C:\\code', id);
	const ev = (id, hook_event_name, extra = {}) => tracker.handle({ session_id: id, cwd: cwd(id), hook_event_name, ...extra });
	const idle = (...ids) => { for (const id of ids) { const s = tracker.sessions.get(id); if (s) { s.state = 'idle'; s.seen = true; } } pushState(); };
	const B = (id) => `__blaube.buddies.get(${JSON.stringify(id)})`;
	const has = (id) => js(`!!${B(id)}`);
	const settled = (ids, ms = 5000) => until(() => js(`[${ids.map(B).join(',')}].every((b) => b && !b.body.grab && Math.hypot(b.body.velocity(1 / 120).x, b.body.velocity(1 / 120).y) < 30)`), ms);
	async function arrive(id) {
		const c = CAST[id];
		setColor(cwd(id), hex(c.color));
		demoEfforts.set(id, c.effort);
		pickedModel.set(id, c.model);
		demoTokens.set(id, { total: c.tokens, context: 30000, limit: 200000 });
		ev(id, 'SessionStart');
		await until(() => has(id), 8000);
		await js(`(() => { const b = ${B(id)}; b.chosenLook = ${JSON.stringify(c.look)}; b.chosenLookFor = b.key; })()`);
	}
	// Who is in the shot: the rest are put away (as Hide does), and come back after.
	async function stage(ids) {
		for (const id of ALL) setBlobHidden(id, !ids.includes(id));
		await until(() => js(`(() => { const on = [...__blaube.buddies.values()].map((b) => b.key).sort().join(); return on === ${JSON.stringify(ids.slice().sort().join())}; })()`), 9000);
		for (const id of ids) await js(`(() => { const b = ${B(id)}; if (b) { b.chosenLook = ${JSON.stringify(CAST[id].look)}; b.chosenLookFor = b.key; } })()`);
		await sleep(1200);
		idle(...ids);
	}
	// Off camera: put a blob somewhere, still.
	const place = (id, x, y) => js(`(() => { const b = ${B(id)}; b.body.teleport(${x}, ${y}); const v = b.body.velocity(1 / 120); b.body.impulse(-v.x, -v.y, 1 / 120); })()`);
	const r = (id) => js(`${B(id)}.body.o.radius`);
	const at = (id) => js(`${B(id)}.body.centroid()`);
	// Sitting on a card: dropped just above it.
	const onCard = async (id, c, fx = 0.5) => { const b = c.getBounds(); await place(id, b.x - wb().x + b.width * fx, top(c) - (await r(id)) * 1.3); };
	const onFloor = async (id, fx) => place(id, SW * fx, floor - (await r(id)) * 1.2);
	// Like a hand: grab it, carry it along a path (the blobs' own points), let go (it flies on with the speed it had).
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
	// Where the blobs look (the film's own cursor).
	const look = (x, y) => js(`__blaube.input.move({ clientX: ${P(x)}, clientY: ${P(y)} })`);
	const lookAway = () => js(`__blaube.input.move({ clientX: ${SW / 2}, clientY: -600 })`);
	let helpers = 0;
	const helper = (id, type = 'Explore') => { const a = `h${++helpers}`; ev(id, 'SubagentStart', { agent_id: a, agent_type: type }); return a; };
	const helperDone = (id, a) => ev(id, 'SubagentStop', { agent_id: a });
	// A word in its bubble, said out loud in its own voice.
	const say = (id, text, seconds = 1.4) => js(`${B(id)}.say([{ text: ${JSON.stringify(text)} }], ${seconds}, false, { minor: true })`);
	const where = () => js(`[...__blaube.buddies.entries()].map(([k, b]) => k + '@' + Math.round(b.body.centroid().x) + ',' + Math.round(b.body.centroid().y) + (b.body.onLedge ? '^' : '')).join(' ')`);

	// --- Recording ----------------------------------------------------------
	fs.mkdirSync(OUT, { recursive: true });
	const marks = [];
	let rec = null, t0 = Date.now();
	const sync = {};
	if (FILM && !process.env.FILM_NO_REC) {
		rec = spawn('C:\\ffmpeg\\bin\\ffmpeg.exe', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'lavfi', '-i', `ddagrab=output_idx=${process.env.FILM_OUTPUT || 1}:framerate=60:draw_mouse=0,hwdownload,format=bgra${process.env.FILM_TRANSPOSE === '0' ? '' : `,transpose=${process.env.FILM_TRANSPOSE || 1}`}`,
			'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', path.join(OUT, 'raw.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
		t0 = Date.now();
		await sleep(1500);
		// A magenta square in the corner for a moment: cut.js finds it in the
		// video, which ties the video's clock to this one (and so to the sound's).
		const flash = new BrowserWindow({ x: X0, y: Y0, width: P(40), height: P(40), frame: false, show: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, backgroundColor: '#ff00ff' });
		flash.showInactive();
		sync.flash = Date.now();
		await sleep(400);
		flash.destroy();
	}
	const SHOTS = [];
	// The moment in a shot that the cut is timed to (cut.js puts it on the beat).
	let cues = {};
	const cue = (name = 'cue') => { cues[name] = (Date.now() - t0) / 1000; };
	// A shot: who's in it, setting it up (off camera), and playing it (on camera).
	const shot = (name, cast, setup, play) => SHOTS.push({ name, cast, setup, play });

	// 1. The painting. It sits on "Ceci n’est pas un blob."; then the card is
	// yanked from under it, and it’s left in the air.
	shot('pipe', ['blaube'], async () => {
		const c = await card({ title: 'la trahison des images', text: 'Ceci n’est pas un blob.', size: 62, w: 664, h: 210, y: 470 });
		await onCard('blaube', c, 0.5);
		return { c };
	}, async ({ c }) => {
		await look(560, 200);
		await sleep(1700);
		await look(120, 330);
		await sleep(1300);
		await look(360, 620); // (it reads its own caption)
		await sleep(1100);
		await lookAway();
		await sleep(500);
		cue();
		yank(c); // (and it’s left in the air)
		await sleep(180);
		say('blaube', 'oh la la!', 1.3);
		await sleep(2600);
	});

	// 2. A lift: up they go, and it stops.
	shot('lift', ['api', 'web', 'docs'], async () => {
		const c = await card({ title: 'lift', text: SAY.lift, size: 64, w: 660, h: 150, y: 1010 });
		await onCard('api', c, 0.2); await onCard('web', c, 0.5); await onCard('docs', c, 0.8);
		return { c };
	}, async ({ c }) => {
		await sleep(500);
		cue();
		await slide(c, 0, -620, 800, line);
		await sleep(2000);
	});

	// 3. A catapult: flicked, and (some of) them land on the shelf.
	shot('flick', ['blaube', 'shop', 'game'], async () => {
		const c = await card({ title: 'catapulte', text: SAY.flick, size: 56, w: 600, h: 150, x: 30, y: 960 });
		const shelf = await card({ title: 'shelf', text: SAY.shelf, size: 60, w: 660, h: 140, y: 400 });
		await onCard('blaube', c, 0.2); await onCard('shop', c, 0.5); await onCard('game', c, 0.8);
		return { c, shelf };
	}, async ({ c }) => {
		await sleep(600);
		cue();
		await slide(c, 0, -250, 130, line); // (flicked: up through the shelf, and down onto it)
		await sleep(150);
		await slide(c, 0, 250, 500, ease);
		await sleep(2200);
	});

	// 4. A tablecloth: yanked from under a row of them, and then the net too.
	shot('yank', ['api', 'docs', 'web'], async () => {
		const c = await card({ title: 'tablecloth', text: SAY.yank, size: 64, w: 660, h: 150, y: 380 });
		const net = await card({ title: 'plan B', text: SAY.floor2, size: 60, w: 660, h: 140, y: 800 });
		await onCard('api', c, 0.2); await onCard('docs', c, 0.5); await onCard('web', c, 0.8);
		return { c, net };
	}, async ({ c, net }) => {
		await sleep(700);
		cue();
		await yank(c);
		await sleep(BAR - 110); // (the net goes a bar later)
		await yank(net);
		await sleep(1700);
	});

	// 5. A tower: one climbs onto the other.
	shot('tower', ['blaube', 'game'], async () => {
		const c = await card({ title: 'tower', text: SAY.tower, size: 64, w: 680, h: 150, y: 900 });
		await onCard('blaube', c, 0.36); await onCard('game', c, 0.66);
		return { c };
	}, async () => {
		await js(`__blaube.play.tower(${B('blaube')}, ${B('game')})`);
		await sleep(4200);
	});

	// 6. Leapfrog, along a card.
	shot('frog', ['shop', 'docs'], async () => {
		const c = await card({ title: 'grenouille', text: SAY.frog, size: 44, w: 700, h: 150, y: 900 });
		await onCard('shop', c, 0.2); await onCard('docs', c, 0.45);
		return { c };
	}, async () => {
		await js(`__blaube.play.frog(${B('shop')}, ${B('docs')})`);
		await sleep(4500);
	});

	// 7. It rains blobs: all of them from the top, down a staircase of words.
	shot('rain', ALL, async () => {
		const a = await card({ title: 'il pleut', text: SAY.rain[0], size: 60, w: 250, h: 130, x: 40, y: 420 });
		const b = await card({ title: 'des', text: SAY.rain[1], size: 60, w: 270, h: 130, x: 410, y: 640 });
		const c = await card({ title: 'blobs', text: SAY.rain[2], size: 60, w: 270, h: 130, x: 90, y: 880 });
		for (const [i, id] of ALL.entries()) await place(id, SW * (0.12 + 0.152 * i), -P(140) - P(260) * ((i * 5) % 6));
		return { a, b, c };
	}, async () => {
		await sleep(4200);
	}, { live: true });

	// 8. A balloon: it blows itself up and floats off.
	shot('balloon', ['web', 'api'], async () => {
		const c = await card({ title: 'balloon', text: SAY.balloon, size: 64, w: 620, h: 150, y: 980 });
		await onCard('web', c, 0.3); await onCard('api', c, 0.75);
		return { c };
	}, async () => {
		await js(`__blaube.play.balloon(${B('web')})`);
		await sleep(8000);
	});

	// 9. The choir: all of them, three up on the card.
	shot('choir', ALL, async () => {
		const c = await card({ title: 'chorale', text: SAY.choir, size: 56, w: 680, h: 150, y: 640 });
		await onCard('api', c, 0.18); await onCard('blaube', c, 0.5); await onCard('docs', c, 0.82);
		await onFloor('web', 0.17); await onFloor('shop', 0.5); await onFloor('game', 0.83);
		return { c };
	}, async () => {
		cue('sing');
		win.webContents.send('command', `choir:${SONG}`);
		await sleep(800 + 6.5 * BAR);
		win.webContents.send('command', 'choir-stop');
		await sleep(500);
	});

	// 10. A family: her little ones split off, and come home.
	shot('family', ['docs'], async () => {
		const c = await card({ title: 'family', text: SAY.family, size: 64, w: 660, h: 150, y: 820 });
		await onCard('docs', c, 0.5);
		return { c };
	}, async () => {
		await sleep(600);
		cue();
		const kids = [helper('docs'), helper('docs', 'general-purpose'), helper('docs', 'Plan')];
		await sleep(3200);
		cue('home');
		for (const k of kids) { helperDone('docs', k); await sleep(350); }
		await sleep(3000);
	});

	// 11. A bad idea: shaken till it's green (and then some).
	shot('dizzy', ['game', 'shop'], async () => {
		const c = await card({ title: 'bad idée', text: SAY.dizzy, size: 58, w: 660, h: 150, y: 960 });
		await onCard('game', c, 0.3); await onCard('shop', c, 0.72);
		return { c };
	}, async () => {
		const p = await at('game'), hx = SW * 0.42, hy = P(520);
		await carry('game', [[p.x, p.y - P(200)], [hx, hy]], 500);
		await js(`(async () => {
			const b = ${B('game')}, raf = () => new Promise((r) => requestAnimationFrame(r));
			const c = b.body.centroid(); b.body.startGrab(c.x, c.y);
			const t0 = performance.now();
			while (performance.now() - t0 < 7000 && !b.barf) { const t = (performance.now() - t0) / 1000; b.body.moveGrab(${hx} + Math.sin(t * 2 * Math.PI * 3.4) * ${P(95)}, ${hy} + Math.cos(t * 2 * Math.PI * 1.7) * ${P(22)}); await raf(); }
			for (let i = 0; i < 20; i++) { b.body.moveGrab(${hx}, ${hy}); await raf(); }
		})()`);
		cue('barf');
		console.log('[film]   barfed:', await js(`!!${B('game')}.barf`));
		await sleep(1800);
		await js(`${B('game')}.body.endGrab()`);
		await sleep(2200);
	});

	// 12. The end.
	shot('end', ALL, async () => {
		const c = await card({ title: 'blaube', text: 'Ceci est un blaube.', size: 66, w: 680, h: 230, y: 330 });
		const mac = await card({ title: 'macOS', text: 'for Mac', size: 48, w: 300, h: 150, x: 30, y: 800 });
		const pc = await card({ title: 'Windows', text: 'and Windows', size: 48, w: 340, h: 150, x: 360, y: 700 });
		await onCard('blaube', c, 0.5);
		await onCard('api', mac, 0.5); await onCard('docs', pc, 0.5);
		await onFloor('web', 0.17); await onFloor('shop', 0.5); await onFloor('game', 0.83);
		return { c, mac, pc };
	}, async () => {
		await look(360, 420);
		await sleep(900);
		say('blaube', 'voilà!', 1.5);
		await sleep(700);
		const a = helper('blaube');
		await sleep(3200);
		helperDone('blaube', a);
		await sleep(3000);
	});

	try {
		for (const id of ALL) await arrive(id);
		await sleep(2500);
		idle(...ALL);
		for (const s of SHOTS) {
			if (ONLY.length && !ONLY.includes(s.name)) continue;
			await lookAway();
			await stage(s.cast);
			const props = await s.setup();
			// (rain starts in the air: no waiting for them to come to rest)
			if (s.name !== 'rain') { await settled(s.cast, 6000); await sleep(700); }
			idle(...s.cast);
			cues = {};
			const start = (Date.now() - t0) / 1000;
			console.log(`[film] ${s.name} at ${start.toFixed(2)}s`);
			await s.play(props);
			marks.push({ name: s.name, start, end: (Date.now() - t0) / 1000, cues });
			console.log('[film]   blobs:', await where());
			closeAll();
			await sleep(600);
		}
	} finally {
		clearInterval(ledgeTimer);
		clearInterval(chatty);
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
		if (sky && !sky.isDestroyed()) sky.destroy();
	}
	return 0;
};
