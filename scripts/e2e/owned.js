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
let model = 'claude-opus', turn = null;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'init', permissionMode: 'default' });
require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.type === 'control_request') {
    const r = m.request, ok = (response) => out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } });
    if (r.subtype === 'set_model') { model = 'claude-' + r.model; return ok({ model }); }
    if (r.subtype === 'set_permission_mode') { ok({ mode: r.mode }); return out({ type: 'system', subtype: 'status', permissionMode: r.mode }); }
    if (r.subtype === 'interrupt') { clearTimeout(turn); ok({}); return out({ type: 'result', subtype: 'error_during_execution', is_error: true }); }
    return;
  }
  if (m.type === 'user' && m.message.content === '/compact') { out({ type: 'system', subtype: 'compact_boundary' }); return out({ type: 'result', subtype: 'success', result: '' }); }
  if (m.type === 'user' && m.message.content === '/cost') { out({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Error: Nothing to show yet' }] } }); return out({ type: 'result', subtype: 'success', result: '' }); }
  if (m.type === 'user') turn = setTimeout(() => out({ type: 'result', subtype: 'success', result: model + ' here.' }), m.message.content === 'slow' ? 20000 : 50);
});
`;

module.exports = async function run({ win, owned, startSession, talk, talkId, tracker, inbox }) {
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

	await type('/model sonnet');
	check(await until(async () => /Now using claude-sonnet/.test(await said())), '/model sonnet switches its model, no terminal');
	await type('hello');
	check(await until(async () => /claude-sonnet here\./.test(await said())), 'and it answers as that model');
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

	await type('/compact');
	check(await until(async () => /Compacted: it carries on from a summary/.test(await said())), '/compact goes straight in, and says when it’s done');
	await type('/cost');
	check(await until(async () => /Nothing to show yet/.test(await said())), 'what Claude Code itself answers a command shows');
	check(await until(() => tracker.sessions.get(id).state === 'done'), 'and the turn ends');
	await type('slow');
	check(await until(() => tracker.sessions.get(id).state === 'working', 3000), 'a long turn starts');
	check(await until(() => box(`!document.getElementById('stop').hidden`)), 'with Stop beside its name');
	await box(`document.getElementById('stop').click()`);
	check(await until(() => tracker.sessions.get(id).state !== 'working', 3000), 'Stop stops it at once (not at its next step)');
	await sleep(300);
	const text = await said();
	check(/You asked it to stop/.test(text) && !/Something went wrong/.test(text), 'and says you stopped it, not that something went wrong');
	check(await until(() => box(`[...document.querySelectorAll('#quick button')].some((b) => b.textContent === 'Carry on')`)), 'with Carry on a tap away');

	owned.end(id);
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
