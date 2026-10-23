// End-to-end check of a session Blaube starts itself, with the real
// Claude Code (a short, cheap conversation on Haiku), invisible:
//
//   npm run e2e:start
//
// Starts a session in a temporary folder, checks its slime and talk box
// open by themselves, says something through the talk box, waits for the
// reply, says something else while... and ends it from its menu path.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run({ win, inbox, owned, startSession, talk, talkId, tracker }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
	const box = (js) => talk().webContents.executeJavaScript(js);
	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-start-'));
	const id = startSession(dir, ['--model', 'haiku']);
	check(owned.has(id), 'a session starts');
	check(await until(() => win.webContents.executeJavaScript(`!!__blaube.buddies.get(${JSON.stringify(id)})`)), 'its slime appears');
	check(await until(() => talk() && talk().isVisible() && talkId() === id, 8000), 'its talk box opens by itself');
	check(await box(`/What should we do in/.test(document.getElementById('inner').textContent)`), 'asking what to do');
	check(await box(`document.getElementById('terminal').style.display === 'none'`), 'with no terminal button (it has none)');

	await box(`(() => { const t = document.getElementById('text'); t.value = 'Reply with only the word PEACH.'; t.dispatchEvent(new Event('input')); document.getElementById('form').requestSubmit(); })()`);
	check(await until(() => tracker.sessions.get(id) && tracker.sessions.get(id).state === 'working', 3000), 'sending starts its turn');
	check(await until(async () => /PEACH/.test(await box(`[...document.querySelectorAll('#inner .msg.claude')].map((e) => e.textContent).join('|')`)), 60000), 'its reply comes back into the box');
	check(await until(() => tracker.sessions.get(id).state === 'done', 5000), 'and it’s done');

	// Straight in, even while it works: two in a row both get answered.
	await box(`(() => { const t = document.getElementById('text'); t.value = 'Reply with only the word PLUM.'; t.dispatchEvent(new Event('input')); document.getElementById('form').requestSubmit(); })()`);
	await sleep(300);
	await box(`(() => { const t = document.getElementById('text'); t.value = 'Now reply with only the word KIWI.'; t.dispatchEvent(new Event('input')); document.getElementById('form').requestSubmit(); })()`);
	check(await until(async () => /KIWI/.test(await box(`[...document.querySelectorAll('#inner .msg.claude')].map((e) => e.textContent).join('|')`)), 60000), 'a second message sent while it worked gets answered too');
	const log = inbox.log(id).map((e) => e.who).join(',');
	check(!/you,you,you/.test(log) && inbox.log(id).filter((e) => e.who === 'you').length === 3, `no doubled entries (${log})`);

	owned.end(id);
	check(await until(() => !owned.has(id), 8000), 'ending it stops it');
	check(await until(() => !tracker.sessions.has(id), 3000), 'and its slime goes');
	fs.rmSync(dir, { recursive: true, force: true });
	console.log(failed ? `\n${failed} failed` : '\nall passed');
	return failed ? 1 : 0;
};
