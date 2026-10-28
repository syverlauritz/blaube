const test = require('node:test');
const assert = require('node:assert');
const { soundMenu } = require('../src/main/soundMenu');
const { DEFAULTS, sanitize } = require('../src/shared/config');

const songs = [{ id: 'a', title: 'Song A' }, { id: 'b', title: 'Song B' }];

test('the sound menu: on/off, volume and the choir', () => {
  const items = soundMenu(DEFAULTS, () => {}, { songs, sing: () => {}, stopSinging: () => {} });
  assert.deepEqual(items.map((i) => i.label), ['Sound', 'Volume', 'Sing together']);
  assert.equal(items[0].type, 'checkbox');
  assert.equal(items[0].checked, true, 'on by default, as in Settings');
  assert.deepEqual(items[1].submenu.map((i) => i.label), ['10%', '25%', '50%', '75%', '100%']);
  assert.deepEqual(items[1].submenu.filter((i) => i.checked).map((i) => i.label), ['50%'], 'the default volume is ticked');
  assert.deepEqual(items[2].submenu.map((i) => i.label || i.type), ['Song A', 'Song B', 'separator', 'Stop singing']);
});

test('without songs it is just the voice settings', () => {
  assert.deepEqual(soundMenu(DEFAULTS, () => {}).map((i) => i.label), ['Sound', 'Volume']);
});

test('it changes the same settings the Settings window does', () => {
  let cfg = Object.assign({}, DEFAULTS);
  const set = (partial) => { cfg = sanitize(Object.assign({}, cfg, partial)); };
  const menu = () => soundMenu(cfg, set, { songs, sing: () => {}, stopSinging: () => {} });
  menu()[0].click({ checked: false });
  assert.equal(cfg.voice, 'Off');
  assert.equal(menu()[0].checked, false);
  assert.equal(menu()[2].enabled, false, 'no singing with the sound off');
  menu()[0].click({ checked: true });
  assert.equal(cfg.voice, 'On');
  menu()[1].submenu.find((i) => i.label === '25%').click();
  assert.equal(cfg.voiceVolume, 0.25);
});

test('a level picked in Settings that the menu has no step for still shows, ticked', () => {
  const cfg = Object.assign({}, DEFAULTS, { voiceVolume: 0.35 });
  const vol = soundMenu(cfg, () => {})[1].submenu;
  assert.deepEqual(vol.map((i) => i.label), ['10%', '25%', '35%', '50%', '75%', '100%']);
  const odd = vol.find((i) => i.label === '35%');
  assert.ok(odd.checked && !odd.enabled);
  assert.equal(vol.filter((i) => i.checked).length, 1);
});

test('the choir sings the song picked, and stops', () => {
  const said = [];
  const items = soundMenu(DEFAULTS, () => {}, { songs, sing: (id) => said.push(id), stopSinging: () => said.push('stop') });
  items[2].submenu[1].click();
  items[2].submenu[3].click();
  assert.deepEqual(said, ['b', 'stop']);
});
