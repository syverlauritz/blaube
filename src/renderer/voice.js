// Blaube's voice, through a talkbox: a soft synth note shaped by a
// "mouth" of formant filters. It says the words in its bubble (speak): a
// little formant speech synthesizer turns them into phonemes and glides
// the mouth from one to the next, in the slime's own voice, each stressed
// syllable opening with a round "wah". A question rises at the end, an
// exclamation is brighter. Bigger slimes have a lower, darker voice. It
// sings, too (sing), for the choir.
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
  // `max` of them (for singing: a note per syllable).
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

  // How each sound is made, for saying words (speak), as targets for a
  // Klatt formant synthesizer (klatt.js). A vowel: its three formants (Hz,
  // an adult's: a slime's are shifted up), the face's vowel for it, and for
  // a diphthong ("ay", "oh") the formants it slides to. A consonant: its
  // formants (where the mouth is; for a stop, where it lets go from), its
  // buzz (av, dB; none when left out), how long it is, and its noise: a
  // hiss (fric: level dB, and how loud each of formants 2 to 6 and the
  // bypass are in it: that's what tells an s from an sh from an f), the
  // burst of a stop's release (the same), a breath (asp) for an h.
  const HISS = {
    s: [-99, -99, -20, -4, -6, -99], sh: [-99, -2, -8, -16, -20, -99], f: [-99, -99, -99, -99, -14, -4], th: [-99, -99, -99, -14, -10, -8],
    p: [-99, -99, -99, -99, -99, 0], t: [-99, -99, -14, -6, -2, -99], k: [0, -10, -20, -99, -99, -99],
  };
  const PH = {
    AA: { f: [730, 1090, 2440], face: 'a' }, AE: { f: [660, 1720, 2410], face: 'a' }, AH: { f: [620, 1220, 2550], face: 'a', short: true },
    AO: { f: [570, 840, 2410], face: 'o' }, EH: { f: [530, 1840, 2480], face: 'e' }, IH: { f: [390, 1990, 2550], face: 'i', short: true },
    IY: { f: [280, 2290, 3010], face: 'i' }, UH: { f: [440, 1020, 2240], face: 'u', short: true }, UW: { f: [310, 870, 2240], face: 'u' },
    ER: { f: [490, 1350, 1690], face: 'e' },
    EY: { f: [480, 1900, 2500], to: [300, 2250, 2900], face: 'e' }, AY: { f: [720, 1150, 2450], to: [320, 2150, 2800], face: 'a' },
    OW: { f: [540, 880, 2400], to: [340, 780, 2300], face: 'o' }, AW: { f: [720, 1150, 2450], to: [420, 900, 2300], face: 'a' },
    OY: { f: [560, 850, 2400], to: [340, 2100, 2700], face: 'o' },
    W: { f: [290, 610, 2150], av: -4, dur: 0.06, soft: true }, Y: { f: [260, 2070, 3020], av: -4, dur: 0.055, soft: true },
    L: { f: [310, 1050, 2880], av: -4, dur: 0.06, soft: true }, R: { f: [310, 1060, 1380], av: -4, dur: 0.065, soft: true },
    M: { f: [300, 1100, 2150], av: -6, dur: 0.07, nasal: true }, N: { f: [300, 1500, 2500], av: -6, dur: 0.065, nasal: true },
    NG: { f: [300, 2000, 2600], av: -6, dur: 0.07, nasal: true },
    P: { f: [400, 1100, 2150], burst: [-4, HISS.p], dur: 0.07, aspirate: true }, B: { f: [200, 1100, 2150], burst: [-10, HISS.p], av: -24, dur: 0.055 },
    T: { f: [400, 1600, 2600], burst: [-4, HISS.t], dur: 0.065, aspirate: true }, D: { f: [200, 1600, 2600], burst: [-10, HISS.t], av: -24, dur: 0.05 },
    K: { f: [300, 1990, 2850], burst: [-4, HISS.k], dur: 0.07, aspirate: true, velar: true }, G: { f: [200, 1990, 2850], burst: [-10, HISS.k], av: -24, dur: 0.055, velar: true },
    F: { f: [340, 1100, 2080], fric: [-6, HISS.f], dur: 0.09 }, V: { f: [220, 1100, 2080], fric: [-16, HISS.f], av: -8, dur: 0.065 },
    TH: { f: [320, 1290, 2540], fric: [-8, HISS.th], dur: 0.08 }, DH: { f: [270, 1290, 2540], fric: [-18, HISS.th], av: -6, dur: 0.045 },
    S: { f: [320, 1390, 2530], fric: [0, HISS.s], dur: 0.1 }, Z: { f: [240, 1390, 2530], fric: [-8, HISS.s], av: -10, dur: 0.075 },
    SH: { f: [300, 1840, 2750], fric: [0, HISS.sh], dur: 0.1 }, ZH: { f: [300, 1840, 2750], fric: [-8, HISS.sh], av: -10, dur: 0.075 },
    CH: { f: [350, 1800, 2820], burst: [-4, HISS.t], fric: [0, HISS.sh], dur: 0.11 }, JH: { f: [260, 1800, 2820], burst: [-10, HISS.t], fric: [-8, HISS.sh], av: -14, dur: 0.09 },
    HH: { asp: -16, dur: 0.07 },
  };
  const isVowel = (p) => /\d$/.test(p);
  const db = (lin) => (lin > 1e-5 ? 20 * Math.log10(lin) : -99);
  const lin = (d) => (d <= -99 ? 0 : Math.pow(10, d / 20));

  // Says `text` on `ctx` from `at` (ctx time, default now), into `out` (a
  // node; default ctx.destination): the words themselves, in a slime's
  // voice. opts: pitch (Hz), seed, volume 0..1, wah 0..1, max words, pace
  // (1 normal, lower faster). Returns { sylls: [{ t0, t1, vowel, open }],
  // length, land } in seconds from `at` (land: when its main stressed
  // syllable starts, "-KAY" in "okay"), and stop(); or null when there's
  // nothing in it to say (an emoji).
  //
  // It's a formant synthesizer, the way the classic speaking machines
  // (Klatt's, DECtalk) did it: the words become phonemes (words.js), each
  // phoneme a target for the synthesizer's resonances, voicing and noise,
  // and every 5 ms the targets are eased into each other, so the sounds run
  // together the way speech does. The slime's voice is in it: its pitch (a
  // hop up on stressed syllables, a gentle fall, up for a question), a
  // small mouth (formants shifted up), a soft breathy buzz, and a little
  // "wah" opening each stressed syllable (o.wah: how much).
  function speak(ctx, text, opts = {}) {
    const W = root.BlaubeWords || require('./words.js');
    const K = root.BlaubeKlatt || require('./klatt.js');
    const words = W.words(text).slice(0, opts.max || 12);
    if (!words.length) return null;
    const at = opts.at ?? ctx.currentTime + 0.02;
    const seed = opts.seed ?? hash(text);
    const rand = rng(seed ^ hash(text));
    const character = rng(seed); // the same for every line of one slime
    const formantShift = 1.12 + character() * 0.18;
    const pace = (0.95 + character() * 0.2) * (opts.pace || 1);
    const tilt = 6 + character() * 4, breathy = -22 + character() * 5;
    const base = opts.pitch || 330;
    const question = /\?\s*$/.test(text), excited = /!\s*$/.test(text);

    // The timeline: every phoneme with its time (seconds from the start).
    const segs = [];
    let t = 0;
    words.forEach((w, wi) => {
      const lastVowel = w.phones.reduce((k, p, i) => (isVowel(p) ? i : k), -1);
      w.phones.forEach((p, pi) => {
        const name = p.replace(/\d$/, ''), ph = PH[name];
        if (!ph) return;
        const stress = isVowel(p) ? +p.slice(-1) : -1;
        let dur = ph.dur || 0;
        if (stress >= 0) {
          dur = [0.09, 0.16, 0.13][stress] * (ph.short ? 0.8 : 1) * (ph.to ? 1.25 : 1);
          if (pi === lastVowel && w.pause !== 'word') dur *= 1.4; // (slower at the end of a phrase)
          if (pi === lastVowel && w.long) dur *= 2; // "wheee"
        }
        segs.push({ t, dur: dur * pace, name, ph, stress, word: wi });
        t += dur * pace;
      });
      if (wi < words.length - 1 && segs.length && w.pause !== 'word') t += (w.pause === 'comma' ? 0.2 : 0.3) * pace;
    });
    const vowels = segs.filter((s) => s.stress >= 0);
    if (!vowels.length) return null;
    const length = t;

    // The tune: a hop up on each stressed syllable, a gentle fall over the
    // line, up at the end of a question, a bright hop for an exclamation.
    const main = vowels.find((s) => s.stress === 1) || vowels[0];
    vowels.forEach((s, k) => {
      let semis = [0, 2.5, 1.2][s.stress] - 3 * (k / vowels.length) + (rand() - 0.5) * 1.2 + (excited ? 1.5 : 0);
      if (excited && s === main) semis += 2;
      s.last = k === vowels.length - 1;
      if (s.last && question) semis = 5;
      s.f0 = base * Math.pow(2, semis / 12);
    });

    // What the synthesizer aims for at time x.
    const next = (i) => segs.slice(i + 1).find((s) => s.stress >= 0);
    const segAt = (x) => { for (let i = 0; i < segs.length; i++) if (x < segs[i].t + segs[i].dur) return x >= segs[i].t ? i : -1; return -1; };
    const target = (x) => {
      const i = segAt(x);
      if (i < 0) return null; // quiet (a pause, or before and after)
      const s = segs[i], ph = s.ph, prev = segs[i - 1], into = x - s.t;
      const g = { f: ph.f, av: -99, asp: -99, fric: -99, par: null, nasal: !!ph.nasal, voicedFric: false, tauF: ph.soft ? 0.025 : 0.014 };
      if (s.stress >= 0) {
        g.f = ph.to && into > s.dur * 0.3 ? ph.f.map((f, k) => f + (ph.to[k] - f) * Math.min(1, (into - s.dur * 0.3) / (s.dur * 0.6))) : ph.f;
        g.av = [-6, 0, -2][s.stress];
        // After a p, t, k: a breath before the buzz comes in.
        if (prev && prev.ph.aspirate && into < 0.045) { g.av = -99; g.asp = -14; }
        g.tauF = prev && prev.stress >= 0 ? 0.03 : 0.016;
        return g;
      }
      const nv = next(i);
      if (ph.asp) { g.f = nv ? nv.ph.f : PH.AH.f; g.asp = ph.asp; return g; } // an h: the vowel's shape, breathed
      if (ph.velar && nv) g.f = [ph.f[0], nv.ph.f[1] * (nv.ph.f[1] < 1300 ? 1.15 : 1.05), 2500];
      g.av = ph.av ?? -99;
      if (ph.burst) {
        // Shut, then let go: a burst of noise, then (a ch) the hiss.
        const tb = ph.fric ? s.dur * 0.35 : s.dur - 0.015;
        if (into >= tb && into < tb + 0.015) { g.fric = ph.burst[0]; g.par = ph.burst[1]; }
        else if (ph.fric && into >= tb + 0.015) { g.fric = ph.fric[0]; g.par = ph.fric[1]; }
      } else if (ph.fric) { g.fric = ph.fric[0]; g.par = ph.fric[1]; g.voicedFric = g.av > -99; }
      return g;
    };

    // Render it, 5 ms at a time, easing each setting toward its target.
    const rate = 22050, step = 0.005, tail = 0.12;
    const gen = new K.Generator({ sampleRate: rate, glottalSourceType: 1 });
    const n = Math.ceil((length + tail) / step), frame = Math.round(rate * step);
    const pcm = new Float64Array(n * frame);
    let f = (segs.find((s) => s.ph.f) || segs[0]).ph.f.slice(), av = 0, asp = 0, fric = 0, f0 = vowels[0].f0 * 0.95;
    let vi = 0;
    const ease = (tau) => 1 - Math.exp(-step / tau);
    for (let k = 0; k < n; k++) {
      const x = k * step, g = target(x);
      if (g) f = f.map((v, j) => v + (g.f[j] - v) * ease(g.tauF));
      av += (lin(g ? g.av : -99) - av) * ease(0.008);
      asp += (lin(g ? g.asp : -99) - asp) * ease(0.005);
      fric = g && g.fric > -99 ? lin(g.fric) : fric * 0.3; // (bursts are sudden)
      // The pitch glides to each vowel's note; the last one bends.
      while (vi < vowels.length - 1 && x >= vowels[vi + 1].t - 0.03) vi++;
      const v = vowels[vi];
      let aim = v.f0;
      if (v.last && x > v.t + v.dur * 0.4) aim = v.f0 * (question ? 1.15 : excited ? 0.92 : 0.84);
      f0 += (aim - f0) * ease(0.035);
      const fs = [...f, 3500, 4500, 4990].map((v2) => Math.min(rate / 2 - 600, v2 * formantShift));
      gen.generateFrame({
        duration: step, f0: f0 * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * x)), flutterLevel: 0.2, openPhaseRatio: 0.7, breathinessDb: breathy, tiltDb: tilt, gainDb: 0, agcRmsLevel: 0,
        nasalFormantFreq: g && g.nasal ? 270 : NaN, nasalFormantBw: 100, nasalAntiformantFreq: g && g.nasal ? 450 : NaN, nasalAntiformantBw: 100,
        oralFormantFreq: fs, oralFormantBw: [g && g.par ? 200 : 80, 100, 150, 250, 300, 1000],
        cascadeEnabled: true, cascadeVoicingDb: db(av), cascadeAspirationDb: db(asp), cascadeAspirationMod: 0.5,
        parallelEnabled: fric > 1e-4, parallelVoicingDb: -99, parallelAspirationDb: -99, parallelAspirationMod: 0,
        fricationDb: db(fric), fricationMod: g && g.voicedFric ? 0.5 : 0, parallelBypassDb: g && g.par ? g.par[5] : -99,
        nasalFormantDb: NaN, oralFormantDb: [-99, ...(g && g.par ? g.par.slice(0, 5) : [-99, -99, -99, -99, -99])],
      }, pcm.subarray(k * frame, (k + 1) * frame));
    }
    // An even loudness for every line, well under full scale.
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    const buf = ctx.createBuffer(1, pcm.length, rate), d = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) d[i] = (pcm[i] / (peak || 1)) * 0.5;

    // Through the wah and its own volume, into the voices' bus.
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const wahAmount = opts.wah ?? 0.8;
    const wah = ctx.createBiquadFilter();
    wah.type = 'lowpass'; wah.Q.value = 0.7 + wahAmount * 1.5;
    const wahOpen = Math.min(9000, 3200 + base * 4) * formantShift;
    wah.frequency.setValueAtTime(wahOpen, at);
    for (const s of vowels) {
      const prev = segs[segs.indexOf(s) - 1];
      if (s.stress < 1 || wahAmount <= 0 || (prev && prev.stress >= 0)) continue;
      wah.frequency.setTargetAtTime(wahOpen * Math.pow(0.1, wahAmount * 0.5), at + s.t, 0.004);
      wah.frequency.setTargetAtTime(wahOpen, at + s.t + 0.01, 0.015 + wahAmount * 0.03);
    }
    const bus = ctx.createGain();
    bus.gain.value = (opts.volume ?? 0.5) * 0.8;
    src.connect(wah).connect(bus).connect(opts.out || ctx.destination);
    src.start(at);
    const stop = () => { const now = ctx.currentTime; bus.gain.cancelScheduledValues(now); bus.gain.setTargetAtTime(0, now, 0.015); };

    // For the face: a syllable from just before each vowel to its end. The
    // main one starts with its consonants (all of them at the start of a
    // word; one of two or more goes with the syllable before).
    const onset = (s) => {
      const k = segs.indexOf(s);
      let i = k;
      while (i > 0 && segs[i - 1].stress < 0 && segs[i - 1].word === s.word) i--;
      if (i > 0 && segs[i - 1].word === s.word && k - i >= 2) i++;
      return segs[i].t;
    };
    const sylls = vowels.map((s) => ({ t0: Math.max(0, s.t - 0.03), t1: s.t + s.dur, vowel: s.ph.face, open: s.stress === 1 ? 1 : 0.75 }));
    return { sylls, length, land: onset(main), stop };
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

  // The singing voice's instrument: a saw softened by a triangle, with a
  // little vibrato, through the wah (a resonant low-pass) and the mouth
  // (three formant filters), into its own volume. Kept well under full
  // scale, so a few voices together don't clip. o: at, out, seed, base (its
  // pitch), volume, wah, vibrato.
  function voiceNodes(ctx, o) {
    const { at, base } = o;
    const character = rng(o.seed ?? 1);
    const formantShift = 1.15 + character() * 0.25 + (base > 400 ? 0.1 : 0);
    const wahAmount = o.wah ?? 0.8;
    const bus = ctx.createGain();
    bus.gain.value = o.volume * 0.8;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, Math.max(0, at - 0.01)); // (before the first swell starts)
    const saw = ctx.createOscillator(), tri = ctx.createOscillator();
    saw.type = 'sawtooth'; tri.type = 'triangle';
    tri.detune.value = 7;
    const sawGain = ctx.createGain(), triGain = ctx.createGain();
    sawGain.gain.value = 0.55; triGain.gain.value = 0.6;
    const vib = ctx.createOscillator(), vibDepth = ctx.createGain();
    vib.frequency.value = 5.5 + character();
    vibDepth.gain.value = o.vibrato || 14; // cents
    vib.connect(vibDepth); vibDepth.connect(saw.detune); vibDepth.connect(tri.detune);
    // The wah: a resonant low-pass that starts shut ("w") at a syllable and
    // sweeps open ("-ah"). wah 0..1 is how far shut it starts and how
    // slowly it opens.
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
    amp.connect(tone).connect(bus).connect(o.out || ctx.destination);
    // stop(): cut it short with a quick fade (for a new line over it).
    const stop = () => { const now = ctx.currentTime; bus.gain.cancelScheduledValues(now); bus.gain.setTargetAtTime(0, now, 0.015); };
    return { bus, amp, saw, tri, vib, wah, mouth, formantShift, wahOpen, wahAmount, stop };
  }

  // The talkbox singing a planned line: [{ t, dur, gap, f0, v, s: {
  // consonant, vowel, stress }, last, legato, tied, hold }].
  function perform(ctx, plan, o) {
    const { at } = o;
    const { bus, amp, saw, tri, vib, wah, mouth, formantShift, wahOpen, wahAmount, stop } = voiceNodes(ctx, o);
    const last = plan[plan.length - 1];
    const t = last.t + last.dur;
    const end = t + 0.35;

    // Each syllable: shut for the "w" just before it, then a sweep open
    // into the vowel. Ramps in time order, so they never overlap.
    let swept = at;
    const held = new Map();
    const sweep = (param, shut, open, t0, len) => {
      const from = Math.max(swept, t0 - 0.04);
      if (from < t0 - 0.005) { param.setValueAtTime(held.get(param) ?? open, from); param.exponentialRampToValueAtTime(shut, t0); }
      else param.setValueAtTime(shut, t0);
      param.exponentialRampToValueAtTime(open, t0 + len);
      held.set(param, open);
    };

    const first = plan[0];
    for (const osc of [saw, tri]) osc.frequency.setValueAtTime(first.f0 * 0.94, at);
    wah.frequency.setValueAtTime(wahOpen, at);
    for (const m of mouth) m.bp.frequency.setValueAtTime(formant(first.v, m.k) * formantShift, at);
    for (const p of plan) {
      const { t: t0, dur, v } = p, t1 = t0 + dur;
      // The pitch glides from note to note (portamento).
      for (const osc of [saw, tri]) osc.frequency.setTargetAtTime(p.f0, t0 - 0.02, 0.025);
      // "Wah": the filter and the mouth go from shut and round ("w", "u")
      // to the vowel, over the first part of the note.
      const len = Math.min(dur * 0.6, 0.09 + wahAmount * 0.07);
      if (!p.tied) {
        sweep(wah.frequency, wahAmount > 0 ? wahOpen * Math.pow(0.1, wahAmount) : wahOpen, wahOpen, t0, len);
        for (const m of mouth) {
          const f = formant(v, m.k) * formantShift, w = formant(VOWELS.u, m.k) * formantShift;
          sweep(m.bp.frequency, f * Math.pow(w / f, Math.max(0.3, wahAmount)), f, t0, len);
        }
        swept = t0 + len;
      }
      // A round swell per note: held into the next when slurred.
      const floor = p.legato ? 0.8 : p.gap < 0.02 ? 0.4 : p.gap < 0.15 ? 0.08 : 0.0001;
      amp.gain.setTargetAtTime(1, t0 - 0.005, 0.02);
      amp.gain.setTargetAtTime(floor, t1 - Math.min(0.07, dur * 0.4), 0.035);
      if (/[stkcfhzxqjdg]/.test(p.s.consonant)) tick(ctx, bus, t0, p.s.consonant);
    }
    amp.gain.setTargetAtTime(0, t - 0.02, 0.05);
    for (const osc of [saw, tri, vib]) { osc.start(at); osc.stop(end); }

    const sylls = plan.map((p) => ({ t0: p.t - at, t1: p.t + p.dur - at, vowel: p.s.vowel, open: 1, hold: true }));
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
