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
const { toolHookCommand, permissionCommand } = require('../../src/main/claudeHooks');

const OUT = path.join(__dirname, '..', '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run({ win, inbox, PORT, talk, talkId, tracker }) {
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

	// A helper it sends off shows under the dots, with what it's on.
	await hook({ hook_event_name: 'SubagentStart', agent_id: 'h1', agent_type: 'Explore' });
	await tool({ hook_event_name: 'PreToolUse', agent_id: 'h1', agent_type: 'Explore', tool_name: 'Grep', tool_input: { pattern: 'brackets' } });
	check(await until(() => box(`[...document.querySelectorAll('#inner .dots .helpers li')].some((li) => /Explore/.test(li.textContent) && /brackets/.test(li.textContent))`)), 'a helper it sent off shows under the dots, with what it’s on');
	await shot('helpers');
	await hook({ hook_event_name: 'SubagentStop', agent_id: 'h1' });
	check(await until(() => box(`document.querySelectorAll('#inner .dots .helpers li').length === 0`)), 'and goes when it’s done');

	// Something it left running shows, with a Stop that asks Claude to end it.
	await hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu1', tool_input: { command: 'npm run dev', description: 'Dev server', run_in_background: true }, tool_response: { backgroundTaskId: 'bash_7' } });
	check(await until(() => box(`!document.getElementById('bg').hidden && /Dev server/.test(document.getElementById('bg').textContent)`)), 'a background task it started shows in the box');
	check(await box(`[...document.querySelectorAll('#bg button')].map((b) => b.textContent).join()`) === 'Output,Stop', 'with Output and Stop');
	// Its Output, read from Claude Code's own file for it: no asking Claude.
	const tmpRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'blaube-cc-tmp-'));
	process.env.CLAUDE_CODE_TMPDIR = tmpRoot;
	const outDir = path.join(tmpRoot, `claude-${process.getuid ? process.getuid() : 0}`, '-tmp-kalkis', ID, 'tasks');
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(path.join(outDir, 'bash_7.output'), '\x1b[32m  VITE ready\x1b[0m on http://localhost:5173\n');
	const queuedBefore = (inbox.queue.get(ID) || []).length;
	await box(`[...document.querySelectorAll('#bg button')].find((b) => b.textContent === 'Output').click()`);
	check(await until(() => box(`(() => { const o = document.querySelector('#bg .bgout'); return !!o && !o.hidden && /VITE ready on http:\\/\\/localhost:5173/.test(o.textContent) && !/\\x1b/.test(o.textContent); })()`)), 'Output shows what a background task printed, read from its file');
	check((inbox.queue.get(ID) || []).length === queuedBefore, 'without asking Claude');
	global.__blaubeCheckTasks();
	check(await until(() => box(`[...document.querySelectorAll('#bg li')].some((li) => /Dev server/.test(li.textContent) && [...li.querySelectorAll('button')].some((b) => b.textContent === 'Open' && b.title === 'http://localhost:5173'))`)), 'a dev server gets Open, for where it says it’s on');
	await key('0', mod);
	check(await until(() => box(`[...document.querySelectorAll('#overview .rowlink')].some((r) => r.textContent === 'Dev server · localhost:5173Open')`)), 'and the overview has it too, to open from there');
	await key('0', mod);
	await until(() => box(`!document.body.classList.contains('overview')`));
	fs.appendFileSync(path.join(outDir, 'bash_7.output'), 'GET / 500\n');
	check(await until(() => box(`(() => { const o = document.querySelector('#bg .bgout'); return /GET \\/ 500$/.test(o.textContent); })()`)), 'and keeps up with it while open');
	await box(`[...document.querySelectorAll('#bg button')].find((b) => b.textContent === 'Output').click()`);
	check(await until(() => box(`document.querySelector('#bg .bgout').hidden`)), 'a second tap hides it');
	// One that crashes leaves the list, and says so with its last line.
	await hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu2', tool_input: { command: 'npm run watch', description: 'Watcher', run_in_background: true }, tool_response: { backgroundTaskId: 'bash_8' } });
	await until(() => box(`/Watcher/.test(document.getElementById('bg').textContent)`));
	fs.writeFileSync(path.join(outDir, 'bash_8.output'), 'watching…\nError: Cannot find module \'chokidar\'\n\n[exited with code 1]\n');
	global.__blaubeCheckTasks();
	check(await until(() => box(`!/Watcher/.test(document.getElementById('bg').textContent) && /Dev server/.test(document.getElementById('bg').textContent)`)), 'a background task that crashed leaves the list');
	check(await until(() => box(`[...document.querySelectorAll('#inner .note.error')].some((e) => e.textContent === "Watcher stopped with an error (code 1): Error: Cannot find module 'chokidar'")`)), 'and its box says so, with its last line');
	// In a terminal's session, Stop ends the task itself: what writes to its
	// output, as long as it runs under that session's claude process.
	await hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu3', tool_input: { command: 'npm run serve', description: 'Server', run_in_background: true }, tool_response: { backgroundTaskId: 'bash_9' } });
	await until(() => box(`/Server/.test(document.getElementById('bg').textContent)`));
	const out9 = fs.openSync(path.join(outDir, 'bash_9.output'), 'w');
	const server = spawn('sh', ['-c', 'echo listening; sleep 60'], { stdio: ['ignore', out9, 'ignore'] });
	fs.closeSync(out9);
	tracker.sessions.get(ID).pid = process.pid; // (its claude process: here, the app)
	await sleep(300);
	const queued9 = (inbox.queue.get(ID) || []).length;
	await box(`[...document.querySelectorAll('#bg li')].find((li) => /Server/.test(li.textContent)).querySelector('button:last-of-type').click()`);
	check(await until(() => server.exitCode !== null || server.signalCode !== null), 'in a terminal’s session, Stop ends a background task itself');
	check(await until(() => box(`!/Server/.test(document.getElementById('bg').textContent)`)) && inbox.log(ID).some((e) => e.text === 'Stopped Server') && (inbox.queue.get(ID) || []).length === queued9, 'without asking Claude, and says so');
	tracker.sessions.get(ID).pid = 0;
	delete process.env.CLAUDE_CODE_TMPDIR;
	fs.rmSync(tmpRoot, { recursive: true, force: true });
	await box(`[...document.querySelectorAll('#bg button')].find((b) => b.textContent === 'Stop').click()`);
	check(await until(() => (inbox.queue.get(ID) || []).some((e) => /Stop the background task .Dev server. \(id bash_7/.test(e.text))), 'its Stop asks Claude to stop it');
	for (const e of inbox.queue.get(ID) || []) inbox.unsend(ID, e.n);
	await hook({ hook_event_name: 'PreToolUse', tool_name: 'KillShell', tool_input: { shell_id: 'bash_7' } });
	check(await until(() => box(`document.getElementById('bg').hidden`)), 'and it goes once Claude stops it');

	// Asked whether it may edit a file: the card shows the change, tinted.
	const asking = spawn('sh', ['-c', permissionCommand(PORT)], { env: Object.assign({}, process.env, { CLAUDE_CODE_ENTRYPOINT: 'cli' }) });
	asking.stdin.end(JSON.stringify({ session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'Edit', tool_input: { file_path: '/tmp/kalkis/src/tax.js', old_string: 'rate = 0.22', new_string: 'rate = 0.23' } }));
	check(await until(() => box(`(() => { const d = document.getElementById('askDetail'); return !document.getElementById('ask').hidden && !!d.querySelector('.del') && /0\\.23/.test(d.querySelector('.add').textContent); })()`)), 'a permission card for an edit shows the change, tinted');
	let askOut = '';
	asking.stdout.on('data', (d) => { askOut += d; });
	await sleep(600);
	// Typing while it asks means "no, and do this instead", as in the terminal.
	await box(`(() => { const t = document.getElementById('text'); t.value = 'make it 0.25'; t.dispatchEvent(new Event('input')); })()`);
	check(await until(async () => (await box(`document.getElementById('deny').textContent`)) === 'Deny and say'), 'typing on a permission card turns Deny into Deny and say');
	await box(`document.getElementById('form').requestSubmit()`);
	await new Promise((r) => { asking.on('exit', r); setTimeout(r, 3000); });
	let said = null;
	try { said = JSON.parse(askOut).hookSpecificOutput.decision; } catch { /* checked below */ }
	check(said && said.behavior === 'deny' && /make it 0\.25/.test(said.message), 'Enter denies it with what to do instead');
	check(await until(() => box(`[...document.querySelectorAll('#inner .note')].some((e) => /Denied Edit[\\s\\S]*make it 0\.25/.test(e.textContent))`)), 'and the box notes what you said');
	check(!(inbox.queue.get(ID) || []).length, 'without also queueing it as a message');
	await until(() => box(`document.getElementById('ask').hidden`));

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
	await type('/todos');
	check(await until(() => inbox.log(ID).some((e) => e.text === 'Its to-do list: → Add the 2027 brackets · ○ Update the tests')) && inbox.view(ID).queued === 0, '/todos shows its to-do list in full');
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
	check(await until(() => box(`[...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Carry on')`)), 'and Carry on is a tap away');
	const fresh = await tool({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/tmp/x' } });
	check(!fresh.out, 'and the next turn isn’t stopped');
	check(await until(() => box(`(() => { const t = [...document.querySelectorAll('#inner .turnmeta')].pop(); return !!t && /step/.test(t.textContent) && /tax\\.js/.test(t.textContent); })()`)), 'the reply says how many steps it took and which files changed');
	await shot('stopped');

	// Links in a reply open in the browser.
	await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'open a PR' });
	await hook({ hook_event_name: 'Stop', last_assistant_message: 'Opened [the PR](https://github.com/a/b/pull/7). Also https://example.com/x.' });
	check(await until(() => box(`(() => { const a = [...document.querySelectorAll('#inner .msg.claude a.link')]; return a.length === 2 && a[0].textContent === 'the PR' && a[0].getAttribute('href') === 'https://github.com/a/b/pull/7' && a[1].getAttribute('href') === 'https://example.com/x'; })()`)), 'links in a reply are links (a trailing full stop isn’t part of one)');
	await box(`document.querySelector('#inner .msg.claude a.link').click()`);
	await sleep(200);
	check(talk().webContents.getURL().endsWith('talk.html'), 'tapping one doesn’t take the box away');

	// ↑ in the empty field brings back what you said, ↓ goes forward again.
	await box(`(() => { const t = document.getElementById('text'); t.value = ''; t.dispatchEvent(new Event('input')); t.focus(); })()`);
	const arrow = (k) => box(`document.getElementById('text').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true }))`).then(() => box(`document.getElementById('text').value`));
	check(await arrow('ArrowUp') === 'open a PR', '↑ brings back your last message');
	check(await arrow('ArrowUp') === 'also do 2028 while you’re at it', 'and the one before');
	check(await arrow('ArrowDown') === 'open a PR' && await arrow('ArrowDown') === '', '↓ goes forward, back to an empty field');

	// Take the conversation with you: ⌘S saves it as Markdown, ⇧⌘C copies
	// it, and files and replies drag out into other apps.
	await key('s', mod);
	check(await until(() => box(`!document.getElementById('toast').hidden && /Saved to Downloads/.test(document.getElementById('toast').textContent)`)), '⌘S saves the conversation, and says where');
	const saved = await box(`document.getElementById('toast').title`);
	const md = saved && fs.existsSync(saved) ? fs.readFileSync(saved, 'utf8') : '';
	check(/^# kalkis/.test(md) && /> add the 2027 tax brackets/.test(md) && /\*\*Claude\*\*/.test(md) && /- Read tax\.js/.test(md) && /2028 isn’t started/.test(md), 'as Markdown: what you said, its steps, its replies');
	await key('s', mod);
	const second = await until(async () => (await box(`document.getElementById('toast').title`)) !== saved);
	check(second && fs.existsSync(saved), 'saving again never writes over the first');
	await key('c', Object.assign({ shiftKey: true }, mod));
	check(await until(async () => /^# kalkis/.test(await clipboard.readText())), '⇧⌘C copies it as Markdown');
	check(await box(`(() => { const b = document.querySelector('#inner .msg.claude .copyreply'); return !!b && b.draggable; })()`), 'a reply drags out as text');
	check(await box(`[...document.querySelectorAll('#inner .filelink')].every((b) => b.draggable)`), 'a changed file drags out as the file');

	// The overview: every session, and a tap goes to one.
	await hook({ session_id: ID2, cwd: '/tmp/website', hook_event_name: 'SessionStart' });
	await hook({ session_id: ID2, cwd: '/tmp/website', hook_event_name: 'UserPromptSubmit', prompt: 'fix the footer' });
	await until(async () => !!(await page(`!!__blaube.buddies.get(${JSON.stringify(ID2)})`)), 6000);
	check(await until(() => box(`document.querySelectorAll('#others .dot, #others button:not(.all)').length >= 1`)), 'the other session shows in the header');
	await key('0', mod);
	check(await until(() => box(`document.body.classList.contains('overview')`)), '⌘0 opens the overview');
	check(await until(() => box(`[...document.querySelectorAll('#overview .row:not(.past)')].map((r) => r.querySelector('b').textContent).join(',')`).then((t) => /kalkis/.test(t) && /website/.test(t))), 'with a row for each session');
	check(await box(`/Today/.test((document.querySelector('#overview .today') || {}).textContent || '')`), 'and the day so far');
	check(await until(() => box(`[...document.querySelectorAll('#overview .planfirst')].map((l) => l.textContent.trim()).join(',') === 'Plan first,Own worktree'`)), 'and new sessions can plan first, or get a worktree of their own');
	check(await until(() => box(`!!document.querySelector('#overview .planfirst input[type=checkbox]')`)), 'new sessions can start with a plan first');
	await shot('overview');
	await box(`[...document.querySelectorAll('#overview .row:not(.past)')].find((r) => /website/.test(r.textContent)).click()`);
	check(await until(() => talkId() === ID2), 'tapping a row goes to that session');
	check(await until(() => box(`!document.body.classList.contains('overview')`)), 'back in the chat');
	await sleep(300);
	await hook({ hook_event_name: 'Stop', last_assistant_message: 'This came while you were looking at the website.' });
	await key('[', mod);
	check(await until(() => talkId() === ID), '⌘[ goes to the one before');
	check(await until(() => box(`(() => { const d = document.querySelector('#inner .since'); return !!d && /while you were looking/.test(d.nextElementSibling.textContent); })()`)), 'a line shows where what came in since you last looked begins');
	// A reply passed on to another session, no copying between terminals.
	await box(`[...document.querySelectorAll('#inner .msg.claude')].pop().querySelector('.fwd').click()`);
	check(await until(() => box(`[...document.querySelectorAll('#inner .fwdmenu button')].map((b) => b.textContent).join() === 'website'`)), 'Send to… lists the other sessions');
	await box(`document.querySelector('#inner .fwdmenu button').click()`);
	const passed = () => [...inbox.log(ID2), ...(inbox.queue.get(ID2) || [])].some((e) => e.who === 'you' && /^\(This is from kalkis, another Claude Code session working in \/tmp\/kalkis; I'm passing it on:\)\n\nThis came while you were looking at the website\.$/.test(e.text));
	check(await until(passed), 'and passes the reply on to the one you pick');
	check(await until(() => inbox.log(ID).some((e) => e.who === 'note' && e.text === 'Sent to website')), 'saying where it went');
	for (const e of inbox.queue.get(ID2) || []) inbox.unsend(ID2, e.n);

	// ⌘F in the overview looks through every session.
	await key('0', mod);
	await until(() => box(`document.body.classList.contains('overview')`));
	// Another session asking permission is answered right from the overview.
	const asking2 = spawn('sh', ['-c', permissionCommand(PORT)], { env: Object.assign({}, process.env, { CLAUDE_CODE_ENTRYPOINT: 'cli' }) });
	let answer2 = '';
	asking2.stdout.on('data', (d) => { answer2 += d; });
	asking2.stdin.end(JSON.stringify({ session_id: ID2, cwd: '/tmp/website', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm run build' } }));
	check(await until(() => box(`[...document.querySelectorAll('#overview .rowask')].some((e) => /npm run build/.test(e.textContent))`)), 'the overview shows what another session asks permission for');
	await box(`[...document.querySelectorAll('#overview .rowask')].find((e) => /npm run build/.test(e.textContent)).querySelector('.allow').click()`);
	await new Promise((r) => { asking2.on('exit', r); setTimeout(r, 4000); });
	check(/"behavior":"allow"/.test(answer2), 'and Allow there answers it');
	// And from the menu bar, without opening anything.
	const asking3 = spawn('sh', ['-c', permissionCommand(PORT)], { env: Object.assign({}, process.env, { CLAUDE_CODE_ENTRYPOINT: 'cli' }) });
	let answer3 = '';
	asking3.stdout.on('data', (d) => { answer3 += d; });
	asking3.stdin.end(JSON.stringify({ session_id: ID2, cwd: '/tmp/website', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm publish' } }));
	const trayRow = () => global.__blaubeTrayMenu().items.find((i) => /website/.test(i.label) && i.submenu);
	check(await until(() => { const r = trayRow(); return !!r && r.submenu.items.some((i) => /^Allow .*npm publish/.test(i.label)); }), 'the menu bar menu offers Allow and Deny for what a session asks');
	trayRow().submenu.items.find((i) => i.label === 'Deny').click();
	await new Promise((r) => { asking3.on('exit', r); setTimeout(r, 4000); });
	check(/"behavior":"deny"/.test(answer3), 'and Deny there answers it');

	await key('f', mod);
	await box(`(() => { const f = document.getElementById('find'); f.value = 'footer'; f.dispatchEvent(new Event('input')); })()`);
	check(await until(() => box(`(() => { const r = [...document.querySelectorAll('#overview .row.hit')]; return r.length === 1 && /website/.test(r[0].textContent) && /fix the footer/.test(r[0].textContent); })()`)), '⌘F in the overview finds which session said it');
	// ...and past sessions, to pick one up.
	const pastDir = path.join(require('node:os').homedir(), '.claude', 'projects', '-blaube-e2e-' + process.pid);
	fs.mkdirSync(pastDir, { recursive: true });
	fs.writeFileSync(path.join(pastDir, '0e2e0e2e-0000-4000-8000-' + String(process.pid).padStart(12, '0') + '.jsonl'), [
		{ type: 'user', cwd: '/tmp/zoo-site', message: { content: 'make the footer show the zebracorn' } },
		{ type: 'assistant', message: { content: [{ type: 'text', text: 'The zebracorn is in the footer now.' }] } },
	].map((e) => JSON.stringify(e)).join('\n') + '\n');
	await box(`(() => { const f = document.getElementById('find'); f.value = 'zebracorn'; f.dispatchEvent(new Event('input')); })()`);
	check(await until(() => box(`(() => { const r = [...document.querySelectorAll('#overview .row.found')]; return r.length === 1 && /zoo-site/.test(r[0].textContent) && /zebracorn is in the footer/.test(r[0].textContent) && /Earlier sessions/.test(document.getElementById('overview').textContent); })()`)), 'and past sessions, ready to pick up');
	await sleep(800);
	await shot('searchpast');
	fs.rmSync(pastDir, { recursive: true, force: true });
	await box(`(() => { const f = document.getElementById('find'); f.value = 'footer'; f.dispatchEvent(new Event('input')); })()`);
	await until(() => box(`document.querySelectorAll('#overview .row.hit').length === 1`));
	await sleep(1500);
	await shot('searchall');
	await box(`document.querySelector('#overview .row.hit').click()`);
	check(await until(() => talkId() === ID2), 'tapping it goes there');
	check(await until(() => box(`!document.getElementById('findBar').hidden && document.getElementById('find').value === 'footer' && /1 found/.test(document.getElementById('findCount').textContent)`)), 'with the same words found in its conversation');
	await page(`window.blaube.talk(${JSON.stringify(ID)}, { x: 300, y: 600, r: 60 })`);
	await until(() => talkId() === ID);

	// In a git repository: the git line, and the files it changed a tap away.
	const repo = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'blaube-repo-'));
	const { execFileSync } = require('node:child_process');
	execFileSync('git', ['init', '-q', '-b', 'feature/tax'], { cwd: repo });
	fs.mkdirSync(path.join(repo, 'src'));
	fs.writeFileSync(path.join(repo, 'src', 'tax.js'), 'x');
	fs.writeFileSync(path.join(repo, 'notes.md'), 'y');
	const ID3 = ID + '-c';
	// (Its transcript has what was said before Blaube saw it.)
	const tx = path.join(repo, '..', path.basename(repo) + '.jsonl');
	const long = new Date(Date.now() - 3600e3).toISOString();
	fs.writeFileSync(tx, [
		{ type: 'user', timestamp: long, message: { content: 'set up the repo' } },
		{ type: 'assistant', timestamp: long, message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 120000 }, content: [{ type: 'text', text: 'The repo is set up with a src folder.' }] } },
	].map((e) => JSON.stringify(e)).join('\n') + '\n');
	await hook({ session_id: ID3, cwd: repo, transcript_path: tx, hook_event_name: 'SessionStart' });
	await hook({ session_id: ID3, cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'hi', permission_mode: 'acceptEdits' });
	await tool({ session_id: ID3, cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(repo, 'notes.md') } });
	await hook({ session_id: ID3, cwd: repo, hook_event_name: 'Stop', last_assistant_message: 'Hello.' });
	await until(async () => !!(await page(`!!__blaube.buddies.get(${JSON.stringify(ID3)})`)), 6000);
	await page(`window.blaube.talk(${JSON.stringify(ID3)}, { x: 300, y: 600, r: 60 })`);
	check(await until(() => talkId() === ID3 && box(`/feature.tax · 2 changed/.test(document.getElementById('git').textContent)`), 8000), 'in a git repository, its branch and what’s changed show');
	check(await until(() => box(`!!document.querySelector('#inner .earlierbtn')`)), 'a session whose transcript goes further back offers Earlier messages');
	check(await until(() => box(`(() => { const m = document.getElementById('mode'); return !m.hidden && m.textContent === 'Opus 5.5 · 60% context · ⏵⏵ Accepting edits' && !m.classList.contains('can'); })()`)), 'under the field: its model, how full it is, and that it’s accepting edits');
	await box(`document.querySelector('#inner .earlierbtn').click()`);
	check(await until(() => box(`(() => { const e = document.querySelector('#inner .earlier'); return !!e && /set up the repo/.test(e.textContent) && /src folder/.test(e.textContent); })()`)), 'tapping it shows what was said before');
	// /rename: its name, in its transcript where Claude Code keeps it.
	await type('/rename Tax rewrite');
	check(await until(() => /"type":"custom-title","customTitle":"Tax rewrite","sessionId":"[^"]+-c"/.test(fs.readFileSync(tx, 'utf8'))), '/rename names it in its transcript, as Claude Code does');
	check(await until(() => box(`[...document.querySelectorAll('#inner .note')].some((n) => n.textContent === 'Named it “Tax rewrite”')`)), 'and says so');
	check(await until(() => box(`(() => { const n = document.getElementById('subname'); return !n.hidden && n.textContent === 'Tax rewrite'; })()`)), 'its name shows beside the folder’s');
	await box(`document.getElementById('subname').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
	check(await until(() => box(`document.getElementById('text').value === '/rename Tax rewrite' && document.activeElement.id === 'text'`)), 'and double-clicking it puts /rename in the field, to rename it');
	await box(`(() => { const t = document.getElementById('text'); t.value = ''; t.dispatchEvent(new Event('input')); })()`);
	// /permissions: what it may do without asking, added to and taken back.
	await type('/permissions allow Bash(npm test:*)');
	const local = path.join(repo, '.claude', 'settings.local.json');
	check(await until(() => { try { return JSON.parse(fs.readFileSync(local, 'utf8')).permissions.allow.includes('Bash(npm test:*)'); } catch { return false; } }), '/permissions allow adds a rule, to the project’s own local settings');
	await type('/permissions');
	check(await until(() => inbox.log(ID3).some((e) => /^Allowed without asking: Run npm test… \(this project, just you\)/.test(e.text || ''))), '/permissions lists what it may do without asking');
	await type('/permissions remove Bash(npm test:*)');
	check(await until(() => JSON.parse(fs.readFileSync(local, 'utf8')).permissions.allow.length === 0 && inbox.log(ID3).some((e) => e.text === 'It asks first again before: Run npm test…')), 'and /permissions remove takes it back');
	await type('/mcp');
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'step' && e.text === 'Its MCP servers (claude mcp list)' && !e.running), 30000), '/mcp in a terminal’s session runs claude mcp list right there');
	// A command only its terminal can take: Bring it here offered, so it needn't.
	tracker.sessions.get(ID3).pid = process.pid;
	await type('/output-style');
	check(await until(() => inbox.log(ID3).some((e) => /^\/output-style is for Claude Code itself.*Or bring it here/.test(e.text || '')) && box(`[...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Bring it here')`)), 'a command only its terminal can take offers Bring it here');
	tracker.sessions.get(ID3).pid = 0;
	await type('/help');
	check(await until(() => inbox.log(ID3).some((e) => /^Talk to it as you would in its terminal/.test(e.text || ''))), '/help says what works here');
	check(await until(() => box(`[...document.querySelectorAll('#inner .note.long')].some((n) => /^Talk to it as you would/.test(n.textContent) && n.offsetHeight > 30 && n.scrollWidth <= n.clientWidth)`)), 'and a long note wraps, all of it readable');
	await shot('help');
	await type('/resume');
	check(await until(() => box(`document.body.classList.contains('overview') && document.getElementById('text').value === ''`)), '/resume opens the overview, where past sessions are picked up');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	await until(() => box(`!document.body.classList.contains('overview')`));
	fs.mkdirSync(path.join(repo, '.claude', 'skills', 'release'), { recursive: true });
	fs.writeFileSync(path.join(repo, '.claude', 'skills', 'release', 'SKILL.md'), '---\nname: release\ndescription: Tags and ships a release\n---\n');
	await type('/skills');
	check(await until(() => inbox.log(ID3).some((e) => /^Skills it can use: release \(Tags and ships a release\)/.test(e.text || ''))), '/skills lists the skills it can use');
	await type('/cost');
	check(await until(() => inbox.log(ID3).some((e) => /^It has used 120k tokens \(.+\) · its context is 60% full/.test(e.text || ''))), '/cost says what a terminal’s session has used, from its transcript');
	await box(`(() => { const t = document.getElementById('text'); t.focus(); t.value = '/rel'; t.setSelectionRange(4, 4); t.dispatchEvent(new Event('input')); })()`);
	check(await until(() => box(`(() => { const s = document.getElementById('suggest'); return !s.hidden && /release\s*Tags and ships a release/.test(s.textContent); })()`)), 'a skill shows in / suggestions, with what it’s for');
	await box(`(() => { const t = document.getElementById('text'); t.value = ''; t.dispatchEvent(new Event('input')); })()`);
	await type('/release v2');
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'you' && e.text === 'Use your release skill for this: v2')), 'and /release v2 asks it for that skill in words, in a terminal’s session');
	await type('/review 42');
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'you' && /^Review pull request 42\. Read it with `gh pr view`/.test(e.text)) && inbox.log(ID3).some((e) => e.text === '/review: asked in words, as Claude Code’s command asks')), '/review 42 reaches a terminal’s session as the same ask in words, no terminal');
	await type('/vim');
	check(await until(() => inbox.log(ID3).some((e) => e.text === '/vim is for Claude Code’s terminal screen; the box doesn’t need it.')), 'a terminal-screen-only command says so');
	await type('/plugin');
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'step' && e.text === 'Your plugins (claude plugin list)' && !e.running), 30000), '/plugin runs claude plugin list right there');
	await type('/agents');
	check(await until(() => fs.existsSync(path.join(repo, '.claude', 'agents')) && inbox.log(ID3).some((e) => /^No agents of its own yet\. Opened .+\/\.claude\/agents/.test(e.text || ''))), '/agents opens the project’s agents folder');
	await box(`document.getElementById('git').click()`);
	check(await until(() => box(`[...document.querySelectorAll('#gitFiles li > button:first-child')].map((b) => b.textContent).sort().join()`).then((t) => t === 'notes.mdnew,src/tax.jsnew')), 'tapping it lists the files');
	await box(`[...document.querySelectorAll('#gitFiles li > button:first-child')].find((b) => /tax\\.js/.test(b.textContent)).click()`);
	check(await until(() => box(`[...document.querySelectorAll('#gitFiles .diff')].some((p) => !p.hidden && p.querySelector('.add') && /\\+x/.test(p.textContent) && p.offsetHeight > 20)`)), 'tapping a file shows what changed in it');
	await sleep(800);
	await shot('gitfiles');
	check(await until(() => box(`[...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Commit')`)), 'with Commit a tap away');
	// Its branches, under the files: a new one, then back, no terminal.
	execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: repo });
	await box(`document.getElementById('git').click(); document.getElementById('git').click()`); // (closed and opened again: read afresh)
	// ↺ discards a file's changes (twice, to be sure), and Put back brings them back.
	const notes = fs.readFileSync(path.join(repo, 'notes.md'), 'utf8');
	const unNotes = `[...document.querySelectorAll('#gitFiles li')].find((l) => /^notes\\.md/.test(l.firstChild.textContent)).querySelector('.discard')`;
	await box(`${unNotes}.click()`);
	check(await until(() => box(`${unNotes}.textContent === 'Discard?'`)) && fs.existsSync(path.join(repo, 'notes.md')), 'one tap on ↺ asks to be sure, and discards nothing yet');
	await box(`${unNotes}.click()`);
	check(await until(() => !fs.existsSync(path.join(repo, 'notes.md')) && inbox.log(ID3).some((e) => e.who === 'note' && /^Discarded your changes to notes\.md/.test(e.text))), 'a second tap discards it');
	check(await until(() => box(`(() => { const t = [...document.querySelectorAll('#gitFiles li > button:first-child')].map((b) => b.textContent); return t.includes('src/tax.jsnew') && !t.includes('notes.mdnew'); })() && /Discarded notes\\.md/.test(document.querySelector('#gitFiles .putback').textContent)`), 10000), 'it leaves the list, with Put back in its place');
	await sleep(500);
	await shot('discard');
	await box(`document.querySelector('#gitFiles .putback button').click()`);
	check(await until(() => fs.existsSync(path.join(repo, 'notes.md')) && fs.readFileSync(path.join(repo, 'notes.md'), 'utf8') === notes && inbox.log(ID3).some((e) => e.text === 'Put back your changes to notes.md')), 'Put back brings it back as it was');
	check(await until(() => box(`!document.querySelector('#gitFiles .putback') && [...document.querySelectorAll('#gitFiles li > button:first-child')].some((b) => b.textContent === 'notes.mdnew')`), 10000), 'and the list has it again');
	check(await until(() => box(`(() => { const b = document.getElementById('branches'); return !b.hidden && [...b.querySelectorAll(':scope > button')].map((x) => x.textContent + (x.disabled ? '!' : '')).join() === 'feature/tax!,New branch…'; })()`)), 'the git line shows its branches too, the one it’s on marked');
	await box(`[...document.querySelectorAll('#branches > button')].find((b) => b.textContent === 'New branch…').click()`);
	await box(`(() => { const i = document.querySelector('#branches input'); i.value = 'bad name'; i.form.requestSubmit(); })()`);
	check(await until(() => box(`document.querySelector('#branches .clonesaid').textContent === 'That isn’t a name a branch can have'`)), 'a name a branch can’t have is said so');
	await box(`(() => { const i = document.querySelector('#branches input'); i.value = 'try-it'; i.form.requestSubmit(); })()`);
	check(await until(() => execFileSync('git', ['branch', '--show-current'], { cwd: repo }).toString().trim() === 'try-it' && inbox.log(ID3).some((e) => e.text === 'Made a new branch, try-it, and switched to it')), 'New branch… makes one and switches to it');
	check(await until(() => box(`/^try-it/.test(document.getElementById('git').textContent) && [...document.querySelectorAll('#branches > button')].map((x) => x.textContent).sort().join() === 'New branch…,feature/tax,try-it'`)), 'and the git line follows');
	await sleep(500);
	await shot('branches');
	await box(`[...document.querySelectorAll('#branches > button')].find((b) => b.textContent === 'feature/tax').click()`);
	check(await until(() => execFileSync('git', ['branch', '--show-current'], { cwd: repo }).toString().trim() === 'feature/tax' && inbox.log(ID3).some((e) => e.text === 'Switched to feature/tax')), 'tapping another branch switches to it');
	// Push from its quick actions: git itself, right there.
	const bare = repo + '-remote.git';
	execFileSync('git', ['init', '-q', '--bare', bare]);
	execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo });
	execFileSync('git', ['add', '-A'], { cwd: repo });
	execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'tax'], { cwd: repo });
	check(await until(() => box(`[...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Push' && /git push/.test(b.title))`), 10000), 'with nothing to commit and nothing pushed, Push runs git itself');
	await box(`[...document.querySelectorAll('#quick button')].find((b) => b.textContent === 'Push').click()`);
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'step' && e.text === 'Pushed feature/tax' && e.ok && !e.running) && execFileSync('git', ['rev-parse', 'feature/tax'], { cwd: bare }).toString() === execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString(), 15000), 'Push pushes it, a step in the box, no model call');
	check(await until(() => box(`[...document.querySelectorAll('#branches .commits li > button')].map((b) => b.firstChild.textContent).join() === 'tax,start'`), 10000), 'its latest commits show under its branches');
	await sleep(1500); // (it reads them again once the push has settled)
	await until(() => box(`(() => { const b = [...document.querySelectorAll('#branches .commits li > button')].find((x) => x.firstChild.textContent === 'tax'); if (b && b.getAttribute('aria-expanded') === 'false') b.click(); return !!b; })()`));
	check(await until(() => box(`(() => { const p = document.querySelector('#branches .commits .diff'); return !!p && !p.hidden && /^tax\\n\\n── /.test(p.textContent) && /── notes\\.md/.test(p.textContent) && /── src\\/tax\\.js/.test(p.textContent) && p.querySelector('.add'); })()`)), 'and a tap shows what one changed, file by file');
	await sleep(500);
	await shot('commits');
	// All the branch changed since it left main, to look over before a PR.
	execFileSync('git', ['branch', 'main', 'HEAD~1'], { cwd: repo });
	await box(`document.getElementById('git').click(); document.getElementById('git').click()`);
	check(await until(() => box(`/^On this branch since main: \\d+ files? changed/.test((document.querySelector('#branches .onbranch') || {}).textContent || '')`), 10000), 'it says what its branch changed since main');
	await box(`document.querySelector('#branches .onbranch').click()`);
	await until(() => box(`[...document.querySelectorAll('#branches .branchfiles li > button')].some((b) => b.firstChild.textContent === 'src/tax.js')`));
	await box(`[...document.querySelectorAll('#branches .branchfiles li > button')].find((b) => b.firstChild.textContent === 'src/tax.js').click()`);
	check(await until(() => box(`[...document.querySelectorAll('#branches .branchfiles .diff')].some((p) => !p.hidden && /\\+x/.test(p.textContent))`)), 'and a tap on a file shows its change on the branch');
	execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'more'], { cwd: repo });
	execFileSync('git', ['remote', 'set-url', 'origin', bare + '-gone'], { cwd: repo });
	check(await until(() => box(`[...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Push' && /git push/.test(b.title))`), 10000), 'one more commit: Push again');
	await box(`[...document.querySelectorAll('#quick button')].find((b) => b.textContent === 'Push').click()`);
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'step' && /^git couldn’t push/.test(e.text) && !e.ok), 15000), 'when git can’t push, the box says so');
	check(await until(() => box(`[...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Push' && b.title === 'Push this branch.')`), 10000), 'and Push then asks Claude instead');
	execFileSync('git', ['remote', 'set-url', 'origin', bare], { cwd: repo });
	// Its pull request, from gh (a stand-in here): how it stands, and its slime says when checks finish.
	const prFile = path.join(repo + '-pr.json'), fakeGh = repo + '-gh.sh';
	const prSays = (rollup) => fs.writeFileSync(prFile, JSON.stringify({ number: 5, url: 'https://github.com/o/r/pull/5', state: 'OPEN', isDraft: false, title: 'Tax rounding', reviewDecision: '', statusCheckRollup: rollup }));
	prSays([{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }]);
	fs.writeFileSync(fakeGh, `#!/bin/sh\n[ "$1 $2" = "pr view" ] && [ "$GH_PROMPT_DISABLED" = 1 ] && cat '${prFile}'\n`, { mode: 0o755 });
	global.__blaubeGh = fakeGh;
	check(await until(() => box(`/^feature.tax · .*PR #5 · checks running$/.test(document.getElementById('git').textContent) && /PR #5 · Tax rounding/.test((document.querySelector('#branches .prlink') || {}).textContent || '')`), 10000), 'its pull request shows on the git line, a tap from GitHub');
	check(await until(() => box(`![...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Open a PR')`)), 'and Open a PR isn’t offered again');
	prSays([{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }]);
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'note' && e.text === 'PR #5: 1 check failed') && box(`/PR #5 · 1 check failing$/.test(document.getElementById('git').textContent)`), 10000), 'when its checks finish, it says so');
	check(await until(() => box(`(() => { const b = document.querySelector('#quick button'); return !!b && b.textContent === 'Fix the checks' && /gh pr checks 5/.test(b.title); })()`)), 'with Fix the checks first among its quick actions');
	check(await until(() => { const o = ((global.__blaubeState || {}).sessions || []).find((x) => x.id === ID3); return !!o && /^feature\/tax · .*PR #5 · 1 check failing$/.test(o.info.branch); }), 'and hovering its slime says so too, with its branch');
	await sleep(500);
	await shot('pr');
	fs.rmSync(prFile);
	check(await until(() => box(`!/PR/.test(document.getElementById('git').textContent)`), 10000), 'and once gh knows of no pull request, the git line says none');
	global.__blaubeGh = '';
	// Its own scripts, from the box: a dev server kept running, the rest as a step.
	fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'tax', scripts: { test: 'node -e "console.log(\'tests ok\')"', dev: 'node server.js' } }));
	fs.writeFileSync(path.join(repo, 'server.js'), "const s = require('http').createServer((q, r) => r.end('hi')).listen(0, () => console.log('ready on http://localhost:' + s.address().port + '/'));");
	await type('/run');
	check(await until(() => inbox.log(ID3).some((e) => e.text === 'Its scripts: dev, test. /run dev runs one.')), '/run lists its scripts');
	check(await until(() => box(`[...document.querySelectorAll('#branches .runrow button')].map((b) => b.textContent).join() === 'dev,test'`), 10000), 'and the git line’s panel has them, a tap to run');
	await box(`[...document.querySelectorAll('#branches .runrow button')].find((b) => b.textContent === 'test').click()`);
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'step' && e.text === 'Ran npm run test' && e.ok && /tests ok/.test(e.detail || '')), 30000), 'a script that ends runs as a step, with what it printed');
	await type('/run dev');
	check(await until(() => inbox.log(ID3).some((e) => e.text === 'Started npm run dev: it keeps running in the background, with Stop beside it')), '/run dev starts the dev server in the background');
	check(await until(() => box(`(() => { const li = [...document.querySelectorAll('#bg li')].find((l) => l.firstChild.textContent === 'dev'); return !!li && [...li.querySelectorAll('button')].some((b) => b.textContent === 'Open' && /^http:\\/\\/localhost:\\d+\\/$/.test(b.title)); })()`), 30000), 'and it’s listed with Open for where it’s up');
	await box(`[...[...document.querySelectorAll('#bg li')].find((l) => l.firstChild.textContent === 'dev').querySelectorAll('button')].find((b) => b.textContent === 'Output').click()`);
	check(await until(() => box(`[...document.querySelectorAll('#bg .bgout')].some((p) => !p.hidden && /ready on http/.test(p.textContent))`)), 'Output shows what it printed');
	await sleep(500);
	await shot('run');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	check(await until(() => box(`[...document.querySelectorAll('.rowlink')].some((l) => /^dev · localhost:\\d+$/.test(l.firstChild.textContent))`)), 'the overview lists it with Open too');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	await until(() => box(`!document.body.classList.contains('overview')`));
	await box(`[...[...document.querySelectorAll('#bg li')].find((l) => l.firstChild.textContent === 'dev').querySelectorAll('button')].find((b) => b.textContent === 'Stop').click()`);
	check(await until(() => box(`![...document.querySelectorAll('#bg li')].some((l) => l.firstChild.textContent === 'dev')`), 10000) && !inbox.log(ID3).some((e) => /npm run dev stopped/.test(e.text || '')), 'Stop stops it, and that’s no news');
	fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'tax', scripts: { dev: 'node -e "console.error(\'Error: port 3000 in use\'); process.exit(1)"' } }));
	await type('/run dev');
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'note' && /^npm run dev stopped \(code 1\)/.test(e.text) && e.runFailed), 30000), 'a dev server that crashes says so');
	check(await until(() => box(`(() => { const b = document.querySelector('#quick button'); return !!b && b.textContent === 'Fix it' && /port 3000 in use/.test(b.title); })()`)), 'with Fix it, its last lines going along');
	check(await until(() => box(`![...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Try again')`)), 'and it isn’t taken for Claude’s own error');
	fs.rmSync(path.join(repo, 'package.json')); fs.rmSync(path.join(repo, 'server.js'));
	// Files named in a reply open right in the box; a long reply's rest is a tap away.
	const edLog = repo + '-editor.txt', fakeEd = repo + '-code.sh';
	fs.writeFileSync(fakeEd, `#!/bin/sh\necho "$@" > '${edLog}'\n`, { mode: 0o755 });
	global.__blaubeEditor = { name: 'VS Code', bin: fakeEd, kind: 'code' };
	await hook({ session_id: ID3, cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'what did you change?' });
	await hook({ session_id: ID3, cwd: repo, hook_event_name: 'Stop', last_assistant_message: 'I changed `src/tax.js:1` and [the notes](notes.md#L1), not `nope.js` or `console.log`.\n\n' + 'All of it. '.repeat(500) + 'THE END' });
	check(await until(() => box(`(() => { const l = [...document.querySelectorAll('#inner .msg.claude .filelink')].map((e) => e.textContent).join(); return l === 'src/tax.js:1,the notes'; })()`)), 'files named in a reply become tappable (only real ones)');
	await box(`[...document.querySelectorAll('#inner .filelink')].find((e) => e.textContent === 'src/tax.js:1').click()`);
	check(await until(() => box(`(() => { const p = document.querySelector('#inner .peek'); return !!p && /src\\/tax\\.js, line 1/.test(p.textContent) && p.querySelector('mark') && p.querySelector('mark').textContent === 'x'; })()`)), 'a tap shows the file in the box, its line marked');
	await box(`document.querySelector('#inner .peek .ined').click()`);
	check(await until(() => fs.existsSync(edLog) && fs.readFileSync(edLog, 'utf8').trim() === `-g ${path.join(repo, 'src', 'tax.js')}:1`), 'Open in VS Code opens it in your editor, at that line');
	global.__blaubeEditor = null;
	await sleep(500);
	await shot('peek');
	await box(`[...document.querySelectorAll('#inner .filelink')].find((e) => e.textContent === 'src/tax.js:1').click()`);
	check(await until(() => box(`!document.querySelector('#inner .peek')`)), 'and another tap puts it away');
	fs.symlinkSync(require('node:os').tmpdir(), path.join(repo, 'out'));
	const outside = await box(`window.blaubeTalk.filesExist(${JSON.stringify(ID3)}, ['../x.jsonl', ${JSON.stringify(path.basename(repo) + '/../' + path.basename(tx))}, '/etc/hosts', 'out/${path.basename(tx)}', 'notes.md'])`);
	check(JSON.stringify(outside) === '["notes.md"]', 'nothing outside its folder can be opened (not by .., a full path or a link)');
	fs.unlinkSync(path.join(repo, 'out'));
	check(await until(() => box(`(() => { const b = [...document.querySelectorAll('#inner .more')].pop(); return !!b && b.textContent === 'Show more' && !/THE END/.test(document.getElementById('inner').textContent); })()`)), 'a long reply is folded, with the rest right here');
	await box(`[...document.querySelectorAll('#inner .more')].pop().click()`);
	check(await until(() => box(`/THE END/.test(document.getElementById('inner').textContent)`)), 'a tap shows the rest, no terminal needed');
	// An image it looked at shows in the box, which a terminal can't do.
	const png = path.join(repo, 'shot.png');
	fs.copyFileSync(path.join(__dirname, '..', '..', 'build', 'icon.png'), png);
	await hook({ session_id: ID3, cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'look at it' });
	await hook({ session_id: ID3, cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: png }, tool_response: {} });
	await until(() => box(`[...document.querySelectorAll('#inner .step')].some((e) => /shot\.png/.test(e.textContent))`));
	await box(`[...document.querySelectorAll('#inner .step')].find((e) => /shot\.png/.test(e.textContent)).click()`);
	check(await until(() => box(`(() => { const i = document.querySelector('#inner .stepimg img'); return !!i && i.complete && i.naturalWidth > 0; })()`)), 'an image it looked at shows in the box with a tap');
	check(await box(`window.blaubeTalk.image(${JSON.stringify(ID3)}, ${JSON.stringify(path.join(repo, 'other.png'))})`) === null, 'only images its steps named');
	await hook({ session_id: ID3, cwd: repo, hook_event_name: 'Stop', last_assistant_message: 'It is a tiny red square.' });
	// Claude Code couldn't get an answer: its box says why.
	fs.appendFileSync(tx, JSON.stringify({ type: 'assistant', isApiErrorMessage: true, message: { model: '<synthetic>', content: [{ type: 'text', text: '5-hour limit reached ∙ resets 3pm' }] } }) + '\n');
	check(await until(() => box(`[...document.querySelectorAll('#inner .note.error')].some((e) => e.textContent === 'Claude Code: 5-hour limit reached ∙ resets 3pm')`), 10000), 'an API error (a usage limit, say) shows in its box');
	const chips = () => box(`[...document.querySelectorAll('#quick button')].map((b) => b.textContent).join('|')`);
	check(await until(async () => /^Carry on at 3pm\|Try again/.test(await chips())), 'with Try again a tap away, and Carry on at 3pm, when the limit lifts');
	await box(`[...document.querySelectorAll('#quick button')].find((b) => b.textContent === 'Carry on at 3pm').click()`);
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'note' && /carry on by itself at 3pm/.test(e.text))), 'tapping it says it’ll carry on by itself then');
	check(await until(async () => /^Don’t carry on at 3pm\|Try again/.test(await chips())), 'and offers to call it off');
	global.__blaubeCarryTick(Date.now() + 2 * 86400e3);
	const carried = () => [...inbox.log(ID3), ...(inbox.queue.get(ID3) || [])].some((e) => e.who === 'you' && e.text === 'Carry on where you left off.');
	check(await until(carried), 'once it lifts, it carries on by itself');
	check(inbox.log(ID3).some((e) => e.who === 'note' && /limit lifted/.test(e.text)), 'saying so');
	for (const e of inbox.queue.get(ID3) || []) inbox.unsend(ID3, e.n);
	// "!ls" runs right here, as the terminal's bash mode does, and goes along with the next message.
	// "# always use pnpm": remembered in its project's CLAUDE.md, as in the terminal.
	await type('# always use pnpm');
	check(await until(() => { try { return fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8') === '- always use pnpm\n'; } catch { return false; } }), '# notes go in the project’s CLAUDE.md');
	check(await until(() => box(`[...document.querySelectorAll('#inner .note')].some((e) => /^Remembered in blaube-repo-\\w+\\/CLAUDE\\.md: always use pnpm$/.test(e.textContent))`)), 'and the box says so');
	check(!inbox.log(ID3).some((e) => e.who === 'you' && /always use pnpm/.test(e.text)), 'instead of going as a message');
	await type('/memory');
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'note' && /^Opened blaube-repo-\w+\/CLAUDE\.md/.test(e.text))), '/memory opens the project’s CLAUDE.md');
	check(!inbox.log(ID3).some((e) => e.who === 'you' && e.text === '/memory'), 'rather than going to its terminal');
	await type('!ls src');
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'step' && e.text === 'You ran ls src' && e.ok && !e.running && /tax\.js/.test(e.detail))), '!ls runs in its folder and shows what it printed');
	check(await until(() => box(`[...document.querySelectorAll('#inner .step')].some((e) => /You ran ls src/.test(e.textContent))`)), 'as a step in the box');
	await type('what is in there?');
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'you' && /^\(I ran `ls src` myself\. It printed:\n```\ntax\.js\n```\)\n\n\(I added this to \S+CLAUDE\.md, for you to keep in mind from now on: always use pnpm\)\n\nwhat is in there\?$/.test(e.text))), 'and what it printed goes along with the next message (and the note it should keep in mind)');
	// What it may do without asking, and taking one back (as /permissions does).
	fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
	const localSettings = path.join(repo, '.claude', 'settings.local.json');
	fs.writeFileSync(localSettings, JSON.stringify({ permissions: { allow: ['Bash(npm test:*)', 'Edit'] } }));
	const allowed = global.__blaubeSessionMenu(ID3).items.find((i) => i.label === 'Allowed without asking');
	check(!!allowed && allowed.enabled && allowed.submenu.items.slice(0, 2).map((i) => `${i.label} | ${i.sublabel}`).join(', ') === 'Run npm test… | This project, just you, Edit (anything) | This project, just you', 'its menu lists what it may do without asking');
	allowed.submenu.items[0].click();
	check(await until(() => JSON.stringify(JSON.parse(fs.readFileSync(localSettings, 'utf8')).permissions.allow) === '["Edit"]'), 'a tap takes one back, leaving the rest');
	check(await until(() => box(`[...document.querySelectorAll('#inner .note')].some((e) => e.textContent === 'It asks first again before: Run npm test…')`)), 'and its box says so');
	// "@" suggests its files, "/" its commands; your own command goes as a message.
	const typeIn = (v) => box(`(() => { const t = document.getElementById('text'); t.focus(); t.value = ${JSON.stringify(v)}; t.setSelectionRange(t.value.length, t.value.length); t.dispatchEvent(new Event('input')); })()`);
	await typeIn('look at @tax');
	check(await until(() => box(`(() => { const s = document.getElementById('suggest'); return !s.hidden && /^src\\/tax\\.js/.test(s.querySelector('button.on').textContent); })()`)), '@ suggests the session’s files, best match first');
	await box(`document.getElementById('text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))`);
	check(await box(`document.getElementById('text').value === 'look at @src/tax.js ' && document.getElementById('suggest').hidden`), 'Tab puts the path in');
	fs.mkdirSync(path.join(repo, '.claude', 'commands'), { recursive: true });
	fs.writeFileSync(path.join(repo, '.claude', 'commands', 'ship.md'), '---\ndescription: Ship it somewhere\n---\nShip $1 now, carefully.\n');
	await typeIn('/sh');
	check(await until(() => box(`(() => { const b = document.querySelector('#suggest button.on'); return !!b && /^\\/shipShip it somewhere$/.test(b.textContent); })()`)), '/ suggests commands, yours first with what they do');
	await sleep(500);
	await shot('suggest');
	await box(`document.getElementById('text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
	check(await box(`document.getElementById('text').value === '/ship '`), '↩ on a suggestion picks it (and doesn’t send)');
	await type('/ship web');
	check(await until(() => inbox.log(ID3).some((e) => e.who === 'you' && e.text === 'Ship web now, carefully.')), 'your own command goes as the message it stands for, no terminal needed');
	await type('');
	// Back after a while away: what happened meanwhile, said once.
	global.__blaubeCheckAway(700);
	await hook({ session_id: ID3, cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'and the docs?' });
	await hook({ session_id: ID3, cwd: repo, hook_event_name: 'Stop', last_assistant_message: 'Docs updated.' });
	await sleep(300);
	global.__blaubeCheckAway(5);
	check(/Tax rewrite.* finished · .*\d+ repl/.test(global.__blaubeAway || ''), `back from being away, it says what happened meanwhile (${global.__blaubeAway})`);
	global.__blaubeAway = '';
	global.__blaubeCheckAway(5);
	check(!global.__blaubeAway, 'once');
	await hook({ session_id: ID3, hook_event_name: 'SessionEnd' });
	await page(`window.blaube.talk(${JSON.stringify(ID)}, { x: 300, y: 600, r: 60 })`);
	await until(() => talkId() === ID);

	await hook({ session_id: ID2, hook_event_name: 'SessionEnd' });
	await hook({ hook_event_name: 'SessionEnd' });
	check(await until(async () => (await box(`[...document.querySelectorAll('#quick button')].map((b) => b.textContent).join()`)) === 'Pick it up here'), 'when it ends, it offers to pick it up right there');
	check(/Pick it up here/.test(await box(`document.getElementById('hint').textContent`)), 'instead of sending you to a terminal');
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
