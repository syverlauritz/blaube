// End-to-end check of the slimes themselves, with no Claude Code and no
// tokens: sessions are driven through fake hooks, and it checks the bodies
// stay healthy, a turn's end is said out loud once (not twice, cut off),
// and stopping the choir leaves no mouth still miming the song.
//
//   npm run e2e:life
//
// (Headless on Linux: xvfb-run electron --no-sandbox --disable-gpu-vsync
// --disable-frame-rate-limit ., or the invisible window gets almost no
// frames and nothing moves.)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function run({ win, tracker }) {
	let failed = 0; const errs = [];
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	win.webContents.on('console-message', (e) => { if (e.level === 'error') errs.push(e.message); });
	const js = (s) => win.webContents.executeJavaScript(s);
	const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false); // invisible, it would otherwise get no frames and nothing would move
	await sleep(1000);
	const ev = (id, hook_event_name, extra = {}) => tracker.handle({ session_id: id, cwd: '/tmp/p-' + id, hook_event_name, ...extra });
	ev('s1', 'SessionStart'); ev('s2', 'SessionStart');
	ev('s1', 'UserPromptSubmit'); ev('s1', 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
	ev('s1', 'SubagentStart', { agent_id: 'h1', agent_type: 'Explore' });
	await sleep(3000);
	check(await js(`__blaube.buddies.has('s1') && __blaube.buddies.has('s2')`), 'two session slimes');
	check(await js(`[...__blaube.buddies.values()].every((b) => [...b.body.px].every(Number.isFinite))`), 'bodies finite');
	// Turn end: Done status and reply arrive together; it should say one line.
	await js(`window.__said = []`);
	ev('s1', 'Stop', { last_assistant_message: 'All tests pass now.' });
	await sleep(30);
	win.webContents.send('say', { id: 's1', text: 'All tests pass now.', seconds: 7 });
	await sleep(300);
	const at1 = await js(`(__blaube.buddies.get('s1').speech || {}).at`);
	await sleep(200);
	win.webContents.send('say', { id: 's1', text: 'All tests pass now.', voiceOnly: true });
	await sleep(100);
	const at2 = await js(`(__blaube.buddies.get('s1').speech || {}).at`);
	check(at1 !== undefined && at1 === at2, `turn line said once (${at1} vs ${at2})`);
	// Choir: start then stop; nobody keeps miming.
	win.webContents.send('command', 'choir:' + (await js(`BlaubeSongs.SONGS[0].id`)));
	await sleep(1500);
	check(await js(`[...__blaube.buddies.values()].some((b) => b.singing)`), 'choir sings');
	win.webContents.send('command', 'choir-stop');
	await sleep(200);
	check(await js(`[...__blaube.buddies.values()].every((b) => !b.singing && !b.speech)`), 'after stop nobody mimes the song');
	await sleep(2000);
	check(await js(`[...__blaube.buddies.values()].every((b) => [...b.body.px].every(Number.isFinite))`), 'still finite');
	// Thrown hard at the wall, s2 splats there for a moment, then drops.
	await js(`(() => { const b = __blaube.buddies.get('s2').body; b.impulse(4000, -300, 1 / 120); })()`);
	let stuck = false;
	for (let i = 0; i < 30 && !stuck; i++) { await sleep(30); stuck = await js(`!!__blaube.buddies.get('s2').splat`); }
	check(stuck, 'a hard throw splats against the wall');
	await sleep(2500);
	check(await js(`!__blaube.buddies.get('s2').splat && __blaube.buddies.get('s2').body.onFloor()`), 'and peels off back to the floor');
	const b1 = `__blaube.buddies.get('s1')`;
	await until(() => js(`${b1}.body.onFloor() && !${b1}.body.grab`));
	// A hop starts with a crouch, then goes off.
	await js(`${b1}.hop(0, -600)`);
	check(await js(`!!${b1}.pendingHop`), 'a hop starts with a crouch');
	check(await until(() => js(`!${b1}.pendingHop && !${b1}.body.onFloor()`), 1500), 'then it takes off');
	await until(() => js(`${b1}.body.onFloor()`), 4000);
	await sleep(800);
	// Held up still, it wriggles; shaken, it gets dizzy.
	await js(`(() => { const b = ${b1}.body, c = b.centroid(); b.startGrab(c.x, c.y - 20); b.moveGrab(c.x, c.y - 200); window.__hold = { x: c.x, y: c.y - 200 }; })()`);
	check(await until(() => js(`!!${b1}.wriggling`), 5000), 'held still, it wriggles');
	for (let i = 0; i < 14; i++) { await js(`${b1}.body.moveGrab(__hold.x + ${i % 2 ? 160 : -160}, __hold.y)`); await sleep(70); }
	check(await js(`${b1}.dizzyUntil > __blaube.now()`), 'shaken, it gets dizzy');
	await js(`${b1}.body.endGrab()`);
	await sleep(1500);
	// A failed test run lets some air out.
	win.webContents.send('react', { id: 's1', kind: 'testfail' });
	check(await until(() => js(`${b1}.droop > 0.3`), 3000), 'a failed test makes it droop');
	check(await js(`[...__blaube.buddies.values()].every((b) => [...b.body.px].every(Number.isFinite))`), 'bodies still finite after all that');
	check(errs.length === 0, 'no renderer errors ' + errs.slice(0, 3).join(' | '));
	return failed ? 1 : 0;
};
