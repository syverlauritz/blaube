// Blaube's voice: a cute babble, made up on the spot, through a talkbox:
// a soft synth note shaped into vowels by a sweeping "mouth" filter, every
// syllable a round "wah" that glides into the next, some with a soft
// consonant tick at the start. It follows the words it's saying: one
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

  // The words to syllables: [{ vowel, consonant, gap, stress, word }], at most
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
        out.push({ vowel: VOWEL_OF[g[g.length - 1]] || 'a', consonant: lead[lead.length - 1] || '', gap: i === parts.length - 1 ? 'word' : '', stress: i === 0, word: w });
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
  // The sound is a talkbox: one soft synth note for the whole line,
  // gliding from pitch to pitch, played through a "mouth" of three resonant
  // formant filters that sweep from vowel to vowel. Syllables are swells in
  // its volume, each opening with a "wah"; words and pauses let it fall
  // quiet. Few, round syllables: a word of one is long, a word of more is
  // a quick pair ("wah wah wahwah"). About one word in three starts with a
  // "bl" instead ("blah"), the same words every time for the same slime.
  function speak(ctx, text, opts = {}) {
    const at = opts.at ?? ctx.currentTime + 0.02;
    const out = opts.out || ctx.destination;
    const seed = opts.seed ?? hash(text);
    const rand = rng(seed ^ hash(text));
    const character = rng(seed); // the same for every line of one slime
    const pace = (0.9 + character() * 0.25) * (opts.pace || 1);
    const base = opts.pitch || 330;
    const list = syllables(text, opts.max || 10);
    const question = /\?\s*$/.test(text), excited = /!\s*$/.test(text);

    // Plan the line first: when each syllable is, its pitch and vowel.
    let t = at;
    const plan = [];
    list.forEach((s, i) => {
      const last = i === list.length - 1;
      const alone = s.stress && s.gap !== '';
      const dur = (alone ? 0.22 : s.stress ? 0.15 : 0.13) * pace * (last ? 1.5 : 1) * (0.85 + rand() * 0.3);
      // Intonation: a gentle fall over the phrase, a hop on stressed
      // syllables, a rise at the end of a question.
      let semis = (rand() * 5 - 1.5) + (s.stress ? 1.5 : 0) - 2.5 * (i / list.length) + (excited ? 2 : 0);
      if (last && question) semis = 6;
      if (last && !question && !excited) semis -= 2;
      const gap = { '': 0, word: 0.03 + rand() * 0.05, comma: 0.22, stop: 0.34, end: 0 }[s.gap] * pace;
      const blah = s.stress && ((hash(s.word) ^ seed) >>> 0) % 100 < 33;
      if (blah) s = Object.assign({}, s, { vowel: 'a', consonant: 'b' });
      plan.push({ t, dur, gap, f0: base * Math.pow(2, semis / 12), v: VOWELS[s.vowel], s, last, blah });
      t += dur + gap;
    });
    return perform(ctx, plan, { at, out, seed, base, wah: opts.wah, volume: (opts.volume ?? 0.5) * (excited ? 1.15 : 1), bend: question ? 1.3 : excited ? 1 : 0.85 });
  }

  // Sings `notes` ([{ t, dur, f0, syl }], seconds from `at`; a syl of '-'
  // carries on the one before, over a new note). Held notes, a deeper
  // vibrato, words sung as written. opts as for speak, plus vibrato
  // (cents). Returns what speak returns, its syllables marked `hold`.
  function sing(ctx, notes, opts = {}) {
    const at = opts.at ?? ctx.currentTime + 0.02;
    let vowel = 'a';
    const plan = notes.map((n, i) => {
      const next = notes[i + 1];
      const tied = n.syl === '-';
      const y = tied ? { vowel, consonant: '' } : syllables(n.syl, 1)[0];
      vowel = y.vowel;
      const gap = next ? next.t - (n.t + n.dur) : 1;
      return { t: at + n.t, dur: n.dur, gap, f0: n.f0, v: VOWELS[y.vowel], s: y, last: !next, legato: !!next && next.syl === '-' && gap < 0.02, tied, hold: true };
    });
    return perform(ctx, plan, Object.assign({}, opts, { at, base: opts.base || (notes[0] && notes[0].f0) || 330, volume: opts.volume ?? 0.5, bend: 1 }));
  }

  // The talkbox itself, playing a planned line: [{ t, dur, gap, f0, v,
  // s: { consonant, vowel, stress }, last, legato, hold, blah }].
  function perform(ctx, plan, o) {
    const { at, base } = o;
    const out = o.out || ctx.destination;
    const character = rng(o.seed ?? 1);
    const formantShift = 1.15 + character() * 0.25 + (base > 400 ? 0.1 : 0);
    const last = plan[plan.length - 1];
    const t = last.t + last.dur;
    const end = t + 0.35;
    const wahAmount = o.wah ?? 0.8;

    // The note: a saw softened by a triangle, with a little vibrato. Kept
    // well under full scale, so a few voices together don't clip.
    const bus = ctx.createGain();
    bus.gain.value = o.volume * 0.8;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, at);
    const saw = ctx.createOscillator(), tri = ctx.createOscillator();
    saw.type = 'sawtooth'; tri.type = 'triangle';
    tri.detune.value = 7;
    const sawGain = ctx.createGain(), triGain = ctx.createGain();
    sawGain.gain.value = 0.55; triGain.gain.value = 0.6;
    const vib = ctx.createOscillator(), vibDepth = ctx.createGain();
    vib.frequency.value = 5.5 + character();
    vibDepth.gain.value = o.vibrato || 14; // cents
    vib.connect(vibDepth); vibDepth.connect(saw.detune); vibDepth.connect(tri.detune);
    // The wah: a resonant low-pass that starts shut ("w") at every
    // syllable and sweeps open ("-ah"). o.wah 0..1 is how far shut it
    // starts and how slowly it opens.
    const wah = ctx.createBiquadFilter();
    wah.type = 'lowpass';
    wah.Q.value = 3 + wahAmount * 3;
    const wahOpen = Math.min(4500, 1800 + base * 2.5) * formantShift;
    saw.connect(sawGain).connect(wah); tri.connect(triGain).connect(wah);

    // The mouth: three resonances that glide between vowels.
    const mouth = [['f1', 5, 1], ['f2', 8, 0.6], ['f3', 10, 0.25]].map(([k, q, g]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = g;
      wah.connect(bp).connect(gain).connect(amp);
      return { k, bp };
    });
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = Math.min(5000, 1800 + base * 4); // a big voice is darker
    amp.connect(tone).connect(bus).connect(out);

    // Each syllable: shut for the "w" just before it, held there a moment
    // (for an "l"), then a sweep open into the vowel. Ramps in time order,
    // so they never overlap.
    let swept = at;
    const held = new Map();
    const sweep = (param, shut, open, t0, len, hold = 0) => {
      const from = Math.max(swept, t0 - 0.04);
      if (from < t0 - 0.005) { param.setValueAtTime(held.get(param) ?? open, from); param.exponentialRampToValueAtTime(shut, t0); }
      else param.setValueAtTime(shut, t0);
      if (hold) param.setValueAtTime(shut, t0 + hold);
      param.exponentialRampToValueAtTime(open, t0 + hold + len);
      held.set(param, open);
    };

    const first = plan[0];
    for (const osc of [saw, tri]) osc.frequency.setValueAtTime(first.f0 * 0.94, at);
    wah.frequency.setValueAtTime(wahOpen, at);
    for (const m of mouth) m.bp.frequency.setValueAtTime(formant(first.v, m.k) * formantShift, at);
    for (const p of plan) {
      const { t: t0, dur, v } = p, t1 = t0 + dur;
      // The pitch glides from syllable to syllable (portamento), and bends
      // at the end of the line: up for a question, down otherwise.
      for (const osc of [saw, tri]) {
        osc.frequency.setTargetAtTime(p.f0, t0 - 0.02, p.hold ? 0.025 : 0.04);
        if (p.last && o.bend !== 1) osc.frequency.setTargetAtTime(p.f0 * o.bend, t0 + dur * 0.4, dur * 0.4);
      }
      // "Wah": the filter and the mouth go from shut and round ("w", "u")
      // to the vowel, over the first part of the syllable.
      const len = Math.min(dur * 0.6, (p.hold ? 0.09 : 0.05) + wahAmount * 0.07);
      if (p.blah) {
        // "Blah": a soft, darker "l" (the tongue up: a low second formant)
        // that moves quickly into the "a".
        const hold = Math.min(0.035, dur * 0.2), move = Math.min(0.045, dur * 0.3);
        sweep(wah.frequency, wahOpen * 0.35, wahOpen, t0, move, hold);
        for (const m of mouth) sweep(m.bp.frequency, LATERAL[m.k] * formantShift, formant(v, m.k) * formantShift, t0, move, hold);
        swept = t0 + hold + move;
      } else if (!p.tied) {
        sweep(wah.frequency, wahAmount > 0 ? wahOpen * Math.pow(0.1, wahAmount) : wahOpen, wahOpen, t0, len);
        for (const m of mouth) {
          const f = formant(v, m.k) * formantShift, w = formant(VOWELS.u, m.k) * formantShift;
          sweep(m.bp.frequency, f * Math.pow(w / f, Math.max(0.3, wahAmount)), f, t0, len);
        }
        swept = t0 + len;
      }
      // A round swell per syllable that overlaps the next a little: inside
      // a word it dips but doesn't stop, between words it nearly does.
      const floor = p.legato ? 0.8 : p.gap < 0.02 ? 0.4 : p.gap < 0.15 ? 0.08 : 0.0001;
      if (p.blah) amp.gain.setTargetAtTime(0.4, t0 - 0.005, 0.012); // the "l", softer
      amp.gain.setTargetAtTime(p.s.stress || p.hold ? 1 : 0.8, p.blah ? t0 + Math.min(0.035, dur * 0.2) : t0 - 0.005, 0.02);
      amp.gain.setTargetAtTime(floor, t1 - Math.min(p.hold ? 0.07 : 0.05, dur * 0.4), 0.035);
      if (/[stkcfhzxqjdg]/.test(p.s.consonant)) tick(ctx, bus, t0, p.s.consonant);
    }
    amp.gain.setTargetAtTime(0, t - 0.02, 0.05);
    for (const osc of [saw, tri, vib]) { osc.start(at); osc.stop(end); }

    const sylls = plan.map((p) => ({ t0: p.t - at, t1: p.t + p.dur - at, vowel: p.s.vowel, open: p.hold || p.s.stress ? 1 : 0.75, hold: !!p.hold }));
    // stop(): cut it short with a quick fade (for a new line over it).
    const stop = () => { const now = ctx.currentTime; bus.gain.cancelScheduledValues(now); bus.gain.setTargetAtTime(0, now, 0.015); };
    return { sylls, length: t - at, stop };
  }

  // Everyone's voices meet here before the speakers: a gentle compressor,
  // then a soft ceiling just under full scale, so however many slimes talk
  // or sing at once it never clips. Connect voices to what this returns.
  function master(ctx) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    const trim = ctx.createGain();
    trim.gain.value = 0.6; // the compressor adds its own make-up gain
    const ceiling = ctx.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) {
      const x = i / 512 - 1, a = Math.abs(x);
      curve[i] = Math.sign(x) * (a < 0.55 ? a : 0.55 + 0.27 * Math.tanh((a - 0.55) / 0.27));
    }
    ceiling.curve = curve;
    ceiling.oversample = '2x';
    comp.connect(trim).connect(ceiling).connect(ctx.destination);
    return comp;
  }

  // A vowel's third formant isn't in the table: it barely moves, so it's
  // set from the second.
  // An "l": a low first formant, the second between "u" and "a".
  const LATERAL = { f1: 360, f2: 1050, f3: 2600 };
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
    ng.gain.setValueAtTime(0.07, t);
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
      // A sung note stays open; a spoken syllable opens and shuts.
      const k = (s - y.t0) / (y.t1 - y.t0);
      if (s <= y.t1) return { open: y.open * (y.hold ? Math.min(1, (s - y.t0) / 0.05, (y.t1 - s) / 0.05) : Math.sin(Math.PI * k)), wide: v.wide, round: v.round };
      prev = y;
    }
    return null; // done
  }

  const api = { speak, sing, master, syllables, pitchFor, mouthAt, hash, VOWELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeVoice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
