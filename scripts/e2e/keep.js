// "Keep as a command" under something you said, and the Screenshot button:
// what you said is kept as a /command of the project's, shows in the "/"
// suggestions, and a name that's taken says so. (Screenshot can't be
// taken here: it only checks the button stays hidden under test.)
//
//   BLAUBE_TEST=scripts/e2e/keep.js BLAUBE_PORT=47962 npx electron .
//
// Exits non-zero on a failure.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function run({ win, tracker, inbox, owned, talk, talkId }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const js = (s) => win.webContents.executeJavaScript(s);
	const box = (s) => talk().webContents.executeJavaScript(s);
	const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
	while (win.webContents.isLoading()) await sleep(100);
	win.webContents.setBackgroundThrottling(false);
	await sleep(1000);

	const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-keep-'));
	const id = 'keep' + Date.now(), ID = JSON.stringify(id);
	tracker.handle({ session_id: id, cwd: folder, hook_event_name: 'SessionStart' });
	inbox.reachable.add(id);
	inbox.add(id, { who: 'you', text: 'Run the tests, fix what fails, then commit with a short message', via: 'blaube', status: 'sent' });
	inbox.add(id, { who: 'claude', text: 'Done: 3 fixed, committed.' });
	check(await until(() => js(`!!__blaube.buddies.get(${ID})`), 6000), 'its slime is there');
	await sleep(1500);
	const at = await js(`(() => { const b = __blaube.buddies.get(${ID}), c = b.body.centroid(); return { x: c.x, y: c.y, r: b.body.o.radius }; })()`);
	await js(`window.blaube.talk(${ID}, ${JSON.stringify(at)})`);
	check(await until(() => talk() && talk().isVisible() && talkId() === id, 8000), 'its talk box opens');
	talk().webContents.setBackgroundThrottling(false);

	check(await until(() => box(`[...document.querySelectorAll('.meta.edit button')].some((b) => b.textContent === 'Keep as a command')`)), 'under what you said: Keep as a command');
	check(await box(`document.getElementById('snap').hidden`), 'no Screenshot button under test (it would take a real one)');
	await box(`[...document.querySelectorAll('.meta.edit button')].find((b) => b.textContent === 'Keep as a command').click()`);
	check(await until(() => box(`document.querySelector('.meta.keeping .cmdname')?.value === 'run-the-tests'`)), 'it asks for a name, with one made from what you said');
	await box(`[...document.querySelectorAll('.meta.keeping button')].find((b) => b.textContent === 'For this project').click()`);
	const file = path.join(folder, '.claude', 'commands', 'run-the-tests.md');
	check(await until(() => fs.existsSync(file)), 'kept in the project’s .claude/commands');
	check(/Run the tests, fix what fails/.test(fs.readFileSync(file, 'utf8')) && /^---\ndescription: "Run the tests/.test(fs.readFileSync(file, 'utf8')), 'with what you said, and it as its description');
	check(await until(() => box(`/Kept as \\/run-the-tests for this project/.test(document.querySelector('.meta.edit')?.textContent || '')`)), 'the box says so');
	// "/" in the field suggests it.
	await box(`(() => { const t = document.getElementById('text'); t.value = '/run-t'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
	check(await until(() => box(`[...document.querySelectorAll('#suggest li')].some((li) => li.textContent.includes('run-the-tests'))`)), 'and “/run-t” suggests it');
	await box(`(() => { const t = document.getElementById('text'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
	// The same name again: it says it's taken.
	const r = await box(`blaubeTalk.saveCommand(${ID}, 'run the tests', 'something else', 'project')`);
	check(r && /already/.test(r.error || ''), `a name that’s taken isn’t written over (${r && r.error})`);
	const own = await box(`blaubeTalk.saveCommand(${ID}, 'compact', 'x', 'project')`);
	check(own && /Claude Code/.test(own.error || ''), 'nor one of Claude Code’s own');

	// Repeat…: again by itself, listed under All sessions, with Stop.
	inbox.add(id, { who: 'you', text: 'Look over my open pull requests and say what needs me', via: 'blaube', status: 'sent' });
	check(await until(() => box(`[...document.querySelectorAll('.meta.edit button')].some((b) => b.textContent === 'Repeat…')`)), 'under what you said: Repeat…');
	await box(`[...document.querySelectorAll('.meta.edit button')].filter((b) => b.textContent === 'Repeat…').pop().click()`);
	check(await until(() => box(`!!document.querySelector('.meta.keeping select')`)), 'it asks how often');
	await box(`(() => { const sel = document.querySelector('.meta.keeping select'); sel.value = 'weekdays'; sel.onchange(); document.querySelector('.meta.keeping input[type=time]').value = '08:30'; [...document.querySelectorAll('.meta.keeping button')].find((b) => b.textContent === 'Start repeating').click(); })()`);
	check(await until(() => box(`[...document.querySelectorAll('.meta.edit')].some((m) => /Repeats weekdays at 08:30/.test(m.textContent))`)), 'and says when it repeats');
	const list = await box(`blaubeTalk.routines()`);
	check(list.length === 1 && list[0].cwd === folder && /^Look over my open/.test(list[0].prompt), 'kept, with its folder and what you said');
	await box(`document.getElementById('allSessions').click()`);
	check(await until(() => box(`[...document.querySelectorAll('.hubhead')].some((h) => h.textContent === 'Repeating by itself') && /weekdays at 08:30 · next/.test(document.querySelector('.row.routine')?.textContent || '')`), 5000), 'All sessions lists it, with when it’s next');
	// Run now: a fresh session in its folder, told what you said (a
	// stand-in for Claude Code, no tokens).
	if (process.platform !== 'win32') {
		const bin = path.join(folder, 'claude'), heard = path.join(folder, 'heard.txt');
		fs.writeFileSync(bin, `#!/usr/bin/env node
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'init', permissionMode: 'default' });
require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.type === 'user') { require('node:fs').appendFileSync(${JSON.stringify(heard)}, String(m.message.content) + '\\n'); out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Two need you.' }] } }); out({ type: 'result', subtype: 'success', result: 'Two need you.' }); }
});
`, { mode: 0o755 });
		owned.findClaude = () => bin;
		const before = new Set(tracker.sessions.keys());
		await box(`[...document.querySelectorAll('.row.routine button')].find((b) => b.textContent === 'Run now').click()`);
		check(await until(() => { try { return /Look over my open pull requests/.test(fs.readFileSync(heard, 'utf8')); } catch { return false; } }, 8000), 'Run now starts a fresh session there, told what you said');
		const fresh = [...tracker.sessions.keys()].find((k) => !before.has(k));
		check(!!fresh && inbox.log(fresh).some((e) => e.who === 'note' && /A routine of yours, weekdays at 08:30/.test(e.text)), 'its box says it’s a routine, and when');
		if (fresh) owned.end(fresh);
	}
	await box(`[...document.querySelectorAll('.row.routine button')].find((b) => b.textContent === 'Stop').click()`);
	check(await until(() => box(`!document.querySelector('.row.routine')`)), 'Stop takes it away');
	check((await box(`blaubeTalk.routines()`)).length === 0, 'and it’s gone for good');

	fs.rmSync(folder, { recursive: true, force: true });
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
