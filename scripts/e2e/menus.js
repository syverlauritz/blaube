// End-to-end check of the right-click menus, invisible: they build, their
// most used items come first, the tray has each slime's own menu under its
// row (and no app-wide Colour), and the sound settings in them change the
// same settings as the Settings window, which keeps up.
//
//   BLAUBE_TEST=scripts/e2e/menus.js BLAUBE_PORT=47872 electron .
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserWindow } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run({ win, tracker }) {
	let failed = 0;
	const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
	const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
	await until(() => !win.webContents.isLoading(), 8000);
	await sleep(800);

	const labels = (menu) => menu.items.map((i) => (i.type === 'separator' ? '—' : i.label));
	const find = (menu, label) => menu.items.find((i) => i.label === label);

	// Blaube's own menu (on a Blaube with no sessions, and the menu bar's).
	const app = () => global.__blaubeTrayMenu();
	const top = labels(app());
	console.log('     Blaube menu: ' + top.join(' | '));
	check(top.indexOf('New session…') < top.indexOf('Sound') && top.indexOf('Sound') < top.indexOf('Play'), 'a new session first, then the sound, then the toys');
	check(['Sound', 'Volume', 'Wah at the start of each note', 'Sing together'].every((l) => top.includes(l)), 'the sound settings are right there');
	check(!top.includes('Sounds') && !top.includes('Claude Code defaults') && !find(app(), 'Play').submenu.items.some((i) => i.label === 'Choir'), 'nothing in it twice');
	check(top[top.length - 1] === 'Quit Blaube', 'quitting last');
	check(!!find(app(), 'Claude Code') && find(app(), 'Claude Code').submenu.items.some((i) => i.label === 'New sessions start on'), 'Claude Code’s defaults under Claude Code');

	// A slime's menu.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-menus-'));
	tracker.handle({ session_id: 'menus-a', cwd: dir, hook_event_name: 'SessionStart' });
	const slime = () => global.__blaubeSessionMenu('menus-a');
	const its = labels(slime());
	console.log('     slime menu: ' + its.join(' | '));
	check(its.indexOf('Talk') < its.indexOf('Go to its terminal') && its.indexOf('Go to its terminal') < its.indexOf('Sound'), 'talking and its terminal first');
	check(['Sound', 'Volume', 'Wah at the start of each note'].every((l) => its.includes(l)), 'the sound settings are at its top level');
	check(!find(slime(), 'Blaube').submenu.items.some((i) => i.label === 'Sound'), 'and not again in its Blaube submenu');
	check(['Notify me about this one', 'Save conversation as Markdown', 'Copy resume command'].every((l) => find(slime(), 'More').submenu.items.some((i) => i.label === l)), 'the rarer ones under More');
	check(its[its.length - 1] === 'Hide', 'hiding it last');
	check(its.includes('Colour'), 'its own colour in it');

	// The tray: no app-wide Colour; a row per session, its status said once,
	// and under it that slime's own menu, without the app-wide bits again.
	check(!top.includes('Colour'), 'no Colour in the tray’s own part');
	const row = () => app().items.find((i) => i.submenu && /menus-a|blaube-menus-/.test(i.label));
	check(await until(() => !!row(), 6000), 'a row for the session in the tray');
	if (row()) {
		const r = row();
		console.log('     tray row: ' + r.label + ' ▸ ' + labels(r.submenu).join(' | '));
		const status = r.label.split(' — ')[1] || '';
		check(!!status && r.label.split(status).length === 2 && !r.sublabel, 'its status said once, on the row');
		const sub = labels(r.submenu);
		check(sub.includes('Talk') && sub.includes('Colour'), 'its submenu has Talk and its Colour');
		check(sub.indexOf('Talk') < sub.indexOf('Open project folder') && sub.indexOf('Open project folder') < sub.indexOf('Colour') && sub.indexOf('Colour') < sub.indexOf('Hide'), 'in the same order as right-clicking it');
		check(!sub.includes('Sound') && !sub.includes('Blaube'), 'and no sound or Blaube submenu in it');
	}

	// The sound settings: the same ones as Settings, which keeps up.
	find(app(), 'Settings…').click();
	let settings = null;
	await until(() => (settings = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Blaube settings' && !w.webContents.isLoading())), 8000);
	await sleep(500);
	const shown = (key) => settings.webContents.executeJavaScript(`(() => { const label = ${JSON.stringify(require('../../src/shared/config').SETTINGS.find((s) => s[0] === key)[5])}; const row = [...document.querySelectorAll('.row')].find((r) => r.querySelector('span').textContent === label); const c = row.querySelector('select, input'); return c.value; })()`);
	check(!!settings && (await shown('voice')) === 'On', 'Settings shows the sound on');
	find(slime(), 'Sound').click();
	check(!find(app(), 'Sound').checked, 'turning the sound off in a slime’s menu turns it off in Blaube’s');
	check(!find(app(), 'Sing together').enabled, 'and the choir waits for it');
	check(await until(async () => (await shown('voice')) === 'Off', 3000), 'and Settings shows it off');
	find(app(), 'Sound').click();
	find(app(), 'Volume').submenu.items.find((i) => i.label === '25%').click();
	check(find(slime(), 'Sound').checked && find(slime(), 'Volume').submenu.items.find((i) => i.label === '25%').checked, 'on again, at 25%');
	check(await until(async () => Number(await shown('voiceVolume')) === 0.25, 3000), 'and Settings’ volume slider moves to it');
	find(slime(), 'Wah at the start of each note').submenu.items.find((i) => i.label === 'None').click();
	check(await until(async () => Number(await shown('voiceWah')) === 0, 3000), 'no wah, and Settings says so');
	// Moved in Settings: the menus tick it.
	await settings.webContents.executeJavaScript(`(() => { const i = [...document.querySelectorAll('.row')].find((r) => r.querySelector('span').textContent === 'Voice volume').querySelector('input'); i.value = '0.35'; i.dispatchEvent(new Event('input')); })()`);
	check(await until(() => { const v = find(app(), 'Volume').submenu.items.find((i) => i.checked); return v && v.label === '35%'; }, 3000), 'a volume set in Settings shows ticked in the menu');
	settings.close();

	tracker.handle({ session_id: 'menus-a', hook_event_name: 'SessionEnd' });
	return failed ? 1 : 0;
};
