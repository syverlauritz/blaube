// The sound settings, right in the right-click menus: voices on or off, how
// loud, how much wah, and the choir. They change the same settings as the
// Settings window (voice, voiceVolume, voiceWah in shared/config.js).
// A plain template, so it's tested without Electron.

const VOLUMES = [0.1, 0.25, 0.5, 0.75, 1];
const WAHS = [0, 0.25, 0.5, 0.8, 1];
const pct = (v) => `${Math.round(v * 100)}%`;
const near = (a, b) => Math.abs(a - b) < 0.001;

// A radio list of levels; a value set in Settings that isn't one of them
// shows too, ticked, where it falls.
function levels(list, now, key, set, word = pct) {
  const all = list.some((v) => near(v, now)) ? list : [...list, now].sort((a, b) => a - b);
  return all.map((v) => ({
    label: word(v),
    type: 'radio',
    checked: near(v, now),
    enabled: list.includes(v),
    click: () => set({ [key]: v }),
  }));
}

// config: the current settings; set(partial) changes some of them.
// songs and sing(id) / stopSinging() add the choir (Sing together); leave
// them out for the voice settings alone.
function soundMenu(config, set, { songs, sing, stopSinging } = {}) {
  const on = config.voice !== 'Off';
  return [
    { label: 'Sound', type: 'checkbox', checked: on, toolTip: 'They say what’s in their bubbles out loud', click: (i) => set({ voice: i.checked ? 'On' : 'Off' }) },
    { label: 'Volume', submenu: levels(VOLUMES, config.voiceVolume, 'voiceVolume', set) },
    { label: 'Wah at the start of each note', submenu: levels(WAHS, config.voiceWah, 'voiceWah', set, (v) => (v === 0 ? 'None' : pct(v))) },
    // Everyone sings, in parts: the more slimes, the fuller. (Not with the
    // sound off: they'd only mouth it.)
    ...(songs ? [{ label: 'Sing together', enabled: on, submenu: [
      ...songs.map((s) => ({ label: s.title, click: () => sing(s.id) })),
      { type: 'separator' },
      { label: 'Stop singing', click: stopSinging },
    ] }] : []),
  ];
}

module.exports = { soundMenu, VOLUMES, WAHS };
