// Blaube's voice: a cute babble through a talkbox, a soft synth note
// shaped into vowels by a sweeping "mouth" filter. It's gibberish, but
// shaped like the words it's saying (the bubble's): one round syllable per
// syllable of them, with its vowel and the kind of sound it starts with,
// stressed ones longer, pauses between words and longer ones at commas and
// full stops, a question rising, an exclamation bright and bouncy. Bigger
// slimes have a lower, darker voice. It sings, too (sing), for the choir.
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

  // The words to syllables, as English spells them: [{ vowel, consonant,
  // onset, gap, stress, long, word, end }], at most `max` of them. One per
  // vowel sound: a silent e doesn't count ("time"), an -ed or -es mostly
  // doesn't ("stopped", "likes"; "wanted", "boxes" do), an -le does
  // ("little"). Its vowel is the one it would have (a, e, i, o, u: "okay"
  // is o-e, "coffee" a-i, "hurray" a-e); consonant is the first one before
  // it, onset that sound's kind for the babble (w soft, b lips, l tongue, m
  // hum, k a click). gap is what follows ('' in a word, 'word', 'comma',
  // 'stop', 'end'); end is the line's mark for its phrase ('?', '!', '.').
  // Numbers and emoji aren't said.
  const FINAL_STRESS = new Set(['okay', 'ok', 'hurray', 'hooray', 'yippee', 'tada', 'woohoo', 'achoo', 'hello', 'again', 'about', 'alone', 'today', 'tonight', 'yahoo', 'ahead', 'away', 'oops']);
  const ONSET = { l: 'l', r: 'l', b: 'b', p: 'b', m: 'm', n: 'm', t: 'k', k: 'k', c: 'k', q: 'k', d: 'k', g: 'k', x: 'k' };
  const LONG_GROUP = /^(ee|ea|ie|ey|ay|ai|ei|oo|ou|ow|oa|au|aw|oi|oy|ue|ew|ui)$/;
  function vowelOf(group, closed, magic) {
    const g = group.replace(/^y(?=[aeiou])/, '');
    if (/^(ee|ea|ie|ey|i|y)$/.test(g)) return g === 'i' && magic ? 'a' : 'i';
    if (/^(ay|ai|ei)$/.test(g)) return 'e';
    if (/^(oo|ue|ew|ui|ou)$/.test(g)) return 'u';
    if (/^(oa|ow|au|aw|oi|oy)$/.test(g)) return 'o';
    const c = g[0];
    if (magic) return { a: 'e', e: 'i', o: 'o', u: 'u' }[c] || 'a';
    if (c === 'o') return closed ? 'a' : 'o';
    if (c === 'u') return closed ? 'a' : 'u';
    return VOWEL_OF[c] || 'a';
  }
  function syllables(text, max) {
    const out = [];
    const tokens = String(text).toLowerCase().replace(/[’`]/g, "'").match(/[\p{L}']+(?:-[\p{L}']+)*|\d+|[.,!?;:…]/gu) || [];
    for (const tok of tokens) {
      if (/^[.,!?;:…]$/.test(tok)) {
        if (out.length) out[out.length - 1].gap = /[,;:]/.test(tok) ? 'comma' : 'stop';
        // The phrase just said ends this way: a question, an exclamation.
        const end = tok === '?' ? '?' : tok === '!' ? '!' : /[.…]/.test(tok) ? '.' : '';
        if (end) for (let i = out.length - 1; i >= 0 && !out[i].end; i--) out[i].end = end;
        continue;
      }
      if (/^\d+$/.test(tok) || out.length >= max) continue;
      const drawn = /(.)\1\1/.test(tok); // "wheee": the last one drawn out
      const w = tok.replace(/[-']/g, '').replace(/(.)\1{2,}/g, '$1$1');
      // Vowel groups ("y" starting a word is a consonant).
      const groups = [...w.matchAll(/[aeiouyæøåäöüé]+/g)].filter((m) => !(m.index === 0 && m[0] === 'y' && w.length > 1 && /[aeiou]/.test(w[1])));
      if (!groups.length) continue;
      const last = groups[groups.length - 1], tail = w.slice(last.index + last[0].length);
      // Endings that aren't a syllable of their own.
      if (groups.length > 1 && last[0] === 'e' && !tail && !/[^aeiou]le$/.test(w) && !/^(..)\1+$/.test(w)) groups.pop(); // a silent e (not "hehe")
      else if (groups.length > 1 && last[0] === 'e' && tail === 'd' && !/[td]ed$/.test(w)) groups.pop(); // -ed
      else if (groups.length > 1 && last[0] === 'e' && tail === 's' && !/(s|x|z|ch|sh|ge|ce)es$/.test(w)) groups.pop(); // -es
      const silentE = groups.length < [...w.matchAll(/[aeiouyæøåäöüé]+/g)].length && /[aeiou][^aeiouywxh]e[sd]?$/.test(w);
      const stressAt = FINAL_STRESS.has(w) ? groups.length - 1 : 0;
      groups.forEach((m, i) => {
        if (out.length >= max) return;
        const before = w.slice(i ? groups[i - 1].index + groups[i - 1][0].length : 0, m.index);
        const after = w.slice(m.index + m[0].length, groups[i + 1] ? groups[i + 1].index : w.length);
        // Its consonants before it: all of them at the start of a word, the
        // last of two or more inside one ("cof-fee").
        const lead = i ? before.slice(Math.max(0, before.length - 1)) : before;
        const magic = silentE && i === groups.length - 1 && m[0].length === 1;
        const closed = magic ? false : i === groups.length - 1 ? after.replace(/e$/, '').length > 0 : after.length > 1;
        const c = lead[0] || '';
        out.push({
          vowel: vowelOf(m[0], closed, magic), consonant: lead[lead.length - 1] || '', onset: ONSET[c] || 'w',
          gap: i === groups.length - 1 ? 'word' : '', stress: i === stressAt, long: LONG_GROUP.test(m[0]) || magic || (drawn && i === groups.length - 1), drawn: drawn && i === groups.length - 1, word: w,
        });
      });
    }
    if (!out.length) return out;
    out[out.length - 1].gap = 'end';
    return out;
  }

  // The voice for a slime of radius r (px at size 1). About 415 Hz for a
  // usual one (bright and cute), an octave lower for a big one, higher for
  // a small one.
  function pitchFor(r, small) {
    const f = 415 * Math.pow(78 / Math.max(20, r), 0.9) * (small ? 1.2 : 1);
    return Math.max(150, Math.min(960, f));
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
  // node; default ctx.destination): in gibberish, but shaped like the
  // words. opts: pitch (Hz), seed, volume 0..1, wah 0..1, max syllables,
  // pace (1 normal, lower faster), tune (its own tune, one { semis, dur,
  // to } per syllable: where it starts, how long it is, and how many
  // semitones it bends by as it goes, in place of the usual). Returns { sylls: [{ t0, t1, vowel, open
  // }], length, land } in seconds from `at` (land: when its main stressed
  // syllable starts, the "-kay" of "okay"), and stop(); or null when
  // there's nothing in it to say (an emoji).
  //
  // The sound is a talkbox: one soft synth note for the whole line,
  // gliding from pitch to pitch, played through a "mouth" of three resonant
  // formant filters that sweep from vowel to vowel. One round syllable per
  // syllable of the words, each opening with a "wah" (or a "bl", a "ba", a
  // hum, a click, from the consonant it starts with), with that
  // syllable's vowel; stressed and long ones are longer. Each phrase has
  // its tune: a question rises at the end, an exclamation is bright and
  // bouncy, a statement falls.
  function speak(ctx, text, opts = {}) {
    const list = syllables(text, opts.max || 12);
    if (!list.length) return null;
    const at = opts.at ?? ctx.currentTime + 0.02;
    const out = opts.out || ctx.destination;
    const seed = opts.seed ?? hash(text);
    const rand = rng(seed ^ hash(text));
    const character = rng(seed); // the same for every line of one slime
    const pace = (0.9 + character() * 0.25) * (opts.pace || 1);
    const base = opts.pitch || 330;

    // Plan the line first: when each syllable is, its pitch and vowel.
    let t = at;
    const plan = [];
    list.forEach((s, i) => {
      const last = i === list.length - 1, phraseEnd = s.gap === 'comma' || s.gap === 'stop' || s.gap === 'end';
      const alone = s.stress && s.gap !== '';
      let dur = (alone ? 0.21 : s.stress ? 0.16 : 0.12) * (s.long ? 1.15 : 1) * (phraseEnd ? 1.35 : 1) * (s.drawn ? 1.8 : 1) * (0.9 + rand() * 0.2);
      // Its tune: a gentle fall over the line and a hop on stressed
      // syllables; a question rises at its end, an exclamation is brighter
      // and bounces, a statement falls.
      let semis = (rand() * 3 - 1) + (s.stress ? 1.5 : 0) - 2.5 * (i / list.length);
      if (s.end === '!') semis += 2 + (i % 2 ? -1.5 : 1.5);
      if (phraseEnd && s.end === '?') semis = 6;
      else if (phraseEnd && s.end !== '!') semis -= 2;
      const gap = { '': 0, word: 0.03 + rand() * 0.05, comma: 0.22, stop: 0.34, end: 0 }[s.gap];
      let bend = last ? (s.end === '?' ? 1.25 : s.end === '!' ? 0.95 : 0.85) : 1;
      const own = opts.tune && opts.tune[i];
      if (own) { semis = own.semis || 0; dur = own.dur || dur; bend = Math.pow(2, (own.to || 0) / 12); }
      dur *= pace;
      plan.push({ t, dur, gap: gap * pace, f0: base * Math.pow(2, semis / 12), v: VOWELS[s.vowel], s, last, bend });
      t += dur + gap * pace;
    });
    const excited = list.some((s) => s.end === '!');
    const line = perform(ctx, plan, { at, out, seed, base, wah: opts.wah, volume: (opts.volume ?? 0.5) * (excited ? 1.1 : 1) });
    const main = plan.find((p) => p.s.stress) || plan[0];
    return Object.assign(line, { land: main.t - at });
  }

  // Sings `notes` ([{ t, dur, f0, syl }], seconds from `at`; a syl of '-'
  // carries on the one before, over a new note). Held notes, a deeper
  // vibrato, words sung as written. opts as for speak, plus vibrato
  // (cents; it blooms on each note, after a straight start), soft (0..1:
  // rounder and darker, less buzz), attack (how fast a note comes in, s: smaller is crisper, with
  // a little accent on top) and loose (0..1: how much this singer is its
  // own person, a touch early or late, a few cents off, some notes louder
  // than others; from its seed, so the same singer is the same each time),
  // and consonants (0..1: how loud the little "t", "s", "d" ticks are).
  // Returns what speak returns, its syllables marked `hold`.
  function sing(ctx, notes, opts = {}) {
    const at = opts.at ?? ctx.currentTime + 0.02;
    const loose = opts.loose || 0, own = rng(hash(String(opts.seed ?? 1)) + 17);
    const lag = loose * (own() - 0.3) * 0.04; // (this singer's habit: mostly a hair behind)
    let vowel = 'a';
    const plan = notes.map((n, i) => {
      const next = notes[i + 1];
      const tied = n.syl === '-';
      const y = Object.assign({ vowel: 'a', consonant: '' }, tied ? { vowel } : syllables(n.syl, 1)[0], { onset: 'w' });
      vowel = y.vowel;
      const gap = next ? next.t - (n.t + n.dur) : 1;
      const late = tied ? 0 : lag + loose * (own() - 0.5) * 0.03, off = tied ? 1 : Math.pow(2, loose * (own() - 0.5) * 14 / 1200);
      return { t: Math.max(at, at + n.t + late), dur: n.dur - late * 0.5, gap, f0: n.f0 * off, v: VOWELS[y.vowel], s: y, last: !next, legato: !!next && next.syl === '-' && gap < 0.02, tied, hold: true, level: 1 - loose * own() * 0.3 };
    });
    return perform(ctx, plan, Object.assign({}, opts, { at, base: opts.base || (notes[0] && notes[0].f0) || 330, volume: opts.volume ?? 0.5, bend: 1 }));
  }

  // The voice's instrument, talking or singing: a saw softened by a
  // triangle, with a little vibrato, through the wah (a resonant low-pass) and the mouth
  // (three formant filters), into its own volume. Kept well under full
  // scale, so a few voices together don't clip. o: at, out, seed, base (its
  // pitch), volume, wah, vibrato, soft.
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
    const soft = o.soft || 0; // (less saw, more triangle: rounder)
    sawGain.gain.value = 0.55 * (1 - soft * 0.55); triGain.gain.value = 0.6 * (1 + soft * 0.4);
    const vib = ctx.createOscillator(), vibDepth = ctx.createGain();
    vib.frequency.value = 5.5 + character();
    const vibrato = (o.vibrato ?? 14) * (o.loose ? 0.55 + character() * 0.9 : 1); // cents (a loose singer's own wobble)
    vibDepth.gain.value = vibrato;
    vib.connect(vibDepth); vibDepth.connect(saw.detune); vibDepth.connect(tri.detune);
    // The wah: a resonant low-pass that starts shut ("w") at a syllable and
    // sweeps open ("-ah"). wah 0..1 is how far shut it starts and how
    // slowly it opens.
    const wah = ctx.createBiquadFilter();
    wah.type = 'lowpass';
    wah.Q.value = (3 + wahAmount * 3) * (1 - soft * 0.4);
    const wahOpen = Math.min(4500, 1800 + base * 2.5) * formantShift;
    saw.connect(sawGain).connect(wah); tri.connect(triGain).connect(wah);
    // The mouth: three resonances that glide between vowels.
    const mouth = [['f1', 5, 1], ['f2', 8, 0.6], ['f3', 10, 0.35]].map(([k, q, g]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = g;
      wah.connect(bp).connect(gain).connect(amp);
      return { k, bp };
    });
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = Math.min(6000, 2200 + base * 4) * (1 - soft * 0.35); // a big voice is darker
    amp.connect(tone).connect(bus).connect(o.out || ctx.destination);
    // stop(): cut it short with a quick fade (for a new line over it).
    const stop = () => { const now = ctx.currentTime; bus.gain.cancelScheduledValues(now); bus.gain.setTargetAtTime(0, now, 0.015); };
    return { bus, amp, saw, tri, vib, vibDepth, vibrato, wah, mouth, formantShift, wahOpen, wahAmount, stop };
  }

  // The talkbox playing a planned line: [{ t, dur, gap, f0, v, s: {
  // consonant, vowel, stress, onset }, last, bend, legato, tied, hold }]
  // (hold: a sung note).
  function perform(ctx, plan, o) {
    const { at } = o;
    const { bus, amp, saw, tri, vib, vibDepth, vibrato, wah, mouth, formantShift, wahOpen, wahAmount, stop } = voiceNodes(ctx, o);
    const last = plan[plan.length - 1];
    const t = last.t + last.dur;
    const end = t + 0.35;

    // Each syllable: shut for the "w" just before it, held there a moment
    // (for an "l", or a hum), then a sweep open into the vowel. Curves that
    // start from wherever the filter is, never a jump: a resonant filter
    // that jumps clicks.
    let swept = at;
    const sweep = (param, shut, open, t0, len, hold = 0) => {
      const from = Math.max(swept, t0 - 0.04);
      param.setTargetAtTime(shut, Math.min(from, t0 - 0.006), Math.max(0.002, (t0 - from) / 3));
      param.setTargetAtTime(open, t0 + hold, len / 3);
    };

    // Where it starts from, set a moment before the first syllable's own
    // moves (set at `at` it would win over them, and a whole first note
    // was sung a semitone flat). Talking scoops up into its first syllable;
    // a song starts right on its note.
    const first = plan[0], ready = Math.max(0, at - 0.05);
    for (const osc of [saw, tri]) osc.frequency.setValueAtTime(first.f0 * (first.hold ? 1 : 0.94), ready);
    wah.frequency.setValueAtTime(wahOpen, ready);
    for (const m of mouth) m.bp.frequency.setValueAtTime(formant(first.v, m.k) * formantShift, ready);
    for (const p of plan) {
      const { t: t0, dur, v } = p, t1 = t0 + dur, onset = p.s.onset || 'w';
      // The pitch glides from syllable to syllable (portamento), dipping a
      // little after the lips ("ba"), and bends at the end of the line.
      for (const osc of [saw, tri]) {
        if (onset === 'b' && !p.hold) osc.frequency.setTargetAtTime(p.f0 * 0.92, t0 - 0.02, 0.01);
        osc.frequency.setTargetAtTime(p.f0, onset === 'b' && !p.hold ? t0 + 0.02 : t0 - 0.02, p.hold ? 0.025 : 0.04);
        if (p.bend && p.bend !== 1) osc.frequency.setTargetAtTime(p.f0 * p.bend, t0 + dur * (p.last ? 0.4 : 0.15), dur * (p.last ? 0.4 : 0.3));
      }
      // How it opens: "wah" (the mouth from shut and round, "w", "u"),
      // "bl" (a soft, darker "l" held a moment), "ba" (from the lips, quick),
      // a hum ("m", shut a little longer), or a click ("k", straight in).
      const len = Math.min(dur * 0.6, o.attack && p.hold ? Math.max(0.03, o.attack * 2) + wahAmount * 0.03 : (p.hold ? 0.09 : 0.05) + wahAmount * 0.07); // (a crisp attack opens quick)
      const shut = wahAmount > 0 ? wahOpen * Math.pow(0.1, wahAmount) : wahOpen;
      if (p.tied) {
        // (a slur: same vowel, no new opening)
      } else if (onset === 'l' || onset === 'm') {
        const hold = Math.min(onset === 'm' ? 0.045 : 0.035, dur * 0.2), move = Math.min(0.045, dur * 0.3);
        sweep(wah.frequency, onset === 'm' ? shut : wahOpen * 0.35, wahOpen, t0, move, hold);
        for (const m of mouth) sweep(m.bp.frequency, (onset === 'm' ? formant(VOWELS.u, m.k) * 0.8 : LATERAL[m.k]) * formantShift, formant(v, m.k) * formantShift, t0, move, hold);
        swept = t0 + hold + move;
      } else if (onset === 'k') {
        const move = Math.min(0.03, dur * 0.2);
        sweep(wah.frequency, wahOpen * 0.45, wahOpen, t0, move);
        for (const m of mouth) { const f = formant(v, m.k) * formantShift; sweep(m.bp.frequency, f * 0.9, f, t0, move); }
        swept = t0 + move;
      } else {
        const l2 = onset === 'b' ? Math.min(len, 0.05) : len;
        sweep(wah.frequency, shut, wahOpen, t0, l2);
        for (const m of mouth) {
          const f = formant(v, m.k) * formantShift, w = formant(VOWELS.u, m.k) * formantShift;
          sweep(m.bp.frequency, onset === 'b' ? f * 0.55 : f * Math.pow(w / f, Math.max(0.3, wahAmount)), f, t0, l2);
        }
        swept = t0 + l2;
      }
      // A round swell per syllable that overlaps the next a little: inside
      // a word it dips but doesn't stop, between words it nearly does.
      const floor = p.legato ? 0.8 : p.gap < 0.02 ? 0.4 : p.gap < 0.15 ? 0.08 : 0.0001;
      const into = onset === 'l' || onset === 'm' ? Math.min(onset === 'm' ? 0.045 : 0.035, dur * 0.2) : 0;
      if (into) amp.gain.setTargetAtTime(onset === 'm' ? 0.3 : 0.4, t0 - 0.005, 0.012); // (the "l" or hum, softer)
      const peak = (p.s.stress || p.hold ? 1 : 0.8) * (p.level || 1);
      // A sung note starts nearly straight and its vibrato blooms as it's held.
      if (p.hold && !p.tied) {
        vibDepth.gain.setTargetAtTime(vibrato * 0.15, t0 - 0.02, 0.008); // (eased, not cut: a cut clicks too)
        vibDepth.gain.setTargetAtTime(vibrato, t0 + 0.02, Math.min(0.4, dur * 0.7) / 3);
      }
      if (o.attack && p.hold && !p.tied) {
        // In at its own speed; a hard attack (under 20ms) goes a touch over,
        // then settles.
        const crisp = o.attack < 0.02;
        amp.gain.setTargetAtTime(crisp ? peak * 1.1 : peak, into ? t0 + into : t0 - 0.003, o.attack);
        if (crisp) amp.gain.setTargetAtTime(peak, t0 + Math.min(0.045, dur * 0.3), 0.03);
      } else amp.gain.setTargetAtTime(peak, into ? t0 + into : t0 - 0.005, onset === 'k' ? 0.014 : 0.02);
      amp.gain.setTargetAtTime(floor, t1 - Math.min(p.hold ? 0.07 : 0.05, dur * 0.4), 0.035);
      if (p.hold ? o.consonants > 0 && /[stkcfhzxqjdg]/.test(p.s.consonant) : onset === 'k' && /[tkcqp]/.test(p.s.consonant)) tick(ctx, bus, t0, p.s.consonant, p.hold ? o.consonants : 1);
    }
    amp.gain.setTargetAtTime(0, t - 0.02, 0.05);
    for (const osc of [saw, tri, vib]) { osc.start(at); osc.stop(end); }

    const sylls = plan.map((p) => ({ t0: p.t - at, t1: p.t + p.dur - at, vowel: p.s.vowel, open: p.hold || p.s.stress ? 1 : 0.75, hold: !!p.hold }));
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

  // "s", "t", "k"...: a tiny breath of noise at the start of a syllable,
  // `level` loud (0..1). Short as it is, it's heard as a click.
  function tick(ctx, out, t, consonant, level = 1) {
    const n = ctx.createBufferSource();
    n.buffer = noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = /[sz]/.test(consonant) ? 4500 : 2200;
    const ng = ctx.createGain();
    const len = /[sz]/.test(consonant) ? 0.035 : 0.018;
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.07 * level, t + 0.004); // (in, not straight on)
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
