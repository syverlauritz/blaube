// End-to-end check of Blobs (show and hide each session's blob) and Max
// blobs, in the real app but invisible:
//
//   BLAUBE_TEST=scripts/e2e/blobs.js BLAUBE_PORT=47878 electron .
//
// The overview opens from the tray menu and lists every session; its eyes
// take blobs off the stage and put them back while their sessions carry
// on; Max blobs puts the least relevant away by itself; one that needs you
// always shows; one shown by hand takes a less busy one's spot. Helpers
// have rows (and eyes) of their own under their session; what each is on
// shows in its own column; Max blobs is a stepper. With
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
	const all = () => box(`[...document.querySelectorAll('#rows li[data-id]')].map((li) => ({ id: li.dataset.id, kid: li.classList.contains('kid'), name: li.querySelector('.who').textContent, how: [li.querySelector('.status span').textContent, li.querySelector('.status small').textContent].filter(Boolean).join(' · '), doing: li.querySelector('.doing').textContent, open: li.querySelector('.eye').getAttribute('aria-pressed') === 'true', byParent: li.querySelector('.eye').classList.contains('byparent') }))`);
	const rows = async () => (await all()).filter((r) => !r.kid);
	check(await until(async () => (await rows()).length === 8), 'it lists all eight');
	check(await box(`[...document.querySelectorAll('.cols span')].map((c) => c.textContent).join('|')`) === 'Name|Status|Working on|Shown', 'as a table: Name, Status, Working on, Shown');
	const r0 = (await rows()).find((r) => r.id === ids[0]);
	check(!!r0 && r0.name === 'blaube' && /^Working · 2 helpers$/.test(r0.how) && r0.open, `a row: name, status, helpers, eye open (${r0 && r0.how})`);
	const eye = (id) => box(`document.querySelector('#rows li[data-id="${id}"] .eye').click()`);
	const row = async (id) => (await all()).find((r) => r.id === id);
	const setMax = (n) => box(`(() => { const i = document.getElementById('max'); i.focus(); i.value = '${n}'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
	const agentsOut = (i) => { const s = (global.__blaubeState ? global.__blaubeState.sessions : []).find((x) => x.id === ids[i]); return s ? s.agents.map((a) => a.id) : []; };

	// Its helpers: rows of their own under it, each with what it's on and an eye.
	const h1 = `${ids[0]}/h1`, h2 = `${ids[0]}/h2`;
	tracker.handle({ session_id: ids[0], cwd: path.join(root, names[0]), hook_event_name: 'PreToolUse', agent_id: 'h1', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'face.js') } });
	tracker.handle({ session_id: ids[0], cwd: path.join(root, names[0]), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
	check(await until(async () => { const r = await all(); const i = r.findIndex((x) => x.id === ids[0]); return r[i + 1] && r[i + 1].kid && r[i + 2] && r[i + 2].kid && r[i + 2].id.startsWith(ids[0]); }), 'its two helpers are rows right under it');
	check(await until(async () => /face\.js/.test((await row(h1)).doing)), `a helper says what it's on (${(await row(h1)).doing})`);
	check(await until(async () => /the tests/.test((await row(ids[0])).doing)), `and so does its session (${(await row(ids[0])).doing})`);
	check(await until(async () => /^Working · \d+s\b/.test((await row(h1)).how)), `and how long a helper has been at it, as the terminal says (${(await row(h1)).how})`);
	await box(`document.querySelector('#rows li[data-id="${ids[0]}"] .fold').click()`);
	check(await until(async () => !(await row(h1))), 'folded: its helpers tucked away');
	await box(`document.querySelector('#rows li[data-id="${ids[0]}"] .fold').click()`);
	check(await until(async () => !!(await row(h1))), 'unfolded: back');
	await eye(h1);
	check(await until(() => !agentsOut(0).includes('h1') && agentsOut(0).includes('h2')), 'a helper’s eye takes just that helper off the stage');
	check(await until(async () => !(await buddies()).includes(h1) && (await buddies()).includes(h2), 8000), 'its slime goes back in, the other stays');
	check(!(await row(h1)).open && (await row(h2)).open, 'its eye closed, the other’s open');
	await eye(h1);
	check(await until(async () => agentsOut(0).includes('h1') && (await buddies()).includes(h1), 8000), 'and opening it brings the helper back out');
	await eye(h1); // (hidden by hand again, for what follows)
	await until(() => !agentsOut(0).includes('h1'));

	// Its eye: off the stage, still tracked; and back.
	await eye(ids[0]);
	check(await until(() => !onStage().includes(ids[0])), 'closing its eye takes its blob off the stage');
	check(await until(async () => { const b = await buddies(); return !b.includes(ids[0]) && !b.includes(`${ids[0]}/h1`); }, 8000), 'it and its helpers go back in');
	check(tracker.sessions.has(ids[0]), 'its session is still tracked');
	check(await until(async () => { const r = await row(ids[0]); return r && !r.open && /hidden/.test(r.how); }), 'the row says hidden, eye closed');
	check(await until(async () => (await row(h1)).byParent && (await row(h2)).byParent && /hidden with it/.test((await row(h2)).how)), 'its helpers’ eyes say hidden with it, dimmed');
	ev(0, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
	check(!onStage().includes(ids[0]), 'it stays hidden as its session works on');
	check(global.__blaubeSessionMenu(ids[0]).items.slice(-1)[0].label === 'Show', 'its menu says Show');
	await eye(ids[0]);
	check(await until(() => onStage().includes(ids[0])), 'opening its eye puts it back');
	check(await until(async () => (await buddies()).includes(ids[0]), 8000), 'its slime comes out again');
	check(await until(async () => (await buddies()).includes(h2) && !(await buddies()).includes(h1) && !(await row(h1)).open && (await row(h2)).open, 8000), 'its helpers as you left them: the one you hid stays hidden');
	await eye(h1);
	await until(() => agentsOut(0).includes('h1'));
	check(global.__blaubeSessionMenu(ids[0]).items.slice(-1)[0].label === 'Hide', 'its menu says Hide');

	// Max blobs: 3. Two working ones stay; then the latest idle/done one.
	check(await box(`document.getElementById('noLimit').classList.contains('on') && document.getElementById('max').value === '' && document.getElementById('less').disabled`), 'Max blobs starts at No limit (lit), − can’t go lower');
	await box(`document.getElementById('more').click()`);
	check(await until(async () => (await box(`document.getElementById('max').value`)) === '8' && onStage().length === 8), '+ from No limit starts at as many as there are (8), nothing hides');
	await box(`document.getElementById('less').click()`);
	check(await until(async () => (await box(`document.getElementById('max').value`)) === '7' && onStage().length === 7), '− makes it 7, and one goes');
	await box(`document.getElementById('noLimit').click()`);
	check(await until(async () => (await box(`document.getElementById('max').value`)) === '' && onStage().length === 8), 'No limit clears it: all eight back');
	await setMax(3);
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
	check(await until(async () => /shows over the max/.test((await row(ids[1])).how)), 'and their rows say so');

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
	await setMax('');
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
		await setMax(5);
		ev(4, 'SubagentStart', { agent_id: 'h3', agent_type: 'Explore' });
		tracker.handle({ session_id: ids[4], cwd: path.join(root, names[4]), hook_event_name: 'PreToolUse', agent_id: 'h3', tool_name: 'Grep', tool_input: { pattern: 'maxBlobs' } });
		await until(async () => (await rows()).length === 8);
		await sleep(400);
		// (kalkis hidden by hand, the rest as the max of 5 leaves them)
		if (!(await row(ids[1])).open) { await eye(ids[1]); await until(async () => (await row(ids[1])).open); }
		await eye(ids[1]);
		await until(async () => /· hidden$/.test((await row(ids[1])).how));
		await eye(h2); // (a helper hidden by hand too)
		await until(async () => !(await row(h2)).open);
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
