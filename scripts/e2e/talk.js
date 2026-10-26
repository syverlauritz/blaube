// End-to-end check of talking to a slime, in the real app but invisible:
//
//   npm run e2e
//
// Fakes a session through the hook server, clicks its slime with real mouse
// events, types into the talk box, runs the same hook commands Claude Code
// would (the inbox and permission hooks), and checks what happens at each
// step. Saves pictures to shots/e2e-*.png. Exits non-zero on a failure.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BrowserWindow } = require('electron');
const { inboxCommand, permissionCommand } = require('../../src/main/claudeHooks');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A POSIX shell for the hook commands: sh, or Git's bash on Windows (where
// sh may not be on PATH). A shell that won't start fails the check, never
// pops an error dialog.
const SH = process.platform !== 'win32' ? 'sh' : [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')].find((p) => fs.existsSync(p)) || 'bash';
const sh = (args, opts) => {
	const p = spawn(SH, args, opts);
	p.on('error', (e) => { console.log(`FAIL couldn’t start a shell (${SH}): ${e.message}`); p.emit('exit', -1, null); });
	return p;
};

module.exports = async function run({ win, inbox, PORT, talk, talkId, pinned }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	const page = (js) => win.webContents.executeJavaScript(js);
	const box = (js) => talk().webContents.executeJavaScript(js);
	const hook = (payload) => new Promise((done) => {
		const req = http.request({ host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli' } }, (res) => { res.resume(); res.on('end', done); });
		req.end(JSON.stringify(Object.assign({ session_id: ID, cwd: '/tmp/kalkis' }, payload)));
	});
	const runHook = (cmd, payload, env = {}) => {
		const p = sh(['-c', cmd], { env: Object.assign({}, process.env, env) });
		let out = '', err = '';
		p.stdout.on('data', (d) => { out += d; });
		p.stderr.on('data', (d) => { err += d; });
		const done = new Promise((r) => p.on('exit', (code) => r({ code, out, err })));
		p.stdin.end(JSON.stringify(payload));
		return { done, kill: () => p.kill() };
	};
	const click = async (x, y) => {
		for (const type of ['mouseDown', 'mouseUp']) {
			win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
			await sleep(60);
		}
	};
	// Clicks where the slime is once it stands still (like a person aiming).
	// A slime that's done hops for attention, so a click can catch it taking
	// off: then aim and click again, as a person would.
	const clickSlime = async () => {
		const wasOpen = !!(talk() && talk().isVisible());
		for (let attempt = 0; attempt < 3; attempt++) {
			await clickSlimeOnce();
			if (await until(() => !!(talk() && talk().isVisible()) !== wasOpen, 1200)) return;
		}
	};
	const clickSlimeOnce = async () => {
		let a = await slime();
		for (let i = 0; i < 60; i++) {
			await sleep(100);
			const b = await slime();
			// (Its own clock has to have moved on: a page between frames looks still too.)
			if (b.at > a.at && b.floor && Math.abs(b.vy) < 40 && Math.abs(b.r - a.r) < 0.5 && Math.hypot(b.x - a.x, b.y - a.y) < 1) { a = b; break; }
			a = b;
		}
		last = a;
		await click(a.x, a.y);
	};
	const slime = () => page(`(() => { const b = __blaube.buddies.get(${JSON.stringify(ID)}); if (!b) return null; const c = b.body.centroid(), r = b.body.o.radius; return { x: c.x, y: c.y, r, look: b.body.lookTop, minY: b.body.bbox().minY, top: Math.min(b.body.lookTop ?? Infinity, c.y - r), floor: b.body.onFloor(), vy: b.body.velocity(1 / 120).y, at: __blaube.now() }; })()`);
	const shot = async (name) => {
		const wb = win.getBounds(), tw = talk(), shown = tw && tw.isVisible();
		const bg = (await win.webContents.capturePage()).toDataURL();
		const fg = shown ? (await tw.webContents.capturePage()).toDataURL() : null;
		const tb = shown ? tw.getBounds() : null;
		const cw = new BrowserWindow({ width: 400, height: 300, show: false });
		await cw.loadURL('about:blank');
		const png = await cw.webContents.executeJavaScript(`(async () => {
			const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
			const b = await load(${JSON.stringify(bg)}), f = ${fg ? `await load(${JSON.stringify(fg)})` : 'null'};
			const k = b.width / ${wb.width};
			// Just the part of the screen around the slime and its box.
			const x0 = ${Math.max(0, (tb ? Math.min(tb.x, wb.x + last.x - 200) : wb.x + last.x - 300) - wb.x)}, y0 = ${Math.max(0, (tb ? tb.y : wb.y + last.y - 450) - wb.y - 20)};
			const w = 760, h = ${Math.round(wb.height)} - y0;
			const c = document.createElement('canvas'); c.width = w * k; c.height = h * k;
			const g = c.getContext('2d');
			g.fillStyle = '#2a2c31'; g.fillRect(0, 0, c.width, c.height);
			g.drawImage(b, -x0 * k, -y0 * k);
			${tb ? `g.drawImage(f, (${tb.x - wb.x} - x0) * k, (${tb.y - wb.y} - y0) * k, ${tb.width} * k, ${tb.height} * k);` : ''}
			return c.toDataURL('image/png');
		})()`);
		cw.destroy();
		fs.mkdirSync(OUT, { recursive: true });
		fs.writeFileSync(path.join(OUT, `e2e-${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
	};

	const consoleLines = [];
	win.webContents.on('console-message', (...a) => { const m = a[a.length - 1] && a[a.length - 1].message ? a[a.length - 1].message : a[2]; consoleLines.push(String(m)); if (consoleLines.length > 40) consoleLines.shift(); });
	const ID = 'e2e-' + Date.now();
	let last = { x: 0, y: 0 };
	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);

	// A session that's done a turn.
	await hook({ hook_event_name: 'SessionStart' });
	await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'add the 2027 tax brackets' });
	await hook({ hook_event_name: 'Stop', last_assistant_message: 'Done! The **2027 brackets** are in `src/tax.js`.' });
	// After a turn its inbox hook waits for a message, as in Claude Code.
	const waiting = runHook(inboxCommand(PORT), { session_id: ID, hook_event_name: 'Stop' });
	check(await until(async () => !!(await slime()), 6000), 'its slime appears');
	// Landed, and grown to its full size.
	for (let i = 0, a = await slime(); i < 100; i++) { await sleep(100); const b = await slime(); if (b.at - a.at > 0.05 && b.floor && Math.abs(b.r - a.r) < 0.2) break; a = b; }
	await sleep(500);
	last = await slime();

	// Click it: the talk box opens above it, tail pointing at it.
	await clickSlime();
	const opened = await until(() => talk() && talk().isVisible());
	check(opened, 'clicking the slime opens its talk box');
	if (!opened) console.log('     last page logs:\n       ' + consoleLines.slice(-10).join('\n       '), '\n     slime now', JSON.stringify(await slime()), 'clicked at', JSON.stringify(last), 'talkId', talkId());
	check(talkId() === ID, 'for that session');
	await sleep(400);
	const wb = win.getBounds(), tb = talk().getBounds();
	last = await slime(); // where it is now (it may have been mid-hop when clicked; the box follows)
	// It drifts after its slime, so let both settle first (the slime can
	// still be coming down from a hop, or from being caught mid-hop by the
	// click): until neither has moved for a moment. Counted in the slimes'
	// own time: under xvfb, with the talk box up, their frames come slowly
	// and a second of real time can be a tenth of one for them.
	const t0 = await page('__blaube.now()');
	for (let i = 0, prev = null; i < 150; i++) {
		await sleep(300);
		const s = await slime(), t = talk().getBounds(), now = { y: s.y, ty: t.y, tx: t.x, at: await page('__blaube.now()') };
		if (now.at - t0 > 2.5 && prev && now.at - prev.at > 0.15 && Math.abs(now.y - prev.y) < 2 && now.ty === prev.ty && now.tx === prev.tx) break;
		if (!prev || now.at - prev.at > 0.15) prev = now;
	}
	// Its head's top bobs with its breath and its ears' sway (the box only
	// follows real moves), so take the middle of a second's worth.
	const tops = [];
	for (let i = 0; i < 10; i++) { last = await slime(); tops.push(last.top); await sleep(100); }
	last.top = tops.sort((a, b) => a - b)[5];
	const wbs = win.getBounds(), tbs = talk().getBounds();
	Object.assign(tb, tbs); Object.assign(wb, wbs);
	// The bubble floats a little above the head (its tail is drawn by the
	// slime's layer, from under the bubble down to the head).
	const bubbleBottom = tb.y + tb.height - 12, headTop = wb.y + last.top;
	check(bubbleBottom < headTop - 15 && bubbleBottom > headTop - 60, `the bubble floats just above its head (${Math.round(headTop - bubbleBottom)} px)`);
	check(tb.x + 12 < wb.x + last.x && tb.x + tb.width - 12 > wb.x + last.x, 'right over it');
	// When a reply makes it taller it grows up, away from the slime: watch it
	// frame by frame, it never comes down over the head.
	await hook({ hook_event_name: 'Stop', last_assistant_message: 'A longer answer, so the box has to grow.\n\nIt keeps going for a few lines.\nAnd a few more.\nAnd one more.' });
	let lowest = -Infinity;
	for (let i = 0; i < 30; i++) { const b = talk().getBounds(); lowest = Math.max(lowest, b.y + b.height - 12); await sleep(40); }
	const heads = [];
	for (let i = 0; i < 10; i++) { heads.push((await slime()).top); await sleep(100); }
	const head2 = win.getBounds().y + heads.sort((a, b) => a - b)[5]; // (the middle: it breathes)
	check(lowest < head2 - 10, `growing, it never covers the head (closest ${Math.round(head2 - lowest)} px above)`);
	const texts = await box(`[...document.querySelectorAll('#inner .msg')].map((e) => e.textContent)`);
	check(texts.length === 3 && /2027 brackets/.test(texts[1]), 'it shows the conversation so far');
	check(await box(`document.getElementById('hint').textContent === ''`), 'no “update the connection” note for a session whose hooks reach us');
	check(await box(`!!document.querySelector('#inner .msg.claude b')`), 'with formatting (bold)');
	check(await page(`__blaube.buddies.get(${JSON.stringify(ID)}) && true`), 'the slime is still there');
	await shot('open');

	// Send a message: the session's inbox hook gets it.
	check(await until(() => inbox.view(ID).inbox === 'ready'), 'the session’s inbox hook is waiting');
	await box(`(() => { const t = document.getElementById('text'); t.value = 'and update the changelog'; t.dispatchEvent(new Event('input')); document.getElementById('form').requestSubmit(); })()`);
	check(await until(() => page(`(__blaube.buddies.get(${JSON.stringify(ID)}) || {}).listenAt > 0`), 1500), 'its slime listens while you type');
	const got = await Promise.race([waiting.done, sleep(3000).then(() => null)]);
	check(got && got.code === 2 && /update the changelog/.test(got.err), 'sending wakes Claude with the message (exit 2)');
	check(await until(async () => (await box(`document.querySelectorAll('#inner .dots').length`)) === 1), 'thinking dots while it works on it');
	await hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/tmp/kalkis/CHANGELOG.md' } });
	check(await until(async () => (await box(`(document.querySelector('#inner .dots .doing') || {}).textContent`)) === 'Editing CHANGELOG.md'), 'with what it’s doing next to them');
	await shot('thinking');
	await hook({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<summary>Stop hook feedback</summary>' });
	const spokeBefore = await page(`(() => { const b = __blaube.buddies.get(${JSON.stringify(ID)}); return b && b.speech ? b.speech.at : null; })()`);
	await hook({ hook_event_name: 'Stop', last_assistant_message: 'Changelog updated.' });
	check(await until(async () => (await box(`[...document.querySelectorAll('#inner .msg')].map((e) => e.textContent).join('|')`)).endsWith('and update the changelog|Changelog updated.')), 'the reply comes in after the message, in order');
	// Sound only with a bubble saying it: the box shows the reply, so the
	// slime keeps quiet (and a turn a hook prompted gets no cheer).
	await sleep(1200);
	check(await page(`(() => { const b = __blaube.buddies.get(${JSON.stringify(ID)}); return (b && b.speech ? b.speech.at : null) === ${JSON.stringify(spokeBefore)}; })()`), 'and the slime keeps quiet: its box shows the reply, no bubble');
	check(await box(`document.querySelectorAll('#inner .dots').length === 0`), 'and the dots go away');

	// A permission prompt: Allow on the slime answers the hook.
	const asking = runHook(permissionCommand(PORT), { session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' }, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }] }, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
	check(await until(async () => !(await box(`document.getElementById('ask').hidden`))), 'the permission card shows');
	check(await box(`document.getElementById('askDetail').textContent`) === 'npm test', 'with the command');
	check(await box(`document.getElementById('always').textContent`) === 'Always allow npm test', 'and what “always” would allow');
	check(await box(`document.getElementById('allow').disabled`), 'its buttons wait a moment (no accidental double-click)');
	await sleep(500);
	check(!(await box(`document.getElementById('allow').disabled`)), 'then they work');
	check(await box(`document.getElementById('hint').textContent === ''`), 'no other notes compete with the card');
	await shot('ask');
	await box(`document.getElementById('allow').click()`);
	const answer = await Promise.race([asking.done, sleep(3000).then(() => null)]);
	let decision = null;
	try { decision = JSON.parse(answer.out).hookSpecificOutput.decision; } catch { /* checked below */ }
	check(decision && decision.behavior === 'allow', 'Allow answers the hook with allow');
	check(await box(`document.getElementById('ask').hidden`), 'and the card goes away');
	check(await box(`[...document.querySelectorAll('#inner .note')].some((e) => /Allowed Bash: npm test/.test(e.textContent))`), 'the log notes it');

	// Claude asks a question: one tap on an option answers it.
	const questions = [{ question: 'Which pet?', header: 'Pet', options: [{ label: 'Cats', description: 'Purr' }, { label: 'Dogs', description: 'Woof' }], multiSelect: false }];
	const quiz = runHook(permissionCommand(PORT), { session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions } }, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
	check(await until(async () => (await box(`document.querySelectorAll('#askQuestions .opt').length`)) === 2), 'a question shows its options');
	await sleep(500);
	await shot('question');
	await box(`document.querySelectorAll('#askQuestions .opt')[0].click()`);
	const picked = await Promise.race([quiz.done, sleep(3000).then(() => null)]);
	let qd = null;
	try { qd = JSON.parse(picked.out).hookSpecificOutput.decision; } catch { /* checked below */ }
	check(qd && qd.behavior === 'allow' && qd.updatedInput.answers['Which pet?'] === 'Cats', 'tapping an option answers it');

	// A plan: Go ahead approves it, with the plan passed back.
	const planning = runHook(permissionCommand(PORT), { session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'ExitPlanMode', tool_input: { plan: '1. Add **sounds**\n2. A switch in Settings', planFilePath: '/tmp/plan.md' } }, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
	check(await until(async () => /Add sounds/.test(await box(`document.getElementById('askPlan').textContent`))), 'a plan shows');
	check(await box(`document.getElementById('allow').textContent === 'Go ahead' && document.getElementById('deny').textContent === 'Keep planning'`), 'with Go ahead and Keep planning');
	await sleep(500);
	await box(`document.getElementById('allow').click()`);
	const went = await Promise.race([planning.done, sleep(3000).then(() => null)]);
	let pd = null;
	try { pd = JSON.parse(went.out).hookSpecificOutput.decision; } catch { /* checked below */ }
	check(pd && pd.behavior === 'allow' && pd.updatedInput.planFilePath === '/tmp/plan.md', 'Go ahead approves the plan');

	// Several questions with picking several: picks and typed words both go;
	// nothing goes until every question has an answer.
	const multi = [
		{ question: 'Which ones?', header: 'Scope', multiSelect: true, options: [{ label: 'VAT', description: '' }, { label: 'Car tax', description: '' }] },
		{ question: 'Ship today?', header: 'Release', multiSelect: false, options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] },
	];
	const quiz2 = runHook(permissionCommand(PORT), { session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: multi } }, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
	check(await until(async () => (await box(`document.querySelectorAll('#askQuestions .q').length`)) === 2), 'a card with two questions shows');
	check(await box(`getComputedStyle(document.getElementById('form')).display === 'none'`), 'and the main field steps aside for it');
	await sleep(500);
	await box(`(() => { const o = document.querySelectorAll('#askQuestions .opt'); o[0].click(); o[1].click(); const chip = document.querySelectorAll('#askQuestions .otherchip')[0]; chip.click(); const f = document.querySelectorAll('#askQuestions .other')[0]; f.value = 'and payroll'; f.dispatchEvent(new Event('input')); f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
	await sleep(300);
	check(!(await box(`document.getElementById('ask').hidden`)), 'Enter with a question left doesn’t send half an answer');
	check(await box(`document.getElementById('allow').textContent`) === '1 question left to answer', 'the button says what’s left');
	await box(`document.querySelectorAll('#askQuestions .opt')[2].click()`);
	await box(`document.getElementById('allow').click()`);
	const both = await Promise.race([quiz2.done, sleep(3000).then(() => null)]);
	let bd = null;
	try { bd = JSON.parse(both.out).hookSpecificOutput.decision.updatedInput.answers; } catch { /* checked below */ }
	check(bd && bd['Which ones?'] === 'VAT, Car tax, and payroll' && bd['Ship today?'] === 'Yes', `picks and typed words both go (${JSON.stringify(bd)})`);
	check(await box(`getComputedStyle(document.getElementById('form')).display !== 'none'`), 'and the main field is back');

	// A draft you were writing when a question came stays a message, not an answer.
	await box(`(() => { const t = document.getElementById('text'); t.value = 'also run the tests'; t.dispatchEvent(new Event('input')); })()`);
	const quiz3 = runHook(permissionCommand(PORT), { session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions } }, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
	check(await until(async () => !(await box(`document.getElementById('ask').hidden`))), 'another question shows');
	await sleep(600);
	// Typing a number into the field is typing, not picking an option.
	await box(`(() => { const t = document.getElementById('text'); const keep = t.value; t.value = ''; t.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })); t.value = keep; })()`);
	await sleep(400);
	check(!(await box(`document.getElementById('ask').hidden`)), 'a digit typed in the field doesn’t answer');
	await box(`document.getElementById('form').requestSubmit()`);
	await sleep(300);
	check(!(await box(`document.getElementById('ask').hidden`)), 'a draft from before it came isn’t taken as the answer');
	check(inbox.view(ID).queued === 1, 'it’s kept as a message for later');
	await box(`(() => { const t = document.getElementById('text'); t.value = 'Dogs, obviously'; t.dispatchEvent(new Event('input')); document.getElementById('form').requestSubmit(); })()`);
	const typed = await Promise.race([quiz3.done, sleep(3000).then(() => null)]);
	let td = null;
	try { td = JSON.parse(typed.out).hookSpecificOutput.decision.updatedInput.answers; } catch { /* checked below */ }
	check(td && td['Which pet?'] === 'Dogs, obviously', 'typing after it came answers it');

	// Enter on a plan card sends it back with what to change.
	const planning2 = runHook(permissionCommand(PORT), { session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'ExitPlanMode', tool_input: { plan: '1. Add sounds' } }, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
	check(await until(async () => !(await box(`document.getElementById('askPlan').hidden`))), 'a plan shows again');
	await sleep(600);
	await box(`(() => { const t = document.getElementById('text'); t.value = 'use Web Audio, not files'; t.dispatchEvent(new Event('input')); })()`);
	check(await box(`document.getElementById('deny').textContent`) === 'Send changes', 'Keep planning becomes Send changes when you type');
	check(await box(`document.getElementById('allow').disabled`), 'and Go ahead waits (your note would come too late)');
	await box(`document.getElementById('form').requestSubmit()`);
	const back = await Promise.race([planning2.done, sleep(3000).then(() => null)]);
	let bk = null;
	try { bk = JSON.parse(back.out).hookSpecificOutput.decision; } catch { /* checked below */ }
	check(bk && bk.behavior === 'deny' && /Web Audio/.test(bk.message), 'Enter sends the plan back with what to change');
	for (const e of inbox.queue.get(ID) || []) inbox.unsend(ID, e.n); // tidy up the queued draft

	// Looking at another slime and coming back keeps your picks and keeps a
	// draft from before the card from becoming its answer.
	const ID2 = ID + '-b';
	await hook({ session_id: ID2, hook_event_name: 'SessionStart', cwd: '/tmp/website' });
	await until(async () => !!(await page(`__blaube.buddies.get(${JSON.stringify(ID2)})`)), 6000);
	await box(`(() => { const t = document.getElementById('text'); t.value = 'a draft from before'; t.dispatchEvent(new Event('input')); })()`);
	const quiz4 = runHook(permissionCommand(PORT), { session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: multi } }, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
	await until(async () => (await box(`document.querySelectorAll('#askQuestions .q').length`)) === 2);
	await sleep(500);
	await box(`document.querySelectorAll('#askQuestions .opt')[1].click()`);
	await page(`window.blaube.talk(${JSON.stringify(ID2)}, { x: 300, y: 600, r: 60 })`);
	check(await until(() => talkId() === ID2), 'switching to another slime');
	await page(`window.blaube.talk(${JSON.stringify(ID)}, { x: 300, y: 600, r: 60 })`);
	check(await until(() => talkId() === ID), 'and back');
	await sleep(400);
	check(await box(`document.querySelectorAll('#askQuestions .opt')[1].classList.contains('on')`), 'your pick is still there');
	check(await box(`document.getElementById('text').value === 'a draft from before'`), 'and so is your draft');
	await box(`document.querySelectorAll('#askQuestions .opt')[2].click()`);
	await box(`document.getElementById('allow').click()`);
	const kept = await Promise.race([quiz4.done, sleep(3000).then(() => null)]);
	let kd = null;
	try { kd = JSON.parse(kept.out).hookSpecificOutput.decision.updatedInput.answers; } catch { /* checked below */ }
	check(kd && kd['Which ones?'] === 'Car tax' && kd['Ship today?'] === 'Yes', `answered with the picks from before the switch (${JSON.stringify(kd)})`);

	// A plan that comes over a draft: the draft isn't taken as what to change.
	const planning3 = runHook(permissionCommand(PORT), { session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'ExitPlanMode', tool_input: { plan: '1. Add sounds' } }, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
	check(await until(async () => !(await box(`document.getElementById('askPlan').hidden`))), 'a plan comes while the draft is there');
	await sleep(600);
	check(await box(`document.getElementById('deny').textContent`) === 'Keep planning', 'the button doesn’t claim the draft');
	await box(`document.getElementById('deny').click()`);
	const plain = await Promise.race([planning3.done, sleep(3000).then(() => null)]);
	let pl = null;
	try { pl = JSON.parse(plain.out).hookSpecificOutput.decision; } catch { /* checked below */ }
	check(pl && pl.behavior === 'deny' && !/draft from before/.test(pl.message), 'Keep planning goes without it');
	check(await box(`document.getElementById('text').value === 'a draft from before'`), 'and the draft stays yours');
	await box(`(() => { const t = document.getElementById('text'); t.value = ''; t.dispatchEvent(new Event('input')); })()`);
	await hook({ session_id: ID2, hook_event_name: 'SessionEnd' });

	// A long reply folds; Show more opens it.
	await hook({ hook_event_name: 'Stop', last_assistant_message: Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long answer.`).join('\n') });
	check(await until(() => box(`!!document.querySelector('.msg.folded')`)), 'a long reply folds');
	await box(`document.querySelector('.more').click()`);
	check(await until(() => box(`!document.querySelector('.msg.folded')`)), 'Show more opens it');

	// Carried round the box, the slime takes its tail with it: the tail
	// leaves from the point of the bubble's outline facing it (below, beside,
	// above, round a corner) and points at it. The box itself never moves.
	// (Opened low in the middle of the screen, so there's room all round it.)
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
	await until(() => !talk().isVisible());
	await sleep(500);
	const ob = win.getBounds();
	console.log(`     (the slimes' window: ${JSON.stringify(ob)})`);
	await page(`window.blaube.talk(${JSON.stringify(ID)}, { x: ${Math.round(ob.width / 2)}, y: ${Math.round(ob.height - 330)}, r: 60 })`);
	check(await until(() => talk().isVisible()), 'it opens again, low in the middle');
	await sleep(500);
	const still = talk().getBounds();
	const around = await page(`(async () => {
		const B = __blaube, b = B.buddies.get(${JSON.stringify(ID)}), raf = () => new Promise((r) => requestAnimationFrame(r));
		const wb = ${JSON.stringify(win.getBounds())}, tb = ${JSON.stringify(still)};
		const box = { x: tb.x - wb.x + 12, y: tb.y - wb.y + 12, w: tb.width - 24, h: tb.height - 24 };
		const clampX = (x) => Math.max(90, Math.min(wb.width - 90, x)), clampY = (y) => Math.max(90, Math.min(wb.height - 90, y));
		const spots = {
			below: [box.x + box.w * 0.4, box.y + box.h + 200],
			left: [box.x - 160, box.y + box.h * 0.5],
			right: [box.x + box.w + 160, box.y + box.h * 0.4],
			aboveLeft: [box.x - 100, box.y - 100],
			above: [box.x + box.w * 0.6, box.y - 170],
		};
		B.ownMouse = true;
		let c = b.body.centroid();
		const out = {};
		B.input.down({ button: 0, clientX: c.x, clientY: c.y });
		for (const [name, [x, y]] of Object.entries(spots)) {
			const to = { x: clampX(x), y: clampY(y) }, from = { x: c.x, y: c.y };
			for (let i = 1; i <= 30; i++) { c = { x: from.x + (to.x - from.x) * i / 30, y: from.y + (to.y - from.y) * i / 30 }; B.input.move({ clientX: c.x, clientY: c.y }); await raf(); }
			let held = 0, t0 = B.now();
			for (; held < 600; held++) { B.input.move({ clientX: to.x, clientY: to.y }); await raf(); const p = b.body.centroid(); if (held >= 20 && Math.hypot(p.x - to.x, p.y - to.y) < 50) break; }
			const tookS = B.now() - t0;
			const t = B.talkTail(), at = t ? t.aim : b.body.centroid(); // (where the slime was when the tail was drawn)
			// How far the tail's start is from the rounded outline (30 px corners).
			let off = null;
			if (t) {
				const R = 30, qx = Math.max(box.x + R, Math.min(box.x + box.w - R, t.edge.x)), qy = Math.max(box.y + R, Math.min(box.y + box.h - R, t.edge.y));
				off = Math.abs(Math.hypot(t.edge.x - qx, t.edge.y - qy) - R);
			}
			const ax = at.x - (t ? t.edge.x : 0), ay = at.y - (t ? t.edge.y : 0), al = Math.hypot(ax, ay) || 1;
			out[name] = t && { held, tookS, grab: b.body.grab ? [Math.round(b.body.grab.x), Math.round(b.body.grab.y)] : null, at: [Math.round(at.x), Math.round(at.y)], to: [Math.round(to.x), Math.round(to.y)], box, off, facing: (t.nx * ax + t.ny * ay) / al, nx: t.nx, ny: t.ny, len: t.len, clamped: to.x !== x || to.y !== y };
		}
		// Set down beside the box, not on it (dropped from above, it would
		// sit on the box's top, a ledge, and fall when the box closes).
		const down = { x: clampX(box.x - 160), y: wb.height - 120 };
		for (let i = 1; i <= 30; i++) { B.input.move({ clientX: c.x + (down.x - c.x) * i / 30, clientY: c.y + (down.y - c.y) * i / 30 }); await raf(); }
		c = down;
		for (let i = 0; i < 40; i++) { B.input.move({ clientX: c.x, clientY: c.y }); await raf(); }
		B.input.up({ button: 0, clientX: c.x, clientY: c.y });
		B.ownMouse = false;
		return out;
	})()`);
	const want = { below: [0, 1], left: [-1, 0], right: [1, 0], aboveLeft: [-1, -1], above: [0, -1] };
	for (const [name, t] of Object.entries(around)) {
		check(t && t.off < 1.5 && t.facing > 0.97 && t.len > 0, `carried ${name}, the tail leaves from the bubble’s edge and points at it (${t ? `${t.off.toFixed(1)} px off the edge, facing ${t.facing.toFixed(2)}, ${Math.round(t.len)} px long` : 'no tail'})`);
		const [wx, wy] = want[name];
		if (t && !t.clamped) check(Math.sign(Math.round(t.nx * 3)) === wx && Math.sign(Math.round(t.ny * 3)) === wy, `  from the ${name === 'aboveLeft' ? 'top left corner' : name === 'below' ? 'bottom' : name === 'above' ? 'top' : name + ' side'} (${t.nx.toFixed(2)}, ${t.ny.toFixed(2)})`);
	}
	await sleep(600);
	const after = talk().getBounds();
	check(talk().isVisible() && after.x === still.x && after.y === still.y && after.width === still.width && after.height === still.height, `the box stays exactly where it opened while its slime is carried about (${JSON.stringify(still)} → ${JSON.stringify(after)})`);
	await shot('carried');
	// Resizing it by a corner: it grows from there, the other edges stay, and
	// what's in it flows to fit; the next box opens at that size.
	await box(`(() => { blaubeTalk.resize('start', 'nw', 1000, 1000); blaubeTalk.resize('move', 'nw', 970, 980); blaubeTalk.resize('end', 'nw', 940, 960); })()`);
	check(await until(() => { const b = talk().getBounds(); return b.x === still.x - 60 && b.y === still.y - 40 && b.width === still.width + 60 && b.height === still.height + 40; }, 1500), `dragging its top left corner resizes it from there (${JSON.stringify(talk().getBounds())})`);
	await sleep(200);
	check(await box(`(() => { const b = document.querySelector('.bubble').getBoundingClientRect(), f = document.getElementById('form').getBoundingClientRect(); return Math.round(b.width) === innerWidth - 24 && f.bottom <= b.bottom && f.right <= b.right; })()`), 'and what’s in it flows to the new size');
	await box(`(() => { blaubeTalk.resize('start', 'se', 500, 500); blaubeTalk.resize('end', 'se', -500, -500); })()`);
	await sleep(200);
	const least = talk().getBounds();
	check(least.width === 440 && least.height === 360, `no smaller than its least size (${least.width}×${least.height})`);

	// Esc closes it (after its little shrink); clicking the slime again opens and closes it.
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
	check(await until(() => !talk().isVisible()), 'Esc closes it');
	check(await page(`(() => { const b = __blaube.buddies.get(${JSON.stringify(ID)}); return !!b; })()`), 'the slime is fine');
	await clickSlime();
	const reopened = await until(() => talk().isVisible());
	check(reopened, 'clicking the slime opens it again');
	if (!reopened) console.log('     last page logs:\n       ' + consoleLines.slice(-8).join('\n       '), '\n     talkId', talkId(), 'last', JSON.stringify(last));
	await sleep(500);
	const sized = talk().getBounds();
	check(sized.width === 440 && sized.height === 360, `it opens again at the size you gave it (${sized.width}×${sized.height})`);
	await clickSlime();
	const closedAgain = await until(() => !talk().isVisible());
	check(closedAgain, 'clicking it again closes it');
	if (!closedAgain) console.log('     last page logs:\n       ' + consoleLines.slice(-8).join('\n       '), '\n     slime', JSON.stringify(await slime()), 'clicked at', JSON.stringify(last));

	// New entries are added, not redrawn: an unfolded reply stays open and
	// the elements already there are the same ones.
	await clickSlime();
	await until(() => talk().isVisible());
	await box(`document.querySelector('#inner .msg').dataset.mark = 'kept'`);
	await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'thanks!' });
	await hook({ hook_event_name: 'Stop', last_assistant_message: 'Any time.' });
	check(await until(() => box(`document.querySelector('#inner .msg:last-of-type')?.textContent === 'Any time.' || [...document.querySelectorAll('#inner .msg')].pop().textContent === 'Any time.'`)), 'a new reply shows up');
	check(await box(`document.querySelector('#inner .msg').dataset.mark === 'kept'`), 'without redrawing what was there');

	// The session ends while the box is open, with something typed and
	// something queued: the box stays and says so, and keeps the draft.
	await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'one more thing' });
	await box(`(() => { const t = document.getElementById('text'); t.value = 'also bump the version'; t.dispatchEvent(new Event('input')); document.getElementById('form').requestSubmit(); })()`);
	await box(`(() => { const t = document.getElementById('text'); t.value = 'half-typed'; t.dispatchEvent(new Event('input')); })()`);
	await hook({ hook_event_name: 'SessionEnd' });
	check(await until(async () => (await box(`document.getElementById('state').textContent`)) === 'Ended'), 'the box stays when its session ends, saying it ended');
	check(await box(`document.getElementById('text').disabled && document.getElementById('text').value === 'half-typed'`), 'the field is off, the draft kept');
	check(await box(`/didn’t go in/.test(document.getElementById('hint').textContent) && [...document.querySelectorAll('.meta')].some((e) => e.textContent === 'Not sent')`), 'and the queued message is marked not sent');
	await shot('ended');
	await box(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
	check(await until(() => !talk().isVisible()), 'Esc closes it');

	// Pinned boxes stay open (clicking away and Esc leave them be), move by
	// their header and stay where they're put, and several can be open at
	// once; each one's tail shows only while its slime is near it.
	const PA = ID + '-pa', PB = ID + '-pb';
	await hook({ session_id: PA, hook_event_name: 'SessionStart', cwd: '/tmp/alpha' });
	await hook({ session_id: PB, hook_event_name: 'SessionStart', cwd: '/tmp/beta' });
	await until(async () => !!(await page(`__blaube.buddies.get(${JSON.stringify(PA)}) && __blaube.buddies.get(${JSON.stringify(PB)}) && true`)), 6000);
	await sleep(1500);
	const sw = win.getBounds();
	const boxOf = (id) => pinned().get(id) && pinned().get(id).win;
	const inBox = (id, js) => boxOf(id).webContents.executeJavaScript(js);
	await page(`window.blaube.talk(${JSON.stringify(PA)}, { x: ${Math.round(sw.width * 0.3)}, y: ${Math.round(sw.height - 330)}, r: 60 })`);
	check(await until(() => talkId() === PA && talk().isVisible()), 'a box opens for another slime');
	await sleep(400);
	await box(`document.getElementById('pin').click()`);
	check(await until(() => !!boxOf(PA)), 'its pin pins it');
	check(boxOf(PA) && boxOf(PA).isVisible() && await inBox(PA, `document.getElementById('pin').classList.contains('on')`), 'and the pin shows it');
	boxOf(PA).emit('blur'); // (clicking away)
	await inBox(PA, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
	await sleep(500);
	check(boxOf(PA) && boxOf(PA).isVisible(), 'pinned, clicking away and Esc leave it open');
	const before = boxOf(PA).getBounds();
	await inBox(PA, `(() => { blaubeTalk.resize('start', 'move', 600, 600); blaubeTalk.resize('move', 'move', 560, 580); blaubeTalk.resize('end', 'move', 480, 540); })()`);
	await sleep(600);
	const moved = boxOf(PA).getBounds();
	check(moved.x === before.x - 120 && moved.y === before.y - 60 && moved.width === before.width && moved.height === before.height, `dragging its header moves it, and it stays there (${JSON.stringify(before)} → ${JSON.stringify(moved)})`);
	check(!!boxOf(PA), 'still pinned after moving');
	await page(`window.blaube.talk(${JSON.stringify(PB)}, { x: ${Math.round(sw.width * 0.7)}, y: ${Math.round(sw.height - 330)}, r: 60 })`);
	check(await until(() => talkId() === PB && talk().isVisible()), 'another slime’s box opens');
	check(boxOf(PA) && boxOf(PA).isVisible(), 'and the pinned one stays open beside it');
	await sleep(400);
	await box(`document.getElementById('pin').click()`);
	check(await until(() => !!boxOf(PB)), 'pinning that one too');
	check(boxOf(PA).isVisible() && boxOf(PB).isVisible() && boxOf(PA) !== boxOf(PB), 'two pinned boxes, both open');
	const pinB = boxOf(PB);
	await page(`window.blaube.talk(${JSON.stringify(PB)}, { x: 10, y: 10, r: 60 })`);
	await sleep(300);
	check(boxOf(PB) === pinB && pinB.isVisible() && pinB.getBounds().x === boxOf(PB).getBounds().x, 'opening a pinned one again just brings it to the front');
	// Its slime carried near its box: a tail; far off: none.
	const tailAt = (id, where) => page(`(async () => {
		const B = __blaube, b = B.buddies.get(${JSON.stringify(id)}), raf = () => new Promise((r) => requestAnimationFrame(r));
		B.ownMouse = true;
		let c = b.body.centroid();
		const to = ${JSON.stringify(where)};
		B.input.down({ button: 0, clientX: c.x, clientY: c.y });
		for (let i = 1; i <= 30; i++) { B.input.move({ clientX: c.x + (to.x - c.x) * i / 30, clientY: c.y + (to.y - c.y) * i / 30 }); await raf(); }
		for (let i = 0; i < 300; i++) { B.input.move({ clientX: to.x, clientY: to.y }); await raf(); const p = b.body.centroid(); if (i > 30 && Math.hypot(p.x - to.x, p.y - to.y) < 50) break; }
		for (let i = 0; i < 10; i++) await raf();
		const t = B.talkTail(${JSON.stringify(id)});
		B.input.up({ button: 0, clientX: to.x, clientY: to.y });
		B.ownMouse = false;
		return t && { shown: t.shown, len: t.len };
	})()`);
	const pb = boxOf(PA).getBounds();
	const near = await tailAt(PA, { x: pb.x - sw.x + pb.width / 2, y: pb.y - sw.y + pb.height + 130 });
	check(near && near.shown === 1 && near.len > 10, `near its box, its tail shows (${JSON.stringify(near)})`);
	// (Across the screen from it: well over three of its radii away.)
	const far = await tailAt(PA, { x: pb.x - sw.x + pb.width / 2 < sw.width / 2 ? sw.width - 150 : 150, y: pb.y - sw.y + pb.height / 2 });
	check(far && far.shown === 0, `far from it, no tail (${JSON.stringify(far)})`);
	await shot('pinned');
	// Dark mode: the moon in one box turns them all dark, with no tails.
	const isDark = (id) => inBox(id, `document.body.classList.contains('dark')`);
	await inBox(PA, `document.getElementById('theme').click()`);
	check(await until(async () => (await isDark(PA)) && (await isDark(PB))), 'dark mode turns every box dark');
	check(await inBox(PA, `getComputedStyle(document.querySelector('.bubble')).backgroundColor !== 'rgb(255, 255, 255)' && getComputedStyle(document.getElementById('text')).color !== 'rgb(27, 36, 64)'`), 'a dark bubble, light text');
	const darkNear = await tailAt(PA, { x: pb.x - sw.x + pb.width / 2, y: pb.y - sw.y + pb.height + 130 });
	check(!darkNear, `a dark box has no tail, even near its slime (${JSON.stringify(darkNear)})`);
	await shot('dark');
	await inBox(PB, `document.getElementById('theme').click()`);
	check(await until(async () => !(await isDark(PA)) && !(await isDark(PB))), 'and the sun turns them all light again');
	// ✕ closes a pinned box.
	await inBox(PA, `document.getElementById('close').click()`);
	check(await until(() => !boxOf(PA)), 'its ✕ closes a pinned box');
	check(boxOf(PB) && boxOf(PB).isVisible(), 'and only that one');
	await inBox(PB, `document.getElementById('close').click()`);
	await until(() => !boxOf(PB));
	await hook({ session_id: PA, hook_event_name: 'SessionEnd' });
	await hook({ session_id: PB, hook_event_name: 'SessionEnd' });

	// From the menu bar: a question's answers, and a plan's Go ahead.
	const trayItem = (label) => { for (const r of global.__blaubeTrayMenu().items) { const i = r.submenu && r.submenu.items.find((x) => x.label === label); if (i) return i; } return null; };
	const quiz5 = runHook(permissionCommand(PORT), { session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions } }, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
	check(await until(() => !!trayItem('Dogs') && !!trayItem('Which pet?')), 'the menu bar menu shows a question and its answers');
	trayItem('Dogs').click();
	let qd5 = null;
	try { qd5 = JSON.parse((await Promise.race([quiz5.done, sleep(3000).then(() => null)])).out).hookSpecificOutput.decision; } catch { /* checked below */ }
	check(qd5 && qd5.behavior === 'allow' && qd5.updatedInput.answers['Which pet?'] === 'Dogs', 'and a click there answers it');
	const planning5 = runHook(permissionCommand(PORT), { session_id: ID, cwd: '/tmp/kalkis', hook_event_name: 'PermissionRequest', tool_name: 'ExitPlanMode', tool_input: { plan: '1. Add sounds' } }, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
	check(await until(() => !!trayItem('Go ahead with the plan')), 'and a plan has Go ahead');
	trayItem('Go ahead with the plan').click();
	let pd5 = null;
	try { pd5 = JSON.parse((await Promise.race([planning5.done, sleep(3000).then(() => null)])).out).hookSpecificOutput.decision; } catch { /* checked below */ }
	check(pd5 && pd5.behavior === 'allow', 'which approves it');

	waiting.kill(); asking.kill();
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
