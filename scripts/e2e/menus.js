// End-to-end check of the right-click menus, invisible: they build, their
// most used items come first, a slime's menu is its own part then Blaube's
// (the same as Blaube's own), the tray has each slime's own part under its
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
	const fresh = (l) => l.findIndex((x) => /^New session/.test(x)); // ('New session…', or a submenu once there are recent folders)
	const sound = () => find(app(), 'Sound').submenu;
	console.log('     Blaube menu: ' + top.join(' | '));
	check(fresh(top) < top.indexOf('Sing together') && top.indexOf('Sing together') < top.indexOf('Sound') && top.indexOf('Sound') < top.indexOf('Play'), 'a new session first, then singing, the sound and the toys');
	check(['Sound', 'Volume'].every((l) => labels(sound()).includes(l)) && !top.includes('Volume'), 'the sound settings together under Sound');
	check(!top.includes('Claude Code') && !find(app(), 'Play').submenu.items.some((i) => i.label === 'Choir'), 'nothing in it twice');
	check(top[top.length - 1] === 'Quit Blaube', 'quitting last');
	const settingsMenu = () => find(app(), 'Settings').submenu;
	check(['Notifications', 'Live on display', 'Open at login', 'All settings…'].every((l) => labels(settingsMenu()).includes(l)), 'the rarely touched settings together under Settings');
	check(!!find(settingsMenu(), 'Claude Code') && find(settingsMenu(), 'Claude Code').submenu.items.some((i) => i.label === 'New sessions start on'), 'Claude Code’s defaults under Settings ▸ Claude Code');

	// A slime's menu: its own part, then Blaube's, the same as everywhere.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-menus-'));
	tracker.handle({ session_id: 'menus-a', cwd: dir, hook_event_name: 'SessionStart' });
	const slime = () => global.__blaubeSessionMenu('menus-a');
	const its = labels(slime());
	console.log('     slime menu: ' + its.join(' | '));
	check(its.indexOf('Talk') < its.indexOf('Go to its terminal') && its.indexOf('Go to its terminal') < its.indexOf('Session') && its.indexOf('Hide') < its.indexOf('Sound'), 'talking and its terminal first, its own part before Blaube’s');
	const same = (l) => l.slice(fresh(l)).filter((x) => x !== 'Blobs…'); // (the tray has Blobs… at its very top)
	check(JSON.stringify(same(its)) === JSON.stringify(same(top)), 'Blaube’s part is the same as Blaube’s own menu');
	check(['Fork into a new session', 'Notify me about this one', 'Save conversation as Markdown', 'Copy resume command', 'Resume in a new terminal'].every((l) => find(slime(), 'Session').submenu.items.some((i) => i.label === l)), 'the rarer ones under Session');
	check(its.includes('Colour') && its.indexOf('Colour') < its.indexOf('Hide'), 'its own colour in it, before Hide');

	// The tray: no app-wide Colour; a row per session, its status said once,
	// and under it that slime's own part, without Blaube's again.
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
		check(sub[sub.length - 1] === 'Hide' && !sub.includes('Sound') && !sub.includes('Quit Blaube'), 'and none of Blaube’s menu in it');
	}

	// The sound settings: the same ones as Settings, which keeps up.
	find(find(app(), 'Settings').submenu, 'All settings…').click();
	let settings = null;
	await until(() => (settings = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Blaube settings' && !w.webContents.isLoading())), 8000);
	await sleep(500);
	const shown = (key) => settings.webContents.executeJavaScript(`(() => { const label = ${JSON.stringify(require('../../src/shared/config').SETTINGS.find((s) => s[0] === key)[5])}; const row = [...document.querySelectorAll('.row')].find((r) => r.querySelector('span').textContent === label); const c = row.querySelector('select, input'); return c.value; })()`);
	check(!!settings && (await shown('voice')) === 'On', 'Settings shows the sound on');
	find(find(slime(), 'Sound').submenu, 'Sound').click();
	check(!find(sound(), 'Sound').checked, 'turning the sound off in a slime’s menu turns it off in Blaube’s');
	check(!find(app(), 'Sing together').enabled, 'and the choir waits for it');
	check(await until(async () => (await shown('voice')) === 'Off', 3000), 'and Settings shows it off');
	find(sound(), 'Sound').click();
	find(sound(), 'Volume').submenu.items.find((i) => i.label === '25%').click();
	check(find(find(slime(), 'Sound').submenu, 'Sound').checked && find(find(slime(), 'Sound').submenu, 'Volume').submenu.items.find((i) => i.label === '25%').checked, 'on again, at 25%');
	check(await until(async () => Number(await shown('voiceVolume')) === 0.25, 3000), 'and Settings’ volume slider moves to it');
	// Moved in Settings: the menus tick it.
	await settings.webContents.executeJavaScript(`(() => { const i = [...document.querySelectorAll('.row')].find((r) => r.querySelector('span').textContent === 'Voice volume').querySelector('input'); i.value = '0.35'; i.dispatchEvent(new Event('input')); })()`);
	check(await until(() => { const v = find(sound(), 'Volume').submenu.items.find((i) => i.checked); return v && v.label === '35%'; }, 3000), 'a volume set in Settings shows ticked in the menu');
	settings.close();

	tracker.handle({ session_id: 'menus-a', hook_event_name: 'SessionEnd' });
	return failed ? 1 : 0;
};
