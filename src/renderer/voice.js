// Blaube's voice: a cute babble, made up on the spot, through a talkbox:
// a buzzy synth note shaped into vowels by a sweeping "mouth" filter, some
// syllables with a soft consonant tick at the start. It follows the words it's saying: one
// syllable per vowel group, the vowel it would have, pauses between words
// and longer ones at commas and full stops. A question rises at the end, an
// exclamation is brighter. Bigger slimes have a lower, darker voice.
//
// speak() schedules the sound and returns the syllables with their times,
// so the face can move its mouth along. It takes any AudioContext, so an
// OfflineAudioContext can render it to a file for checking.
(function (root) {
  'use strict';

  // Formants (Hz) for each vowel, roughly an adult voice; a slime's are
  // shifted up (it's small) and a little by its own seed. `wide` is how
  // wide the mouth goes for it, `round` how round.
  const VOWELS = {
    a: { f1: 800, f2: 1250, wide: 0.7, round: 0.3 },
    e: { f1: 500, f2: 1900, wide: 0.9, round: 0.1 },
    i: { f1: 330, f2: 2300, wide: 1, round: 0 },
    o: { f1: 520, f2: 880, wide: 0.35, round: 0.9 },
    u: { f1: 360, f2: 760, wide: 0.25, round: 1 },
  };
  const VOWEL_OF = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', y: 'i', æ: 'e', ø: 'o', å: 'o', ä: 'e', ö: 'o', ü: 'u', é: 'e' };

  // A small seeded random, so the same slime saying the same thing says it
  // the same way.
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // The words to syllables: [{ vowel, consonant, gap, stress }], at most
  // `max` of them (a long reply is a short babble, not a speech).
  function syllables(text, max) {
    const out = [];
    const words = String(text).toLowerCase().match(/[\p{L}\p{N}']+|[.,!?;:…]/gu) || [];
    for (const w of words) {
      if (/^[.,!?;:…]$/.test(w)) { if (out.length) out[out.length - 1].gap = /[,;:]/.test(w) ? 'comma' : 'stop'; continue; }
      // Each syllable: the consonants before a vowel group, and the group.
      const parts = [...w.matchAll(/([^aeiouyæøåäöüé]*)([aeiouyæøåäöüé]+)/g)];
      if (!parts.length) parts.push(['', w, 'a']);
      parts.forEach(([, lead, g], i) => {
        if (out.length >= max) return;
        out.push({ vowel: VOWEL_OF[g[g.length - 1]] || 'a', consonant: lead[lead.length - 1] || '', gap: i === parts.length - 1 ? 'word' : '', stress: i === 0 });
      });
      if (out.length >= max) break;
    }
    if (!out.length) out.push({ vowel: 'u', consonant: 'm', gap: 'stop', stress: true }); // an emoji: "mm!"
    out[out.length - 1].gap = 'end';
    return out;
  }

  // The voice for a slime of radius r (px at size 1). About 330 Hz for a
  // usual one, an octave lower for a big one, higher for a small one.
  function pitchFor(r, small) {
    const f = 330 * Math.pow(78 / Math.max(20, r), 0.9) * (small ? 1.2 : 1);
    return Math.max(120, Math.min(760, f));
  }

  let noiseBuf = null;
  function noise(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // Says `text` on `ctx` from `at` (ctx time, default now), into `out` (a
  // node; default ctx.destination). opts: pitch (Hz), seed, volume 0..1,
  // max syllables, pace (1 normal, lower faster). Returns { sylls: [{ t0,
  // t1, vowel, open }], length } in seconds from `at`, and stop().
  //
  // The sound is a talkbox: one buzzy synth note for the whole line,
  // gliding from pitch to pitch, played through a "mouth" of three resonant
  // formant filters that sweep from vowel to vowel. Syllables are swells in
  // its volume; words and pauses let it fall quiet.
  function speak(ctx, text, opts = {}) {
    const at = opts.at ?? ctx.currentTime + 0.02;
    const out = opts.out || ctx.destination;
    const seed = opts.seed ?? hash(text);
    const rand = rng(seed ^ hash(text));
    const character = rng(seed); // the same for every line of one slime
    const formantShift = 1.15 + character() * 0.25 + (opts.pitch > 400 ? 0.1 : 0);
    const pace = (0.9 + character() * 0.25) * (opts.pace || 1);
    const base = opts.pitch || 330;
    const vol = (opts.volume ?? 0.5) * 0.75;
    const list = syllables(text, opts.max || 14);
    const question = /\?\s*$/.test(text), excited = /!\s*$/.test(text);

    // Plan the line first: when each syllable is, its pitch and vowel.
    let t = at;
    const plan = [];
    list.forEach((s, i) => {
      const last = i === list.length - 1;
      const dur = (s.stress ? 0.12 : 0.09) * pace * (last ? 1.5 : 1) * (0.85 + rand() * 0.3);
      // Intonation: a gentle fall over the phrase, a hop on stressed
      // syllables, a rise at the end of a question.
      let semis = (rand() * 5 - 1.5) + (s.stress ? 1.5 : 0) - 2.5 * (i / list.length) + (excited ? 2 : 0);
      if (last && question) semis = 6;
      if (last && !question && !excited) semis -= 2;
      const gap = { '': 0.012, word: 0.05 + rand() * 0.04, comma: 0.2, stop: 0.32, end: 0 }[s.gap] * pace;
      plan.push({ t, dur, gap, f0: base * Math.pow(2, semis / 12), v: VOWELS[s.vowel], s, last });
      t += dur + gap;
    });
    const end = t + 0.12;

    // The buzz: a saw and a slightly detuned square, with a little vibrato.
    const bus = ctx.createGain();
    bus.gain.value = vol * (excited ? 1.15 : 1);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, at);
    const saw = ctx.createOscillator(), sq = ctx.createOscillator();
    saw.type = 'sawtooth'; sq.type = 'square';
    sq.detune.value = 9;
    const sqGain = ctx.createGain();
    sqGain.gain.value = 0.35;
    const vib = ctx.createOscillator(), vibDepth = ctx.createGain();
    vib.frequency.value = 5.5 + character();
    vibDepth.gain.value = 14; // cents
    vib.connect(vibDepth); vibDepth.connect(saw.detune); vibDepth.connect(sq.detune);
    // A bit of grit, like a speaker driven through a tube.
    const grit = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; curve[i] = Math.tanh(x * 2.2); }
    grit.curve = curve;
    const pre = ctx.createGain();
    saw.connect(pre); sq.connect(sqGain).connect(pre);
    pre.connect(grit);

    // The mouth: three resonances that glide between vowels.
    const mouth = [['f1', 7, 1.2], ['f2', 12, 0.9], ['f3', 14, 0.45]].map(([k, q, g]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = g;
      grit.connect(bp).connect(gain).connect(amp);
      return { k, bp };
    });
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = Math.min(9000, 2600 + base * 9); // a big voice is darker
    amp.connect(tone).connect(bus).connect(out);

    const first = plan[0];
    for (const o of [saw, sq]) o.frequency.setValueAtTime(first.f0 * 0.9, at);
    for (const m of mouth) m.bp.frequency.setValueAtTime(formant(first.v, m.k) * formantShift * 0.6, at);
    for (const p of plan) {
      const { t: t0, dur, v } = p, t1 = t0 + dur;
      // Pitch slides into each syllable (the talkbox glide), and bends at
      // the end of the line: up for a question, down otherwise.
      const lip = /[bmpw]/.test(p.s.consonant) ? 0.9 : 1;
      for (const o of [saw, sq]) {
        o.frequency.setTargetAtTime(p.f0 * lip, t0, 0.008);
        o.frequency.setTargetAtTime(p.f0, t0 + 0.02, 0.03);
        if (p.last) o.frequency.setTargetAtTime(p.f0 * (question ? 1.3 : 0.85), t0 + dur * 0.4, dur * 0.4);
      }
      // The mouth opens into the vowel ("b", "m": from nearly shut).
      for (const m of mouth) {
        const f = formant(v, m.k) * formantShift;
        if (lip < 1) m.bp.frequency.setValueAtTime(f * 0.55, t0);
        m.bp.frequency.setTargetAtTime(f, t0, 0.025);
      }
      // A swell per syllable; inside a word it dips but doesn't stop.
      const floor = p.gap < 0.02 ? 0.25 : 0.0001;
      amp.gain.setTargetAtTime(1, t0, 0.012);
      amp.gain.setTargetAtTime(floor, t1 - Math.min(0.04, dur * 0.4), 0.018);
      if (/[stkcfhzxqjdg]/.test(p.s.consonant)) tick(ctx, bus, t0, p.s.consonant);
    }
    amp.gain.setTargetAtTime(0, t - 0.02, 0.02);
    for (const o of [saw, sq, vib]) { o.start(at); o.stop(end); }

    const sylls = plan.map((p) => ({ t0: p.t - at, t1: p.t + p.dur - at, vowel: p.s.vowel, open: p.s.stress ? 1 : 0.75 }));
    // stop(): cut it short with a quick fade (for a new line over it).
    const stop = () => { const now = ctx.currentTime; bus.gain.cancelScheduledValues(now); bus.gain.setTargetAtTime(0, now, 0.015); };
    return { sylls, length: t - at, stop };
  }

  // A vowel's third formant isn't in the table: it barely moves, so it's
  // set from the second.
  const formant = (v, k) => (k === 'f3' ? Math.max(2500, v.f2 + 900) : v[k]);

  // "s", "t", "k"...: a tiny breath of noise at the start of a syllable.
  function tick(ctx, out, t, consonant) {
    const n = ctx.createBufferSource();
    n.buffer = noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = /[sz]/.test(consonant) ? 4500 : 2200;
    const ng = ctx.createGain();
    const len = /[sz]/.test(consonant) ? 0.035 : 0.018;
    ng.gain.setValueAtTime(0.22, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(hp).connect(ng).connect(out);
    n.start(t); n.stop(t + len + 0.01);
  }

  // How open the mouth is `s` seconds into a line (0 shut .. 1), and the
  // vowel it's shaping, for the face.
  function mouthAt(line, s) {
    let prev = null;
    for (const y of line.sylls) {
      const v = VOWELS[y.vowel];
      // Between syllables: shut, already shaped for the next one (a short
      // gap inside a word only half closes it, so it doesn't flicker).
      if (s < y.t0) return { open: prev && y.t0 - prev.t1 < 0.04 ? 0.25 : 0, wide: v.wide, round: v.round };
      if (s <= y.t1) return { open: y.open * Math.sin(Math.PI * (s - y.t0) / (y.t1 - y.t0)), wide: v.wide, round: v.round };
      prev = y;
    }
    return null; // done
  }

  const api = { speak, syllables, pitchFor, mouthAt, hash, VOWELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeVoice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
