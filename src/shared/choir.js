// The choir's arranger: a song's melody and chords become one part per
// singer. The more slimes, the fuller it gets:
//   1  the melody
//   2  + a bass ("bum, doo" on the chord roots)
//   3  + an alto (a chord tone under the melody, words and all)
//   4  + a tenor (under the alto)
//   5  + a high "oo" floating over it all
//   6+ parts doubled (each double sings a hair off pitch, like real choirs)
// Parts come back low to high, so the biggest slimes can take the bottom.
(function (root) {
  'use strict';

  const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // "F#4" -> 66 (MIDI note number).
  function midi(name) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) throw new Error('bad note ' + name);
    return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }

  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function parseNotes(str) {
    let t = 0;
    return str.trim().split(/\s+/).map((tok) => {
      const [p, beats, syl] = tok.split(':');
      const n = { t, dur: Number(beats), midi: midi(p), syl: syl || 'ah' };
      t += n.dur;
      return n;
    });
  }

  // "F#m:2" -> { t, dur, root (pitch class), pcs: [pitch classes] }
  function parseChords(str) {
    let t = 0;
    return str.trim().split(/\s+/).map((tok) => {
      const [name, beats] = tok.split(':');
      const m = /^([A-G])([#b]?)(m?)(7?)$/.exec(name);
      if (!m) throw new Error('bad chord ' + name);
      const root = (NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
      const pcs = [0, m[3] ? 3 : 4, 7].concat(m[4] ? [10] : []).map((i) => (root + i) % 12);
      const c = { t, dur: Number(beats), root, pcs };
      t += c.dur;
      return c;
    });
  }

  const chordAt = (chords, t) => chords.find((c) => t >= c.t - 1e-6 && t < c.t + c.dur - 1e-6) || chords[chords.length - 1];

  // The chord tone in [lo, hi] closest to `near` (or the top one).
  function tone(pcs, lo, hi, near) {
    let best = null;
    for (let n = lo; n <= hi; n++) {
      if (!pcs.includes(((n % 12) + 12) % 12)) continue;
      if (best === null || (near == null ? n > best : Math.abs(n - near) < Math.abs(best - near))) best = n;
    }
    return best;
  }

  // A part under another, following its rhythm and words: each note the
  // chord tone 3 to 9 semitones below, moving as little as it can.
  function under(line, chords, floor) {
    let prev = null;
    return line.map((n) => {
      const c = chordAt(chords, n.t);
      const pick = tone(c.pcs, Math.max(floor, n.midi - 9), n.midi - 3, prev) ?? tone(c.pcs, n.midi - 12, n.midi - 1, prev) ?? n.midi - 12;
      prev = pick;
      return { t: n.t, dur: n.dur, midi: pick, syl: n.syl };
    });
  }

  // The bass: the root of each chord, low; a long chord gets root then
  // fifth ("bum ... doo").
  function bass(chords) {
    const out = [];
    let prev = null;
    for (const c of chords) {
      const root = tone([c.root], 40, 51, prev);
      prev = root;
      if (c.dur >= 4) {
        out.push({ t: c.t, dur: c.dur / 2, midi: root, syl: 'bum' });
        out.push({ t: c.t + c.dur / 2, dur: c.dur / 2, midi: root < 45 ? root + 7 : root - 5, syl: 'doo' }); // the fifth, up or down
      } else out.push({ t: c.t, dur: c.dur, midi: root, syl: out.length % 2 ? 'doo' : 'bum' });
    }
    return out;
  }

  // The high "oo": a held chord tone above the melody's range per chord.
  function oo(chords, top) {
    let prev = null;
    return chords.map((c) => {
      const n = tone(c.pcs, top + 2, top + 9, prev);
      prev = n;
      return { t: c.t, dur: c.dur, midi: n, syl: 'oo' };
    });
  }

  const ORDER = ['melody', 'bass', 'alto', 'tenor', 'oo'];
  const LOW_TO_HIGH = ['bass', 'tenor', 'alto', 'melody', 'oo'];

  // song -> [{ role, double, notes: [{ t, dur (seconds), f0, midi, syl }] }]
  // for `count` singers, lowest part first.
  function arrange(song, count) {
    const beat = 60 / song.bpm;
    const melody = parseNotes(song.notes), chords = parseChords(song.chords);
    const lines = { melody };
    const roles = ORDER.slice(0, Math.min(count, ORDER.length));
    if (roles.includes('alto')) lines.alto = under(melody, chords, 52);
    if (roles.includes('tenor')) lines.tenor = under(lines.alto, chords, 45);
    if (roles.includes('bass')) lines.bass = bass(chords);
    if (roles.includes('oo')) lines.oo = oo(chords, Math.max(...melody.map((n) => n.midi)));
    // Doubles, in order of what fills it out best.
    const parts = roles.map((role) => ({ role, double: 0 }));
    for (let i = roles.length; i < count; i++) {
      const role = ['melody', 'bass', 'alto', 'tenor', 'oo'][(i - roles.length) % roles.length];
      parts.push({ role, double: 1 + Math.floor((i - roles.length) / roles.length) });
    }
    parts.sort((a, b) => LOW_TO_HIGH.indexOf(a.role) - LOW_TO_HIGH.indexOf(b.role));
    for (const p of parts) {
      const cents = p.double ? (p.double % 2 ? 1 : -1) * (6 + 3 * p.double) : 0;
      p.notes = lines[p.role].map((n) => ({ t: n.t * beat, dur: n.dur * beat, midi: n.midi, f0: hz(n.midi) * Math.pow(2, cents / 1200), syl: n.syl }));
    }
    return parts;
  }

  const length = (song) => parseNotes(song.notes).reduce((s, n) => s + n.dur, 0) * 60 / song.bpm;

  const api = { arrange, parseNotes, parseChords, midi, length };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeChoir = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
