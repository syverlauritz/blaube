// End-to-end check of the slimes themselves, with no Claude Code and no
// tokens: sessions are driven through fake hooks, and it checks the bodies
// stay healthy, a turn's end is said out loud once (not twice, cut off),
// and stopping the choir leaves no mouth still miming the song.
//
//   npm run e2e:life
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function run({ win, tracker }) {
	let failed = 0; const errs = [];
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	win.webContents.on('console-message', (e) => { if (e.level === 'error') errs.push(e.message); });
	const js = (s) => win.webContents.executeJavaScript(s);
	while (win.webContents.isLoading()) await sleep(100);
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
	check(errs.length === 0, 'no renderer errors ' + errs.slice(0, 3).join(' | '));
	return failed ? 1 : 0;
};
