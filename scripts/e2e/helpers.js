// Helpers whose SubagentStop never reaches Blaube still go home: within the
// periodic check (helperCheck.js), going by their own transcripts, while
// one that's really at work stays out. The talk box lists the same helpers
// whose slimes are out, her turn over or not:
//
//   BLAUBE_TEST=scripts/e2e/helpers.js BLAUBE_PORT=47951 npx electron .
//
// Exits non-zero on a failure.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function run({ win, tracker, talk, talkId }) {
	let failed = 0; const errs = [];
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	win.webContents.on('console-message', (e) => { if (e.level === 'error') errs.push(e.message); });
	const js = (s) => win.webContents.executeJavaScript(s);
	const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false);
	await sleep(1000);

	// A made-up session folder, as Claude Code keeps one.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-helpers-'));
	const id = 'hh' + Date.now();
	const transcript = path.join(dir, `${id}.jsonl`);
	const subs = path.join(dir, id, 'subagents');
	fs.mkdirSync(subs, { recursive: true });
	fs.writeFileSync(transcript, '');
	const write = (aid, last, ago) => {
		const f = path.join(subs, `agent-${aid}.jsonl`), at = Date.now() - ago;
		fs.writeFileSync(path.join(subs, `agent-${aid}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: `Helper ${aid}`, requestShape: 'background' }));
		fs.writeFileSync(f, JSON.stringify(Object.assign({ timestamp: new Date(at).toISOString() }, last)) + '\n');
		fs.utimesSync(f, at / 1000, at / 1000);
	};
	const ended = { type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } };
	const tool = { type: 'assistant', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'npm test' } }] } };

	const ev = (hook_event_name, extra = {}) => tracker.handle({ session_id: id, cwd: path.join(dir, 'proj'), transcript_path: transcript, hook_event_name, ...extra });
	ev('SessionStart');
	ev('UserPromptSubmit', { prompt: 'go' });
	ev('SubagentStart', { agent_id: 'hstale', agent_type: 'general-purpose' });
	ev('SubagentStart', { agent_id: 'hlive', agent_type: 'general-purpose' });
	ev('Stop'); // (her turn's over; they were sent off in the background)
	write('hstale', ended, 3 * 60e3); // ended its turn minutes ago; its stop never came
	tracker.sessions.get(id).agents.find((a) => a.id === 'hstale').updatedAt = Date.now() - 4 * 60e3; // (its last hook, before that)
	write('hlive', tool, 0); // running its tests right now
	const kids = () => js(`[...__blaube.buddies.values()].filter((b) => b.kind === 'child' && !b.merging && !b.dying).map((b) => b.key.split('/')[1]).sort().join()`);
	check(await until(async () => (await kids()) === 'hlive,hstale', 6000), 'both helpers split off');

	// The talk box lists them though her turn is over.
	await js(`window.blaube.talk(${JSON.stringify(id)}, { x: 300, y: 600, r: 60 })`);
	check(await until(() => talk() && talk().isVisible() && talkId() === id, 8000), 'her talk box opens');
	const listed = () => talk().webContents.executeJavaScript(`[...document.querySelectorAll('.helpers li b')].map((b) => b.textContent).sort().join()`);
	check(await until(async () => (await listed()) === 'Helper hlive,Helper hstale', 4000), `her box lists both helpers while she's done (${await listed()})`);

	// No SubagentStop for the stale one: the periodic check sends it home.
	const t0 = Date.now();
	const stay = setInterval(() => write('hlive', tool, 0), 2000);
	const went = await until(async () => (await kids()) === 'hlive', 35000);
	check(went, `the stale helper heads home by itself (after ${((Date.now() - t0) / 1000).toFixed(1)} s, within the 20 s check and its trip home)`);
	check(await until(() => js(`![...__blaube.buddies.keys()].includes(${JSON.stringify(id + '/hstale')})`), 30000), 'and goes into her');
	check(tracker.sessions.get(id).agents.map((a) => a.id).join() === 'hlive', 'the running one is still tracked');
	check(await until(async () => (await listed()) === 'Helper hlive', 4000), `her box agrees: only the running one (${await listed()})`);
	// A straggling hook from the stale one doesn't bring it back.
	ev('PostToolUse', { agent_id: 'hstale', tool_name: 'Read' });
	ev('PreToolUse', { tool_name: 'Bash', cwd: path.join(dir, 'proj', '.claude', 'worktrees', 'agent-hstale') });
	await sleep(500);
	check(!tracker.sessions.get(id).agents.some((a) => a.id === 'hstale'), 'stragglers don’t bring it back');

	// Another check later: the running one is still out.
	await sleep(22000);
	check((await kids()) === 'hlive', 'a helper really at work stays out through the next check');
	clearInterval(stay);

	// Claude Code tells her it's done (no SubagentStop again): home too.
	fs.appendFileSync(transcript, JSON.stringify({ type: 'user', timestamp: new Date(Date.now() + 3000).toISOString(), message: { role: 'user', content: '<task-notification>\n<task-id>hlive</task-id>\n<status>completed</status>\n<summary>Agent "Helper hlive" finished</summary>\n</task-notification>' } }) + '\n');
	check(await until(async () => (await kids()) === '' && !tracker.sessions.get(id).agents.length, 35000), 'once she\'s told it finished, it heads home too');
	check(await until(async () => (await listed()) === '', 4000), 'and her box lists no helpers');
	check(errs.length === 0, `no errors (${errs.slice(0, 3).join(' | ')})`);
	try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
	return failed ? 1 : 0;
};
