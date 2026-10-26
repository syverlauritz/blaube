// End-to-end check of what a session Blaube started can do without a
// terminal, against a stand-in for Claude Code (no tokens), invisible:
//
//   BLAUBE_TEST=scripts/e2e/owned.js BLAUBE_PORT=47876 npx electron .
//
// /model and /plan are asked of Claude Code itself, and Stop stops it at once.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Claude Code's stream-json mode, as far as this needs: control requests
// answered, a message answered (or not yet, if it's "slow").
const FAKE = `#!/usr/bin/env node
let model = 'claude-opus', turn = null, used = [12, 40], mcpUp = false; const seen = new Set();
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
require('node:fs').writeFileSync(require('node:path').join(process.cwd(), 'args-' + process.pid), JSON.stringify(process.argv.slice(2)));
out({ type: 'system', subtype: 'init', permissionMode: 'default' });
require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.type === 'control_request') {
    const r = m.request, ok = (response) => out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } });
    if (r.subtype === 'set_model') { model = r.model.startsWith('claude-') ? r.model : 'claude-' + r.model; return ok({ model }); }
    if (r.subtype === 'set_permission_mode') { ok({ mode: r.mode }); return out({ type: 'system', subtype: 'status', permissionMode: r.mode }); }
    if (r.subtype === 'stop_task') return ok({});
    if (r.subtype === 'background_tasks') return ok({ backgrounded: r.tool_use_id === 'tu-fg' });
    if (r.subtype === 'list_models') return ok({ models: [{ value: 'default', displayName: 'Default (recommended)', description: 'Sonnet 5.5 · Efficient for routine tasks' }, { value: 'opus', displayName: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks' }, { value: 'haiku', displayName: 'Haiku', description: 'Haiku 5.5 · Fastest for quick answers' }] });
    if (r.subtype === 'get_context_usage') return ok({ categories: [{ name: 'System tools', tokens: 29000, kind: 'used' }, { name: 'Messages', tokens: 61000, kind: 'used' }, { name: 'Free space', tokens: 410000, kind: 'free' }], totalTokens: 90000, maxTokens: 500000, percentage: 18 });
    if (r.subtype === 'rewind_files') return ok(seen.has(r.user_message_id) ? (r.dry_run ? { canRewind: true, filesChanged: ['/x/a.js', '/x/b.js'], insertions: 3, deletions: 1 } : { canRewind: true }) : { canRewind: false, error: 'No file checkpoint found for this message.' });
    if (r.subtype === 'mcp_status') return ok({ mcpServers: [{ name: 'github', status: mcpUp ? 'connected' : 'failed', error: 'ENOENT: no such file' }, { name: 'linear', status: 'connected' }] });
    if (r.subtype === 'mcp_reconnect') { mcpUp = r.serverName === 'github'; return ok({}); }
    if (r.subtype === 'get_usage') return ok({ session: {}, rate_limits_available: true, rate_limits: { five_hour: { utilization: used[0], resets_at: new Date(Date.now() + 7200e3).toISOString() }, seven_day: { utilization: used[1], resets_at: new Date(Date.now() + 4 * 86400e3).toISOString() } } });
    if (r.subtype === 'interrupt') { clearTimeout(turn); ok({}); return out({ type: 'result', subtype: 'error_during_execution', is_error: true }); }
    return;
  }
  if (m.type === 'user' && m.uuid && process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING === '1') seen.add(m.uuid);
  if (m.type === 'user' && m.message.content === '/compact') { out({ type: 'system', subtype: 'compact_boundary' }); return out({ type: 'result', subtype: 'success', result: '' }); }
  if (m.type === 'user' && m.message.content === '/cost') { out({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Error: Nothing to show yet' }] } }); return out({ type: 'result', subtype: 'success', result: '' }); }
  if (m.type === 'user' && m.message.content === 'busy week') used = [30, 82];
  if (m.type === 'user' && m.message.content === 'busy week') out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.82, resetsAt: Math.round(Date.now() / 1000) + 3 * 86400, unifiedWindows: { five_hour: { utilization: 0.3, resetsAt: Math.round(Date.now() / 1000) + 3600, status: 'allowed' }, seven_day: { utilization: 0.82, resetsAt: Math.round(Date.now() / 1000) + 3 * 86400, status: 'allowed' } } } });
  if (m.type === 'user') turn = setTimeout(() => out({ type: 'result', subtype: 'success', result: model + ' here.' }), m.message.content === 'slow' ? 20000 : m.message.content === 'edit two' ? 1500 : m.message.content === 'start the server' ? 6000 : 50);
});
`;

module.exports = async function run({ win, owned, startSession, talk, talkId, tracker, inbox, PORT }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
	const box = (js) => talk().webContents.executeJavaScript(js);
	const type = (text) => box(`(() => { const t = document.getElementById('text'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input')); document.getElementById('form').requestSubmit(); })()`);
	const said = () => box(`document.getElementById('inner').textContent`);
	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);
	if (process.platform === 'win32') { console.log('(skipped on Windows: the stand-in is a script)'); return 0; }

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-owned-'));
	const bin = path.join(dir, 'claude');
	fs.writeFileSync(bin, FAKE, { mode: 0o755 });
	owned.findClaude = () => bin;
	const id = startSession(dir);
	check(await until(() => talk() && talk().isVisible() && talkId() === id, 8000), 'a session starts, its box open');

	// "/model " suggests the models it can switch to, asked of Claude Code.
	await box(`(() => { const t = document.getElementById('text'); t.focus(); t.value = '/model o'; t.setSelectionRange(8, 8); t.dispatchEvent(new Event('input')); })()`);
	check(await until(() => box(`(() => { const s = document.getElementById('suggest'); return !s.hidden && /^opus/.test(s.textContent) && /Opus 5\.5 · Best for everyday/.test(s.textContent) && !/haiku/.test(s.textContent); })()`)), '/model suggests the models it can switch to');
	await box(`document.getElementById('text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))`);
	check(await until(() => box(`document.getElementById('text').value === '/model opus'`)), 'and Tab puts one in');
	await box(`(() => { const t = document.getElementById('text'); t.value = ''; t.dispatchEvent(new Event('input')); })()`);
	await type('/model claude-sonnet-5-5');
	check(await until(async () => /Now using Sonnet 5\.5/.test(await said())), '/model switches its model, no terminal');
	check(await until(() => box(`document.querySelector('#mode .model') && document.querySelector('#mode .model').textContent === 'Sonnet 5.5 · '`)), 'and the box says which model it is now');
	await type('hello');
	check(await until(async () => /claude-sonnet-5-5 here\./.test(await said())), 'and it answers as that model');
	await type('/model');
	check(await until(async () => /Say which: \/model opus/.test(await said())), '/model alone says how');
	check(await box(`document.getElementById('suggest').hidden`), 'and sending leaves no suggestions behind');
	const mode = () => box(`(() => { const m = document.getElementById('mode'); return m.hidden ? '' : m.className + ' | ' + m.textContent; })()`);
	check(/default can \| Asks before edits⇧⇥/.test(await mode()), 'how it asks shows under the field, as in the terminal');
	const shiftTab = () => box(`document.getElementById('text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))`);
	await shiftTab();
	check(await until(async () => /acceptEdits can \| ⏵⏵ Accepting edits/.test(await mode())), '⇧⇥ switches it to accepting edits');
	if (process.env.BLAUBE_SHOTS) { await sleep(600); const img = await talk().webContents.capturePage(); fs.mkdirSync(path.join(__dirname, '..', '..', 'shots'), { recursive: true }); fs.writeFileSync(path.join(__dirname, '..', '..', 'shots', 'owned-mode.png'), img.toPNG()); }
	await box(`document.getElementById('mode').click()`);
	check(await until(async () => /plan can \| ⏸ Plan first/.test(await mode())), 'a tap, to planning first');
	await shiftTab();
	check(await until(async () => /^mode default/.test(await mode())), 'and round again');
	await type('/plan');
	check(await until(async () => /Plan mode: it shows you a plan/.test(await said()) && /^mode plan/.test(await mode())), '/plan puts it in plan mode');

	await type('!echo hi there');
	check(await until(() => inbox.log(id).some((e) => e.who === 'step' && e.text === 'You ran echo hi there' && /hi there/.test(e.detail) && !e.running)), '!echo runs right here');
	await type('/compact');
	check(await until(async () => /Compacted: it carries on from a summary/.test(await said())), '/compact goes straight in, and says when it’s done');
	check(inbox.log(id).some((e) => e.who === 'you' && e.text === '/compact'), 'a command stays a command, with what you ran held for the next message');
	await type('/cost');
	check(await until(async () => /Nothing to show yet/.test(await said())), 'what Claude Code itself answers a command shows');
	check(await until(() => tracker.sessions.get(id).state === 'done'), 'and the turn ends');
	await type('thoughts?');
	check(await until(() => inbox.log(id).some((e) => e.who === 'you' && /^\(I ran `echo hi there` myself\. It printed:\n```\nhi there\n```\)\n\nthoughts\?$/.test(e.text))), 'which then carries it');
	await until(() => tracker.sessions.get(id).state === 'done');
	// An MCP server that couldn't connect, as /mcp shows it, with Reconnect.
	check(await until(() => box(`!document.getElementById('mcp').hidden && document.getElementById('mcp').textContent.startsWith('github couldn’t connect')`)), 'an MCP server that couldn’t connect shows in its box');
	await box(`document.querySelector('#mcp button').click()`);
	check(await until(() => box(`document.getElementById('mcp').hidden`)) && inbox.log(id).some((e) => e.text === 'Reconnected github'), 'and Reconnect connects it, asked of Claude Code itself');
	// Its usage limits, asked of Claude Code after each turn (get_usage).
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	check(await until(() => box(`/^Usage: 12% of 5 hours \\(resets .+\\) · 40% of the week/.test((document.querySelector('#overview .usage') || {}).textContent || '')`)), 'the overview has your usage limits, asked of Claude Code after a turn');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	await until(() => box(`!document.body.classList.contains('overview')`));
	// "undo all": the turn's files put back by Claude Code itself (rewind_files).
	const post = (payload) => new Promise((done) => {
		const req = require('node:http').request({ host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli' } }, (res) => { res.resume(); res.on('end', done); });
		req.end(JSON.stringify(Object.assign({ session_id: id, cwd: dir }, payload)));
	});
	await until(() => tracker.sessions.get(id).state === 'done');
	await type('edit two');
	await sleep(300);
	for (const f of ['a.js', 'b.js']) await post({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(dir, f), old_string: 'a', new_string: 'b' }, tool_response: {} });
	check(await until(() => box(`[...document.querySelectorAll('#inner .undo.all')].length > 0`)), 'a turn that changed files has undo all');
	await box(`[...document.querySelectorAll('#inner .undo.all')].pop().click()`);
	check(await until(() => inbox.log(id).some((e) => e.who === 'note' && e.text === 'Put back a.js, b.js as they were before that turn')), 'which puts them back, asked of Claude Code itself (no asking Claude)');
	check(!inbox.log(id).some((e) => e.who === 'you' && /^Undo all/.test(e.text)), 'without a message to Claude');
	await type('now what?');
	check(await until(() => inbox.log(id).some((e) => e.who === 'you' && /^\(I put \/x\/a\.js, \/x\/b\.js back as they were before your last turn/.test(e.text) && /now what\?$/.test(e.text))), 'and Claude hears about it with your next message');
	await until(() => tracker.sessions.get(id).state === 'done');
	// /context: what fills it, asked of Claude Code and drawn in the box.
	await type('/context');
	check(await until(() => box(`(() => { const n = [...document.querySelectorAll('#inner .note.context')].pop(); return !!n && n.textContent.startsWith('Context: 18% full (90k of 500k)') && n.querySelectorAll('.ctxbar .seg').length === 3 && /Messages 61k/.test(n.querySelector('.ctxkeys').textContent); })()`)), '/context shows what fills its context, as a bar');
	// A command it waits on can go to the background (Ctrl+B in the terminal).
	await type('start the server');
	await sleep(300);
	await post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu-fg', tool_input: { command: 'npm run dev' } });
	check(!(await box(`!document.querySelector('#inner .dots .bgit').hidden`)), 'a command it just started has no Run in background yet');
	check(await until(() => box(`!!document.querySelector('#inner .dots .bgit') && !document.querySelector('#inner .dots .bgit').hidden`), 5000), 'one it has waited on a few seconds offers Run in background');
	await box(`document.querySelector('#inner .dots .bgit').click()`);
	check(await until(() => inbox.log(id).some((e) => e.who === 'note' && e.text === 'Running in the background now: npm run dev')), 'which moves it there, asked of Claude Code itself');
	await until(() => tracker.sessions.get(id).state === 'done', 8000);
	// A background task it started stops at once, asked of Claude Code itself.
	await new Promise((done) => {
		const req = require('node:http').request({ host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli' } }, (res) => { res.resume(); res.on('end', done); });
		req.end(JSON.stringify({ session_id: id, cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu9', tool_input: { command: 'npm run dev', description: 'Dev server', run_in_background: true }, tool_response: { backgroundTaskId: 'b9' } }));
	});
	check(await until(() => box(`!document.getElementById('bg').hidden`)), 'a background task it started shows');
	await box(`[...document.querySelectorAll('#bg button')].find((b) => b.textContent === 'Stop').click()`);
	check(await until(() => box(`document.getElementById('bg').hidden`)), 'its Stop stops it right away');
	check(inbox.log(id).some((e) => e.who === 'note' && e.text === 'Stopped Dev server') && !inbox.log(id).some((e) => e.who === 'you' && /Stop the background task/.test(e.text)), 'without asking Claude');
	// What /usage says, without it: how much of your limits you've used.
	await type('busy week');
	check(await until(() => box(`/82% of the week used/.test(document.getElementById('mode').textContent)`)), 'close to a usage limit, the box says so under the field');
	await until(() => tracker.sessions.get(id).state === 'done');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	check(await until(() => box(`/^Usage: 30% of 5 hours \\(resets .+\\) · 82% of the week \\(resets \\w+\\)$/.test((document.querySelector('#overview .usage') || {}).textContent || '')`)), 'and the overview has how much of each limit is used, and when it resets');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	await until(() => box(`!document.body.classList.contains('overview')`));
	await type('slow');
	check(await until(() => tracker.sessions.get(id).state === 'working', 3000), 'a long turn starts');
	check(await until(() => box(`!document.getElementById('stop').hidden`)), 'with Stop beside its name');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	check(await until(() => tracker.sessions.get(id).state !== 'working', 3000), 'Stop (⌘.) stops it at once (not at its next step)');
	await sleep(300);
	const text = await said();
	check(/You asked it to stop/.test(text) && !/Something went wrong/.test(text), 'and says you stopped it, not that something went wrong');
	check(await until(() => box(`[...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Carry on')`)), 'with Carry on a tap away');

	// Fork: a copy of the conversation in a new session (a new slime), the original carrying on.
	const before = new Set(owned.list());
	const forkItem = global.__blaubeSessionMenu(id).items.find((i) => i.label === 'Fork into a new session');
	check(!!forkItem && forkItem.enabled, 'its menu offers Fork into a new session');
	forkItem.click();
	check(await until(() => owned.list().some((x) => !before.has(x))), 'which starts a new session');
	const forked = owned.list().find((x) => !before.has(x));
	await sleep(300);
	const argsOf = fs.readdirSync(dir).filter((f) => f.startsWith('args-')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).find((a) => a.includes('--fork-session'));
	check(!!argsOf && argsOf[argsOf.indexOf('--resume') + 1] === id && argsOf[argsOf.indexOf('--session-id') + 1] === forked, 'from a copy of this one’s conversation, under its own id');
	check(owned.has(id) && inbox.log(id).some((e) => e.text === 'Forked into a new session'), 'and the original carries on');
	check(await until(() => talkId() === forked, 8000), 'its box opens on the copy');
	owned.end(forked);
	// Own worktree: only where there's a git repository to make one in.
	const lastArgs = () => fs.readdirSync(dir).filter((f) => f.startsWith('args-')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t).map((x) => JSON.parse(fs.readFileSync(path.join(dir, x.f), 'utf8')))[0];
	const plain = startSession(dir, ['--worktree']);
	await until(() => talkId() === plain, 8000);
	await sleep(300);
	check(!lastArgs().includes('--worktree') && inbox.log(plain).some((e) => /isn’t a git repository/.test(e.text)), 'Own worktree outside a git repository starts it in the folder, and says so');
	owned.end(plain);
	require('node:child_process').execFileSync('git', ['init', '-q'], { cwd: dir });
	const treed = startSession(dir, ['--worktree']);
	await until(() => talkId() === treed, 8000);
	await sleep(300);
	check(lastArgs().includes('--worktree') && !inbox.log(treed).some((e) => /isn’t a git repository/.test(e.text)), 'in one, it gets a worktree of its own (claude --worktree)');
	owned.end(treed);
	owned.end(id);

	// A session in a terminal (here: a stand-in process) brought into Blaube.
	const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-term-'));
	const tx = path.join(dir2, 'session.jsonl');
	const when = new Date(Date.now() - 60e3).toISOString();
	fs.writeFileSync(tx, [
		{ type: 'user', timestamp: when, message: { content: 'rename the tax helper' } },
		{ type: 'assistant', timestamp: when, message: { content: [{ type: 'text', text: 'Renamed it to taxOf.' }] } },
	].map((e) => JSON.stringify(e)).join('\n') + '\n');
	const term = require('node:child_process').spawn('sleep', ['120']);
	const gone = new Promise((r) => term.on('exit', (code, signal) => r(signal || code)));
	const BID = '11111111-2222-3333-4444-555555555555';
	tracker.handle({ session_id: BID, cwd: dir2, transcript_path: tx, hook_event_name: 'SessionStart', _pid: term.pid });
	tracker.handle({ session_id: BID, cwd: dir2, hook_event_name: 'UserPromptSubmit', _pid: term.pid });
	tracker.handle({ session_id: BID, cwd: dir2, hook_event_name: 'Stop', last_assistant_message: 'Renamed it to taxOf.', _pid: term.pid });
	await until(() => win.webContents.executeJavaScript(`!!__blaube.buddies.get(${JSON.stringify(BID)})`), 8000);
	await win.webContents.executeJavaScript(`window.blaube.talk(${JSON.stringify(BID)}, { x: 300, y: 600, r: 60 })`);
	check(await until(() => talkId() === BID && box(`[...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Bring it here')`), 8000), 'a session that can’t hear Blaube offers to bring it here');
	await box(`[...document.querySelectorAll('#quick button')].find((b) => b.textContent === 'Bring it here').click()`);
	check(await Promise.race([gone, sleep(5000).then(() => 'still there')]) === 'SIGTERM', 'it closes in its terminal');
	check(await until(() => owned.has(BID), 8000), 'and carries on in Blaube, same session');
	check(await until(async () => talkId() === BID && /Brought here from its terminal/.test(await said()) && /Renamed it to taxOf/.test(await said()), 8000), 'its box says so, with the conversation so far');
	await type('and the tests?');
	check(await until(async () => /claude-opus here\./.test(await said())), 'and it answers right here');
	owned.end(BID);

	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
