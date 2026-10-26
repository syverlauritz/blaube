// End-to-end check of Blobs (show and hide each session's blob) and Max
// blobs, in the real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/blobs.js BLAUBE_PORT=47878 electron .
//
// The overview opens from the tray menu and lists every session; its eyes
// take blobs off the stage and put them back while their sessions carry
// on; Max blobs puts the least relevant away by itself; one that needs you
// always shows; one shown by hand takes a less busy one's spot. With
// BLAUBE_BLOBS_SHOTS=<folder> it also saves the overview, light and dark.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run({ win, tracker, talk, talkId }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
	const page = (js) => win.webContents.executeJavaScript(js);
	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);

	// Eight sessions, each its own project, in all four states.
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-blobs-'));
	const names = ['blaube', 'kalkis', 'paintbox', 'garden', 'ledger', 'notes', 'studio', 'website'];
	const ids = names.map((n) => `blobs-${n}`);
	const ev = (i, hook_event_name, extra) => tracker.handle(Object.assign({ session_id: ids[i], cwd: path.join(root, names[i]), hook_event_name }, extra));
	for (const n of names) fs.mkdirSync(path.join(root, n));
	const states = ['working', 'idle', 'done', 'idle', 'working', 'done', 'idle', 'done'];
	for (let i = 0; i < ids.length; i++) {
		ev(i, 'SessionStart');
		if (states[i] === 'working') ev(i, 'UserPromptSubmit', { prompt: 'go' });
		if (states[i] === 'done') { ev(i, 'UserPromptSubmit', { prompt: 'go' }); ev(i, 'Stop'); }
		await sleep(30); // (so each was heard from at its own time)
	}
	ev(0, 'SubagentStart', { agent_id: 'h1', agent_type: 'Explore' });
	ev(0, 'SubagentStart', { agent_id: 'h2', agent_type: 'Plan' });
	const onStage = () => (global.__blaubeState ? global.__blaubeState.sessions.map((s) => s.id) : []);
	const buddies = () => page(`[...__blaube.buddies.values()].filter((b) => !b.merging && !b.dying).map((b) => b.key)`);
	check(await until(async () => ids.every((id) => onStage().includes(id)), 15000), 'eight sessions, eight blobs on the stage');
	check(await until(async () => { const b = await buddies(); return ids.every((id) => b.includes(id)); }, 8000), 'and their slimes are out');

	// Blobs…, from the top of the tray menu.
	const tray = global.__blaubeTrayMenu();
	check(tray.items[0].label === 'Blobs…', 'Blobs… first in the tray menu');
	tray.items[0].click();
	let bw = null;
	check(await until(() => (bw = global.__blaubeBlobs()) && !bw.webContents.isLoading() && bw.isVisible(), 8000), 'the overview opens');
	const box = (js) => bw.webContents.executeJavaScript(js);
	const rows = () => box(`[...document.querySelectorAll('#rows li[data-id]')].map((li) => ({ id: li.dataset.id, name: li.querySelector('b').textContent, how: li.querySelector('small').textContent, open: li.querySelector('.eye').getAttribute('aria-pressed') === 'true' }))`);
	check(await until(async () => (await rows()).length === 8), 'it lists all eight');
	const r0 = (await rows()).find((r) => r.id === ids[0]);
	check(!!r0 && r0.name === 'blaube' && /^Working · 2 helpers$/.test(r0.how) && r0.open, `a row: name, status, helpers, eye open (${r0 && r0.how})`);
	const eye = (id) => box(`document.querySelector('#rows li[data-id="${id}"] .eye').click()`);
	const row = async (id) => (await rows()).find((r) => r.id === id);

	// Its eye: off the stage, still tracked; and back.
	await eye(ids[0]);
	check(await until(() => !onStage().includes(ids[0])), 'closing its eye takes its blob off the stage');
	check(await until(async () => { const b = await buddies(); return !b.includes(ids[0]) && !b.includes(`${ids[0]}/h1`); }, 8000), 'it and its helpers go back in');
	check(tracker.sessions.has(ids[0]), 'its session is still tracked');
	check(await until(async () => { const r = await row(ids[0]); return r && !r.open && /hidden/.test(r.how); }), 'the row says hidden, eye closed');
	ev(0, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
	check(!onStage().includes(ids[0]), 'it stays hidden as its session works on');
	check(global.__blaubeSessionMenu(ids[0]).items.slice(-1)[0].label === 'Show', 'its menu says Show');
	await eye(ids[0]);
	check(await until(() => onStage().includes(ids[0])), 'opening its eye puts it back');
	check(await until(async () => (await buddies()).includes(ids[0]), 8000), 'its slime comes out again');
	check(global.__blaubeSessionMenu(ids[0]).items.slice(-1)[0].label === 'Hide', 'its menu says Hide');

	// Max blobs: 3. Two working ones stay; then the latest idle/done one.
	await box(`(() => { const s = document.getElementById('max'); s.value = '3'; s.dispatchEvent(new Event('change')); })()`);
	const want3 = [ids[0], ids[4], ids[7]]; // working, working, the done one heard from last
	check(await until(() => onStage().length === 3 && want3.every((id) => onStage().includes(id))), `max 3: the two working and the latest (${onStage().map((id) => id.slice(6)).join(', ')})`);
	check(await until(async () => /hidden \(over max\)/.test((await row(ids[1])).how) && !(await row(ids[1])).open), 'the rest say hidden (over max), eyes closed');
	check(await box(`!document.getElementById('maxHint').hidden`), 'it says ones that need you always show');

	// Needs you: always out, even over the max.
	ev(1, 'Notification', { message: 'Claude needs your permission to use Bash' });
	ev(2, 'Notification', { message: 'Claude needs your permission to use Bash' });
	ev(3, 'Notification', { message: 'Claude needs your permission to use Bash' });
	ev(5, 'Notification', { message: 'Claude needs your permission to use Bash' });
	check(await until(() => [1, 2, 3, 5].every((i) => onStage().includes(ids[i])) && onStage().length === 4), `four need you: all four out, over the max of 3 (${onStage().map((id) => id.slice(6)).join(', ')})`);
	check(await until(async () => /shows even over the max/.test((await row(ids[1])).how)), 'and their rows say so');

	// Showing one by hand: no room (they all need you), and it says why.
	await eye(ids[6]);
	check(await until(async () => /taken by blobs that need you/.test(await box(`document.getElementById('note').textContent`)) && !(await box(`document.getElementById('note').hidden`))), 'showing one with every spot needing you says why');
	check(!onStage().includes(ids[6]), 'and it stays put away');
	// Answered: back under the max, and the one you showed takes a spot.
	for (const i of [1, 2, 3, 5]) ev(i, 'Stop');
	check(await until(() => onStage().length === 3 && onStage().includes(ids[6])), `answered: three again, the one you showed among them (${onStage().map((id) => id.slice(6)).join(', ')})`);
	// Shown by hand over the max: a less busy one makes way.
	await eye(ids[2]);
	check(await until(() => onStage().length === 3 && onStage().includes(ids[2])), `another shown by hand: still three, it among them (${onStage().map((id) => id.slice(6)).join(', ')})`);
	// Hidden by hand wins over the max's picks.
	await eye(ids[2]);
	check(await until(async () => !onStage().includes(ids[2]) && /· hidden$/.test((await row(ids[2])).how)), 'hidden by hand again: hidden (not over max)');

	// No limit; Hide all idle; Show all.
	await box(`(() => { const s = document.getElementById('max'); s.value = '0'; s.dispatchEvent(new Event('change')); })()`);
	check(await until(() => onStage().length === 7), 'no limit: all but the one you hid');
	await box(`document.getElementById('hideIdle').click()`);
	const busy = ids.filter((id) => tracker.sessions.get(id).state === 'working');
	check(await until(() => onStage().length === busy.length && busy.every((id) => onStage().includes(id))), `Hide all idle: only the working ones out (${busy.length})`);
	await box(`document.getElementById('showAll').click()`);
	check(await until(() => onStage().length === 8), 'Show all: all eight');

	// A row's name opens its talk box, even one whose blob is hidden.
	await eye(ids[3]);
	await until(() => !onStage().includes(ids[3]));
	await box(`document.querySelector('#rows li[data-id="${ids[3]}"] .who').click()`);
	check(await until(() => talk() && talk().isVisible() && talkId() === ids[3], 8000), 'its name opens its talk box (blob hidden)');

	// Kept across a restart: in the prefs while it runs.
	const prefsFile = path.join(require('electron').app.getPath('userData'), 'prefs.json');
	check(await until(() => { try { return ids[3] in (JSON.parse(fs.readFileSync(prefsFile, 'utf8')).hiddenBlobs || {}); } catch { return false; } }, 3000), 'hidden is kept in the prefs (for a restart)');
	ev(3, 'SessionEnd');
	check(await until(() => { try { return !(ids[3] in (JSON.parse(fs.readFileSync(prefsFile, 'utf8')).hiddenBlobs || {})); } catch { return false; } }, 3000), 'and forgotten once its session ends');
	ev(3, 'SessionStart');

	// The pictures: eight, some hidden, one needing you; light and dark.
	const out = process.env.BLAUBE_BLOBS_SHOTS;
	if (out) {
		fs.mkdirSync(out, { recursive: true });
		ev(5, 'Notification', { message: 'Claude needs your permission to use Bash' });
		await box(`(() => { const s = document.getElementById('max'); s.value = '5'; s.dispatchEvent(new Event('change')); })()`);
		await until(async () => (await rows()).length === 8);
		await sleep(400);
		// (kalkis hidden by hand, the rest as the max of 5 leaves them)
		if (!(await row(ids[1])).open) { await eye(ids[1]); await until(async () => (await row(ids[1])).open); }
		await eye(ids[1]);
		await until(async () => /· hidden$/.test((await row(ids[1])).how));
		await sleep(900);
		fs.writeFileSync(path.join(out, 'blobs-light.png'), (await bw.webContents.capturePage()).toPNG());
		const { ipcMain } = require('electron');
		ipcMain.emit('talk-dark', {}, true);
		await until(() => box(`document.body.classList.contains('dark')`));
		await sleep(500);
		fs.writeFileSync(path.join(out, 'blobs-dark.png'), (await bw.webContents.capturePage()).toPNG());
		ipcMain.emit('talk-dark', {}, false);
		console.log(`     saved ${path.join(out, 'blobs-light.png')} and blobs-dark.png`);
	}

	bw.close();
	for (const id of ids) tracker.handle({ session_id: id, hook_event_name: 'SessionEnd' });
	return failed ? 1 : 0;
};
