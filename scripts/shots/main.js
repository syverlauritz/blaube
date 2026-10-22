// Takes pictures of Blaube in set scenes, without Claude Code: thinking,
// running a tool, done, needing you, sweating, helpers, pets, hovering...
// Each scene plays for a moment in a hidden window and is saved as a PNG,
// so a change to the look can be checked without clicking around.
//
//   npm run shots                 all scenes, into ./shots
//   npm run shots -- done pain    just these scenes
//
// A scene with `motion` drags a slime around and saves a strip of frames
// (<scene>.png) instead of one picture, and prints checks on how its look
// moves: a look that slams into its swing limit or jumps between frames is
// what you'd see as clipping or jitter.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'shots');
const W = 900, H = 560;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const session = (id, project, state, extra = {}) => Object.assign({ id, project, state, activity: 'thinking', agents: [], tasks: [] }, extra);
const full = (fill) => ({ total: 400000, context: fill * 200000, limit: 200000 });

// Each scene: sessions to show, and optionally what to do before the picture.
const SCENES = {
	idle: { sessions: [session('a', 'blaube', 'idle')] },
	thinking: { sessions: [session('a', 'blaube', 'working')] },
	tool: { sessions: [session('a', 'blaube', 'working', { activity: 'tool' })] },
	done: { sessions: [session('a', 'blaube', 'done')] },
	waiting: { sessions: [session('a', 'blaube', 'waiting', { message: 'Claude needs your permission to use Bash' })] },
	sweat: { sessions: [session('a', 'blaube', 'working', { tokens: full(0.75) })], wait: 4000 },
	pain: { sessions: [session('a', 'blaube', 'working', { tokens: full(0.97) })], wait: 4000 },
	helpers: {
		sessions: [session('a', 'playground', 'done', {
			agents: [
				{ id: 'h1', type: 'general-purpose', description: 'Ring Globe: Manta logo mode', state: 'working', activity: 'thinking' },
				{ id: 'h2', type: 'Explore', description: 'Find the hook server', state: 'working', activity: 'tool' },
			],
		})],
		wait: 4000,
	},
	pets: {
		sessions: [session('a', 'playground', 'idle', {
			tasks: [{ id: 't1', command: 'npm run dev' }, { id: 't2', command: 'npm test -- --watch' }, { id: 't3', command: 'npm run toy -- strands' }],
		})],
		wait: 6000,
	},
	looks: {
		sessions: ['curl', 'bow', 'antenna', 'horns', 'catears']
			.map((look, i) => session('looks' + i, look, i % 2 ? 'working' : 'idle', { look })),
		config: { size: 0.8 },
		wait: 6000,
		size: [1400, 560],
	},
	looks2: {
		sessions: ['bunny', 'sprout']
			.map((look, i) => session('looks2' + i, look, i % 2 ? 'working' : 'idle', { look })),
		config: { size: 0.8 },
		wait: 6000,
		size: [1400, 560],
	},
	effort: {
		sessions: ['low', 'medium', 'high', 'max']
			.map((effort, i) => session('effort' + i, effort, 'idle', { effort })),
		config: { size: 0.8 },
		wait: 4000,
		size: [1400, 560],
	},
	effortWorking: {
		sessions: ['low', 'medium', 'high', 'max']
			.map((effort, i) => session('effortw' + i, effort, 'working', { effort })),
		config: { size: 0.8 },
		wait: 4000,
		size: [1400, 560],
	},
	// A landing knocks the high effort glasses off (made touchy here).
	glasses: {
		sessions: [session('a', 'blaube', 'idle', { effort: 'high' })],
		config: { glassesSpeed: 300 },
		wait: 1500,
		command: 'hop',
		thenWait: 900,
	},
	// ...and a few seconds later it has hopped over to put them back on.
	glassesBack: {
		sessions: [session('a', 'blaube', 'idle', { effort: 'high' })],
		config: { glassesSpeed: 300 },
		wait: 1500,
		command: 'hop',
		thenWait: 3000,
	},
	// Rubbing the cursor back and forth over an idle Blaube: it's petted.
	petting: {
		sessions: [session('pt', 'blaube', 'idle', { look: 'catears' })],
		config: { size: 1 },
		wait: 3500,
		size: [900, 560],
		rub: 'pt',
	},
	// A second session arrives: the first turns to look at it.
	greet: {
		sessions: [session('g1', 'blaube', 'idle', { look: 'bow' })],
		config: { size: 0.85 },
		wait: 3500,
		size: [1100, 560],
		later: { sessions: [session('g1', 'blaube', 'idle', { look: 'bow' }), session('g2', 'kalkis', 'idle', { color: '#5B8DEF', look: 'antenna' })], wait: 700 },
	},
	// A long turn (7 minutes) finishes: a burst of hearts and a big bounce.
	longDone: {
		sessions: [session('ld', 'blaube', 'working', { look: 'bunny', turnStart: Date.now() - 420000 })],
		config: { size: 0.9 },
		wait: 3500,
		size: [900, 560],
		later: { sessions: [session('ld', 'blaube', 'done', { look: 'bunny', turnStart: Date.now() - 420000 })], wait: 500 },
	},
	// A background task ends: its pet hops, shows a heart, then shrinks away.
	petBye: {
		sessions: [session('pb', 'playground', 'idle', { tasks: [{ id: 't1', command: 'npm run dev' }, { id: 't2', command: 'npm test -- --watch' }] })],
		wait: 6000,
		later: { sessions: [session('pb', 'playground', 'idle', { tasks: [{ id: 't1', command: 'npm run dev' }] })], wait: 300 },
	},
	// Bunny ears and cat ears side by side, idle and looking up.
	ears: {
		sessions: ['bunny', 'catears', 'bunny', 'catears'].map((look, i) => session('ears' + i, look, 'idle', { look })),
		config: { size: 0.9 },
		wait: 3500,
		size: [1300, 560],
		mouse: [650, 30],
	},
	// Two sessions arrive: their slimes pop out of the middle of the screen,
	// small, already in their own colour and look, and grow as they fly out.
	spawn: {
		sessions: [session('sp1', 'blaube', 'working', { look: 'antenna' }), session('sp2', 'kalkis', 'idle', { color: '#5B8DEF', look: 'catears' })],
		config: { size: 0.85 },
		wait: 60,
		size: [1100, 560],
		motion: { frames: 16, every: 80, drop: 0, still: true, hopAt: [] },
	},
	// Helpers jostling: a gentle bump annoys the one that got bumped, and it
	// glares at whoever did it.
	jostle: {
		sessions: [session('jo', 'blaube', 'working', { agents: [1, 2, 3].map((i) => ({ id: 'j' + i, type: 'general-purpose', description: 'Helper ' + i, state: 'working', activity: 'thinking' })) })],
		config: { size: 0.85 },
		wait: 4000,
		size: [1100, 560],
		motion: { frames: 20, every: 120, drop: 0, still: true, hopAt: [1, 8, 14] },
	},
	// Drag one slime through two others: they should get shoved aside and
	// keep their shape, not get dented.
	shove: {
		sessions: [session('s1', 'blaube', 'idle'), session('s2', 'kalkis', 'idle', { color: '#5B8DEF' }), session('s3', 'playground', 'working', { color: '#8BC34A' })],
		config: { size: 0.85 },
		wait: 4000,
		size: [1100, 560],
		motion: { frames: 24, every: 70, drop: 6, shove: true },
	},
	// Wave the cursor above an idle slime: it watches, then jumps for it.
	pounce: {
		sessions: [session('po', 'blaube', 'idle')],
		config: { size: 0.85 },
		wait: 3000,
		size: [900, 560],
		motion: { frames: 24, every: 80, drop: 0, still: true, hopAt: [], tease: true },
	},
	// One slime dropped on another's head: the one below glares, then
	// shrugs it off. A helper on its mother's head gets to stay, happily.
	stack: {
		sessions: [session('st1', 'blaube', 'idle'), session('st2', 'kalkis', 'idle', { color: '#5B8DEF' })],
		config: { size: 0.85 },
		wait: 3000,
		size: [900, 560],
		motion: { frames: 24, every: 150, drop: 0, still: true, hopAt: [], stack: true },
	},
	// One yawns; the ones next to it catch it.
	yawns: {
		sessions: [session('y1', 'blaube', 'idle'), session('y2', 'kalkis', 'idle', { color: '#5B8DEF' }), session('y3', 'playground', 'idle', { color: '#8BC34A' })],
		config: { size: 0.8 },
		wait: 3000,
		size: [900, 560],
		motion: { frames: 20, every: 150, drop: 0, still: true, hopAt: [], commandAt: { 1: 'yawn' }, huddle: true },
	},
	// A window on the desktop: one slime dropped onto it lands softly and
	// stays; one thrown up from below passes through it; then the window
	// moves and the one on top rides along.
	ledge: {
		sessions: [session('le1', 'blaube', 'idle'), session('le2', 'kalkis', 'idle', { color: '#5B8DEF' })],
		config: { size: 0.85 },
		wait: 2500,
		size: [1000, 560],
		motion: { frames: 28, every: 100, drop: 0, still: true, hopAt: [], ledge: true },
	},
	// A mother put up on a window: her helper and her pet jump up after her.
	climb: {
		sessions: [session('cl', 'blaube', 'working', {
			agents: [{ id: 'h1', type: 'general-purpose', description: 'Fix the hover bubble', state: 'working', activity: 'thinking' }],
			tasks: [{ id: 't1', command: 'npm run dev' }],
		})],
		config: { size: 0.85 },
		wait: 4000,
		size: [1000, 560],
		motion: { frames: 32, every: 150, drop: 0, still: true, hopAt: [], climb: true },
	},
	// Flick a window up and stop: the slime on it flies on up. Then yank
	// the window sideways, fast: the slime is left in the air, surprised.
	flick: {
		sessions: [session('fl', 'blaube', 'idle')],
		config: { size: 0.85 },
		wait: 2500,
		size: [1000, 560],
		motion: { frames: 28, every: 100, drop: 0, still: true, hopAt: [], flick: true },
	},
	// A helper finishes and heads home: happy eyes and a heart on the way.
	helperHome: {
		sessions: [session('hh', 'blaube', 'working', {
			agents: [{ id: 'h1', type: 'general-purpose', description: 'Fix the hover bubble', state: 'working', activity: 'thinking' }],
		})],
		config: { size: 0.85 },
		wait: 4500,
		size: [1000, 560],
		later: { sessions: [session('hh', 'blaube', 'working')], wait: 500 },
	},
	// A working Blaube and its two helpers hop: their thought bubbles should
	// lag, swing and settle on their leashes, with the puffs trailing.
	bubbleMotion: {
		sessions: [session('bm', 'blaube', 'working', {
			agents: [
				{ id: 'h1', type: 'general-purpose', description: 'Fix the hover bubble', state: 'working', activity: 'thinking' },
				{ id: 'h2', type: 'Explore', description: 'Find the hook server', state: 'working', activity: 'tool' },
			],
		})],
		config: { size: 0.85 },
		wait: 4500,
		size: [1100, 560],
		motion: { frames: 24, every: 60, drop: 0, still: true, hopAt: [2, 13] },
	},
	// The mouse circles a Blaube wearing a plant, so its face keeps turning,
	// and it hops now and then: the plant must follow smoothly.
	plantMotion: {
		sessions: [session('pm', 'plant', 'idle', { look: 'sprout' })],
		config: { size: 1.3 },
		wait: 3500,
		size: [900, 560],
		motion: { frames: 28, every: 50, drop: 0, orbit: true, hopAt: 14 },
	},
	// Shaken around by the mouse, then dropped: do the looks stay on and
	// swing smoothly?
	shake: {
		sessions: ['antenna', 'sprout', 'bunny', 'catears', 'bow']
			.map((look, i) => session('shake' + i, look, 'idle', { look })),
		config: { size: 0.8 },
		wait: 4000,
		size: [1400, 560],
		motion: { frames: 18, every: 70, drop: 6 },
	},
	// Like a real desk: a big busy Blaube between two small ones, a display
	// font, and the mouse on the small one at the right edge.
	// Idle Blaubes turning to look at the mouse: above them, then off to the
	// side. What they wear should foreshorten with the head, not stretch.
	// Random looks: how many, where and how big differ per Blaube.
	manyLooks: {
		sessions: ['antenna', 'antenna', 'sprout', 'curl', 'horns', 'bow'].map((look, i) => session('many' + i * 7, look, 'idle', { look })),
		config: { size: 0.75 },
		wait: 4000,
		size: [1500, 560],
	},
	lookUp: {
		sessions: ['sprout', 'bunny', 'antenna', 'catears'].map((look, i) => session('up' + i, look, 'idle', { look })),
		config: { size: 0.8 },
		wait: 3500,
		size: [1200, 560],
		mouse: [600, 20],
	},
	lookSide: {
		sessions: ['sprout', 'bunny', 'antenna', 'catears'].map((look, i) => session('side' + i, look, 'idle', { look })),
		config: { size: 0.8 },
		wait: 3500,
		size: [1200, 560],
		mouse: [10, 400],
	},
	hoverCrowd: {
		sessions: [
			session('hc1', 'vergence-studios-playground', 'working', { activity: 'tool', look: 'sprout', color: '#E07BA8' }),
			session('hc2', 'Depth Strands: plane for all the strands', 'working', { activity: 'tool', look: 'sprout' }),
			session('hc3', 'blaube', 'idle', { look: 'antenna', color: '#E07BA8', info: { title: 'Blaubes clickability after restart', branch: 'claude/project-thread-a0ni6n', model: 'claude-opus-5-5' } }),
		],
		config: { font: 'DynaPuff' },
		hover: 'hc3',
		wait: 4000,
		size: [1100, 520],
	},
	// The same bubbles on a light desktop.
	light: {
		sessions: [
			session('l1', 'kalkis', 'done', { look: 'bow' }),
			session('l2', 'website', 'waiting', { color: '#5B8DEF', look: 'catears' }),
			session('l3', 'blaube', 'working', { color: '#5FB57A', look: 'antenna' }),
		],
		bg: '#f2f0ec',
		hover: 'l1',
		wait: 4000,
		size: [1100, 520],
	},
	hover: { sessions: [session('a', 'blaube', 'working', { activity: 'tool' })], hover: true },
	crowd: {
		sessions: [
			session('a', 'blaube', 'working'),
			session('b', 'kalkis', 'done', { color: '#5B8DEF' }),
			session('c', 'website', 'waiting', { color: '#5FB57A' }),
		],
		wait: 4000,
	},
};

async function shoot(win, name, scene) {
	const fire = (event, value) => win.webContents.send('fire', event, value);
	const ready = new Promise((r) => ipcMain.once('ready', r));
	const [w, h] = scene.size || [W, H];
	win.setContentSize(w, h);
	win.setBackgroundColor(scene.bg || '#1e1f22');
	await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'), { query: { debug: '1' } });
	await ready;
	fire('config', scene.config || {});
	// A taskbar along the bottom, as on a real desktop: the slimes stand on it.
	fire('world', { obstacles: [{ x: 0, y: h - 44, width: w, height: 44 }] });
	await win.webContents.executeJavaScript(`document.body.style.background = 'linear-gradient(transparent calc(100% - 44px), ${scene.bg ? '#d9d6d0' : '#121316'} 0)'`);
	fire('state', { sessions: scene.sessions, settings: { hooksInstalled: true } });
	await sleep(scene.wait || 2500);
	if (scene.rub) {
		// Back and forth across the slime's middle, like stroking it.
		const c = await win.webContents.executeJavaScript(`__blaube.buddies.get(${JSON.stringify(scene.rub)}).body.centroid()`);
		for (let i = 0; i < 24; i++) {
			win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(c.x + (i % 2 ? 45 : -45)), y: Math.round(c.y - 10) });
			await sleep(45);
		}
	}
	if (scene.later) {
		fire('state', { sessions: scene.later.sessions, settings: { hooksInstalled: true } });
		await sleep(scene.later.wait);
	}
	if (scene.command) {
		fire('command', scene.command);
		await sleep(scene.thenWait || 500);
	}
	if (scene.mouse) {
		win.webContents.sendInputEvent({ type: 'mouseMove', x: scene.mouse[0], y: scene.mouse[1] });
		await sleep(1500);
	}
	if (scene.hover) {
		// Point at a slime: the one named by key, or the first one.
		const key = typeof scene.hover === 'string' ? scene.hover : '';
		const at = await win.webContents.executeJavaScript(`(() => {
			const all = [...__blaube.buddies.values()];
			const b = all.find((x) => x.key === ${JSON.stringify(key)}) || all[0];
			return b && b.body.centroid();
		})()`);
		if (at) win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(at.x), y: Math.round(at.y) });
		await sleep(600);
	}
	if (scene.motion) return shootMotion(win, name, scene.motion);
	const img = await win.webContents.capturePage();
	fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
	console.log('saved', path.join('shots', `${name}.png`));
}

// Grabs the middle slime, shakes it left and right while lifting it, then
// drops it, taking a frame every few moments; saves the frames as a grid.
async function shootMotion(win, name, m) {
	const js = (s) => win.webContents.executeJavaScript(s);
	const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
	const bigs = await js(`[...__blaube.buddies.values()].filter((b) => b.kind !== 'child').map((b) => b.body.centroid())`);
	bigs.sort((a, b) => a.x - b.x);
	const start = m.shove ? bigs[0] : bigs[Math.floor(bigs.length / 2)];
	// How dented the slimes nobody is holding are: the closest any of their
	// skin gets to their middle, in radii (a round slime is about 1).
	const dents = () => js(`[...__blaube.buddies.values()].filter((b) => !b.body.grab).map((b) => { const c = b.body.centroid(); let m = Infinity; for (let i = 0; i < b.body.n; i++) m = Math.min(m, Math.hypot(b.body.px[i] - c.x, b.body.py[i] - c.y)); return m / b.body.o.radius; })`);
	let dent = Infinity;
	if (m.stack) {
		// Lift the right one onto the left one's head.
		await js(`(() => { const l = [...__blaube.buddies.values()].sort((a, b) => a.body.centroid().x - b.body.centroid().x); const c = l[0].body.centroid(); l[1].body.teleport(c.x, c.y - l[0].body.o.radius * 2.1); })()`);
	}
	// A fake window, drawn behind the slimes, and its top as a ledge.
	const fakeWindow = async (x, y) => {
		win.webContents.send('fire', 'ledges', [{ id: 7, x0: x, x1: x + 420, y, wx: x }]);
		await js(`(() => { let d = document.getElementById('fakewin'); if (!d) { d = document.createElement('div'); d.id = 'fakewin'; document.body.prepend(d); } d.style.cssText = 'position:fixed;left:${x}px;top:${y}px;width:420px;height:400px;background:#3a3d44;border-top:28px solid #4a4e57;box-sizing:border-box;z-index:-1'; })()`);
	};
	if (m.flick) {
		await fakeWindow(250, 400);
		await js(`[...__blaube.buddies.values()][0].body.teleport(450, 250)`);
	}
	if (m.climb) {
		await fakeWindow(250, 330);
		await js(`[...__blaube.buddies.values()].find((b) => b.kind === 'mother').body.teleport(450, 200)`);
	}
	if (m.ledge) {
		await fakeWindow(120, 300);
		await js(`(() => { const l = [...__blaube.buddies.values()]; l[0].body.teleport(300, 120); l[1].body.teleport(800, 420); })()`);
	}
	if (m.huddle) {
		await js(`(() => { const l = [...__blaube.buddies.values()]; l.forEach((b, i) => b.body.teleport(300 + i * 150, 400)); })()`);
		await sleep(1500);
	}
	const rest = Math.min(...(await dents()));
	const looks = () => js(`[...__blaube.buddies.values()].filter((b) => b.lookState).map((b) => ({ look: b.look, a: b.lookState.a, t: b.lookState.t, off: BlaubeLooks.offTop(b) }))`);
	const drawn = () => js(`[...__blaube.buddies.values()].filter((b) => b.lookDrawn).map((b) => Object.assign({ look: b.look }, b.lookDrawn))`);
	if (!m.orbit && !m.still) {
		mouse('mouseMove', start.x, start.y);
		mouse('mouseDown', start.x, start.y);
	}
	const frames = [], track = [], spots = [];
	for (let i = 0; i < m.frames + m.drop; i++) {
		if (m.still) {
			if (m.hopAt.includes(i)) win.webContents.send('fire', 'command', 'hop');
			if (m.flick && i === 4) {
				// Dragged up, slowly then fast, then let go. While it moves, the
				// slime should stay on the window top (where the app thinks it
				// is between reports): measure the gap, and if it ever lost it.
				// (A single miss is the slime's own little hop; three in a row is
				// the window leaving it behind.)
				const gaps = [];
				for (let k = 1; k <= 24; k++) {
					await fakeWindow(250, 400 - (k <= 12 ? k * 4 : 48 + (k - 12) * 14));
					await sleep(16);
					gaps.push(await js('(() => { const b = [...__blaube.buddies.values()][0], l = b.body.onLedge; return l ? l.y - b.body.bbox().maxY : null; })()'));
				}
				let run = 0, lost = false;
				for (const g of gaps) { run = g === null ? run + 1 : 0; if (run >= 3) lost = true; }
				const worst = Math.max(...gaps.filter((g) => g !== null).map(Math.abs));
				console.log(`check ride: biggest gap between slime and window top while dragged ${worst.toFixed(1)} px${lost ? ', and it got left behind' : ''}${worst > 8 || lost ? ' -- not following smoothly' : ' ok'}`);
			}
			if (m.flick && i === 18) await fakeWindow(800, 120);
			if (m.ledge && i === 8) await js(`(() => { const b = [...__blaube.buddies.values()][1]; b.body.teleport(420, 420); b.body.impulse(0, -1200, 1 / 120); })()`);
			if (m.ledge && i >= 18 && i <= 22) await fakeWindow(120 + (i - 17) * 40, 300 - (i - 17) * 12);
			if (m.commandAt && m.commandAt[i]) win.webContents.send('fire', 'command', m.commandAt[i]);
			if (m.tease) {
				// Wiggle above it, low enough to reach.
				const top = await js(`[...__blaube.buddies.values()][0].body.bbox().minY`);
				mouse('mouseMove', start.x + Math.sin(i * 1.3) * 25, top - 70 + Math.cos(i * 1.7) * 10);
			}
		} else if (m.orbit) {
			// Round and round the slime, about a second per lap.
			const a = i * 0.45;
			mouse('mouseMove', start.x + Math.cos(a) * 300, start.y - 80 + Math.sin(a) * 220);
			if (i === m.hopAt) win.webContents.send('fire', 'command', 'hop');
		} else if (m.shove) {
			if (i < m.frames) mouse('mouseMove', start.x + Math.min(1, i / (m.frames * 0.5)) * (win.getContentSize()[0] * 0.55 - start.x), start.y + 10);
		} else if (i < m.frames) mouse('mouseMove', start.x + Math.sin(i * 0.6) * 170, start.y - 50 - i * 5); // about as fast as a hand
		if (!m.orbit && !m.still && i === m.frames) mouse('mouseUp', start.x, start.y - 60 - i * 6);
		await sleep(m.every);
		frames.push((await win.webContents.capturePage()).toDataURL());
		track.push(await looks());
		spots.push(await drawn());
		if (m.shove) dent = Math.min(dent, ...(await dents()));
	}
	if (m.shove) console.log(`check shove: closest skin to a bystander's middle ${dent.toFixed(2)} radii (${rest.toFixed(2)} at rest)${dent < rest * 0.8 ? ' -- dented' : ' ok'}`);
	// Where each look was drawn, relative to its body: a jump between two
	// frames in place, angle or length is a visible snap.
	const spotsBy = {};
	for (const f of spots) for (const s of f) (spotsBy[s.look] = spotsBy[s.look] || []).push(s);
	for (const [look, list] of Object.entries(spotsBy)) {
		let move = 0, turn = 0, stretch = 0, worst = 0;
		for (let i = 1; i < list.length; i++) {
			const a = list[i - 1], b = list[i];
			const mv = Math.hypot(b.x - a.x, b.y - a.y), tr = Math.abs(Math.atan2(Math.sin(b.rot - a.rot), Math.cos(b.rot - a.rot))), st = Math.abs(b.len / a.len - 1);
			if (mv > move) move = mv;
			if (tr > turn) { turn = tr; worst = i + 1; }
			if (st > stretch) stretch = st;
		}
		const notes = [];
		if (move > 25) notes.push(`slides ${move.toFixed(0)} px between frames`);
		if (turn > 0.3) notes.push(`turns ${turn.toFixed(2)} rad between frames (worst at frame ${worst})`);
		if (stretch > 0.15) notes.push(`changes length ${(stretch * 100).toFixed(0)}% between frames`);
		console.log(`drawn ${look}: biggest jump ${move.toFixed(0)} px, ${turn.toFixed(2)} rad, ${(stretch * 100).toFixed(0)}% length${notes.length ? ' -- ' + notes.join('; ') : ' ok'}`);
	}
	// Checks: hitting the limit hard, or jumping from one frame to the next.
	const byLook = {};
	for (const f of track) for (const l of f) (byLook[l.look] = byLook[l.look] || []).push(l);
	for (const [look, list] of Object.entries(byLook)) {
		const peak = Math.max(...list.map((l) => Math.abs(l.a)));
		let jump = 0;
		for (let i = 1; i < list.length; i++) jump = Math.max(jump, Math.abs(Math.tanh(list[i].a / 0.45) - Math.tanh(list[i - 1].a / 0.45)) * 0.45);
		const off = Math.max(...list.map((l) => l.off));
		const notes = [];
		if (off > 0.7) notes.push(`sits ${off.toFixed(2)} rad away from the top of the head: looks detached`);
		if (peak > 0.9) notes.push(`base swings to ${peak.toFixed(2)} rad, past its 0.45 limit: it will look stuck at the limit`);
		if (jump > 0.25) notes.push(`jumps ${jump.toFixed(2)} rad between frames: jittery`);
		console.log(`check ${look}: peak ${peak.toFixed(2)}, biggest frame jump ${jump.toFixed(2)}, furthest off the top ${off.toFixed(2)}${notes.length ? ' -- ' + notes.join('; ') : ' ok'}`);
	}
	// Lay the frames out in a grid, half size, and save that.
	const cols = 4, size = win.getContentSize(), fw = Math.round(size[0] / 2), fh = Math.round(size[1] / 2);
	const sheet = new BrowserWindow({ width: fw * cols, height: fh * Math.ceil(frames.length / cols), show: false, webPreferences: { offscreen: true } });
	const html = `<body style="margin:0;overflow:hidden;display:grid;grid-template-columns:repeat(${cols},${fw}px);background:#000">${frames.map((src, i) => `<div style="position:relative"><img src="${src}" style="width:${fw}px;height:${fh}px;display:block"><span style="position:absolute;left:6px;top:4px;color:#fff;font:12px sans-serif">${i + 1}${i >= m.frames ? ' (dropped)' : ''}</span></div>`).join('')}</body>`;
	const file = path.join(OUT, '.sheet.html');
	fs.writeFileSync(file, html);
	await sheet.loadFile(file);
	await sleep(300);
	fs.writeFileSync(path.join(OUT, `${name}.png`), (await sheet.webContents.capturePage()).toPNG());
	sheet.destroy();
	console.log('saved', path.join('shots', `${name}.png`));
}

app.setPath('userData', path.join(OUT, '.userdata'));
app.whenReady().then(async () => {
	fs.mkdirSync(OUT, { recursive: true });
	// Off-screen rendering at a full 60 frames a second: a plain hidden
	// window barely runs its animation, so the slimes would never settle.
	const win = new BrowserWindow({
		width: W, height: H, show: false, frame: false, useContentSize: true, backgroundColor: '#1e1f22',
		webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, offscreen: true, backgroundThrottling: false },
	});
	win.webContents.setFrameRate(60);
	win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('page error:', e.message); });
	const wanted = process.argv.slice(2).filter((a) => SCENES[a]);
	for (const name of wanted.length ? wanted : Object.keys(SCENES)) await shoot(win, name, SCENES[name]);
	app.quit();
});
