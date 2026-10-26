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
const { placeTalk } = require(path.join(ROOT, 'src', 'main', 'talkPlace.js'));
const TALK_W = 600, TALK_MIN_H = 420, TALK_MAX_H = 820, TALK_MIN_ABOVE = 460; // (as src/main/main.js sizes the box)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const session = (id, project, state, extra = {}) => Object.assign({ id, project, state, activity: 'thinking', agents: [], tasks: [] }, extra);
const full = (fill) => ({ total: 400000, context: fill * 200000, limit: 200000 });

// Each scene: sessions to show, and optionally what to do before the picture.
const SCENES = {
	idle: { sessions: [session('a', 'blaube', 'idle')] },
	thinking: { sessions: [session('a', 'blaube', 'working')] },
	tool: { sessions: [session('a', 'blaube', 'working', { activity: 'tool' })] },
	// What each kind of tool call looks like (shared/actions.js), seven at a time.
	actions: {
		sessions: ['read', 'edit', 'test', 'commit', 'push', 'pull', 'install'].map((action, i) => session('ac' + i, action, 'working', { activity: 'tool', action, look: 'none' })),
		config: { size: 0.7 },
		wait: 3500,
		size: [1400, 460],
	},
	actions2: {
		sessions: ['delete', 'folder', 'web', 'todo', 'helper', 'app', 'run'].map((action, i) => session('ad' + i, action, 'working', { activity: 'tool', action, look: 'none' })),
		config: { size: 0.7 },
		wait: 3500,
		size: [1400, 460],
	},
	done: { sessions: [session('a', 'blaube', 'done')] },
	waiting: { sessions: [session('a', 'blaube', 'waiting', { message: 'Claude needs your permission to use Bash' })] },
	sweat: { sessions: [session('a', 'blaube', 'working', { tokens: full(0.75) })], wait: 4000 },
	// Talking: a big one and a small one babble; the mouth should open and
	// shut with each syllable (vowels shaping it), then settle back.
	talking: {
		sessions: [session('t1', 'blaube', 'idle', { tokens: { total: 6000000, context: 20000, limit: 200000 } }), session('t2', 'kalkis', 'idle', { color: '#5B8DEF' })],
		config: { size: 0.85 },
		wait: 3000,
		size: [1000, 460],
		motion: { frames: 16, every: 70, drop: 0, still: true, hopAt: [], sayAt: { 0: [{ id: 't1', text: 'Okay! I fixed the bug, and the tests pass.', seconds: 4 }, { id: 't2', text: 'Want me to push it?', seconds: 4 }] } },
	},
	// The choir: five slimes sing Silent Night in parts (biggest on the bass),
	// eyes shut, mouths open on the notes, swaying, little notes rising.
	choir: {
		sessions: [
			session('c1', 'blaube', 'idle', { tokens: { total: 6000000, context: 20000, limit: 200000 } }),
			session('c2', 'kalkis', 'idle', { color: '#5B8DEF' }),
			session('c3', 'playground', 'idle', { color: '#5FB57A', agents: [{ id: 'ca', type: 'general-purpose', description: 'Helper', state: 'working', activity: 'thinking' }] }),
			session('c4', 'notes', 'idle', { color: '#9B7BD8' }),
		],
		config: { size: 0.75 },
		wait: 4500,
		size: [1200, 520],
		motion: { frames: 16, every: 160, drop: 0, still: true, hopAt: [], commandAt: { 0: 'choir:silent-night' } },
	},
	// The same slime at four context fills: the fuller, the rounder and firmer.
	fills: {
		sessions: [0.05, 0.4, 0.75, 1].map((f, i) => session('f' + i, 'fill' + Math.round(f * 100), 'idle', { tokens: full(f) })),
		config: { size: 0.6 },
		wait: 9000,
		size: [1300, 520],
	},
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
	// Helpers grow with their own tokens: a fresh one, a busy one, a big one.
	helperSizes: {
		sessions: [session('hs', 'kalkis', 'working', {
			tokens: { total: 900000, context: 90000, limit: 200000 },
			agents: [
				{ id: 'k1', type: 'Explore', description: 'Quick look', state: 'working', activity: 'thinking', tokens: 5000 },
				{ id: 'k2', type: 'general-purpose', description: 'Busy one', state: 'working', activity: 'tool', action: 'read', tokens: 80000 },
				{ id: 'k3', type: 'general-purpose', description: 'Big job', state: 'working', activity: 'tool', action: 'edit', tokens: 600000 },
			],
		})],
		wait: 5000,
		size: [1100, 560],
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
		size: [1000, 1000],
		motion: { frames: 24, every: 100, drop: 0, still: true, hopAt: [], flick: true },
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
	hover: { sessions: [session('a', 'blaube', 'working', { activity: 'tool', tokens: { total: 400000, context: 124000, limit: 200000 } })], hover: true },
	// Hovering a busy slime: its squeezed-shut working eyes open wide and
	// follow the cursor (on its left, its right, its top), easing open and,
	// once you move off, shut again.
	peek: {
		sessions: [session('pk', 'blaube', 'working', { look: 'sprout' })],
		wait: 3000,
		size: [700, 460],
		motion: { frames: 32, every: 90, drop: 0, still: true, hopAt: [], mouseAt: { 0: [3, -3], 3: [-0.6, 0.1], 9: [0.6, 0.1], 14: [0, -0.45], 19: [3, -3] } },
	},
	// The cursor resting on a blob's face, at its left, middle and right: it
	// looks right at it (idle; the second is a busy one).
	faceLook: {
		sessions: [session('lk', 'blaube', 'idle')],
		wait: 3000,
		size: [700, 460],
		motion: { frames: 30, every: 90, drop: 0, still: true, hopAt: [], mouseAt: { 0: [-0.5, 0.1], 10: [0, 0.1], 20: [0.5, 0.1] } },
	},
	faceLookWork: {
		sessions: [session('lk', 'blaube', 'working', { look: 'sprout' })],
		wait: 3000,
		size: [700, 460],
		motion: { frames: 30, every: 90, drop: 0, still: true, hopAt: [], mouseAt: { 0: [-0.5, 0.1], 10: [0, 0.1], 20: [0.5, 0.1] } },
	},
	// Halloween: one pulls a sheet over itself, creeps up on the other,
	// boooo!, and off comes the sheet.
	ghost: {
		sessions: [session('gh1', 'blaube', 'idle', { look: 'horns' }), session('gh2', 'kalkis', 'idle', { color: '#5B8DEF', look: 'catears' })],
		config: { size: 0.85 },
		wait: 3000,
		size: [1000, 460],
		motion: { frames: 48, every: 110, drop: 0, still: true, hopAt: [], jsAt: { 0: 'teleport', 6: 'ghost' } },
	},
	// The same, picked up mid-creep: the sheet comes off as it's lifted.
	ghostGrab: {
		sessions: [session('gh1', 'blaube', 'idle', { look: 'bunny' }), session('gh2', 'kalkis', 'idle', { color: '#5B8DEF', look: 'bow' })],
		config: { size: 0.85 },
		wait: 3000,
		size: [1000, 460],
		motion: { frames: 24, every: 80, drop: 0, still: true, hopAt: [], jsAt: { 0: 'teleport', 4: 'ghost' }, grabAt: { 16: 'gh1' }, releaseAt: 23 },
	},
	// The talk box (a click on a slime), drawn where the app would put it.
	talkChat: {
		sessions: [session('tc', 'vergence-studios-playground', 'done', { look: 'bunny' }), session('tc2', 'kalkis', 'idle', { color: '#5B8DEF', look: 'bow' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1000, 640],
		talk: { key: 'tc', inbox: 'ready', today: 'Today: 14 replies · 2h 10m of work · 23 files changed', git: 'feature/login · 3 changed', quick: [{ label: 'Commit', prompt: 'Commit' }, { label: 'Open a PR', prompt: 'PR' }, { label: 'Run tests', prompt: 'Tests' }],
			others: [{ id: 'tc', project: 'vergence', color: '#D97757', state: 'done', status: 'Done: Committed as f3a91c2 “Fix flaky e2e timeout”.', meta: 'feature/login · 3 changed' },
				{ id: 'tc2', project: 'kalkis', color: '#5B8DEF', state: 'waiting', status: 'Needs you: Claude needs your permission to use Bash', meta: '62% context · main' },
				{ id: 'tc3', project: 'web', color: '#E07BA8', state: 'working', status: 'Editing Hero.tsx · 4m', meta: '2 of 5 on its list · main · 7 changed' }], log: [
			{ who: 'you', text: 'run the tests and tell me if anything fails', via: 'terminal' },
			{ who: 'claude', text: 'All 66 tests pass. I also fixed a flaky timeout in the e2e test: it was waiting on the wrong event.' },
			{ who: 'you', text: 'nice. can you commit that?', via: 'blaube', status: 'sent' },
			{ who: 'note', text: 'Allowed Bash: git commit -m "Fix flaky e2e timeout"' },
			{ who: 'claude', text: 'Committed as f3a91c2 “Fix flaky e2e timeout”.', turn: { took: 252e3, steps: 9, files: ['/w/test/e2e.js', '/w/src/main/inbox.js'] } },
		] },
	},
	// The tail, with the slime straight below the box, to the left, to the right.
	talkTailMid: { sessions: [session('tt', 'blaube', 'idle')], bg: '#f2f0ec', wait: 2500, size: [1000, 640], talk: { key: 'tt', x: 500, inbox: 'ready', log: [{ who: 'claude', text: 'All 66 tests pass.' }] } },
	talkTailLeft: { sessions: [session('tt', 'blaube', 'idle')], bg: '#f2f0ec', wait: 2500, size: [1000, 640], talk: { key: 'tt', x: 130, inbox: 'ready', log: [{ who: 'claude', text: 'All 66 tests pass.' }] } },
	talkTailRight: { sessions: [session('tt', 'blaube', 'idle')], bg: '#f2f0ec', wait: 2500, size: [1000, 640], talk: { key: 'tt', x: 870, inbox: 'ready', log: [{ who: 'claude', text: 'All 66 tests pass.' }] } },
	// /context in a session Blaube started: what fills it, as a bar.
	talkContext: {
		sessions: [session('tx', 'blaube', 'done', { color: '#5B8DEF', look: 'antenna' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1000, 640],
		talk: { key: 'tx', inbox: 'ready', owned: true, canMode: true, mode: 'acceptEdits', model: 'Opus 5.5', context: 62, limit: '82% of the week used', log: [
			{ who: 'you', text: 'how full are you?', via: 'blaube', status: 'sent' },
			{ who: 'claude', text: 'About two thirds. Most of it is our conversation so far.' },
			{ who: 'you', text: '/context', via: 'blaube', status: 'sent' },
			{ who: 'note', text: 'Context: 62% full (124k of 200k)', context: { max: 200000, parts: [
				{ name: 'Messages', tokens: 81000, kind: 'used', label: 'Messages 81k' },
				{ name: 'System tools', tokens: 29200, kind: 'used', label: 'System tools 29.2k' },
				{ name: 'Skills', tokens: 6800, kind: 'used', label: 'Skills 6.8k' },
				{ name: 'System prompt', tokens: 3800, kind: 'used', label: 'System prompt 3.8k' },
				{ name: 'Memory files', tokens: 3200, kind: 'used', label: 'Memory files 3.2k' },
				{ name: 'Autocompact buffer', tokens: 33000, kind: 'buffer', label: 'Autocompact buffer 33k' },
				{ name: 'Free space', tokens: 43000, kind: 'free', label: 'Free space 43k' },
			] } },
		] },
	},
	talkAsk: {
		sessions: [session('ta', 'blaube', 'waiting', { color: '#5B8DEF', look: 'antenna', message: 'Claude needs your permission to use Bash' })],
		wait: 3500,
		size: [1000, 640],
		talk: { key: 'ta', inbox: 'busy', log: [
			{ who: 'you', text: 'clean out the build folder and rebuild', via: 'blaube', status: 'sent' },
		], ask: { key: 1, tool: 'Bash', detail: 'rm -rf dist && npm run build:mac:local', always: 'Always allow npm run build:*' }, asks: 2 },
	},
	talkThinking: {
		sessions: [session('tt', 'website', 'working', { color: '#E07BA8', look: 'catears' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1000, 640],
		talk: { key: 'tt', inbox: 'busy', log: [
			{ who: 'claude', text: 'Here’s what changed:\n\n## Summary\n- Moved the **hero image** to `public/hero.webp`\n- Lazy-loads the gallery\n- Fixed the nav on mobile\n\n```\nnpm run build  ✓ 2.1s\n```' },
			{ who: 'you', text: 'looks good, ship it', via: 'blaube', status: 'sent' },
		] },
	},
	// What it did between replies, Stop while it works, and a message that
	// goes in at its next step.
	talkSteps: {
		talkJs: `setTimeout(() => { document.querySelectorAll('button.step')[1].click(); document.getElementById('todoHead').click(); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137,80,78,71])], 'screenshot.png', { type: 'image/png' })); document.getElementById('text').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, 500)`,
		sessions: [session('ts', 'blaube', 'working', { look: 'sprout' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1000, 640],
		talk: { key: 'ts', inbox: 'busy', stoppable: true, todos: [
			{ id: '1', text: 'Log each step', doing: 'Logging each step', status: 'completed' },
			{ id: '2', text: 'Add a Stop button', doing: 'Adding a Stop button', status: 'completed' },
			{ id: '3', text: 'Show the steps in the talk box', doing: 'Showing the steps in the talk box', status: 'in_progress' },
			{ id: '4', text: 'Run the tests', doing: 'Running the tests', status: 'pending' },
		], log: [
			{ who: 'you', text: 'make the talk box show what you did', via: 'blaube', status: 'sent', n: 1 },
			{ who: 'step', text: 'Read inbox.js', ok: true, n: 2 },
			{ who: 'step', text: 'Read talk.js', ok: true, n: 3 },
			{ who: 'step', text: 'Searched for “who === ”', ok: true, n: 4 },
			{ who: 'step', text: 'Edited inbox.js', ok: true, n: 5, detail: '− const MAX_LOG = 60;\n+ const MAX_LOG = 60;\n+ const MAX_STEPS = 40;' },
			{ who: 'step', text: 'Run the tests', ok: false, n: 6, detail: '$ npm test\nnot ok 91 - steps never push what was said out of the log\n  AssertionError: 41 !== 40' },
			{ who: 'step', text: 'Edited talk.js', ok: true, n: 7 },
			{ who: 'you', text: 'and keep it quiet, small text', via: 'blaube', status: 'queued', n: 8 },
		] },
	},
	talkLong: {
		sessions: [session('tl', 'blaube', 'done', { look: 'horns' })],
		wait: 3500,
		size: [1000, 640],
		talk: { key: 'tl', inbox: 'ready', log: [
			{ who: 'you', text: 'why is the window ledge code slow on mac?', via: 'blaube', status: 'sent' },
			{ who: 'claude', at: 5, text: 'It isn’t the scan itself: listing windows through CoreGraphics takes about a millisecond.\n\nThe slow part was elsewhere:\n1. We spawned a new osascript process for every scan.\n2. Each spawn costs ~90 ms before it runs anything.\n3. At 60 scans a second that queues up and lags.\n\nNow one long-running loop prints changes only, so it costs almost nothing while windows sit still and stays smooth while you drag one. I also skip windows smaller than 80×40, since nothing can stand on them, and the menu bar and Dock layers.\n\nLet me know if you want me to add a setting for how often it checks.' },
		] },
	},
	talkQuestion: {
		sessions: [session('tq', 'website', 'waiting', { color: '#E07BA8', look: 'catears' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1000, 900],
		talk: { key: 'tq', inbox: 'busy', log: [
			{ who: 'you', text: 'give the landing page a fresh look', via: 'terminal' },
		], ask: { key: 1, kind: 'question', tool: 'AskUserQuestion', detail: '', always: '', questions: [
			{ question: 'Which direction should the new look take?', header: 'Style', multiSelect: false, options: [
				{ label: 'Soft and playful', description: 'Rounded type, pastel colours' },
				{ label: 'Clean and minimal', description: 'Lots of white, one accent' },
				{ label: 'Bold and loud', description: 'Big type, strong colour blocks' },
			] },
		] } },
	},
	talkQuestions: {
		sessions: [session('tqs', 'kalkis', 'waiting', { color: '#5FB57A', look: 'sprout' })],
		wait: 3500,
		size: [1000, 1000],
		talk: { key: 'tqs', inbox: 'busy', log: [], ask: { key: 1, kind: 'question', tool: 'AskUserQuestion', detail: '', always: '', questions: [
			{ question: 'Which calculators should get the 2027 rates?', header: 'Scope', multiSelect: true, options: [
				{ label: 'Income tax', description: '' }, { label: 'VAT', description: '' }, { label: 'Car tax', description: '' },
			] },
			{ question: 'Ship today?', header: 'Release', multiSelect: false, options: [
				{ label: 'Yes', description: 'Deploy when the tests pass' }, { label: 'No', description: 'Leave it on a branch' },
			] },
		] } },
	},
	// The same card with answers being picked (after the click guard).
	talkQuestionsPicked: {
		sessions: [session('tqp', 'kalkis', 'waiting', { color: '#E8B84A', look: 'bow' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1000, 1000],
		talkJs: `setTimeout(() => { const o = document.querySelectorAll('#askQuestions .opt'); o[1].click(); o[2].click(); document.querySelectorAll('#askQuestions .otherchip')[0].click(); document.querySelectorAll('#askQuestions .other')[0].value = 'and the payroll one'; document.querySelectorAll('#askQuestions .other')[0].dispatchEvent(new Event('input')); }, 500)`,
		talk: { key: 'tqp', inbox: 'busy', log: [], ask: { key: 1, kind: 'question', tool: 'AskUserQuestion', detail: '', always: '', questions: [
			{ question: 'Which calculators should get the 2027 rates?', header: 'Scope', multiSelect: true, options: [
				{ label: 'Income tax', description: '' }, { label: 'VAT', description: '' }, { label: 'Car tax', description: '' },
			] },
			{ question: 'Ship today?', header: 'Release', multiSelect: false, options: [
				{ label: 'Yes', description: 'Deploy when the tests pass' }, { label: 'No', description: 'Leave it on a branch' },
			] },
		] } },
	},
	talkPlan: {
		sessions: [session('tp', 'blaube', 'waiting', { look: 'bunny' })],
		wait: 3500,
		size: [1000, 900],
		talk: { key: 'tp', inbox: 'busy', log: [
			{ who: 'you', text: 'plan how to add sounds', via: 'blaube', status: 'sent' },
		], ask: { key: 1, kind: 'plan', tool: 'ExitPlanMode', detail: '', always: 'Go ahead, and auto-accept edits', plan: '## Add sounds\n1. Add a `sounds/` folder with squish, boing and chime (short, soft).\n2. Play squish on landing, boing on a throw, chime when a session is done.\n3. A **Sounds** switch in Settings, off by default.\n4. Keep it quiet: never more than one sound at a time.' } },
	},
	// A session you just started from Blaube: its box opens by itself.
	talkNew: {
		sessions: [session('tn', 'kalkis', 'idle', { color: '#5B8DEF', look: 'antenna' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1000, 700],
		talk: { key: 'tn', inbox: 'ready', owned: true, log: [] },
	},
	talkBusy: {
		sessions: [session('tb', 'kalkis', 'working', { color: '#5FB57A', look: 'sprout' })],
		wait: 3500,
		size: [1000, 640],
		talk: { key: 'tb', inbox: 'busy', queued: 1, log: [
			{ who: 'you', text: 'add the new 2027 tax brackets to the calculator', via: 'terminal' },
			{ who: 'you', text: 'and update the changelog when you’re done', via: 'blaube', status: 'queued' },
		] },
	},
	// The talk box on a roomy desktop, in the states it's in most: a short
	// chat, a long one (Markdown, code, steps), working, asking, an error.
	talkShort: {
		sessions: [session('hs', 'kalkis', 'done', { color: '#5B8DEF', look: 'antenna' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1280, 900],
		talk: { key: 'hs', inbox: 'ready', git: 'main · 1 changed', log: [
			{ who: 'you', text: 'what does the VAT calculator round to?', via: 'blaube', status: 'sent' },
			{ who: 'claude', text: 'It rounds to **whole kroner**, half up, after adding the 25% VAT. The rounding lives in `src/vat.js` in `roundKr()`.' },
		] },
	},
	talkHarness: {
		sessions: [session('hh', 'blaube', 'done', { look: 'sprout' }), session('hh2', 'kalkis', 'waiting', { color: '#5B8DEF', look: 'bow' }), session('hh3', 'website', 'working', { color: '#E07BA8', look: 'catears' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1400, 1000],
		talkJs: `setTimeout(() => { const b = [...document.querySelectorAll('button.step')].find((x) => /tests/.test(x.textContent)); if (b) b.click(); }, 400)`,
		talk: { key: 'hh', inbox: 'ready', title: 'Faster window scan', git: 'feature/ledges · 3 changed', todos: [
			{ id: '1', text: 'Find the slow part', doing: 'Finding the slow part', status: 'completed' },
			{ id: '2', text: 'Keep one osascript running', doing: 'Keeping one osascript running', status: 'completed' },
			{ id: '3', text: 'Run the tests', doing: 'Running the tests', status: 'completed' },
		],
		others: [{ id: 'hh', project: 'blaube', color: '#D97757', state: 'done' }, { id: 'hh2', project: 'kalkis', color: '#5B8DEF', state: 'waiting' }, { id: 'hh3', project: 'website', color: '#E07BA8', state: 'working' }],
		log: [
			{ who: 'you', text: 'why is the window ledge code slow on mac? fix it if you can', via: 'blaube', status: 'sent', n: 1 },
			{ who: 'step', text: 'Read src/main/ledges.js', ok: true, n: 2 },
			{ who: 'step', text: 'Searched for “osascript”', ok: true, n: 3 },
			{ who: 'step', text: 'Read src/main/win/scan.swift', ok: true, n: 4 },
			{ who: 'step', text: 'Edited src/main/ledges.js', ok: true, n: 5, detail: '− const out = execFileSync(\'osascript\', args);\n+ const out = scanner.latest();' },
			{ who: 'step', text: 'Ran the tests', ok: false, n: 6, detail: '$ npm test\nnot ok 14 - a lone window makes one ledge along its top\n  AssertionError: 0 !== 1' },
			{ who: 'step', text: 'Edited test/windows.test.js', ok: true, n: 7 },
			{ who: 'step', text: 'Ran the tests', ok: true, n: 8, detail: '$ npm test\n# tests 277\n# pass 263\n# skipped 14' },
			{ who: 'claude', at: 5, text: '## What was slow\nIt isn’t the scan itself: listing windows through CoreGraphics takes about a millisecond. The slow part:\n\n1. We started a new `osascript` process for **every** scan.\n2. Each start costs ~90 ms before it runs anything.\n3. At 60 scans a second that queues up and lags.\n\n## What I changed\n- One long-running scanner now prints only *changes*.\n- Windows smaller than 80×40 are skipped, and so are the menu bar and Dock layers.\n\n| | Before | After |\n|---|---|---|\n| Per scan | ~90 ms | <1 ms |\n| CPU while still | 18% | 0.3% |\n\n```js\nconst scanner = startScanner();\nscanner.on(\'change\', (list) => setLedges(list));\n```\n\nAll 263 tests pass.', turn: { took: 312e3, steps: 7, files: ['/w/src/main/ledges.js', '/w/test/windows.test.js'] } },
			{ who: 'you', text: 'great, commit it', via: 'blaube', status: 'sent', n: 9 },
			{ who: 'note', text: 'Allowed Bash: git commit -m "Scan windows with one long-running helper"' },
			{ who: 'claude', text: 'Committed as `f3a91c2` “Scan windows with one long-running helper”.', turn: { steps: 2, files: [] } },
		] },
	},
	talkWorking: {
		sessions: [session('hw', 'blaube', 'working', { look: 'sprout' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1280, 950],
		talk: { key: 'hw', inbox: 'busy', stoppable: true, doing: 'Editing talk.js', turnStart: Date.now() - 83e3, model: 'Opus 5.5', context: 64, git: 'main · 2 changed',
			tasks: [{ id: 't1', label: 'Dev server', command: 'npm run dev', url: 'http://localhost:5173' }],
			helpers: [{ name: 'Finding the tax tables', doing: 'Reading rates.js' }],
			todos: [
				{ id: '1', text: 'Log each step', doing: 'Logging each step', status: 'completed' },
				{ id: '2', text: 'Show the steps in the talk box', doing: 'Showing the steps in the talk box', status: 'in_progress' },
				{ id: '3', text: 'Run the tests', doing: 'Running the tests', status: 'pending' },
			], log: [
			{ who: 'you', text: 'make the talk box show what you did, step by step', via: 'blaube', status: 'sent', n: 1 },
			{ who: 'step', text: 'Read inbox.js', ok: true, n: 2 },
			{ who: 'step', text: 'Read talk.js', ok: true, n: 3 },
			{ who: 'step', text: 'Edited inbox.js', ok: true, n: 4, detail: '− const MAX_LOG = 60;\n+ const MAX_LOG = 60;\n+ const MAX_STEPS = 40;' },
			{ who: 'you', text: 'and keep it quiet, small text', via: 'blaube', status: 'queued', n: 5 },
		] },
	},
	talkPermission: {
		sessions: [session('hp', 'blaube', 'waiting', { color: '#5B8DEF', look: 'antenna', message: 'Claude needs your permission to use Bash' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1280, 950],
		talk: { key: 'hp', inbox: 'busy', git: 'main', log: [
			{ who: 'you', text: 'clean out the build folder and rebuild', via: 'blaube', status: 'sent', n: 1 },
			{ who: 'step', text: 'Read package.json', ok: true, n: 2 },
		], ask: { key: 1, kind: 'tool', tool: 'Bash', detail: 'rm -rf dist && npm run build:mac:local', always: 'Always allow npm run build:*', alwaysFull: 'Always allow npm run build:* in this project' }, asks: 2 },
	},
	talkError: {
		sessions: [session('he', 'website', 'idle', { color: '#E07BA8', look: 'catears' })],
		bg: '#f2f0ec',
		wait: 3500,
		size: [1280, 900],
		talk: { key: 'he', inbox: 'ready', log: [
			{ who: 'you', text: 'deploy the preview', via: 'blaube', status: 'sent', n: 1 },
			{ who: 'step', text: 'Ran vercel deploy', ok: false, n: 2, detail: 'Error: No credentials found. Run `vercel login`.' },
			{ who: 'note', error: true, text: 'API Error: 529 Overloaded. Claude’s servers are busy; it stopped before finishing. Send it a message to try again.' },
		] },
	},
	crowd: {
		sessions: [
			session('a', 'blaube', 'working'),
			session('b', 'kalkis', 'done', { color: '#5B8DEF' }),
			session('c', 'website', 'waiting', { color: '#5FB57A' }),
		],
		wait: 4000,
	},
	// Speech bubbles next to sign bubbles: they should read as one set. A
	// short quip, a longer line that wraps, beside a gear, a prompt and a "!".
	speech: {
		sessions: [
			session('sa', 'blaube', 'working'),
			session('sb', 'kalkis', 'idle', { color: '#5B8DEF' }),
			session('sc', 'website', 'working', { color: '#5FB57A', activity: 'tool' }),
			session('sd', 'notes', 'idle', { color: '#9B7BD8' }),
			session('se', 'shop', 'done', { color: '#E07BA8' }),
			session('sf', 'docs', 'idle', { color: '#E8B04A' }),
		],
		config: { size: 0.7 },
		wait: 4000,
		size: [1400, 520],
		say: [{ id: 'sb', text: 'hehe', seconds: 8 }, { id: 'sd', text: 'Okay! I fixed the bug, and all the tests pass now. Want me to push it?', seconds: 8 }, { id: 'sf', text: 'coffee?', seconds: 8 }],
	},
	// The same, with the mouse on one: its hover lines in the plain font.
	speechHover: {
		sessions: [
			session('sa', 'blaube', 'working'),
			session('sb', 'kalkis', 'idle', { color: '#5B8DEF', info: { title: 'Fix the login bug', branch: 'main', model: 'claude-opus-5-5' } }),
			session('sc', 'website', 'working', { color: '#5FB57A', activity: 'tool' }),
			session('sd', 'notes', 'idle', { color: '#9B7BD8' }),
		],
		config: { size: 0.7 },
		wait: 4000,
		size: [1100, 520],
		hover: 'sb',
		say: [{ id: 'sd', text: 'All done! Want me to push it?', seconds: 8 }],
	},
	// Hovered while it works: its newest thinking (made-up fixture
	// transcripts, read by the app's own reader) in a thought bubble beside
	// its status bubble. A mother, her helper, a crowd with the hovered one
	// at the right edge (the bubble goes left), and one with no thinking
	// (what it's doing instead).
	thoughtMother: {
		sessions: [
			session('tm', 'blaube', 'working', { activity: 'tool', agents: [{ id: 'th', type: 'Explore', description: 'Find the buttermilk recipes', state: 'working', activity: 'tool' }] }),
			session('tn', 'kalkis', 'working', { color: '#5B8DEF', activity: 'tool' }),
		],
		config: { size: 0.8 },
		hover: 'tm', thinking: 'fixture', wait: 4500, size: [1200, 560],
	},
	thoughtHelper: {
		sessions: [
			session('tm', 'blaube', 'working', { activity: 'tool', agents: [{ id: 'th', type: 'Explore', description: 'Find the buttermilk recipes', state: 'working', activity: 'tool' }] }),
			session('tn', 'kalkis', 'working', { color: '#5B8DEF', activity: 'tool' }),
		],
		config: { size: 0.8 },
		hover: 'tm/th', thinking: 'fixture', wait: 4500, size: [1200, 560],
	},
	thoughtCrowd: {
		sessions: [
			session('tc1', 'website', 'working', { color: '#5FB57A', activity: 'tool' }),
			session('tc2', 'notes', 'idle', { color: '#9B7BD8' }),
			session('tc3', 'shop', 'working', { color: '#E07BA8' }),
			session('tc4', 'blaube', 'working', { activity: 'tool' }),
		],
		config: { size: 0.7 },
		hover: 'tc4', thinking: 'fixture', wait: 5000, size: [1100, 520],
	},
	thoughtDoing: {
		sessions: [session('td', 'blaube', 'working', { activity: 'tool' })],
		config: { size: 0.8 },
		hover: 'td', thinking: 'doing', wait: 3500, size: [900, 520],
	},
};
// The box where it opened, its slime carried round it (talk.box: the box's
// window; talk.hold: where the slime is held): the tail leaves from the
// edge facing it, all the way round. The last one is a box resized smaller.
const aroundTalk = (hold, box = { x: 300, y: 170, w: 600, h: 440 }) => ({ sessions: [session('ar', 'blaube', 'idle')], wait: 2500, size: [1200, 820], config: { seasons: 0 }, talk: { key: 'ar', box, hold, inbox: 'ready', log: [{ who: 'you', text: 'is it green?' }, { who: 'claude', text: 'All 66 tests pass.' }] } });
SCENES.talkAroundBelow = aroundTalk([600, 720]);
SCENES.talkAroundBelowRight = aroundTalk([1010, 700]);
SCENES.talkAroundLeft = aroundTalk([170, 400]);
SCENES.talkAroundRight = aroundTalk([1040, 330]);
SCENES.talkAroundAboveLeft = aroundTalk([200, 95]);
SCENES.talkAroundAbove = aroundTalk([560, 62]);
SCENES.talkAroundUnder = aroundTalk([600, 560]);
SCENES.talkResized = aroundTalk([860, 690], { x: 360, y: 200, w: 460, h: 380 });
SCENES.talkResizedBig = aroundTalk([140, 700], { x: 300, y: 40, w: 860, h: 640 });
// One box, its slime carried from near it to far off: the tail grows to a
// stubby wedge, then fades out once a full-length one can't reach.
[['Near', 775], ['Mid', 805], ['Reach', 820], ['Fading', 845], ['Far', 900]].forEach(([n, x]) => { SCENES['talkTail' + n + 'Away'] = aroundTalk([x, 390], { x: 60, y: 170, w: 600, h: 440 }); });
// Two pinned boxes: one moved off to the top left, far from its slime (no
// tail), one still near its own (its tail points at it).
SCENES.talkPinnedTwo = {
	sessions: [session('pa', 'blaube', 'idle'), session('pb', 'kalkis', 'idle', { color: '#5B8DEF' })], wait: 2500, size: [1400, 860], config: { seasons: 0 },
	talk: { key: 'pa', x: 1300, box: { x: 40, y: 30, w: 520, h: 420 }, pinned: true, inbox: 'ready', log: [{ who: 'you', text: 'is it green?' }, { who: 'claude', text: 'All 66 tests pass.' }],
		also: [{ key: 'pb', stand: [900, 700], box: { x: 640, y: 250, w: 520, h: 400 }, inbox: 'ready', log: [{ who: 'claude', text: 'Deployed to production.' }] }] },
};

// Dark mode: a long chat, a permission card, a question, a plan, and a
// busy session with its project panel open (no tails in dark mode).
const darkOf = (name) => Object.assign({}, SCENES[name], { talk: Object.assign({}, SCENES[name].talk, { dark: true }) });
for (const name of ['talkLong', 'talkAsk', 'talkQuestion', 'talkPlan', 'talkHarness', 'talkSteps', 'talkContext']) SCENES[name + 'Dark'] = darkOf(name);

// The overview: the talk box with every session at a glance.
// Find (⌘F) in a conversation with steps.
SCENES.talkFind = Object.assign({}, SCENES.talkSteps, { talkJs: `setTimeout(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true })); const f = document.getElementById('find'); f.value = 'test'; f.dispatchEvent(new Event('input')); }, 400)` });
SCENES.talkHarnessTop = Object.assign({}, SCENES.talkHarness, { talkJs: `setTimeout(() => { const b = [...document.querySelectorAll('button.step')].find((x) => /tests/.test(x.textContent)); if (b) b.click(); setTimeout(() => { document.getElementById('log').scrollTop = 0; }, 300); }, 400)` });
SCENES.talkHarnessOverview = Object.assign({}, SCENES.talkHarness, { talkJs: `setTimeout(() => document.getElementById('allSessions').click(), 400)`, talk: Object.assign({}, SCENES.talkHarness.talk, { today: 'Today: 14 replies · 2h 10m of work · 23 files changed', others: [{ id: 'hh', project: 'blaube', color: '#D97757', state: 'done', status: 'Done: Committed as f3a91c2.', meta: 'feature/ledges · 3 changed' }, { id: 'hh2', project: 'kalkis', color: '#5B8DEF', state: 'waiting', status: 'Needs you: Claude needs your permission to use Bash', meta: '62% of context used · main', ask: { key: 3, tool: 'Bash', detail: 'npm run deploy' } }, { id: 'hh3', project: 'website', color: '#E07BA8', state: 'working', status: 'Editing Hero.tsx · 4m', meta: '2 of 5 on its list · main · 7 changed' }] }) });
// The speech bubbles in each of the other fonts Settings offers.
for (const font of ['Concert One', 'DynaPuff', 'Rubik Spray Paint', 'System']) SCENES['speech' + font.replace(/ /g, '')] = Object.assign({}, SCENES.speech, { config: { size: 0.7, font } });
SCENES.talkOverview = Object.assign({}, SCENES.talkChat, { talkJs: `setTimeout(() => document.getElementById('allSessions').click(), 400)` });

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
		const giggled = await win.webContents.executeJavaScript(`(() => { const b = __blaube.buddies.get(${JSON.stringify(scene.rub)}); return b.giggles || 0; })()`);
		console.log(`check tickle: ${giggled ? `it giggled ${giggled}x ok` : 'no giggle -- silent'}`);
	}
	if (scene.later) {
		fire('state', { sessions: scene.later.sessions, settings: { hooksInstalled: true } });
		await sleep(scene.later.wait);
	}
	if (scene.command) {
		fire('command', scene.command);
		await sleep(scene.thenWait || 500);
	}
	if (scene.say) {
		for (const say of scene.say) fire('say', say);
		await sleep(700);
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
	const png = scene.talk ? await addTalk(win, scene, name) : (await win.webContents.capturePage()).toPNG();
	fs.writeFileSync(path.join(OUT, `${name}.png`), png);
	console.log('saved', path.join('shots', `${name}.png`));
}

// Draws the talk box over the scene, where the app would open it for a
// click on the slime named by talk.key, with the given conversation.
async function addTalk(win, scene, name) {
	const [w, h] = scene.size || [W, H];
	const t = scene.talk, sess = scene.sessions.find((x) => x.id === t.key) || scene.sessions[0];
	// (talk.x: stand the slime there first, to see the tail from the side)
	if (t.x) { await win.webContents.executeJavaScript(`(() => { const b = __blaube.buddies.get(${JSON.stringify(t.key)}); b.body.teleport(${t.x}, ${h - 44 - 90}); })()`); await sleep(1200); }
	const at = await win.webContents.executeJavaScript(`(() => {
		const b = __blaube.buddies.get(${JSON.stringify(t.key)}) || [...__blaube.buddies.values()][0];
		const c = b.body.centroid(), r = b.body.o.radius;
		return { x: c.x, y: Math.min(b.body.lookTop ?? Infinity, c.y - r), r };
	})()`);
	for (const o of t.also || []) if (o.stand) { await win.webContents.executeJavaScript(`__blaube.buddies.get(${JSON.stringify(o.key)}).body.teleport(${o.stand[0]}, ${o.stand[1]})`); }
	if (t.also) await sleep(2500);
	win.webContents.send('fire', 'talking', t.key);
	await sleep(100);
	const area = { x: 0, y: 0, width: w, height: h - 44 };
	const TW = t.box ? t.box.w : Math.min(TALK_W, w);
	let place = t.box ? { x: t.box.x, y: t.box.y, h: t.box.h, tail: { side: 'bottom', at: t.box.w / 2 } } : placeTalk(at, area, TW, 400, undefined, TALK_MIN_ABOVE);
	const tw = new BrowserWindow({ width: TW, height: 400, show: false, frame: false, transparent: true, webPreferences: { preload: path.join(ROOT, 'src', 'main', 'talkPreload.js'), contextIsolation: true, sandbox: true } });
	let wantH = 400;
	const onHeight = (e, _id, v) => { if (e.sender === tw.webContents) wantH = v; };
	ipcMain.on('talk-height', onHeight);
	ipcMain.removeHandler('talk-github-todo');
	ipcMain.handle('talk-github-todo', () => []);
	ipcMain.removeHandler('talk-hub');
	ipcMain.handle('talk-hub', () => ({ folders: [{ path: '/Users/me/Git/blaube', name: 'blaube' }, { path: '/Users/me/Git/kalkis', name: 'kalkis' }], past: [{ id: 'p1', title: 'Speed up the build', where: 'blaube · yesterday' }, { id: 'p2', title: 'Fix the login bug', where: 'kalkis · 3 days ago' }] }));
	ipcMain.removeHandler('talk-files-exist');
	ipcMain.handle('talk-files-exist', () => []);
	ipcMain.removeHandler('talk-paste');
	ipcMain.handle('talk-paste', () => '/tmp/blaube-pastes/pasted-1.png'); // (nothing is saved for a picture)
	tw.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('talk error:', e.message); });
	await tw.loadFile(path.join(ROOT, 'src', 'talk', 'talk.html'));
	tw.webContents.send('talk-state', Object.assign({ id: sess.id, project: sess.project, state: sess.state, color: sess.color || '#D97757', font: 'Coiny', connected: true, queued: 0, ask: null, asks: 0, tail: place.tail }, t));
	await sleep(500);
	if (scene.talkJs) { await tw.webContents.executeJavaScript(scene.talkJs); await sleep(900); }
	// The box hugs its content, like in the app (170-440 px, plus its tail).
	const th = Math.round(Math.max(TALK_MIN_H, Math.min(t.ask ? 900 : TALK_MAX_H, wantH)));
	if (!t.box) place = placeTalk(at, area, TW, th, undefined, TALK_MIN_ABOVE);
	tw.setContentSize(TW, place.h);
	tw.webContents.send('talk-tail', place.tail);
	await sleep(400);
	// It measures again for the side it ended up on (as in the app).
	if (!t.box) place = placeTalk(at, area, TW, Math.round(Math.max(TALK_MIN_H, Math.min(t.ask ? 900 : TALK_MAX_H, wantH))), place.tail.side, TALK_MIN_ABOVE);
	tw.setContentSize(TW, place.h);
	await sleep(400);
	ipcMain.removeListener('talk-height', onHeight);
	const fgImage = await tw.webContents.capturePage();
	const fg = fgImage.toDataURL();
	fs.writeFileSync(path.join(OUT, `${name}-box.png`), fgImage.toPNG()); // (the box by itself, too)
	tw.destroy();
	// More boxes open at once (talk.also: pinned ones, each at its box).
	const boxes = [{ id: t.key, x: place.x, y: place.y, w: TW, h: place.h, fg }];
	for (const o of t.also || []) {
		const os = scene.sessions.find((x) => x.id === o.key);
		const ow = new BrowserWindow({ width: o.box.w, height: o.box.h, show: false, frame: false, transparent: true, webPreferences: { preload: path.join(ROOT, 'src', 'main', 'talkPreload.js'), contextIsolation: true, sandbox: true } });
		ow.setContentSize(o.box.w, o.box.h);
		await ow.loadFile(path.join(ROOT, 'src', 'talk', 'talk.html'));
		ow.webContents.send('talk-state', Object.assign({ id: os.id, project: os.project, state: os.state, color: os.color || '#5B8DEF', font: 'Coiny', connected: true, queued: 0, ask: null, asks: 0, tail: { x: o.box.w / 2, y: o.box.h }, pinned: true }, o));
		await sleep(900);
		boxes.push({ id: o.key, x: o.box.x, y: o.box.y, w: o.box.w, h: o.box.h, fg: (await ow.webContents.capturePage()).toDataURL() });
		ow.destroy();
	}
	// The slime's layer draws each tail from under its bubble to its head.
	win.webContents.send('fire', 'talk-rect', boxes.map(({ id, x, y, w: bw, h: bh }) => ({ id, x, y, w: bw, h: bh, dark: !!t.dark })));
	await sleep(500); // (the tail grows out first)
	if (t.hold) {
		// Picks the slime up and carries it there (the page's own mouse handlers).
		await win.webContents.executeJavaScript(`(async () => {
			const B = __blaube, b = B.buddies.get(${JSON.stringify(t.key)}), raf = () => new Promise((r) => requestAnimationFrame(r));
			B.ownMouse = true;
			const c = b.body.centroid();
			B.input.down({ button: 0, clientX: c.x, clientY: c.y });
			for (let i = 1; i <= 40; i++) { B.input.move({ clientX: c.x + (${t.hold[0]} - c.x) * i / 40, clientY: c.y + (${t.hold[1]} - c.y) * i / 40 }); await raf(); }
			for (let i = 0; i < 50; i++) { B.input.move({ clientX: ${t.hold[0]}, clientY: ${t.hold[1]} }); await raf(); }
		})()`);
		const tail = await win.webContents.executeJavaScript('__blaube.talkTail()');
		console.log(`tail ${name}: ${tail ? `leaves at (${Math.round(tail.edge.x)}, ${Math.round(tail.edge.y)}), normal (${tail.nx.toFixed(2)}, ${tail.ny.toFixed(2)}), ${Math.round(tail.len)} px long` : 'none'}`);
	}
	// The renderer's CSP blocks data: images, so compose in a blank window.
	const bg = (await win.webContents.capturePage()).toDataURL();
	const cw = new BrowserWindow({ width: w, height: h, show: false });
	await cw.loadURL('about:blank');
	const png = await cw.webContents.executeJavaScript(`(async () => {
		const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
		const b = await load(${JSON.stringify(bg)});
		const k = b.width / ${w}, c = document.createElement('canvas');
		c.width = b.width; c.height = b.height;
		const g = c.getContext('2d');
		g.drawImage(b, 0, 0);
		for (const x of ${JSON.stringify(boxes)}) g.drawImage(await load(x.fg), x.x * k, x.y * k, x.w * k, x.h * k);
		return c.toDataURL('image/png');
	})()`);
	cw.destroy();
	return Buffer.from(png.split(',')[1], 'base64');
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
		win.webContents.send('fire', 'ledges', [{ id: 7, x0: x, x1: x + 420, y, wx: x, at: Date.now() }]);
		await js(`(() => { let d = document.getElementById('fakewin'); if (!d) { d = document.createElement('div'); d.id = 'fakewin'; document.body.prepend(d); } d.style.cssText = 'position:fixed;left:${x}px;top:${y}px;width:420px;height:400px;background:#3a3d44;border-top:28px solid #4a4e57;box-sizing:border-box;z-index:-1'; })()`);
	};
	if (m.flick) {
		await fakeWindow(250, 820);
		await js(`[...__blaube.buddies.values()][0].body.teleport(450, 650)`);
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
				// Like a hand: speeds up, keeps going, then eases off and stops.
				const steps = [3, 6, 9, 12, 16, 20, 24, 28, 30, 30, 30, 30, 30, 30, 18, 6];
				const gaps = [], marks = [];
				let y = 820;
				for (const step of steps) {
					y -= step;
					await fakeWindow(250, y);
					marks.push({ y, t: Date.now() });
					await sleep(16);
					if (step >= 30) gaps.push(await js('(() => { const b = [...__blaube.buddies.values()][0], l = b.body.onLedge; return l ? l.y - b.body.bbox().maxY : null; })()'));
				}
				let run = 0, lost = false;
				for (const g of gaps) { run = g === null ? run + 1 : 0; if (run >= 3) lost = true; }
				const worst = Math.max(...gaps.filter((g) => g !== null).map(Math.abs));
				console.log(`check ride: biggest gap between slime and window top while dragged ${worst.toFixed(1)} px${lost ? ', and it got left behind' : ''}${worst > 8 || lost ? ' -- not following smoothly' : ' ok'}`);
				// The toss: how high it flies above the window, against a slime
				// thrown by hand as fast as the window was going (same gravity and
				// air damping as the physics).
				let top = Infinity;
				for (let k = 0; k < 60; k++) { top = Math.min(top, await js('[...__blaube.buddies.values()][0].body.bbox().maxY')); await sleep(16); }
				const fast = marks.filter((_, k) => steps[k] === 30);
				const speed = (fast[0].y - fast[fast.length - 1].y) / ((fast[fast.length - 1].t - fast[0].t) / 1000);
				let ball = 0;
				for (let v = speed / 120, h = 0; v > 0; v = v * 0.994 - 1950 / 14400) { h += v; ball = h; }
				const rise = y - top;
				console.log(`check toss: window going ${Math.round(speed)} px/s up, slime flew ${rise.toFixed(0)} px above it; thrown by hand that fast it would rise ${ball.toFixed(0)} px${rise < ball * 0.6 ? ' -- braked' : ' ok'}`);
			}
			if (m.flick && i === 18) await fakeWindow(800, 500);
			if (m.ledge && i === 8) await js(`(() => { const b = [...__blaube.buddies.values()][1]; b.body.teleport(420, 420); b.body.impulse(0, -1200, 1 / 120); })()`);
			if (m.ledge && i >= 18 && i <= 22) await fakeWindow(120 + (i - 17) * 40, 300 - (i - 17) * 12);
			if (m.commandAt && m.commandAt[i]) win.webContents.send('fire', 'command', m.commandAt[i]);
			// Two slimes stood apart, and the left one going as a ghost.
			if (m.jsAt && m.jsAt[i] === 'teleport') await js(`(() => { const l = [...__blaube.buddies.values()]; l[0].body.teleport(220, 300); l[1].body.teleport(760, 300); })()`);
			if (m.jsAt && m.jsAt[i] === 'ghost') await js(`(() => { const l = [...__blaube.buddies.values()]; __blaube.ghost(l[0], l[1]); })()`);
			if (m.mouseAt && m.mouseAt[i]) {
				// The cursor, so many radii from the slime's middle.
				const [dx, dy] = m.mouseAt[i];
				const at = await js(`(() => { const b = [...__blaube.buddies.values()][0], c = b.body.centroid(); return { x: c.x, y: c.y, r: b.body.o.radius }; })()`);
				mouse('mouseMove', at.x + dx * at.r, at.y + dy * at.r);
			}
			if (m.grabAt && m.grabAt[i]) {
				const at = await js(`__blaube.buddies.get(${JSON.stringify(m.grabAt[i])}).body.centroid()`);
				mouse('mouseMove', at.x, at.y);
				mouse('mouseDown', at.x, at.y);
				m.held = at;
			}
			if (m.held && i < m.releaseAt && !(m.grabAt && m.grabAt[i])) { m.held.y -= 12; mouse('mouseMove', m.held.x, m.held.y); }
			if (m.held && i === m.releaseAt) { mouse('mouseUp', m.held.x, m.held.y); m.held = null; }
			if (m.sayAt && m.sayAt[i]) for (const say of [].concat(m.sayAt[i])) win.webContents.send('fire', 'say', say);
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
	// (each frame by itself, too, to look at closely)
	frames.forEach((src, i) => fs.writeFileSync(path.join(OUT, `${name}-${String(i + 1).padStart(2, '0')}.png`), Buffer.from(src.split(',')[1], 'base64')));
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
	win.webContents.setAudioMuted(true); // they babble; not out loud here
	win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('page error:', e.message); });
	// A hovered slime's thinking, from the fixture transcripts (scene.thinking).
	const thinking = require(path.join(ROOT, 'src', 'main', 'thinking.js'));
	const FIX = path.join(ROOT, 'test', 'fixtures', 'thinking', 'fixture-session.jsonl');
	let scene = null;
	ipcMain.handle('thinking', async (_e, key) => {
		if (!scene || !scene.thinking) return { text: '', doing: '' };
		if (scene.thinking === 'doing') return { text: '', doing: 'Reading pancakes.md' };
		const helper = String(key).includes('/');
		return { text: await thinking.thinkingOf(helper ? thinking.helperFile(FIX, 'fixture-helper') : FIX, !helper), doing: 'Running npm test' };
	});
	const wanted = process.argv.slice(2).filter((a) => SCENES[a]);
	for (const name of wanted.length ? wanted : Object.keys(SCENES)) { scene = SCENES[name]; await shoot(win, name, scene); }
	app.quit();
});
