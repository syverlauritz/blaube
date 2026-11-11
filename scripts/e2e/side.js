// The panel under the talk box's top (its git and its tools that need you),
// in the real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/side.js BLAUBE_PORT=47991 npx electron .
//
// A repository with lots of branches (agents' worktree ones among them),
// versions, something set aside and a thousand changed files, and sixteen
// claude.ai tools that want a sign-in: the panel is one line, Show opens
// the details (a few branches, three versions, the tools folded into one
// row), Hide takes it away and the button by All sessions brings it back,
// and each is kept. Saves pictures to shots/side-*.png. Exits non-zero on a
// failure.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const OUT = path.join(__dirname, '..', '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run({ win, PORT, talk, talkId, mcpStates, pushTalk }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
	const page = (js) => win.webContents.executeJavaScript(js);
	const box = (js) => talk().webContents.executeJavaScript(js);
	const shot = async (name) => {
		// (As tall as a box you've made big, so the whole panel shows.)
		const b = talk().getBounds();
		if (b.height < 1000) talk().setBounds({ x: b.x, y: Math.max(0, b.y + b.height - 1000), width: b.width, height: 1000 });
		await sleep(400);
		const img = await talk().webContents.capturePage();
		fs.mkdirSync(OUT, { recursive: true });
		fs.writeFileSync(path.join(OUT, `side-${name}.png`), img.toPNG());
	};
	const ID = 'side-' + Date.now();
	const hook = (payload) => new Promise((done) => {
		const req = http.request({ host: '127.0.0.1', port: PORT, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-entry': 'cli' } }, (res) => { res.resume(); res.on('end', done); });
		req.on('error', done);
		req.end(JSON.stringify(Object.assign({ session_id: ID }, payload)));
	});

	// A repository like a busy one.
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-side-'));
	const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, stdio: 'pipe' });
	git('init', '-q', '-b', 'main');
	const subjects = ['Data Organizer Pixel: Syver’s new config as the default', 'Story globe: intro cards and icons ride their points down to the shell', 'Story globe: the camera trails the points down to the shell', 'Versions tab: latest source shows when the toy’s source last changed', 'Story globe: the shell’s edge sits further right as the points land', 'Story globe: fix the quotes in the shell-edge setting’s hint'];
	for (const [i, s] of subjects.entries()) { fs.writeFileSync(path.join(repo, 'v.txt'), String(i)); git('add', '.'); git('commit', '-q', '-m', s); }
	for (const b of ['photo-library', 'fix-login', 'tweak-tab', 'gallery-sort']) git('branch', b);
	for (const h of ['a00214f130b7', 'a0d77e7f35f1', 'ab70d7f84452', 'ac28c9f56e21', 'a6e194f1c2a9', 'aec4708bb1c3', 'a3068a2712f0']) git('branch', 'worktree-agent-' + h);
	fs.writeFileSync(path.join(repo, 'v.txt'), 'parked');
	git('stash', 'push', '-q', '-m', 'Photo library: four new pictures');
	for (let i = 0; i < 1002; i++) fs.writeFileSync(path.join(repo, `f${i}.txt`), 'x');
	const tx = path.join(os.tmpdir(), path.basename(repo) + '.jsonl');
	const at = new Date(Date.now() - 600e3).toISOString();
	fs.writeFileSync(tx, [
		{ type: 'user', timestamp: at, message: { content: 'story globe: when the data points are attaching to the shell, i want the shell edge to be more towards the right' } },
		{ type: 'assistant', timestamp: at, message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Done! When the dots land on the shell, the shell’s edge now sits further right.\n\nI added a new slider, **intro → shell edge across**: 0.5 puts the edge in the middle, a higher number moves it further right. I set story globe to 0.68.' }] } },
	].map((e) => JSON.stringify(e)).join('\n') + '\n');

	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(600);
	await hook({ cwd: repo, transcript_path: tx, hook_event_name: 'SessionStart' });
	await hook({ cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'shit i forgot to pull' });
	await hook({ cwd: repo, hook_event_name: 'Stop', last_assistant_message: 'It’s fine. I pulled the newest code, and then I added my change on top of it. Nothing of yours got lost.' });
	const tools = ['monday.com', 'Intercom', 'HubSpot', 'Canva', 'Box', 'Atlassian', 'ElevenLabs', 'Wispr Flow', 'Epidemic Sound', 'Google Docs', 'Google Slides', 'Google Sheets', 'Lovable', 'Calendly', 'FLORA', 'Yapper'];
	mcpStates.set(ID, tools.map((n) => ({ name: 'claude.ai ' + n, status: 'needs-auth' })));
	await until(async () => !!(await page(`!!__blaube.buddies.get(${JSON.stringify(ID)})`)), 6000);
	const ob = win.getBounds();
	await page(`window.blaube.talk(${JSON.stringify(ID)}, { x: ${Math.round(ob.width / 2)}, y: ${Math.round(ob.height - 300)}, r: 60 })`);
	await until(() => talkId() === ID, 6000);
	pushTalk(ID);

	// One line: its branch, what's changed, and how many tools want you.
	check(await until(() => box(`(() => { const g = document.getElementById('git'); return !g.hidden && g.textContent === 'main · 1002 changed · 16 tools need sign-in' && g.getAttribute('aria-expanded') === 'false'; })()`), 10000), 'the panel is one line: main · 1002 changed · 16 tools need sign-in');
	check(await box(`document.getElementById('branches').hidden && document.getElementById('mcp').hidden && document.getElementById('gitFiles').hidden`), 'with nothing under it');
	check(await box(`document.getElementById('side').offsetHeight < 60`), 'and it takes one line’s room');
	await shot('collapsed');

	// Show: the details, tidied.
	await box(`document.getElementById('git').click()`);
	check(await until(() => box(`(() => { const b = document.getElementById('branches'); const t = [...b.querySelectorAll(':scope > button')].map((x) => x.textContent); return !b.hidden && t[0] === 'main' && t.length === 6 && /^\\+\\d+ more$/.test(t[4]) && t[5] === 'New branch…'; })()`), 10000), 'Show opens the details: the branch it’s on, three newest, +N more');
	check(await until(() => box(`(() => { const l = [...document.querySelectorAll('#branches .commits li')]; return l.length === 7 && l.filter((x) => !x.hidden).length === 4 && /3 older/.test(l[6].textContent); })()`), 10000), 'three versions, the older ones a tap away');
	check(await until(() => box(`(() => { const m = document.getElementById('mcp'); return !m.hidden && m.children.length === 1 && m.textContent === '16 tools need you to sign inShow'; })()`)), 'the tools fold into one row');
	await shot('expanded');

	await box(`document.querySelector('#mcp li.fold button').click()`);
	check(await until(() => box(`document.querySelectorAll('#mcp li.sub').length === 16`)), 'and Show lists them, to sign in or hide');
	await box(`[...document.querySelectorAll('#branches > button')].find((b) => /more$/.test(b.textContent)).click()`);
	check(await until(() => box(`[...document.querySelectorAll('#branches > button.agent')].length === 7 && document.querySelector('#branches > button.agent').textContent === 'agent a00214f1'`), 6000), '+N more shows the rest, agents’ branches quietly');
	await shot('expanded-all');
	await box(`document.querySelector('#mcp li.fold button').click()`);

	// Kept: another open of the box is opened too.
	await page(`window.blaube.talk(${JSON.stringify(ID)}, { x: ${Math.round(ob.width / 2)}, y: ${Math.round(ob.height - 300)}, r: 60 })`);
	await sleep(500);
	await page(`window.blaube.talk(${JSON.stringify(ID)}, { x: ${Math.round(ob.width / 2)}, y: ${Math.round(ob.height - 300)}, r: 60 })`);
	check(await until(() => box(`document.getElementById('git').getAttribute('aria-expanded') === 'true' && !document.getElementById('branches').hidden`), 6000), 'opened stays opened, the next time too');
	await box(`document.getElementById('git').click()`);
	check(await until(() => box(`document.getElementById('branches').hidden && document.getElementById('mcp').hidden`)), 'Less folds it back to its line');

	// Hide: gone, and back from the button by All sessions.
	await box(`document.getElementById('sideHide').click()`);
	check(await until(() => box(`getComputedStyle(document.getElementById('side')).display === 'none' && !document.getElementById('sideBack').hidden && document.getElementById('sideBack').textContent === 'main'`)), 'Hide takes the panel away, a quiet main button by All sessions in its place');
	await shot('hidden');
	pushTalk(ID);
	await sleep(300);
	check(await box(`document.getElementById('sideHead').hidden`), 'and it stays hidden');
	await box(`document.getElementById('sideBack').click()`);
	check(await until(() => box(`!document.getElementById('sideHead').hidden && document.getElementById('sideBack').hidden && document.getElementById('git').getAttribute('aria-expanded') === 'false'`)), 'which brings it back, as its one line');

	try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* still in use: the temp folder's */ }
	fs.rmSync(tx, { force: true });
	return failed;
};
