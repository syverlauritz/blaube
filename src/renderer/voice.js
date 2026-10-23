// Blaube's voice: a cute babble, made up on the spot. Each syllable is a
// short voiced blip shaped into a vowel (two formant filters), some with a
// soft consonant tick at the start. It follows the words it's saying: one
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
  // max syllables. Returns { sylls: [{ t0, t1, vowel, open }], length } in
  // seconds from `at`, and stop().
  function speak(ctx, text, opts = {}) {
    const at = opts.at ?? ctx.currentTime + 0.02;
    const out = opts.out || ctx.destination;
    const seed = opts.seed ?? hash(text);
    const rand = rng(seed ^ hash(text));
    const character = rng(seed); // the same for every line of one slime
    const formantShift = 1.2 + character() * 0.25 + (opts.pitch > 400 ? 0.1 : 0);
    const pace = 0.9 + character() * 0.25;
    const base = opts.pitch || 330;
    const vol = (opts.volume ?? 0.5) * 0.5;
    const list = syllables(text, opts.max || 14);
    const question = /\?\s*$/.test(text), excited = /!\s*$/.test(text);

    const bus = ctx.createGain();
    bus.gain.value = vol * (excited ? 1.15 : 1);
    // A big soft voice is darker: less top.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = Math.min(9000, 2400 + base * 9);
    bus.connect(tone).connect(out);

    let t = at;
    const sylls = [];
    list.forEach((s, i) => {
      const last = i === list.length - 1;
      const dur = (s.stress ? 0.11 : 0.085) * pace * (last ? 1.5 : 1) * (0.85 + rand() * 0.3);
      // Intonation: a gentle fall over the phrase, a little hop on stressed
      // syllables, a rise at the end of a question.
      let semis = (rand() * 5 - 1.5) + (s.stress ? 1.5 : 0) - 2.5 * (i / list.length) + (excited ? 2 : 0);
      if (last && question) semis = 5;
      if (last && !question && !excited) semis -= 1.5;
      const f0 = base * Math.pow(2, semis / 12);
      voiced(ctx, bus, t, dur, f0, VOWELS[s.vowel], formantShift, last && question ? 1.25 : last ? 0.9 : 0.97, s.consonant);
      sylls.push({ t0: t - at, t1: t + dur - at, vowel: s.vowel, open: s.stress ? 1 : 0.75 });
      t += dur + { '': 0.012, word: 0.05 + rand() * 0.04, comma: 0.2, stop: 0.32, end: 0 }[s.gap] * pace;
    });
    // stop(): cut it short with a quick fade (for a new line over it).
    const stop = () => { const now = ctx.currentTime; bus.gain.cancelScheduledValues(now); bus.gain.setTargetAtTime(0, now, 0.015); };
    return { sylls, length: t - at, stop };
  }

  // One syllable: a pitched buzz through the vowel's two formants, with an
  // attack and fall that make it a blip, plus a consonant tick for some.
  function voiced(ctx, out, t, dur, f0, v, shift, glide, consonant) {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.012);
    env.gain.setValueAtTime(1, t + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    env.connect(out);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    // "b" and "m" start a little low and pop up; the rest bend gently.
    const lead = /[bmpw]/.test(consonant) ? 0.88 : 1.04;
    osc.frequency.setValueAtTime(f0 * lead, t);
    osc.frequency.exponentialRampToValueAtTime(f0, t + 0.03);
    osc.frequency.exponentialRampToValueAtTime(f0 * glide, t + dur);
    const body = ctx.createOscillator(); // a round sine underneath, for warmth
    body.type = 'sine';
    body.frequency.setValueAtTime(f0 * lead, t);
    body.frequency.exponentialRampToValueAtTime(f0, t + 0.03);
    body.frequency.exponentialRampToValueAtTime(f0 * glide, t + dur);
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.55;
    body.connect(bodyGain).connect(env);

    for (const [f, q, g] of [[v.f1 * shift, 5, 1.1], [v.f2 * shift, 9, 0.7]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = g;
      osc.connect(bp).connect(gain).connect(env);
    }
    osc.start(t); osc.stop(t + dur + 0.02);
    body.start(t); body.stop(t + dur + 0.02);

    // "s", "t", "k"... a tiny breath of noise first.
    if (/[stkcfhzxqjdg]/.test(consonant)) {
      const n = ctx.createBufferSource();
      n.buffer = noise(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = /[sz]/.test(consonant) ? 4500 : 2200;
      const ng = ctx.createGain();
      const len = /[sz]/.test(consonant) ? 0.035 : 0.018;
      ng.gain.setValueAtTime(0.25, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + len);
      n.connect(hp).connect(ng).connect(out);
      n.start(t); n.stop(t + len + 0.01);
    }
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
