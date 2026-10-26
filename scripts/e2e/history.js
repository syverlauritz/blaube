// End-to-end check of a session's conversation from its transcript, in the
// real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/history.js BLAUBE_PORT=47878 npx electron .
//
// Fakes a session that was started in a terminal before Blaube was running:
// its transcript (made up) already has 130 turns. Opening its talk box shows
// the last 100 of them, each once, with its steps; hooks then report the
// last turn's step and reply a moment late (as they do), and nothing shows
// twice; Show earlier brings the first 30. Saves pictures to
// shots/history-*.png. Exits non-zero on a failure.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = path.join(__dirname, '..', '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run({ win, PORT, talk, talkId }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	const page = (js) => win.webContents.executeJavaScript(js);
	const box = (js) => talk().webContents.executeJavaScript(js);
	const ID = 'history-' + Date.now();
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-history-'));
	const hook = (payload) => new Promise((done) => {
		const req = http.request({ host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli' } }, (res) => { res.resume(); res.on('end', done); });
		req.end(JSON.stringify(Object.assign({ session_id: ID, cwd }, payload)));
	});
	const shot = async (name) => {
		const img = await talk().webContents.capturePage();
		fs.mkdirSync(OUT, { recursive: true });
		fs.writeFileSync(path.join(OUT, `history-${name}.png`), img.toPNG());
	};

	// Its transcript: 130 turns over the last two hours, the last a moment ago.
	const TURNS = 130, now = Date.now();
	const ts = (turn, k) => new Date(now - (TURNS - turn) * 50e3 - 2000 + k * 300).toISOString();
	const lines = [];
	for (let i = 0; i < TURNS; i++) {
		lines.push(
			{ type: 'user', timestamp: ts(i, 0), message: { role: 'user', content: `question ${i}` } },
			{ type: 'assistant', timestamp: ts(i, 1), message: { id: 'm' + i, role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden' }] } },
			{ type: 'assistant', timestamp: ts(i, 2), message: { id: 'm' + i, role: 'assistant', content: [{ type: 'tool_use', id: 't' + i, name: 'Read', input: { file_path: path.join(cwd, `file${i}.js`) } }] } },
			{ type: 'user', timestamp: ts(i, 3), toolUseResult: { type: 'text' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't' + i, content: 'x' }] } },
			{ type: 'assistant', timestamp: ts(i, 4), message: { id: 'n' + i, role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] } },
			{ type: 'system', subtype: 'turn_duration', timestamp: ts(i, 5) },
		);
		if (i === 60) lines.push({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', timestamp: ts(i, 6) }, { type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, timestamp: ts(i, 6), message: { role: 'user', content: 'This session is being continued…' } });
	}
	const tx = path.join(cwd, 'transcript.jsonl');
	fs.writeFileSync(tx, lines.map((e) => JSON.stringify(e)).join('\n') + '\n');

	await hook({ hook_event_name: 'SessionStart', transcript_path: tx });
	check(await until(async () => !!(await page(`!!__blaube.buddies.get(${JSON.stringify(ID)})`))), 'the session’s slime shows up');
	await page(`window.blaube.talk(${JSON.stringify(ID)}, { x: 300, y: 600, r: 60 })`);
	check(await until(() => talkId() === ID), 'its talk box opens');

	const said = () => box(`[...document.querySelectorAll('#inner .msg')].map((e) => e.dataset.text)`);
	const steps = () => box(`[...document.querySelectorAll('#inner .step .what')].map((e) => e.textContent)`);
	const once = (list, re) => { const c = {}; for (const t of list) if (re.test(t)) c[t] = (c[t] || 0) + 1; return c; };
	const range = (a, b, f) => Array.from({ length: b - a }, (_, i) => f(a + i));
	const exactly = (counts, want) => want.every((t) => counts[t] === 1) && Object.keys(counts).length === want.length;

	check(await until(async () => (await said()).includes('answer 129')), 'what was said before Blaube was watching shows by itself');
	let s = await said();
	check(exactly(once(s, /^question /), range(30, 130, (i) => `question ${i}`)), 'the last 100 turns, each question once');
	check(exactly(once(s, /^answer /), range(30, 130, (i) => `answer ${i}`)), 'and each answer once');
	check(exactly(once(await steps(), /^Read /), range(30, 130, (i) => `Read file${i}.js`)), 'with the steps it took');
	check(!s.some((t) => /hidden|continued/.test(t)), 'not its thinking or the summary it carried on from');
	check(await box(`[...document.querySelectorAll('#inner .since.old')].filter((e) => e.textContent === 'Context compacted').length === 1`), 'a compaction is one divider');
	check(await box(`!!document.querySelector('#inner .earlierbtn') && document.querySelector('#inner .earlierbtn').textContent === 'Show earlier'`), 'Show earlier is at the top');
	check(!(await box(`!!document.querySelector('#inner .empty')`)), 'no “Say hi” over a conversation');
	await shot('open');

	// The hooks for its last turn come in now, a moment after the transcript had them.
	await hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(cwd, 'file129.js') }, tool_response: { type: 'text' } });
	await hook({ hook_event_name: 'Stop', last_assistant_message: 'answer 129' });
	await sleep(800);
	check(once(await said(), /^answer 129$/)['answer 129'] === 1, 'a reply the hooks report late shows once');
	check(once(await steps(), /^Read file129\.js$/)['Read file129.js'] === 1, 'and so does its step');
	// And a new turn, live.
	await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'question 130' });
	await hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(cwd, 'file130.js') }, tool_response: { type: 'text' } });
	await hook({ hook_event_name: 'Stop', last_assistant_message: 'answer 130' });
	check(await until(async () => (await said()).slice(-2).join() === 'question 130,answer 130'), 'a new turn comes in live, at the end');
	s = await said();
	check(exactly(once(s, /^question /), range(30, 131, (i) => `question ${i}`)), 'still every question once');

	await box(`document.querySelector('#inner .earlierbtn').click()`);
	check(await until(async () => (await said()).includes('question 0')), 'Show earlier brings the turns before');
	s = await said();
	check(exactly(once(s, /^question /), range(0, 131, (i) => `question ${i}`)), 'all 131 questions, each once, in order') ;
	check(s.indexOf('question 0') < s.indexOf('question 29') && s.indexOf('question 29') < s.indexOf('question 30'), 'in order');
	check(exactly(once(await steps(), /^Read /), range(0, 131, (i) => `Read file${i}.js`)), 'and every step once');
	check(await until(() => box(`!document.querySelector('#inner .earlierbtn')`)), 'nothing earlier: no Show earlier');
	await box(`document.getElementById('log').scrollTop = 0`);
	await sleep(200);
	await shot('earlier');

	await hook({ hook_event_name: 'SessionEnd' });
	try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* temp */ }
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
