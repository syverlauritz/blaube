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
module.exports = async function run({ win, tracker, inbox, talk, talkId }) {
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

	fs.rmSync(folder, { recursive: true, force: true });
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
