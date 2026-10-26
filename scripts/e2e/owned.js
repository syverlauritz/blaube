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
const A = process.argv.slice(2).join(' '), SIGNED = require('node:path').join(__dirname, 'signed-in');
if (A === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
if (A === 'doctor') { console.log('Claude Code doctor\\n\\nNo problems found'); process.exit(0); }
if (A === 'auth status --json') { console.log(JSON.stringify({ loggedIn: require('node:fs').existsSync(SIGNED) })); process.exit(0); }
if (A === 'plugin install demo --json') { console.log(JSON.stringify({ command: 'install', outcome: 'failed', plugin: 'demo', message: 'Confirm the command first', shownCommand: { command: 'npx demo-setup --yes', sha256: 'abcdef0123456789' } })); process.exit(1); }
if (A === 'plugin install demo --json --accept-command abcdef0123456789') { console.log(JSON.stringify({ command: 'install', outcome: 'installed', plugin: 'demo' })); process.exit(0); }
if (A === 'plugin install nope --json') { console.log(JSON.stringify({ command: 'install', outcome: 'failed', plugin: 'nope', message: 'Plugin "nope" not found in any configured marketplace', failureCode: 'not_found' })); process.exit(1); }
if (A === 'plugin disable demo') { console.log('✔ Disabled demo'); process.exit(0); }
if (A === 'plugin marketplace add acme/plugins') { console.log('✔ Added marketplace acme'); process.exit(0); }
if (A === 'auth logout') { try { require('node:fs').unlinkSync(SIGNED); } catch {} console.log('Successfully logged out from your Anthropic account.'); process.exit(0); }
if (A === 'auth login') { console.log('Opening your browser… https://claude.ai/oauth/authorize?fake=1'); setTimeout(() => { require('node:fs').writeFileSync(SIGNED, ''); console.log('Login successful.'); process.exit(0); }, 300); return; }
let model = 'claude-opus', turn = null, used = [12, 40], mcpUp = false, linear = 'connected'; const seen = new Set();
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
    if (r.subtype === 'apply_flag_settings') return ok({});
    if (r.subtype === 'background_tasks') return ok({ backgrounded: r.tool_use_id === 'tu-fg' });
    if (r.subtype === 'list_models') return ok({ models: [{ value: 'default', displayName: 'Default (recommended)', description: 'Sonnet 5.5 · Efficient for routine tasks' }, { value: 'opus', displayName: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks' }, { value: 'haiku', displayName: 'Haiku', description: 'Haiku 5.5 · Fastest for quick answers' }] });
    if (r.subtype === 'get_context_usage') return ok({ categories: [{ name: 'System tools', tokens: 29000, kind: 'used' }, { name: 'Messages', tokens: 61000, kind: 'used' }, { name: 'Free space', tokens: 410000, kind: 'free' }], totalTokens: 90000, maxTokens: 500000, percentage: 18 });
    if (r.subtype === 'rewind_files') return ok(seen.has(r.user_message_id) ? (r.dry_run ? { canRewind: true, filesChanged: ['/x/a.js', '/x/b.js'], insertions: 3, deletions: 1 } : { canRewind: true }) : { canRewind: false, error: 'No file checkpoint found for this message.' });
    if (r.subtype === 'mcp_status') return ok({ mcpServers: [{ name: 'github', status: mcpUp ? 'connected' : 'failed', error: 'ENOENT: no such file' }, { name: 'linear', status: linear }] });
    if (r.subtype === 'mcp_authenticate') { setTimeout(() => { linear = 'connected'; }, 400); return ok({ authUrl: 'https://mcp.linear.app/authorize?state=fake', requiresUserAction: true, callbackExpected: true }); }
    if (r.subtype === 'side_question') return setTimeout(() => ok({ response: 'It runs on **port 3000**.', synthetic: false }), 300);
    if (r.subtype === 'mcp_toggle') { if (r.serverName === 'linear') linear = r.enabled ? 'connected' : 'disabled'; return ok({}); }
    if (r.subtype === 'reload_plugins') { require('node:fs').writeFileSync(require('node:path').join(__dirname, 'reloaded'), ''); return ok({}); }
    if (r.subtype === 'get_status') return ok({ sections: [{ title: 'Session', rows: [{ label: 'Version', value: '9.9.9' }, { label: 'Login method', value: 'Claude Max account' }] }, { title: 'Environment', rows: [{ label: 'Model', value: model }, { label: 'MCP servers', value: '1 connected, 1 failed · /mcp' }] }] });
    if (r.subtype === 'get_memory_dialog') return ok({ files: [{ kind: 'user', path: require('node:os').homedir() + '/.claude/CLAUDE.md', exists: true }, { kind: 'project', path: process.cwd() + '/CLAUDE.md', exists: false }], memories: [{ name: 'pnpm.md', description: 'This repo uses pnpm, not npm' }] });
    if (r.subtype === 'get_session_cost') return ok({ text: 'Total cost:            $0.0123\\nTotal duration (API):  4s\\nTotal duration (wall): 1m 2s\\nTotal code changes:    3 lines added, 1 line removed' });
    if (r.subtype === 'mcp_reconnect') { mcpUp = r.serverName === 'github'; return ok({}); }
    if (r.subtype === 'get_usage') return ok({ session: {}, rate_limits_available: true, rate_limits: { five_hour: { utilization: used[0], resets_at: new Date(Date.now() + 7200e3).toISOString() }, seven_day: { utilization: used[1], resets_at: new Date(Date.now() + 4 * 86400e3).toISOString() } } });
    if (r.subtype === 'interrupt') { clearTimeout(turn); ok({}); return out({ type: 'result', subtype: 'error_during_execution', is_error: true }); }
    return;
  }
  if (m.type === 'user' && m.uuid && process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING === '1') seen.add(m.uuid);
  if (m.type === 'user' && m.message.content === '/compact') { out({ type: 'system', subtype: 'compact_boundary' }); return out({ type: 'result', subtype: 'success', result: '' }); }
  if (m.type === 'user' && m.message.content === '/output-style') { out({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Error: Nothing to show yet' }] } }); return out({ type: 'result', subtype: 'success', result: '' }); }
  if (m.type === 'user' && m.message.content === 'busy week') used = [30, 82];
  if (m.type === 'user' && m.message.content === 'nearly out') used = [93, 82];
  if (m.type === 'user' && m.message.content === 'busy week') out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.82, resetsAt: Math.round(Date.now() / 1000) + 3 * 86400, unifiedWindows: { five_hour: { utilization: 0.3, resetsAt: Math.round(Date.now() / 1000) + 3600, status: 'allowed' }, seven_day: { utilization: 0.82, resetsAt: Math.round(Date.now() / 1000) + 3 * 86400, status: 'allowed' } } } });
  if (m.type === 'user' && m.message.content === 'need linear') linear = 'needs-auth';
  if (m.type === 'user' && m.message.content === 'flaky') { out({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 4000, error_status: 529, error: 'overloaded' }); out({ type: 'system', subtype: 'model_fallback', content: 'Opus is overloaded, so this turn uses Sonnet.', originalModel: 'claude-opus', fallbackModel: 'claude-sonnet' }); }
  if (m.type === 'user' && m.message.content === 'signed out') return out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
  if (m.type === 'user') turn = setTimeout(() => out({ type: 'result', subtype: 'success', result: model + ' here.' }), m.message.content === 'slow' ? 20000 : m.message.content === 'edit two' || m.message.content === 'flaky' ? 1500 : m.message.content === 'start the server' ? 6000 : 50);
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
	// /effort: how hard it thinks, asked of Claude Code.
	await box(`(() => { const t = document.getElementById('text'); t.focus(); t.value = '/effort h'; t.setSelectionRange(9, 9); t.dispatchEvent(new Event('input')); })()`);
	check(await until(() => box(`(() => { const s = document.getElementById('suggest'); return !s.hidden && /^high/.test(s.textContent.trim()); })()`)), '/effort suggests its levels');
	await box(`(() => { const t = document.getElementById('text'); t.value = ''; t.dispatchEvent(new Event('input')); })()`);
	await type('/effort high');
	check(await until(() => inbox.log(id).some((e) => e.who === 'note' && e.text === 'Effort: high')), '/effort high changes how hard it thinks, no terminal');
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
	await type('/output-style');
	check(await until(async () => /Nothing to show yet/.test(await said())), 'what Claude Code itself answers a command shows');
	check(await until(() => tracker.sessions.get(id).state === 'done'), 'and the turn ends');
	await type('thoughts?');
	check(await until(() => inbox.log(id).some((e) => e.who === 'you' && /^\(I ran `echo hi there` myself\. It printed:\n```\nhi there\n```\)\n\nthoughts\?$/.test(e.text))), 'which then carries it');
	await until(() => tracker.sessions.get(id).state === 'done');
	// An MCP server that couldn't connect, as /mcp shows it, with Reconnect.
	check(await until(() => box(`!document.getElementById('mcp').hidden && document.getElementById('mcp').textContent.startsWith('github couldn’t connect')`)), 'an MCP server that couldn’t connect shows in its box');
	await box(`document.querySelector('#mcp button').click()`);
	check(await until(() => box(`document.getElementById('mcp').hidden`)) && inbox.log(id).some((e) => e.text === 'Reconnected github'), 'and Reconnect connects it, asked of Claude Code itself');
	await type('need linear');
	check(await until(() => box(`!document.getElementById('mcp').hidden && document.getElementById('mcp').textContent === 'linear needs you to sign inSign in'`)), 'one that needs you to sign in offers Sign in');
	await box(`document.querySelector('#mcp button').click()`);
	check(await until(() => global.__blaubeMcpAuthUrl === 'https://mcp.linear.app/authorize?state=fake' && inbox.log(id).some((e) => e.text === 'Finish signing in to linear in your browser')), 'which opens its sign-in in your browser (mcp_authenticate)');
	check(await until(() => inbox.log(id).some((e) => e.text === 'Signed in to linear: it’s connected') && box(`document.getElementById('mcp').hidden`)), 'and says when it’s connected');
	await until(() => tracker.sessions.get(id).state === 'done');
	await type('/cost');
	check(await until(() => inbox.log(id).some((e) => e.text === 'Total cost: $0.0123 · Total duration (API): 4s · Total duration (wall): 1m 2s · Total code changes: 3 lines added, 1 line removed')), '/cost says what it has cost, asked of Claude Code (get_session_cost)');
	await type('/mcp disable linear');
	check(await until(() => inbox.log(id).some((e) => e.text === 'Turned linear off')), '/mcp disable turns an MCP server off (mcp_toggle)');
	await type('/mcp');
	check(await until(() => inbox.log(id).some((e) => /^Its MCP servers: .*linear \(turned off\)/.test(e.text || ''))), 'and /mcp says so');
	await type('/mcp enable linear');
	check(await until(() => inbox.log(id).some((e) => e.text === 'Turned linear on')), 'and /mcp enable turns it back on');
	await type('/rewind');
	check(await until(() => inbox.log(id).some((e) => /^To go back, tap edit under something you said/.test(e.text || ''))), '/rewind says how to go back, here');
	await type('/memory');
	check(await until(() => inbox.log(id).some((e) => e.text === 'It reads ~/.claude/CLAUDE.md. It remembers: pnpm (This repo uses pnpm, not npm)')), '/memory lists what it reads and what it has remembered (get_memory_dialog)');
	// Claude's servers busy: the box says it's trying again, not just dots.
	await type('flaky');
	check(await until(() => box(`/Claude’s servers are overloaded: trying again in 4s \\(2 of 10\\)/.test(document.getElementById('inner').textContent)`), 3000), 'while Claude Code tries again, the box says why (api_retry)');
	check(await until(() => inbox.log(id).some((e) => e.text === 'Opus is overloaded, so this turn uses Sonnet.')), 'and when it falls back to another model, says so (model_fallback)');
	await until(() => tracker.sessions.get(id).state === 'done');
	// Plugins from the box: Claude Code's own plugin commands, as steps.
	await type('/plugin marketplace add acme/plugins');
	check(await until(() => inbox.log(id).some((e) => e.who === 'step' && e.text === 'Marketplace acme/plugins: added (claude plugin marketplace add)' && !e.running)), '/plugin marketplace add adds a marketplace');
	global.__blaubeAcceptPluginCommand = true;
	await type('/plugin install demo');
	check(await until(() => global.__blaubePluginCommand === 'npx demo-setup --yes'), '/plugin install shows the command a plugin installs by running, before it runs');
	check(await until(() => inbox.log(id).some((e) => e.text === 'It can use demo now') && fs.existsSync(path.join(dir, 'reloaded'))), 'and once you say yes, installs it and loads it (reload_plugins)');
	await type('/plugin install nope');
	check(await until(() => inbox.log(id).some((e) => e.error && e.text === 'Couldn’t install nope: Plugin "nope" not found in any configured marketplace')), 'and says why when it can’t');
	await type('/plugin disable demo');
	check(await until(() => inbox.log(id).some((e) => e.who === 'step' && e.text === 'demo: turned off (claude plugin disable)' && !e.running)), '/plugin disable turns one off');
	await type('slow');
	await until(() => tracker.sessions.get(id).state === 'working', 3000);
	await type('/btw what port?');
	check(await until(() => box(`(() => { const a = [...document.querySelectorAll('#inner .aside')].pop(); return !!a && (a.querySelector('.asideq') || {}).textContent === 'what port?' && (a.querySelector('.asidea b') || {}).textContent === 'port 3000'; })()`)), '/btw asks a quick question on the side, answered while it works (side_question)');
	check(tracker.sessions.get(id).state === 'working' && !inbox.log(id).some((e) => e.who === 'you' && /what port/.test(e.text)) && !(await box(`[...document.querySelectorAll('#inner .note')].some((e) => /^Asked on the side/.test(e.textContent))`)), 'without becoming part of the conversation');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	await until(() => tracker.sessions.get(id).state !== 'working', 3000);
	// Its usage limits, asked of Claude Code after each turn (get_usage).
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	check(await until(() => box(`/^Usage: 12% of 5 hours \\(resets .+\\) · 40% of the week/.test((document.querySelector('#overview .usage') || {}).textContent || '')`)), 'the overview has your usage limits, asked of Claude Code after a turn');
	check(global.__blaubeTrayMenu().items.some((i) => /^Usage: 12% of 5 hours \(resets .+\) · 40% of the week/.test(i.label)), 'and so does the menu bar menu');
	check(await until(() => box(`/Claude Code is signed out/.test((document.querySelector('#overview .signedout') || {}).textContent || '')`)), 'a signed-out Claude Code shows at the top of the overview, asked of claude auth status');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	await until(() => box(`!document.body.classList.contains('overview')`));
	// Signed out: Sign in runs claude auth login (your browser), no terminal.
	await type('signed out');
	check(await until(() => box(`[...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Sign in')`)), 'a turn that fails for being signed out offers Sign in');
	await box(`[...document.querySelectorAll('#quick button')].find((b) => b.textContent === 'Sign in').click()`);
	check(await until(() => inbox.log(id).some((e) => /the page is https:\/\/claude\.ai\/oauth\/authorize\?fake=1/.test(e.text || ''))), 'it says the sign-in page, for when no browser opens');
	check(await until(() => inbox.log(id).some((e) => e.text === 'Signed in. Try again to carry on.')), 'and says when it’s signed in');
	check(fs.existsSync(path.join(dir, 'signed-in')), 'through claude auth login');
	fs.rmSync(path.join(dir, 'signed-in'));
	await type('/login');
	check(await until(() => fs.existsSync(path.join(dir, 'signed-in'))) && !inbox.log(id).some((e) => e.who === 'you' && e.text === '/login'), '/login signs in the same way, without going to Claude');
	await type('/mcp');
	check(await until(() => inbox.log(id).some((e) => e.text === 'Its MCP servers: github (connected) · linear (connected)')), '/mcp lists its MCP servers and how they are');
	await type('/status');
	check(await until(() => inbox.log(id).some((e) => /^Claude Code 9\.9\.9 · .+ · in .+ · started by Blaube$/.test(e.text || ''))), '/status says what it’s running on');
	check(await until(() => box(`(() => { const d = [...document.querySelectorAll('#inner .statusmore')].pop(); if (!d) return false; d.open = true; return /Login methodClaude Max account/.test(d.textContent) && /MCP servers1 connected, 1 failed/.test(d.textContent); })()`)), 'with everything Claude Code’s own /status says a tap away (get_status)');
	await type('/export');
	check(await until(() => inbox.log(id).some((e) => /^Saved the conversation to Downloads\/.+\.md$/.test(e.text || '') && fs.existsSync(e.file))), '/export saves the conversation to Downloads');
	await type('/doctor');
	check(await until(() => inbox.log(id).some((e) => e.who === 'step' && e.text === 'Checked Claude Code (claude doctor)' && !e.running && /No problems found/.test(e.detail || ''))), '/doctor runs Claude Code’s checkup right there, as a step');
	await type('/bug the box froze');
	check(await until(() => inbox.log(id).some((e) => e.text === 'Opened a new Claude Code issue in your browser, its version and system filled in') && /^https:\/\/github\.com\/anthropics\/claude-code\/issues\/new\?title=the\+box\+froze&body=.*Claude\+Code%3A\+9\.9\.9/.test(global.__blaubeBugUrl || '')), '/bug opens a new Claude Code issue, its version filled in');
	await type('/usage');
	check(await until(() => inbox.log(id).some((e) => /^Used: 12% of 5 hours \(resets .+\) · 40% of the week/.test(e.text || ''))), '/usage says how much of your limits you’ve used');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	check(await until(() => box(`document.body.classList.contains('overview') && !document.querySelector('#overview .signedout')`)), 'and the overview no longer says signed out');
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
	check(!global.__blaubeLimitNews, 'no notification at 82%');
	await type('nearly out');
	check(await until(() => global.__blaubeLimitNews && global.__blaubeLimitNews.title === '93% of your 5-hour limit used'), 'at 90% a notification says so, once');
	await until(() => tracker.sessions.get(id).state === 'done');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	check(await until(() => box(`/^Usage: 93% of 5 hours \\(resets .+\\) · 82% of the week \\(resets \\w+\\)$/.test((document.querySelector('#overview .usage') || {}).textContent || '')`)), 'and the overview has how much of each limit is used, and when it resets');
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
	await type('slow');
	await until(() => tracker.sessions.get(id).state === 'working', 3000);
	const stopItem = () => { const r = global.__blaubeTrayMenu().items.find((i) => i.submenu && i.submenu.items.some((x) => x.label === 'Stop')); return r && r.submenu.items.find((x) => x.label === 'Stop'); };
	check(await until(() => !!stopItem(), 3000), 'while it works, the menu bar menu has Stop for it');
	stopItem().click();
	check(await until(() => tracker.sessions.get(id).state !== 'working', 3000), 'which stops it at once');

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
	// A new session's model, from the overview: the ones Claude Code offers.
	const was = new Set(owned.list());
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	check(await until(() => box(`(() => { const p = document.querySelector('#overview .newmodel'); return !!p && [...p.options].map((o) => o.textContent).join() === 'Default,Opus,Haiku'; })()`)), 'the overview offers a model for a new session, as Claude Code lists them');
	if (process.env.BLAUBE_SHOTS) { await box(`document.querySelector('#overview .newmodel').scrollIntoView({ block: 'center' })`); await sleep(400); fs.writeFileSync(path.join(__dirname, '..', '..', 'shots', 'owned-newmodel.png'), (await talk().webContents.capturePage()).toPNG()); }
	await box(`(() => { const p = document.querySelector('#overview .newmodel'); p.value = 'haiku'; p.dispatchEvent(new Event('change')); [...document.querySelectorAll('#overview .chips button')].find((b) => b.textContent === ${JSON.stringify(path.basename(dir))}).click(); })()`);
	check(await until(() => owned.list().some((x) => !was.has(x)), 8000), 'and starts it there');
	const picked = owned.list().find((x) => !was.has(x));
	await sleep(300);
	check(lastArgs()[lastArgs().indexOf('--model') + 1] === 'haiku', 'on the model picked (--model haiku)');
	owned.end(picked);
	require('node:child_process').execFileSync('git', ['init', '-q'], { cwd: dir });
	const treed = startSession(dir, ['--worktree']);
	await until(() => talkId() === treed, 8000);
	await sleep(300);
	check(lastArgs().includes('--worktree') && !inbox.log(treed).some((e) => /isn’t a git repository/.test(e.text)), 'in one, it gets a worktree of its own (claude --worktree)');
	owned.end(treed);
	// Quitting can move the sessions it started to terminals of their own.
	const a1 = startSession(dir), a2 = startSession(dir);
	await until(() => owned.has(a1) && owned.has(a2) && !!tracker.sessions.get(a1) && !!tracker.sessions.get(a2), 8000);
	const moved = [];
	await global.__blaubeMoveAll((s) => moved.push(s.id));
	check(!owned.has(a1) && !owned.has(a2) && moved.includes(a1) && moved.includes(a2), 'quitting can move every session it started to a terminal of its own');
	owned.end(id);

	// A session in a terminal (here: a stand-in process) brought into Blaube.
	const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-term-'));
	const tx = path.join(dir2, 'session.jsonl');
	const when = new Date(Date.now() - 60e3).toISOString();
	fs.writeFileSync(tx, [
		{ type: 'user', uuid: 'b-u1', timestamp: when, message: { content: 'rename the tax helper' } },
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
	await type('/compact');
	check(await until(() => inbox.log(BID).some((e) => /^\/compact is for Claude Code itself.*Or bring it here: it goes straight in then/.test(e.text || ''))), 'a command it can’t take there says bringing it here would');
	await box(`[...document.querySelectorAll('#quick button')].find((b) => b.textContent === 'Bring it here').click()`);
	check(await Promise.race([gone, sleep(5000).then(() => 'still there')]) === 'SIGTERM', 'it closes in its terminal');
	check(await until(() => owned.has(BID), 8000), 'and carries on in Blaube, same session');
	check(await until(async () => talkId() === BID && /Brought here from its terminal/.test(await said()) && /Renamed it to taxOf/.test(await said()), 8000), 'its box says so, with the conversation so far');
	check(await until(() => inbox.log(BID).some((e) => e.text === 'Compacted: it carries on from a summary of the conversation so far'), 8000), 'and the command you typed goes in, now it can take it');
	check(await until(() => box(`[...document.querySelectorAll('#inner .msg.you')].some((e) => e.dataset.text === 'rename the tax helper' && e.nextElementSibling && e.nextElementSibling.matches('.meta.edit'))`)), 'what you said in its terminal can be edited here too');
	await type('and the tests?');
	check(await until(async () => /claude-opus here\./.test(await said())), 'and it answers right here');
	owned.end(BID);

	// /clear: a fresh conversation, a new session in its slime's place.
	const CID = startSession(dir);
	check(await until(() => talkId() === CID, 8000), 'another session starts');
	await type('hello');
	await until(() => inbox.log(CID).some((e) => e.who === 'claude'));
	await type('/clear');
	check(await until(() => talkId() && talkId() !== CID && owned.has(talkId()) && !owned.has(CID)), '/clear starts a fresh session that takes its place, in the same box');
	const NID = talkId();
	check(inbox.log(NID).length === 1 && /^Cleared: a fresh conversation/.test(inbox.log(NID)[0].text) && !tracker.sessions.has(CID) && tracker.sessions.has(NID), 'the box starts afresh, with one slime still');
	check(await until(() => fs.readdirSync(dir).filter((f) => f.startsWith('args-')).some((f) => { const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return a[a.indexOf('--session-id') + 1] === NID; })), 'started as a new session of Claude Code');
	await type('and now?');
	check(await until(async () => /claude-opus here\./.test(await said())), 'and it answers there');
	// /add-dir: another folder, Claude Code started again with it, same conversation.
	const other = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-other-'));
	await type('/add-dir ' + other);
	check(await until(() => inbox.log(NID).some((e) => e.text === `It can work in ${other} too`), 10000), '/add-dir adds a folder it may work in');
	check(owned.has(NID) && fs.readdirSync(dir).filter((f) => f.startsWith('args-')).some((f) => { const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return a[a.indexOf('--resume') + 1] === NID && a[a.indexOf('--add-dir') + 1] === other; }), 'by starting it again with --add-dir, same session');
	await type('/add-dir /no/such/folder');
	check(await until(() => inbox.log(NID).some((e) => e.error && e.text === 'There’s no folder at /no/such/folder')), 'and says so when there’s no such folder');
	await type('still there?');
	check(await until(async () => (await said()).split('claude-opus here.').length > 2), 'and it still answers');
	await type('/exit');
	check(await until(() => !owned.has(NID) && inbox.log(NID).some((e) => /^Ended\. Its conversation is kept/.test(e.text || ''))), '/exit ends a session Blaube started');

	// Editing something you said (Esc Esc in the terminal): back to before it,
	// its files put back, then the new words go instead.
	const EID = startSession(dir);
	check(await until(() => talkId() === EID, 8000), 'another session starts');
	await type('first');
	await until(() => inbox.log(EID).some((e) => e.who === 'claude'));
	await type('second');
	await until(() => inbox.log(EID).filter((e) => e.who === 'claude').length === 2);
	const [u1, u2] = inbox.log(EID).filter((e) => e.who === 'you').map((e) => e.uuid);
	const file = require('../../src/main/focus').transcriptPath(tracker.sessions.get(EID));
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, [{ type: 'user', uuid: u1, parentUuid: null }, { type: 'assistant', uuid: 'a1', parentUuid: u1 }, { type: 'user', uuid: u2, parentUuid: 'a1' }].map((e) => JSON.stringify(Object.assign({ sessionId: EID }, e))).join('\n') + '\n');
	check(await until(() => box(`document.querySelectorAll('#inner .meta.edit button').length === 2`)), 'your own messages can be edited');
	await box(`[...document.querySelectorAll('#inner .meta.edit button')].pop().click()`);
	check(await until(() => box(`document.getElementById('text').value === 'second' && !document.getElementById('editing').hidden`)), 'edit puts it back in the field, saying what sending does');
	await type('second, better');
	check(await until(() => talkId() && talkId() !== EID && owned.has(talkId()) && !owned.has(EID)), 'sending it goes back: a copy cut before it takes its place');
	const FID = talkId();
	check(await until(() => fs.readdirSync(dir).filter((f) => f.startsWith('args-')).some((f) => { const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return a[a.indexOf('--resume') + 1] === EID && a.includes('--fork-session') && a[a.indexOf('--session-id') + 1] === FID && a[a.indexOf('--resume-session-at') + 1] === 'a1'; })), 'cut at the reply before it (--resume-session-at)');
	const said2 = inbox.log(FID).filter((e) => e.who === 'you').map((e) => e.text);
	check(said2.length === 2 && said2[0] === 'first' && /second, better$/.test(said2[1]) && inbox.log(FID).some((e) => e.text === 'Went back to before that message, and put its files back. The conversation as it was is under Pick up where you left off.'), 'the box keeps what came before, and the new words go instead');
	check(await until(() => inbox.log(FID).filter((e) => e.who === 'claude').length === 2), 'and it answers them');
	check(await until(() => box(`document.getElementById('editing').hidden && document.getElementById('text').value === ''`)), 'and the field is free again');
	owned.end(FID);
	fs.rmSync(file, { force: true });

	// /logout: Claude Code signed out (claude auth logout), and the overview knows.
	const LID = startSession(dir);
	check(await until(() => talkId() === LID, 8000), 'another session starts');
	await type('/logout');
	check(await until(() => inbox.log(LID).some((e) => e.who === 'step' && e.text === 'Signed Claude Code out (claude auth logout)' && !e.running && /logged out/.test(e.detail || ''))), '/logout signs Claude Code out, as a step');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	check(await until(() => box(`document.body.classList.contains('overview') && !!document.querySelector('#overview .signedout')`)), 'and the overview says it’s signed out, with Sign in');
	await box(`document.querySelector('#overview .signedout button').click()`);
	check(await until(() => box(`!document.querySelector('#overview .signedout')`)), 'and Sign in there signs it back in');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	owned.end(LID);

	// Clone a repository, then a session in it: no terminal for the clone.
	const gitSrc = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-src-')), 'tiny');
	fs.mkdirSync(gitSrc);
	require('node:child_process').execFileSync('git', ['init', '-q', gitSrc]);
	require('node:child_process').execFileSync('git', ['-C', gitSrc, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'x']);
	global.__blaubeCloneParent = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-parent-'));
	const CLID = startSession(dir);
	check(await until(() => talkId() === CLID, 8000), 'another session starts');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
	check(await until(() => box(`[...document.querySelectorAll('#overview .chips button')].some((b) => b.textContent === 'Clone a repository…')`)), 'the overview offers Clone a repository…');
	const cloneIt = (what) => box(`(() => { const b = [...document.querySelectorAll('#overview .chips button')].find((x) => x.textContent === 'Clone a repository…'); if (b) b.click(); const f = document.querySelector('#overview .cloneform'); f.querySelector('input').value = ${JSON.stringify('x')}.replace('x', ${JSON.stringify(what)}); f.requestSubmit(); })()`);
	await cloneIt('fix the login bug');
	check(await until(() => box(`(document.querySelector('#overview .clonesaid') || {}).textContent === 'That doesn’t look like a repository: paste its address, or owner/repo for GitHub'`)), 'something that isn’t a repository says so');
	await cloneIt('file://' + gitSrc);
	const clonedTo = path.join(global.__blaubeCloneParent, 'tiny');
	check(await until(() => fs.existsSync(path.join(clonedTo, '.git')) && owned.list().some((x) => (tracker.sessions.get(x) || {}).cwd === clonedTo), 10000), 'a repository is cloned next to your projects, and a session starts in it');
	owned.end(CLID);
	for (const x of owned.list()) if ((tracker.sessions.get(x) || {}).cwd === clonedTo) owned.end(x);

	// Claude Code's own defaults for new sessions, from Blaube's menu.
	global.__blaubeCcHome = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-cchome-'));
	const ccMenu = () => global.__blaubeTrayMenu().items.find((i) => i.label === 'Claude Code defaults');
	check(!!ccMenu() && ccMenu().submenu.items.find((i) => i.label === 'Default').checked && ccMenu().submenu.items.find((i) => i.label === 'Ask before acting').checked, 'the menu has Claude Code’s defaults for new sessions');
	ccMenu().submenu.items.find((i) => i.label === 'Haiku').click();
	ccMenu().submenu.items.find((i) => i.label === 'Accept edits').click();
	const ccFile = path.join(global.__blaubeCcHome, '.claude', 'settings.json');
	check(JSON.stringify(JSON.parse(fs.readFileSync(ccFile, 'utf8'))) === JSON.stringify({ model: 'haiku', permissions: { defaultMode: 'acceptEdits' } }), 'picking a model and a mode there writes them to its settings file');
	check(ccMenu().submenu.items.find((i) => i.label === 'Haiku').checked && ccMenu().submenu.items.find((i) => i.label === 'Accept edits').checked, 'and the menu shows them');

	// Install Claude Code from the menu: its official installer (a stand-in here).
	let ran = null;
	global.__blaubeInstallRun = (bin, args) => {
		ran = [bin, ...args];
		const { EventEmitter } = require('node:events');
		const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {};
		setTimeout(() => { p.stdout.emit('data', '✔ Claude Code installed\n'); p.emit('close', 0); }, 50);
		return p;
	};
	global.__blaubeInstall();
	check(await until(() => global.__blaubeInstalled && global.__blaubeInstalled.ok), 'Install Claude Code runs its official installer, no terminal');
	check(!!ran && /install\.(sh|ps1)/.test(ran.join(' ')), 'the one its setup page has you paste');
	check(await until(() => global.__blaubeAfterInstall === true), 'and then checks it’s signed in');

	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
