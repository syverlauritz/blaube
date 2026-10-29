// Updates from GitHub Releases (electron-updater). Windows downloads them in
// the background and installs when you quit or pick "Restart to update". A
// Mac can only install an update itself when the app is signed with a
// Developer ID (Squirrel.Mac refuses ad-hoc signatures), so an ad-hoc build
// just says a new version is out (once, through opts.announce) and opens its
// download page.
const { app, shell, dialog } = require('electron');

const RELEASES = 'https://github.com/syverlauritz/blaube/releases/latest';
const EVERY = 4 * 60 * 60e3;

let updater = null;
let state = { status: 'idle', version: '' }; // idle | checking | downloading | ready | available | error
let onChange = () => {};
let log = () => {};
let announce = () => {};
let asked = false; // (a check you asked for answers even "you're up to date")

// Signed builds get blaubeSigned in their package.json (build/signed.config.js).
const canInstall = () => process.platform !== 'darwin' || !!require('../../package.json').blaubeSigned;

function set(next) {
  state = Object.assign({}, state, next);
  onChange(state);
}

function start(opts = {}) {
  onChange = opts.onChange || onChange;
  log = opts.log || log;
  announce = opts.announce || announce;
  if (!app.isPackaged || opts.test) return;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch (e) { log(`no updater: ${e.message}`); return; }
  updater.autoDownload = canInstall();
  updater.autoInstallOnAppQuit = canInstall();
  updater.logger = { info: () => {}, warn: (m) => log(`update: ${m}`), error: (m) => log(`update error: ${m}`), debug: () => {} };
  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-not-available', () => {
    set({ status: 'idle' });
    if (asked) dialog.showMessageBox({ type: 'info', message: 'Blaube is up to date', detail: `You have the newest version, ${app.getVersion()}.` });
    asked = false;
  });
  updater.on('update-available', (info) => {
    set({ status: canInstall() ? 'downloading' : 'available', version: info.version });
    log(`update ${info.version} is out`);
    if (asked && !canInstall()) offerDownload(info.version);
    else if (!canInstall()) announce(info.version, () => shell.openExternal(RELEASES));
    asked = false;
  });
  updater.on('update-downloaded', (info) => { set({ status: 'ready', version: info.version }); log(`update ${info.version} is ready`); });
  updater.on('error', (e) => {
    set({ status: 'error' });
    log(`update check failed: ${e && e.message}`);
    if (asked) dialog.showMessageBox({ type: 'warning', message: 'Couldn’t check for updates', detail: 'Blaube couldn’t reach GitHub. Try again later, or look for a new version on the releases page.', buttons: ['OK', 'Open releases page'] }).then((r) => { if (r.response === 1) shell.openExternal(RELEASES); });
    asked = false;
  });
  check();
  setInterval(check, EVERY).unref();
}

function check(byHand = false) {
  if (!updater) { if (byHand) shell.openExternal(RELEASES); return; }
  if (state.status === 'ready') return install();
  if (state.status === 'available' && byHand) return offerDownload(state.version);
  asked = byHand;
  updater.checkForUpdates().catch(() => {}); // (reported through 'error')
}

function offerDownload(version) {
  dialog.showMessageBox({ type: 'info', message: `Blaube ${version} is out`, detail: `You have ${app.getVersion()}. Download the new one and drag it into Applications over this one.`, buttons: ['Download', 'Later'] })
    .then((r) => { if (r.response === 0) shell.openExternal(RELEASES); });
}

function install() {
  if (updater && state.status === 'ready') setImmediate(() => updater.quitAndInstall(false, true));
}

// The menu row under "Blaube x.y.z".
function menuItem() {
  const v = state.version;
  switch (state.status) {
    case 'ready': return { label: `Restart to update to ${v}`, click: install };
    case 'available': return { label: `Download Blaube ${v}…`, click: () => shell.openExternal(RELEASES) };
    case 'downloading': return { label: `Downloading ${v}…`, enabled: false };
    case 'checking': return { label: 'Checking for updates…', enabled: false };
    default: return { label: 'Check for updates…', click: () => check(true) };
  }
}

module.exports = { start, check, menuItem, state: () => state };
