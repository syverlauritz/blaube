const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/shared/choir.js');
const { SONGS } = require('../src/shared/songs.js');

test('notes and chords', () => {
  assert.equal(C.midi('A4'), 69);
  assert.equal(C.midi('F#5'), 78);
  assert.equal(C.midi('Bb3'), 58);
  assert.deepEqual(C.parseChords('F#m:2 G7:2').map((c) => c.pcs), [[6, 9, 1], [7, 11, 2, 5]]);
});

test('every song: melody and chords the same length, every note readable', () => {
  for (const s of SONGS) {
    const m = C.parseNotes(s.notes), c = C.parseChords(s.chords);
    assert.equal(m.reduce((a, n) => a + n.dur, 0), c.reduce((a, n) => a + n.dur, 0), s.id);
    assert.ok(m.every((n) => Number.isFinite(n.midi) && n.dur > 0), s.id);
  }
});

test('more singers, more parts; lowest first', () => {
  const song = SONGS[0];
  assert.deepEqual(C.arrange(song, 1).map((p) => p.role), ['melody']);
  assert.deepEqual(C.arrange(song, 2).map((p) => p.role), ['bass', 'melody']);
  assert.deepEqual(C.arrange(song, 4).map((p) => p.role), ['bass', 'tenor', 'alto', 'melody']);
  assert.deepEqual(C.arrange(song, 5).map((p) => p.role), ['bass', 'tenor', 'alto', 'melody', 'oo']);
  const seven = C.arrange(song, 7);
  assert.equal(seven.length, 7);
  assert.equal(seven.filter((p) => p.double).length, 2, 'the extra two double a part');
});

test('the harmony is in harmony: every harmony note is in its chord, under the melody', () => {
  for (const s of SONGS) {
    const chords = C.parseChords(s.chords), beat = 60 / s.bpm;
    const parts = C.arrange(s, 5);
    const mel = parts.find((p) => p.role === 'melody').notes;
    for (const p of parts) {
      if (p.role === 'melody') continue;
      for (const n of p.notes) {
        const c = chords.find((x) => n.t / beat >= x.t - 1e-6 && n.t / beat < x.t + x.dur - 1e-6);
        assert.ok(c.pcs.includes(n.midi % 12), `${s.id} ${p.role} at ${n.t}`);
      }
    }
    const alto = parts.find((p) => p.role === 'alto').notes;
    alto.forEach((n, i) => assert.ok(n.midi < mel[i].midi, `${s.id}: alto under the melody`));
    assert.ok(parts.find((p) => p.role === 'bass').notes.every((n) => n.midi >= 36 && n.midi <= 58), `${s.id}: bass is low`);
  }
});
