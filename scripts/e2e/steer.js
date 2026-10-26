// End-to-end check of steering a session from its talk box while it works,
// in the real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/steer.js BLAUBE_PORT=47873 npx electron .
//
// Fakes two sessions through the hook server and runs the same tool hook
// command Claude Code would (the one that reads Blaube's answer), so what
// Claude would be told comes back for real: the steps it takes, a message
// sent mid-turn, Stop, a slash command, its to-do list, and the overview of
// every session. Saves pictures to shots/steer-*.png. Exits non-zero on a
// failure.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { clipboard } = require('electron');
const { toolHookCommand } = require('../../src/main/claudeHooks');

const OUT = path.join(__dirname, '..', '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run({ win, inbox, PORT, talk, talkId }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	const page = (js) => win.webContents.executeJavaScript(js);
	const box = (js) => talk().webContents.executeJavaScript(js);
	const ID = 'steer-' + Date.now(), ID2 = ID + '-b';
	const hook = (payload) => new Promise((done) => {
		const req = http.request({ host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli' } }, (res) => { res.resume(); res.on('end', done); });
		req.end(JSON.stringify(Object.assign({ session_id: ID, cwd: '/tmp/kalkis' }, payload)));
	});
	// A tool event the way Claude Code sends it: through the hook command,
	// whose output is what Claude reads.
	const tool = (payload) => new Promise((done) => {
		const p = spawn('sh', ['-c', toolHookCommand(PORT)], { env: Object.assign({}, process.env, { CLAUDE_CODE_ENTRYPOINT: 'cli' }) });
		let out = '';
		p.stdout.on('data', (d) => { out += d; });
		p.on('exit', (code) => { let json = null; try { json = out ? JSON.parse(out) : null; } catch { /* checked by the caller */ } done({ code, out, json }); });
		p.stdin.end(JSON.stringify(Object.assign({ session_id: ID, cwd: '/tmp/kalkis' }, payload)));
	});
	const type = (text) => box(`(() => { const t = document.getElementById('text'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input')); document.getElementById('form').requestSubmit(); })()`);
	const texts = () => box(`[...document.querySelectorAll('#inner .msg, #inner .note')].map((e) => e.dataset.text != null ? e.dataset.text : e.textContent)`);
	const shot = async (name) => {
		const img = await talk().webContents.capturePage();
		fs.mkdirSync(OUT, { recursive: true });
		fs.writeFileSync(path.join(OUT, `steer-${name}.png`), img.toPNG());
	};
	const key = (k, mod = {}) => box(`document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }, ${JSON.stringify(mod)})))`);
	const mod = process.platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };

	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);

	// A session at work: its first steps.
	await hook({ hook_event_name: 'SessionStart' });
	await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'add the 2027 tax brackets' });
	const pre = await tool({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/tmp/kalkis/src/tax.js' } });
	check(pre.code === 0 && !pre.out, 'an ordinary step goes ahead (nothing said back)');
	await tool({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/tmp/kalkis/src/tax.js' }, tool_response: { file: { content: 'export const brackets = [];' } } });
	await tool({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [
		{ content: 'Add the 2027 brackets', activeForm: 'Adding the 2027 brackets', status: 'in_progress' },
		{ content: 'Update the tests', activeForm: 'Updating the tests', status: 'pending' },
	] } });
	check(await until(async () => !!(await page(`!!__blaube.buddies.get(${JSON.stringify(ID)})`)), 6000), 'its slime appears');
	await page(`window.blaube.talk(${JSON.stringify(ID)}, { x: 300, y: 600, r: 60 })`);
	check(await until(() => talk() && talk().isVisible() && talkId() === ID), 'its talk box opens');
	await sleep(400);

	check(await until(() => box(`[...document.querySelectorAll('#inner .step')].some((e) => /tax\.js/.test(e.textContent))`)), 'the box shows the step it took (reading tax.js)');
	check(await box(`!document.getElementById('todo').hidden && document.getElementById('todoCount').textContent === '0 of 2'`), 'and its to-do list (0 of 2)');
	check(await box(`/Adding the 2027 brackets/.test(document.getElementById('todoNow').textContent)`), 'with what it’s on now');
	check(await until(() => box(`!document.getElementById('stop').hidden`)), 'a Stop button while it works');
	check(await box(`document.getElementById('text').placeholder === 'Add something…'`), 'and the field says you can add something now');
	check(await box(`!/Connect Claude Code/.test(document.getElementById('hint').textContent)`), 'a session whose steps reach Blaube isn’t told to connect');

	// Tapping a step shows what it did.
	await tool({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/tmp/kalkis/src/tax.js', old_string: 'export const brackets = [];', new_string: 'export const brackets = [2027];' }, tool_response: {} });
	check(await until(() => box(`[...document.querySelectorAll('#inner .step.opens')].some((e) => /tax\.js/.test(e.textContent) && /Edit/.test(e.textContent))`)), 'an edit shows as a step you can open');
	await box(`[...document.querySelectorAll('#inner .step.opens')].pop().click()`);
	check(await until(() => box(`[...document.querySelectorAll('#inner .stepout')].some((e) => !e.hidden && /2027/.test(e.textContent))`)), 'tapping it shows the change');
	await shot('steps');

	// A message mid-turn: it goes in with the next step's result.
	await type('also do 2028 while you’re at it');
	check(await until(() => inbox.view(ID).queued === 1), 'a message sent while it works waits for its next step');
	check(await box(`document.querySelectorAll('#inner .msg.you.queued').length === 1`), 'shown as waiting');
	const read = await tool({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: '12 passing', stderr: '' } });
	const ctx = read.json && read.json.hookSpecificOutput;
	check(ctx && ctx.hookEventName === 'PostToolUse' && /2028/.test(ctx.additionalContext || ''), 'Claude gets it with that step’s result');
	check(inbox.view(ID).queued === 0, 'and it isn’t waiting any more');
	check(await until(() => box(`document.querySelectorAll('#inner .msg.you.queued').length === 0`)), 'the box shows it went in');
	const again = await tool({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/tmp/kalkis/README.md' }, tool_response: {} });
	check(!again.out, 'only once');
	const sub = (() => { inbox.send(ID, 'a note for the main thread'); return tool({ hook_event_name: 'PostToolUse', agent_id: 'sub-1', tool_name: 'Read', tool_input: { file_path: '/tmp/x' }, tool_response: {} }); })();
	check(!(await sub).out, 'a subagent’s step doesn’t take a message meant for the main thread');
	for (const e of inbox.queue.get(ID) || []) inbox.unsend(ID, e.n);

	// A slash command is for Claude Code, not Claude: never sent as a message.
	await type('/compact');
	await sleep(400);
	check(inbox.view(ID).queued === 0, '/compact isn’t sent to Claude as a message');
	check((await texts()).some((t) => /\/compact/.test(t) && /clipboard/.test(t)), 'where Blaube can’t type it in, the box says it’s on the clipboard');
	const clip = await clipboard.readText();
	check(clip === '/compact', `and it is (${JSON.stringify(clip)})`);
	await type('/api returns 500 on the brackets page');
	check(await until(() => inbox.view(ID).queued === 1), 'a message that just starts with a path is a message');
	for (const e of inbox.queue.get(ID) || []) inbox.unsend(ID, e.n);

	// Stop: it stops before its next step, and says where it got to.
	await box(`document.getElementById('stop').click()`);
	check(await until(() => box(`document.getElementById('stop').disabled && /Stopping/.test(document.getElementById('stop').textContent)`)), 'Stop says it’s stopping');
	check((await texts()).includes('You asked it to stop'), 'and the log notes it');
	const next = await tool({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push' } });
	const deny = next.json && next.json.hookSpecificOutput;
	check(deny && deny.permissionDecision === 'deny' && /Stop/.test(deny.permissionDecisionReason), 'its next step is refused, telling it to stop');
	const after = await tool({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/tmp/x' }, tool_response: {} });
	check(!after.out, 'nothing else is slipped in while it stops');
	await shot('stopping');
	await hook({ hook_event_name: 'Stop', last_assistant_message: 'Stopped. The 2027 brackets are in; 2028 isn’t started.' });
	check(await until(() => box(`document.getElementById('stop').hidden`)), 'when it finishes, the Stop button goes');
	const fresh = await tool({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/tmp/x' } });
	check(!fresh.out, 'and the next turn isn’t stopped');
	check(await until(() => box(`(() => { const t = [...document.querySelectorAll('#inner .turnmeta')].pop(); return !!t && /step/.test(t.textContent) && /tax\\.js/.test(t.textContent); })()`)), 'the reply says how many steps it took and which files changed');
	await shot('stopped');

	// The overview: every session, and a tap goes to one.
	await hook({ session_id: ID2, cwd: '/tmp/website', hook_event_name: 'SessionStart' });
	await hook({ session_id: ID2, cwd: '/tmp/website', hook_event_name: 'UserPromptSubmit', prompt: 'fix the footer' });
	await until(async () => !!(await page(`!!__blaube.buddies.get(${JSON.stringify(ID2)})`)), 6000);
	check(await until(() => box(`document.querySelectorAll('#others .dot, #others button:not(.all)').length >= 1`)), 'the other session shows in the header');
	await key('0', mod);
	check(await until(() => box(`document.body.classList.contains('overview')`)), '⌘0 opens the overview');
	check(await until(() => box(`[...document.querySelectorAll('#overview .row:not(.past)')].map((r) => r.querySelector('b').textContent).join(',')`).then((t) => /kalkis/.test(t) && /website/.test(t))), 'with a row for each session');
	check(await box(`/Today/.test((document.querySelector('#overview .today') || {}).textContent || '')`), 'and the day so far');
	await shot('overview');
	await box(`[...document.querySelectorAll('#overview .row:not(.past)')].find((r) => /website/.test(r.textContent)).click()`);
	check(await until(() => talkId() === ID2), 'tapping a row goes to that session');
	check(await until(() => box(`!document.body.classList.contains('overview')`)), 'back in the chat');
	await key('[', mod);
	check(await until(() => talkId() === ID), '⌘[ goes to the one before');

	await hook({ session_id: ID2, hook_event_name: 'SessionEnd' });
	await hook({ hook_event_name: 'SessionEnd' });
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
