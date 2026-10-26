// Blaube's stage: a full-screen transparent canvas. Every Claude Code
// session (one per terminal) is a big mother slime, and every subagent that
// session runs splits off it as a small child slime and merges back in when
// it's done. With no sessions, a single home slime sits there on its own.
(function () {
  'use strict';

  const { SoftBody, collideBodies, BlaubeDraw: D, BlaubeConfig, BlaubeLooks: Looks } = globalThis;

  const api = window.blaube || devShim();
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const DT = 1 / 120;
  const SPLIT_TIME = 0.55;
  const HOME = 'main';
  let CFG = Object.assign({}, BlaubeConfig.DEFAULTS);
  let obstacles = []; // Dock/taskbar rectangles in window coordinates

  let W = 0, H = 0;
  let mouse = { x: -1e4, y: -1e4, lastMove: performance.now() / 1000, vx: 0, vy: 0, px: -1e4, py: -1e4 };
  // The computer: how long you've been idle anywhere (from the app), whether
  // you're away, the battery, and how tired a low battery makes them (0..1).
  const sys = { idle: 0, idleAt: -1, away: false, asleep: false, awayFrom: 0, before: null, battery: null, low: 0, lowSaid: false };
  let drag = null; // { buddy, pet or glasses, x0, y0, t0, moved }
  let settings = { hooksInstalled: true };
  let time = 0;

  // kind is 'home' (no sessions), 'mother' (a session) or 'child' (a subagent).
  class Buddy {
    constructor(key, kind, x, y, r) {
      this.key = key;
      this.kind = kind;
      this.body = makeBody(x, y, r, this.big);
      this.targetR = r;
      this.session = null; // mothers
      this.mother = null; // children
      this.agent = null; // children
      this.state = 'idle';
      this.effort = 'medium';
      this.glasses = null; // high effort: its glasses, while they're off its face
      this.born = time;
      this.parent = null; // the slime it's splitting off, while splitting
      this.merging = null; // { since }
      this.mergeInto = null;
      this.dying = 0;
      this.removed = false;
      this.bubble = null; // { lines, until, sticky }
      this.blink = 0;
      this.nextBlink = time + 1 + Math.random() * 4;
      this.dizzyUntil = 0;
      this.happyUntil = 0;
      this.nodAt = -1;
      this.nextHop = 0;
      // Each slime breathes at its own pace.
      this.breathPhase = Math.random() * Math.PI * 2;
      this.breathRate = 2.2 * (0.8 + Math.random() * 0.4);
      this.color = colorFor(this);
    }

    get big() {
      return this.kind !== 'child';
    }

    get splitting() {
      return this.parent && time - this.born < SPLIT_TIME;
    }

    // (Silent unless asked: aloud, true or how to say it, says the bubble's
    // words as it shows; see sayAloud.)
    say(lines, seconds, sticky = false, aloud = false) {
      if (typeof lines === 'string') lines = [{ text: lines }];
      if (aloud) { sayAloud(this, lines, seconds, aloud === true ? {} : aloud); return; }
      this.bubble = { lines, until: time + seconds, sticky };
      spoken.said++;
    }

    hop(vx, vy) {
      if (this.body.grab) return;
      // Low on battery: tired, smaller hops.
      if (sys.low > 0) { vx *= 1 - 0.3 * sys.low; vy *= 1 - 0.3 * sys.low; }
      if ((talkingTo && buddies.get(talkingTo) === this) || time < (this.talkHold || 0)) return; // stays put while you talk to it (and while its box opens)
      // Up on a window it minds the edge: a hop that would land past it
      // turns back (mothers wander off now and then; helpers never, except
      // to follow their mum down).
      const l = this.body.onLedge;
      if (l && vy < 0 && !this.toMum && time > (this.leaving || 0) && (this.kind === 'child' || Math.random() < 0.85)) { // (unless it means to: see hopOff)
        const c = this.body.centroid(), r = this.body.o.radius;
        const land = c.x + vx * (-2 * vy / CFG.gravity);
        if (land < l.x0 + r * 0.6 || land > l.x1 - r * 0.6) {
          const room = Math.max(0, Math.min(c.x - l.x0, l.x1 - c.x) - r * 0.6);
          vx = Math.sign((l.x0 + l.x1) / 2 - c.x) * Math.min(Math.abs(vx), room / (-2 * vy / CFG.gravity) + 20);
        }
      }
      // From the ground, a jump starts with a crouch: the top is pushed
      // down for a moment, and the hop goes off when it springs back (see
      // crouch). A hop asked for mid-crouch just changes where it goes.
		this.hoppedAt = time; // (a hop of its own: nothing for busy ones to watch, see spectate)
      if (this.pendingHop) { this.pendingHop.vx = vx; this.pendingHop.vy = vy; return; }
      const len = CFG.hopCrouch * Math.max(0.5, Math.min(1.3, -vy / 600));
      if (vy < -150 && len > 0.01 && this.body.onFloor()) {
        this.pendingHop = { vx, vy, at: time + len, power: Math.min(1.3, -vy / 600), v: 0 };
        return;
      }
      this.body.impulse(vx, vy, DT);
    }
  }

  const buddies = new Map();

  // How much they say. What you need to know (a session needs you, is done,
  // an error, its context full) always gets its balloon. The rest is
  // rationed for the whole stage at once, however many slimes there are: a
  // line of personality (a game's "tag!", "lunch time?", a sleepy mumble) at
  // most every three minutes, and a word back when you play with one
  // yourself (swing it, throw it, tickle it) at most every half a minute.
  // Most of what they get up to says nothing; their faces do the talking.
  const TALK_GAP = { flavour: 180, react: 30 };
  const spoken = { flavour: -1e9, react: -1e9, said: 0, voiced: 0 }; // (when each last went, and counts)
  function mayTalk(kind) {
    if (time - spoken[kind] < TALK_GAP[kind]) return false;
    spoken[kind] = time;
    return true;
  }

  // Talking out loud: a slime says what's in its bubble, the words
  // themselves, in its own voice (voice.js), lower the bigger it is, with
  // the mouth moving along. Nothing is said without a bubble saying it
  // too. One voice on the stage at a time: its own new line cuts its last
  // one short.
  let audio = null, voice = null; // voice: { b, until } the line playing (audio time)
  function ensureAudio() {
    if (!audio) {
      const ctx = new AudioContext();
      audio = { ctx, out: BlaubeVoice.master(ctx) }; // several at once never clip
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio;
  }
  // Another slime is talking right now.
  const busy = (b) => !!(audio && voice && voice.b !== b && voice.b.speech && !voice.b.dying && audio.ctx.currentTime < voice.until);
  // Says `text` now, unless it can't (voice off, another slime talking,
  // nothing in it to say). Returns the line, with wait: how long until it's
  // heard (seconds), or null.
  function speak(b, text, how = {}) {
    if (CFG.voice === 'Off' || !text || b.dying || b.singing || busy(b)) return null;
    try {
      ensureAudio();
      const now = audio.ctx.currentTime, at = now + 0.03;
      const line = BlaubeVoice.speak(audio.ctx, text, {
        at, out: audio.out, pitch: BlaubeVoice.pitchFor(b.body.o.radius, !b.big) * (how.higher || 1), seed: BlaubeVoice.hash(b.key), volume: CFG.voiceVolume * (how.softer || 1), wah: CFG.voiceWah, pace: how.pace,
      });
      if (!line) return null;
      if (b.speech) b.speech.line.stop();
      b.speech = { line, at };
      voice = { b, until: at + line.length };
      spoken.voiced++;
      return Object.assign({ wait: at - now + (audio.ctx.outputLatency || 0) }, line);
    } catch (e) { b.speech = null; return null; }
  }
  // What a bubble says out loud: its first line, up to a colon, and a few
  // words at most (the rest is for reading). No emoji.
  function spokenOf(lines) {
    const text = String((lines[0] && lines[0].text) || '').split(':')[0].replace(/[^\p{L}\p{N}\s'’.,!?…-]/gu, ' ').trim();
    const words = text.split(/\s+/).filter(Boolean);
    return words.length > 8 ? words.slice(0, 8).join(' ').replace(/[.,!?…]+$/, '') : text;
  }
  // A bubble said out loud: the bubble and the sound start together, and
  // the bubble stays at least as long as the sound. While another slime is
  // talking, a minor one just shows; one that matters (how.important: a
  // session done, or needing you) waits its turn, bubble and all, a few
  // seconds at most.
  function sayAloud(b, lines, seconds, how = {}) {
    if (CFG.voice !== 'Off' && busy(b) && how.important && (how.tries || 0) < 32) {
      setTimeout(() => { if (!b.dying) sayAloud(b, lines, seconds, Object.assign({}, how, { tries: (how.tries || 0) + 1 })); }, 250);
      return;
    }
    // (A slime waiting on you says only that, once: its other bubbles,
    // a sneeze, a giggle, show quietly.)
    const line = b.state === 'waiting' && !how.important ? null : speak(b, spokenOf(lines), how);
    const show = () => { if (!b.dying) b.say(lines, Math.max(seconds, line ? line.length + 0.5 : 0)); };
    if (line && line.wait > 0.01) setTimeout(show, line.wait * 1000);
    else show();
  }
  // You told it something: it says "okay!" and the 👍 pops up as the "-kay"
  // lands. Out loud at most once a minute (a session fed prompts in a loop
  // would say it over and over), else just the 👍; while another slime is
  // talking it just shows the 👍 too.
  function okayBack(b) {
    if (time - (b.thumbAt ?? -1e9) < 2) return;
    b.thumbAt = time;
    const thumb = (seconds) => { if (!b.dying) b.say([{ text: '👍', size: 30 }], seconds); };
    if (time - (b.okayAt ?? -1e9) < 60) { thumb(1.2); return; }
    b.okayAt = time;
    const line = speak(b, 'okay!');
    if (!line) { thumb(1.2); return; }
    setTimeout(() => thumb(Math.max(0.8, line.length - line.land + 0.5)), (line.wait + line.land) * 1000);
  }
  // A turn done: a cheer, not the same one twice in a row, a bigger one
  // for a long turn.
  const CHEERS = ['Hurray!', 'Ta-da!', 'All done!'], BIG_CHEERS = ['Yippee!', 'Woo-hoo!'];
  function cheer(b, long, more = []) {
    const pool = (long ? BIG_CHEERS : CHEERS).filter((w) => w !== b.lastCheer);
    b.lastCheer = pool[Math.floor(Math.random() * pool.length)];
    sayAloud(b, [{ text: b.lastCheer }, ...more], 2.2, { important: true });
  }
  // The choir (Play > Choir): everyone sings a song together, each its own
  // part (shared/choir.js): the biggest take the bass, the smallest the
  // top. One slime sings the tune; every one more adds a harmony. They sway
  // to the beat, eyes shut, little notes floating up.
  let choir = null;
  function startChoir(id) {
    const song = BlaubeSongs.SONGS.find((s) => s.id === id);
    stopChoir();
    const singers = [...buddies.values()].filter((b) => !b.dying && !b.removed).sort((a, b) => b.body.o.radius - a.body.o.radius);
    if (!song || !singers.length || CFG.voice === 'Off') return;
    try {
      ensureAudio();
      const parts = BlaubeChoir.arrange(song, singers.length);
      const at = audio.ctx.currentTime + 0.8; // a breath in first
      const volume = CFG.voiceVolume * 1.4 / Math.sqrt(singers.length);
      singers.forEach((b, i) => {
        if (b.speech) b.speech.line.stop();
        const line = BlaubeVoice.sing(audio.ctx, parts[i].notes, { at, out: audio.out, seed: BlaubeVoice.hash(b.key), volume, wah: CFG.voiceWah, vibrato: 28 });
        b.speech = { line, at };
        b.singing = parts[i].role;
      });
      const length = BlaubeChoir.length(song);
      choir = { singers, start: time + 0.8, until: time + 0.8 + length + 0.3, beat: 60 / song.bpm, lastBeat: -1 };
    } catch (e) { stopChoir(); }
  }
  function stopChoir() {
    if (!choir) return;
    for (const b of choir.singers) {
      if (b.singing && b.speech) b.speech.line.stop();
      // The song is over: no mouth still miming it, and giggles are free again.
      if (b.singing) { b.speech = null; b.mouth = null; }
      b.singing = null;
    }
    choir = null;
  }
  // Each frame: sway on the beat, notes float up, and the end.
  function stepChoir() {
    if (!choir) return;
    if (time > choir.until) { for (const b of choir.singers) b.singing = null; choir = null; return; }
    const beat = Math.floor((time - choir.start) / choir.beat);
    if (beat < 0 || beat === choir.lastBeat) return;
    choir.lastBeat = beat;
    for (const b of choir.singers) {
      if (!b.singing || b.dying || b.body.grab) continue;
      if (b.body.onFloor()) b.body.impulse((beat % 2 ? 1 : -1) * 55, -25, DT);
      if (Math.random() < 0.35) {
        const c = b.body.centroid();
        spawnHeart({ note: true, x: c.x + (Math.random() - 0.5) * b.body.o.radius, y: b.body.bbox().minY - 8, vx: (Math.random() - 0.5) * 30, born: time, size: 24 + Math.random() * 8, color: b.color });
      }
    }
  }

  // How its mouth is shaped right now, while it talks (null when quiet).
  function talkMouth(b, ease = (k) => k) {
    if (!b.speech || !audio) return null;
    let m = BlaubeVoice.mouthAt(b.speech.line, audio.ctx.currentTime - b.speech.at);
    // Done: it eases shut before it lets go.
    if (!m) {
      if (!b.mouth || b.mouth.open < 0.05) { b.speech = null; b.mouth = null; return null; }
      m = { open: 0, wide: b.mouth.wide, round: b.mouth.round };
    }
    // Eased, so the jaw moves instead of popping open and shut.
    const was = b.mouth || { open: 0, wide: m.wide, round: m.round };
    b.mouth = { open: was.open + (m.open - was.open) * ease(0.4), wide: was.wide + (m.wide - was.wide) * ease(0.3), round: was.round + (m.round - was.round) * ease(0.3) };
    return b.mouth;
  }

  function bodyOpts(big) {
    return Object.assign({}, CFG, { points: big ? CFG.mainPoints : CFG.childPoints });
  }

  function makeBody(x, y, r, big) {
    const body = new SoftBody(x, y, Object.assign(bodyOpts(big), { radius: r }));
    body.setBounds(0, 0, W, H);
    body.setObstacles(CFG.dockCollision ? obstacles : []);
    body.setLedges(ledges);
    return body;
  }

  // A mother wears the colour picked for its session (or the default one).
  // Her children get a colour near hers, picked from their id.
  const baseColor = (m) => (m && m.session && m.session.color) || CFG.color;

  function colorFor(b) {
    if (b.big) return baseColor(b);
    return familyColor(b.mother, b.key);
  }

  // A shade of a mother's colour for one of hers (a helper or a pet): the
  // key picks a hue and lightness within the configured spread.
  function familyColor(mother, key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const u = ((h % 1000) / 999) * 2 - 1, v = (((h >>> 10) % 1000) / 999) * 2 - 1;
    return D.vary(baseColor(mother), u * CFG.childHueSpread, v * CFG.childLightSpread);
  }

  function applyConfig(cfg) {
    CFG = BlaubeConfig.sanitize(cfg);
    D.setFont(CFG.font); // (and loads it, and the plain one, before any text is drawn)
    // The Size setting scales every slime (and pet) at once.
    for (const k of ['mainRadius', 'childRadius']) CFG[k] *= CFG.size;
    for (const b of buddies.values()) {
      const want = b.big ? CFG.mainPoints : CFG.childPoints;
      if (b.body.n !== want) {
        // Rebuild with the new point count, keeping place and momentum.
        const c = b.body.centroid(), v = b.body.velocity(DT);
        b.body = makeBody(c.x, c.y, b.body.o.radius, b.big);
        b.body.impulse(v.x, v.y, DT);
      }
      b.body.configure(bodyOpts(b.big));
      b.body.setObstacles(CFG.dockCollision ? obstacles : []);
      b.color = colorFor(b);
      if (!b.big && !b.dying) b.targetR = CFG.childRadius;
    }
    setLedges(rawLedges);
  }

  // Window tops (from the app): slimes and pets can land on them. A slime
  // standing on a window that moves rides along with it. The talk boxes'
  // tops are ledges too (`talk`: whose box), whatever the setting for other
  // windows says.
  let ledges = [], rawLedges = [];
  // Windows on the move. While one moves the app reports it about 60 times
  // a second (each report says when it was looked at); in between, a
  // moving window top glides on at its last speed. Riders move with their
  // window's speed, but, like anything resting on something, they can only
  // lose speed as fast as gravity takes it: ease off or stop a window going
  // up and they keep going, tossed exactly as hard as you moved it. Moved
  // too fast (a yank), they're left in the air.
  const YANK = 3000; // px/s
  const STOPPED = 0.07; // s: no news for this long means the window stopped
  const seen = new Map(); // window id -> { wx, y, t, at, vx, vy }: last report
  const ridden = new Map(); // window id -> its speed last step (riders wobble when it changes)
  const shook = new Map(); // window id -> which way it was going, and when it turned (shaking it)
  function setLedges(list) {
    rawLedges = list || [];
    const next = rawLedges.filter((m) => m.talk || CFG.windowLedges !== 'Off').map((m) => Object.assign({}, m));
    const t = performance.now() / 1000, done = new Set();
    for (const m of next) {
      if (!done.has(m.id)) {
        done.add(m.id);
        const s = seen.get(m.id);
        // When it was looked at: the app's own clock if it says, else now.
        const at = m.at !== undefined ? m.at / 1000 : t;
        let vx = 0, vy = 0;
        if (s && (s.wx !== m.wx || s.y !== m.y)) {
          const dt = Math.min(0.1, Math.max(0.008, at - s.at)); // still windows are checked every 80 ms
          vx = (m.wx - s.wx) / dt;
          vy = (m.y - s.y) / dt;
          // Smoothed a little: hands (and reports) are jittery.
          if (s.vx || s.vy) { vx = vx * 0.35 + s.vx * 0.65; vy = vy * 0.35 + s.vy * 0.65; }
        }
        seen.set(m.id, { wx: m.wx, y: m.y, t, at, vx, vy });
      }
      const s = seen.get(m.id);
      m.vx = s.vx; m.vy = s.vy; m.t = t;
    }
    for (const id of seen.keys()) if (!done.has(id)) { seen.delete(id); shook.delete(id); ridden.delete(id); }
    noticeWindows(next, done);
    // Riders: keep them with where their window really is (only ever lifting
    // them: if it's lower, they're in the air above it).
    const match = (l) => l && next.filter((m) => m.id === l.id).sort((p, q) => Math.abs(p.y - l.y) - Math.abs(q.y - l.y))[0];
    for (const b of buddies.values()) {
      const l = b.body.onLedge, now = match(l);
      if (now) {
        if (l.up !== undefined) now.up = l.up;
        if (Math.hypot(now.vx, now.vy) > YANK) b.surpriseUntil = time + 0.8;
        else b.body.shift(now.wx - l.wx, Math.min(0, now.y - l.y));
      }
      b.body.setLedges(next);
    }
    for (const p of pets.values()) {
      const now = match(p.ledge);
      if (now && Math.hypot(now.vx, now.vy) <= YANK) { p.x += now.wx - p.ledge.wx; p.y += Math.min(0, now.y - p.ledge.y); }
    }
    ledges = next;
  }
  // Slimes are curious about windows: one that appears gets looked at (a
  // curious slime perks up and may hop over to see), and one being dragged
  // around gets watched.
  let knownWindows = null;
  function noticeWindows(list, ids) {
    // (A talk box opening isn't news: you opened it.)
    const fresh = knownWindows ? [...ids].filter((id) => !knownWindows.has(id) && !String(id).startsWith('talk:')) : [];
    knownWindows = new Set(ids);
    if (CFG.windowCurious <= 0) return;
    const spotOf = (l) => ({ x: (l.x0 + l.x1) / 2, y: l.y + 30 });
    for (const id of fresh) {
      const l = list.find((m) => m.id === id);
      if (l) for (const b of curiousAbout(spotOf(l), 1100)) {
        b.glanceAt = { spot: spotOf(l) };
        b.glanceUntil = time + 1 + Math.random() * 0.8;
        if (b.state === 'working') continue;
        b.body.squashTop(-b.body.o.radius * 2.5, DT);
        const dx = spotOf(l).x - b.body.centroid().x;
        if (Math.random() < 0.3 * CFG.windowCurious * trait(b, 'curious') && Math.abs(dx) > b.body.o.radius * 2) {
          b.nextHop = time + 1;
          setTimeout(() => b.hop(Math.sign(dx) * Math.min(420, Math.abs(dx) * 1.2), -420), 350);
        }
      }
    }
    for (const l of list) {
      if (Math.hypot(l.vx || 0, l.vy || 0) < 250) continue;
      for (const b of curiousAbout(spotOf(l), 800)) {
        if (time < (b.watchedAt || 0)) continue;
        b.watchedAt = time + 0.5;
        b.glanceAt = { spot: spotOf(l) };
        b.glanceUntil = time + 0.6;
      }
    }
  }
  // Slimes near a spot that are free to look: awake, on the ground, not busy
  // being held, merging or riding the very window.
  function curiousAbout(spot, range) {
    return [...buddies.values()].filter((b) => {
      if (b.dying || b.merging || b.body.grab || !b.body.onFloor() || b.body.onLedge) return false;
      const c = b.body.centroid();
      return Math.hypot(spot.x - c.x, spot.y - c.y) < range;
    });
  }

  // A window swept along fast stirs the air: leaves (and snow) near it get
  // blown along, and a slime right by its leading edge leans out of the way.
  function gust(l) {
    if (CFG.gust <= 0) return;
    const lead = l.vx > 0 ? l.x1 : l.x0, dir = Math.sign(l.vx), push = l.vx * 0.6 * CFG.gust;
    for (const f of flakes) {
      if (f.on || f.y < l.y - 200 || f.x < l.x0 - 140 || f.x > l.x1 + 140) continue;
      if (f.landed) { if (Math.abs(f.x - lead) > 120) continue; f.landed = 0; f.vy = -60 - Math.random() * 80; }
      f.loose = time + 0.5;
      f.vx += (push - f.vx) * 0.08;
    }
    for (const b of buddies.values()) {
      if (b.dying || b.body.grab || b.body.onLedge === l || !b.body.onFloor()) continue;
      const c = b.body.centroid(), r = b.body.o.radius, ahead = (c.x - lead) * dir;
      if (ahead < -r || ahead > r * 2.5 || c.y < l.y - r) continue;
      b.body.lean(dir * Math.min(600, Math.abs(l.vx)) * 0.02 * CFG.gust * 60 * DT, DT);
      if (time > (b.gustBlink || 0)) { b.gustBlink = time + 1; b.startleUntil = time + 0.3; }
    }
  }

  // Every physics step: moving window tops glide on, carrying their riders.
  function glideLedges() {
    const t = performance.now() / 1000;
    for (const l of ledges) {
      if (!l.vx && !l.vy && !l.up) continue;
      if (t - l.t > STOPPED && (l.vx || l.vy)) {
        // No news: it stopped. Back to where it really is; riders sliding
        // with it slide on.
        for (const b of buddies.values()) if (b.body.onLedge && b.body.onLedge.id === l.id && !b.body.grab && Math.abs(l.vx) > 150) b.body.impulse(l.vx, 0, DT);
        for (const p of pets.values()) if (p.ledge && p.ledge.id === l.id) p.vx += l.vx;
        const s = seen.get(l.id);
        if (s) { const dx = s.wx - l.wx; l.x0 += dx; l.x1 += dx; l.wx = s.wx; l.y = s.y; s.vx = s.vy = 0; }
        l.vx = l.vy = 0;
      }
      const fast = Math.hypot(l.vx, l.vy) > YANK;
      const dx = fast ? 0 : l.vx * DT;
      l.x0 += dx; l.x1 += dx; l.wx += dx;
      if (!fast) l.y += l.vy * DT;
      // The riders' upward speed: the window's, but never dropping faster
      // than gravity allows.
      const window = fast ? 0 : -l.vy;
      l.up = Math.max(window, (l.up ?? window) - CFG.gravity * DT);
      // A window that starts or stops moving leaves its riders' tops behind
      // for a moment: they wobble like jelly on a plate.
      if (!fast && Math.abs(l.vx) > 300) gust(l);
      const was = ridden.get(l.id) ?? 0, kick = fast ? 0 : (l.vx - was) * CFG.rideWobble;
      ridden.set(l.id, fast ? 0 : l.vx);
      // Shake the window back and forth and whoever's riding it gets dizzy.
      if (!fast && Math.abs(l.vx) > 250 && CFG.shakeDizzy > 0) {
        const k = shook.get(l.id) || { dir: 0, flips: [] }, dir = Math.sign(l.vx), fl = k.flips;
        shook.set(l.id, k);
        if (k.dir && k.dir !== dir) fl.push(time);
        k.dir = dir;
        while (fl.length && time - fl[0] > 1.5) fl.shift();
        if (fl.length >= CFG.shakeDizzy) {
          fl.length = 0;
          for (const b of buddies.values()) {
            if (!b.body.onLedge || b.body.onLedge.id !== l.id || b.body.grab) continue;
            if (time > b.dizzyUntil) quipBack(b, 'whoa…', 1.2);
            b.dizzyUntil = time + 1.8;
          }
        }
      }
      if (l.up <= 0 && !l.vx && !l.vy && !kick) { l.up = 0; continue; }
      for (const b of buddies.values()) {
        if (!b.body.onLedge || b.body.onLedge.id !== l.id || b.body.grab) continue;
        if (Math.abs(kick) > 5) b.body.lean(-Math.max(-900, Math.min(900, kick)) * 0.5, DT);
        b.body.shift(dx, 0);
        b.body.impulse(0, -l.up - b.body.velocity(DT).y, DT);
      }
      for (const p of pets.values()) {
        if (!p.ledge || p.ledge.id !== l.id || p.held) continue;
        p.x += dx;
        if (l.up > 0) p.vy = Math.min(p.vy, -l.up);
      }
    }
  }

  function setObstacles(rects) {
    obstacles = (rects || []).map((r) => ({ x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height }));
    for (const b of buddies.values()) {
      // The Dock grew (an app started) right where a slime stands: lift the
      // slime gently onto it. Left to the collisions, the slime would be
      // shoved out of it at speed, flung across the screen.
      if (CFG.dockCollision && !b.body.grab) {
        const box = b.body.bbox(), c = b.body.centroid();
        for (const r of obstacles) {
          const inside = Math.min(box.maxX, r.x1) - Math.max(box.minX, r.x0) > 4 && box.maxY > r.y0 + 4 && box.minY < r.y1;
          if (!inside) continue;
          b.body.teleport(c.x, c.y - (box.maxY - r.y0) - 1);
          b.body.impulse(-b.body.velocity(DT).x, -b.body.velocity(DT).y, DT); // no speed from it
          break;
        }
      }
      b.body.setObstacles(CFG.dockCollision ? obstacles : []);
    }
  }

  // The surface under x: the top of an obstacle there, or the screen bottom.
  // With 'from' (the bottom of a falling thing), window tops below it count.
  function floorAt(x, from) {
    let y = H;
    if (CFG.dockCollision) for (const r of obstacles) if (x >= r.x0 && x <= r.x1) y = Math.min(y, r.y0);
    if (from !== undefined) for (const l of ledges) if (x >= l.x0 && x <= l.x1 && l.y >= from - 6 && l.y < y) y = l.y;
    return y;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const b of buddies.values()) {
      b.body.setBounds(0, 0, W, H);
      const c = b.body.centroid();
      const r = b.body.o.radius;
      b.body.teleport(Math.max(r, Math.min(W - r, c.x)), Math.max(r, Math.min(H - r, c.y)));
    }
  }

  const bigs = () => [...buddies.values()].filter((b) => b.big && !b.dying);

  // Sessions grow with the tokens they've used, their helpers' included: a
  // step bigger each time the total doubles, counted from 100k.
  const sessionTotal = (m) => (m.session && m.session.tokens ? m.session.tokens.total : 0);
  const liveMother = (b) => (b.mother && !b.mother.dying && !b.mother.removed ? b.mother : null);

  // Helpers grow the same way with their own tokens, counted from 20k
  // (they use far fewer), and always stay a step smaller than their mother.
  function childRadius(b) {
    const mother = liveMother(b);
    const kids = mother ? [...buddies.values()].filter((o) => o.kind === 'child' && o.mother === mother && !o.dying) : [b];
    const radii = BlaubeConfig.childRadii(CFG, mother ? sessionTotal(mother) : null, kids.map((o) => (o.agent && o.agent.tokens) || 0));
    return radii[Math.max(0, kids.indexOf(b))];
  }

  // How full the session's context window is, 0..1.
  function contextFill(b) {
    const t = b.kind === 'mother' && b.session && b.session.tokens;
    return t && t.limit ? Math.min(1, t.context / t.limit) : 0;
  }

  // Its context nearly full: it says so, once (again only after it's been
  // compacted down), so you know to wrap up or compact.
  function warnFull(b) {
    if (b.kind !== 'mother' || CFG.fullWarning <= 0) return;
    const f = contextFill(b);
    if (f < 0.5) b.warnedFull = false;
    if (b.warnedFull || f < CFG.fullWarning) return;
    b.warnedFull = true;
    b.say([{ text: `Context ${Math.round(f * 100)}% full` }, { text: 'Time to wrap up, or compact it', size: 12 }], 5, false, false);
    if (b.body.onFloor() && !b.body.grab) b.body.squashTop(-b.body.o.radius * 6, DT);
  }

  // 0..1 between two thresholds.
  const ramp = (v, from, to) => Math.max(0, Math.min(1, (v - from) / Math.max(0.001, to - from)));

  const radiusFor = (m) => BlaubeConfig.motherRadius(CFG, sessionTotal(m));

  function nearestBig(b, filter) {
    const c = b.body.centroid();
    let best = null, bestD = Infinity;
    for (const o of bigs()) {
      if (o === b || !filter(o)) continue;
      const oc = o.body.centroid();
      const d = Math.hypot(oc.x - c.x, oc.y - c.y);
      if (d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  function rekey(b, key) {
    buddies.delete(b.key);
    b.key = key;
    buddies.set(key, b);
  }

  function remove(b) {
    if (buddies.get(b.key) === b) buddies.delete(b.key);
    b.removed = true;
  }

  // --- Sessions -----------------------------------------------------------

  // hidden: sessions whose blobs you've hidden (see Blobs): they go back in
  // quietly, no goodbyes, as their sessions carry on.
  function syncSessions(sessions, pending = 0, hidden = []) {
    const live = new Set();
    const away = new Set(hidden);
    for (const s of sessions) {
      live.add(s.id);
      let m = buddies.get(s.id);
      if (!m || m.dying) m = addMother(s);
      m.merging = null;
      if (s.activity === 'tool' && m.lastActivity !== 'tool') { m.pulse = true; m.toolSince = time; (m.tools || (m.tools = [])).push(time); }
      m.lastActivity = s.activity;
      const context = s.tokens ? s.tokens.context : 0;
      if (m.lastContext > 40000 && context < m.lastContext * 0.6) {
        quip(m, '\u{1F62E}\u{200D}\u{1F4A8}', 2, 30);
        if (m.body.onFloor()) m.hop(0, -380);
      }
      m.lastContext = context;
      planTick(m, s.progress);
      m.session = s;
      m.color = colorFor(m);
      setEffort(m, s.effort);
      setState(m, s.state);
      if (s.seen && m.bubble && m.bubble.sticky) m.bubble = null;
      for (const a of s.agents || []) {
        const key = `${s.id}/${a.id}`;
        live.add(key);
        let c = buddies.get(key);
        if (!c || c.dying) c = split(m, key, 'child');
        c.merging = null;
        c.mother = m;
        if (a.activity === 'tool' && c.lastActivity !== 'tool') { c.pulse = true; c.toolSince = time; (c.tools || (c.tools = [])).push(time); }
        c.lastActivity = a.activity;
        c.agent = a;
        c.color = colorFor(c);
        setEffort(c, a.effort || s.effort);
        setState(c, a.state);
      }
    }
    syncPets(sessions);
    // Finished sessions and subagents head back in.
    for (const b of buddies.values()) {
      if (b.kind !== 'home' && !live.has(b.key) && !b.merging && !b.dying) {
        b.merging = { since: time };
        if (b.kind === 'mother' && !away.has(b.key)) farewell(b);
      }
    }
    // With no sessions left, the biggest one stays behind as the home slime.
    if (!sessions.length && !pending && !buddies.has(HOME)) {
      // (Not one you just hid: that one goes in, to a home slime of its own.)
      const keep = bigs().filter((o) => !away.has(o.key)).sort((a, b) => b.body.o.radius - a.body.o.radius)[0];
      if (keep) {
        rekey(keep, HOME);
        Object.assign(keep, { kind: 'home', session: null, state: 'idle', merging: null, bubble: null });
        setEffort(keep, '');
        keep.color = colorFor(keep);
      } else {
        buddies.set(HOME, new Buddy(HOME, 'home', W * 0.8, H * 0.5, CFG.mainRadius));
      }
    }
    for (const b of buddies.values()) if (b.merging) b.mergeInto = mergeTarget(b);
  }

  // The first session takes over the home slime. Later ones split off the
  // nearest mother and grow to full size.
  // --- Pets: background tasks ----------------------------------------------
  // Each background task (a dev server, a watcher) is a small rigid box
  // that hops after its session's slime, like a pet. Not a slime, so it
  // can't be mistaken for a subagent, and it never changes the slime's face.
  const pets = new Map();

  // The shots script (scripts/shots) opens the window with ?debug to look
  // inside while it plays a scene.
  if (new URLSearchParams(location.search).has('debug')) globalThis.__blaube = { buddies, pets, hearts: () => hearts, now: () => time, sys, spoken, input: { down: (e) => onDown(e), move: (e) => onMove(e), up: (e) => onUp(e) }, ownMouse: false, ghost: (b, o) => ghostNow(b, o), ledges: () => ledges, roomFor: (b) => roomFor(b), mover: () => mover };
  const petSize = () => 34 * CFG.size;

  function syncPets(sessions) {
    const live = new Set();
    for (const s of sessions) {
      const m = buddies.get(s.id);
      (s.tasks || []).forEach((task, i) => {
        const key = `${s.id}/task/${task.id}`;
        live.add(key);
        let p = pets.get(key);
        if (!p) {
          // Pops out of its slime.
          const c = m ? m.body.centroid() : { x: W / 2, y: H / 2 };
          p = { key, x: c.x, y: c.y, vx: (Math.random() - 0.5) * 400, vy: -700, angle: 0, va: (Math.random() - 0.5) * 12, born: time, dying: 0, nextHop: time + 0.6, happy: false, heartAt: -1, nextBlink: time + 2, landedAt: -1, held: null };
          pets.set(key, p);
        }
        Object.assign(p, { owner: m, task, index: i });
      });
    }
    for (const p of pets.values()) if (!live.has(p.key) && !p.dying) p.dying = time;
  }

  function stepPets() {
    for (const [key, p] of pets) {
      if (p.dying && time - p.dying > 1.1) { pets.delete(key); continue; }
      if (p.dying && !p.saidBye) {
        p.saidBye = true;
        p.vy = -320;
        spawnHeart({ x: p.x, y: p.y - petSize(), vx: 0, born: time, size: 8 });
      }
      const PET = petSize(), h = PET / 2;
      // Riding on its slime's head (fetched): it sits on top and sways along,
      // then hops off.
      if (p.ride || p.rideOn) {
        const o = p.ride || p.rideOn, ob = o.body;
        let top = 0;
        for (let i = 0; i < ob.n; i++) if (ob.py[i] < ob.py[top]) top = i;
        const tx = ob.px[top], ty = ob.py[top] - h + 3;
        if (o.dying || ob.grab || p.held || p.dying) p.ride = p.rideOn = p.napOn = null;
        else if (p.ride && time > p.rideUntil) {
          p.ride = p.napOn = null;
          p.vx = (Math.random() < 0.5 ? -1 : 1) * 160; p.vy = -320; p.va = Math.sign(p.vx) * 3;
          p.nextHop = time + 0.8;
        } else if (p.ride) {
          if (p.napOn && (o.sleep || 0) > 0.5) p.rideUntil = time + 0.4; // (stays while its slime sleeps)
          const v = ob.velocity(DT);
          p.x = tx; p.y = ty; p.vx = v.x; p.vy = v.y;
          p.angle += (Math.max(-0.5, Math.min(0.5, -v.x / 1200)) - p.angle) * 0.2;
          p.happy = true;
          if (time > p.nextBlink) p.nextBlink = time + 1.5 + Math.random() * 4;
          continue;
        } else if (p.vy > 0 && Math.abs(p.x - tx) < ob.o.radius * 0.8 && p.y >= ty - 4 && p.y < ty + PET * 1.5) {
          // Landed on top of it.
          p.ride = o; p.rideOn = null; p.rideUntil = time + 3.5;
          continue;
        } else if (time - (p.rideAt || 0) > 2) p.rideOn = p.napOn = null;
      }
      const floor = floorAt(p.x, p.held ? undefined : p.y + h) - h;
      p.ledge = floor + h < floorAt(p.x) ? ledges.find((l) => l.y === floor + h && p.x >= l.x0 && p.x <= l.x1) : null;
      // Standing on the floor, or on top of a slime.
      const onFloor = !p.held && (p.y >= floor - 0.5 || time - p.landedAt < 0.05);
      if (p.held) {
        // Dragged: it follows the mouse on a stiff spring and tilts with it.
        p.vx = (mouse.x - p.held.dx - p.x) * 20;
        p.vy = (mouse.y - p.held.dy - p.y) * 20;
        p.angle += (Math.max(-0.6, Math.min(0.6, p.vx / 1500)) - p.angle) * 0.2;
        p.va = 0;
      } else p.vy += CFG.gravity * DT;
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.angle += p.va * DT;
      if (p.x < h) { p.x = h; p.vx = Math.abs(p.vx) * 0.5; }
      if (p.x > W - h) { p.x = W - h; p.vx = -Math.abs(p.vx) * 0.5; }
      if (p.y < h) { p.y = h; p.vy = Math.abs(p.vy) * 0.5; }
      if (p.y >= floor) {
        p.y = floor;
        p.vy = p.vy > 250 ? -p.vy * 0.25 : 0;
        p.vx *= 0.8;
      }
      // Rigid: it lands flat, upright.
      if (onFloor) { p.angle *= 0.7; p.va = 0; }
      // Its spot, next to its slime.
      const m = p.owner && !p.owner.dying ? p.owner : null;
      let dx = 0, rise = 0;
      if (m) {
        dx = petSpot(p, m, PET) - p.x;
        rise = p.y + h - m.body.bbox().maxY; // its slime is up on a window
      }
      // Back by its slime: a little heart, and it's happy until its slime
      // moves well away again.
      const happy = !!m && onFloor && Math.abs(dx) < (p.happy ? 70 : 30) && Math.abs(rise) < PET;
      if (happy && !p.happy) p.heartAt = time;
      p.happy = happy;
      // Blinks now and then.
      if (time > p.nextBlink) p.nextBlink = time + 1.5 + Math.random() * 4;
      // A leaf drifting down close by: it jumps to bat at it.
      if (onFloor && !p.dying && CFG.seasons > 0 && time > (p.nextChase || 0)) {
        const f = flakes.find((f) => !f.on && !f.landed && f.kind !== 'snow' && Math.abs(f.x - p.x) < 110 && p.y - f.y > 40 && p.y - f.y < 220);
        if (f) {
          p.nextChase = time + 2 + Math.random() * 3;
          const up = Math.sqrt(2 * CFG.gravity * (p.y - f.y + 10)), air = up / CFG.gravity;
          p.vx = (f.x + f.vx * air - p.x) / air;
          p.vy = -up;
          p.va = Math.sign(p.vx) * 4;
          continue;
        }
      }
      // It feels for its slime: rushes over when it's seeing stars, and
      // bounces along when it's happy.
      if (m && CFG.petEmpathy > 0 && onFloor && !p.dying) {
        if (time < m.dizzyUntil && !p.rushed) {
          p.rushed = true;
          p.vx = Math.sign(dx) * Math.min(700, Math.abs(dx) * 3 + 150) * CFG.petEmpathy;
          p.vy = -420;
          p.va = Math.sign(dx) * 3;
          p.nextHop = time + 0.8;
          continue;
        }
        if (time >= m.dizzyUntil) p.rushed = false;
        if (happy && time < m.happyUntil && time > (p.nextCheer || 0)) {
          p.nextCheer = time + 0.5 + Math.random() * 0.5;
          p.vy = -260 * CFG.petEmpathy;
          p.va = (Math.random() - 0.5) * 4;
          continue;
        }
      }
      if (!onFloor || time < p.nextHop || p.dying) continue;
      // Its slime fast asleep: the first pet climbs up onto its head for a
      // nap of its own.
      if (m && CFG.petNap > 0 && p.index === 0 && (m.sleep || 0) > 0.85 && Math.abs(p.x - m.body.centroid().x) < m.body.o.radius * 3 && Math.abs(rise) < PET && time > (p.nextClimb || 0) && m.body.onFloor()) {
        p.nextClimb = time + 30;
        const ob = m.body, top = ob.bbox().minY, c = ob.centroid();
        const up = Math.sqrt(2 * CFG.gravity * Math.max(PET, p.y - top + PET * 1.2)), air = up / CFG.gravity * 1.6;
        p.vx = (c.x - p.x) / air;
        p.vy = -up;
        p.va = Math.sign(p.vx || 1) * 2;
        p.rideOn = m; p.rideAt = time; p.napOn = true;
        p.nextHop = time + 1.5;
        continue;
      }
      // Follow its slime: hop after it, at random moments.
      if (m && !happy) {
        p.vx = Math.sign(dx) * Math.min(520, Math.abs(dx) * 2.4 + 90);
        p.vy = rise > PET ? -Math.sqrt(2 * CFG.gravity * (rise + PET * 1.5)) : -360 - Math.random() * 180;
        p.va = Math.sign(dx) * 1.5; // leans into the hop
      } else if (happy && time > (p.nextPlay || (p.nextPlay = time + 4 + Math.random() * 8))) {
        const mates = [...pets.values()].filter((o) => o !== p && o.owner === p.owner && !o.dying);
        const mate = mates[Math.floor(Math.random() * mates.length)];
        if (mate) {
          const mdx = mate.x - p.x;
          p.vx = Math.sign(mdx) * Math.min(420, Math.abs(mdx) * 2.6 + 60);
          p.vy = -300 - Math.random() * 120;
          p.va = Math.sign(mdx) * 2;
          p.happy = false; // off to play; it'll come back happy
        }
        p.nextPlay = time + 6 + Math.random() * 10;
      }
      p.nextHop = time + 0.5 + Math.random() * 2.2;
    }
  }

  // Pets live on their own layer in front of the slimes: they pass in front
  // of them, but bump into each other (and can stand on each other). A pet
  // counts as a circle here, which is close enough for a small box.
  function collidePets() {
    const R = petSize() * 0.55;
    const list = [...pets.values()].filter((p) => !p.dying);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], c = list[j];
        let dx = c.x - a.x, dy = c.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= R * 2 || d < 1e-3) continue;
        dx /= d; dy /= d;
        const push = (R * 2 - d) / 2;
        a.x -= dx * push; a.y -= dy * push;
        c.x += dx * push; c.y += dy * push;
        const rel = (c.vx - a.vx) * dx + (c.vy - a.vy) * dy;
        if (rel < 0) {
          a.vx += dx * rel * 0.6; a.vy += dy * rel * 0.6;
          c.vx -= dx * rel * 0.6; c.vy -= dy * rel * 0.6;
        }
        if (dy > 0.6) a.landedAt = time; else if (dy < -0.6) c.landedAt = time;
      }
    }
    const h = petSize() / 2;
    for (const p of list) {
      p.x = Math.max(h, Math.min(W - h, p.x));
      p.y = Math.min(p.y, floorAt(p.x) - h);
    }
  }

  // Where a pet wants to be: beside its slime's body, on its own side, or
  // the other side if that's off the screen.
  // Spots go right, left, right, left... each pair a step further out,
  // skipping any that would be off the screen; pet number i takes the i-th.
  function petSpot(p, m, size) {
    const box = m.body.bbox();
    const spots = [];
    for (let k = 0; spots.length <= p.index && k < 40; k++) {
      const gap = 14 + size / 2 + Math.floor(k / 2) * (size + 12);
      const x = k % 2 ? box.minX - gap : box.maxX + gap;
      if (x >= size / 2 && x <= W - size / 2) spots.push(x);
    }
    return spots[p.index] ?? spots[spots.length - 1] ?? p.x;
  }

  function petAt(x, y) {
    const PET = petSize();
    for (const p of pets.values()) if (!p.dying && Math.abs(x - p.x) < PET * 0.7 && Math.abs(y - p.y) < PET * 0.7) return p;
    return null;
  }

  function drawPets() {
    for (const p of pets.values()) {
      const grow = p.dying ? Math.max(0, Math.min(1, 1 - (time - p.dying - 0.7) / 0.4)) : Math.min(1, (time - p.born) / 0.25);
      const color = p.owner ? familyColor(p.owner, p.key) : '#3a4258';
      let lx = 0, ly = 0;
      if (p.owner) {
        const c = p.owner.body.centroid();
        const d = Math.hypot(c.x - p.x, c.y - p.y) || 1;
        lx = (c.x - p.x) / d; ly = (c.y - p.y) / d;
      }
      // (Its slime dozing off, it naps too: eyes shut.)
      // When happy it sways softly from side to side, rocking on its base.
      const sway = p.happy ? Math.sin((time - p.heartAt) * 1.8) * 0.13 * Math.min(1, (time - p.heartAt) * 2) : 0;
      D.drawPet(ctx, {
        x: p.x, y: p.y, size: petSize() * grow, angle: p.angle, sway, color, lx, ly,
        blink: time > p.nextBlink - 0.13 || (!!p.owner && (p.owner.sleep || 0) > 0.6), happy: p.happy || time < (p.pettedUntil || 0) || time < (p.playUntil || 0), heart: p.heartAt >= 0 ? time - p.heartAt : Infinity,
      }, floorAt(p.x), CFG.shadow);
    }
  }

  // A new session's slime pops out of the middle of the screen, small, and
  // grows into its full self as it flies out. Blaube on its own (no
  // sessions) makes way.
  function addMother(s) {
    const home = buddies.get(HOME);
    if (home && !home.dying) { home.dying = time; home.targetR = 2; }
    const b = new Buddy(s.id, 'mother', W / 2, H * 0.42, CFG.mainRadius * 0.25);
    buddies.set(s.id, b);
    b.session = s;
    b.needsGreet = time + 2.5;
    b.hop((Math.random() - 0.5) * 700, -300 - Math.random() * 250);
    for (const o of buddies.values()) {
      if (o === b || o.dying || o.kind === 'home') continue;
      o.glanceAt = b;
      o.glanceUntil = time + 1 + Math.random();
      o.nextGlance = o.glanceUntil + 2 + Math.random() * 3;
      if (o.body.onFloor() && !o.body.grab && Math.random() < 0.7) o.hop(0, -250 - Math.random() * 150);
    }
    return b;
  }

  function split(src, key, kind) {
    const c = src.body.centroid();
    const side = Math.random() < 0.5 ? -1 : 1;
    const r = src.body.o.radius;
    const b = new Buddy(key, kind, c.x + side * r * 0.35, c.y - r * 0.15, CFG.childRadius * 0.45);
    b.targetR = CFG.childRadius;
    b.parent = src;
    if (kind === 'child') b.mother = src;
    buddies.set(key, b);
    b.hop(side * CFG.splitImpulse * 0.7, -CFG.splitImpulse);
    src.hop(-side * CFG.splitImpulse * 0.2, -CFG.splitImpulse * 0.25);
    return b;
  }

  // Children go back to their mother. Mothers go to the nearest other
  // mother that's staying (or the home slime).
  function mergeTarget(b) {
    const ok = (o) => !o.removed && !o.dying;
    if (b.kind === 'child' && b.mother && ok(b.mother)) return b.mother;
    return nearestBig(b, (o) => !o.merging) || nearestBig(b, () => true);
  }

  // Each slime's look, picked from its key so a session keeps its look.
  // (A session can name one, which the shots script uses.)
  function lookOf(b) {
    if (CFG.looks === 'Off' || b.kind === 'home') return 'none';
    if (b.effort === 'high' && !b.glasses) return 'none'; // the glasses are its accent
    if (b.session && b.session.look) return b.session.look;
    // Chosen once, then kept for as long as it runs. A session's slime takes
    // its favourite look that no other session's slime is wearing (plain
    // ones may repeat; about half are plain). A helper takes its favourite.
    if (b.chosenLook && b.chosenLookFor === b.key) return b.chosenLook;
    const order = Looks.lookOrder(b.key, !b.big);
    if (b.kind === 'child') b.chosenLook = order[0];
    else {
      const worn = new Set([...buddies.values()].filter((o) => o !== b && o.kind === 'mother' && o.chosenLook && !o.dying).map((o) => o.chosenLook));
      b.chosenLook = order.find((n) => n === 'none' || !worn.has(n)) || order[0];
    }
    b.chosenLookFor = b.key;
    return b.chosenLook;
  }

  // low, medium, high or xhigh (max counts as xhigh).
  function setEffort(b, effort) {
    const e = String(effort || '').toLowerCase();
    b.effort = e === 'max' ? 'xhigh' : ['low', 'high', 'xhigh'].includes(e) ? e : 'medium';
    if (b.effort !== 'high' && b.glasses) {
      if (drag && drag.glasses === b.glasses) drag = null;
      b.glasses = null;
    }
  }

  function setState(b, state) {
    const prev = b.state;
    b.state = state;
    if (prev !== state) { b.stateSince = time; if (state !== 'waiting') b.waitSaid = false; react(b, prev); }
  }

  function react(b, prev) {
    switch (b.state) {
      case 'waiting':
        if (wantsAttention(b)) b.hop(0, -CFG.waitingHopStrength);
        b.nextHop = time + 2.2;
        cheerOn(b, false, true); // (the others look over: it needs you)
        break;
      case 'done': {
        const took = b.session && b.session.turnStart ? (Date.now() - b.session.turnStart) / 1000 : 0;
        if (took > 300) {
          // A long one: it's earned a little party.
          // The hearts come out of the top of its head as it jumps, wherever
          // that is by then.
          for (let i = 0; i < 7; i++) spawnHeart({ from: b, dx: (Math.random() - 0.5) * 1.4, dy: 10 + Math.random() * 30, vx: (Math.random() - 0.5) * 120, rise: 220 + Math.random() * 80, born: time + 0.3 + i * 0.08, size: 9 + Math.random() * 6 });
          b.hop((Math.random() - 0.5) * 100, -CFG.doneHopStrength * 1.5);
          if (CFG.doneStretch > 0) b.stretchAt = time + 1.8; // ...then a good long stretch
        } else if (wantsAttention(b)) b.hop((Math.random() - 0.5) * 200, -CFG.doneHopStrength * 1.1);
        b.happyUntil = time + 2.5;
        b.nextHop = time + CFG.doneHopEvery + (b.stretchAt ? 3 : 0); // (room for the stretch)
        cheerOn(b, took > 300);
        if (b.kind === 'mother') {
          setTimeout(allDone, 1500);
          // Another session finished just now too: a high five.
          b.doneAt = time;
          const pal = CFG.highFive > 0 && [...buddies.values()].find((o) => o !== b && o.kind === 'mother' && o.state === 'done' && !o.dying && time - (o.doneAt ?? -99) < 20 && !o.five);
          if (pal) setTimeout(() => highFive(b, pal), 4200); // (after any "all done!")
        }
        break;
      }
    }
  }

  // Ears (and antennas, and sprouts) twitch now and then, and prick up when
  // your cursor comes close.
  const TWITCHY = { catears: 1, bunny: 1, antenna: 1, sprout: 1 };
  function twitch(b) {
    if (CFG.earTwitch <= 0 || !TWITCHY[b.look] || b.dying || (b.sleep || 0) > 0.5) return;
    const k = Math.min(2, CFG.earTwitch), c = b.body.centroid(), r = b.body.o.radius;
    const near = !drag && !lulled(b) && Math.hypot(mouse.x - c.x, mouse.y - c.y) < r * 2.5;
    if (near && !b.cursorNear) Looks.flick(b, -7 * k, 0); // (pricks up)
    b.cursorNear = near;
    if (time < (b.nextTwitch ?? (b.nextTwitch = time + 3 + Math.random() * 10))) return;
    b.nextTwitch = time + (4 + Math.random() * 14) / k;
    const side = Math.random() < 0.5 ? -1 : 1;
    Looks.flick(b, (5 + Math.random() * 4) * k, side);
    // Sometimes a quick double flick.
    if (Math.random() < 0.3) setTimeout(() => { if (!b.dying) Looks.flick(b, 5 * k, side); }, 160);
  }

  // Two sessions that finish close together jump up and bump in the air
  // between them: "high five!".
  function highFive(a, o, tries = 0) {
    const ok = (x) => !x.dying && !x.body.grab && !x.merging && x.state === 'done' && x !== buddies.get(talkingTo);
    if (!ok(a) || !ok(o) || a.five || o.five || tries > 12) return;
    const settled = (x) => x.body.onFloor() && !x.pendingHop;
    if (!settled(a) || !settled(o)) { setTimeout(() => highFive(a, o, tries + 1), 300); return; } // (wait for both to land)
    a.nextHop = o.nextHop = time + 2;
    const ca = a.body.centroid(), co = o.body.centroid(), ra = a.body.o.radius, ro = o.body.o.radius;
    const dx = co.x - ca.x, gap = Math.abs(dx) - (ra + ro) * 0.85;
    if (gap < 0 || gap > (ra + ro) * 8 || Math.abs(co.y - ca.y) > Math.max(ra, ro)) return;
    if (gap > (ra + ro) * 1.2) {
      // Too far apart: they hop over to each other first.
      const step = Math.min(gap / 2 - (ra + ro) * 0.3, (ra + ro) * 1.5);
      a.hop(Math.sign(dx) * step * 1.6, -330);
      o.hop(-Math.sign(dx) * step * 1.6, -330);
      setTimeout(() => highFive(a, o, tries + 1), 1100);
      return;
    }
    // Both take off together and meet at the top of the jump.
    const t = 0.36, vy = -CFG.gravity * t, k = Math.min(1.4, CFG.highFive), vx = Math.sign(dx) * (gap / 2) / t;
    const five = { a, o, until: time + 2, hit: false };
    a.five = o.five = five;
    a.hop(vx, vy * k);
    o.hop(-vx, vy * k);
    a.glanceAt = o; o.glanceAt = a; a.glanceUntil = o.glanceUntil = time + 1.5;
  }
  function stepFive(b) {
    const f = b.five;
    if (!f || f.a !== b) return;
    if (time > f.until || f.o.dying || b.dying) { f.a.five = f.o.five = null; return; }
    if (f.hit) return;
    const m = f.a.body.bbox(), n = f.o.body.bbox();
    if (Math.max(n.minX - m.maxX, m.minX - n.maxX) < 4 && !f.a.body.onFloor() && !f.o.body.onFloor()) {
      f.hit = true;
      const x = (Math.max(m.minX, n.minX) + Math.min(m.maxX, n.maxX)) / 2, y = Math.max(m.minY, n.minY) + 6;
      quip(f.a, 'high five!', 1.4);
      pops.push({ x, y, r: 10, born: time, color: '#ffd166', life: 0.5 }, { x, y, r: 20, born: time + 0.06, color: '#ffd166', life: 0.5 });
      f.a.happyUntil = f.o.happyUntil = time + 2;
    }
  }

  // Slimes resting against each other slowly fall into breathing together.
  function breatheTogether(b) {
    if (CFG.breathSync <= 0 || b.pain > 0.2 || b.body.grab) return;
    const c = b.body.centroid(), r = b.body.o.radius, reach = r * 0.5, mine = time * b.breathRate + b.breathPhase;
    let m = null;
    for (const o of buddies.values()) {
      if (o === b || o.dying || o.body.grab) continue;
      const oc = o.body.centroid();
      if (Math.hypot(oc.x - c.x, oc.y - c.y) > (r + o.body.o.radius) * 1.8) continue; // (far apart: skip the outlines)
      m = m || b.body.bbox();
      const n = o.body.bbox();
      if (n.minX - m.maxX > reach || m.minX - n.maxX > reach || n.minY - m.maxY > reach || m.minY - n.maxY > reach) continue;
      b.breathPhase += DT * 1.2 * CFG.breathSync * Math.sin(time * o.breathRate + o.breathPhase - mine);
    }
  }

  // Dozing off with another slime close by: it inches over, sleepily,
  // to curl up next to it.
  function huddle(b) {
    if (CFG.huddle <= 0 || b.kind === 'child') return;
    if ((b.sleep || 0) < 0.1) { b.huddled = false; b.huddleTo = null; return; }
    if (b.sleep < 0.3) return;
    const c = b.body.centroid(), r = b.body.o.radius;
    // (By their actual outlines: dozing, they're wider than they are round.)
    const gapTo = (o) => { const m = b.body.bbox(), n = o.body.bbox(); return Math.max(n.minX - m.maxX, m.minX - n.maxX); };
    if (!b.huddled) {
      b.huddled = true;
      let near = null, nd = Infinity;
      for (const o of buddies.values()) {
        if (o === b || o.dying || !o.big || !o.body.onFloor() || o.huddleTo === b) continue;
        const d = gapTo(o);
        if (Math.abs(o.body.centroid().y - c.y) < r * 2 && d > r * 0.2 && d < r * 8 * CFG.huddle && d < nd) { near = o; nd = d; }
      }
      if (!near || Math.random() > 0.8) return;
      b.huddleTo = near; // (so the two don't both shuffle over and meet halfway)
      b.huddleFrom = time;
    }
    const to = b.huddleTo;
    if (!to || to.dying || to.body.grab || time - b.huddleFrom > 120) return;
    const gap = gapTo(to);
    if (gap < 3 || gap > r * 10) return; // (snug, or it was carried off)
    // Inching: a slow crawl, the top rising and falling with each push.
    const want = Math.sign(to.body.centroid().x - c.x) * Math.min(90, 20 + gap * 1.2);
    const v = b.body.velocity(DT);
    b.body.impulse((want - v.x) * 0.08, 0, DT);
    b.body.squashTop(Math.sin(time * 7) * r * 0.6 * DT * 60, DT);
  }

  // A slime finishes: the others look over, and calm ones nearby are
  // pleased for it (a long one gets a little hop of applause).
  function cheerOn(b, big, lookOnly) {
    if (CFG.cheerOthers <= 0) return;
    const c = b.body.centroid();
    let i = 0;
    for (const o of buddies.values()) {
      if (o === b || o.dying || o.mother === b || o.kind === 'home') continue;
      const oc = o.body.centroid(), near = Math.hypot(oc.x - c.x, oc.y - c.y) < b.body.o.radius * 12;
      setTimeout(() => {
        if (o.dying || b.dying) return;
        o.glanceAt = b;
        o.glanceUntil = time + 1.2 + Math.random() * 0.6;
        if (lookOnly || !near || o.state === 'working' || o.state === 'waiting' || o.body.grab) return;
        o.happyUntil = time + 1.5;
        if (big && o.body.onFloor() && Math.random() < 0.7 * CFG.cheerOthers) o.hop(0, -(300 + Math.random() * 120) * Math.min(1.5, CFG.cheerOthers));
      }, 300 + i++ * 140 + Math.random() * 200);
    }
  }

  // A session ends and its slime heads off: the others turn to watch it go,
  // a little deflated, and the nearest one says bye.
  function farewell(b) {
    if (CFG.farewell <= 0) return;
    const c = b.body.centroid();
    const others = [...buddies.values()].filter((o) => o !== b && !o.dying && !o.merging && o.mother !== b);
    others.sort((p, q) => { const pc = p.body.centroid(), qc = q.body.centroid(); return Math.hypot(pc.x - c.x, pc.y - c.y) - Math.hypot(qc.x - c.x, qc.y - c.y); });
    others.forEach((o, i) => setTimeout(() => {
      if (o.dying || o.merging) return;
      o.glanceAt = b;
      o.glanceUntil = time + 1.6 + Math.random() * 0.6;
      if (o.state === 'working' || o.body.grab) return;
      o.droopUntil = time + 1.2 * CFG.farewell;
      if (i === 0 && Math.random() < 0.8) {
        quip(o, Math.random() < 0.5 ? 'bye!' : 'bye bye', 1.6);
        if (o.body.onFloor()) o.hop(0, -180 * Math.min(1.5, CFG.farewell));
      }
    }, 250 + i * 160 + Math.random() * 200));
  }

  // The last session busy finishes and everything's done: a Mexican wave of
  // hops along the row, and the one at the end says so.
  let lastWave = -1e9;
  function allDone() {
    if (CFG.allDoneWave <= 0 || time - lastWave < 60) return;
    const ms = [...buddies.values()].filter((o) => o.kind === 'mother' && !o.dying && !o.merging);
    if (ms.length < 2 || ms.some((o) => o.state === 'working' || o.state === 'waiting')) return;
    lastWave = time;
    ms.sort((p, q) => p.body.centroid().x - q.body.centroid().x);
    if (Math.random() < 0.5) ms.reverse();
    ms.forEach((o, i) => setTimeout(() => {
      if (o.dying || o.body.grab) return;
      o.happyUntil = time + 1.5;
      if (o.body.onFloor()) o.hop(0, -(300 + 60 * Math.min(1, CFG.allDoneWave)) * Math.min(1.4, CFG.allDoneWave));
      if (i === ms.length - 1) quip(o, 'all done!', 2);
    }, 250 * i));
  }

  function label(b) {
    if (b.kind === 'child') {
      const a = b.agent || {};
      const name = a.description || a.type || 'agent';
      return name.length > 28 ? name.slice(0, 27) + '…' : name;
    }
    return (b.session && (b.session.shownName || b.session.project)) || 'Claude';
  }

  const kidsOf = (m) => [...buddies.values()].filter((b) => b.mother === m && !b.dying);

  function summaryLines() {
    const mothers = [...buddies.values()].filter((b) => b.kind === 'mother' && !b.dying && b.session);
    if (!mothers.length) {
      return [{ text: settings.noClaude ? 'I can’t find Claude Code. Right-click me to install it'
        : settings.hooksInstalled ? 'Nothing running. Right-click me to start a session' : 'Right-click me to connect Claude Code, or start a session' }];
    }
    const word = { working: 'working', waiting: 'needs you', done: 'done', idle: 'idle' };
    return mothers.map((b) => {
      const n = kidsOf(b).length;
      return { text: `${label(b)}: ${word[b.state] || b.state}${n ? ` (${n} subagent${n > 1 ? 's' : ''})` : ''}`, color: D.STATE_COLORS[b.state] };
    });
  }

  const unseen = (b) => !!(b.session && !b.session.seen);

  // Slimes only jump to get your attention: when they need you or are done
  // and you haven't looked at their session yet. Children go by their
  // mother's session.
  function wantsAttention(b) {
    const m = b.kind === 'child' ? b.mother : b;
    if (!unseen(m)) return false;
    // Its talk box is open (or opening): it has your attention.
    if (talkingTo === m.key || tails.has(m.key) || time < (m.talkHold || 0)) return false;
    return b.state === 'waiting' || (b.state === 'done' && b.kind !== 'child');
  }

  // --- Simulation ---------------------------------------------------------

  function step() {
    glideLedges();
    stepPets();
    stepBattery();
    stepChoir();
    for (const b of [...buddies.values()]) {
      if (b.removed) continue;
      const body = b.body;
      const r = body.o.radius;
      if (b.big && !b.dying) b.targetR = radiusFor(b);
      else if (b.kind === 'child' && !b.dying && !b.splitting) b.targetR = childRadius(b);
      let nextR = Math.abs(b.targetR - r) > 0.05 ? r + (b.targetR - r) * (b.dying ? 0.08 : 0.02) : r;
      // Never within a step of its mother, even while she's still growing
      // in or it's splitting off.
      const mother = b.kind === 'child' && liveMother(b);
      if (mother) nextR = Math.min(nextR, mother.body.o.radius / BlaubeConfig.MOTHER_STEP);
      if (nextR !== r) body.setRadius(nextR);
      // A fuller context puffs the slime up tight; in pain it pants.
      b.fill = (b.fill || 0) + (contextFill(b) - (b.fill || 0)) * 0.01;
      b.pain = ramp(b.fill, CFG.painAt, 1);
      warnFull(b);
      b.breathPhase += DT * b.breathRate * 1.5 * b.pain;
      breatheTogether(b);
      if (b.mood) b.mood *= 1 - DT / 90;
      if (time < (b.pettedUntil || 0)) feel(b, 0.35 * DT);
      else if (b.patted) feel(b, 0.2 * DT);
      // A setback (a failed tool or test) lets some air out for a moment.
      b.droop = (b.droop || 0) + ((time < (b.droopUntil || 0) ? 1 : 0) - (b.droop || 0)) * (time < (b.droopUntil || 0) ? 0.02 : 0.006);
      body.areaScale = (1 + CFG.contextInflate * b.fill * b.fill) * (1 + CFG.breathe * (1 - (b.taut || 0)) * (1 + 12 * CFG.sleepSlump * (b.sleep || 0)) * Math.sin(time * b.breathRate + b.breathPhase)) * (1 - CFG.droop * b.droop);
      // ...and firmer: more pressure inside, so a full one barely sags.
      // (Capped: past about 0.85 the pressure solve overshoots and the skin
      // jitters, worst while it's held.)
      // Dozing (idle, nobody around for two minutes): it slumps, softer and
      // flatter. When you come back it wakes with a big stretch up.
      const asleep = b.state === 'idle' && dozing() && !body.grab;
      b.sleep = (b.sleep || 0) + ((asleep ? 1 : 0) - (b.sleep || 0)) * (asleep ? 0.002 : 0.05);
      if (!asleep && b.sleep > 0.5 && !b.woke && body.onFloor()) { b.woke = true; body.squashTop(-CFG.sleepSlump * body.o.radius * 90, DT); b.nextBlink = time; }
      // Waking pops the bubble it was snoring, with a start.
      if (b.snore && !asleep) {
        pops.push({ x: b.snore.x, y: b.snore.y, r: b.snore.r, born: time, color: b.color });
        b.snore = null;
        b.startleUntil = time + 0.5; b.surpriseUntil = time + 0.5;
      }
      if (asleep) b.woke = false;
      body.areaScale *= 1 - CFG.sleepSlump * b.sleep;
      // Just gulped a helper back in: a swell that wobbles down.
      if (b.puff) body.areaScale *= 1 + b.puff; // (puffed up like a balloon)
      if (b.gulpAt && time - b.gulpAt < 1.2) { const t = time - b.gulpAt; body.areaScale *= 1 + 0.1 * CFG.gulp * Math.sin(t * 9) * Math.exp(-t * 3); }
      body.o.pressure = Math.min(0.85, CFG.pressure * trait(b, 'firm') * (1 + CFG.contextTighten * b.fill)) * (1 - 0.5 * b.droop) * (1 - 2 * CFG.sleepSlump * b.sleep);
      if (sys.low > 0) { body.areaScale *= 1 - 0.06 * sys.low; body.o.pressure *= 1 - 0.35 * sys.low; }
      // Pressure alone tops out early, so a full one also holds its round
      // shape harder and its skin goes taut: it barely squashes or sags.
      const firm = b.fill * b.fill * CFG.contextFirm;
      body.o.shapeStiffness = CFG.shapeStiffness + 0.08 * firm + 0.12 * (b.shapeAmt || 0); // (holding a shape takes some effort; see shapeShift)
      body.o.edgeStiffness = CFG.edgeStiffness + 0.4 * firm;
			// Blown up like a balloon: taut as a drum, round, no sag or wobble.
			if (b.taut) { body.o.pressure = Math.max(body.o.pressure, 0.75 * b.taut); body.o.shapeStiffness += 0.05 * b.taut; }
      liven(b);
      const pre = body.velocity(DT);
      b.vel = pre; // (others watch it fly; see spectate)
      body.step(DT);
      updateGaze(b);
      b.look = lookOf(b);
      if (b.look !== 'none') Looks.stepLook(b, DT);
      if (b.splitting) pullStrand(b);
      if (body.lastImpact > CFG.dizzySpeed && time > (b.softUntil || 0)) { if (time > (b.dizzyUntil || 0)) feel(b, -0.15); b.dizzyUntil = time + 0.9; }
      // A good thump makes it blink (a hard one makes it dizzy, above).
      else if (body.lastImpact > 650 && CFG.eyeLife > 0 && time > (b.thumpBlinkAt || 0)) { b.nextBlink = time; b.thumpBlinkAt = time + 0.3; }
      if (body.lastImpact > 650 && CFG.contactJiggle > 0) passJiggle(b, body.lastImpact);
      if (flakes.length) stirFlakes(b, pre);
      if (b.effort === 'high' && !b.glasses && !b.splitting && !b.merging && !b.dying && body.lastImpact > CFG.glassesSpeed && time > (b.softUntil || 0)) knockGlasses(b);
      if (b.glasses) stepGlasses(b);
      if (meditating(b)) levitate(b);

      // A helper that's done first has a moment to itself (happy eyes, a
      // little hop and a heart), then heads home.
      const celebrating = b.merging && b.kind === 'child' && time - b.merging.since < 0.9;
      if (celebrating && !b.merging.hopped && body.onFloor() && !body.grab) {
        b.merging.hopped = true;
        b.hop(0, -380);
      }
      if (b.merging && !b.dying && !celebrating) {
        let m = b.mergeInto;
        if (!m || m.removed || m.dying) m = b.mergeInto = mergeTarget(b);
        if (!m) {
          b.dying = time;
          b.targetR = 2;
        } else {
          const c = body.centroid(), mc = m.body.centroid();
          const dx = mc.x - c.x, dy = mc.y - c.y;
          const close = Math.hypot(dx, dy) < m.body.o.radius + r * 0.4;
          // (Given up on getting to her: after its sad moment it fades back
          // into her from where it is.)
          // (Still trying to get to her, it keeps at it longer.)
          if (close || (b.gaveUp ? time > b.gaveUp.until : time - b.merging.since > ((b.tries && b.tries.n) || stillTrying(b) ? 25 : 8))) {
            b.dying = time;
            b.targetR = 2;
            m.happyUntil = time + 1.2;
            // Gulp: the skin where it went in dips, and she swells a little.
            if (CFG.gulp > 0 && !m.body.grab) {
              const mr = m.body.o.radius, ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
              m.body.pushAt(mc.x - ux * mr, mc.y - uy * mr, ux * mr * 6 * CFG.gulp, uy * mr * 6 * CFG.gulp, mr * 0.6, DT);
              m.gulpAt = time;
              if (Math.random() < 0.3 * CFG.burps) m.burpAt = time + 0.9 + Math.random() * 0.6;
            }
          } else if (body.onFloor() && !body.grab && !b.gaveUp && !stillTrying(b) && time - (b.merging.lastHop || 0) > 0.6) {
            b.merging.lastHop = time;
            if (!jumpUpTo(b, m)) hopToMum(b, Math.sign(dx) * Math.min(700, Math.abs(dx) * 2.2 + 120), -520 - Math.max(0, -dy) * 1.5);
          }
        }
      }
      if (b.dying && body.o.radius < 4) remove(b);
    }

    const list = [...buddies.values()];
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (!passThrough(a, b) && collideBodies(a.body, b.body) && k === 0) bump(a, b);
        }
      }
    }
    collidePets();
    spreadOut();
    stepBubbles();
    stepSeason();
    stepFlutters();
    stepFireworks();
    clockLife();
    stepSnowballs();
  }

  // --- Effort ---------------------------------------------------------------

  // High effort: hit something hard enough and the glasses fly off.
  function knockGlasses(b) {
    const body = b.body, c = body.centroid(), r = body.o.radius, v = body.velocity(DT);
    b.glasses = {
      x: c.x, y: c.y - r * 0.2,
      vx: v.x * 0.5 + (Math.random() - 0.5) * 500, vy: Math.min(0, v.y) * 0.4 - 700,
      a: 0, va: (Math.random() - 0.5) * 24,
      r: r * CFG.faceScale, held: null, since: time,
    };
    quipBack(b, 'My glasses!', 1.6);
  }

  const glassesBox = (g) => ({ hw: g.r * 0.62, hh: g.r * 0.2 });

  // They tumble and land like a small rigid thing, until their slime
  // bumps into them (or you drop them on it) and puts them back on.
  function stepGlasses(b) {
    const g = b.glasses;
    const { hw, hh } = glassesBox(g);
    if (g.held) {
      g.vx = (mouse.x - g.held.dx - g.x) * 20;
      g.vy = (mouse.y - g.held.dy - g.y) * 20;
      g.a += (Math.max(-0.6, Math.min(0.6, g.vx / 1500)) - g.a) * 0.2;
      g.va = 0;
    } else g.vy += CFG.gravity * DT;
    g.x += g.vx * DT;
    g.y += g.vy * DT;
    g.a += g.va * DT;
    const floor = floorAt(g.x) - hh;
    if (g.y >= floor) {
      g.y = floor;
      g.vy = g.vy > 200 ? -g.vy * 0.3 : 0;
      g.vx *= 0.8;
      g.va *= 0.5;
      g.a += (Math.round(g.a / Math.PI) * Math.PI - g.a) * 0.25; // settle flat, or upside down
    }
    if (g.y < hh) { g.y = hh; g.vy = Math.abs(g.vy) * 0.4; }
    if (g.x < hw) { g.x = hw; g.vx = Math.abs(g.vx) * 0.5; }
    if (g.x > W - hw) { g.x = W - hw; g.vx = -Math.abs(g.vx) * 0.5; }
    if (!g.held && time - g.since > 0.6 && b.body.contains(g.x, g.y)) wearGlasses(b);
  }

  function wearGlasses(b) {
    if (drag && drag.glasses === b.glasses) drag = null;
    b.glasses = null;
    b.happyUntil = time + 1.6;
    b.hop(0, -260);
  }

  function glassesAt(x, y) {
    for (const b of buddies.values()) {
      const g = b.glasses;
      if (!g || b.dying) continue;
      const { hw, hh } = glassesBox(g);
      if (Math.abs(x - g.x) < hw + 6 && Math.abs(y - g.y) < hh * 1.6 + 6) return b;
    }
    return null;
  }

  // Extra high effort, while it works: it floats above the ground.
  const meditating = (b) => b.effort === 'xhigh' && b.state === 'working' && b.kind !== 'home' && !b.body.grab && !b.merging && !b.splitting && !b.dying;

  function levitate(b) {
    const body = b.body, c = body.centroid(), r = body.o.radius, v = body.velocity(DT);
    const target = floorAt(c.x) - r - CFG.levitateHeight + Math.sin(time * 1.6 + b.born * 3) * 8;
    const ay = -CFG.gravity + (target - c.y) * 16 - v.y * 4.5;
    body.impulse(-v.x * 2.5 * DT, ay * DT, DT);
  }

  // --- Life -----------------------------------------------------------------
  // Small forces every step that make a slime seem to have a mind and
  // muscles of its own: it crouches before it jumps, stretches out in
  // flight, leans toward a cursor that comes close, flinches from one that
  // whizzes past, shifts its weight when it's bored, and wriggles when it's
  // held up too long. All of it goes in as forces; the body does the rest.

  // How it feels about you lately, -1 (grumpy) to 1 (fond); it fades
  // back to neutral over a few minutes.
  const YOU = { body: { centroid: () => ({ x: mouse.x, y: mouse.y }) } }; // (to glare at)
  function feel(b, d) {
    if (CFG.moods > 0) b.mood = Math.max(-1, Math.min(1, (b.mood || 0) + d * CFG.moods));
  }

  // The slime you're dangling right over this one (it braces), if any.
  function heldOver(b) {
    const h = drag && drag.buddy;
    if (!h || h === b || CFG.spectate <= 0 || b.body.grab || !b.body.onFloor()) return null;
    const c = b.body.centroid(), hc = h.body.centroid(), r = b.body.o.radius;
    return hc.y < c.y - r && c.y - hc.y < r * 5 && Math.abs(hc.x - c.x) < r * 1.3 ? h : null;
  }

  // The nearest slime whizzing by (flying fast, or carried about), if any is
  // close enough to watch: { o, c, d }.
  function spectate(b) {
    if (CFG.spectate <= 0) return null;
    const c = b.body.centroid(), r = b.body.o.radius;
    let best = null;
    for (const o of buddies.values()) {
      if (o === b || o.dying || !o.vel) continue;
      // (Flying fast, or being carried about by you: worth watching.)
      if (!o.body.grab && (o.body.onFloor() || Math.hypot(o.vel.x, o.vel.y) < 700)) continue;
		// (One just hopping about, a done or needs-you bounce, a trick: a
		// slime at work doesn't look up for that, or its eyes would flick
		// open and shut with every hop. Thrown or carried, it still does.)
		if (b.state === 'working' && !o.body.grab && time - (o.hoppedAt ?? -9) < 2) continue;
      const oc = o.body.centroid(), d = Math.hypot(oc.x - c.x, oc.y - c.y) - o.body.o.radius;
      if (d < r * 9 && (!best || d < best.d)) best = { o, c: oc, d };
    }
    return best;
  }

  function liven(b) {
    const body = b.body;
    if (b.dying || b.removed) return;
    b.patted = false; // (see below)
    if (b.pendingHop) crouch(b);
    tingle(b);
    fume(b);
    // A sneeze: it breathes in (stretching up), then "achoo!", which knocks
    // everything off its head and rocks it back.
    if (b.blownAt && time - b.blownAt > 0.7) {
      // Blown back by a neighbour's sneeze: "bless you!", or "eww!".
      const by = b.blownBy;
      b.blownAt = 0;
      if (Math.random() < 0.5) { quip(b, 'bless you!', 1.1); b.happyUntil = time + 1; }
      else { quip(b, 'eww!', 1); if (by && !by.dying) { b.annoyedAt = by; b.annoyedUntil = time + 1.2; } }
      if (by && !by.dying) { b.glanceAt = by; b.glanceUntil = time + 1.2; }
    }
    if (body.grab) b.sneeze = null; // (held, it doesn't: see pickUp)
    if (b.sneeze) {
      const r = body.o.radius;
      if (time < b.sneeze.at) { if (body.onFloor()) body.squashTop(-r * 0.12 * 60 * DT * 60 * DT, DT); }
      else {
        // At whoever's beside it, if anyone is: the blast rocks it back the
        // other way and blows them back a step, leaves and all.
        const c = body.centroid();
        const near = [...buddies.values()].find((o) => o !== b && !o.dying && !o.body.grab && o.kind !== 'home' && Math.abs(o.body.centroid().y - c.y) < r * 1.5 && Math.abs(o.body.centroid().x - c.x) < r + o.body.o.radius * 3.5);
        const dir = near ? -Math.sign(near.body.centroid().x - c.x) || 1 : (Math.random() < 0.5 ? -1 : 1);
        if (near && CFG.sneezeGust > 0) {
          const k = Math.min(1.5, CFG.sneezeGust), or = near.body.o.radius;
          near.body.impulse(-dir * 220 * k, -90 * k, DT);
          near.body.lean(-dir * or * 6 * k, DT);
          near.surpriseUntil = time + 0.6; near.nextBlink = time;
          near.blownAt = time; near.blownBy = b;
          for (const f of flakes) if (f.on && f.on.b === near) { f.on = null; f.vx = -dir * (200 + Math.random() * 150); f.vy = -100 - Math.random() * 80; f.loose = time + 1.5; }
        }
        for (const f of flakes) if (CFG.sneezeGust > 0 && f.landed && !f.on && Math.abs(f.x - c.x) < r * 4 && Math.sign(f.x - c.x) === -dir) { f.landed = 0; f.vx = -dir * (180 + Math.random() * 200); f.vy = -150 - Math.random() * 150; f.loose = time + 1.5; }
        body.squashTop(r * 9, DT);
        body.lean(dir * r * 3, DT);
        body.impulse(-dir * 40, 0, DT);
        b.sneeze = null;
        b.sneezedAt = time;
        quip(b, 'achoo!', 1);
        for (const f of flakes) if (f.on && f.on.b === b) { f.on = null; f.vx = dir * (150 + Math.random() * 120); f.vy = -120 - Math.random() * 80; f.loose = time + 1.5; }
      }
    }
    // Shaking off leaves or snow: a quick side-to-side wobble.
    if (time < (b.shakeOffUntil || 0) && body.onFloor() && !body.grab) body.lean((Math.sin(time * 70) > 0 ? 1 : -1) * body.o.radius * 2.2 * 60 * DT, DT);
    if (body.grab) { held(b); return; }
    b.stillFor = 0;
    b.wriggling = false;
    const r = body.o.radius, c = body.centroid();
    const grounded = body.onFloor();
    // Flying: stretched out along the way it's going, more the faster.
    if (!grounded && CFG.flightStretch > 0 && !meditating(b)) {
      const v = body.velocity(DT), sp = Math.hypot(v.x, v.y);
      if (sp > 300) body.stretchToward(v.x / sp, v.y / sp, 1 + CFG.flightStretch * Math.min(1, (sp - 300) / 2200), 400, DT);
    }
    if (!grounded || b.merging || b.splitting || b.pendingHop || drag) return;
    // Talking or singing: the body bobs with its voice, rising a little on
    // each open syllable and settling between them.
    // A long turn done: up on tiptoe, a yawn, then a sway side to side.
    if (b.stretchAt && time > b.stretchAt && (b.stretchYawned || Math.hypot(body.velocity(DT).x, body.velocity(DT).y) < 60)) {
      if (!b.stretchYawned) { b.stretchYawned = true; b.stretchAt = time; b.nextHop = Math.max(b.nextHop || 0, time + 2.2); yawn(b, 1.3, 0); } // (from when it's landed)
      const t = time - b.stretchAt, k = CFG.doneStretch;
      if (t < 0.8) body.squashTop(-k * r * 0.6 * 60 * DT * Math.sin(t / 0.8 * Math.PI), DT);
      else if (t < 1.9) body.lean(Math.sin((t - 0.8) / 1.1 * Math.PI * 2) * k * r * 12 * DT, DT);
      else { b.stretchAt = 0; b.stretchYawned = false; }
    }
    if (b.talkOpen && CFG.voiceBob > 0) body.squashTop(-(b.talkOpen - 0.25) * CFG.voiceBob * r * 30 * DT, DT);
    const dx = mouse.x - c.x, dy = mouse.y - c.y, d = Math.hypot(dx, dy);
    // A cursor whizzing past makes it flinch: it ducks and leans away.
    const ms = Math.hypot(mouse.vx, mouse.vy);
    if (CFG.flinch > 0 && !lulled(b) && ms > CFG.flinchSpeed && d < r * 1.8 && !body.contains(mouse.x, mouse.y) && time > (b.flinchAt || 0)) {
      b.flinchAt = time + 1.2;
      b.startleUntil = time + 0.45;
      b.surpriseUntil = time + 0.45;
      body.lean(-(Math.sign(dx) || 1) * CFG.flinch * r * 3.2, DT);
      body.squashTop(CFG.flinch * r * 2.2, DT);
    }
    // The cursor resting on top of its head: like a cat, it pushes up into
    // your hand and shuts its eyes.
    if (CFG.headPat > 0 && !lulled(b) && !drag && body.contains(mouse.x, mouse.y) && mouse.y < c.y - r * 0.35 && performance.now() / 1000 - mouse.lastMove > 0.7) {
      b.patted = true;
      if (!b.patSince) b.patSince = time;
      const top = body.bbox().minY;
      if (mouse.y - top > r * 0.1) body.squashTop(-CFG.headPat * r * 0.6 * 60 * DT, DT);
      if (time - b.patSince > 1.5 && !b.patHeart) { b.patHeart = true; spawnHeart({ x: c.x, y: top - 6, vx: 0, born: time, size: 10 }); }
    } else { b.patSince = 0; b.patHeart = false; }
    // The cursor resting right on its face: it looks right at you; keep it
    // up and it giggles and squirms.
    const staring = CFG.shy > 0 && !lulled(b) && !drag && !b.patted && body.contains(mouse.x, mouse.y) && performance.now() / 1000 - mouse.lastMove > 0.8;
    b.stare = staring ? (b.stare || 0) + DT : Math.max(0, (b.stare || 0) - DT * 2);
    if (b.stare > 4.5 / Math.max(0.25, Math.min(1, CFG.shy))) {
      b.stare = 1.6;
      quip(b, 'hehe', 1);
      b.squirmUntil = time + 0.8;
    }
    // Only a real cause (thanked, hugged) warms its cheeks, and that fades
    // from a set start, never adding up.
    b.blush = time < (b.blushUntil || 0) ? Math.min(0.9, (b.blushUntil - time) / 1.5) : 0;
    if (time < (b.squirmUntil || 0)) body.lean(Math.sin(time * 28) * r * 30 * DT, DT);
    // Something held right over it: it hunkers down a little, bracing.
    if (heldOver(b)) body.squashTop(CFG.spectate * r * 0.5 * 60 * DT, DT);
    // ...and a slime flying right at it makes it duck.
    if (CFG.spectate > 0 && time > (b.duckAt || 0)) {
      const s = spectate(b);
      if (s && s.d < r * 1.2 && s.d > 0 && Math.hypot(s.o.vel.x, s.o.vel.y) > 700) {
        const v = s.o.vel, toward = ((c.x - s.c.x) * v.x + (c.y - s.c.y) * v.y) / Math.max(1, Math.hypot(v.x, v.y) * Math.hypot(c.x - s.c.x, c.y - s.c.y));
        if (toward > 0.3) {
          b.duckAt = time + 1;
          b.startleUntil = time + 0.4;
          body.lean((Math.sign(c.x - s.c.x) || 1) * CFG.spectate * r * 2.4, DT);
          body.squashTop(CFG.spectate * r * 3, DT);
        }
      }
    }
    if (nuzzle(b, r, c)) return;
    // A helper on its way home: its mother leans in to catch it.
    if (CFG.socialize > 0) {
      for (const k of buddies.values()) {
        if (k.mother !== b || !k.merging || k.dying) continue;
        const kc = k.body.centroid(), kx = kc.x - c.x;
        const close = 1 - ramp(Math.hypot(kx, kc.y - c.y), r * 1.5, r * 4);
        if (close > 0) { body.lean(Math.sign(kx) * close * CFG.socialize * r * 20 * DT, DT); body.impulse(-body.velocity(DT).x * 0.15, 0, DT); return; }
      }
    }
    strain(b, r);
    tapFoot(b, r);
    typeAway(b, r);
    const calm = (b.state === 'idle' || b.state === 'done') && !lulled(b) && !meditating(b) && !b.stackedBy && time > (b.pounceUntil || 0) && !playing(b);
    if (!calm) return;
    // A cursor close by: it leans over toward it, curious. Not when you're
    // on it (that's petting), and not if it's been sitting still a while.
    const near = 1 - ramp(d, r * 1.4, r * 4.5);
    const fresh = performance.now() / 1000 - mouse.lastMove < 4;
    // Its mood toward you: fond (petted lately) leans in more; grumpy
    // (poked, shaken) leans away and gives you a look.
    const mood = b.mood || 0;
    if (mood < -0.45 && near > 0.3 && fresh) { b.annoyedAt = YOU; b.annoyedUntil = time + 0.3; }
    // Really grumpy and you come close: now and then it blows you a
    // raspberry, tongue out, buzzing all over.
    if (CFG.raspberry > 0 && mood < -0.45 && near > 0.6 && fresh && time > (b.nextRasp || 0) && !b.bubble) {
      b.nextRasp = time + 3 + Math.random() * 3;
      if (Math.random() < 0.45 * CFG.raspberry) {
        b.raspUntil = time + 1.1;
        b.nextRasp = time + 8 + Math.random() * 8;
        quipBack(b, 'pbbbt!', 1.4);
      }
    }
    if (time < (b.raspUntil || 0)) {
      // A fast buzz: tiny squashes up and down.
      body.squashTop((Math.floor(time * 30) % 2 ? 1 : -1) * r * 0.25 * Math.min(1.5, CFG.raspberry) * 60 * DT, DT);
      b.annoyedAt = YOU; b.annoyedUntil = Math.max(b.annoyedUntil || 0, time + 0.2);
    }
    if (CFG.leanToCursor > 0 && near > 0 && fresh && !body.contains(mouse.x, mouse.y)) {
      const side = Math.max(-1, Math.min(1, dx / r)) * (mood < -0.3 ? -0.6 : 1 + 0.6 * Math.max(0, mood));
      body.lean(side * near * CFG.leanToCursor * trait(b, 'curious') * r * 25 * DT, DT);
      // Its bottom grips the floor, so leaning doesn't scoot it along.
      body.impulse(-body.velocity(DT).x * 0.15, 0, DT);
      // Above it: it reaches up a little, too.
      if (dy < -r) body.squashTop(-near * CFG.leanToCursor * r * 14 * DT, DT);
      return;
    }
    if (chat(b, r, c)) return;
    fidget(b, r);
  }

  // Two calm slimes sitting together now and then have a little chat: they
  // look at each other and take turns, the one talking bobbing and leaning
  // in, the other leaning in a little to listen.
  // In the middle of a game or a trick (which moves it itself): no chatting,
  // leaning over to the cursor or fidgeting then.
  const playing = (o) => !!(o.rope || o.seek || o.pile || o.tower || o.frog || o.tag || o.parade || o.trick || o.keepy || o.measure || o.roll || o.skate || o.balloon || o.shape || o.tot || o.snow || o.comforting || o.prank);
  function chat(b, r, c) {
    if (CFG.socialize <= 0) return false;
    const ch = b.chat;
    if (ch) {
      const o = ch.a === b ? ch.b : ch.a;
      if (time > ch.until || o.dying || o.body.grab || !o.body.onFloor() || o.chat !== ch || playing(o)) { b.chat = null; return false; }
      const side = Math.sign(o.body.centroid().x - c.x) || 1;
      const speaker = Math.floor((time - ch.from) / ch.turn) % 2 === (ch.a === b ? 0 : 1);
      const k = CFG.socialize * r * DT;
      b.body.lean(side * (speaker ? 14 : 6) * k, DT);
      b.body.impulse(-b.body.velocity(DT).x * 0.15, 0, DT); // feet planted
      if (speaker) b.body.squashTop(Math.sin((time - ch.from) * 14) * 18 * k, DT);
      b.glanceAt = o;
      b.glanceUntil = time + 0.2;
      return true;
    }
    if (time < (b.nextChat || 0)) return false;
    b.nextChat = time + (6 + Math.random() * 10) / CFG.socialize;
    if (Math.random() > 0.4 * trait(b, 'curious')) return false;
    for (const o of buddies.values()) {
      if (o === b || o.dying || o.chat || o.body.grab || !o.body.onFloor() || !(o.state === 'idle' || o.state === 'done') || playing(o)) continue;
      const oc = o.body.centroid();
      if (Math.hypot(oc.x - c.x, oc.y - c.y) > (r + o.body.o.radius) * 1.7) continue;
      b.chat = o.chat = { a: b, b: o, from: time, until: time + 3 + Math.random() * 3, turn: 0.7 + Math.random() * 0.5 };
      return true;
    }
    return false;
  }

  // --- Bubbles ---------------------------------------------------------------
  // A bored slime now and then blows a bubble: it breathes
  // in, puffs one out of its mouth, and watches it float off. Run the cursor
  // into one and it pops (the slime giggles); a nearby slime might hop up to
  // pop it first.
  const bubbles = [], pops = [];
  // Keepy-uppy: a bored slime has its task pet hop up onto its head, then
  // bounces it up and catches it, again and again, counting ("1!", "2!",
  // "3!"), until it misses or decides that's a record.
  function keepy(b) {
    if (CFG.keepy <= 0 || b.kind !== 'mother') return;
    const k = b.keepy, ok = (b.state === 'idle' || b.state === 'done') && !b.body.grab && !b.merging && !b.dying && !b.tower && !b.rope && !b.seek && !b.pile && !b.frog && !b.tag && !b.parade && !b.trick && (b.sleep || 0) < 0.1 && b !== buddies.get(talkingTo);
    if (k) {
      const p = k.pet;
      const stop = (word) => { b.keepy = null; if (p.ride === b) p.rideUntil = time + 1; p.rideOn = null; if (word) quip(b, word, 1.2); };
      if (!ok || p.dying || p.held || !pets.has(p.key) || drag || time - k.start > 25) { stop(); return; }
      b.nextHop = time + 1; b.happyUntil = time + 0.3;
      if (p.ride === b) {
        p.rideUntil = time + 5;
        if (!k.caughtAt) {
          k.caughtAt = time;
          if (k.n > 0) quip(b, k.n + '!', 0.7);
          if (k.n >= k.max) { stop(); b.cheerUntil = time + 1.2; spawnHeart({ x: p.x, y: p.y - petSize(), vx: 0, born: time, size: 10 }); return; }
        }
        // A beat to line up, then a crouch, then pop: the pet flies up.
        const t = time - k.caughtAt, r = b.body.o.radius;
        if (t > 0.35 && !k.crouched) { k.crouched = true; b.body.squashTop(r * 3 * Math.min(1.5, CFG.keepy), DT); }
        if (t > 0.5) {
          b.body.squashTop(-r * 5 * Math.min(1.5, CFG.keepy), DT);
          p.ride = null; p.rideOn = b; p.rideAt = time;
          p.vy = -(560 + Math.random() * 140); p.vx = (b.body.centroid().x - p.x) * 2 + (Math.random() - 0.5) * 40 + (Math.random() < 0.12 ? (Math.random() < 0.5 ? -1 : 1) * (200 + Math.random() * 100) : 0); p.va = (Math.random() - 0.5) * 8; // (now and then one goes wild)
          p.nextHop = time + 1.5;
          k.n++; k.caughtAt = 0; k.crouched = false;
        }
        return;
      }
      if (p.rideOn === b && time - p.rideAt > 0.4 && p.vy === 0) p.rideOn = null; // (landed on the floor)
      if (p.rideOn === b) {
        // In the air: it shuffles under it to catch it.
        const dx = p.x - b.body.centroid().x;
        if (b.body.onFloor() && p.vy > 0) b.body.impulse((dx * 6 - b.body.velocity(DT).x) * 0.15, 0, DT);
        return;
      }
      // Missed: down on the floor.
      if (k.n > 0) { stop(k.n >= 3 ? 'aw, ' + k.n + '!' : 'aw'); return; }
      if (time - k.start > 4) stop();
      return;
    }
    if (!ok || !b.body.onFloor() || idleFor() > 60 || time < (b.nextKeepy ?? (b.nextKeepy = time + (120 + Math.random() * 300) / CFG.keepy))) return;
    b.nextKeepy = time + (300 + Math.random() * 500) / CFG.keepy;
    const c = b.body.centroid(), p = [...pets.values()].find((p) => p.owner === b && !p.dying && !p.held && !p.ride && !p.rideOn && p.vy === 0 && Math.abs(p.x - c.x) < b.body.o.radius * 2.5);
    if (p) keepyNow(b, p);
  }
  function keepyNow(b, p) {
    const PET = petSize(), ob = b.body, top = ob.bbox().minY, c = ob.centroid();
    const up = Math.sqrt(2 * CFG.gravity * Math.max(PET, p.y - top + PET * 1.2)), air = up / CFG.gravity * 1.6;
    p.vx = (c.x - p.x) / air; p.vy = -up; p.va = Math.sign(p.vx || 1) * 2;
    p.rideOn = b; p.rideAt = time; p.nextHop = time + 1.5;
    b.keepy = { pet: p, n: 0, max: 3 + Math.floor(Math.random() * 5), start: time, caughtAt: 0 };
  }

  function blow(b) {
    if (CFG.bubbles <= 0 || b.kind === 'child' || b.dying) return;
    const ok = (b.state === 'idle' || b.state === 'done') && !b.body.grab && !b.merging && !b.prank && !b.trick && !b.tag && !b.sneeze && (b.sleep || 0) < 0.1 && idleFor() < 60 && b !== buddies.get(talkingTo);
    const g = b.blow;
    if (g) {
      if (!ok) { if (g.bubble) g.bubble.free = true; b.blow = null; return; }
      const body = b.body, r = body.o.radius, c = body.centroid();
      if (time < g.at) { if (body.onFloor()) body.squashTop(-r * 0.1 * 60 * DT * 60 * DT, DT); return; } // breathing in
      const mx = c.x + (b.faceTurn ? b.faceTurn.x : 0) + g.side * r * 0.08, my = c.y + r * 0.12;
      if (!g.bubble) { g.bubble = { x: mx, y: my, vx: 0, vy: 0, r: 2, size: r * (0.18 + Math.random() * 0.14), born: time, owner: b, free: false }; bubbles.push(g.bubble); }
      const u = g.bubble, k = Math.min(1, (time - g.at) / 0.9);
      if (!u.free) {
        // Swelling out in front of its mouth, like bubblegum.
        u.r = Math.max(2, u.size * k);
        u.x = mx; u.y = my + u.r * 0.3;
        if (body.onFloor()) body.squashTop(r * 0.04 * 60 * DT, DT);
        if (k >= 1) { u.free = true; u.vx = g.side * (20 + Math.random() * 25); u.vy = -50 - Math.random() * 30; u.born = time; }
        return;
      }
      // Watching it go.
      b.glanceAt = { spot: u }; b.glanceUntil = time + 0.2;
      if (u.popped || time - u.born > 2.5) b.blow = null;
      return;
    }
    if (!ok || !b.body.onFloor() || time < (b.nextBlow ?? (b.nextBlow = time + (120 + Math.random() * 300) / CFG.bubbles))) return;
    b.nextBlow = time + (240 + Math.random() * 480) / CFG.bubbles;
    b.blow = { at: time + 0.7, side: Math.random() < 0.5 ? -1 : 1 };
  }
  function popBubble(u, by) {
    u.popped = true;
    pops.push({ x: u.x, y: u.y, r: u.r, born: time, color: u.owner.color });
    const o = u.owner;
    if (by && !o.dying) { o.happyUntil = time + 1.4; if (Math.random() < 0.5) { if (by === 'you') quipBack(o, 'hehe', 1); else quip(o, 'pop!', 1); } }
    if (by && by !== 'you' && !by.dying) by.happyUntil = time + 1.4;
  }
  function stepBubbles() {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const u = bubbles[i];
      if (u.popped) { bubbles.splice(i, 1); continue; }
      if (!u.free) { if (u.owner.dying || !u.owner.blow) u.free = true; continue; }
      const age = time - u.born;
      // Barely heavier than air: it drifts up, wanders and slows.
      u.vy += (-30 + Math.sin(age * 1.7 + u.size) * 14) * DT;
      u.vx += Math.sin(age * 1.1 + u.size * 3) * 12 * DT;
      u.vx *= 1 - 0.6 * DT; u.vy *= 1 - 0.6 * DT;
      u.x += u.vx * DT; u.y += u.vy * DT;
      if (age > 6 + u.size / 8 || u.y < u.r || u.x < u.r || u.x > W - u.r) { popBubble(u, null); continue; }
      if (Math.hypot(mouse.x - u.x, mouse.y - u.y) < u.r + 4 && performance.now() / 1000 - mouse.lastMove < 0.5) { popBubble(u, 'you'); continue; }
      for (const o of buddies.values()) {
        if (o.dying || (o === u.owner && !u.away)) continue;
        const bb = o.body.bbox();
        if (u.x < bb.minX - u.r || u.x > bb.maxX + u.r || u.y < bb.minY - u.r || u.y > bb.maxY + u.r) continue;
        if (o.body.contains(u.x, u.y + u.r) || o.body.contains(u.x, u.y - u.r) || o.body.contains(u.x - u.r, u.y) || o.body.contains(u.x + u.r, u.y)) { popBubble(u, o === u.owner ? null : o); break; }
      }
      if (u.popped) continue;
      if (!u.away && !u.owner.body.contains(u.x, u.y + u.r) && !u.owner.body.contains(u.x, u.y)) u.away = true;
      // A bored slime nearby might jump up at it.
      if (!u.chased && age > 0.8) {
        for (const o of buddies.values()) {
          if (o === u.owner || o.kind === 'child' || o.dying || o.state !== 'idle' || o.body.grab || !o.body.onFloor() || o.tag || o.prank || o.blow) continue;
          const c = o.body.centroid(), r = o.body.o.radius, up = c.y - u.y;
          if (Math.abs(u.x - c.x) > r * 2 || up < r * 1.2 || up > r * 5) continue;
          u.chased = true;
          if (Math.random() > 0.5 * CFG.bubbles) break;
          // Aim to meet it on the way up.
          const vy = Math.sqrt(2 * CFG.gravity * (up - r * 0.6)), air = vy / CFG.gravity;
          o.hop((u.x + u.vx * air - c.x) / air, -vy);
          o.glanceAt = { spot: u }; o.glanceUntil = time + 1.5;
          break;
        }
      }
    }
    for (let i = pops.length - 1; i >= 0; i--) if (time - pops[i].born > (pops[i].life || 0.3)) pops.splice(i, 1);
  }
  function drawBubbles() {
    // Fast asleep, it blows a bubble at its mouth that swells and shrinks
    // with each breath.
    for (const b of buddies.values()) {
      const deep = CFG.snoreBubble > 0 && !b.dying && !b.body.grab && b.body.o.radius > 12 ? ramp(b.sleep || 0, 0.6, 0.9) : 0;
      if (deep <= 0) { if (b.snore && (b.sleep || 0) < 0.6) b.snore = null; continue; }
      const c = b.body.centroid(), r = b.body.o.radius, side = b.key.length % 2 ? 1 : -1;
      const breath = 0.5 + 0.5 * Math.sin(time * b.breathRate + b.breathPhase);
      const u = b.snore = { x: c.x + (b.faceTurn ? b.faceTurn.x : 0) + side * r * 0.16, y: c.y + r * 0.08, r: r * 0.17 * CFG.snoreBubble * deep * (0.3 + 0.7 * breath) };
      u.x += side * u.r * 0.8;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(u.x, u.y, u.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(u.x - u.r * 0.38, u.y - u.r * 0.4, u.r * 0.2, u.r * 0.12, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (const u of bubbles) {
      if (u.popped) continue;
      const wob = Math.sin((time - u.born) * 6 + u.size) * 0.06;
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.scale(1 + wob, 1 - wob);
      // Its own colour, stretched thin: paler, and see-through.
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = u.owner.color;
      ctx.beginPath(); ctx.arc(0, 0, u.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fff';
      ctx.fill();
      // A little shine.
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(-u.r * 0.38, -u.r * 0.4, u.r * 0.2, u.r * 0.12, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (const p of pops) {
      // Popped: a ring of little flecks flying out.
      const k = (time - p.born) / (p.life || 0.3);
      if (k < 0) continue;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let j = 0; j < 8; j++) {
        const a = j / 8 * Math.PI * 2, r0 = p.r * (0.8 + k * 0.8), r1 = r0 + 4 + p.r * 0.2;
        ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0); ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // --- Seasons --------------------------------------------------------------
  // Autumn leaves (late September to November) and snow (December to
  // February) drift down now and then. They settle on the slimes' heads and
  // on the ground; a slime that moves sheds them, and one that's collected a
  // few gives a little shake to get them off.
  const flakes = [];
  let seasonOverride = null; // (dev: force 'leaves', 'petals', 'summer', 'snow' or 'none')
  function season() {
    if (seasonOverride) return seasonOverride;
    const d = new Date(), m = d.getMonth(), day = d.getDate();
    if (m === 11 || m <= 1) return 'snow';
    if ((m === 8 && day >= 22) || m === 9 || m === 10) return 'leaves';
    if ((m === 2 && day >= 20) || m === 3 || m === 4) return 'petals';
    if (m >= 5 && m <= 7) return 'summer';
    return 'none';
  }
  const LEAF_COLORS = ['#d9822b', '#c4572a', '#e0a53a', '#a8643a'];
  const PETAL_COLORS = ['#f6c6d4', '#f2b0c4', '#fbe0e8', '#efa3bb'];

  // How high its middle sits when it's lying on something.
  const rest = (f) => (f.kind === 'snow' ? f.size * 0.9 : f.size * 0.5);

  function stepSeason() {
    const kind = CFG.seasons > 0 || showingOff ? season() : 'none';
    if (kind !== 'none' && kind !== 'summer' && flakes.length < 80) {
      const rate = Math.max(CFG.seasons, showingOff ? 3 : 0) * (kind === 'snow' ? 0.9 : kind === 'petals' ? 0.6 : 0.3) * (W / 1600);
      if (Math.random() < rate * DT) {
        const snow = kind === 'snow';
        flakes.push({ kind, x: Math.random() * W, y: -10, vx: 0, vy: snow ? 40 : 60, drift: (Math.random() - 0.5) * 30, sway: Math.random() * 6.28,
          size: snow ? 2 + Math.random() * 2.5 : kind === 'petals' ? 6 + Math.random() * 2.5 : 7 + Math.random() * 4, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 3,
          color: snow ? null : (kind === 'petals' ? PETAL_COLORS : LEAF_COLORS)[Math.floor(Math.random() * 4)], on: null, landed: 0 });
      }
    }
    if (!flakes.length) return;
    // The cursor swept through them stirs them up too.
    const ms = Math.hypot(mouse.vx, mouse.vy);
    if (ms > 250) {
      for (const f of flakes) {
        if (f.on || Math.abs(f.x - mouse.x) > 28 || Math.abs(f.y - mouse.y) > 28) continue;
        f.landed = 0; f.loose = time + 0.6;
        f.vx = mouse.vx * (0.4 + Math.random() * 0.3);
        f.vy = Math.min(mouse.vy * 0.4, 0) - 80 - Math.random() * 100;
        f.va = (Math.random() - 0.5) * 12;
      }
    }
    // Batted by a pet: off it flies.
    if (pets.size) {
      const PET = petSize();
      for (const p of pets.values()) for (const f of flakes) {
        if (f.on || f.landed || Math.abs(f.x - p.x) > PET * 0.7 || Math.abs(f.y - (p.y - PET * 0.3)) > PET * 0.7) continue;
        f.vx = (f.x - p.x) * 6 + p.vx * 0.3; f.vy = -180 - Math.random() * 80; f.va = (Math.random() - 0.5) * 14; f.loose = time + 0.8;
      }
    }
    const boxes = [...buddies.values()].filter((b) => !b.dying && !b.body.grab).map((b) => [b, b.body.bbox()]);
    for (let k = flakes.length - 1; k >= 0; k--) {
      const f = flakes[k];
      if (f.eaten) continue; // (on its way into a mouth)
      if (f.on) {
        const b = f.on.b, body = b.body, i = f.on.i;
        const v = b.vel || { x: 0, y: 0 }, c = body.centroid();
        // Shed: moving fast, picked up, gone, or rolled round underneath.
        if (b.dying || b.removed || body.grab || Math.hypot(v.x, v.y) > 380 || body.py[i] > c.y - body.o.radius * 0.2) {
          f.on = null; f.vx = v.x * 0.6 + (body.px[i] - c.x) * 2; f.vy = Math.min(v.y * 0.6, -60); f.landed = 0; f.loose = time + 0.8;
          continue;
        }
        f.x = body.px[i] + f.on.dx; f.y = body.py[i] - f.size * 0.4;
        continue;
      }
      if (f.landed) {
        if (time - f.landed > (f.kind === 'snow' ? 8 : 12)) flakes.splice(k, 1);
        else if (f.ledge) {
          // Lying on a window: it rides along, and falls when the window goes.
          let l = null;
          for (const m of ledges) if (m.id === f.ledge.id && (!l || Math.abs(m.y - f.y) < Math.abs(l.y - f.y))) l = m;
          if (!l || Math.abs(l.y - rest(f) - f.y) > 40) { f.landed = 0; f.vy = 0; f.ledge = null; }
          else { f.x = l.x0 + f.ledge.dx; f.y = l.y - rest(f); }
        } else if (floorAt(f.x, f.y) > f.y + f.size) { f.landed = 0; f.vy = 0; }
        continue;
      }
      // Falling: drifting and swaying (leaves see-saw more), easing to their
      // own slow fall after being knocked off.
      f.sway += DT * (f.kind === 'snow' ? 1.3 : 2.2);
      const fall = f.kind === 'snow' ? 45 : f.kind === 'petals' ? 50 : 70;
      if (time < (f.loose || 0)) f.vy = Math.min(fall * 3, f.vy + 700 * DT); // knocked: a real little arc
      else f.vy += (fall - f.vy) * 2 * DT;
      f.vx += (f.drift + Math.sin(f.sway) * (f.kind === 'snow' ? 18 : 55) - f.vx) * (time < (f.loose || 0) ? 0.4 : 2) * DT; // (knocked off: it keeps going a while)
      f.x += f.vx * DT; f.y += f.vy * DT;
      f.a += f.va * DT * (f.kind === 'snow' ? 0 : 1 + Math.abs(Math.sin(f.sway)));
      if (f.x < -20 || f.x > W + 20) { flakes.splice(k, 1); continue; }
      // On a slime's head: stick to the nearest point of its skin.
      let stuck = false;
      for (const [b, box] of boxes) {
        if (f.vy < 0 || time < (f.loose || 0)) break;
        const body = b.body;
        if (f.x < box.minX || f.x > box.maxX || f.y < box.minY - 2 || f.y > box.maxY) continue;
        if (!body.contains(f.x, f.y + 3)) continue;
        let best = 0, bd = Infinity;
        for (let i = 0; i < body.n; i++) { const d = (body.px[i] - f.x) ** 2 + (body.py[i] - f.y) ** 2; if (d < bd) { bd = d; best = i; } }
        if (body.py[best] > body.centroid().y - body.o.radius * 0.2) continue; // its side: slides past
        f.on = { b, i: best, dx: (Math.random() - 0.5) * 4 };
        // A leaf on the nose now and then makes it sneeze; snow, shiver.
        if (Math.random() < 0.08 * CFG.seasons && !b.sneeze && time > (b.shakeOffUntil || 0) + 2) {
          if (f.kind === 'snow') b.shakeOffUntil = time + 0.4;
          else b.sneeze = { at: time + 0.7 };
        }
        stuck = true;
        break;
      }
      if (stuck) continue;
      const floor = floorAt(f.x, f.y);
      if (f.y >= floor - rest(f)) {
        f.y = floor - rest(f); f.landed = time;
        f.a = Math.round(f.a / Math.PI) * Math.PI + (Math.random() - 0.5) * 0.3; // a leaf comes to rest lying flat
        const l = ledges.find((m) => m.y === floor && f.x >= m.x0 && f.x <= m.x1);
        f.ledge = l ? { id: l.id, dx: f.x - l.x0 } : null;
      }
    }
    // Collected a few: a shake to get them off.
    for (const b of buddies.values()) {
      if (b.dying || !b.body.onFloor() || b.body.grab || time < (b.nextShakeOff || 0)) continue;
      let n = 0;
      for (const f of flakes) if (f.on && f.on.b === b) n++;
      if (n < 4) continue;
      b.nextShakeOff = time + 3 + Math.random() * 5;
      if (Math.random() < 0.5) continue;
      b.shakeOffUntil = time + 0.55;
      for (const f of flakes) if (f.on && f.on.b === b) { const c = b.body.centroid(); f.on = null; f.vx = (Math.sign(f.x - c.x) || 1) * (110 + Math.random() * 90); f.vy = -90 - Math.random() * 60; f.loose = time + 1.5; }
    }
  }

  // Leaves (or snow) on the ground fly up when a slime lands among them,
  // and get pushed along by one sliding through.
  function stirFlakes(b, v) {
    const body = b.body, hit = body.lastImpact || 0, slide = body.onFloor() ? Math.abs(v.x) : 0;
    if (hit < 250 && slide < 60) return;
    const box = body.bbox(), c = body.centroid(), r = body.o.radius;
    for (const f of flakes) {
      if (!f.landed || Math.abs(f.y - box.maxY) > 24) continue;
      if (hit >= 250 && f.x > box.minX - r * 0.6 && f.x < box.maxX + r * 0.6) {
        f.landed = 0; f.loose = time + 0.6;
        f.vx = (Math.sign(f.x - c.x) || 1) * (80 + Math.random() * hit * 0.2);
        f.vy = -(150 + Math.random() * hit * 0.25);
      } else if (slide >= 60 && f.x > box.minX - 4 && f.x < box.maxX + 4 && Math.sign(f.x - c.x) === Math.sign(v.x)) {
        f.landed = 0; f.loose = time + 0.4;
        f.vx = v.x * (1.1 + Math.random() * 0.4);
        f.vy = -(40 + Math.random() * 60);
      }
    }
  }

  // (Lying on the ground they're drawn first, behind the slimes; falling
  // or on a head, after.)
  function drawSeason(ground) {
    for (const f of flakes) {
      if (!!f.landed !== ground) continue;
      const fade = f.landed ? Math.max(0, Math.min(1, ((f.kind === 'snow' ? 8 : 12) - (time - f.landed)) / 1.5)) : 1;
      if (fade <= 0) continue;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(f.x, f.y);
      if (f.kind === 'snow') {
        // White with a faint edge, so it shows on a white desktop too.
        ctx.fillStyle = '#f7faff';
        ctx.strokeStyle = 'rgba(60, 80, 110, 0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, f.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (f.kind === 'petals') {
        // A cherry blossom petal: a rounded teardrop with a notch at the tip.
        ctx.rotate(f.a);
        ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(f.sway))); // (tumbling)
        const z = f.size;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.moveTo(-z, 0);
        ctx.quadraticCurveTo(-z * 0.2, -z * 0.95, z * 0.9, -z * 0.45);
        ctx.lineTo(z * 0.6, 0);
        ctx.lineTo(z * 0.9, z * 0.45);
        ctx.quadraticCurveTo(-z * 0.2, z * 0.95, -z, 0);
        ctx.fill();
      } else {
        ctx.rotate(f.a);
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, f.size, f.size * 0.48, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(80, 40, 20, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-f.size * 1.25, 0);
        ctx.lineTo(f.size * 0.8, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Summer: now and then a butterfly flutters by and lands on a slime's
  // head. The slime goes still and cross-eyed looking up at it; it flies
  // off when the slime moves or the cursor comes close, and a curious slime
  // may hop up at one going past.
  const flutters = [];
  const WING_COLORS = ['#f2c14e', '#7fb3e6', '#f08aa5', '#f5f0e6'];
  // The week up to Halloween, a little bat flits across now and then
  // instead (it never lands).
  const spooky = () => { const d = new Date(); return holiday === 'halloween' || (d.getMonth() === 9 && d.getDate() >= 24); };
  function addFlutter(bat) {
    const left = Math.random() < 0.5;
    flutters.push({ bat: !!bat, x: left ? -20 : W + 20, y: H * (0.35 + Math.random() * 0.35), vx: 0, vy: 0, phase: Math.random() * 6, color: WING_COLORS[Math.floor(Math.random() * WING_COLORS.length)],
      to: { x: W * (0.2 + Math.random() * 0.6), y: H * (0.3 + Math.random() * 0.4) }, on: null, born: time, perches: 0, leaveAt: time + 40 + Math.random() * 30, rest: 0 });
  }
  function stepFlutters() {
    if ((CFG.seasons > 0 && season() === 'summer') && flutters.length < 2 && Math.random() < CFG.seasons * DT / 50) addFlutter();
    if (CFG.seasons > 0 && spooky() && flutters.length < 2 && Math.random() < CFG.seasons * DT / 90) addFlutter(true);
    for (let i = flutters.length - 1; i >= 0; i--) {
      const u = flutters[i];
      const ms = Math.hypot(mouse.vx, mouse.vy), near = Math.hypot(mouse.x - u.x, mouse.y - u.y) < 60 && ms > 30;
      if (u.on) {
        const b = u.on.b, body = b.body;
        const v = body.velocity(DT);
        if (b.dying || body.grab || Math.hypot(v.x, v.y) > 90 || near || time > u.rest) {
          // Off it goes, up and away.
          u.on = null; u.vy = -120; u.vx = (Math.random() - 0.5) * 160;
          u.to = { x: u.x + (Math.random() - 0.5) * W * 0.5, y: Math.max(40, u.y - 150 - Math.random() * 120) };
          u.cool = time + 3;
          if (!b.dying) { b.glanceAt = { spot: u }; b.glanceUntil = time + 1.5; }
          continue;
        }
        let top = 0;
        for (let k = 0; k < body.n; k++) if (body.py[k] < body.py[top]) top = k;
        u.x = body.px[top] + u.on.dx; u.y = body.py[top] - 3;
        u.phase += DT * (Math.sin(time * 0.7 + u.color.length) > 0.6 ? 14 : 2); // (a slow open and close, now and then a flutter)
        b.glanceAt = { spot: { x: u.x, y: u.y } }; b.glanceUntil = time + 0.2;
        b.nextHop = Math.max(b.nextHop || 0, time + 0.5); // (holding still)
        continue;
      }
      u.phase += DT * (u.bat ? 30 : 22);
      // Wandering flight: steer at a spot, with a bob on every wingbeat.
      const dx = u.to.x - u.x, dy = u.to.y - u.y, d = Math.hypot(dx, dy) || 1;
      u.vx += (dx / d * 90 - u.vx) * 1.5 * DT + (Math.random() - 0.5) * 300 * DT;
      u.vy += (dy / d * 90 - u.vy) * 1.5 * DT + Math.sin(u.phase) * 260 * DT;
      if (near) { u.vx += Math.sign(u.x - mouse.x) * 900 * DT; u.vy -= 600 * DT; }
      u.x += u.vx * DT; u.y += u.vy * DT;
      if (time > u.leaveAt) { u.to = { x: u.x < W / 2 ? -100 : W + 100, y: u.y - 100 }; if (u.x < -60 || u.x > W + 60 || u.y < -60) { flutters.splice(i, 1); continue; } }
      else if (d < 30 && u.bat) u.to = { x: Math.max(60, Math.min(W - 60, u.x + (Math.random() - 0.5) * 700)), y: H * (0.1 + Math.random() * 0.4) };
      else if (d < 30) {
        // Somewhere new, or a calm slime's head to rest on.
        const calm = [...buddies.values()].filter((b) => !b.dying && !b.body.grab && b.body.onFloor() && b.body.o.radius > 20 && !flutters.some((o) => o.on && o.on.b === b) && (b.state !== 'working' || Math.random() < 0.3));
        const b = time > (u.cool || 0) && Math.random() < 0.6 && calm[Math.floor(Math.random() * calm.length)];
        if (b) { const bb = b.body.bbox(); u.to = { x: (bb.minX + bb.maxX) / 2, y: bb.minY - 4, b }; }
        else u.to = { x: Math.max(60, Math.min(W - 60, u.x + (Math.random() - 0.5) * 500)), y: H * (0.25 + Math.random() * 0.45) };
      } else if (u.to.b && d < 50) {
        const b = u.to.b, bb = b.body.bbox();
        if (flutters.some((o) => o.on && o.on.b === b)) u.to = { x: u.x + (Math.random() - 0.5) * 300, y: H * 0.4 }; // (taken)
        else if (Math.abs(u.x - (bb.minX + bb.maxX) / 2) < b.body.o.radius * 0.5 && Math.abs(u.y - bb.minY) < 30) {
          u.on = { b, dx: (Math.random() - 0.5) * b.body.o.radius * 0.3 };
          u.rest = time + 6 + Math.random() * 10;
          u.perches++;
          b.happyUntil = time + 1;
          continue;
        } else u.to = { x: (bb.minX + bb.maxX) / 2, y: bb.minY - 4, b };
      }
      // A bored slime might hop up at one going by, close overhead.
      for (const b of buddies.values()) {
        if (b.kind === 'child' || b.state !== 'idle' || b.dying || b.body.grab || !b.body.onFloor() || time < (b.nextSwat || 0)) continue;
        const c = b.body.centroid(), r = b.body.o.radius, up = c.y - u.y;
        if (Math.abs(u.x - c.x) > r * 1.5 || up < r * 1.5 || up > r * 3.5) continue;
        b.nextSwat = time + 20 + Math.random() * 30;
        if (Math.random() > 0.4) continue;
        b.hop((u.x - c.x) * 1.5, -Math.sqrt(2 * CFG.gravity * (up - r * 0.5)));
        b.glanceAt = { spot: u }; b.glanceUntil = time + 1.5;
      }
    }
  }
  function drawFlutters() {
    for (const u of flutters) {
      const open = Math.abs(Math.cos(u.phase)), facing = u.on ? 1 : Math.sign(u.vx) || 1;
      if (u.bat) {
        // A little bat: scalloped wings flapping up and down.
        const flap = Math.sin(u.phase);
        ctx.save();
        ctx.translate(u.x, u.y);
        ctx.scale(1.6, 1.6);
        ctx.fillStyle = '#3b3346';
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(side * 2, -1);
          ctx.lineTo(side * 7, -4 - flap * 5);
          ctx.lineTo(side * 12, -1 - flap * 6);
          ctx.quadraticCurveTo(side * 10, 1 - flap * 3, side * 8.5, 2 - flap * 2.5);
          ctx.quadraticCurveTo(side * 6.5, 1 - flap, side * 5, 3 - flap);
          ctx.quadraticCurveTo(side * 3.5, 2, side * 2, 2.5);
          ctx.fill();
        }
        ctx.beginPath(); ctx.ellipse(0, 0.5, 2.6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-2.2, -1.5); ctx.lineTo(-1.6, -4.5); ctx.lineTo(-0.6, -2.2); ctx.moveTo(2.2, -1.5); ctx.lineTo(1.6, -4.5); ctx.lineTo(0.6, -2.2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(-1.4, -0.6, 0.9, 0.9); ctx.fillRect(0.5, -0.6, 0.9, 0.9);
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.translate(u.x, u.y - (u.on ? 6 : 0));
      ctx.scale(facing * 1.8, 1.8);
      ctx.fillStyle = u.color;
      ctx.strokeStyle = 'rgba(40, 30, 30, 0.35)';
      ctx.lineWidth = 1;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.scale(side * (0.15 + 0.85 * open), 1);
        ctx.beginPath(); ctx.ellipse(5, -5, 6, 4.5, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(4, 2.5, 4, 3, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = '#2b2730';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 5); ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-2, -9); ctx.moveTo(0, -5); ctx.lineTo(2, -9); ctx.stroke();
      ctx.restore();
    }
  }

  // A thump travels: a slime landing hard sets any slime it's touching
  // jiggling too (from the top, as if the ground shook under it).
  function passJiggle(b, impact) {
    if (time < (b.jiggledAt || 0)) return;
    b.jiggledAt = time + 0.25;
    const bb = b.body.bbox();
    for (const o of buddies.values()) {
      if (o === b || o.dying || o.body.grab) continue;
      const ob = o.body.bbox();
      if (ob.maxX < bb.minX - 4 || ob.minX > bb.maxX + 4 || ob.maxY < bb.minY - 4 || ob.minY > bb.maxY + 4) continue;
      o.body.squashTop(CFG.contactJiggle * Math.min(1, impact / 2500) * o.body.o.radius * 4, DT);
      o.jiggledAt = time + 0.25; // and it doesn't echo straight back
    }
  }

  // Working hard: while a tool runs, now and then it tenses up and shivers
  // for a moment, a quick side-to-side tremble through its body.
  // Struggling: errors keep coming (failed tools or tests, several in a
  // couple of minutes with nothing going right). It gets steamed up, little
  // puffs rising off its head and a cross face, so you can tell at a glance
  // which session is going round in circles. A green run or the turn
  // ending calms it down.
  function struggle(b, n) {
    if (CFG.stuckAfter <= 0) return;
    b.fails = (b.fails || []).filter((t) => time - t < 120);
    for (let i = 0; i < n; i++) b.fails.push(time);
    if (!b.stuck && b.fails.length >= CFG.stuckAfter) {
      b.stuck = { since: time };
      quip(b, 'ugh, keeps failing', 2.5);
    }
  }
  function fume(b) {
    if (!b.stuck) return;
    const last = b.fails[b.fails.length - 1] || 0;
    if (b.state !== 'working' || time - last > 120) { b.stuck = null; b.fails = []; return; }
    const body = b.body, r = body.o.radius;
    if (time > (b.nextPuff || 0)) {
      b.nextPuff = time + 0.45 + Math.random() * 0.5;
      const c = body.centroid(), top = body.bbox().minY, side = Math.random() < 0.5 ? -1 : 1;
      spawnHeart({ puff: true, x: c.x + side * r * (0.25 + Math.random() * 0.3), y: top + 4, vx: side * (8 + Math.random() * 18), rise: 30 + Math.random() * 20, born: time, size: r * (0.08 + Math.random() * 0.05) });
      // ...and it huffs: a little squash with each puff.
      if (body.onFloor() && !body.grab) body.squashTop(r * 0.9, DT);
    }
  }

  // One tool running a long while (a slow build, a long test run): it waits
  // patiently, tapping a foot.
  function tapFoot(b, r) {
    const src = b.kind === 'child' ? b.agent : b.session;
    b.tapping = CFG.tapAfter > 0 && b.state === 'working' && src && src.activity === 'tool' && time - (b.toolSince ?? time) > CFG.tapAfter && !meditating(b);
    if (!b.tapping || time < (b.nextTap || 0)) return;
    b.nextTap = time + 0.6;
    const side = b.key.length % 2 ? 1 : -1, c = b.body.centroid(), bot = b.body.bbox().maxY;
    b.body.pushAt(c.x + side * r * 0.55, bot, 0, 200, r * 0.32, DT);
  }

  // Editing, it types: soft little dips of its top, in short bursts with
  // pauses between (a few a second at most: any faster read as buzzing).
  function typeAway(b, r) {
    if (CFG.workLife <= 0 || b.state !== 'working' || meditating(b) || activityOf(b) !== 'edit' || time < (b.nextKey || 0)) return;
    const burst = Math.sin(time * 0.5 + (b.breathPhase || 0)) > 0.3; // (pauses between bursts)
    b.nextKey = time + (burst ? 0.25 + Math.random() * 0.15 : 0.5);
    if (burst) b.body.squashTop(r * 0.8 * Math.min(1.5, CFG.workLife), DT);
  }

  function strain(b, r) {
    if (CFG.strain <= 0 || b.state !== 'working' || meditating(b)) return;
    const src = b.kind === 'child' ? b.agent : b.session;
    if (!src || src.activity !== 'tool') { b.strainUntil = 0; return; }
    // Now and then, not all the time: a short, small shiver every 8-18 s.
    if (time > (b.nextStrain || 0)) {
      if (b.nextStrain) b.strainUntil = time + 0.35 + Math.random() * 0.25;
      b.nextStrain = time + 8 + Math.random() * 10;
    }
    if (time < (b.strainUntil || 0) && time > (b.strainFlip || 0)) {
      b.strainFlip = time + 1 / 15;
      b.strainDir = -(b.strainDir || 1);
      b.body.lean(b.strainDir * CFG.strain * r * 0.6, DT);
    }
  }

  // A helper resting against its mother (both on the ground) now and then
  // nuzzles her: it leans into her and rubs back and forth, she leans
  // back, and they both end up happy.
  function nuzzle(b, r, c) {
    if (CFG.nuzzle <= 0) return false;
    const n = b.nuzzling;
    if (n) {
      if (time > n.until || n.mum.dying || n.mum.body.grab) {
        b.nuzzling = null;
        b.happyUntil = n.mum.happyUntil = time + 1.5;
        spawnHeart({ x: (c.x + n.mum.body.centroid().x) / 2, y: Math.min(b.body.bbox().minY, n.mum.body.bbox().minY) - 8, vx: 0, born: time, size: 12 });
        return false;
      }
      const mc = n.mum.body.centroid(), side = Math.sign(mc.x - c.x) || 1;
      const p = (time - n.from) / (n.until - n.from);
      const rub = 0.6 + 0.4 * Math.sin(p * Math.PI * 6);
      b.body.lean(side * rub * CFG.nuzzle * r * 30 * DT, DT);
      b.body.impulse(side * 60 * DT * CFG.nuzzle, 0, DT); // pressed up against her
      n.mum.body.lean(-side * rub * CFG.nuzzle * n.mum.body.o.radius * 12 * DT, DT);
      return true;
    }
    if (b.kind !== 'child' || !b.mother || b.mother.dying || b.merging || time < (b.nextNuzzle || 0)) return false;
    const m = b.mother, mc = m.body.centroid();
    const touching = Math.hypot(mc.x - c.x, mc.y - c.y) < (m.body.o.radius + r) * 1.15;
    if (!touching || !m.body.onFloor() || m.body.grab) { b.nextNuzzle = time + 1; return false; }
    b.nextNuzzle = time + (8 + Math.random() * 14) / CFG.nuzzle;
    if (Math.random() < 0.5) return false;
    b.nuzzling = { mum: m, from: time, until: time + 1.4 + Math.random() * 0.6 };
    b.happyUntil = time + 2;
    return true;
  }

  // Late at night (11 pm to 6 am, your clock) slimes get sleepy: they doze
  // off sooner when left alone and yawn more. 0..1, deepest around 3 am.
  // Asleep at night, it's wearing a floppy nightcap, its tip swinging as the
  // body moves.
  // Christmas week, awake or asleep, it's a red one with white trim.
  let holiday = null; // (dev: force 'christmas', 'newyear' or 'halloween')
  const christmas = () => { const d = new Date(); return holiday === 'christmas' || (d.getMonth() === 11 && d.getDate() >= 20 && d.getDate() <= 26); };
  // The first minutes of the new year: fireworks, and they all cheer.
  const newYear = () => { const d = new Date(); return holiday === 'newyear' || (d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() < 10); };
  // The time of day, as the slimes feel it: around noon one wonders about
  // lunch (its tummy rumbles), mid-afternoon about coffee, on a Friday
  // afternoon they're excited for the weekend, and first thing on a Monday
  // one lets out a sigh. Once a day each, only while you're around.
  let clockAt = null; // (dev: force a time, e.g. '2026-10-30T16:10')
  const clockDone = {};
  function clockLife() {
    if (CFG.clockLife <= 0 || sys.away || talkingTo || idleFor() > 60 || Math.random() > DT) return; // (checked about once a second)
    const d = clockAt ? new Date(clockAt) : new Date(), h = d.getHours() + d.getMinutes() / 60, day = d.getDay();
    const moment = h >= 12 && h < 12.5 ? 'lunch' : h >= 15 && h < 15.5 ? 'coffee' : day === 5 && h >= 16 && h < 18 ? 'weekend' : day === 1 && h >= 8.5 && h < 10.5 ? 'monday' : null;
    const key = moment && moment + d.toDateString();
    if (!moment || clockDone[key] || Math.random() > 0.2 * CFG.clockLife) return;
    const calm = bigs().filter((o) => !o.dying && !o.body.grab && !o.bubble && o.body.onFloor() && (o.state === 'idle' || o.state === 'done') && (o.sleep || 0) < 0.2 && o.key !== talkingTo);
    const b = calm[Math.floor(Math.random() * calm.length)];
    if (!b) return;
    clockDone[key] = true;
    if (moment === 'lunch') { quip(b, 'lunch time?', 2.5); b.rumbleUntil = time + 0.9; }
    else if (moment === 'coffee') { quip(b, 'coffee?', 2.2); b.hop(0, -260); }
    else if (moment === 'weekend') {
      quip(b, 'almost the weekend!', 2.5);
      calm.forEach((o, i) => setTimeout(() => { if (o.dying || o.body.grab) return; o.happyUntil = time + 2; if (o.body.onFloor()) o.hop(0, -380); }, 220 * i));
    } else { quip(b, 'monday…', 2.2); b.droopUntil = time + 2.5; }
  }
  // A rumbling tummy: little quick wobbles low down.
  function rumble(b) {
    if (time > (b.rumbleUntil || 0)) return;
    const box = b.body.bbox(), c = b.body.centroid(), r = b.body.o.radius;
    b.body.pushAt(c.x, box.maxY - r * 0.4, Math.sin(time * 55) * r * 1.6, 0, r * 0.5, DT);
  }

  const rockets = [], sparks = [];
  let cheeredYear = 0;
  function stepFireworks() {
    if (CFG.seasons <= 0) return;
    if (newYear()) {
      const y = new Date().getFullYear();
      if (cheeredYear !== y) {
        cheeredYear = y;
        const all = bigs().filter((o) => !o.dying);
        all.forEach((o, i) => setTimeout(() => { if (o.dying) return; o.happyUntil = time + 3; if (o.body.onFloor() && !o.body.grab) o.hop(0, -420); }, 200 * i));
        if (all[0]) quip(all[0], 'Happy new year!', 4);
      }
      if (Math.random() < DT * 1.2) rockets.push({ x: W * (0.15 + Math.random() * 0.7), y: H, vy: -(H * 0.9 + Math.random() * H * 0.4), color: ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b'][Math.floor(Math.random() * 5)] });
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
      const k = rockets[i];
      k.vy += CFG.gravity * 0.35 * DT;
      k.y += k.vy * DT;
      if (k.vy > -60) {
        // Bang: a ring of sparks, and everyone looks up.
        rockets.splice(i, 1);
        const n = 22 + Math.floor(Math.random() * 10), sp = 160 + Math.random() * 120;
        for (let j = 0; j < n; j++) {
          const a = j / n * Math.PI * 2 + Math.random() * 0.2, v = sp * (0.8 + Math.random() * 0.3);
          sparks.push({ x: k.x, y: k.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: time, life: 1 + Math.random() * 0.5, color: j % 4 ? k.color : '#ffd166' });
        }
        for (const o of buddies.values()) if (!o.dying && Math.random() < 0.5) { o.glanceAt = { spot: { x: k.x, y: k.y } }; o.glanceUntil = time + 1; }
      }
    }
    // Sparks fall and slow, then fade.
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      if (time - p.born > p.life) { sparks.splice(i, 1); continue; }
      const drag = Math.exp(-1.6 * DT);
      p.vx *= drag; p.vy = p.vy * drag + CFG.gravity * 0.12 * DT;
      p.x += p.vx * DT; p.y += p.vy * DT;
    }
  }
  function drawRockets() {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const p of sparks) {
      const k = (time - p.born) / p.life;
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.strokeStyle = p.color;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
    }
    ctx.restore();
    for (const k of rockets) {
      ctx.save();
      ctx.fillStyle = k.color;
      ctx.beginPath(); ctx.arc(k.x, k.y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.fillRect(k.x - 1, k.y, 2, 18);
      ctx.restore();
    }
  }
  function nightcap(b) {
    const h = new Date().getHours(), santa = CFG.seasons > 0 && christmas();
    const k = b.body.o.radius <= 12 || b.dying ? 0 : santa ? 1 : CFG.nightcap > 0 && (h >= 22 || h < 7) ? ramp(b.sleep || 0, 0.5, 0.85) : 0;
    if (k <= 0) { b.capSwing = 0; return; }
    const body = b.body, r = body.o.radius;
    let top = 0;
    for (let i = 0; i < body.n; i++) if (body.py[i] < body.py[top]) top = i;
    const x = body.px[top], y = body.py[top], side = b.key.length % 2 ? 1 : -1;
    // The tip lags behind the head: a little spring on how far it's swung.
    const v = body.velocity(DT);
    b.capSwing = (b.capSwing || 0) + (-v.x * 0.0015 - (b.capSwing || 0)) * 0.08;
    const w = r * 0.95 * k, ht = r * 0.75 * k, tipX = x + side * w * 0.55 + b.capSwing * r, tipY = y - ht * 0.75;
    body.lookTop = Math.min(body.lookTop ?? Infinity, y - ht * 1.05); // balloons sit above the cap
    ctx.save();
    ctx.fillStyle = santa ? '#d8333f' : '#5f6fd6';
    ctx.beginPath();
    ctx.moveTo(x - side * w / 2, y + ht * 0.12);
    ctx.quadraticCurveTo(x - side * w * 0.2, y - ht * 1.05, tipX, tipY);
    ctx.quadraticCurveTo(x + side * w * 0.15, y - ht * 0.45, x + side * w / 2, y + ht * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4f1ea';
    ctx.beginPath(); ctx.ellipse(x, y + ht * 0.12, w * 0.55, ht * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(tipX, tipY, r * 0.09 * k + 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function lateness() {
    if (CFG.nightSleepy <= 0) return 0;
    const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    const fromMid = h >= 23 ? h - 24 : h; // -1 at 23:00 ... 6 at 06:00
    if (fromMid < -1 || fromMid > 6) return 0;
    return CFG.nightSleepy * Math.max(0, 1 - Math.abs(fromMid - 3) / 4);
  }
  // How long without the mouse before an idle slime dozes off (s).
  const dozeAfter = () => 120 - 75 * Math.min(1, lateness());
  // How long since you last did anything: the mouse here, or (as the app
  // reports it) the keyboard or mouse anywhere, so typing in a terminal
  // doesn't count as leaving them alone.
  function idleFor() {
    const now = performance.now() / 1000, mouseIdle = now - mouse.lastMove;
    return sys.idleAt < 0 ? mouseIdle : Math.min(mouseIdle, sys.idle + now - sys.idleAt);
  }
  // Dozing off is a latch: once left alone long enough they're asleep, and
  // moving the mouse (over them, near them, anywhere) doesn't wake them. Only
  // a real touch does: a click or grab, the keyboard, the screen waking.
  const doze = { on: false, since: 0, touchAt: 0 };
  function dozing() {
    const now = performance.now() / 1000;
    if (doze.on && doze.touchAt > doze.since) doze.on = false;
    if (!doze.on && idleFor() > dozeAfter() && now > doze.touchAt) { doze.on = true; doze.since = now; }
    return doze.on;
  }
  const touched = () => { doze.touchAt = performance.now() / 1000; };
  // Asleep enough that the cursor is nothing to it: no flinching, no
  // greeting, no eyes opening to look.
  const lulled = (b) => (b.sleep || 0) > 0.3 || (b.state === 'idle' && !b.body.grab && dozing());

  // --- The computer -------------------------------------------------------

  function onSystem(m) {
    if (m.kind === 'idle') {
      if (m.seconds < sys.idle) sys.asleep = false; // (used since: in case a wake went missing)
      // Input since the last report that wasn't the mouse moving: the keyboard.
      if (m.seconds < sys.idle - 0.5 && mouse.lastMove < performance.now() / 1000 - m.seconds - 1.5) touched();
      sys.idle = m.seconds;
      sys.idleAt = performance.now() / 1000;
      if (!sys.away && m.seconds > CFG.awayAfter) goAway(m.seconds);
      else if (sys.away && m.seconds < 5) comeBack();
      return;
    }
    if (m.kind === 'battery-level') { sys.battery = { level: m.level, charging: !!m.charging }; return; }
    if (m.kind === 'sleep') { goAway(0); sys.asleep = true; sys.idle = 0; }
    else if (m.kind === 'wake') { sys.asleep = false; touched(); wakeUp(); comeBack(); }
    else if (m.kind === 'ac') charge();
  }

  // You've gone (idle a while, or the lid shut): remember how each session
  // stood, so when you're back they can tell you what changed.
  function goAway(already) {
    if (sys.away) return;
    sys.away = true;
    sys.awayFrom = Date.now() - already * 1000;
    sys.before = new Map([...buddies.values()].filter((b) => b.kind === 'mother' && b.session).map((b) => [b.key, b.state]));
  }

  function comeBack() {
    if (!sys.away) return;
    sys.away = false;
    const before = sys.before || new Map();
    sys.before = null;
    if (Date.now() - sys.awayFrom < CFG.awayAfter * 1000 * 0.9) return;
    const word = { waiting: 'needs you', done: 'done' };
    const news = [...buddies.values()].filter((b) => b.kind === 'mother' && !b.dying && b.session && word[b.state] && before.get(b.key) !== b.state);
    // The ones with news come over to say hello; everyone looks pleased.
    let i = 0;
    for (const b of buddies.values()) {
      if (b.dying || b.kind === 'child') continue;
      const has = news.includes(b);
      setTimeout(() => {
        if (lulled(b)) return; // (asleep: the mouse alone doesn't wake it)
        b.greetUntil = time + 1.5;
        b.nextBlink = time;
        if (has && CFG.systemLife > 0 && b.body.onFloor()) {
          const dx = mouse.x - b.body.centroid().x;
          b.hop(Math.sign(dx) * Math.min(420, Math.abs(dx) * 0.8) * CFG.seekYou, -380 * Math.min(1.5, CFG.systemLife));
        }
      }, 250 + i++ * 220 + Math.random() * 150);
    }
    // First thing in the morning (away overnight): a big stretch all round.
    const h = new Date().getHours();
    const morning = h >= 5 && h < 12 && (new Date(sys.awayFrom).toDateString() !== new Date().toDateString() || Date.now() - sys.awayFrom > 4 * 3600e3);
    if (morning && doze.touchAt > performance.now() / 1000 - 10) wakeUp(); // (a click or key, not just the mouse)
    if (!CFG.welcomeBack || (!news.length && !morning)) return;
    const by = buddies.get(HOME) || news[0] || bigs()[0];
    if (!by) return;
    const mins = Math.round((Date.now() - sys.awayFrom) / 60000);
    const head = morning ? 'Good morning!' : mins >= 2 ? `While you were away (${mins} min):` : 'While you were away:';
    // In the morning, how yesterday went (if they worked).
    const y = new Date(); y.setDate(y.getDate() - 1);
    const days = morning ? [...buddies.values()].filter((b) => b.kind === 'mother' && b.session && b.session.today && b.session.today.turns && b.session.today.day === y.toDateString()).map((b) => b.session.today) : [];
    const turns = days.reduce((n, d) => n + d.turns, 0);
    const yesterday = turns ? [{ text: `Yesterday: ${turns} turn${turns > 1 ? 's' : ''} · ${workedFor(days.reduce((n, d) => n + d.workMs, 0))} of work`, size: 12 }] : [];
    by.say([{ text: head }, ...yesterday, ...(morning && news.length ? [{ text: 'While you were away:' }] : []),
      ...news.map((b) => ({ text: `${label(b)}: ${word[b.state]}`, color: D.STATE_COLORS[b.state] }))], 8, false, false);
  }

  // The screen wakes (lid open, unlocked): they wake with it, a big stretch
  // up and a blink, one after another.
  function wakeUp() {
    if (CFG.systemLife <= 0) return;
    let i = 0;
    for (const b of buddies.values()) {
      if (b.dying) continue;
      // (One mid-hop stretches when it lands.)
      const go = (tries) => {
        const body = b.body;
        if (b.dying) return;
        if (!body.onFloor() || body.grab) { if (tries < 20) setTimeout(() => go(tries + 1), 150); return; }
        body.squashTop(-CFG.systemLife * body.o.radius * 16, DT);
        b.startleUntil = time + 0.35;
        b.nextBlink = time + 0.2;
        b.sleep = Math.min(b.sleep || 0, 0.4);
      };
      setTimeout(() => go(0), i++ * 120 + Math.random() * 200);
    }
  }

  // The charger goes in: a tingle runs through them and they perk up.
  function charge() {
    sys.lowSaid = false;
    if (CFG.systemLife <= 0) return;
    let i = 0;
    for (const b of buddies.values()) {
      if (b.dying) continue;
      setTimeout(() => { b.chargeUntil = time + 0.6; }, i++ * 90);
    }
    const by = buddies.get(HOME) || bigs()[0];
    if (by) quip(by, '⚡', 1.4, 30);
  }

  // While charging up: a fizzy tingle, then a little hop when it's done.
  function tingle(b) {
    if (!b.chargeUntil) return;
    const body = b.body, k = CFG.systemLife;
    if (time < b.chargeUntil) {
      if (body.onFloor() && !body.grab) {
        const c = body.centroid(), r = body.o.radius;
        const a = Math.random() * Math.PI * 2;
        body.pushAt(c.x + Math.cos(a) * r * 0.8, c.y + Math.sin(a) * r * 0.8, Math.cos(a) * 160 * k, Math.sin(a) * 160 * k, r * 0.5, DT);
      }
      return;
    }
    b.chargeUntil = 0;
    b.happyUntil = time + 1.5;
    if (body.onFloor() && !body.grab) b.hop((Math.random() - 0.5) * 80, -300 * Math.min(1.5, k));
  }

  // Low battery (and not charging): they get tired, softer and saggier,
  // with smaller hops. Said once, the first time it gets low.
  function stepBattery() {
    const bat = sys.battery;
    const goal = CFG.systemLife > 0 && CFG.lowBattery > 0 && bat && !bat.charging && bat.level <= CFG.lowBattery
      ? Math.min(1, CFG.systemLife * (1 - 0.5 * bat.level / CFG.lowBattery)) : 0;
    sys.low += (goal - sys.low) * 0.004;
    if (goal > 0 && !sys.lowSaid && sys.low > 0.3) {
      sys.lowSaid = true;
      const by = buddies.get(HOME) || bigs()[0];
      if (by) by.say([{ text: `🔋 ${Math.round(bat.level * 100)}%, getting tired` }], 4, false, false);
    }
    if (bat && bat.charging) sys.lowSaid = false;
  }

  // Each slime is its own character: from its key it gets a little more or
  // less of some traits (bouncy, curious, fidgety, blinky, firm), so two
  // slimes never quite move alike. 'personality' sets how different.
  const TRAITS = ['bouncy', 'curious', 'fidgety', 'blinky', 'firm'];
  function trait(b, name) {
    if (!b.traits || b.traitsFor !== b.key) {
      let h = 2166136261;
      for (let i = 0; i < b.key.length; i++) h = Math.imul(h ^ b.key.charCodeAt(i), 16777619) >>> 0;
      b.traits = {};
      for (const t of TRAITS) { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; b.traits[t] = (h % 2001) / 1000 - 1; }
      b.traitsFor = b.key;
    }
    return 1 + b.traits[name] * CFG.personality * (name === 'firm' ? 0.25 : 0.5);
  }

  // The crouch before a hop: the top is pushed down, harder for a bigger
  // jump. When it's time the hop goes off, and the top, which was on its
  // way down, kicks up instead, so it takes off stretched.
  function crouch(b) {
    const h = b.pendingHop, body = b.body;
    if (body.grab) { b.pendingHop = null; return; }
    if (time >= h.at) {
      b.pendingHop = null;
      body.squashTop(-h.v * 0.85, DT); // about what the crouch took, so hops go as high as asked
      body.lean(h.vx * 0.15, DT); // the top leads the way it's going
      body.impulse(h.vx, h.vy, DT);
      return;
    }
    const dv = CFG.crouchDepth * 80 * body.o.radius * h.power * DT;
    h.v += dv;
    body.squashTop(dv, DT);
  }

  // Picked up, whatever it was in the middle of stops there and then: a hop
  // still to go off, a trick, a somersault, a tumble or a roll, a bounce or
  // a sneeze to come. It rights itself as usual again, and the hand takes
  // out its spin and most of its speed, so it hangs from the cursor instead
  // of whirling round it or flinging itself out long.
  function pickUp(b) {
    b.pendingHop = null;
    b.flip = null; b.forceFlip = false;
    b.trick = null; b.tumble = null; b.roll = null;
		if (b.balloon) unballoon(b); // (all the air out at once)
    b.bounceAt = 0; b.sneeze = null;
    unsheet(b); if (b.ghostBy) unsheet(b.ghostBy); // (a ghost, or the one it was creeping up on)
    b.body.o.upright = CFG.upright;
    b.body.calm(400, DT);
  }

  // Held up: shake it and it gets dizzy; hold it still and, after a
  // moment, it wriggles to be let down.
  function held(b) {
    const g = b.body.grab, r = b.body.o.radius;
    const flips = b.shakes || (b.shakes = []);
    for (const [axis, v] of [['x', g.vx], ['y', g.vy]]) {
      if (Math.abs(v) < 600) continue;
      const dir = Math.sign(v), key = 'shake' + axis;
      if (b[key] && b[key] !== dir) flips.push(time);
      b[key] = dir;
    }
    while (flips.length && time - flips[0] > 1.5) flips.shift();
    if (CFG.shakeDizzy > 0 && flips.length >= CFG.shakeDizzy) { b.dizzyUntil = time + 1.8; flips.length = 0; feel(b, -0.35); }
    // Swung gently from side to side, though, it loves it: "wheee!"
    if (CFG.swing > 0 && Math.abs(g.vx) > 150 && Math.abs(g.vx) < 600) {
      const dir = Math.sign(g.vx), sw = b.swings || (b.swings = []);
      if (b.swingDir && b.swingDir !== dir && time - (sw[sw.length - 1] ?? -9) > 0.3) sw.push(time);
      b.swingDir = dir;
      while (sw.length && time - sw[0] > 4) sw.shift();
      if (sw.length >= 3 && !flips.length && time > b.dizzyUntil) {
        sw.length = 0;
        b.wheeUntil = time + 1.6 * Math.min(1.5, CFG.swing);
        feel(b, 0.05);
        if (time > (b.nextWhee || 0)) { quipBack(b, 'wheee!', 1.2); b.nextWhee = time + 6; }
      }
    }
    b.stillFor = Math.hypot(g.vx, g.vy) < 90 ? (b.stillFor || 0) + DT : 0;
    // (Grumpy with you, it wants down much sooner.)
    const after = CFG.wriggleAfter * ((b.mood || 0) < -0.3 ? 0.3 : 1);
    b.wriggling = CFG.wriggle > 0 && b.stillFor > after && time > b.dizzyUntil && !b.hug && (b.stillFor - after) % 2.6 < 1.3;
    if (b.wriggling && time > (b.nextKick || 0)) {
      // Kicks: held by its top, a lean swings its bottom from side to side.
      b.kickDir = -(b.kickDir || 1);
      b.body.lean(b.kickDir * CFG.wriggle * r * 3.5, DT);
      b.nextKick = time + 0.17 + Math.random() * 0.08;
    }
  }

  // Left to itself, a calm slime shifts its weight from side to side,
  // settles with a little plop, stretches up, or looks around.
  function fidget(b, r) {
    if (CFG.idleFidget <= 0) return;
    const f = b.shift;
    if (f && time < f.until) {
      const p = (time - f.from) / (f.until - f.from);
      b.body.lean(f.dir * Math.sin(p * Math.PI * 2) * CFG.idleFidget * r * 10 * DT, DT);
    }
    if (time < (b.nextIdleFidget || 0)) return;
    const first = !b.nextIdleFidget;
    b.nextIdleFidget = time + (6 + Math.random() * 8) / Math.max(0.3, CFG.idleFidget * trait(b, 'fidgety'));
    if (first) return;
    const roll = Math.random();
    if (roll < 0.45) b.shift = { dir: Math.random() < 0.5 ? -1 : 1, from: time, until: time + 1.6 + Math.random() * 1 };
    else if (roll < 0.65) b.body.squashTop(CFG.idleFidget * r * 2, DT);
    else if (roll < 0.8) b.body.squashTop(-CFG.idleFidget * r * 2.5, DT);
    else if (!lookedAway(b)) {
      // A look around: at another slime, or at nothing in particular, held
      // a while.
      const others = [...buddies.values()].filter((o) => o !== b && !o.dying);
      const c = b.body.centroid();
      b.glanceAt = others.length && Math.random() < 0.6 ? others[Math.floor(Math.random() * others.length)]
        : { spot: { x: c.x + (Math.random() < 0.5 ? -1 : 1) * r * (1.5 + Math.random() * 3), y: c.y - r * Math.random() * 2.5 } };
      b.glanceUntil = b.lookedAt = time + LOOK_HOLD.idle[0] + Math.random() * LOOK_HOLD.idle[1];
    }
  }

  // Throw a slime at a calm one and it may catch it: it braces, eyes on it,
  // leans in and takes the hit with a big squish, the two of them stuck
  // together for a moment ("got you!").
  function catchThrown(b) {
    const k = b.catching, body = b.body;
    if (k) {
      const f = k.f, t = time - k.at;
      if (f.dying || body.grab || f.body.grab || t > 1.2 || (k.caught && t > 1.6)) { b.catching = null; return; }
      if (k.caught) return;
      const c = body.centroid(), fc = f.body.centroid(), r = body.o.radius;
      const dx = fc.x - c.x, dy = fc.y - c.y, d = Math.hypot(dx, dy) || 1;
      // Braced: low, leaning in toward it, eyes on it.
      b.glanceAt = f; b.glanceUntil = time + 0.2;
      if (body.onFloor()) {
        body.squashTop(r * 0.3 * 60 * DT, DT);
        body.lean(Math.sign(dx) * r * 8 * DT, DT);
        body.impulse(-body.velocity(DT).x * 0.3, 0, DT);
      }
      if (d < (r + f.body.o.radius) * 1.08) {
        // Caught: most of its speed goes into a squish, a little into a
        // push back for the catcher.
        k.caught = true; k.at = time;
        const v = f.body.velocity(DT), kk = Math.min(1, CFG.catching);
        f.body.impulse(-v.x * 0.75 * kk, -Math.min(0, v.y) * 0.5 * kk, DT);
        body.impulse(v.x * 0.15 * kk, 0, DT);
        body.squashTop(r * 4 * kk, DT);
        b.bumpedAt = f.bumpedAt = time; // (no glare, no stars: it meant to)
        quipBack(b, Math.random() < 0.5 ? 'got you!' : 'caught!', 1.1);
        b.cheerUntil = time + 1.4; f.happyUntil = time + 1.6; f.dizzyUntil = 0;
        spawnHeart({ x: (c.x + fc.x) / 2, y: Math.min(body.bbox().minY, f.body.bbox().minY) - 8, vx: 0, born: time, size: 12 });
        f.giggleAt = time + 0.8;
      }
      return;
    }
    if (CFG.catching <= 0 || b.kind !== 'mother' || (b.state !== 'idle' && b.state !== 'done') || body.grab || !body.onFloor() || b.merging || b.dying || (b.mood || 0) < -0.3 || (b.sleep || 0) > 0.3 || b.tower || b.pile || b.rope || b.balloon || b.frog) return;
    const c = body.centroid(), r = body.o.radius;
    for (const f of buddies.values()) {
      if (f === b || f.kind !== 'mother' || f.dying || f.body.grab || f.body.onFloor() || time - (f.thrownAt ?? -9) > 1.2 || [...buddies.values()].some((o) => o.catching && o.catching.f === f)) continue;
      const v = f.body.velocity(DT), speed = Math.hypot(v.x, v.y);
      if (speed < 300 || speed > 1800 * CFG.catching) continue;
      const fc = f.body.centroid(), dx = fc.x - c.x, dy = fc.y - c.y, d = Math.hypot(dx, dy);
      const closing = -(dx * v.x + dy * v.y) / (d || 1);
      if (closing < 200 || (d - r - f.body.o.radius) / closing > 0.55 || dy < -r * 4) continue;
      // Heading its way: a gulp, and it braces.
      b.catching = { f, at: time };
      b.surpriseUntil = time + 0.3;
      return;
    }
  }

  // Bowling: one you've thrown that knocks into two or more others on its
  // way is very pleased with itself ("strike!").
  function bowl(f, o) {
    if (CFG.bowling <= 0 || !f.thrownAt || time - f.thrownAt > 2 || f.kind === 'home' || o.kind === 'home' || (f.catching && f.catching.f === o) || (o.catching && o.catching.f === f)) return;
    const vf = f.body.velocity(DT), vo = o.body.velocity(DT);
    if (Math.hypot(vf.x, vf.y) < Math.hypot(vo.x, vo.y) || Math.hypot(vf.x - vo.x, vf.y - vo.y) < 350) return;
    if (f.bowled !== f.thrownAt) { f.bowled = f.thrownAt; f.pins = new Set(); }
    const before = f.pins.size;
    f.pins.add(o);
    o.dizzyUntil = Math.max(o.dizzyUntil || 0, time + 0.8);
    if (before < 2 && f.pins.size === 2) { // (once: not again every step they stay in contact)
      f.cheerUntil = time + 1.8;
      quipBack(f, 'strike!', 1.3);
      spawnHeart({ x: f.body.centroid().x, y: f.body.bbox().minY - 8, vx: 0, born: time, size: 13 });
    }
  }
  // Two slimes hit each other: if they met fast enough, the one that got
  // hit (the slower one) sees stars for a moment.
  function bump(a, b) {
    bowl(a, b); bowl(b, a);
    if (time < (a.bumpedAt || 0) + 0.6 || time < (b.bumpedAt || 0) + 0.6) return;
    const va = a.body.velocity(DT), vb = b.body.velocity(DT);
    const rel = Math.hypot(va.x - vb.x, va.y - vb.y);
    if (rel < 300 || (a.tower && a.tower === b.tower) || (a.pile && a.pile === b.pile)) return; // (a tower partner climbing up is expected)
    a.bumpedAt = b.bumpedAt = time;
    const aFaster = Math.hypot(va.x, va.y) > Math.hypot(vb.x, vb.y);
    const hit = aFaster ? b : a, by = aFaster ? a : b;
    const family = (a.mother === b || b.mother === a);
    if (family && rel >= 600) {
      // Mum catches it: a happy squish and a heart, no stars.
      const mum = a.mother === b ? b : a, kid = mum === a ? b : a;
      mum.happyUntil = time + 1.2;
      kid.happyUntil = time + 1.2;
      const top = mum.body.bbox().minY;
      spawnHeart({ x: mum.body.centroid().x, y: top - 8, vx: 0, born: time, size: 13 });
      return;
    }
    if (rel >= CFG.dizzySpeed * 0.8) { hit.dizzyUntil = time + 1; return; }
    if (hit.kind === 'home' || hit.body.grab || homeward(hit) || time < (hit.annoyCooldown || 0)) return; // (a helper heading for mum pays it no mind)
	if (hit.state === 'working' && time - (by.hoppedAt ?? -9) < 2) return; // (a neighbour hopping about bumps into it: it keeps its head down)
    hit.annoyedUntil = time + 1.1 + Math.random() * 0.6;
    hit.annoyedAt = by;
    hit.annoyCooldown = time + 7 + Math.random() * 5;
  }

  // While splitting, a spring ties the new slime to the one it came from
  // (nothing drawn): its rest length grows and its strength fades until
  // they're apart.
  function pullStrand(b) {
    const p = (time - b.born) / SPLIT_TIME;
    const a = b.parent.body, c = b.body;
    const pa = a.centroid(), pc = c.centroid();
    const dx = pc.x - pa.x, dy = pc.y - pa.y;
    const d = Math.hypot(dx, dy) || 1;
    const rest = (a.o.radius + c.o.radius) * (0.4 + p);
    const acc = (d - rest) * 220 * (1 - p); // px/s^2
    const ux = dx / d, uy = dy / d;
    c.impulse(-ux * acc * 0.8 * DT, -uy * acc * 0.8 * DT, DT);
    a.impulse(ux * acc * 0.2 * DT, uy * acc * 0.2 * DT, DT);
  }

  // A big yawn with a little stretch; slimes close by may catch it a moment
  // later (and pass it on, less and less likely).
  function yawn(b, seconds, spread) {
    b.yawnUntil = time + seconds;
    if (b.body.onFloor() && !b.body.grab) b.body.impulse(0, -180, DT);
    const c = b.body.centroid();
    for (const o of buddies.values()) {
      if (o === b || o.dying || o.kind === 'home' || o.catchYawnAt || time < (o.yawnUntil || -99) + 15) continue;
      const oc = o.body.centroid();
      if (Math.hypot(oc.x - c.x, oc.y - c.y) > (b.body.o.radius + o.body.o.radius) * 2.5) continue;
      if (Math.random() < spread) o.catchYawnAt = time + 0.9 + Math.random() * 1.5;
    }
  }

  // Something sitting on its head: a stranger gets glared at and, after a
  // moment, shrugged off; one of its own helpers gets to stay a while, and
  // they're both delighted. Whoever is on top looks pleased with itself.
  function stackPlay(b) {
    if (b.kind === 'home' || b.dying || b.body.grab) { b.stackedBy = null; return; }
    const c = b.body.centroid(), r = b.body.o.radius, top = b.body.bbox().minY;
    let on = null;
    for (const o of buddies.values()) {
      if (o === b || o.dying || o.body.grab || o.kind === 'home' || passThrough(o, b) || (o.frog && o.frog === b.frog)) continue; // (a leapfrog partner going over isn't sitting on it)
      const oc = o.body.centroid();
      if (Math.abs(oc.x - c.x) < r * 0.9 && oc.y < c.y - r * 0.5 && o.body.bbox().maxY > top - 6) { on = o; break; }
    }
    if (on !== b.stackedBy) {
      b.stackedBy = on; b.stackSince = time; b.stackReacted = false; b.stackPatience = Math.random() * 2;
      // Dropped onto its head from high up: it gives like a trampoline and
      // springs the faller back up. Boing!
      const fall = on && on.vel ? on.vel.y : 0;
      if (on && CFG.trampoline > 0 && fall > 650 && b.body.onFloor() && !(b.tower && b.tower === on.tower) && !(b.pile && b.pile === on.pile)) {
        b.body.squashTop(Math.min(900, fall * 0.35) * Math.min(1.5, CFG.trampoline), DT);
        on.bounceAt = time + 0.08; on.bounceV = Math.min(1500, fall) * 1.0 * Math.min(1.5, CFG.trampoline);
        b.surpriseUntil = time + 0.6; on.cheerUntil = time + 1.2;
        quipBack(on, 'boing!', 1);
      }
      return;
    }
    if (!on) return;
    if (b.tower && b.tower.line.includes(on)) return; // (a tower: it's meant to be up there)
    if (b.pile && b.pile === on.pile) return; // (a dogpile, likewise)
    const family = on.mother === b || b.mother === on || (on.mother && on.mother === b.mother);
    const t = time - b.stackSince;
    if (t > 0.5 && !b.stackReacted) {
      b.stackReacted = true;
      on.happyUntil = time + (family ? 3 : 1.5);
      if (family) {
        b.happyUntil = time + 3;
        spawnHeart({ x: c.x, y: top - 10, vx: 0, born: time, size: 11 });
      } else {
        b.annoyedUntil = time + 1.5;
        b.annoyedAt = on;
      }
    }
    if (t > (family ? 5 : 2) + b.stackPatience * (family ? 2 : 1)) {
      // Shrug: a bounce that tips the rider off to one side.
      const side = Math.sign(on.body.centroid().x - c.x) || (Math.random() < 0.5 ? -1 : 1);
      if (b.body.onFloor()) b.body.impulse(0, family ? -180 : -280, DT);
      on.hop(side * (family ? 220 : 380), family ? -300 : -420);
      b.stackSince = time;
      b.stackReacted = false;
    }
  }

  // Wave the cursor just above an idle slime, like a toy on a string: it
  // watches, wiggles, then jumps for it. Catch it and a heart pops out.
  // Now and then a calm slime sneaks up beside another and pops up tall:
  // "boo!" The other jumps, then glares. (More often on Halloween.)
  function prank(b) {
    if (CFG.pranks <= 0 || b.kind !== 'mother') return;
    const calmOf = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && o.body.onFloor() && !o.stackedBy && !o.tag && o !== buddies.get(talkingTo);
    const p = b.prank;
    if (p) {
      const busy = (o) => o.dying || o.body.grab || o.merging || (o.state !== 'idle' && o.state !== 'done');
      if (busy(b) || busy(p.o) || time - p.at > 6) { b.prank = null; return; }
      if (!b.body.onFloor() || b.pendingHop) return; // still on its way
      if (p.stage === 'sneak' && time - p.at > 0.5) {
        const r = b.body.o.radius, oc = p.o.body.centroid(), c = b.body.centroid();
        if (Math.abs(oc.x - c.x) > (r + p.o.body.o.radius) * 1.6) { b.prank = null; return; } // didn't make it
        p.stage = 'boo'; p.at = time;
        b.body.squashTop(-r * 22 * Math.min(1.5, CFG.pranks), DT);
        b.booUntil = time + 0.7;
        quip(b, 'boo!', 1);
        const o = p.o, away = Math.sign(oc.x - c.x) || 1;
        o.startleUntil = time + 0.6; o.surpriseUntil = time + 0.6;
        o.body.lean(away * o.body.o.radius * 4, DT);
        o.hop(away * 160, -340);
        bristle(o);
        setTimeout(() => { if (!o.dying && !b.dying) { o.annoyedUntil = time + 1.4; o.annoyedAt = b; b.happyUntil = time + 1.6; } }, 700);
      } else if (p.stage === 'boo' && time - p.at > 1.5) b.prank = null;
      return;
    }
    if (!calmOf(b) || time < (b.nextPrank ?? (b.nextPrank = time + (90 + Math.random() * 210) / CFG.pranks))) return;
    const d = new Date(), spooky = d.getMonth() === 9 && d.getDate() === 31;
    b.nextPrank = time + (spooky ? 30 + Math.random() * 60 : 240 + Math.random() * 480) / CFG.pranks;
    const c = b.body.centroid(), r = b.body.o.radius;
    const others = [...buddies.values()].filter((o) => o !== b && o.big && calmOf(o) && Math.abs(o.body.centroid().y - c.y) < r && Math.abs(o.body.centroid().x - c.x) < r * 12);
    if (!others.length) return;
    prankNow(b, others[Math.floor(Math.random() * others.length)]);
  }
  // Halloween week: a calm slime now and then hops over to another, "trick
  // or treat!". Mostly it gets a sweet tossed over, catches it and chews
  // ("nom"); sometimes there's none ("no sweets!"), and then it's a trick:
  // it pops up tall, "boo!".
  function trickTreat(b) {
    if (CFG.trickTreat <= 0 || b.kind !== 'mother') return;
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.ghost && !o.ghostBy && !o.prank && !o.trick && !o.tag && !o.snow && !o.parade && !o.frog && !o.tower && !o.rope && !o.seek && !o.pile && !o.keepy && !o.measure && !o.roll && !o.balloon && !o.shape && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
    const g = b.tot;
    if (g) {
      const o = g.o, end = () => { b.tot = null; o.totBy = null; };
      if (!free(b) || !free(o) || drag || time - g.at > 8) { end(); return; }
      b.nextHop = o.nextHop = time + 1;
      if (g.stage === 'go') {
        if (!b.body.onFloor() || b.pendingHop || time - g.at < 0.4) return;
        const r = b.body.o.radius, c = b.body.centroid(), oc = o.body.centroid();
        if (Math.abs(oc.x - c.x) > (r + o.body.o.radius) * 1.7) { end(); return; } // (didn't make it over)
        g.stage = 'ask'; g.t = time;
        quip(b, 'trick or treat!', 1.6);
        b.body.squashTop(-r * 8, DT);
        o.glanceAt = b; o.glanceUntil = time + 1.5;
        return;
      }
      if (g.stage === 'ask' && time - g.t > 1.3) {
        g.stage = 'answer'; g.t = time;
        const ob = o.body, bb = b.body, r = ob.o.radius;
        if (Math.random() < 0.72) {
          // A sweet: a little lob onto its head.
          ob.squashTop(-r * 6, DT);
          const box = ob.bbox(), tb = bb.bbox(), dir = Math.sign((tb.minX + tb.maxX) / 2 - (box.minX + box.maxX) / 2) || 1;
          const x0 = dir > 0 ? box.maxX - r * 0.3 : box.minX + r * 0.3, y0 = box.minY + r * 0.4;
          const tx = (tb.minX + tb.maxX) / 2, ty = tb.minY + bb.o.radius * 0.3, grav = CFG.gravity * 0.5, T = 0.6;
          snowballs.push({ x: x0, y: y0, vx: (tx - x0) / T, vy: (ty - y0 - 0.5 * grav * T * T) / T, grav, from: o, born: time, candy: ['#e8892f', '#8a5cd6', '#e0527a', '#4fb36b'][Math.floor(Math.random() * 4)], spin: (Math.random() - 0.5) * 16 });
          o.happyUntil = time + 1.2;
        } else {
          quip(o, 'no sweets!', 1.2);
          o.sheepishUntil = time + 1.2;
          g.trick = true;
        }
        return;
      }
      if (g.stage === 'answer' && g.trick && time - g.t > 1.1) {
        const r = b.body.o.radius, away = Math.sign(o.body.centroid().x - b.body.centroid().x) || 1;
        b.body.squashTop(-r * 22 * Math.min(1.5, CFG.trickTreat), DT);
        b.booUntil = time + 0.7;
        quip(b, 'boo!', 1);
        o.startleUntil = time + 0.6; o.surpriseUntil = time + 0.6;
        o.body.lean(away * o.body.o.radius * 4, DT);
        o.hop(away * 160, -340);
        bristle(o);
        b.happyUntil = time + 1.8;
        end();
        return;
      }
      if (g.stage === 'answer' && !g.trick && time - g.t > 2.6) end();
      return;
    }
    if (!spooky() || !free(b) || !b.body.onFloor() || idleFor() > 60 || time < (b.nextTot ?? (b.nextTot = time + (150 + Math.random() * 300) / CFG.trickTreat))) return;
    b.nextTot = time + (300 + Math.random() * 500) / CFG.trickTreat;
    const c = b.body.centroid(), r = b.body.o.radius;
    const others = [...buddies.values()].filter((o) => o !== b && o.kind === 'mother' && !o.totBy && !o.tot && free(o) && o.body.onFloor() && Math.abs(o.body.centroid().y - c.y) < r && Math.abs(o.body.centroid().x - c.x) < r * 10);
    if (others.length) totNow(b, others[Math.floor(Math.random() * others.length)]);
  }
  // Halloween: a bored slime now and then pulls a sheet over itself and
  // goes as a ghost, creeping up on another with slow little hops,
  // swaying, "boooo!". The other bristles and jumps back ("eek!"); off
  // comes the sheet ("it's me!") and they both laugh.
  function ghost(b) {
    const g = b.ghost, body = b.body;
    if (g) {
      const t = time - g.at, o = g.o, r = body.o.radius;
      // Anything that cuts it short (picked up, the other one picked up or
      // gone, called to work) takes the sheet off the usual way, never in
      // one frame.
      if (g.stage !== 'off' && (b.dying || body.grab || t > 16 || b.merging || (b.state !== 'idle' && b.state !== 'done') || !o || o.dying || o.merging || o.body.grab)) { unsheet(b); return; }
      b.nextHop = time + 1;
      if (g.stage === 'on' && t > 0.8) { g.stage = 'creep'; g.next = time; }
      if (g.stage === 'creep') {
        const c = body.centroid(), oc = o.body.centroid(), dx = oc.x - c.x;
        // Sway as it goes, woo-ooo. (It stops further off than its own
        // size: the sheet is wider than it is.)
        body.lean(Math.sin(t * 3) * r * 5 * DT, DT);
        if (Math.abs(dx) < r * 1.4 + o.body.o.radius * 1.4) { g.stage = 'boo'; g.booAt = time; quip(b, 'boooo!', 1.4); body.squashTop(-r * 14, DT); return; }
        if (time > g.next && body.onFloor() && !b.pendingHop) {
          g.next = time + 0.55;
          const v = launch(Math.sign(dx) * Math.min(Math.abs(dx) - (r * 1.3 + o.body.o.radius) * 1.1, r * 1.2), r * 0.35);
          body.impulse(-body.velocity(DT).x, 0, DT);
          b.hop(v.vx, v.vy);
        }
        if (t > 10) unsheet(b);
        return;
      }
      if (g.stage === 'boo') {
        const bt = time - g.booAt;
        body.lean(Math.sin(bt * 9) * r * 12 * DT, DT); // (waving its arms about, under the sheet)
        if (body.onFloor()) body.squashTop(-r * 0.35 * 60 * DT, DT);
        if (!g.scared && bt > 0.4) {
          g.scared = true;
          const away = Math.sign(o.body.centroid().x - body.centroid().x) || 1;
          o.startleUntil = time + 0.7; o.surpriseUntil = time + 0.7;
          o.hop(away * 220, -380);
          bristle(o);
          quip(o, 'eek!', 1);
        }
        if (bt > 1.8) { unsheet(b); g.reveal = true; quip(b, "it's me!", 1.2); b.cheerUntil = time + 1.8; }
        return;
      }
      if (g.stage === 'off') {
        const ot = time - g.offAt;
        if (g.reveal && o && ot > 0.7 && !g.laughed && !o.dying) { g.laughed = true; quip(o, Math.random() < 0.5 ? 'haha' : 'not funny!', 1); if (Math.random() < 0.6) o.cheerUntil = time + 1.2; else { o.annoyedAt = b; o.annoyedUntil = time + 1.2; } }
        if (ot > (g.reveal ? 1.6 : GHOST_OFF)) { b.ghost = null; if (o && o.ghostBy === b) o.ghostBy = null; }
      }
      return;
    }
    if (CFG.ghosts <= 0 || CFG.seasons <= 0 || !spooky() || b.kind !== 'mother' || (b.state !== 'idle' && b.state !== 'done') || body.grab || !body.onFloor() || b.merging || b.dying || b.tower || b.pile || b.rope || b.seek || b.balloon || b.frog || b.tag || b.parade || b.tot || b.shape || b.prank || b.trick || b.roll || b.tumble || b.flip || b.ghostBy || (b.sleep || 0) > 0.1 || idleFor() > 60 || b === buddies.get(talkingTo)) return;
    if (time < (b.nextGhost ?? (b.nextGhost = time + (120 + Math.random() * 300) / CFG.ghosts))) return;
    b.nextGhost = time + (300 + Math.random() * 500) / CFG.ghosts;
    const c = body.centroid(), r = body.o.radius;
    const o = [...buddies.values()].find((o) => o !== b && o.kind === 'mother' && !o.dying && !o.ghostBy && !o.ghost && !o.body.grab && o.body.onFloor() && Math.abs(o.body.bbox().maxY - body.bbox().maxY) < 10 && Math.abs(o.body.centroid().x - c.x) < r * 9 && (o.state === 'idle' || o.state === 'done'));
    if (o) ghostNow(b, o);
  }
  function ghostNow(b, o) {
    b.ghost = { o, at: time, stage: 'on' };
    o.ghostBy = b;
  }
  // Off comes the sheet (pulled up and away, see drawGhost), whatever
  // stage it had got to: from as far on as it was.
  function unsheet(b) {
    const g = b.ghost;
    if (!g || g.stage === 'off') return;
    const on = Math.min(1, (time - g.at) / GHOST_ON);
    g.stage = 'off';
    g.offAt = time - GHOST_OFF * (1 - on);
  }
  const GHOST_ON = 0.45, GHOST_OFF = 0.5; // seconds to pull the sheet on, and off
  // How far on the sheet is at time t, 0..1, eased in and out.
  function sheetOn(g, t) {
    const k = g.stage === 'off' ? 1 - Math.min(1, Math.max(0, (t - g.offAt) / GHOST_OFF)) : Math.min(1, Math.max(0, (t - g.at) / GHOST_ON));
    return k * k * (3 - 2 * k);
  }
  // The sheet: draped over the body's outline (and over what it wears on
  // its head), falling straight from its widest to a scalloped hem at the
  // floor, with two dark eye holes where its eyes are. Pulled on, its edge
  // comes down over the head and body; pulled off, the edge goes back up
  // and the sheet lifts away. No outline (flat, like everything else).
  function drawGhost(b) {
    const g = b.ghost;
    if (!g) return;
    const on = sheetOn(g, time);
    if (on <= 0) return;
    const body = b.body, c = body.centroid(), r = body.o.radius, n = body.n, box = body.bbox();
    // How far out the body reaches from its middle along (dx, dy).
    const reach = (dx, dy) => {
      let best = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = body.px[j] - c.x, ay = body.py[j] - c.y, ex = body.px[i] - body.px[j], ey = body.py[i] - body.py[j];
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const s = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
        if (s > best && u >= 0 && u <= 1) best = s;
      }
      return best || r;
    };
    // The hem trails a little behind as it goes, and sways (eased over the
    // time between frames, so the hops don't jerk it about).
    const since = Math.min(0.1, Math.max(0, time - (g.drawAt ?? time)));
    g.drawAt = time;
    const v = body.velocity(DT);
    const want = Math.max(-r * 0.15, Math.min(r * 0.15, -v.x * 0.03));
    g.trail = (g.trail || 0) + (want - (g.trail || 0)) * (1 - Math.exp(-since * 8));
    const sway = g.trail + Math.sin(time * 3) * r * 0.03;
    // Over the top: the head's own round, puffed out (wider, and taller)
    // just enough to go over what it wears on it, as little as will do.
    // Eased, so a swinging ear doesn't make the sheet twitch.
    let bx = 1.06, by = 1.06, best = Infinity;
    const tips = (body.lookTips || []).map((p) => {
      const tx = (p.x - c.x) / r, ty = (p.y - c.y) / r, d = Math.hypot(tx, ty) || 1, k = 1 + (0.12 + (p.w / r) * 0.25) / d;
      return [tx * k, ty * k];
    }).filter((p) => p[1] < 0);
    for (let sx = 1.06; sx <= 1.5; sx += 0.02) {
      let sy = 1.06;
      for (const [tx, ty] of tips) {
        const q = 1 - (tx / sx) * (tx / sx);
        sy = Math.max(sy, q > 0.08 ? -ty / Math.sqrt(q) : 9);
      }
      if (sy <= 2.4 && sx * sy < best) { best = sx * sy; bx = sx; by = sy; }
    }
    const settle = 1 - Math.exp(-since * 10);
    g.sx = g.sx ? g.sx + (bx - g.sx) * settle : bx;
    g.sy = g.sy ? g.sy + (by - g.sy) * settle : by;
    // (Its skin is only so many points, so straight between them: the
    // sheet smooths over the corners.)
    const M = 32, dome = [];
    let far = [];
    for (let j = 0; j < M; j++) far.push(reach(Math.cos(-Math.PI + (Math.PI * j) / (M - 1)), Math.sin(-Math.PI + (Math.PI * j) / (M - 1))));
    for (let pass = 0; pass < 4; pass++) far = far.map((d, j) => (j === 0 || j === M - 1 ? d : (far[j - 1] + d * 2 + far[j + 1]) / 4));
    for (let j = 0; j < M; j++) {
      const a = -Math.PI + (Math.PI * j) / (M - 1), dx = Math.cos(a), dy = Math.sin(a);
      const R = far[j] + r * 0.03;
      dome.push([c.x + dx * (R + r * (g.sx - 1)), c.y + dy * (R + r * (g.sy - 1))]);
    }
    // From its widest it falls to the floor, flaring a touch.
    const hem = box.maxY + 1, L = dome[0], R = dome[M - 1], flare = r * 0.08;
    const lx = L[0] - flare + sway, rx = R[0] + flare + sway;
    let top = Infinity;
    for (const p of dome) top = Math.min(top, p[1]);
    // Pulled on, the edge comes down from over the head (and the sheet
    // settles onto it); off, it goes back up and the sheet lifts away.
    const lift = g.stage === 'off' ? (1 - on) * (1 - on) * r * 0.9 : (1 - on) * r * 0.25;
    const edge = top - r * 0.15 + (hem + r * 0.25 - (top - r * 0.15)) * on;
    ctx.save();
    if (on < 1) {
      ctx.beginPath();
      ctx.moveTo(box.minX - r, top - r * 3);
      ctx.lineTo(box.maxX + r, top - r * 3);
      for (let k = 0; k <= 12; k++) ctx.lineTo(box.maxX + r - ((box.maxX - box.minX + r * 2) * k) / 12, edge - lift + Math.sin(k * 1.7 + time * 6) * r * 0.03);
      ctx.closePath();
      ctx.clip();
    }
    ctx.translate(0, -lift);
    ctx.fillStyle = '#f6f4f0';
    ctx.beginPath();
    ctx.moveTo(lx, hem);
    const drop = hem - L[1];
    ctx.bezierCurveTo(lx, hem - drop * 0.35, L[0], L[1] + drop * 0.4, L[0], L[1]);
    for (let j = 1; j < M - 1; j++) ctx.quadraticCurveTo(dome[j][0], dome[j][1], (dome[j][0] + dome[j + 1][0]) / 2, (dome[j][1] + dome[j + 1][1]) / 2);
    ctx.lineTo(R[0], R[1]);
    ctx.bezierCurveTo(R[0], R[1] + (hem - R[1]) * 0.4, rx, hem - (hem - R[1]) * 0.35, rx, hem);
    // The hem: soft scallops, fluttering.
    const waves = 5, w = rx - lx;
    for (let k = 0; k < waves; k++) {
      const x0 = rx - (w * k) / waves, x1 = rx - (w * (k + 1)) / waves;
      ctx.quadraticCurveTo((x0 + x1) / 2, hem + r * 0.1 + Math.sin(time * 6 + k * 1.3) * r * 0.03, x1, hem);
    }
    ctx.closePath();
    ctx.fill();
    // Eye holes, where its eyes are under there.
    const ft = b.faceTurn || { x: 0, y: 0 }, st = body.stretch();
    ctx.fillStyle = '#2a2638';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(c.x + (s * r * 0.3 + ft.x) * st.x, c.y + (-r * 0.22 + ft.y) * st.y, r * 0.075, r * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (g.stage === 'boo') { ctx.beginPath(); ctx.ellipse(c.x + ft.x * st.x, c.y + (r * 0.08 + ft.y) * st.y, r * 0.07, r * 0.1, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  // A session going round in circles (steamed up, see struggle): a calm
  // slime nearby now and then hops over, leans in against it and cheers it
  // on ("you got this!"). It gets a moment's smile.
  function comfort(b) {
    if (CFG.comfort <= 0 || b.kind !== 'mother') return;
    const g = b.comforting;
    if (g) {
      const o = g.o;
      if (b.body.grab || o.dying || o.body.grab || !o.stuck || drag || time - g.at > 7 || (b.state !== 'idle' && b.state !== 'done')) { b.comforting = null; return; }
      b.nextHop = time + 1;
      if (!b.body.onFloor() || b.pendingHop || time - g.at < 0.4) return;
      const c = b.body.centroid(), oc = o.body.centroid(), r = b.body.o.radius, d = Math.abs(oc.x - c.x);
      if (d > (r + o.body.o.radius) * 1.8) { if (time - g.at > 2) b.comforting = null; return; }
      // Leaning in against it, a gentle push.
      b.body.lean(Math.sign(oc.x - c.x) * r * 1.4 * Math.min(1.5, CFG.comfort), DT);
      b.body.impulse(-b.body.velocity(DT).x * 0.2, 0, DT);
      b.glanceAt = o; b.glanceUntil = time + 0.3;
      if (!g.said) {
        g.said = true;
        quip(b, ['you got this!', 'there there', "you'll get it!"][Math.floor(Math.random() * 3)], 1.8);
        b.happyUntil = time + 1.5;
        setTimeout(() => { if (!o.dying) { o.glanceAt = b; o.glanceUntil = time + 1; o.blushUntil = time + 1.5; } }, 600);
      }
      return;
    }
    if ((b.state !== 'idle' && b.state !== 'done') || b.body.grab || b.merging || b.dying || !b.body.onFloor() || b.stackedBy || b.tower || b.frog || b.tag || b.parade || b.trick || b.keepy || b.roll || b.measure || b.tot || (b.sleep || 0) > 0.1 || b === buddies.get(talkingTo) || time < (b.nextComfort || 0)) return;
    b.nextComfort = time + 5;
    const c = b.body.centroid(), r = b.body.o.radius;
    const o = [...buddies.values()].find((o) => o !== b && o.stuck && time - o.stuck.since > 4 && !o.body.grab && o.body.onFloor() && time > (o.comfortedUntil || 0) && Math.abs(o.body.centroid().x - c.x) < r * 10 && Math.abs(o.body.centroid().y - c.y) < r * 1.5);
    if (!o || Math.random() > 0.5 * CFG.comfort) return;
    o.comfortedUntil = time + 60;
    b.nextComfort = time + 40;
    b.comforting = { o, at: time };
    const oc = o.body.centroid(), side = Math.sign(c.x - oc.x) || 1, tx = oc.x + side * (o.body.o.radius + r) * 1.02;
    if (Math.abs(tx - c.x) > r * 0.3) { const v = launch(tx - c.x, r * 0.6); b.body.impulse(-b.body.velocity(DT).x, 0, DT); b.hop(v.vx, v.vy); }
  }
  function totNow(b, o) {
    const c = b.body.centroid(), r = b.body.o.radius, oc = o.body.centroid();
    const side = Math.sign(c.x - oc.x) || 1, tx = oc.x + side * (o.body.o.radius + r * 1.1);
    b.tot = { o, stage: 'go', at: time };
    o.totBy = b;
    if (Math.abs(tx - c.x) > r * 0.3) { const v = launch(tx - c.x, r * 0.6); b.body.impulse(-b.body.velocity(DT).x, 0, DT); b.hop(v.vx, v.vy); }
  }

  function prankNow(b, o) {
    // Land just beside it, on the near side.
    const c = b.body.centroid(), r = b.body.o.radius, oc = o.body.centroid();
    const side = Math.sign(c.x - oc.x) || 1, tx = oc.x + side * (o.body.o.radius + r * 1.05);
    const vy = 300, air = 2 * vy / CFG.gravity;
    b.prank = { o, stage: 'sneak', at: time };
    b.hop((tx - c.x) / air * 0.8, -vy);
  }

  // Bored but awake (idle, you're around): now and then it amuses itself
  // with a little trick, three hops, each higher than the last.
  // A calm slime nearby may watch and copy it, hop for hop, a beat behind;
  // its last one falls a little short, and the first one says "copycat!".
  function trick(b) {
    if (CFG.tricks <= 0 || b.kind === 'child') return;
    const ok = b.state === 'idle' && !b.body.grab && !b.merging && !b.prank && !b.tag && !b.snow && !b.parade && !b.frog && !b.tower && !b.rope && !b.seek && !b.pile && (b.sleep || 0) < 0.1 && (idleFor() < 30 || showingOff) && b !== buddies.get(talkingTo);
    const c = b.copy;
    if (c) {
      if (!ok || c.lead.dying || time - c.start > 12) { b.copy = null; return; }
      b.nextHop = time + 1;
      b.glanceAt = c.lead; b.glanceUntil = time + 0.3;
      if (!b.body.onFloor()) c.up = true;
      const h = c.hops[0];
      if (h && time > h.at && b.body.onFloor() && !b.pendingHop && (h.n === 1 || c.up)) { // (each from the ground, like the leader)
        c.hops.shift();
        c.up = false;
        b.hop(h.vx, h.vy * (h.n >= 3 ? 0.8 : 1));
        if (h.n >= 3) {
          b.copy = null;
          b.happyUntil = time + 1.5;
          if (!c.lead.dying && Math.random() < 0.7) setTimeout(() => { if (!c.lead.dying) { quip(c.lead, 'copycat!', 1.2); c.lead.glanceAt = b; c.lead.glanceUntil = time + 1.2; } }, 700);
        }
      }
      return;
    }
    if (b.trick) {
      if (!ok) { b.trick = null; b.forceFlip = false; return; }
      if (!b.body.onFloor()) { b.trick.up = true; return; }
      if (b.pendingHop || time < b.trick.next || (b.trick.n && !b.trick.up)) return; // (each from the ground)
      if (b.trick.n >= 3) { b.trick = null; b.forceFlip = false; b.happyUntil = time + 1.5; return; }
      b.trick.n++;
      b.trick.up = false;
      const vx = (Math.random() - 0.5) * 40, vy = -(240 + b.trick.n * 130) * Math.min(1.4, CFG.tricks);
      b.hop(vx, vy);
      // Now and then the last one's a somersault.
      if (b.trick.n === 3 && (Math.random() < 0.45 * CFG.flips || (b.forceFlip && CFG.flips > 0))) b.flip = { dir: Math.random() < 0.5 ? -1 : 1, vy, at: time };
      const o = b.trick.copy;
      if (o && o.copy) o.copy.hops.push({ at: time + 0.45, vx, vy, n: b.trick.n });
      b.trick.next = time + 0.12;
      return;
    }
    if (!ok || !b.body.onFloor() || time < (b.nextTrick ?? (b.nextTrick = time + (120 + Math.random() * 240) / CFG.tricks))) return;
    b.nextTrick = time + (180 + Math.random() * 300) / CFG.tricks;
    startTrick(b, Math.random() < CFG.copycat);
  }
  function startTrick(b, copied) {
    b.trick = { n: 0, next: time };
    if (!copied || CFG.copycat <= 0) return;
    const p = b.body.centroid(), r = b.body.o.radius;
    const o = [...buddies.values()].find((o) => o !== b && o.kind !== 'child' && o.state === 'idle' && !o.trick && !o.copy && !o.tag && !o.prank && !o.body.grab && !o.merging && !o.dying && (o.sleep || 0) < 0.1 && o.body.onFloor() && Math.abs(o.body.centroid().x - p.x) < r * 8);
    if (o) { b.trick.copy = o; o.copy = { lead: b, hops: [], start: time }; }
  }

  // Two bored slimes now and then play tag: one hops after the other, which
  // hops away grinning; a bump and "tag!", and the other is it. A few
  // rounds, then they're done.
  function tag(b) {
    if (CFG.play <= 0 || b.kind === 'child') return;
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.ghost && !o.ghostBy && !o.prank && !o.trick && !o.snow && !o.parade && !o.frog && !o.tower && !o.rope && !o.seek && !o.pile && !o.balloon && !o.shape && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
    const g = b.tag;
    if (g) {
      if (g.p !== b) return; // (one of the pair runs the game)
      const it = g.it, run = it === g.p ? g.q : g.p;
      if (!free(g.p) || !free(g.q) || drag || time - g.start > 30) { endTag(g); return; }
      g.p.nextHop = g.q.nextHop = time + 1;
      it.happyUntil = run.happyUntil = time + 0.3;
      const ib = it.body.bbox(), rb = run.body.bbox(), ic = it.body.centroid(), rc = run.body.centroid();
      const gap = Math.max(rb.minX - ib.maxX, ib.minX - rb.maxX), dx = rc.x - ic.x, r = it.body.o.radius;
      if (gap < 3 && Math.abs(ic.y - rc.y) < r * 2 && time > g.next) {
        // Tagged!
        quip(it, 'tag!', 0.9);
        run.body.impulse(Math.sign(dx) * 140, -60, DT);
        run.startleUntil = time + 0.3;
        if (++g.n >= g.rounds) { endTag(g); return; }
        g.it = run;
        g.next = time + 0.9; // (counting to three)
        g.flee = time;
        return;
      }
      const k = Math.min(1.5, CFG.play);
      if (time > g.next && it.body.onFloor() && !it.pendingHop) {
        g.next = time + 0.3;
        it.hop(Math.max(-420, Math.min(420, dx * 1.6)) * k, -(230 + Math.random() * 90) * Math.min(1.3, k));
      }
      if (time > g.flee && run.body.onFloor() && !run.pendingHop && Math.abs(dx) < r * 5) {
        g.flee = time + 0.45 + Math.random() * 0.35;
        // Away from it, unless there's a wall behind: then over its head.
        let dir = Math.sign(dx) || 1;
        if ((dir > 0 && rb.maxX > W - r * 1.5) || (dir < 0 && rb.minX < r * 1.5)) dir = -dir;
        run.hop(dir * (220 + Math.random() * 140) * k, -(260 + Math.random() * 120) * Math.min(1.3, k));
      }
      return;
    }
    if (!free(b) || !b.body.onFloor() || idleFor() > 60 || time < (b.nextTag ?? (b.nextTag = time + (150 + Math.random() * 300) / CFG.play))) return;
    b.nextTag = time + (300 + Math.random() * 600) / CFG.play;
    const c = b.body.centroid(), r = b.body.o.radius;
    const others = [...buddies.values()].filter((o) => o !== b && o.kind !== 'child' && !o.tag && free(o) && o.body.onFloor() && Math.abs(o.body.centroid().y - c.y) < r && Math.abs(o.body.centroid().x - c.x) < r * 10);
    if (!others.length) return;
    tagNow(b, others[Math.floor(Math.random() * others.length)]);
  }
  // Leapfrog: two bored slimes side by side take turns hopping right over
  // each other along the floor, the one underneath ducking down for it.
  function leapfrog(b) {
    if (CFG.leapfrog <= 0 || b.kind !== 'mother') return;
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.ghost && !o.ghostBy && !o.prank && !o.trick && !o.tag && !o.snow && !o.parade && !o.copy && !o.five && !o.tower && !o.rope && !o.seek && !o.pile && !o.balloon && !o.shape && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
    const g = b.frog;
    if (g) {
      if (g.p !== b) return; // (one of the pair runs the game)
      const { jumper: j, under: u } = g;
      const end = (happy) => {
                g.p.frog = g.q.frog = null;
        if (happy) { j.happyUntil = u.happyUntil = time + 1.5; quip(u, 'hehe', 1); }
      };
      if (!free(g.p) || !free(g.q) || drag || time - g.start > 25) { end(false); return; }
      g.p.nextHop = g.q.nextHop = time + 1;
      j.happyUntil = u.happyUntil = time + 0.3;
      if (time < g.next) return;
      const jc = j.body.centroid(), uc = u.body.centroid(), jr = j.body.o.radius, ur = u.body.o.radius;
      if (!g.up) {
        // Over it goes: high enough to clear its head, far enough to land past it.
        if (!j.body.onFloor() || j.pendingHop || !u.body.onFloor()) return;
        const land = uc.x + g.dir * (ur + jr) * 1.15;
        if (land < jr * 1.3 || land > W - jr * 1.3) { end(true); return; }
        const v = launch(land - jc.x, ur * 2.2 + jr * 0.25), jv = j.body.velocity(DT);
        j.body.impulse(-jv.x, 0, DT); // (from a standstill, so it lands where it means to)
        j.hop(v.vx, v.vy);
        u.body.squashTop(240, DT); // (ducks down for it)
        g.up = true;
        return;
      }
      if (j.body.onFloor() && !j.pendingHop && (jc.x - uc.x) * g.dir > 0) {
        // Landed past it: now it's the other's turn.
        g.up = false;
        if (++g.n >= g.rounds) { end(true); return; }
        g.jumper = u; g.under = j;
        g.next = time + 0.35;
      } else if (j.body.onFloor() && !j.pendingHop && time - g.next > 2.5) end(false); // (fell short)
      return;
    }
    if (!free(b) || !b.body.onFloor() || idleFor() > 60 || time < (b.nextFrog ?? (b.nextFrog = time + (200 + Math.random() * 400) / CFG.leapfrog))) return;
    b.nextFrog = time + (400 + Math.random() * 600) / CFG.leapfrog;
    const c = b.body.centroid(), r = b.body.o.radius;
    const o = [...buddies.values()].find((o) => o !== b && o.kind === 'mother' && !o.frog && free(o) && o.body.onFloor() && Math.abs(o.body.centroid().y - c.y) < r && Math.abs(o.body.centroid().x - c.x) < r * 3.5);
    if (o) frogNow(b, o);
  }
  // The take-off speed for a hop that rises h px and comes down dx px
  // along (onto something up px higher), with the air slowing it as the
  // bodies' damping does.
  function launch(dx, h, up = 0) {
    const d = CFG.damping, g = CFG.gravity;
    let vy = Math.sqrt(2 * g * h);
    for (let tries = 0; tries < 40; tries++, vy *= 1.04) {
      let y = 0, v = -vy, peak = 0, n = 0;
      while (n < 2000) { v = (v + g * DT) * d; y += v * DT; n++; peak = Math.min(peak, y); if (y >= -up && v > 0) break; }
      if (-peak < h) continue;
      const along = DT * (1 - Math.pow(d, n)) / (1 - d); // (distance per unit of take-off speed)
      return { vx: dx / along, vy: -vy };
    }
    return { vx: dx, vy: -vy };
  }

  function frogNow(b, o) {
    // Off toward the roomier side, the one behind going first.
    const bx = b.body.centroid().x, ox = o.body.centroid().x, dir = (bx + ox) / 2 < W / 2 ? 1 : -1;
    const [first, second] = (ox - bx) * dir > 0 ? [b, o] : [o, b];
    const g = { p: b, q: o, jumper: first, under: second, dir, n: 0, rounds: 4 + Math.floor(Math.random() * 3), start: time, next: time + 0.7, up: false };
    b.frog = o.frog = g;
    second.glanceAt = first; second.glanceUntil = time + 1;
    quip(b, 'leapfrog!', 1.1);
  }

  // A tower: one bored slime hops up onto another's head ("tower!") and
  // stands up tall there, wobbling, the one underneath bracing and
  // grinning, until it hops down.
  function tower(b) {
    if (CFG.tower <= 0 || b.kind !== 'mother') return;
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.ghost && !o.ghostBy && !o.prank && !o.trick && !o.tag && !o.snow && !o.parade && !o.copy && !o.five && !o.frog && !o.balloon && !o.rope && !o.seek && !o.pile && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
    const g = b.tower;
    if (g) {
      if (g.line[0] !== b) return; // (the bottom one runs it)
      const end = (happy) => {
        for (const o of g.line) o.tower = null;
        if (happy) { for (const o of g.line) o.happyUntil = time + 1.5; quip(b, 'hehe', 1); }
      };
      if (g.line.some((o) => !free(o) || (o !== b && o.stackedBy && !g.line.includes(o.stackedBy))) || drag || time - g.start > 16) { end(false); return; }
      for (const o of g.line) { o.nextHop = time + 1; o.happyUntil = time + 0.3; }
      const top = g.line[g.line.length - 1], under = g.line[g.line.length - 2];
      if (g.stage === 'climb') {
        if (time < g.next) return;
        if (!g.jumped) {
          if (!top.body.onFloor() || top.pendingHop) return;
          const tc = top.body.centroid(), uc = under.body.centroid(), ub = under.body.bbox();
          const rise = Math.max(20, top.body.bbox().maxY - ub.minY), v = launch(uc.x - tc.x, rise + top.body.o.radius * 0.8, rise), tv = top.body.velocity(DT);
          top.body.impulse(-tv.x, 0, DT);
          top.hop(v.vx, v.vy);
          g.jumped = time;
          return;
        }
        // Coming down onto it: it steers for the middle of its head.
        const tc = top.body.centroid(), uc = under.body.centroid();
        if (time - g.jumped > 0.3 && tc.y < uc.y - under.body.o.radius * 0.4 && Math.abs(tc.x - uc.x) < (top.body.o.radius + under.body.o.radius) * 0.8) {
          top.body.impulse(((uc.x - tc.x) * 4 - top.body.velocity(DT).x) * 0.3, 0, DT);
          under.body.impulse(-under.body.velocity(DT).x * 0.2, 0, DT);
        }
        if (under.stackedBy === top && time - g.jumped > 0.5) {
          // Up! It stands tall and finds its balance.
          g.stage = 'stand'; g.at = time;
          under.surpriseUntil = time + 0.4;
          return;
        }
        if (time - g.jumped > 2.2) { // (missed: off it slid)
          quip(top, 'whoops', 1); end(false);
        }
        return;
      }
      // Standing: the one on top stretches up tall, wobbling to keep its
      // balance (leaning back over the middle), and the bottom one braces.
      const t = time - g.at, k = Math.min(1.5, CFG.tower);
      if (under.stackedBy !== top) { g.off = g.off || time; if (time - g.off > 0.4) { quip(top, 'whoa!', 1); end(false); } return; }
      g.off = 0;
      const tc = top.body.centroid(), uc = under.body.centroid(), tr = top.body.o.radius;
      top.body.squashTop(-k * tr * 0.5 * 60 * DT, DT);
      top.body.lean(Math.max(-1, Math.min(1, (uc.x - tc.x) / tr)) * tr * 6 * DT, DT);
      top.body.impulse(((uc.x - tc.x) * 4 - top.body.velocity(DT).x) * 0.3, 0, DT);
      under.body.squashTop(k * under.body.o.radius * 0.25 * 60 * DT, DT); // (a flat seat for it)
      for (const o of g.line) if (o !== top && o.body.onFloor()) o.body.impulse(-o.body.velocity(DT).x * 0.2, 0, DT); // (feet planted)
      if (t > 0.6 && !g.tada) { g.tada = true; quip(top, 'ta-da!', 1.2); top.cheerUntil = time + 1.2; }
      if (t > 3.4) {
        // Down it comes: a hop off to the roomier side.
        const side = tc.x < W / 2 ? 1 : -1;
        top.hop(side * 260, -360);
        end(true);
      }
      return;
    }
    if (!free(b) || b.stackedBy || !b.body.onFloor() || idleFor() > 60 || time < (b.nextTower ?? (b.nextTower = time + (250 + Math.random() * 450) / CFG.tower))) return;
    b.nextTower = time + (500 + Math.random() * 700) / CFG.tower;
    const c = b.body.centroid(), r = b.body.o.radius;
    const o = [...buddies.values()].find((o) => o !== b && o.kind === 'mother' && !o.tower && !o.rope && !o.seek && !o.pile && free(o) && !o.stackedBy && o.body.onFloor() && Math.abs(o.body.centroid().y - c.y) < r && Math.abs(o.body.centroid().x - c.x) < r * 4);
    if (o) towerNow(b, o);
  }
  // "Who's taller?": two bored slimes side by side stand back to back and
  // stretch up as tall as they can. The taller one grins ("me!"), and now
  // and then the shorter one cheats with a little hop ("ha!").
  function measure(b) {
    if (CFG.measure <= 0 || b.kind !== 'mother') return;
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.ghost && !o.ghostBy && !o.prank && !o.trick && !o.tag && !o.snow && !o.parade && !o.copy && !o.five && !o.frog && !o.tower && !o.rope && !o.seek && !o.pile && !o.keepy && !o.roll && !o.balloon && !o.shape && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
    const g = b.measure;
    if (g) {
      if (g.p !== b) return;
      const both = [g.p, g.q], end = () => { g.p.measure = g.q.measure = null; };
      if (both.some((o) => !free(o)) || drag || time - g.start > 10) { end(); return; }
      for (const o of both) { o.nextHop = time + 1; }
      const t = time - g.start, k = Math.min(1.5, CFG.measure);
      // Back to back: each leans away from the other a touch and grips.
      const pc = g.p.body.centroid(), qc = g.q.body.centroid(), side = Math.sign(qc.x - pc.x) || 1;
      if (t < 0.6) return;
      // Up they stretch, hold it, and ease back down (let go all at once
      // and the stretch would spring them off the floor).
      const up = Math.min(1, (t - 0.6) / 0.8) * Math.max(0, Math.min(1, (3.9 - t) / 0.7));
      if (up > 0 && !g.cheated) for (const o of both) {
        const r = o.body.o.radius, s = o === g.p ? -side : side;
        if (o.body.onFloor()) {
          o.body.squashTop(-k * r * up * (o.reach || 1) * 2.2 * 60 * DT, DT);
          o.body.impulse(-o.body.velocity(DT).x * 0.2, 0, DT);
        } else o.body.impulse(0, Math.max(0, -o.body.velocity(DT).y) * 0.3, DT); // (feet stay down: no hopping to look taller)
        if (t < 3.2) { o.glanceAt = { spot: { x: o.body.centroid().x + s * r, y: o.body.bbox().minY - r } }; o.glanceUntil = time + 0.2; }
      }
      if (t < 3.2) {
        if (!g.said) { g.said = true; quip(g.p, "who's taller?", 1.6); }
        return;
      }
      if (!g.judged) {
        g.judged = true;
        const top = (o) => o.body.bbox().minY; // (whose head is higher)
        const [tall, short] = top(g.p) <= top(g.q) ? [g.p, g.q] : [g.q, g.p];
        g.tall = tall; g.short = short;
        tall.cheerUntil = time + 1.4; quip(tall, 'me!', 1.2);
        short.sheepishUntil = time + 1.4;
        g.cheat = Math.random() < 0.4;
        return;
      }
      if (g.cheat && t > 4 && !g.cheated) {
        g.cheated = true;
        g.short.hop(0, -360);
        quip(g.short, 'ha!', 1);
        g.short.cheerUntil = time + 1.2; g.tall.annoyedAt = g.short; g.tall.annoyedUntil = time + 1.2; g.tall.cheerUntil = 0;
        return;
      }
      if (t > (g.cheat ? 5.5 : 4.5)) end();
      return;
    }
    if (!free(b) || !b.body.onFloor() || idleFor() > 60 || time < (b.nextMeasure ?? (b.nextMeasure = time + (250 + Math.random() * 500) / CFG.measure))) return;
    b.nextMeasure = time + (500 + Math.random() * 800) / CFG.measure;
    const c = b.body.centroid(), r = b.body.o.radius;
    const o = [...buddies.values()].find((o) => o !== b && o.kind === 'mother' && !o.measure && free(o) && o.body.onFloor() && Math.abs(o.body.centroid().y - c.y) < r && Math.abs(o.body.centroid().x - c.x) < (r + o.body.o.radius) * 1.6);
    if (o) measureNow(b, o);
  }
  function measureNow(b, o) {
    const g = { p: b, q: o, start: time };
    b.measure = o.measure = g;
    // Each stretches a bit differently (its own character).
    b.reach = 0.8 + Math.random() * 0.4; o.reach = 0.8 + Math.random() * 0.4;
    // Sidle up so they're touching, back to back.
    const bc = b.body.centroid(), oc = o.body.centroid(), gap = Math.abs(oc.x - bc.x) - (b.body.o.radius + o.body.o.radius) * 0.95;
    if (gap > 8) { const v = launch(Math.sign(oc.x - bc.x) * gap, b.body.o.radius * 0.3); b.body.impulse(-b.body.velocity(DT).x, 0, DT); b.hop(v.vx, v.vy); }
    o.glanceAt = b; o.glanceUntil = time + 0.6;
  }

  // Skipping rope: with three bored slimes about, two of them take the ends
  // of a rope and swing it round, and the one in the middle jumps it
  // each time it comes under, counting, until it gets caught ("oof!") or
  // sets a record. One rope at a time.
  let rope = null;
  const ROPE_T = 0.95; // (one turn of the rope, s)
  function skipRope(b) {
    if (CFG.skipRope <= 0 || b.kind !== 'mother') return;
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.ghost && !o.ghostBy && !o.prank && !o.trick && !o.tag && !o.snow && !o.parade && !o.copy && !o.five && !o.frog && !o.tower && !o.rope && !o.seek && !o.pile && !o.keepy && !o.measure && !o.roll && !o.balloon && !o.shape && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
    const g = rope;
    if (g) {
      if (g.j !== b) return;
      const all = [g.l, g.r, g.j], end = () => { for (const o of all) o.rope = null; rope = null; };
      if (all.some((o) => o.dying || o.body.grab || o.merging) || time - g.start > 40) { end(); return; }
      for (const o of all) o.nextHop = time + 1;
      const t = time - g.start, k = Math.min(1.5, CFG.skipRope);
      const jc = g.j.body.centroid(), rj = g.j.body.o.radius;
      if (g.stage === 'gather') {
        // The holders take their places either side, a rope's length apart.
        if (!g.moved) {
          g.moved = true;
          for (const [o, s] of [[g.l, -1], [g.r, 1]]) {
            const c = o.body.centroid(), want = jc.x + s * (rj + o.body.o.radius + rj * 1.6);
            const dx = Math.max(o.body.o.radius - c.x, Math.min(W - o.body.o.radius - c.x, want - c.x));
            if (Math.abs(dx) > 10) { const v = launch(dx, o.body.o.radius * 0.4); o.body.impulse(-o.body.velocity(DT).x, 0, DT); o.hop(v.vx, v.vy); }
          }
          quip(g.j, Math.random() < 0.5 ? 'skipping!' : 'rope!', 1.2);
        }
        if (t > 1.6 && all.every((o) => o.body.onFloor())) { g.stage = 'swing'; g.at = time; g.phase = Math.PI; g.n = 0; }
        return;
      }
      if (g.stage === 'swing') {
        const tp = time - g.at, before = g.phase;
        // Slow for the first turn, then up to speed.
        g.phase += (Math.PI * 2 / ROPE_T) * Math.min(1, 0.55 + tp * 0.3) * (time - (g.lastStep ?? time));
        g.lastStep = time;
        const turn = Math.floor(g.phase / (Math.PI * 2)), crossed = Math.floor(before / (Math.PI * 2)) < turn;
        // The holders swing it round: a little lean in time with it.
        for (const [o, s] of [[g.l, 1], [g.r, -1]]) {
          o.body.lean(s * Math.cos(g.phase) * o.body.o.radius * 12 * k * DT, DT);
          o.body.impulse(-o.body.velocity(DT).x * 0.2, 0, DT);
          o.glanceAt = g.j; o.glanceUntil = time + 0.2;
          o.cheerUntil = time + 0.2;
        }
        // Jump so it's at the top as the rope comes under.
        const j = g.j.body, v = j.velocity(DT), toBottom = ((Math.PI * 2 - (g.phase % (Math.PI * 2))) / (Math.PI * 2)) * ROPE_T;
        const air = 0.5, vy = air * CFG.gravity / 2;
        g.j.glanceAt = { spot: { x: jc.x, y: g.ground } }; g.j.glanceUntil = time + 0.1;
        // Now and then it's a beat late (more so the longer it goes on).
        if (g.turn !== turn) { g.turn = turn; g.late = Math.random() < 0.06 + 0.025 * g.n ? 0.2 : 0; }
        const at = air / 2 - g.late;
        if (j.onFloor() && toBottom < at + 0.03 && toBottom > at - 0.08 && time > (g.jumped || 0) + 0.4) {
          g.jumped = time;
          j.impulse(-v.x * 0.8 + (g.home - jc.x) * 1.5, -vy - v.y, DT);
        }
        if (crossed) {
          const clear = j.bbox().maxY < g.ground - 6;
          if (clear || tp < ROPE_T) { // (the first time round it's still getting going)
            if (clear) { g.n++; quip(g.j, g.n + '!', 0.6); }
            if (g.n >= g.record) {
              g.stage = 'done'; g.at = time;
              for (const o of all) { o.cheerUntil = time + 1.6; spawnHeart({ x: o.body.centroid().x, y: o.body.bbox().minY - 8, vx: 0, born: time, size: 11 }); }
              quip(g.j, 'yay!', 1.3);
            }
          } else {
            // Caught: it trips over the rope.
            g.stage = 'caught'; g.at = time;
            j.impulse((Math.random() < 0.5 ? -1 : 1) * 120, -160, DT);
            g.j.dizzyUntil = time + 0.8; quip(g.j, 'oof!', 1);
            g.l.cheerUntil = g.r.cheerUntil = time + 1.2;
            g.j.sheepishUntil = time + 2;
          }
        }
        return;
      }
      if ((g.stage === 'done' || g.stage === 'caught') && time - g.at > 0.4) {
        // The rope goes slack and falls, then is put away.
        g.slack = Math.min(1, (time - g.at - 0.4) / 0.5);
        if (time - g.at > 1.6) end();
      }
      return;
    }
    if (!free(b) || !b.body.onFloor() || idleFor() > 60 || time < (b.nextRope ?? (b.nextRope = time + (300 + Math.random() * 600) / CFG.skipRope))) return;
    b.nextRope = time + (600 + Math.random() * 900) / CFG.skipRope;
    const others = [...buddies.values()].filter((o) => o !== b && o.kind === 'mother' && free(o) && o.body.onFloor() && Math.abs(o.body.bbox().maxY - b.body.bbox().maxY) < 10);
    if (others.length < 2) return;
    const c = b.body.centroid();
    others.sort((p, q) => Math.abs(p.body.centroid().x - c.x) - Math.abs(q.body.centroid().x - c.x));
    ropeNow(b, others[0], others[1]);
  }
  function ropeNow(j, p, q) {
    const r = j.body.o.radius, need = r * 2 + p.body.o.radius * 2 + q.body.o.radius * 2 + r * 3.2;
    const box = j.body.bbox();
    if (W < need) return;
    // Room either side for the holders, or it shuffles toward the middle.
    const home = Math.max(need / 2, Math.min(W - need / 2, (box.minX + box.maxX) / 2));
    const [l, rr] = p.body.centroid().x < q.body.centroid().x ? [p, q] : [q, p];
    rope = { j, l, r: rr, stage: 'gather', start: time, home, ground: box.maxY, record: 5 + Math.floor(Math.random() * 8) };
    j.rope = l.rope = rr.rope = rope;
    if (Math.abs(home - (box.minX + box.maxX) / 2) > 10) { const v = launch(home - (box.minX + box.maxX) / 2, r * 0.3); j.hop(v.vx, v.vy); }
    l.glanceAt = rr.glanceAt = j; l.glanceUntil = rr.glanceUntil = time + 1;
  }
  // The rope: from one holder's hand to the other's, swinging round. Seen
  // side on, it's an arc that dips to the floor and swings up over the
  // jumper's head; drawn behind the slimes on the way over, in front on
  // the way under.
  function drawRope(back) {
    const g = rope;
    if (!g || g.stage === 'gather') return;
    const A = g.l.body, B = g.r.body, ac = A.centroid(), bc = B.centroid();
    const ax = ac.x + A.o.radius * 0.8, ay = ac.y + A.o.radius * 0.1, bx = bc.x - B.o.radius * 0.8, by = bc.y + B.o.radius * 0.1;
    const s = Math.sin(g.phase || 0), co = Math.cos(g.phase || 0);
    if ((s > 0) !== back) return;
    const hand = (ay + by) / 2, down = g.ground - 3 - hand, up = hand - (g.j.body.bbox().minY - g.j.body.o.radius * 0.5);
    let mid = hand + (co > 0 ? down * co : up * co);
    if (g.slack) mid = mid + (g.ground - 2 - mid) * g.slack;
    const mx = (ax + bx) / 2, cy = 2 * mid - (ay + by) / 2; // (a quadratic's middle is halfway to its control point)
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = g.l.color;
    ctx.lineWidth = Math.max(3, Math.min(A.o.radius, B.o.radius) * 0.07);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, cy, bx, by); ctx.stroke();
    ctx.restore();
  }

  // Hide and seek: one bored slime shuts its eyes and counts while the
  // others hop off to the far corners and crouch down low, peeking. Then
  // "ready or not!": it hops about looking for them, and each one it gets
  // to jumps ("eep!") and is found.
  let seekGame = null;
  function hideSeek(b) {
    if (CFG.hideSeek <= 0 || b.kind !== 'mother') return;
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.ghost && !o.ghostBy && !o.prank && !o.trick && !o.tag && !o.snow && !o.parade && !o.copy && !o.five && !o.frog && !o.tower && !o.rope && !o.seek && !o.pile && !o.keepy && !o.measure && !o.roll && !o.balloon && !o.shape && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
    const g = seekGame;
    if (g) {
      if (g.s !== b) return;
      const all = [g.s, ...g.hiders], end = () => { for (const o of all) o.seek = null; seekGame = null; };
      if (g.s.dying || g.s.body.grab || g.s.state === 'working' || time - g.start > 45) { end(); return; }
      // A hider you pick up (or that gets busy) is out.
      for (const o of g.hiders) if (!o.found && (o.dying || o.body.grab || o.state === 'working' || o.state === 'waiting')) { o.found = true; o.seek = null; }
      for (const o of all) o.nextHop = time + 1;
      const t = time - g.start, sc = g.s.body.centroid(), r = g.s.body.o.radius;
      if (g.stage === 'count') {
        g.s.countingUntil = time + 0.2;
        const n = Math.floor(t / 1.1) + 1;
        if (n !== g.said && n <= 3) { g.said = n; quip(g.s, n + '…', 0.9); }
        // Off they go, to the far side (each its own spot).
        if (!g.sent && t > 0.3) {
          g.sent = true;
          g.hiders.forEach((o, i) => {
            const c = o.body.centroid(), ro = o.body.o.radius, dir = c.x === sc.x ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(c.x - sc.x);
            const edge = dir > 0 ? W - ro * 1.1 - i * ro * 2.4 : ro * 1.1 + i * ro * 2.4;
            o.spot = Math.max(ro, Math.min(W - ro, Math.abs(edge - sc.x) > r * 3 ? edge : c.x + dir * r * 3));
          });
        }
        for (const o of g.hiders) {
          if (o.found || !o.body.onFloor() || o.pendingHop) continue;
          const c = o.body.centroid(), dx = o.spot - c.x, ro = o.body.o.radius;
          if (Math.abs(dx) > ro * 0.4 && time > (o.seekHop || 0)) {
            o.seekHop = time + 0.45;
            const v = launch(Math.sign(dx) * Math.min(Math.abs(dx), ro * 5), ro * 0.8);
            o.body.impulse(-o.body.velocity(DT).x, 0, DT);
            o.hop(v.vx, v.vy);
          }
        }
        if (t > 3.4) { g.stage = 'seek'; g.at = time; quip(g.s, 'ready or not!', 1.3); g.next = time + 1.2; }
        return;
      }
      // Hiding: crouched down low, peeking.
      for (const o of g.hiders) if (!o.found && o.body.onFloor() && !o.pendingHop) {
        o.body.squashTop(o.body.o.radius * 0.35 * 60 * DT, DT);
        o.body.impulse(-o.body.velocity(DT).x * 0.3, 0, DT);
        o.hiding = time + 0.2;
        o.glanceAt = g.s; o.glanceUntil = time + 0.2;
      }
      if (g.stage === 'seek') {
        const left = g.hiders.filter((o) => !o.found);
        if (!left.length) {
          g.stage = 'done'; g.at = time;
          for (const o of all) o.cheerUntil = time + 1.5;
          quip(g.s, 'found everyone!', 1.4);
          return;
        }
        // Looking about as it goes: this way, that way.
        if (time > (g.look || 0)) { g.look = time + 0.6 + Math.random() * 0.5; g.s.glanceAt = { spot: { x: sc.x + (Math.random() < 0.5 ? -1 : 1) * r * 3, y: sc.y - r * Math.random() } }; g.s.glanceUntil = g.look; }
        const near = left.reduce((p, q) => (Math.abs(q.body.centroid().x - sc.x) < Math.abs(p.body.centroid().x - sc.x) ? q : p));
        const dx = near.body.centroid().x - sc.x;
        if (Math.abs(dx) < r + near.body.o.radius * 1.3) {
          // Found you!
          near.found = true; near.hiding = 0;
          near.surpriseUntil = time + 0.5;
          near.hop(0, -300);
          quip(near, 'eep!', 0.9);
          g.s.cheerUntil = time + 1; quip(g.s, 'found you!', 1.1);
          g.s.glanceAt = near; g.s.glanceUntil = time + 1;
          g.next = time + 1.3;
          return;
        }
        if (time > g.next && g.s.body.onFloor() && !g.s.pendingHop) {
          // A few hops at a time, stopping to look; it doesn't know where
          // they went, so now and then it tries the wrong way first.
          g.next = time + 0.7 + Math.random() * 0.6;
          const wrong = !g.wrong && Math.random() < 0.3;
          if (wrong) g.wrong = true;
          const step = Math.sign(dx) * (wrong ? -1 : 1) * Math.min(Math.abs(dx) - (r + near.body.o.radius) * 0.9, r * 3);
          const room = Math.max(r - sc.x, Math.min(W - r - sc.x, step));
          const v = launch(room, r * 0.7);
          g.s.body.impulse(-g.s.body.velocity(DT).x, 0, DT);
          g.s.hop(v.vx, v.vy);
        }
        return;
      }
      if (g.stage === 'done' && time - g.at > 1.8) end();
      return;
    }
    if (!free(b) || !b.body.onFloor() || idleFor() > 60 || time < (b.nextSeek ?? (b.nextSeek = time + (300 + Math.random() * 600) / CFG.hideSeek))) return;
    b.nextSeek = time + (600 + Math.random() * 900) / CFG.hideSeek;
    const others = [...buddies.values()].filter((o) => o !== b && o.kind === 'mother' && free(o) && o.body.onFloor());
    if (!others.length) return;
    seekNow(b, others.slice(0, 3));
  }
  function seekNow(s, hiders) {
    seekGame = { s, hiders, stage: 'count', start: time };
    for (const o of [s, ...hiders]) { o.seek = seekGame; o.found = false; }
    for (const o of hiders) { o.glanceAt = s; o.glanceUntil = time + 0.5; }
  }

  // Dogpile: with three or more bored slimes about, one now and then shouts
  // "dogpile!" and jumps on another, and the rest pile on after it, one on
  // top of the next. The one at the bottom squishes down under them all,
  // giggling, until the pile topples and everyone tumbles off laughing.
  let pileGame = null;
  function dogpile(b) {
    if (CFG.dogpile <= 0 || b.kind !== 'mother') return;
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.ghost && !o.ghostBy && !o.prank && !o.trick && !o.tag && !o.snow && !o.parade && !o.copy && !o.five && !o.frog && !o.tower && !o.rope && !o.seek && !o.pile && !o.keepy && !o.measure && !o.roll && !o.balloon && !o.shape && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
    const g = pileGame;
    if (g) {
      if (g.bottom !== b) return;
      const all = [g.bottom, ...g.climbers], end = () => { for (const o of all) o.pile = null; pileGame = null; };
      if (all.some((o) => o.dying || o.merging || o.state === 'working') || g.bottom.body.grab || time - g.start > 16) { end(); return; }
      for (const o of all) o.nextHop = time + 1;
      const t = time - g.start, bc = g.bottom.body.centroid();
      // Who's up there: each one sitting on the one below it.
      for (const o of g.climbers) o.pileOn = !!(o.pileUnder && o.pileUnder.stackedBy === o && (o.pileUnder === g.bottom || o.pileUnder.pileOn));
      const onPile = g.climbers.filter((o) => o.pileOn && !o.body.grab);
      const peak = onPile.length ? onPile[onPile.length - 1] : g.bottom;
      // Squished under them all, and loving it.
      if (onPile.length) {
        g.bottom.body.squashTop(g.bottom.body.o.radius * (0.2 + 0.12 * onPile.length) * DT * 60 * Math.min(1, CFG.dogpile), DT);
        g.bottom.cheerUntil = time + 0.2;
      }
      g.bottom.body.impulse(-g.bottom.body.velocity(DT).x * 0.5, 0, DT); // (feet planted)
      // Each one up there (or coming down onto it) keeps itself over the
      // one below.
      for (const o of g.climbers) {
        const u = o.pileUnder;
        if (!u || o.body.grab) continue;
        const c = o.body.centroid(), uc = u.body.centroid();
        const coming = !o.body.onFloor() && !u.stackedBy && o.body.velocity(DT).y > 0; // (on the way down, not yet touching)
        if (time - o.pileAt > 0.3 && (u.stackedBy === o || coming) && c.y < uc.y - u.body.o.radius * 0.4 && Math.abs(c.x - uc.x) < (o.body.o.radius + u.body.o.radius) * 0.8) {
          o.body.impulse(((uc.x - c.x) * 4 - o.body.velocity(DT).x) * 0.3, 0, DT);
          if (o.pileOn) o.cheerUntil = time + 0.2;
        }
      }
      // A pile that's started sliding over (or has stood long enough) topples.
      const sliding = onPile.length && Math.abs(bc.x - g.x0) > g.bottom.body.o.radius * 0.9;
      if ((g.stage === 'hold' && time - g.at > 1.6) || ((g.stage === 'hold' || g.stage === 'go') && sliding && g.idx >= 2)) {
        // Toppling: everyone tumbles off, laughing.
        g.stage = 'tumble'; g.at = time;
        const side = Math.random() < 0.5 ? -1 : 1;
        g.climbers.forEach((o, i) => {
          o.body.impulse(side * (i % 2 ? -1 : 1) * (180 + Math.random() * 200), -200 - Math.random() * 150, DT);
          o.pileUnder = null;
          o.cheerUntil = time + 1.6;
        });
        g.bottom.cheerUntil = time + 1.6;
        quip(g.climbers[g.climbers.length - 1], 'whoa!', 0.8);
        g.laughAt = time + 0.9;
        return;
      }
      if (g.stage === 'go') {
        // Next one on: a jump that lands on top of the pile.
        if (time > g.next && g.idx < g.climbers.length) {
          const o = g.climbers[g.idx], c = o.body.centroid(), ro = o.body.o.radius;
          if (o.body.onFloor() && !o.pendingHop && !o.body.grab && peak.body.velocity(DT).y > -40 && Math.abs(peak.body.velocity(DT).y) < 120) {
            const up = Math.max(0, o.body.bbox().maxY - peak.body.bbox().minY), v = launch(peak.body.centroid().x - c.x, up + ro * 0.9, up);
            o.pileUnder = peak;
            o.body.impulse(-o.body.velocity(DT).x, 0, DT);
            o.hop(v.vx, v.vy);
            o.pileAt = time;
            if (g.idx === 0) quip(o, 'dogpile!', 1.2);
            else if (Math.random() < 0.6) quip(o, Math.random() < 0.5 ? 'me too!' : 'wheee!', 0.9);
            g.idx++; g.next = time + 0.9;
          } else g.next = time + 0.2;
        }
        if (onPile.length && !g.oof) { g.oof = true; quip(g.bottom, 'oof!', 0.8); }
        if (g.idx >= g.climbers.length && time > g.next + 0.6) { g.stage = 'hold'; g.at = time; if (onPile.length > 1) quip(g.bottom, 'hehe', 1); }
        return;
      }
      if (g.stage === 'tumble') {
        if (g.laughAt && time > g.laughAt) { g.laughAt = 0; quip(g.bottom, 'haha', 1); if (g.climbers[0]) quip(g.climbers[0], 'hehe', 1); }
        if (time - g.at > 2.2) end();
      }
      return;
    }
    if (!free(b) || !b.body.onFloor() || idleFor() > 60 || time < (b.nextPile ?? (b.nextPile = time + (300 + Math.random() * 600) / CFG.dogpile))) return;
    b.nextPile = time + (600 + Math.random() * 900) / CFG.dogpile;
    const c = b.body.centroid();
    const others = [...buddies.values()].filter((o) => o !== b && o.kind === 'mother' && free(o) && o.body.onFloor() && Math.abs(o.body.bbox().maxY - b.body.bbox().maxY) < 10);
    if (others.length < 2) return;
    others.sort((p, q) => Math.abs(p.body.centroid().x - c.x) - Math.abs(q.body.centroid().x - c.x));
    pileNow(others[0], [b, ...others.slice(1, 3)]);
  }
  function pileNow(bottom, climbers) {
    // Room overhead for the pile, or not today.
    let height = bottom.body.o.radius * 2;
    climbers = climbers.filter((o, i) => (height += o.body.o.radius * 1.7) < H * 0.85 || i === 0);
    pileGame = { bottom, climbers, stage: 'go', start: time, next: time + 0.3, idx: 0, x0: bottom.body.centroid().x };
    for (const o of [bottom, ...climbers]) { o.pile = pileGame; o.pileOn = false; o.pileAt = 0; o.pileUnder = null; }
    bottom.glanceAt = climbers[0]; bottom.glanceUntil = time + 1;
  }

  function towerNow(b, o) {
    const g = { line: [b, o], stage: 'climb', start: time, next: time + 0.7, jumped: 0 };
    b.tower = o.tower = g;
    b.glanceAt = o; b.glanceUntil = time + 1;
    quip(o, 'tower!', 1.1);
  }

  function tagNow(b, o) {
    const g = { p: b, q: o, it: b, start: time, next: time + 0.6, flee: time + 0.3, n: 0, rounds: 3 + Math.floor(Math.random() * 3) };
    b.tag = o.tag = g;
    o.glanceAt = b; o.glanceUntil = time + 1;
    quip(b, Math.random() < 0.5 ? 'tag?' : 'catch!', 1);
  }
  // Now and then, with a few calm slimes about, one leads a parade: it hops
  // off along the floor ("follow me!") and the others fall in behind it,
  // hopping in step, single file, turning back at the edge of the screen.
  function parade(b) {
    if (CFG.parade <= 0 || b.kind !== 'mother') return;
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.ghost && !o.ghostBy && !o.prank && !o.trick && !o.tag && !o.snow && !o.copy && !o.five && !o.frog && !o.tower && !o.rope && !o.seek && !o.pile && !o.balloon && !o.shape && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
    const g = b.parade;
    if (g) {
      if (g.line[0] !== b) return; // (the one in front runs it)
      if (g.line.some((o) => !free(o)) || drag || time - g.start > 40) { endParade(g); return; }
      for (const o of g.line) { o.nextHop = time + 1; o.happyUntil = time + 0.3; }
      if (time < g.next || !b.body.onFloor() || b.pendingHop) return;
      if (g.n >= g.hops) { endParade(g); return; }
      const r = b.body.o.radius, c = b.body.centroid();
      // At the edge of the screen they turn round: the back of the line leads.
      if ((g.dir > 0 && c.x > W - r * 3) || (g.dir < 0 && c.x < r * 3)) {
        g.dir = -g.dir;
        g.line.reverse();
        for (const o of g.line) o.parade = g;
        g.next = time + 0.3;
        return;
      }
      g.n++;
      g.next = time + 0.8 / Math.min(1.5, CFG.parade);
      const k = Math.min(1.4, CFG.parade);
      b.hop(g.dir * 230 * k, -330);
      // Each one hops a beat after the one in front, aiming to land a step
      // behind it.
      g.line.slice(1).forEach((o, i) => setTimeout(() => {
        if (o.parade !== g || !free(o)) return;
        const ahead = g.line[g.line.indexOf(o) - 1];
        if (!ahead) return;
        const gapTo = ahead.body.centroid().x + g.dir * 230 * k * 0.6 - g.dir * (ahead.body.o.radius + o.body.o.radius) * 1.15;
        o.hop(Math.max(-460, Math.min(460, (gapTo - o.body.centroid().x) * 1.5)), -330);
        o.glanceAt = ahead; o.glanceUntil = time + 0.8;
      }, 220 * (i + 1)));
      return;
    }
    if (!free(b) || !b.body.onFloor() || idleFor() > 60 || time < (b.nextParade ?? (b.nextParade = time + (300 + Math.random() * 600) / CFG.parade))) return;
    b.nextParade = time + (600 + Math.random() * 900) / CFG.parade;
    const c = b.body.centroid();
    const others = [...buddies.values()].filter((o) => o !== b && o.kind === 'mother' && !o.parade && free(o) && o.body.onFloor()).sort((x, y) => Math.abs(x.body.centroid().x - c.x) - Math.abs(y.body.centroid().x - c.x)).slice(0, 5);
    if (others.length < 2) return;
    // Off toward the side with the most clear floor (it needs a little to
    // get going), the nearest ones first behind it.
    const box = b.body.bbox(), r = b.body.o.radius;
    let left = box.minX, right = W - box.maxX;
    for (const o of buddies.values()) {
      if (o === b || o.dying) continue;
      const ob = o.body.bbox();
      if (ob.minX >= box.maxX) right = Math.min(right, ob.minX - box.maxX);
      else if (ob.maxX <= box.minX) left = Math.min(left, box.minX - ob.maxX);
      else left = right = 0;
    }
    if (Math.max(left, right) < r * 2) return;
    const dir = right >= left ? 1 : -1;
    const line = [b, ...others];
    const p = { line, dir, start: time, next: time + 1, n: 0, hops: 7 + Math.floor(Math.random() * 5) };
    for (const o of line) { o.parade = p; o.happyUntil = time + 1; }
    quip(b, 'follow me!', 1.4);
  }
  function endParade(g) {
    for (const o of g.line) {
      o.parade = null;
      if (!o.dying && !o.body.grab) o.happyUntil = time + 1.5;
    }
  }

  // In snowy weather two bored slimes now and then have a snowball fight:
  // each crouches, scoops, and lobs one at the other in turn. A hit splats
  // white and knocks the skin in where it lands ("hey!").
  const snowballs = [];
  function snowFight(b) {
    if (CFG.snowballs <= 0 || CFG.seasons <= 0 || b.kind === 'child') return;
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.ghost && !o.ghostBy && !o.prank && !o.trick && !o.tag && !o.parade && !o.balloon && !o.shape && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
    const g = b.snow;
    if (g) {
      if (g.p !== b) return; // (one of the pair runs the fight)
      if (!free(g.p) || !free(g.q) || drag || season() !== 'snow' || time - g.start > 40) { endSnow(g); return; }
      g.p.nextHop = g.q.nextHop = time + 1;
      const a = g.turn, o = a === g.p ? g.q : g.p;
      a.glanceAt = o; a.glanceUntil = time + 0.3;
      o.glanceAt = a; o.glanceUntil = time + 0.3;
      if (g.flying || time < g.next || !a.body.onFloor() || a.pendingHop) return;
      if (g.n >= g.rounds) { endSnow(g); return; }
      if (!g.scoop) { g.scoop = time; return; }
      const ab = a.body, r = ab.o.radius;
      if (time - g.scoop < 0.35) { ab.squashTop(260, DT); return; } // (scooping)
      // Throw: up onto its toes, and a lob that lands on the other's head.
      g.scoop = 0;
      g.n++;
      ab.squashTop(-500, DT);
      const box = ab.bbox(), ob = o.body.bbox(), dir = Math.sign((ob.minX + ob.maxX) / 2 - (box.minX + box.maxX) / 2) || 1;
      const x0 = dir > 0 ? box.maxX - r * 0.3 : box.minX + r * 0.3, y0 = box.minY + r * 0.4;
      const tx = (ob.minX + ob.maxX) / 2 + (Math.random() - 0.5) * r * 0.8, ty = ob.minY + r * 0.3;
      const grav = CFG.gravity * 0.5, T = Math.max(0.45, Math.min(1.1, Math.abs(tx - x0) / 520));
      snowballs.push({ x: x0, y: y0, vx: (tx - x0) / T, vy: (ty - y0 - 0.5 * grav * T * T) / T, grav, from: a, game: g, born: time });
      g.flying = true;
      return;
    }
    if (season() !== 'snow' || !free(b) || !b.body.onFloor() || idleFor() > 60 || time < (b.nextSnow ?? (b.nextSnow = time + (120 + Math.random() * 240) / CFG.snowballs))) return;
    b.nextSnow = time + (240 + Math.random() * 480) / CFG.snowballs;
    const c = b.body.centroid(), r = b.body.o.radius;
    const others = [...buddies.values()].filter((o) => o !== b && o.kind !== 'child' && !o.snow && free(o) && o.body.onFloor() && Math.abs(o.body.centroid().x - c.x) > r * 2.5 && Math.abs(o.body.centroid().x - c.x) < r * 12);
    if (!others.length) return;
    const o = others[Math.floor(Math.random() * others.length)];
    b.snow = o.snow = { p: b, q: o, turn: b, start: time, next: time + 0.5, n: 0, rounds: 6 + Math.floor(Math.random() * 4) };
    o.glanceAt = b; o.glanceUntil = time + 1;
  }
  function endSnow(g) {
    for (const o of [g.p, g.q]) {
      o.snow = null;
      o.nextSnow = time + (240 + Math.random() * 480) / Math.max(0.05, CFG.snowballs);
      if (!o.dying && !o.body.grab) o.happyUntil = time + 1.5;
    }
  }
  function stepSnowballs() {
    for (let i = snowballs.length - 1; i >= 0; i--) {
      const s = snowballs[i], g = s.game;
      s.vy += s.grav * DT;
      s.x += s.vx * DT;
      s.y += s.vy * DT;
      let hit = null;
      for (const o of buddies.values()) if (o !== s.from && !o.dying && o.body.contains(s.x, s.y)) { hit = o; break; }
      const ground = s.y >= floorAt(s.x, s.y) - 3 || s.x < 0 || s.x > W || time - s.born > 3;
      if (!hit && !ground) continue;
      snowballs.splice(i, 1);
      if (s.candy) {
        // A sweet: caught, and chewed.
        if (hit) { hit.nibbling = { f: { x: s.x, y: s.y, a: 0, kind: 'candy' }, at: time }; hit.happyUntil = time + 2; }
        continue;
      }
      pops.push({ x: s.x, y: s.y, r: 7, born: time, color: '#dfe7f2', life: 0.45 });
      if (hit) {
        const r = hit.body.o.radius;
        hit.body.pushAt(s.x, s.y, s.vx * 0.5 * Math.min(1.5, CFG.snowballs), s.vy * 0.3, r * 0.7, DT);
        hit.startleUntil = time + 0.35;
        hit.blink = 1;
        if (Math.random() < 0.5) quip(hit, Math.random() < 0.5 ? 'hey!' : 'brr!', 0.9);
        s.from.happyUntil = time + 1;
      }
      if (g && g.p.snow === g) {
        g.flying = false;
        g.turn = g.turn === g.p ? g.q : g.p; // (your turn)
        g.next = time + 0.5 + Math.random() * 0.4;
      }
    }
  }
  function drawSnowballs() {
    for (const s of snowballs) {
      if (s.candy) {
        // A wrapped sweet, tumbling: a round middle and a twist each side.
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate((time - s.born) * s.spin);
        ctx.fillStyle = s.candy;
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
        for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(k * 5, 0); ctx.lineTo(k * 12, -5); ctx.lineTo(k * 12, 5); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath(); ctx.arc(-2, -2, 2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.fillStyle = '#fbfdff';
      ctx.strokeStyle = '#c9d3e0';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  function endTag(g) {
    for (const o of [g.p, g.q]) {
      o.tag = null;
      o.nextTag = time + (300 + Math.random() * 600) / Math.max(0.05, CFG.play);
      if (!o.dying && !o.body.grab) o.happyUntil = time + 1.5;
    }
  }

  // Now and then a bored slime leans over and eats a leaf (or petal, or a
  // bit of snow) lying beside it: it slides into its mouth, chomp chomp.
  function nibble(b) {
    if (CFG.nibble <= 0 || b.kind === 'child' || b.dying) return;
    const n = b.nibbling;
    const body = b.body, c = body.centroid(), r = body.o.radius;
    if (n) {
      const t = time - n.at;
      if (body.grab || t > 2.2) { b.nibbling = null; return; }
      if (t < 0.5) {
        // Leaning over to it, and drawing it in.
        body.lean(Math.sign(n.f.x - c.x) * r * 10 * DT, DT);
        const mx = c.x + Math.sign(n.f.x - c.x) * r * 0.2, my = c.y + r * 0.1, k = Math.min(1, t / 0.5);
        n.f.x += (mx - n.f.x) * k * 0.3; n.f.y += (my - n.f.y) * k * 0.3; n.f.landed = 0; n.f.eaten = true; n.f.a += DT * 6;
      } else if (!n.gone) {
        n.gone = true;
        const i = flakes.indexOf(n.f);
        if (i >= 0) flakes.splice(i, 1);
        if (n.f.kind === 'candy') quip(b, 'yum!', 1);
        else if (Math.random() < 0.6) quip(b, n.f.kind === 'snow' ? 'brr' : 'nom', 1);
      } else if (body.onFloor() && Math.round(t / 0.18) % 2 === 0 && t < 1.6) body.squashTop(r * 0.5 * 60 * DT, DT); // (chewing)
      return;
    }
    const ok = (b.state === 'idle' || b.state === 'done') && !body.grab && body.onFloor() && !b.tag && !b.prank && !b.trick && !b.blow && !b.rope && !b.seek && !b.pile && !b.balloon && !b.tower && !b.frog && !b.measure && (b.sleep || 0) < 0.1;
    if (!ok || !flakes.length || time < (b.nextNibble ?? (b.nextNibble = time + (60 + Math.random() * 180) / CFG.nibble))) return;
    b.nextNibble = time + (90 + Math.random() * 240) / CFG.nibble;
    const bb = body.bbox();
    const f = flakes.find((f) => f.landed && !f.on && !f.ledge && !f.eaten && Math.abs(f.y - bb.maxY) < 20 && Math.abs(f.x - c.x) < r * 1.5 && Math.abs(f.x - c.x) > r * 0.6);
    if (f) b.nibbling = { f, at: time };
  }

  // Bored, it plays with its task pet: a lean and a shove, and the pet
  // tumbles off and scampers back, pleased.
  // Throw a slime's task pet and it goes after it, hopping, eyes on it; when
  // it gets there the pet hops up onto its head ("got it!"), and it brings it
  // back toward you.
  function fetchPet(b) {
    const f = b.fetch;
    if (!f) return;
    const p = f.pet, free = !b.body.grab && !b.merging && !b.dying && !b.tag && b.state !== 'working' && b !== buddies.get(talkingTo);
    if (!free || p.dying || p.held || time - f.start > 10) { b.fetch = null; return; }
    b.nextHop = time + 1;
    b.glanceAt = { spot: p }; b.glanceUntil = time + 0.3;
    const box = b.body.bbox(), c = b.body.centroid(), r = b.body.o.radius, PET = petSize();
    if (f.got) {
      // Brought back: a hop or two toward the cursor with it on its head.
      b.happyUntil = time + 0.3;
      if (time - f.got > 3 || (!p.ride && !p.rideOn)) { b.fetch = null; b.happyUntil = time + 1.5; return; }
      const dx = mouse.x - c.x;
      if (p.ride && b.body.onFloor() && !b.pendingHop && time > (f.next || 0) && Math.abs(dx) > r * 2) {
        f.next = time + 0.9;
        b.hop(Math.sign(dx) * Math.min(300, Math.abs(dx) * 1.2) * Math.min(1.5, CFG.fetch), -260);
      }
      return;
    }
    b.happyUntil = time + 0.3;
    if (p.x > box.minX - PET * 0.6 && p.x < box.maxX + PET * 0.6 && p.y > box.minY - PET && p.y < box.maxY + PET * 0.5 && Math.abs(p.vy) < 600 && b.body.onFloor() && Math.abs(b.body.velocity(DT).x) < 150) {
      // Got it: up it hops onto its head.
      f.got = time;
      f.next = time + 0.8;
      const up = Math.sqrt(2 * CFG.gravity * Math.max(PET, p.y - box.minY + PET)), air = up / CFG.gravity * 1.6;
      p.vx = (c.x - p.x) / air;
      p.vy = -up;
      p.rideOn = b; p.rideAt = time;
      p.va = Math.sign(p.vx || 1) * 3;
      p.nextHop = time + 2.5;
      quipBack(b, 'got it!', 1.2);
      spawnHeart({ x: c.x, y: box.minY - 10, vx: 0, born: time, size: 10 });
      return;
    }
    if (time - f.start > 0.35 && b.body.onFloor() && !b.pendingHop && time > (f.next || 0)) {
      f.next = time + 0.25;
      const dx = p.x + p.vx * 0.3 - c.x;
      const k = Math.min(1.5, CFG.fetch);
      b.hop(Math.sign(dx) * Math.min(460, Math.abs(dx) * 1.7 + 60) * k, -(240 + Math.random() * 80) * Math.min(1.3, k));
    }
  }

  // Left waiting on you a long while (8 minutes by default), a little rain
  // cloud gathers over its head and it slumps, glum: the one you've kept
  // waiting longest is easy to spot. Point at it and the cloud puffs away.
  // Hold one you're carrying gently against another for a moment and they
  // hug: both happy, the other leaning in, hearts between them. Let go and
  // the other gives a pleased little hop.
  function hug(b) {
    const g = b.hug;
    const held = CFG.hugs > 0 && drag && drag.buddy === b && !b.dying;
    let o = null;
    if (held) {
      const c = b.body.centroid(), r = b.body.o.radius, v = b.body.velocity(DT);
      if (Math.hypot(v.x, v.y) < 160) {
        for (const x of buddies.values()) {
          if (x === b || x.dying || x.kind === 'home' || x.merging || x.body.grab) continue;
          const d = Math.hypot(x.body.centroid().x - c.x, x.body.centroid().y - c.y);
          if (d < (r + x.body.o.radius) * 1.12 && (!o || d < o.d)) o = { x, d };
        }
      }
      o = o && o.x;
    }
    if (!o || (g && g.o !== o)) {
      b.hugT = 0;
      if (g) {
        b.hug = null; g.o.huggedBy = null;
        if (time - g.since > 1 && g.o.body.onFloor()) { g.o.hop(0, -260); quip(g.o, 'hehe', 1); }
      }
      return;
    }
    b.hugT = (b.hugT || 0) + DT;
    if (!g) {
      if (b.hugT < 0.6) return;
      b.hug = { o, since: time, heart: time };
      o.huggedBy = b;
      feel(b, 0.1);
      return;
    }
    // The other leans in to it, and stands its ground rather than get shoved along.
    const oc = o.body.centroid(), bc = b.body.centroid(), ov = o.body.velocity(DT);
    o.body.lean((Math.sign(bc.x - oc.x) || 1) * o.body.o.radius * 1.6 * Math.min(1.5, CFG.hugs), DT);
    if (o.body.onFloor()) o.body.impulse(-ov.x * 0.25, 0, DT);
    if (time - g.heart > 0.7) {
      g.heart = time;
      spawnHeart({ x: (oc.x + bc.x) / 2 + (Math.random() - 0.5) * 12, y: Math.min(b.body.bbox().minY, o.body.bbox().minY) - 6, vx: (Math.random() - 0.5) * 30, born: time, size: 10 + Math.random() * 4 });
    }
  }

  // Thrown hard, it tumbles head over heels through the air, the way it was
  // flung; too many turns and it lands dizzy.
  function throwSpin(b) {
    const v = b.body.velocity(DT), r = b.body.o.radius;
    if (CFG.tumble <= 0 || Math.hypot(v.x, v.y) < 900 || Math.abs(v.x) < 250) return;
    b.body.spin(Math.sign(v.x) * Math.min(24, (Math.abs(v.x) / r) * 0.9 * CFG.tumble), DT);
    b.tumble = { at: time, turned: 0, last: b.body.angle };
    b.body.o.upright = CFG.upright * 0.08; // (free to turn over in the air; see tumble)
  }
  function tumble(b) {
    const t = b.tumble;
    if (!t) return;
    let d = b.body.angle - t.last;
    if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
    t.last = b.body.angle;
    t.turned += Math.abs(d);
    if (b.body.grab || time - t.at > 6) { b.tumble = null; b.body.o.upright = CFG.upright; return; }
    if (!t.landed && time - t.at > 0.15 && b.body.onFloor()) {
      t.landed = time;
      b.body.o.upright = CFG.upright;
      b.body.spin(-b.body.angularVelocity(DT) * 0.6, DT); // (the floor grabs it)
      if (t.turned > Math.PI * 4) { b.dizzyUntil = Math.max(b.dizzyUntil, time + 2); quipBack(b, 'whoa…', 1.2); }
    }
    // Landed upside down or on its side: after a moment it flops back over.
    if (t.landed && !t.flop && time - t.landed > 0.7 && Math.abs(b.body.angle) > 0.5 && b.body.onFloor()) {
      t.flop = time;
      b.body.impulse(0, -280, DT);
      b.body.spin(-b.body.angle * 4.5 - b.body.angularVelocity(DT), DT);
    }
    // Back the right way up (or near enough), its face stops going round.
    if (t.landed && (Math.abs(b.body.angle) < 0.25 || time - t.landed > 3)) { b.tumble = null; b.body.o.upright = CFG.upright; }
  }

  // A bored slime now and then does a roly-poly: it rolls over along the
  // floor, face and ears going all the way round, and comes up the right
  // way, grinning ("wheee!"). Twice round and it's a bit dizzy.
  function roll(b) {
    const g = b.roll, body = b.body, r = body.o.radius;
    if (g) {
      let d = body.angle - g.last;
      if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
      g.last = body.angle; g.turned += d * g.dir;
      const done = () => { b.roll = null; body.o.upright = CFG.upright; };
      if (body.grab || b.merging || time - g.at > 5) { done(); return; }
      b.nextHop = time + 1;
      if (!g.over) {
        // Over it goes: a steady turn, and the floor rolls it along.
        body.o.upright = CFG.upright * 0.05;
        const w = g.dir * Math.PI * 2 / 0.9 * Math.min(1.5, CFG.rolls);
        body.spin((w - body.angularVelocity(DT)) * 0.25, DT);
        if (body.onFloor()) body.impulse((g.dir * r * Math.abs(w) * 0.5 - body.velocity(DT).x) * 0.1, 0, DT);
        if (g.turned > Math.PI * 2 * g.times - 0.35) {
          g.over = time;
          body.spin(-body.angularVelocity(DT) * 0.8, DT);
          body.o.upright = CFG.upright;
          if (g.times > 1) { b.dizzyUntil = Math.max(b.dizzyUntil, time + 1.5); quip(b, 'whoa…', 1.2); }
          else { b.cheerUntil = time + 1.2; quip(b, 'wheee!', 1.1); }
        }
        return;
      }
      body.spin((-body.angle * 3 - body.angularVelocity(DT)) * 0.2, DT); // (settles back upright)
      if (Math.abs(body.angle) < 0.08 || time - g.over > 2) done();
      return;
    }
    if (CFG.rolls <= 0 || b.kind !== 'mother' || (b.state !== 'idle' && b.state !== 'done') || body.grab || b.merging || b.dying || !body.onFloor() || b.pendingHop || b.stackedBy || b.tower || b.frog || b.tag || b.parade || b.trick || b.keepy || b.measure || b.rope || b.seek || b.pile || b.balloon || b.shape || b.tot || b.skate || b.snow || b.comforting || (b.sleep || 0) > 0.1 || idleFor() > 60 || b === buddies.get(talkingTo)) return;
    if (time < (b.nextRoll ?? (b.nextRoll = time + (150 + Math.random() * 350) / CFG.rolls))) return;
    b.nextRoll = time + (300 + Math.random() * 600) / CFG.rolls;
    rollNow(b);
  }
  // Snowy weather: a bored slime now and then takes a run-up and slides
  // along the icy floor ("wheee!"), leaning back, wobbling to keep its
  // balance, until it slows to a stop (or braces at the edge of the screen).
  function skate(b) {
    const g = b.skate, body = b.body, r = body.o.radius;
    if (g) {
      const done = () => { b.skate = null; body.o.friction = g.friction; };
      if (body.grab || b.merging || time - g.at > 6) { done(); return; }
      b.nextHop = time + 1;
      const v = body.velocity(DT), c = body.centroid();
      if (!g.off) {
        if (time - g.at < 0.25) { body.squashTop(r * 0.9 * 60 * DT, DT); return; } // (a crouch for the push-off)
        g.off = time;
        body.o.friction = 0.015;
        g.v0 = g.dir * (480 + Math.random() * 160) * Math.min(1.5, CFG.skating);
        body.impulse(g.v0 - v.x, -60, DT);
        quip(b, 'wheee!', 1.2);
        return;
      }
      // Gliding: the ice barely slows it (other grips on the floor don't
      // hold it either).
      if (!g.brace) body.impulse((g.v0 * Math.exp(-(time - g.off) / 1.6) - v.x) * 0.5, 0, DT);
      // Leaning back against the slide, with a little wobble for balance.
      body.lean((-g.dir * 0.8 + Math.sin((time - g.off) * 9) * 0.5) * r * 3 * DT, DT);
      b.happyUntil = time + 0.3;
      // The edge of the screen coming up: it braces, digging in.
      const ahead = g.dir > 0 ? W - body.bbox().maxX : body.bbox().minX;
      if (ahead < r * 1.5 && !g.brace) { g.brace = true; body.o.friction = g.friction; b.surpriseUntil = time + 0.5; quip(b, 'whoa!', 0.8); }
      if ((Math.abs(v.x) < 40 || Math.abs(g.v0) * Math.exp(-(time - g.off) / 1.6) < 40) && time - g.off > 0.4) { done(); if (!g.brace) b.cheerUntil = time + 1; }
      return;
    }
    if (CFG.skating <= 0 || season() !== 'snow' || b.kind !== 'mother' || (b.state !== 'idle' && b.state !== 'done') || body.grab || b.merging || b.dying || !body.onFloor() || b.pendingHop || b.stackedBy || b.tower || b.frog || b.tag || b.parade || b.trick || b.keepy || b.roll || b.measure || b.snow || b.rope || b.seek || b.pile || b.balloon || b.shape || b.tot || b.comforting || (b.sleep || 0) > 0.1 || idleFor() > 60 || b === buddies.get(talkingTo)) return;
    if (time < (b.nextSkate ?? (b.nextSkate = time + (90 + Math.random() * 240) / CFG.skating))) return;
    b.nextSkate = time + (200 + Math.random() * 400) / CFG.skating;
    skateNow(b);
  }
  // Now and then a bored slime that's in a good mood squeezes itself into a
  // heart for a moment ("ta-da!"), holds it, and lets go back into a blob.
  function shapeShift(b) {
    const g = b.shape, body = b.body;
    if (g) {
      const t = time - g.at, k = Math.min(1, CFG.shapes);
      const amt = body.grab || b.dying ? 0 : Math.max(0, Math.min(1, t / (g.rise || 0.6))) * Math.max(0, Math.min(1, ((g.hold || 3.2) - t) / (g.fall || 0.7)));
      body.morph(amt * k * 0.9, g.kind);
      b.shapeAmt = amt * k;
      if (amt > 0 && body.onFloor()) {
        // Balancing on its point: it keeps itself upright and in place.
        body.impulse(-body.velocity(DT).x * 0.3, 0, DT);
        body.spin((-body.angle * 4 - body.angularVelocity(DT)) * 0.3 * amt, DT);
      }
      if (t > 0.7 && !g.said && !g.quiet) { g.said = true; quip(b, 'ta-da!', 1.2); b.happyUntil = time + 2; spawnHeart({ x: body.centroid().x, y: body.bbox().minY - 8, vx: 0, born: time, size: 12 }); }
      if (amt <= 0 && t > (g.rise || 0.6)) { body.morph(0, g.kind); b.shape = null; b.shapeAmt = 0; }
      b.nextHop = time + 1;
      return;
    }
    if (CFG.shapes <= 0 || b.kind !== 'mother' || (b.state !== 'idle' && b.state !== 'done') || body.grab || b.merging || b.dying || !body.onFloor() || b.pendingHop || b.stackedBy || b.tower || b.frog || b.tag || b.parade || b.trick || b.keepy || b.roll || b.measure || b.rope || b.seek || b.pile || b.balloon || b.tot || b.skate || b.comforting || (b.mood || 0) < 0 || (b.sleep || 0) > 0.1 || idleFor() > 60 || b === buddies.get(talkingTo)) return;
    if (time < (b.nextShape ?? (b.nextShape = time + (200 + Math.random() * 500) / CFG.shapes))) return;
    b.nextShape = time + (500 + Math.random() * 800) / CFG.shapes;
    b.shape = { at: time };
  }
	// Now and then a bored slime puffs itself up like a balloon: three big
	// gulps of air, cheeks full, until it's half as big again and taut as a
	// drum. Full, it strains a moment, lifts off and bobs up... then lets
	// go: "pfffbt!", the air rushing out sends it looping and swerving about
	// the screen as it shrinks back down, and it lands dizzy and giggling.
	// (Its size and firmness are worked out fresh every step, from b.puff
	// and b.taut, so they come back exactly as they were; see step.)
	function balloon(b) {
		const g = b.balloon, body = b.body;
		if (g) {
			const t = time - g.at, k = Math.min(1.5, CFG.balloon), r = body.o.radius, full = 0.6 * k;
			if (body.grab || b.dying || t > 9) { unballoon(b); return; }
			b.nextHop = time + 1;
			if (g.stage === 'breathe') {
				// Gulp, gulp, gulp: each a quick suck of air, then a held breath.
				const gulp = Math.min(2, Math.floor(t / 0.42)), into = (t - gulp * 0.42) / 0.42, suck = Math.min(1, into / 0.45);
				const level = (gulp + suck * suck * (3 - 2 * suck)) / 3;
				b.puff = full * level; b.taut = level;
				b.cheekPuff = level;
				b.gulping = into < 0.55;
				if (into < 0.05 && g.gulp !== gulp) { g.gulp = gulp; body.squashTop(-r * 3, DT); } // (a little heave with each)
				if (body.onFloor()) body.impulse(-body.velocity(DT).x * 0.2, 0, DT);
				if (t > 1.26) { g.stage = 'full'; g.at = time; b.gulping = false; }
				return;
			}
			if (g.stage === 'full') {
				// Full to bursting: it quivers with the strain, then lifts off.
				const ease = Math.min(1, t / 0.15);
				b.puff = full * (1 + 0.035 * Math.sin(t * 38) * ease); b.taut = 1; b.cheekPuff = 1;
				b.cheekStrain = 0.3 * ease;
				if (body.onFloor()) body.impulse(-body.velocity(DT).x * 0.2, 0, DT);
				if (t > 0.5) { g.stage = 'float'; g.at = time; g.floor = body.bbox().maxY; b.cheekStrain = 0; }
				return;
			}
			if (g.stage === 'float') {
				// Lighter than air: it lifts off gently and bobs, drifting a little.
				b.puff = full; b.taut = 1; b.cheekPuff = 1;
				const lift = r * 2.2 * Math.min(1, t / 1.4) * (2 - Math.min(1, t / 1.4)) + Math.sin(t * 3.4) * r * 0.12;
				const up = g.floor - body.bbox().maxY, v = body.velocity(DT);
				body.impulse((Math.sin(t * 2.2) * 30 - v.x) * 0.08, (-(lift - up) * 4 - v.y) * 0.2, DT);
				if (t > 2) {
					// (Off up and out toward the side with more room.)
					const e = body.bounds, out = body.centroid().x < (e.left + e.right) / 2 ? 1 : -1;
					g.stage = 'zip'; g.at = time; g.dir = -Math.PI / 2 + out * (0.5 + Math.random() * 0.5); g.turn = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 2.5);
					b.surpriseUntil = time + 0.3;
					quip(b, 'pfffbt!', 1.3);
				}
				return;
			}
			if (g.stage === 'zip') {
				// The air rushing out drives it along wherever the hole's
				// pointing, and the hole wanders round, so it loops and swerves.
				// Near an edge it turns back in, so it stays on the screen.
				const left = Math.max(0, 1 - t / 1.8);
				b.puff = full * left; b.taut = left; b.cheekPuff = 0;
				// (It looks a moment ahead, to turn before it gets there.)
				const v = body.velocity(DT), c = body.centroid(), e = body.bounds, near = r * 3;
				const ax = c.x + v.x * 0.3, ay = c.y + v.y * 0.3;
				const wall = Math.max(0, 1 - Math.min(ax - e.left, e.right - ax, ay - e.top, e.bottom - ay) / near);
				if (wall > 0) {
					const back = Math.atan2((e.top + e.bottom) / 2 - c.y, (e.left + e.right) / 2 - c.x);
					g.dir += Math.atan2(Math.sin(back - g.dir), Math.cos(back - g.dir)) * Math.min(1, 12 * Math.min(1, wall) * DT);
				}
				g.dir += g.turn * DT + (Math.random() - 0.5) * 6 * DT;
				const speed = 1300 * Math.sqrt(k) * (0.5 + 0.5 * left), grip = 0.12 * Math.min(1, left * 4);
				body.impulse((Math.cos(g.dir) * speed - v.x) * grip, (Math.sin(g.dir) * speed - v.y) * grip, DT);
				body.spin((g.turn * 0.5 - body.angularVelocity(DT)) * 0.1 * left, DT);
				if (left <= 0) { g.stage = 'land'; g.at = time; b.puff = 0; b.taut = 0; }
				return;
			}
			if (g.stage === 'land' && body.onFloor() && t > 0.3) {
				unballoon(b);
				b.dizzyUntil = time + 1.2;
				b.giggleAt = time + 1.3;
				return;
			}
			return;
		}
		if (b.giggleAt && time > b.giggleAt) { b.giggleAt = 0; quipBack(b, 'hehe', 1); b.cheerUntil = time + 1; }
		if (CFG.balloon <= 0 || b.kind !== 'mother' || (b.state !== 'idle' && b.state !== 'done') || body.grab || b.merging || b.dying || !body.onFloor() || b.pendingHop || b.stackedBy || b.shape || b.tower || b.frog || b.tag || b.parade || b.trick || b.keepy || b.roll || b.measure || b.rope || b.seek || b.pile || b.tot || b.skate || b.comforting || (b.mood || 0) < 0 || (b.sleep || 0) > 0.1 || idleFor() > 60 || b === buddies.get(talkingTo)) return;
		if (time < (b.nextBalloon ?? (b.nextBalloon = time + (300 + Math.random() * 600) / CFG.balloon))) return;
		b.nextBalloon = time + (600 + Math.random() * 900) / CFG.balloon;
		balloonNow(b);
	}
	function balloonNow(b) {
		b.balloon = { at: time, stage: 'breathe', gulp: -1 };
	}
	// Done (or picked up partway): all the air out, and back to its own size and firmness.
	function unballoon(b) {
		b.balloon = null; b.puff = 0; b.taut = 0; b.cheekPuff = 0; b.cheekStrain = 0; b.gulping = false;
	}
  // A real fright: it bristles all over for a moment, like a startled cat.
  function bristle(b) {
    if (CFG.shapes <= 0 || b.shape || b.dying) return;
    b.shape = { at: time, kind: 'spiky', quiet: true, rise: 0.1, hold: 0.8, fall: 0.4 };
  }
  function skateNow(b) {
    const box = b.body.bbox(), r = b.body.o.radius;
    const dir = W - box.maxX > box.minX ? 1 : -1;
    if ((dir > 0 ? W - box.maxX : box.minX) < r * 5) return;
    b.skate = { dir, at: time, friction: b.body.o.friction };
  }
  function rollNow(b) {
    const box = b.body.bbox(), r = b.body.o.radius;
    const dir = W - box.maxX > box.minX ? 1 : -1;
    if ((dir > 0 ? W - box.maxX : box.minX) < r * 4) return;
    b.roll = { dir, at: time, turned: 0, last: b.body.angle, times: Math.random() < 0.25 ? 2 : 1 };
  }

  // A somersault: once off the ground, a spin to go once round in the air;
  // landed, "ta-da!".
  function somersault(b) {
    const f = b.flip;
    if (!f) return;
    if (b.body.grab || time - f.at > 4) { b.flip = null; b.body.o.upright = CFG.upright; return; }
    if (!f.spun) {
      if (b.pendingHop || b.body.onFloor()) return;
      f.spun = time;
      b.body.o.upright = CFG.upright * 0.08;
      const air = (2 * Math.abs(f.vy)) / CFG.gravity; // (time it'll be up)
      b.body.spin(f.dir * (Math.PI * 2 / air) * 1.5, DT);
      return;
    }
    if (time - f.spun > 0.2 && b.body.onFloor()) {
      b.body.spin(-b.body.angularVelocity(DT) * 0.9, DT); // (it sticks the landing rather than rolling on)
      b.body.o.upright = CFG.upright;
      b.flip = null;
      b.happyUntil = time + 1.5;
      quip(b, 'ta-da!', 1.2);
    }
  }

  // Now and then a gulp is followed by a little burp: a puff from its mouth,
  // a blush, and maybe a giggle from a slime nearby.
  function burp(b) {
    if (!b.burpAt || time < b.burpAt) return;
    b.burpAt = 0;
    if (b.dying || b.body.grab || b.bubble) return;
    const c = b.body.centroid(), r = b.body.o.radius;
    b.body.squashTop(220, DT);
    b.burpUntil = time + 0.35;
    pops.push({ x: c.x + r * 0.05, y: c.y + r * 0.1, r: r * 0.12, born: time, color: b.color, life: 0.45 });
    quip(b, '*burp*', 1.3);
    b.blushUntil = time + 2.6;
    let near = null;
    for (const o of buddies.values()) {
      if (o === b || o.dying || o.kind === 'home' || o.body.grab || o.bubble || (o.state !== 'idle' && o.state !== 'done') || (o.sleep || 0) > 0.3) continue;
      const d = Math.hypot(o.body.centroid().x - c.x, o.body.centroid().y - c.y);
      if (d < r * 5 && (!near || d < near.d)) near = { o, d };
    }
    if (near && Math.random() < 0.6) setTimeout(() => { if (!near.o.dying) { quip(near.o, 'hehe', 1.1); near.o.glanceAt = b; near.o.glanceUntil = time + 1.2; near.o.squirmUntil = time + 0.5; } }, 500);
  }

  // Fast asleep, now and then it dreams: of what it was last working on, or
  // of sheep jumping a fence.
  function dream(b) {
    if (b.state === 'working' && b.kind === 'mother') { const a = activityOf(b); if (a !== 'thinking') b.lastWork = a; }
    if (CFG.dreams <= 0 || (b.sleep || 0) < 0.9 || b.kind === 'home') { if ((b.sleep || 0) < 0.5) b.nextDream = undefined; return; }
    if (b.nextDream === undefined) b.nextDream = time + (6 + Math.random() * 10) / CFG.dreams;
    if (time < b.nextDream) return;
    b.dream = { what: b.lastWork && Math.random() < 0.5 ? b.lastWork : 'sheep', until: time + 5 + Math.random() * 3 };
    b.nextDream = time + (25 + Math.random() * 30) / CFG.dreams;
  }

  // Run the cursor round and round a slime and its eyes follow it round,
  // until (a few laps in) it's seeing stars.
  function circled(b) {
    const c = b.body.centroid(), r = b.body.o.radius;
    const d = Math.hypot(mouse.x - c.x, mouse.y - c.y);
    const near = CFG.circleDizzy > 0 && !lulled(b) && !b.body.grab && !b.dying && b.kind !== 'home' && d > r * 0.5 && d < r * 3.5 && performance.now() / 1000 - mouse.lastMove < 0.4;
    const ci = b.circling || (b.circling = { a: 0, last: null, at: -9 });
    if (!near) {
      ci.last = null;
      if (time - ci.at > 0.6) ci.a *= Math.max(0, 1 - DT * 3); // stopped going round: it settles
      return;
    }
    const ang = Math.atan2(mouse.y - c.y, mouse.x - c.x);
    if (ci.last !== null) {
      let da = ang - ci.last;
      if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
      // Going the other way starts the count again.
      if (Math.sign(da) !== Math.sign(ci.a) && Math.abs(da) > 0.02) ci.a *= 0.3;
      ci.a += da;
      if (Math.abs(da) > 0.01) ci.at = time;
    }
    ci.last = ang;
    if (Math.abs(ci.a) > CFG.circleDizzy * Math.PI * 2) {
      ci.a = 0;
      b.dizzyUntil = time + 2.2;
      quipBack(b, 'whoa…', 1.4);
    }
  }

  // Standing at the very edge of a window, it teeters: a worried look down
  // at the drop, a wobble back and forth over it, then a shuffle back to
  // safety. Too far over and it just slides off.
  function teeter(b) {
    const l = b.body.onLedge;
    if (CFG.teeter <= 0 || !l || b.body.grab || b.dying || b.merging || b.kind === 'home') { b.teeter = null; return; }
    const c = b.body.centroid(), r = b.body.o.radius;
    const side = c.x - l.x0 < l.x1 - c.x ? -1 : 1, edge = side < 0 ? l.x0 : l.x1;
    const over = (c.x - edge) * side;
    if (over < -r * (b.teeter ? 0.9 : 0.45) || l.x1 - l.x0 < r * 2.5 || (b.teeter && b.teeter.hopped && b.body.onFloor() && time - b.teeter.hopped > 0.5)) { if (b.teeter) b.nextTeeter = time + 6; b.teeter = null; return; }
    if (!b.teeter && time < (b.nextTeeter || 0)) return;
    if (!b.teeter) {
      b.teeter = { side, edge, since: time };
      if (time > (b.nextWhoa || 0)) { quip(b, 'whoa', 1); b.nextWhoa = time + 12; }
    }
    const t = b.teeter, k = Math.min(1.5, CFG.teeter), age = time - t.since;
    t.side = side; t.edge = edge; t.over = over;
    // Arms out, as it were: a sway back and forth over the drop.
    if (age > 0.25) b.body.lean(Math.sin((age - 0.25) * 9) * k * r * 14 * DT, DT);
    // Then a careful little hop back from the edge.
    if (age > 1.4 && !t.hopped && b.body.onFloor() && !b.pendingHop && talkingTo !== b.key) {
      t.hopped = time;
      b.hop(-side * (120 + r * 1.2), -240);
    }
  }

  function sulk(b) {
    const cl = b.cloud;
    if (CFG.sulkAfter <= 0 || b.kind !== 'mother' || b.state !== 'waiting' || sys.away || b.dying) {
      if (cl && !cl.gone) cl.gone = time;
      if (cl && time - cl.gone > 0.6) b.cloud = null;
      return;
    }
    if (!cl) {
      if (time - (b.stateSince ?? time) > CFG.sulkAfter * 60 && time > (b.cloudAfter || 0)) {
        const box = b.body.bbox();
        b.cloud = { x: (box.minX + box.maxX) / 2, y: box.minY - b.body.o.radius * 1.3, born: time };
      }
      return;
    }
    if (cl.gone) { if (time - cl.gone > 0.6) b.cloud = null; return; }
    if (b === hovered || b === buddies.get(talkingTo)) {
      // Noticed: the cloud puffs away and it perks up.
      cl.gone = time;
      b.cloudAfter = time + CFG.sulkAfter * 30;
      if (b.body.onFloor() && !b.body.grab && !b.pendingHop) b.hop(0, -280);
      return;
    }
    if (b.body.onFloor() && !b.body.grab) b.body.squashTop(35, DT); // (a glum slump)
  }
  // Working flat out (ten tools a minute by default), it breaks a sweat
  // too, as if its context were filling up: busier, more beads.
  function busySweat(b) {
    const t = b.tools;
    if (!t) return 0;
    while (t.length && time - t[0] > 60) t.shift();
    if (CFG.busySweat <= 0 || b.state !== 'working') return 0;
    return ramp(t.length, CFG.busySweat * 0.75, CFG.busySweat * 2) * 0.7;
  }
  // Its todo list, worn as a row of beads across its middle: filled for
  // done, glowing for the one it's on. Each one ticked off gets a hop,
  // and the last a cheer.
  function planTick(b, pr) {
    const was = b.plan;
    b.plan = pr || null;
    if (!pr) { b.planAllAt = undefined; return; }
    if (pr.done < pr.total) b.planAllAt = undefined;
    if (!was || pr.done <= was.done || pr.total < was.total - 1) return;
    b.beadAt = time;
    if (CFG.planBeads <= 0 || b.body.grab || talkingTo === b.key) return;
    const free = b.body.onFloor() && !b.pendingHop && !b.tag && !b.parade && !b.trick;
    if (pr.done === pr.total) {
      b.planAllAt = time;
      if (free) b.hop(0, -520);
      const c = b.body.centroid();
      for (let i = 0; i < 3; i++) pops.push({ x: c.x + (i - 1) * 16, y: c.y - b.body.o.radius * 1.1, r: 8 + i * 4, born: time + i * 0.07, color: '#7bd88f', life: 0.5 });
      if (CFG.shapes > 0 && !b.shape) { b.shape = { at: time + 0.7, kind: 'star', quiet: true, hold: 2.6 }; b.cheerUntil = time + 3.2; } // (and it's a star for a moment)
    } else {
      if (free) b.hop(0, -300);
    }
  }
  function drawBeads(b) {
    const pr = b.plan, items = b.session && b.session.plan && b.session.plan.items;
    if (!pr || !items || CFG.planBeads <= 0 || b.kind !== 'mother' || b.merging || b.dying) return;
    if (b.planAllAt !== undefined && time - b.planAllAt > 8) return;
    const box = b.body.bbox(), w = box.maxX - box.minX, h = box.maxY - box.minY;
    if (w < 30) return;
    const n = items.length, span = w * 0.56;
    const gap = Math.min(b.body.o.radius * 0.2 * CFG.planBeads, span / Math.max(1, n - 1));
    const br = Math.max(1.6, Math.min(gap * 0.36, b.body.o.radius * 0.075 * CFG.planBeads));
    const cx = (box.minX + box.maxX) / 2, cy = box.maxY - h * 0.23, half = (gap * (n - 1)) / 2;
    const fade = b.planAllAt !== undefined ? Math.max(0, 1 - (time - b.planAllAt - 6) / 2) : 1;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const dx = i * gap - half, u = half ? dx / (w * 0.5) : 0;
      const x = cx + dx, y = cy - u * u * h * 0.32; // following the curve of its belly
      const st = items[i].status;
      // The one just ticked off pops up a size, then settles.
      const k = i === pr.done - 1 && b.beadAt !== undefined ? 1 + 0.7 * Math.max(0, 1 - (time - b.beadAt) / 0.4) : 1;
      ctx.beginPath();
      ctx.arc(x, y, br * k, 0, Math.PI * 2);
      if (st === 'completed') ctx.fillStyle = `rgba(255,255,255,${0.9 * fade})`;
      else if (st === 'in_progress') ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.3 * Math.sin(time * 4)) * fade})`;
      else ctx.fillStyle = `rgba(0,0,0,${0.16 * fade})`;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawClouds() {
    for (const b of buddies.values()) {
      const cl = b.cloud;
      if (!cl) continue;
      const box = b.body.bbox(), r = b.body.o.radius;
      const tx = (box.minX + box.maxX) / 2, ty = box.minY - r * 1.1 - 14;
      // (Only moved when drawn, so eased by the time since it last was.)
      const follow = 1 - Math.exp(-3 * Math.min(0.1, Math.max(0, time - (cl.drawnAt ?? time))));
      cl.drawnAt = time;
      cl.x += (tx - cl.x) * follow;
      cl.y += (ty - cl.y) * follow;
      const k = cl.gone ? 1 - (time - cl.gone) / 0.6 : Math.min(1, (time - cl.born) / 1.5);
      if (k <= 0) continue;
      const w = r * (cl.gone ? 1 + (time - cl.gone) : 1), x = cl.x, y = cl.y;
      ctx.save();
      // Rain: short streaks falling from the cloud onto its head.
      if (!cl.gone) {
        ctx.strokeStyle = '#7fa7d9';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        const fall = Math.max(10, box.minY - y - 6);
        for (let i = 0; i < 7; i++) {
          const ph = (time * 1.5 + i * 0.43) % 1, dx = (i - 3) * w * 0.2 + Math.sin(i * 7) * 3;
          ctx.globalAlpha = k * 0.85 * Math.min(1, (1 - ph) * 4);
          const yy = y + 6 + ph * fall;
          ctx.beginPath(); ctx.moveTo(x + dx, yy); ctx.lineTo(x + dx - 1, yy + 8); ctx.stroke();
        }
      }
      ctx.globalAlpha = k;
      ctx.fillStyle = '#a7aec0';
      ctx.beginPath();
      ctx.ellipse(x, y + 2, w * 0.62, w * 0.24, 0, 0, Math.PI * 2);
      ctx.arc(x - w * 0.28, y - w * 0.02, w * 0.24, 0, Math.PI * 2);
      ctx.arc(x + w * 0.08, y - w * 0.14, w * 0.3, 0, Math.PI * 2);
      ctx.arc(x + w * 0.4, y, w * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function nudgePet(b) {
    if (CFG.play <= 0 || b.kind === 'child' || b.dying) return;
    const ok = (b.state === 'idle' || b.state === 'done') && !b.body.grab && b.body.onFloor() && !b.tag && !b.prank && !b.trick && !b.blow && !b.nibbling && (b.sleep || 0) < 0.1 && idleFor() < 60;
    if (!ok || time < (b.nextNudge ?? (b.nextNudge = time + (60 + Math.random() * 120) / CFG.play))) return;
    b.nextNudge = time + (120 + Math.random() * 240) / CFG.play;
    const c = b.body.centroid(), r = b.body.o.radius, PET = petSize(), bot = b.body.bbox().maxY;
    const p = [...pets.values()].find((p) => p.owner === b && !p.dying && !p.held && Math.abs(p.x - c.x) < r + PET * 1.5 && Math.abs(p.y + PET / 2 - bot) < 12);
    if (!p) return;
    const dir = Math.sign(p.x - c.x) || 1, k = Math.min(1.5, CFG.play);
    b.body.lean(dir * r * 4, DT);
    b.body.pushAt(c.x + dir * r * 0.8, c.y + r * 0.3, dir * 160, 0, r * 0.4, DT);
    p.vx = dir * (260 + Math.random() * 120) * k; p.vy = -(220 + Math.random() * 80) * k; p.va = dir * (6 + Math.random() * 4);
    p.playUntil = time + 2;
    b.happyUntil = time + 1.5;
    b.glanceAt = { spot: p }; b.glanceUntil = time + 1.8;
  }

  // A pile of leaves (or snow) close by: a bored slime takes a big jump
  // right into it, and they fly up everywhere.
  function leafPile(b) {
    if (CFG.play <= 0 || b.kind === 'child' || b.dying || !flakes.length) return;
    const ok = (b.state === 'idle' || b.state === 'done') && !b.body.grab && b.body.onFloor() && !b.tag && !b.prank && !b.trick && !b.blow && !b.nibbling && (b.sleep || 0) < 0.1 && idleFor() < 60;
    if (!ok || time < (b.nextLeafPile ?? (b.nextLeafPile = time + (90 + Math.random() * 200) / CFG.play))) return;
    b.nextLeafPile = time + (180 + Math.random() * 360) / CFG.play;
    const c = b.body.centroid(), r = b.body.o.radius, bot = b.body.bbox().maxY;
    const ground = flakes.filter((f) => f.landed && !f.on && !f.ledge && !f.eaten && Math.abs(f.y - bot) < 24 && Math.abs(f.x - c.x) > r * 1.2 && Math.abs(f.x - c.x) < r * 7);
    let best = null, most = 3;
    for (const f of ground) {
      const n = ground.filter((g) => Math.abs(g.x - f.x) < 60).length;
      if (n > most) { most = n; best = f; }
    }
    if (!best) return;
    const vy = (720 + Math.random() * 140) * Math.min(1.2, CFG.play), air = 2 * vy / CFG.gravity;
    b.hop((best.x - c.x) / air * 1.2, -vy); // (a hop lands a little short)
    b.happyUntil = time + air + 1.2;
    if (Math.random() < 0.5) quip(b, 'wheee', 1.2);
  }

  // You pick up its task pet: it watches, worried, and hops up after it,
  // reaching for it.
  function petWorry(b) {
    if (CFG.petEmpathy <= 0 || b.kind === 'child' || b.dying || b.body.grab) return;
    let p = null;
    for (const q of pets.values()) if (q.owner === b && q.held && !q.dying) { p = q; break; }
    if (!p) return;
    b.petWorryUntil = time + 0.6;
    b.glanceAt = { spot: p }; b.glanceUntil = time + 0.3;
    const c = b.body.centroid(), r = b.body.o.radius, dx = p.x - c.x, up = c.y - p.y;
    if (b.body.onFloor() && time > (b.nextReach || 0) && b.state !== 'working' && (up > r * 1.5 || Math.abs(dx) > r * 3)) {
      b.nextReach = time + 1 + Math.random() * 0.6;
      b.hop(Math.max(-300, Math.min(300, dx * 0.8)) * Math.min(1.5, CFG.petEmpathy), -(200 + Math.min(200, Math.max(0, up - r))) * Math.min(1.3, CFG.petEmpathy));
    }
  }

  // On the floor, or sitting still on something (another slime, say).
  const resting = (o) => o.body.onFloor() || (!o.body.grab && Math.hypot(o.body.velocity(DT).x, o.body.velocity(DT).y) < 40);

  // A new session's slime lands: the nearest calm one hops over to say hi,
  // and it says hi back with a little bounce.
  function welcome(b) {
    if (b.needsGreet && time > b.needsGreet && b.body.onFloor() && !b.body.grab) {
      b.needsGreet = 0;
      if (CFG.greetNew <= 0 || b.dying) return;
      const c = b.body.centroid(), r = CFG.mainRadius; // (it's still growing)
      let best = null, bd = r * 14;
      for (const o of buddies.values()) {
        if (o === b || o.kind === 'child' || o.dying || o.merging || o.body.grab || !resting(o) || o.tag || o.prank || o.blow || o === buddies.get(talkingTo)) continue;
        if (o.state === 'working' && Math.random() < 0.7) continue; // (busy, mostly)
        const d = Math.abs(o.body.centroid().x - c.x);
        if (d < bd && Math.abs(o.body.centroid().y - c.y) < r * 1.5) { bd = d; best = o; }
      }
      if (!best) return;
      const oc = best.body.centroid(), side = Math.sign(oc.x - c.x) || 1, gap = r + best.body.o.radius * 1.1;
      best.greeting = { o: b, at: time };
      if (Math.abs(oc.x - c.x) > gap * 1.3) {
        const vy = 300 * Math.min(1.3, CFG.greetNew), air = 2 * vy / CFG.gravity;
        best.hop((c.x + side * gap - oc.x) / air * 0.8, -vy);
      }
      return;
    }
    const g = b.greeting;
    if (!g) return;
    if (g.o.dying || b.body.grab || time - g.at > 5) { b.greeting = null; return; }
    if (!resting(b) || b.pendingHop || time - g.at < 0.4) return;
    b.greeting = null;
    const o = g.o;
    b.glanceAt = o; b.glanceUntil = time + 1.5;
    b.happyUntil = time + 1.5;
    quip(b, 'hi!', 1.2);
    b.body.squashTop(-b.body.o.radius * 10, DT);
    setTimeout(() => {
      if (o.dying || b.dying) return;
      o.glanceAt = b; o.glanceUntil = time + 1.5;
      o.happyUntil = time + 1.5;
      quip(o, 'hi', 1.2);
      if (o.body.onFloor() && !o.body.grab) o.hop(0, -220 * Math.min(1.3, CFG.greetNew));
    }, 600);
  }

  // Once in a long while: a fit of hiccups. Each one jolts it up a little.
  // Fast asleep, a slime now and then mumbles in its sleep, often about
  // what it was last doing ("…fixed the… zz").
  function sleepTalk(b) {
    if (CFG.sleepTalk <= 0 || b.kind === 'child' || (b.sleep || 0) < 0.8) { b.nextMumble = 0; return; }
    if (!b.nextMumble) { b.nextMumble = time + (25 + Math.random() * 40) / CFG.sleepTalk; return; }
    if (time < b.nextMumble) return;
    b.nextMumble = time + (40 + Math.random() * 80) / CFG.sleepTalk;
    const st = b.status && b.status.text, words = st ? String(st).replace(/[.!?:]+$/, '').split(/\s+/).slice(0, 3).join(' ').toLowerCase() : '';
    const said = ['mm…', 'five more minutes…', 'mmh… snacks…', '…zz…'];
    if (words) said.push(`…${words}… zz`, `mm… ${words}…`, `…${words}…`);
    quip(b, said[Math.floor(Math.random() * said.length)], 2.2);
    b.mumbleUntil = time + 2.2;
    b.body.squashTop(-60, DT); // (a little stir)
  }

  function hiccup(b) {
    if (CFG.quirks <= 0 || b.kind === 'child' || b.dying) return;
    if (b.hics) {
      if (time < b.hics.next || b.body.grab) return;
      if (b.hics.n-- <= 0) { b.hics = null; return; }
      b.hics.next = time + 1.1 + Math.random() * 1.4;
      if (!b.body.onFloor()) return;
      b.body.squashTop(-b.body.o.radius * 7, DT);
      b.body.impulse(0, -90, DT);
      b.startleUntil = time + 0.25;
      if (Math.random() < 0.5) quip(b, 'hic!', 0.8);
      return;
    }
    if (time < (b.nextHics ?? (b.nextHics = time + (600 + Math.random() * 1800) / CFG.quirks))) return;
    b.nextHics = time + (900 + Math.random() * 2400) / CFG.quirks;
    if (b.state === 'idle' || b.state === 'done') b.hics = { n: 4 + Math.floor(Math.random() * 4), next: time };
  }

  // You're petting another slime close by: it comes over for some too,
  // and gives you big eyes.
  function jealous(b) {
    if (CFG.jealous <= 0 || b.kind !== 'mother' || b.body.grab || !b.body.onFloor() || b.pendingHop || time < (b.nextJealous || 0)) return;
    if (b.state !== 'idle' && b.state !== 'done') return;
    const o = pet.target && pet.target.body && pet.target !== b && time < (pet.target.pettedUntil || 0) ? pet.target : null;
    if (!o) return;
    const c = b.body.centroid(), oc = o.body.centroid(), r = b.body.o.radius;
    const gap = Math.abs(oc.x - c.x) - r - o.body.o.radius;
    if (gap > r * 10 || Math.abs(oc.y - c.y) > r * 2) return;
    b.wantsPetsUntil = time + 3;
    // Over it comes, a hop at a time, then waits its turn.
    b.nextJealous = time + (gap > r * 0.4 ? 0.9 : 6 / CFG.jealous);
    if (gap > r * 0.4) {
      const vy = 400, air = 2 * vy / CFG.gravity;
      b.hop(Math.sign(oc.x - c.x) * Math.min(600, (gap - r * 0.2) / air), -vy);
    }
  }

  // Fond of you (petted lately): it tags along after your cursor for a bit.
  function tagAlong(b) {
    if ((b.mood || 0) < 0.75 || lulled(b) || b.kind === 'child' || b.ghost || b.ghostBy || b.body.grab || !b.body.onFloor() || b.pendingHop || time < (b.nextTagAlong || 0)) return;
    if (b.state !== 'idle' && b.state !== 'done') return;
    if (performance.now() / 1000 - mouse.lastMove > 3 || mouse.x < 0 || mouse.x > W) return;
    const c = b.body.centroid(), r = b.body.o.radius, dx = mouse.x - c.x;
    if (Math.abs(dx) < r * 3) return;
    b.nextTagAlong = time + 1.2 + Math.random() * 1.5;
    b.happyUntil = time + 1;
    cursorHop(b, Math.sign(dx) * Math.min(480, (Math.abs(dx) - r * 2) * 1.2), -330);
  }

  // The tuning panel's Show off button: a quick run through the rarer bits
  // of life (they'd otherwise take hours to all turn up).
  function showOff() {
    const at = (s, f) => setTimeout(f, s * 1000);
    const big = () => bigs().filter((b) => !b.dying);
    const was = seasonOverride;
    if (season() === 'none' || season() === 'summer') seasonOverride = 'leaves';
    showingOff = true;
    at(0.5, () => { const b = big()[0]; if (b) startTrick(b, true); }); // (only an idle one plays along; another copies it)
    at(3, () => { const [b, o] = big(); if (b && o) { b.prank = null; b.nextPrank = 0; prankNow(b, o); } });
    at(7, () => {
      const b = big()[0];
      if (!b) return;
      const body = b.body, c = body.centroid();
      let top = 0;
      for (let i = 0; i < body.n; i++) if (body.py[i] < body.py[top]) top = i;
      flakes.push({ kind: 'leaves', x: c.x, y: body.py[top], vx: 0, vy: 0, drift: 0, sway: 0, size: 9, a: 0, va: 0, color: LEAF_COLORS[0], on: { b, i: top, dx: 0 }, landed: 0 });
      b.sneeze = { at: time + 0.7 };
    });
    at(10, () => { const b = big()[1] || big()[0]; if (b) b.hics = { n: 3, next: time }; });
    at(14, () => charge());
    at(23, () => { const [b, o] = big(); if (b && o && !b.tag && !o.tag) tagNow(b, o); });
    at(29, () => { const b = big()[1] || big()[0]; if (b && !b.blow) b.blow = { at: time + 0.7, side: 1 }; });
    at(31, () => addFlutter());
    at(17, () => { const b = buddies.get(HOME) || big()[0]; if (b) b.say([{ text: 'While you were away (demo):' }, ...summaryLines()], 6, false, false); });
    // Part two: a trampoline, a burp, a dream, a somersault, a tumble, leapfrog, a tower, a roly-poly, a heart, a balloon, skipping rope.
    at(34, () => {
      const [b, o] = big();
      if (!b || !o || b.body.grab || o.body.grab) return;
      const c = o.body.centroid();
      b.body.teleport(c.x, Math.max(b.body.o.radius + 10, c.y - o.body.o.radius * 4.5));
      const v = b.body.velocity(DT);
      b.body.impulse(-v.x, 500 - v.y, DT);
    });
    at(39, () => { const b = big()[0]; if (b) { b.bubble = null; b.burpAt = time; } });
    at(42, () => { const b = big()[1] || big()[0]; if (b) { b.dream = { what: 'sheep', until: time + 4.5, demo: true }; b.napUntil = time + 4.5; } });
    at(47.5, () => { const b = big()[0]; if (b) { b.forceFlip = true; startTrick(b, false); } });
    at(53, () => {
      const b = big()[1] || big()[0];
      if (!b || b.body.grab) return;
      const v = b.body.velocity(DT), dir = b.body.centroid().x < W / 2 ? 1 : -1;
      b.body.impulse(dir * 1100 - v.x, -900 - v.y, DT);
      throwSpin(b);
    });
    at(57.5, () => {
      const [b, o] = big();
      if (!b || !o || b.body.grab || o.body.grab) return;
      const r = b.body.o.radius, y = H - r * 1.2;
      b.body.teleport(W * 0.2, y); o.body.teleport(W * 0.2 + (r + o.body.o.radius) * 1.15, y);
      setTimeout(() => { if (!b.dying && !o.dying && !b.frog && !o.frog) frogNow(b, o); }, 900);
    });
    at(66, () => {
      const [b, o] = big();
      if (!b || !o || b.body.grab || o.body.grab || b.tower || o.tower) return;
      const r = b.body.o.radius, y = H - r * 1.2;
      b.body.teleport(W * 0.5, y); o.body.teleport(W * 0.5 + (r + o.body.o.radius) * 1.3, y);
      setTimeout(() => { if (!b.dying && !o.dying && !b.tower && !o.tower) towerNow(b, o); }, 900);
    });
    at(73, () => { const b = big()[1] || big()[0]; if (b && !b.roll && !b.tower) rollNow(b); });
    at(77, () => { const b = big()[0]; if (b && !b.shape) b.shape = { at: time }; });
    at(81, () => { const b = big()[1] || big()[0]; if (b && !b.balloon && !b.body.grab) balloonNow(b); });
    at(88, () => {
      const [b, p, q] = big();
      if (!b || !p || !q || rope || [b, p, q].some((o) => o.body.grab)) return;
      const y = H - b.body.o.radius * 1.2;
      b.body.teleport(W * 0.5, y); p.body.teleport(W * 0.5 - b.body.o.radius * 3.5, H - p.body.o.radius * 1.2); q.body.teleport(W * 0.5 + b.body.o.radius * 3.5, H - q.body.o.radius * 1.2);
      setTimeout(() => { if (!rope && ![b, p, q].some((o) => o.dying)) ropeNow(b, p, q); }, 1200);
    });
    at(103, () => { seasonOverride = was; showingOff = false; });
  }
  let showingOff = false;

  // A little exclamation ("boo!", "hic!") in a balloon, said out loud,
  // unless it's already showing something that matters more, and only now
  // and then (see mayTalk): most go unsaid. A reaction is one to you
  // playing with it.
  function quip(b, text, seconds, size, kind = 'flavour') {
    if (b.bubble && b.bubble.until - time > 0.3) return;
    if (!mayTalk(kind)) return;
    b.say([size ? { text, size } : { text }], seconds, false, { minor: true });
  }
  function quipBack(b, text, seconds) { quip(b, text, seconds, 0, 'react'); }

  function pounce(b) {
    if (time < (b.pounceUntil || 0)) {
      if (!b.caught && b.body.contains(mouse.x, mouse.y)) {
        b.caught = true;
        spawnHeart({ x: mouse.x, y: mouse.y - 10, vx: 0, born: time, size: 12 });
      }
      return;
    }
    const calm = b.kind !== 'home' && (b.state === 'idle' || b.state === 'done') && !lulled(b) && !b.body.grab && !b.merging && !drag && b.body.onFloor() && !b.stackedBy;
    const c = b.body.centroid(), r = b.body.o.radius, above = b.body.bbox().minY - mouse.y;
    const teasing = calm && Math.abs(mouse.x - c.x) < r * 1.6 && above > r * 0.2 && above < r * 3.5 && performance.now() / 1000 - mouse.lastMove < 0.3;
    if (!teasing) {
      if (b.teaseSince && time - b.teaseLast > 0.5) b.teaseSince = 0;
      return;
    }
    b.teaseLast = time;
    if (!b.teaseSince) { b.teaseSince = time; b.teaseWait = 0.8 + Math.random() * 0.8; }
    if (time - b.teaseSince < b.teaseWait || time < (b.nextPounce || 0)) {
      // Getting ready: a little side-to-side wiggle, like a cat.
      if (time - b.teaseSince > 0.3 && time > (b.nextWiggle || 0)) {
        b.wiggleDir = -(b.wiggleDir || 1);
        b.body.impulse(b.wiggleDir * 70, 30, DT);
        b.nextWiggle = time + 0.12;
      }
      return;
    }
    const reach = Math.max(40, c.y - mouse.y);
    b.hop(Math.max(-500, Math.min(500, (mouse.x - c.x) * 3)), -Math.sqrt(2 * CFG.gravity * reach) * 1.05);
    b.pounceUntil = time + 0.9;
    b.caught = false;
    b.nextPounce = time + 1.5 + Math.random() * 1.5;
    b.teaseSince = 0;
  }

  // Slimes that are splitting off or merging into another overlap it freely.
  function passThrough(a, b) {
    const pair = (x, y) => (y.splitting && y.parent === x) || (y.merging && y.mergeInto === x);
    return pair(a, b) || pair(b, a) || a.dying || b.dying;
  }

  // A helper that can't get to its mum gives up for a while, whatever's in
  // the way: she's up higher than it can jump (a window, a talk box), or it
  // keeps hopping toward her and getting nowhere (something in the way, or
  // stuck), or she's held up out of its reach for a good while. Each hop
  // toward her is judged once it has landed and stood still a moment (a
  // jump that gets close in the air and falls back is a miss): one that
  // didn't get up to her window, or didn't get it any nearer to where she
  // was, is a miss. Five misses in a row and it gives up (a heart breaking
  // above it, a slow sigh out, a slump). A chase that's just taking a while
  // (it gains on where she was, even if she's moved on) never counts, nor
  // does a hop it didn't make because it was busy, held or bumped. Then it
  // rests for minutes (4 to 8, twice that each time it has to give up
  // again, 20 at most) and doesn't go after her at all, unless she comes to
  // it by herself (standing right by it, on the same floor or window): then
  // it's glad and goes to her. A finished one fades back into her after its
  // sad moment.
  const mumOf = (b) => (b.merging && b.mergeInto) || b.mother;
  // A helper's legs: the fastest it can take off (px/s), and so how high it
  // can get, the air slowing it (lower when it's tired: a low battery).
  const LEAP = 1800;
  function leapHeight() {
    const d = CFG.damping, g = CFG.gravity;
    let y = 0, v = -LEAP * (1 - 0.3 * sys.low), peak = 0;
    for (let n = 0; n < 2000 && v < 0; n++) { v = (v + g * DT) * d; y += v * DT; peak = Math.min(peak, y); }
    return -peak;
  }
  function mumOutOfReach(b) {
    const m = mumOf(b), c = b.body.centroid(), mc = m.body.centroid(), r = b.body.o.radius;
    if (b.merging) return Math.hypot(mc.x - c.x, mc.y - c.y) >= m.body.o.radius + r * 0.4;
    const far = m.body.o.radius * 2 + r * 6, rise = b.body.bbox().maxY - m.body.bbox().maxY;
    return Math.abs(mc.x - c.x) > far || (rise > r && !!m.body.onLedge);
  }
  // She's come to it: standing (not mid-hop, not carried) on the same
  // window or floor, close by.
  function mumNear(b) {
    const m = mumOf(b), ml = m.body.onLedge, l = b.body.onLedge, r = b.body.o.radius;
    if (!m.body.onFloor() || m.body.grab || m.pendingHop) return false;
    const same = l || ml ? !!(l && ml && l.id === ml.id) : Math.abs(b.body.bbox().maxY - m.body.bbox().maxY) < r;
    return same && Math.abs(m.body.centroid().x - b.body.centroid().x) < m.body.o.radius * 2 + r * 6;
  }
  // Every hop toward her goes through here (see behave, and the trip home
  // in step), noting what it's trying for: up onto her window, or just
  // nearer where she is. Heading for her, it may hop down off a window (it
  // otherwise never wanders off one), and other slimes' bumps don't bother
  // it.
  function hopToMum(b, vx, vy) {
    const m = mumOf(b), ml = m.body.onLedge, l = b.body.onLedge;
    const up = ml && !(l && l.id === ml.id) && b.body.bbox().maxY - m.body.bbox().maxY > b.body.o.radius;
    const c = b.body.centroid(), mc = m.body.centroid();
    b.trying = { at: time, up: up ? ml.id : null, from: Math.hypot(mc.x - c.x, mc.y - c.y), mx: mc.x, my: mc.y };
    b.seekUntil = time + 3;
    b.toMum = !(l && ml && l.id === ml.id); // (on her window with her, it minds the edge as ever)
    b.hop(vx, vy);
    b.toMum = false;
  }
  // She's up on a window: an aimed jump, high enough to clear its edge,
  // landing near her (the near side of her, or the far side if that has no
  // room), as hard as its legs allow. False if she isn't.
  function jumpUpTo(b, m) {
    const rise = b.body.bbox().maxY - m.body.bbox().maxY, l = m.body.onLedge;
    if (!(rise > b.body.o.radius && l)) return false;
    const c = b.body.centroid(), mc = m.body.centroid(), dx = mc.x - c.x, cr = b.body.o.radius;
    const gap = m.body.o.radius + cr * 1.3;
    let tx = mc.x - Math.sign(dx) * gap;
    if (tx < l.x0 + cr * 1.2 || tx > l.x1 - cr * 1.2) tx = mc.x + Math.sign(dx) * gap;
    tx = Math.max(l.x0 + cr * 1.2, Math.min(l.x1 - cr * 1.2, tx));
    const v = launch(tx - c.x, rise + cr * 2, rise); // (with the air slowing it: see launch)
    hopToMum(b, Math.max(-600, Math.min(600, v.vx)), Math.max(-LEAP, v.vy));
    return true;
  }
  // A try that hasn't been judged yet (it's still in the air, or hasn't
  // stood still since): it waits for that before the next.
  const stillTrying = (b) => !!b.trying && time - b.trying.at < 6;
  const homeward = (b) => b.kind === 'child' && !b.gaveUp && (b.merging || time < (b.seekUntil || 0));
  function missMum(b) {
    if (b.kind !== 'child' || b.dying) return;
    const m = b.mother;
    if (!m || m.dying || m.removed) { b.trying = b.tries = b.gaveUp = null; return; }
    if (b.body.grab) { b.trying = b.tries = null; b.stillSince = b.heldOut = 0; } // (carried off: it starts over wherever it's put)
    // Standing still on something for a moment (not a landing's bounce,
    // not crouched for a hop).
    const still = b.body.onFloor() && !b.pendingHop && !b.body.grab && Math.abs(b.body.velocity(DT).y) < 60;
    b.stillSince = still ? b.stillSince || time : 0;
    const settled = still && time - b.stillSince > 0.4;
    const g = b.gaveUp;
    if (g) {
      // The sigh, as the heart's halves fall away: a breath in (it rises a
      // little), then a long breath out (a little puff from its mouth, and
      // it sinks).
      const r = b.body.o.radius, t = time - g.at;
      if (t > 0.7 && t < 1.1 && b.body.onFloor()) b.body.squashTop(-r * 0.5 * 60 * DT, DT);
      if (t > 1.1 && t < 2.3 && b.body.onFloor()) b.body.squashTop(r * 0.45 * 60 * DT, DT);
      if (!g.sighed && t > 1.1) {
        g.sighed = true;
        const c = b.body.centroid();
        const side = b.faceTurn && b.faceTurn.x < 0 ? -1 : 1; // (out the side it faces, drifting off its face)
        spawnHeart({ x: c.x + (b.faceTurn ? b.faceTurn.x : 0) + side * r * 0.3, y: c.y + r * 0.3, vx: side * 45, rise: -8, born: time, size: Math.max(4, r * 0.1), puff: true });
      }
      if (b.merging && !g.merging) { b.gaveUp = null; return; } // (done now: it tries again, to get home)
      if (settled && !b.merging && mumNear(b)) {
        // She came: all better.
        b.gaveUp = null;
        b.gaveUps = 0;
        b.happyUntil = time + 1.5;
        spawnHeart({ x: b.body.centroid().x, y: b.body.bbox().minY - 10, vx: 0, born: time, size: 10 });
        b.nextHop = Math.min(b.nextHop, time + 0.3);
      } else if (time > g.until) b.gaveUp = null;
      return;
    }
    if (!settled) return;
    const mm = mumOf(b), r = b.body.o.radius, c = b.body.centroid(), mc = mm.body.centroid();
    // Held up out of its reach (over its head, higher than it can jump):
    // it can only wait, and after a good while it gives up.
    const heldOut = mm.body.grab && b.body.bbox().maxY - mm.body.bbox().maxY > leapHeight() + r;
    b.heldOut = heldOut ? b.heldOut || time : 0;
    let no = heldOut && time - b.heldOut > 10;
    if (!no) {
      if (!mm.body.onFloor() && !mm.body.grab) return; // (she's mid-hop or falling: wait and see where she lands)
      if (!heldOut && !mumOutOfReach(b)) { b.trying = b.tries = null; return; }
      // A hop just made: did it get anywhere?
      const k = b.trying;
      if (k) {
        b.trying = null;
        const ml = mm.body.onLedge, l = b.body.onLedge;
        // (She moved off meanwhile: a chase, not a miss. Else it has to get
        // nearer than it's been yet this time, not just bounce back and forth.)
        const d = Math.hypot(mc.x - c.x, mc.y - c.y), best = Math.min(k.from, b.tries ? b.tries.best : Infinity);
        if (k.up === null && Math.hypot(mc.x - k.mx, mc.y - k.my) > r) b.tries = null;
        else {
          const failed = k.up !== null ? !!ml && ml.id === k.up && !(l && l.id === k.up) : d > best - r * 0.5;
          b.tries = failed ? { n: (b.tries ? b.tries.n : 0) + 1, best: Math.min(best, d) } : { n: 0, best: d };
        }
      }
      no = !!b.tries && b.tries.n >= 5;
    }
    if (!no) return;
    // No use.
    b.tries = null;
    b.heldOut = 0;
    b.gaveUps = (b.gaveUps || 0) + 1;
    const rest = b.merging ? 3 : Math.min(20 * 60, (240 + Math.random() * 240) * 2 ** (b.gaveUps - 1));
    b.gaveUp = { at: time, until: time + rest, merging: !!b.merging };
    b.droopUntil = time + 3.5;
    b.body.squashTop(r * 2, DT);
    spawnHeart({ x: c.x, y: Math.min(b.body.bbox().minY, b.body.lookTop ?? Infinity) - 22, vx: 0, born: time, size: Math.max(10, r * 0.22), broken: true });
  }

	// --- Crowding ---------------------------------------------------------------
	// Packed in tight (pressed on by its neighbours, squeezed in between two,
	// sat on), a slime gets fed up after a while: now and then a squeezed,
	// wobbly face, a grumble puff and a little shove away from whoever's
	// pressing hardest. And one at a time, a while apart, the crowded ones
	// spread out: to an emptier stretch of floor within reach, or else up
	// onto a window top (or a talk box) with room on it; one crowded up on a
	// top hops down again. Family doesn't count: a helper pressed against its
	// mother (or its brothers and sisters) likes it there.
	const CROWDED = 1.6; // (about: pressed on from more than one side)
	const kin = (a, o) => a.mother === o || o.mother === a || (!!a.mother && a.mother === o.mother);
	// How crowded it is right now: each neighbour within half again its
	// radius counts by how close it is (touching 1, less and less further off,
	// squashed into it up to 2; more for a bigger one), more for being squeezed in between two or sat on.
	function crowdOf(b) {
		const c = b.body.centroid(), r = b.body.o.radius;
		let v = 0, left = 0, right = 0, worst = null, most = 0;
		for (const o of buddies.values()) {
			if (o === b || o.dying || o.body.grab || o.merging || kin(b, o)) continue;
			const oc = o.body.centroid(), or = o.body.o.radius;
			const gap = Math.hypot(oc.x - c.x, oc.y - c.y) - r - or;
			if (gap > r * 1.5) continue;
			let press = (gap < 0 ? 1 + Math.min(1, -gap / (r * 0.5)) : (1 - gap / (r * 1.5)) ** 2) * Math.min(1.5, Math.sqrt(or / r));
			if (oc.y > c.y + r * 0.6) press *= 0.3; // (standing on it: not much of a squeeze)
			else if (gap < r * 0.15 && oc.y > c.y - r * 0.6) { if (oc.x < c.x) left = Math.max(left, press); else right = Math.max(right, press); }
			v += press;
			if (press > most) { most = press; worst = o; }
		}
		if (left && right) v += 0.5 * Math.min(left, right);
		if (b.stackedBy && !kin(b, b.stackedBy)) v += 0.6;
		return { v, worst };
	}
	// Every step, for each slime: how crowded it's been (eased over a few
	// seconds), and, fed up, a grumble now and then (each 20-45 s apart, and
	// at most one every 8 s on the whole stage).
	let lastGrumble = -1e9;
	function crowding(b) {
		if (CFG.crowding <= 0 || b.dying || b.removed) { b.crowd = b.crowdedFor = 0; return; }
		if (time - (b.crowdAt ?? -1) >= 0.05) {
			const dt = Math.min(0.5, time - (b.crowdAt ?? time));
			b.crowdAt = time;
			const now = b.body.grab || b.merging || b.splitting ? { v: 0, worst: null } : crowdOf(b);
			b.crowd = (b.crowd || 0) + (now.v - (b.crowd || 0)) * Math.min(1, dt / 2.5);
			b.crowdWorst = now.worst;
			b.crowdedFor = b.crowd > CROWDED ? (b.crowdedFor || 0) + dt : Math.max(0, (b.crowdedFor || 0) - 2 * dt);
		}
		const body = b.body, g = b.grumble;
		if (g) {
			// The shove: it leans away from the one pressing on it, easing in
			// and out, and huffs a puff off the top of its head.
			const t = time - g.at, r = body.o.radius;
			if (body.grab || t > 2.2) { b.grumble = null; return; }
			if (t < 0.9 && body.onFloor()) body.lean(g.away * Math.sin(t / 0.9 * Math.PI) * Math.min(1.5, CFG.crowding) * r * 10 * DT, DT);
			if (!g.puffed && t > 0.5) {
				g.puffed = true;
				const c = body.centroid(), top = body.bbox().minY;
				spawnHeart({ puff: true, x: c.x - g.away * r * 0.3, y: top + 4, vx: -g.away * 14, rise: 26, born: time, size: r * 0.09 });
				if (body.onFloor()) body.squashTop(r * 0.9, DT);
			}
			return;
		}
		const calm = b.state === 'idle' || b.state === 'done' || b.state === 'working';
		if (!calm || b.crowdedFor < 5 || body.grab || !body.onFloor() || b.merging || b.splitting || b.move || playing(b) || (b.sleep || 0) > 0.3) return;
		if (!b.nextGrumble) { b.nextGrumble = time + Math.random() * 10; return; }
		if (time < b.nextGrumble || time - lastGrumble < 8) return;
		b.nextGrumble = time + 20 + Math.random() * 25;
		lastGrumble = time;
		const o = b.crowdWorst, c = body.centroid();
		const away = o && !o.dying ? -Math.sign(o.body.centroid().x - c.x) || 1 : Math.random() < 0.5 ? -1 : 1;
		b.grumble = { at: time, away };
		b.grumbleUntil = time + 2.2;
		if (o && !o.dying) { b.glanceAt = o; b.glanceUntil = time + 1.6; }
		// Now and then a word for it (shown, not said: it's only grumbling),
		// when there's room for a line of personality.
		if (!b.bubble && Math.random() < 0.3 && mayTalk('flavour')) b.say([{ text: ['hmph', 'scooch…', 'squished…'][Math.floor(Math.random() * 3)] }], 1.6);
	}

	// Spreading out: who goes, and where. One slime at a time, each a good
	// while after the last (8-14 s), so the stage spreads out bit by bit;
	// one that has moved stays put a while (a minute, longer each time).
	let mover = null, nextMove = 0;
	// The room to either side at x on the floor, for b (its own family will
	// squeeze in with it).
	function floorRoom(b, x) {
		const r = b.body.o.radius;
		let room = Math.min(x - r, W - x - r);
		for (const o of buddies.values()) {
			if (o === b || o.dying || o.body.grab || o.body.onLedge || kin(b, o)) continue;
			room = Math.min(room, Math.abs(o.body.centroid().x - x) - r - o.body.o.radius);
		}
		return room;
	}
	// The roomiest gap on a window top, for b (and its helpers, who'll come
	// up after it): { x, room } or null.
	function ledgeRoom(b, l) {
		const r = b.body.o.radius;
		let need = r * 2;
		if (b.big) for (const k of kidsOf(b)) if (!k.merging) need += k.body.o.radius * 2.2;
		const taken = [];
		for (const o of buddies.values()) {
			const ol = o.body.onLedge;
			if (o === b || o.dying || !ol || ol.id !== l.id || Math.abs(ol.y - l.y) > 10 || kin(b, o)) continue;
			const ox = o.body.centroid().x, or = o.body.o.radius + r * 0.2;
			taken.push([ox - or, ox + or]);
		}
		taken.sort((p, q) => p[0] - q[0]);
		let from = l.x0 + r * 0.15, best = null; // (its middle a good radius in from the edge)
		for (const [a, z] of [...taken, [l.x1 - r * 0.15, Infinity]]) {
			if (a - from >= need && (!best || a - from > best.z - best.a)) best = { a: from, z: a };
			from = Math.max(from, z);
		}
		// (Snug toward one end of the gap, leaving the rest of it for others.)
		return best && { x: best.a + need / 2 + Math.min((best.z - best.a - need) / 2, r * 0.2), room: (best.z - best.a - need) / 2 };
	}
	// How high it can hop to get up onto a window top, at most.
	const climbOf = (b) => Math.min(520, b.body.o.radius * 8);
	const canClimb = (b, l) => b.body.bbox().maxY - l.y <= climbOf(b) && !l.vx && !l.vy && l.y > b.body.o.radius * 3 && !(b.noGo && b.noGo.id === l.id && time < b.noGo.until);
	// Where a crowded slime could go: free floor first (within reach), else
	// the roomiest window top it can get up onto, not too far off.
	function roomFor(b) {
		const c = b.body.centroid(), r = b.body.o.radius, here = b.body.onLedge, reach = Math.max(r * 14, 700);
		let floor = null;
		for (let x = r * 1.5; x <= W - r * 1.5; x += r * 0.5) {
			const d = Math.abs(x - c.x);
			if (d > reach || (!here && d < r * 1.5)) continue;
			if (floorRoom(b, x) >= r * 0.9 && (!floor || d < floor.d)) floor = { x, d };
		}
		if (floor) return { x: floor.x };
		if (b.kind === 'child') return null; // (helpers only ever hop down: their mum is the place to be)
		let best = null;
		for (const l of ledges) {
			if ((here && here.id === l.id) || l.x1 - l.x0 < r * 3 || l.y > H - r || !canClimb(b, l)) continue;
			const spot = ledgeRoom(b, l);
			if (!spot || spot.room < r * 0.3) continue;
			const d = Math.abs(spot.x - c.x);
			if (d > reach * 1.6) continue;
			const score = Math.min(spot.room, r * 4) / r - d / 600;
			if (!best || score > best.score) best = { ledge: l.id, y: l.y, off: spot.x - l.x0, score };
		}
		return best;
	}
	// Standing somewhere it can hop from: the floor, a window top, or up on
	// the others it was squashed in with (jiggling about a bit on them).
	const perched = (b) => b.body.onFloor() || (!b.body.grab && Math.hypot(b.body.velocity(DT).x, b.body.velocity(DT).y) < 150);
	const movable = (b) => !b.dying && !b.removed && !b.merging && !b.splitting && !b.body.grab && !playing(b) && (b.state === 'idle' || b.state === 'done' || b.state === 'working')
		&& !wantsAttention(b) && (b.sleep || 0) < 0.1 && b.key !== talkingTo && time > (b.talkHold || 0) && !b.gaveUp && !b.glasses;
	function endMove(b, ok) {
		if (!b.move) return;
		if (!ok && b.move.to.ledge != null) b.noGo = { id: b.move.to.ledge, until: time + 300 }; // (couldn't get up there: not that one again for a while)
		b.move = null;
		b.moves = (b.moves || 0) + 1;
		b.stayUntil = time + 60 * Math.min(4, b.moves);
		b.crowdedFor = 0;
		if (ok) b.happyUntil = time + 1.2; // (ahh, room)
		else b.droopUntil = time + 1.5;
		if (mover === b) mover = null;
		nextMove = time + (ok ? 8 + Math.random() * 6 : 4 + Math.random() * 3); // (sooner after one that didn't get anywhere)
	}
	function spreadOut() {
		if (mover) {
			if (mover.removed || !movable(mover) || time - mover.move.since > 22) endMove(mover, false);
			else {
				// Landed on the window top it was going for: it stops (not
				// sliding on along it); then it shuffles over to its spot, snug at
				// one end, leaving the rest of the room for others (see moveOn).
				const m = mover.move, l = mover.body.onLedge;
				if (l && m.to.ledge === l.id && !m.landed) { m.landed = true; mover.body.impulse(-mover.body.velocity(DT).x * 0.7, 0, DT); mover.nextHop = Math.max(mover.nextHop, time + 0.6); }
			}
			return;
		}
		if (CFG.crowding <= 0 || time < nextMove) return;
		nextMove = time + 0.5;
		const mumHere = (b) => { const m = liveMother(b); return !!(m && m.body.onLedge && m.body.onLedge.id === b.body.onLedge.id); };
		const fed = [...buddies.values()].filter((b) => b.crowdedFor > 6 && time > (b.stayUntil || 0) && perched(b) && movable(b) && !b.stackedBy && (b.kind !== 'child' || (b.body.onLedge && !mumHere(b))));
		fed.sort((p, q) => q.crowd - p.crowd); // (the most crowded first; not one with another sat on it: it couldn't get out)
		for (const b of fed.slice(0, 3)) {
			const to = roomFor(b);
			if (!to) { b.stayUntil = time + 20; continue; } // (nowhere better: it puts up with it a while)
			b.move = { to, since: time, hops: 0 };
			mover = b;
			return;
		}
	}
	// Up onto a window top: one aimed jump, high enough to clear its edge,
	// coming down onto it at x. (False if it's too far off for one jump.)
	function jumpOnto(b, l, x) {
		const body = b.body, c = body.centroid(), r = body.o.radius, g = CFG.gravity;
		const rise = body.bbox().maxY - l.y, dx = Math.max(l.x0 + r * 0.8, Math.min(l.x1 - r * 0.8, x)) - c.x;
		const vy = Math.sqrt(2 * g * Math.max(r, rise + r * 2.4));
		const air = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * g * rise))) / g;
		if (Math.abs(dx) / air > 560 && !body.onLedge) return false;
		b.leaving = time + 0.6; b.softUntil = time + 3;
		b.hop(Math.max(-600, Math.min(600, dx / air)), -vy);
		return true;
	}
	// Off a window top: out over its edge on the side it's going (dir), to
	// drop down and land softly.
	function hopOff(b, dir) {
		const l = b.body.onLedge, c = b.body.centroid(), r = b.body.o.radius, edge = dir < 0 ? l.x0 : l.x1;
		// (Up long enough to get clear of the edge before it comes down.)
		const out = Math.abs(edge - c.x) + r * 1.6, vy = Math.max(300, Math.min(700, out / 520 * CFG.gravity / 2));
		b.leaving = time + 0.6; b.softUntil = time + 3;
		b.hop(dir * Math.min(600, out / (2 * vy / CFG.gravity)), -vy);
	}
	// Each hop on the way (from behave, when it's ready for one): over
	// whoever's in the way along the floor, then, near enough under a window
	// top, one aimed jump up onto it; off a top, a hop out over the edge. A
	// few tries at most (7 hops, 20 s), then it gives up on it.
	function moveOn(b) {
		const m = b.move, to = m.to, body = b.body, c = body.centroid(), r = body.o.radius, l = body.onLedge;
		const target = to.ledge != null ? ledges.find((o) => o.id === to.ledge && Math.abs(o.y - to.y) < 40) : null;
		if (to.ledge != null && !target) { endMove(b, false); return; } // (the window went away, or moved off)
		const tx = target ? target.x0 + to.off : to.x, dx = tx - c.x, up = !!(target && l && l.id === target.id);
		if (up ? Math.abs(dx) < r : !l && Math.abs(dx) < r * 0.8) { endMove(b, true); return; }
		if (m.hops >= 7 || time - m.since > 20) { endMove(b, up); return; } // (up there, near enough)
		m.hops++;
		b.nextHop = time + 1 + Math.random() * 0.5;
		if (up) { b.hop(Math.sign(dx) * Math.min(500, Math.abs(dx) / (460 / CFG.gravity) + 20), -230); return; } // (a shuffle along it)
		if (target && jumpOnto(b, target, tx)) return;
		if (!target && l) { hopOff(b, Math.sign(dx) || 1); return; }
		// Along the floor: a hop toward it, high enough to clear whoever's in
		// the way.
		const step = Math.sign(dx) * Math.max(r, Math.min(Math.abs(dx) - (target ? 200 : 0), 420));
		let over = r * 0.5;
		for (const o of buddies.values()) {
			if (o === b || o.dying || o.body.onLedge) continue;
			const ox = o.body.centroid().x;
			if ((ox - c.x) * Math.sign(step) > 0 && Math.abs(ox - c.x) < Math.abs(step) + o.body.o.radius) over = Math.max(over, (o.body.bbox().maxY - o.body.bbox().minY) * 1.1);
		}
		const vy = Math.sqrt(2 * CFG.gravity * over), air = 2 * vy / CFG.gravity;
		b.hop(Math.max(-560, Math.min(560, step / air)), -vy);
	}

	// Hopping after your cursor (vx, vy: the hop it would take along the
	// floor) works from window tops too: the cursor just over another window
	// top it can get up onto, it jumps up there; off past the edge of the one
	// it's on, or well below it, it hops down. Three jumps at one window top
	// that don't get it there, and it leaves that one be for a few minutes.
	function liftFor(b) {
		const l = b.body.onLedge, r = b.body.o.radius;
		return ledges.find((o) => (!l || o.id !== l.id) && mouse.x >= o.x0 + r * 0.5 && mouse.x <= o.x1 - r * 0.5 && mouse.y < o.y && o.y - mouse.y < r * 6 && o.x1 - o.x0 > r * 2.5 && canClimb(b, o)) || null;
	}
	function cursorHop(b, vx, vy) {
		const l = b.body.onLedge, c = b.body.centroid(), r = b.body.o.radius, up = liftFor(b);
		if (b.seekUp && l && l.id === b.seekUp.id) b.seekUp = null; // (made it)
		if (up) {
			if (!b.seekUp || b.seekUp.id !== up.id) b.seekUp = { id: up.id, n: 0 };
			if (b.seekUp.n >= 3) { b.noGo = { id: up.id, until: time + 300 }; b.seekUp = null; }
			else if (jumpOnto(b, up, mouse.x)) { b.seekUp.n++; return; }
		}
		if (l && (mouse.x < l.x0 || mouse.x > l.x1 || mouse.y > l.y + r * 3)) {
			const dir = mouse.x < l.x0 ? -1 : mouse.x > l.x1 ? 1 : c.x - l.x0 < l.x1 - c.x ? -1 : 1;
			hopOff(b, dir);
			return;
		}
		b.hop(vx, vy);
	}

  function behave(b) {
    // Blinking (shut in about 70 ms, open again in 80, so a blink still
    // shows when frames are drawn only 30 times a second).
    if (time > b.nextBlink) {
      b.blink = Math.min(1, b.blink + 15 * DT);
      if (b.blink >= 1) {
        // Now and then a quick second blink right after.
        const again = !b.doubled && Math.random() < 0.18 * CFG.eyeLife;
        b.doubled = again;
        b.nextBlink = time + (again ? 0.16 : (2 + Math.random() * 4) / trait(b, 'blinky'));
      }
    } else b.blink = Math.max(0, b.blink - 12 * DT);

    if (b.bubble && time > b.bubble.until) b.bubble = null;
    if (b.pulse) {
      b.pulse = false;
      if (b.body.onFloor() && !b.body.grab) b.body.impulse(0, 260, DT);
    }
    // A long turn (over 5 minutes) gets a yawn and a stretch now and then.
    const since = b.session && b.session.turnStart ? (Date.now() - b.session.turnStart) / 1000 : 0;
    if (b.kind === 'mother' && b.state === 'working' && since > 300 && time > (b.nextYawn || 0)) {
      if (b.nextYawn) yawn(b, 1.6, 0.6);
      b.nextYawn = time + 20 + Math.random() * 30;
    }
    // Left alone for a couple of minutes, idle slimes doze off and yawn.
    if (b.body.onFloor() && !b.body.grab && !b.merging) huddle(b);
    // Still needing you after a few minutes: it says so (once per wait),
    // with what it's waiting on.
    if (CFG.waitNudge > 0 && b.kind === 'mother' && b.state === 'waiting' && b.nudgedFor !== b.stateSince && time - (b.stateSince ?? time) > CFG.waitNudge * 60 && !sys.away && b !== buddies.get(talkingTo)) {
      b.nudgedFor = b.stateSince;
      const mins = Math.round((time - b.stateSince) / 60);
      const what = b.status && b.status.state === 'waiting' && b.status.text;
      b.say([{ text: `Still waiting on you (${mins} min)` }, ...(what ? [{ text: what, size: 12 }] : [])], 6, false, false);
    }
    sulk(b);
    rumble(b);
    burp(b);
    somersault(b);
    tumble(b);
    roll(b);
    skate(b);
    shapeShift(b);
    balloon(b);
    if (b.bounceAt && time > b.bounceAt) { // (sprung off a trampoline, see stackPlay)
      b.bounceAt = 0;
      if (!b.body.grab) { const v = b.body.velocity(DT); b.body.impulse((Math.random() - 0.5) * 120 - v.x * 0.5, -b.bounceV - v.y, DT); }
    }
    dream(b);
    hug(b);
    teeter(b);
    circled(b);
    twitch(b);
    stepFive(b);
    if (b.kind !== 'home' && b.state === 'idle' && dozing() && time > (b.nextIdleYawn || 0)) {
      if (b.nextIdleYawn) yawn(b, 1.6, 0.5);
      b.nextIdleYawn = time + (25 + Math.random() * 40) / (1 + lateness());
    }
    // Yawns are catching.
    if (b.catchYawnAt && time > b.catchYawnAt) {
      b.catchYawnAt = 0;
      yawn(b, 1.3, 0.35);
    }
    stackPlay(b);
    pounce(b);
    prank(b);
    jealous(b);
    tagAlong(b);
    trick(b);
    tag(b);
    leapfrog(b);
    tower(b);
    measure(b);
    skipRope(b);
    hideSeek(b);
    dogpile(b);
    catchThrown(b);
    trickTreat(b);
    ghost(b);
    comfort(b);
    snowFight(b);
    parade(b);
    blow(b);
    keepy(b);
    welcome(b);
    nibble(b);
    nudgePet(b);
    fetchPet(b);
    petWorry(b);
    leafPile(b);
    hiccup(b);
    sleepTalk(b);
    // Hanging over the edge of a window: it clings and shuffles back on.
    const l = b.body.onLedge;
    if (l && !b.body.grab && !(b.teeter && !b.teeter.hopped && b.teeter.over < -b.body.o.radius * 0.2)) { // (teetering, it wobbles first: see teeter)
      const c = b.body.centroid(), r = b.body.o.radius;
      if (c.x < l.x0 + r * 0.5) b.body.impulse(8, 0, DT);
      else if (c.x > l.x1 - r * 0.5) b.body.impulse(-8, 0, DT);
    }
    // A working slime rocks a little now and then while it thinks: a small
    // shuffle every 8-20 s (every 2-5 s was a slime that couldn't sit still).
    missMum(b);
    crowding(b);
    if (b.kind !== 'home' && b.state === 'working' && !b.merging && !b.gaveUp && !b.move && !b.body.grab && b.body.onFloor() && time > (b.nextFidget || 0)) {
      if (b.nextFidget) b.hop((Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 40), (-110 - Math.random() * 60) * trait(b, 'bouncy'));
      b.nextFidget = time + (8 + Math.random() * 12) / trait(b, 'fidgety');
    }
    // Spreading out (see spreadOut): from the floor, a window top, or up
    // on top of the others it was squashed in with.
    if (b.move && !b.body.grab && !b.pendingHop && time >= b.nextHop && (perched(b) || time > b.nextHop + 2)) { moveOn(b); return; } // (jostled about on top of the others a while: it goes anyway)
    if (b.body.grab || !b.body.onFloor() || b.merging || time < b.nextHop) return;
    if (b.kind === 'child' && b.mother && !b.mother.dying && !b.gaveUp) {
      if (stillTrying(b)) return;
      const c = b.body.centroid(), mc = b.mother.body.centroid();
      const dx = mc.x - c.x, far = b.mother.body.o.radius * 2 + b.body.o.radius * 6;
      if (jumpUpTo(b, b.mother)) {
        b.nextHop = time + 1.4 + Math.random() * 1.6;
        return;
      }
      if (Math.abs(dx) > far) {
        hopToMum(b, Math.sign(dx) * Math.min(600, (Math.abs(dx) - far * 0.7) * 1.8 + 120), -380 - Math.random() * 140);
        b.nextHop = time + 1.4 + Math.random() * 1.6;
        return;
      }
    }

    const g = b.glasses;
    if (g) {
      // Lost its glasses: hop over to get them (or wait while you hold them).
      if (!g.held) {
        const c = b.body.centroid(), dx = g.x - c.x;
        b.hop(Math.sign(dx) * Math.min(520, Math.abs(dx) * 2 + 90), -340 - Math.min(400, Math.max(0, c.y - g.y) * 1.6));
      }
      b.nextHop = time + 0.9 + Math.random() * 0.4;
      return;
    }
    if (!wantsAttention(b)) return;
    if (b.state === 'waiting') {
      // Waiting a while and you haven't come: it comes to you, hopping
      // over toward your cursor (and stops once it's close).
      const c = b.body.centroid(), dx = mouse.x - c.x, r = b.body.o.radius;
      const seek = CFG.seekYou > 0 && b.kind === 'mother' && time - (b.stateSince || 0) > CFG.seekAfter && mouse.x >= 0 && mouse.x <= W
        && (Math.abs(dx) > r * 2.5 || !!liftFor(b) || (!!b.body.onLedge && mouse.y > b.body.onLedge.y + r * 3)); // (up or down off a window top too: see cursorHop)
      if (seek) cursorHop(b, Math.sign(dx) * Math.min(520, Math.abs(dx) * 1.4 + 80) * CFG.seekYou, -CFG.waitingHopStrength * 0.75);
      else b.hop(0, -CFG.waitingHopStrength);
      b.nextHop = time + 2.2;
    } else {
      // Finished: bounce up and down until you look at it.
      b.hop((Math.random() - 0.5) * 60, -CFG.doneHopStrength);
      b.nextHop = time + CFG.doneHopEvery;
    }
  }

  // Looking around by itself (not at something happening) has a calm
  // rhythm: each look is held a while ([least, + up to] s), and the next
  // waits a good while after it ([least, + up to] s at work, where it
  // mostly keeps its eyes on what it's doing; at least LOOK_GAP.idle s
  // otherwise).
  const LOOK_HOLD = { work: [1.2, 1.3], idle: [2, 4] };
  const LOOK_GAP = { work: [15, 35], idle: 5 };
  const lookedAway = (b) => time - (b.lookedAt ?? -99) < LOOK_GAP.idle;

  // Where a slime is looking. It follows what it looks at on a soft,
  // critically damped spring (about 0.6 s to get there, no overshoot), so
  // its face glides from one thing to the next instead of snapping, and
  // now and then its eyes drift a little off target and back, like real
  // eyes never quite hold still. (It used to be a stiff, bouncy spring
  // with a dart every second or so: the eyes never settled.)
  function updateGaze(b) {
    const g = b.gaze || (b.gaze = { x: mouse.x, y: mouse.y, vx: 0, vy: 0, jx: 0, jy: 0, nextDart: time + 2 + Math.random() * 3 });
    if (time > g.nextDart) {
      const r = b.body.o.radius;
      const dart = Math.random() < 0.5;
      g.jx = dart ? (Math.random() - 0.5) * r * 0.4 : 0;
      g.jy = dart ? (Math.random() - 0.5) * r * 0.25 : 0;
      g.nextDart = time + 2 + Math.random() * 4;
    }
    const k = 25, d = 10, to = b.gazeTarget || mouse;
    g.vx += (k * (to.x + g.jx - g.x) - d * g.vx) * DT;
    g.vy += (k * (to.y + g.jy - g.y) - d * g.vy) * DT;
    g.x += g.vx * DT;
    g.y += g.vy * DT;
  }

  // Two quick dips of the face, the second smaller: a nod. 0 when still.
  const NOD_TIME = 0.8;
  function nodOf(b) {
    const t = time - b.nodAt;
    if (b.nodAt < 0 || t > NOD_TIME) return 0;
    return Math.abs(Math.sin((t / NOD_TIME) * Math.PI * 2)) * (t < NOD_TIME / 2 ? 1 : 0.6);
  }

  // While nodding (and a beat after) it smiles at you; getting to work waits.
  const nodding = (b) => b.nodAt >= 0 && time - b.nodAt < NOD_TIME + 0.2;

  function faceFor(b) {
    // Only called when a frame is drawn (30-72 times a second, see
    // paintNow), so its easing goes by the time since the last one: tuned
    // as so much per refresh of a 144 Hz screen.
    const since = Math.min(0.1, Math.max(0, time - (b.faceAt ?? time)));
    b.faceAt = time;
    const ease = (k) => 1 - Math.pow(1 - k, since * 144);
    const st = b.state;
    const body = b.body;
    const v = body.velocity(DT);
    const speed = Math.hypot(v.x, v.y);
    let expression = 'normal', mouth = 'smile';
    let calmWork = false; // (its everyday working face: see peeking, below)
    if (time < b.dizzyUntil) { expression = 'dizzy'; mouth = 'flat'; }
    else if (time < (b.raspUntil || 0) && !body.grab) { expression = 'annoyed'; mouth = 'raspberry'; } // (pbbbt!)
    else if (b.balloon && b.balloon.stage === 'zip') { expression = 'happy'; mouth = 'raspberry'; } // (the air rushing out)
		else if (b.balloon && b.gulping) { expression = 'concentrate'; mouth = 'o'; } // (gulping air in)
    else if (b.balloon && b.balloon.stage !== 'land') { expression = 'normal'; mouth = 'puffed'; } // (cheeks full, holding it)
    else if (time < (b.annoyedUntil || 0) && b.annoyedAt && !b.annoyedAt.dying && !body.grab && !homeward(b)) { expression = 'annoyed'; mouth = 'flat'; }
    else if (time < (b.yawnUntil || 0)) { expression = 'sleepy'; mouth = 'yawn'; }
    else if (time < (b.napUntil || 0) && !body.grab) { expression = 'sleepy'; mouth = 'flat'; } // (a quick nap, for show)
    else if (time < (b.winceUntil || 0)) { expression = 'pained'; mouth = 'wobble'; }
    else if (time < (b.cheerUntil || 0)) { expression = 'happy'; mouth = 'grin'; }
    else if (time < (b.burpUntil || 0)) { expression = 'normal'; mouth = 'o'; } // (*burp*)
    else if (time < (b.countingUntil || 0)) { expression = 'happy'; mouth = 'o'; } // (eyes shut, counting)
    else if (time < (b.hiding || 0) && !body.grab) { expression = 'peek'; mouth = 'flat'; } // (hiding, peeking out)
    else if (b.catching && !b.catching.caught) { expression = 'normal'; mouth = 'o'; } // (here it comes!)
    else if (b.rope && b.rope.j === b && b.rope.stage === 'swing') { expression = 'happy'; mouth = body.onFloor() ? 'smile' : 'grin'; } // (skipping)
    else if (b.hug || (b.huggedBy && b.huggedBy.hug && b.huggedBy.hug.o === b)) { expression = 'happy'; mouth = 'smile'; } // (a hug)
    else if (body.grab && time < (b.wheeUntil || 0)) { expression = 'happy'; mouth = 'grin'; } // (swung gently)
    else if (body.grab && b.wriggling) { expression = 'worried'; mouth = 'wobble'; }
    else if (body.grab || time < (b.surpriseUntil || 0)) { mouth = 'o'; }
    else if (time < (b.booUntil || 0)) { expression = 'normal'; mouth = 'o'; }
    else if (b.sneeze) { expression = 'pained'; mouth = 'o'; } // (about to sneeze)
    else if (b.blow && time > b.blow.at) { expression = 'normal'; mouth = 'o'; } // (blowing a bubble)
    else if (b.nibbling) { expression = 'happy'; mouth = time - b.nibbling.at < 0.5 ? 'o' : Math.round((time - b.nibbling.at) / 0.18) % 2 ? 'grin' : 'flat'; } // (chomp chomp)
    else if (b.patted) { expression = 'happy'; mouth = 'smile'; }
    else if (time < (b.petWorryUntil || 0)) { expression = 'worried'; mouth = 'o'; }
    else if (b.teeter && !body.grab) { expression = 'worried'; mouth = 'o'; } // (on the brink)
    else if (time < (b.sheepishUntil || 0)) { expression = 'worried'; mouth = 'wobble'; } // (told off)
    else if (time < (b.squirmUntil || 0)) { expression = 'happy'; mouth = 'grin'; }
    else if (time < (b.wantsPetsUntil || 0) && time > (b.pettedUntil || 0)) { expression = 'normal'; mouth = 'smile'; }
    else if (time - (b.sneezedAt ?? -9) < 0.5) { expression = 'happy'; mouth = 'flat'; }
    else if (b.gaveUp && time - b.gaveUp.at < 10) { expression = 'sad'; mouth = 'worried'; } // (couldn't get to mum)
    else if (b.merging && b.kind === 'child') { expression = 'happy'; mouth = 'smile'; }
    else if (nodding(b)) { expression = 'happy'; mouth = 'smile'; }
    else if (time < (b.pettedUntil || 0)) { expression = 'happy'; mouth = 'grin'; }
    else if (time < (b.greetUntil || 0) && st !== 'working') { expression = 'happy'; mouth = 'smile'; }
    else if (speed > 900 && !body.onFloor()) { mouth = 'grin'; }
    else if (time < (b.pounceUntil || 0) || (b.teaseSince && time - b.teaseSince > 0.3)) { mouth = b.caught ? 'grin' : 'o'; }
    else if (time < b.happyUntil) { expression = 'happy'; mouth = 'grin'; }
    else if (time < (b.grumbleUntil || 0) && !body.grab && st !== 'waiting') { expression = 'pained'; mouth = 'wobble'; } // (squashed in: hmph; see crowding)
    else if (st === 'waiting' && b.cloud && !b.cloud.gone) { expression = 'worried'; mouth = 'wobble'; }
    else if (st === 'waiting') { expression = 'worried'; mouth = 'o'; }
    else if (b.pain > 0.05) { expression = 'pained'; mouth = 'wobble'; }
    else if (st === 'done' && unseen(b)) { expression = 'happy'; mouth = 'grin'; }
    else if (st === 'working' && b.stuck) { expression = 'pained'; mouth = 'wobble'; }
    else if (st === 'working' && b.tapping) { expression = 'normal'; mouth = 'flat'; calmWork = true; b.glanceAt = { spot: { x: body.centroid().x + (b.key.length % 2 ? 1 : -1) * body.o.radius * 2, y: body.bbox().maxY + body.o.radius } }; b.glanceUntil = time + 0.1; }
    else if (st === 'working') { expression = 'concentrate'; mouth = 'flat'; calmWork = true; }
    else if (st === 'idle' && dozing()) { expression = 'sleepy'; mouth = 'flat'; }
    // Crowded a while: not smiling about it.
    if (expression === 'normal' && mouth === 'smile' && (b.crowdedFor || 0) > 4 && !body.grab && st !== 'waiting') mouth = 'flat';
    // Saying something by itself (a status bubble): eyes open to tell you.
    // Just hovering doesn't wake it from its work.
    if (expression === 'sleepy' && time < (b.mumbleUntil || 0)) mouth = b.mumbleUntil - time > 1.4 && Math.floor(time * 5) % 2 ? 'o' : 'flat'; // (talking in its sleep)
    else if (b.bubble && (expression === 'concentrate' || expression === 'sleepy')) { expression = 'normal'; mouth = 'smile'; }
    const effort = b.effort;
    let drool = null;
    if (effort === 'low' && expression === 'concentrate') {
      // Low effort works by zoning out, drooling a little.
      expression = 'normal';
      mouth = 'slack';
      drool = ((time - b.born) / 4.5) % 1;
    } else if (effort === 'low' && mouth === 'smile') mouth = 'flat';
    if (effort === 'xhigh' && expression === 'concentrate') { expression = 'meditate'; mouth = 'smile'; }
    // Brows stay calm while it works, and now and then, for a moment, they
    // pull together or lift (a little "hm!").
    if (time > (b.nextFurrow || 0)) {
      b.browMove = Math.random() < 0.6 ? 'furrow' : 'raise';
      b.furrowUntil = time + 0.8 + Math.random() * 1.2;
      b.nextFurrow = time + 6 + Math.random() * 10;
    }
    // Cursor over or near it while it works: it looks up at you, eyes opening
    // wide (and its brows calm) and following the cursor, then goes back to
    // work when you move on. Eased both ways (see drawFace's peek). Only its
    // everyday working face does: dizzy, struggling, talking and so on win.
	// (With some give: it comes within 2.2 radii to look up, but has to
	// go past 2.8 to send it back, and either way it stays a moment, so a
	// cursor resting near the edge doesn't flick its eyes open and shut.)
	const near = b === hovered || Math.hypot(mouse.x - body.centroid().x, mouse.y - body.centroid().y) < body.o.radius * (b.peeking ? 2.8 : 2.2);
	if (near !== !!b.peeking && time - (b.peekedAt ?? -9) > 0.8) { b.peeking = near; b.peekedAt = time; }
	const peeking = calmWork && !body.grab && !!b.peeking;
	// Heads down at work, its eyes shut: what opens them by itself (a look
	// around, something flying past) keeps them open a moment and then
	// lets it get back to work a good while, never flick, flick, flick.
	const focused = expression === 'concentrate' && !peeking;
	const eyesFree = !focused || b.eyesUp || time - (b.eyesAt ?? -9) > 2.5;
    b.peek = (b.peek || 0) + ((peeking ? 1 : 0) - (b.peek || 0)) * ease(0.05);
    if (!peeking && b.peek < 0.01) b.peek = 0;
    const moving = expression === 'concentrate' && time < b.furrowUntil && !peeking;
    const wantFurrow = moving && b.browMove === 'furrow' ? 1 : 0, wantRaise = moving && b.browMove === 'raise' ? 1 : 0;
    b.furrow = (b.furrow || 0) + (wantFurrow - (b.furrow || 0)) * ease(0.15);
    b.raise = (b.raise || 0) + (wantRaise - (b.raise || 0)) * ease(0.15);
    // Only calm, awake slimes look at the mouse: idle, or done and already
    // seen. Busy ones mind their work. Eased, so the face glides back
    // instead of snapping.
    let checkIn = false;
    if (b.kind !== 'home' && expression === 'concentrate' && !body.grab) {
      if (b.curiosity === undefined) b.curiosity = 0.5 + Math.random();
      if (time > (b.nextGlance || 0)) {
        if (b.nextGlance) {
          const family = (o) => (b.kind === 'child' ? o === b.mother || o.mother === b.mother : o.mother === b);
          const others = [...buddies.values()].filter((o) => o !== b && !o.dying && family(o));
          const mom = b.kind === 'child' && b.mother && !b.mother.dying ? b.mother : null;
          const roll = Math.random();
          if (mom && roll < 0.45) b.glanceAt = mom;
          else if (others.length && roll < 0.7) b.glanceAt = others[Math.floor(Math.random() * others.length)];
          else if (roll < 0.85) b.glanceAt = 'you';
          else {
            // Daydreaming: somewhere up and off to one side.
            const c = body.centroid(), r = body.o.radius;
            b.glanceAt = { spot: { x: c.x + (Math.random() < 0.5 ? -1 : 1) * r * (1.5 + Math.random() * 2), y: c.y - r * (1 + Math.random() * 2.5) } };
          }
          b.glanceUntil = time + LOOK_HOLD.work[0] + Math.random() * LOOK_HOLD.work[1];
          b.lookedAt = b.glanceUntil;
        }
        // Sometimes a second look a little after; otherwise a good while
        // before the next, depending on how curious this one is: at work
        // it mostly keeps its eyes on its work.
        b.nextGlance = b.nextGlance && Math.random() < 0.1 ? b.glanceUntil + 1.5 + Math.random()
          : time + (LOOK_GAP.work[0] + Math.random() * Math.random() * LOOK_GAP.work[1]) / b.curiosity;
      }
    }
    // A leaf (or snowflake) drifting down close by: its eyes follow it.
    // (Not at work, though, and not right after another look around.)
    if (flakes.length && CFG.seasons > 0 && !body.grab && st !== 'working' && time > (b.nextLeafLook || 0) && !lookedAway(b) && !(b.glanceAt && time < (b.glanceUntil || 0))) {
      b.nextLeafLook = time + 6 + Math.random() * 6;
      const c = body.centroid(), r = body.o.radius;
      const f = flakes.find((f) => !f.on && !f.landed && Math.abs(f.x - c.x) < r * 3 && c.y - f.y > r && c.y - f.y < r * 6);
      if (f) { b.glanceAt = { spot: f }; b.glanceUntil = time + 2 + Math.random() * 1.5; b.lookedAt = b.glanceUntil; }
    }
    // Listening to you type: eyes on the talk box, attentive.
    const listening = CFG.listen > 0 && time - (b.listenAt ?? -9) < 1.2 && talkRect && !body.grab;
    if (listening) {
      b.glanceAt = { spot: { x: talkRect.x + talkRect.w / 2, y: talkRect.y + talkRect.h * 0.7 } };
      b.glanceUntil = time + 0.1;
      if (expression === 'concentrate' || expression === 'sleepy' || expression === 'peek') { expression = 'normal'; mouth = 'smile'; }
    }
    if (!peeking && eyesFree && b.glanceAt && time < (b.glanceUntil || 0) && !b.glanceAt.dying && !body.grab && (expression === 'concentrate' || expression === 'normal' || expression === 'sleepy')) {
      checkIn = true;
      if (expression !== 'normal') { expression = 'normal'; mouth = 'flat'; }
    }
    const glaring = expression === 'annoyed';
    b.gazeTarget = glaring ? b.annoyedAt.body.centroid() : peeking ? null : !checkIn || b.glanceAt === 'you' ? null : b.glanceAt.spot || b.glanceAt.body.centroid();
    let wantLook = checkIn || glaring || peeking ? 1 : (st === 'idle' || st === 'done') && expression === 'normal' && effort !== 'low' && !body.grab && !b.bubble ? 1 : 0;
    // Flying: it looks where it's going.
    if (CFG.eyeLife > 0 && !body.grab && !body.onFloor() && speed > 700 && !meditating(b) && !glaring) {
      const c = body.centroid();
      b.gazeTarget = { x: c.x + v.x * 0.3, y: c.y + v.y * 0.3 };
      wantLook = Math.max(wantLook, CFG.eyeLife);
    }
    // A slime you're holding up over it: it looks up at it, worried.
    const over = !glaring && heldOver(b);
    if (over) {
      b.gazeTarget = over.body.centroid();
      wantLook = Math.max(wantLook, 1);
      if (expression === 'concentrate' || expression === 'sleepy' || expression === 'normal') { expression = 'normal'; mouth = 'o'; }
    }
    // Another slime flying past: it watches it go, eyes wide if it's close.
    const seen = !over && !glaring && !body.grab && body.onFloor() && eyesFree && spectate(b);
    let wideSeen = 0;
    if (seen) {
      b.gazeTarget = seen.c;
      wantLook = Math.max(wantLook, CFG.spectate);
      wideSeen = Math.max(0, 1 - seen.d / (body.o.radius * 4)) * 0.6 * Math.min(1, CFG.spectate);
      if (expression === 'concentrate' || expression === 'sleepy') { expression = 'normal'; mouth = 'o'; }
    }
    // Being circled: its eyes go round after the cursor.
    if (b.circling && Math.abs(b.circling.a) > Math.PI && time - b.circling.at < 0.4 && !glaring && expression !== 'dizzy') {
      b.gazeTarget = { x: mouse.x, y: mouse.y };
      wantLook = Math.max(wantLook, 1);
      if (expression === 'concentrate' || expression === 'sleepy') { expression = 'normal'; mouth = 'o'; }
    }
    // Keepy-uppy: eyes on the pet.
    if (b.keepy && !glaring) {
      b.gazeTarget = { x: b.keepy.pet.x, y: b.keepy.pet.y };
      wantLook = Math.max(wantLook, 1);
    }
    // On the brink of a window: eyes down over the drop.
    if (b.teeter && !body.grab && !glaring) {
      const c = body.centroid(), r = body.o.radius;
      b.gazeTarget = { x: b.teeter.edge + b.teeter.side * r * 1.5, y: c.y + r * 4 };
      wantLook = Math.max(wantLook, 1);
    }
    // Heads down at work, its face follows what it's doing: reading, it
    // scans along line after line; editing, it looks down at its work; on
    // the web, up and off to one side.
    if (CFG.workLife > 0 && wantLook === 0 && expression === 'concentrate' && !body.grab) {
      // (Slow and small: a line every few seconds, the gaze gliding back
      // to the start of the next on its spring, see updateGaze.)
      const act = activityOf(b), c = body.centroid(), r = body.o.radius, k = 0.4 * Math.min(1.5, CFG.workLife);
      if (act === 'read') {
        const line = (time * 0.25 + (b.breathPhase || 0)) % 1;
        b.gazeTarget = { x: c.x + (line * 1.6 - 0.8) * r, y: c.y + r * (1.4 + 0.25 * Math.floor(time * 0.25 % 3)) };
        wantLook = k;
      } else if (act === 'edit') {
        b.gazeTarget = { x: c.x + Math.sin(time * 0.5) * r * 0.35, y: c.y + r * 2.5 };
        wantLook = k;
      } else if (act === 'web') {
        b.gazeTarget = { x: c.x + (b.key.length % 2 ? 1 : -1) * r * 1.6, y: c.y - r * 2.5 };
        wantLook = k;
      }
    }
    // (About 0.75 s to turn most of the way: unhurried.)
    b.lookAmount = (b.lookAmount ?? wantLook) + (wantLook - (b.lookAmount ?? wantLook)) * ease(0.02);
    // While the face isn't turning (working, not looking at anything), its
    // gaze waits right on what it would look at, so a glance turns straight
    // there (it used to start from wherever the mouse was, often the
    // other way first).
    if (b.gaze && b.lookAmount < 0.15) {
      const to = b.gazeTarget || mouse;
      b.gaze.x = to.x; b.gaze.y = to.y; b.gaze.vx = 0; b.gaze.vy = 0;
    }
    // Talking: the mouth follows its words (not mid-yawn or seeing stars).
    // Shut between syllables, it's its own mouth (a smile, mostly).
    const talk = talkMouth(b, ease);
    b.talkOpen = talk ? talk.open : 0; // the body bobs along (see liven)
    if (b.singing && expression !== 'dizzy') expression = 'happy'; // eyes shut, singing its heart out
    if (talk && mouth !== 'yawn' && expression !== 'dizzy') {
      if (talk.open >= 0.06) mouth = 'talk';
      if (expression === 'concentrate' || expression === 'sleepy' || expression === 'peek') expression = 'normal';
    }
    // A big toss: past the top it looks down at what's coming ("uh-oh"),
    // and just before it lands it screws its eyes shut and braces.
    let wideBy = time < (b.booUntil || 0) ? 1 : time < (b.wantsPetsUntil || 0) && time > (b.pettedUntil || 0) ? 0.5 : 0; // (boo!, or me too!: big eyes)
		if (b.balloon && !b.gulping && (b.balloon.stage === 'full' || b.balloon.stage === 'float')) wideBy = 0.45; // (full to bursting: round eyes)
    if (CFG.eyeLife > 0 && !body.grab && !meditating(b) && expression !== 'dizzy') {
      if (v.y < -900 && !body.onFloor() && !b.balloon) b.tossUp = time;
      if (b.tossUp && time - b.tossUp < 2 && !body.onFloor() && v.y > 0) {
        const box = body.bbox(), below = floorAt(body.centroid().x, box.maxY) - box.maxY;
        if (below < body.o.radius * 0.9 && v.y > 600) { expression = 'pained'; mouth = 'flat'; }
        else { expression = 'normal'; mouth = 'o'; wideBy = 0.6; }
      }
      if (body.onFloor()) b.tossUp = 0;
      // Needing you, with you right there: big pleading eyes, on you.
      if (st === 'waiting' && !body.grab) {
        const c = body.centroid();
        if (Math.hypot(mouse.x - c.x, mouse.y - c.y) < body.o.radius * 3) { wideBy = 0.5; b.lookAmount += (1 - b.lookAmount) * ease(0.1); b.gazeTarget = null; }
      }
    }
	// (Opened by itself from its work: open at least a second; see focused.)
	if (focused) {
		if (expression === 'concentrate' && b.eyesUp && time - b.eyesAt < 1.2) { expression = 'normal'; mouth = 'flat'; }
		const up = expression !== 'concentrate';
		if (up !== !!b.eyesUp) { b.eyesUp = up; b.eyesAt = time; }
	} else if (!b.eyesUp) { b.eyesUp = true; b.eyesAt = time; }
    // Startled (poked, flinching): eyes go wide for a moment.
    const wide = CFG.eyeLife * Math.max(wideBy, wideSeen, over ? 0.5 : 0, Math.min(1, ((b.startleUntil || 0) - time) / 0.3));
    return { expression, mouth, talk, blink: b.blink, wide, look: b.gaze || mouse, lookAmount: b.lookAmount, furrow: b.furrow, raise: b.raise, shake: Math.max(b.pain || 0, b.cheekStrain || 0, time < (b.strainUntil || 0) ? 0.35 * Math.min(1, CFG.strain) : 0), puffed: b.cheekPuff || 0, nod: nodOf(b), scale: CFG.faceScale, style: b.blush > 0 ? { ...CFG, cheeks: Math.min(0.95, CFG.cheeks + b.blush * 0.55) } : CFG, bodyColor: b.color,
      effort, drool, glasses: effort === 'high' && !b.glasses, squint: effort === 'high' && !!b.glasses && expression === 'normal' && !b.peek, peek: b.peek,
      fullTurn: (body.fullTurn = !!((b.flip && b.flip.spun) || b.tumble || b.roll)), // (mid-somersault the face, and what it wears, go all the way round)
    };
  }

  // 'thinking', or what the tool it's running is about ('read', 'edit',
  // 'test', 'push'... see shared/actions.js), for a working slime. Most
  // tools take a split second, so the icon only switches once the new
  // activity has lasted a moment; otherwise it would flicker.
  function activityOf(b) {
    const src = b.kind === 'child' ? b.agent : b.session;
    const now = src && src.activity === 'tool' ? src.action || 'run' : 'thinking';
    if (now !== b.actNext) { b.actNext = now; b.actSince = time; }
    // A change shows once it has lasted a moment (the gear only after 2 s of
    // real thinking), and a sign stays up at least 1.5 s.
    const settle = now === 'thinking' ? 2 : 0.7;
    if (!b.actShown || (now !== b.actShown && time - b.actSince > settle && time - (b.actShownAt || 0) > 1.5)) { b.actShown = now; b.actShownAt = time; }
    return b.actShown;
  }

  // The slime under the mouse, if any (not while dragging).
  let hovered = null, hoverSeen = 0;
  let talkingTo = null; // the session whose talk box is open: its balloons would sit under it

  // What a slime says when you hover over it: its name, and what it's doing.
  const STATE_WORDS = { working: 'Working', waiting: 'Needs you', done: 'Done', idle: 'Idle' };
  function hoverLines(b) {
    if (b.kind === 'home') return summaryLines();
    const st = b.status;
    // The last status update, while it still matches what the slime is doing.
    const text = st && st.state === b.state && (b.state !== 'working' || time - st.at < 20) ? st.text : STATE_WORDS[b.state] || b.state;
    const info = (b.kind === 'mother' && b.session && b.session.info) || {};
    const lines = [{ text: label(b) }, { text, color: D.STATE_COLORS[b.state] }];
    const extra = [info.branch, modelName(info.model)].filter(Boolean).join(' · ');
    if (extra) lines.push({ text: extra, dim: true });
    // How long it's been waiting on you.
    const waited = b.state === 'waiting' && b.stateSince !== undefined ? Math.floor((time - b.stateSince) / 60) : 0;
    if (waited >= 1) lines.push({ text: `Waiting ${waited} min`, dim: true });
    // How long since it finished, or since it last did anything.
    const quiet = (b.state === 'done' || b.state === 'idle') && b.kind === 'mother' && b.stateSince !== undefined ? Math.floor((time - b.stateSince) / 60) : 0;
    if (quiet >= 1) lines.push({ text: b.state === 'done' ? `Finished ${ago(quiet)}` : `Idle for ${ago(quiet, true)}`, dim: true });
    // How long this turn has been going.
    const turn = b.state === 'working' && b.kind === 'mother' && b.session && b.session.turnStart ? Math.floor((Date.now() - b.session.turnStart) / 60000) : 0;
    if (turn >= 1) lines.push({ text: `Working for ${turn} min`, dim: true });
    // What its turn has done: files edited, commands run.
    const tw = b.kind === 'mother' && b.session && b.session.turn;
    const did = tw ? [tw.files.length ? `${tw.files.length} file${tw.files.length > 1 ? 's' : ''} edited` : '', tw.cmds ? `${tw.cmds} command${tw.cmds > 1 ? 's' : ''} run` : '', tw.fails ? `${tw.fails} failed` : ''].filter(Boolean) : [];
    if (did.length && (b.state === 'working' || b.state === 'done' || b.state === 'waiting')) lines.push({ text: (b.state === 'done' ? 'Did: ' : 'So far: ') + did.join(' \u00b7 '), dim: true });
    if (tw && tw.lastFail && b.state !== 'idle') lines.push({ text: `Last failed: ${tw.lastFail}`, dim: true });
    // What it's changed in its folder and not committed yet.
    const ch = b.kind === 'mother' && b.session && b.session.changes;
    if (ch && ch.files) lines.push({ text: `Not committed: ${ch.files} file${ch.files > 1 ? 's' : ''}${ch.add || ch.del ? ` (+${ch.add} \u2212${ch.del})` : ''}`, dim: true });
    // Today's tally, once there's something to tally.
    const day = b.kind === 'mother' && b.session && b.session.today;
    if (day && day.turns && day.day === new Date().toDateString()) {
      lines.push({ text: `Today: ${day.turns} turn${day.turns > 1 ? 's' : ''} · ${workedFor(day.workMs)} of work`, dim: true });
    }
    // How far through its todo list.
    const pr = b.kind === 'mother' && b.session && b.session.progress;
    if (pr && pr.total) lines.push({ text: `Plan: ${pr.done} of ${pr.total}${pr.current ? ' \u00b7 ' + pr.current : ''}`, dim: true });
    // How full its context window is.
    const tk = b.kind === 'mother' && b.session && b.session.tokens;
    if (tk && tk.limit && tk.context) lines.push({ text: `${Math.min(100, Math.round((tk.context / tk.limit) * 100))}% of context used`, dim: true });
    // How far down its to-do list it is.
    const todo = b.kind === 'mother' && b.session && b.session.todo;
    if (todo) lines.push({ text: `${todo.done} of ${todo.of} on its list done`, dim: true });
    // Until you've talked to one, say you can.
    if (b.session && !String(b.session.id).startsWith('demo-')) {
      if (settings.hooksInstalled === false) lines.push({ text: 'Connect Claude Code in my menu for more', dim: true });
      else if (!settings.talked) lines.push({ text: 'Click to talk', dim: true });
    }
    return lines;
  }

  // 95 min (in ms) -> "1 h 35 min".
  function workedFor(ms) {
    const m = Math.round(ms / 60000);
    return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  }

  // 3 -> "3 min ago", 135 -> "2 h ago" (or "3 min", "2 h" for a stretch of time).
  function ago(mins, span) {
    const t = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h`;
    return span ? t : t + ' ago';
  }

  // "claude-opus-5-5" -> "Opus 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5".
  function modelName(id) {
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(String(id || ''));
    if (!m) return '';
    const minor = m[3] && m[3].length < 3 ? '.' + m[3] : '';
    return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + minor;
  }

	// Its stream of consciousness while you hover it working: the end of its
	// newest thinking from its transcript (a helper's own), asked for once a
	// second while hovered, never waited on. With none (not written, or
	// redacted), what it's doing right now instead, unless the status
	// bubble already says just that.
	function askThought(b) {
		if (!b || !api.thinking || b.kind === 'home' || b.state !== 'working' || b.thoughtBusy) return;
		const now = performance.now();
		if (now - (b.thoughtAsked || 0) < 1000) return;
		b.thoughtAsked = now;
		b.thoughtBusy = true;
		Promise.resolve(api.thinking(b.key)).then((r) => { b.thought = r || null; b.thoughtAt = time; }, () => {}).finally(() => { b.thoughtBusy = false; });
	}
	function thoughtOf(b, lines) {
		if (b.state !== 'working' || b.kind === 'home' || !b.thought || time - (b.thoughtAt || -99) > 3) return '';
		if (b.thought.text) return b.thought.text;
		const doing = String(b.thought.doing || '').trim();
		return doing && !lines.some((l) => l.text === doing) ? doing : '';
	}
	// A helper's one hover bubble: its whole task, its state, and what it's
	// doing right now (plain words: "Reading face.js"); its thinking only
	// when there's no action to show (an action reads clearer than the
	// tail of a thought).
	function helperCard(b, lines) {
		const a = b.agent || {};
		const fresh = b.state === 'working' && b.thought && time - (b.thoughtAt || -99) <= 3;
		const doing = fresh ? String(b.thought.doing || '').trim() : '';
		const text = fresh && !doing ? b.thought.text || '' : '';
		// (And its time and tokens, as the terminal has them.)
		const st = a.stats || {};
		const stats = typeof BlaubeHelperStats !== 'undefined' ? BlaubeHelperStats.helperStats(st.since || 0, st.tokens || 0) : '';
		return { task: a.description || a.type || 'agent', status: lines[1], action: doing || text, fromEnd: !doing && !!text, stats };
	}
	// The other slimes' heads (faces and whatever they wear), for a bubble
	// to keep off.
	function headsBut(b, list) {
		return list.filter((o) => o !== b && !o.dying && o.kind !== 'home').map((o) => {
			const c = o.body.centroid(), r = o.body.o.radius, box = o.body.bbox();
			const top = Math.min(box.minY, o.body.lookTop ?? Infinity);
			return { x: box.minX, y: top, w: box.maxX - box.minX, h: c.y + r * 0.5 - top };
		});
	}

  // Big slimes first, so children are drawn on top (and get clicked first).
  const drawOrder = () => [...buddies.values()].sort((a, b) => (a.body.grab ? 2 : a.big ? 0 : 1) - (b.body.grab ? 2 : b.big ? 0 : 1));

  function draw() {
    D.setCrowd(); // a fresh frame: no balloons placed yet
    const under = drag || petAt(mouse.x, mouse.y) || glassesAt(mouse.x, mouse.y) ? null : buddyAt(mouse.x, mouse.y);
    if (under) {
      // Coming back to a slime after a while: it perks up to say hi.
      if (under !== hovered && time - (under.lastHover || -99) > 6 && CFG.eyeLife > 0 && !lulled(under)) {
        under.greetUntil = time + 0.8;
        if (under.body.onFloor() && !under.body.grab && under.state !== 'working') under.body.squashTop(-under.body.o.radius * 3 * CFG.eyeLife, DT);
      }
      under.lastHover = time;
      hovered = under; hoverSeen = time;
    }
    else if (drag || time - hoverSeen > 0.35) hovered = null;
    askThought(hovered);
    ctx.clearRect(0, 0, W, H);
    const list = drawOrder();
    if (CFG.shadow) for (const b of list) D.drawShadow(ctx, b.body, floorAt(b.body.centroid().x, b.body.bbox().maxY));
    drawTalkTail();
    drawRope(true);
    drawSeason(true);
    for (const b of list) {
      Looks.drawLook(ctx, b, 'back', b.color);
      D.drawBody(ctx, b.body, b.color);
      Looks.drawLook(ctx, b, 'front', b.color);
      D.drawFlush(ctx, b.body, ramp(b.fill || 0, CFG.redAt, 1), CFG, b.faceTurn);
      const face = faceFor(b);
      if (b.body.o.radius > 12) D.drawFace(ctx, b.body, face);
      b.faceTurn = { x: face.turnX || 0, y: face.turnY || 0 };
      if (face.expression === 'sleepy' && face.mouth !== 'yawn') D.drawZzz(ctx, b.body, time);
      nightcap(b);
      if (b.dream && time < b.dream.until && !b.bubble && b !== hovered && ((b.sleep || 0) > 0.8 || b.dream.demo)) D.drawDream(ctx, b.body, time, W, b.dream.what);
      const sweat = Math.max(ramp(b.fill || 0, CFG.sweatAt, 1), busySweat(b));
      if (sweat > 0) D.drawSweat(ctx, b.body, time, sweat);
      drawBeads(b);
      drawGhost(b); // (over all of it: nothing pokes through the sheet)
      if (b.merging && b.kind === 'child' && !b.dying && !b.gaveUp) {
        const box = b.body.bbox();
        D.drawHeart(ctx, b.body.centroid().x, Math.min(box.minY, b.body.lookTop ?? Infinity) - 14, Math.max(9, b.body.o.radius * 0.18), (time - b.merging.since) % 1.8);
      }
      if (b.kind === 'home' || b.dying) continue;
      if (b === hovered || b.bubble) continue; // the bubble sits where these go
      if (b === buddies.get(talkingTo)) continue; // its talk box is there instead
      if (b.state === 'working' && !nodding(b) && !b.merging && !b.singing && !(b.gaveUp && time - b.gaveUp.at < 4)) D.drawThinking(ctx, b.body, time, activityOf(b), W);
      if (b.state === 'working' && nodding(b) && b.nodQuiet && !b.merging) D.drawThinking(ctx, b.body, time, activityOf(b), W); // a commit's nod keeps its sign
      if (b.state === 'waiting') D.drawExclaim(ctx, b.body, time, W, '?');
      else if (b.state === 'done' && unseen(b)) D.drawExclaim(ctx, b.body, time, W);
    }
    drawRope(false);
    drawSeason(false);
    drawClouds();
    drawFlutters();
    drawRockets();
    drawSnowballs();
    drawPets();
    drawBubbles();
    drawHearts();
    for (const b of list) if (b.glasses) D.drawGlasses(ctx, b.glasses.x, b.glasses.y, b.glasses.r, b.glasses.a, CFG);
    // Names and status only show when you hover over a slime.
    for (const b of list) {
      const showHover = b === hovered && !(time < (b.pettedUntil || 0)); // not while you're petting it
      const lines = showHover ? hoverLines(b) : b.bubble ? b.bubble.lines : null;
      const alpha = showHover ? 1 : b.bubble ? Math.min(1, (b.bubble.until - time) * 3) : 0;
      // What it says is speech, in the fun font; anything with a state dot
      // or grey detail lines is a status list, in the plain one.
      const speech = !showHover && !!lines && lines.every((l) => !l.color && !l.dim && (!l.size || l.size >= 20));
      if (showHover && b.kind === 'child' && b !== buddies.get(talkingTo)) D.drawHelperThought(ctx, b.body, helperCard(b, lines), W, headsBut(b, list));
      else if (lines && b !== buddies.get(talkingTo)) {
        D.drawBubble(ctx, b.body, lines, alpha, W, speech);
        const thought = showHover ? thoughtOf(b, lines) : '';
        if (thought) D.drawThought(ctx, b.body, thought, W, headsBut(b, list));
      }
    }
    if (CFG.debugOverlay) drawDebug(list);
  }

  function drawDebug(list) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,200,255,0.9)';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    ctx.fillStyle = 'rgba(0,200,255,0.18)';
    for (const r of obstacles) {
      ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0 - 1, r.y1 - r.y0 - 1);
    }
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    for (const b of list) {
      const body = b.body;
      ctx.fillStyle = 'rgba(20,20,20,0.85)';
      for (let i = 0; i < body.n; i++) ctx.fillRect(body.px[i] - 1.5, body.py[i] - 1.5, 3, 3);
      const c = body.centroid(), v = body.velocity(DT);
      ctx.strokeStyle = 'rgba(255,0,120,0.9)';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + v.x * 0.05, c.y + v.y * 0.05);
      ctx.stroke();
      const a = body.grabAnchor();
      if (a) {
        ctx.strokeStyle = 'rgba(0,160,0,0.9)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(body.grab.x, body.grab.y);
        ctx.stroke();
      }
      ctx.fillText(`r=${body.o.radius.toFixed(0)} area=${(body.area() / body.restArea).toFixed(2)} v=${Math.hypot(v.x, v.y).toFixed(0)}`, c.x - 50, body.bbox().maxY + 14);
    }
    ctx.restore();
  }

  let last = performance.now() / 1000, acc = 0;
  // Petting: rubbing the cursor back and forth over a slime (or a pet),
  // without clicking, makes it happy: it wiggles and hearts float up.
  const pet = { target: null, dir: 0, flips: [], lastX: 0 };
  const GIGGLES = ['hihihi!', 'hehehe!', 'hihi hee!', 'ahaha!', 'tee hee hee!', 'kiki!'];
  function checkPetting() {
    const target = drag ? null : petAt(mouse.x, mouse.y) || buddyAt(mouse.x, mouse.y);
    const dx = mouse.x - pet.lastX;
    pet.lastX = mouse.x;
    if (target !== pet.target) { pet.target = target; pet.flips = []; pet.dir = 0; return; }
    if (!target || Math.abs(dx) < 2 || (target.body && lulled(target))) return; // (a sleeper isn't petted awake)
    const dir = Math.sign(dx);
    if (dir !== pet.dir) { pet.flips.push(time); pet.dir = dir; }
    pet.flips = pet.flips.filter((t) => time - t < 1.2);
    if (pet.flips.length < 3) return;
    target.pettedUntil = time + 1.2;
    // Tickled: it giggles (a slime, not a pet), now and then.
    if (target.body && !target.speech && time > (target.nextGiggle || 0) && mayTalk('react')) {
      target.nextGiggle = time + 1.4 + Math.random();
      target.giggles = (target.giggles || 0) + 1;
      target.say(GIGGLES[Math.floor(Math.random() * GIGGLES.length)], 1, false, { higher: 1.25, pace: 0.7, minor: true });
    }
    if (time > (target.nextHeart || 0)) {
      target.nextHeart = time + 0.28;
      const isPet = target.task !== undefined;
      const c = isPet ? { x: target.x, y: target.y } : target.body.centroid();
      const top = isPet ? target.y - petSize() : target.body.bbox().minY;
      spawnHeart({ x: c.x + (Math.random() - 0.5) * 30, y: top - 6, vx: (Math.random() - 0.5) * 40, born: time, size: isPet ? 7 : 10 + Math.random() * 4 });
      if (!isPet && target.body.onFloor()) target.body.impulse(dir * 60, -40, DT);
      if (isPet && target.vy === 0) target.vy = -140;
    }
  }

  // Little hearts floating up and fading (from petting).
  const hearts = [];
  // Every heart, puff and note comes through here, so none can ever flood:
  // a lone heart too soon after another one nearby is dropped (0.3 s), and
  // only so many are alive per blob (6). Bursts (born in the future) pass
  // the first rule, but not the cap.
  function spawnHeart(h) {
    for (let i = hearts.length - 1; i >= 0; i--) if (time - hearts[i].born > 1.6) hearts.splice(i, 1);
    if (h.puff || h.note) { hearts.push(h); return; }
    let alive = 0;
    for (const o of hearts) {
      if (o.puff || o.note) continue;
      alive++;
      if (h.born <= time && o.born <= time && time - o.born < 0.3 && Math.hypot((o.from ? 0 : o.x) - (h.from ? 0 : h.x), (o.from ? 0 : o.y) - (h.from ? 0 : h.y)) < 160) return;
    }
    if (alive >= 6 * Math.max(1, buddies.size)) return;
    hearts.push(h);
  }
  function drawHearts() {
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i], age = time - h.born;
      if (age > 1.6) { hearts.splice(i, 1); continue; }
      if (age < 0) continue; // not out yet (a burst comes out one by one)
      if (h.from) {
        h.x = h.from.body.centroid().x + h.dx * h.from.body.o.radius;
        h.y = h.from.body.bbox().minY - h.dy;
        h.from = null;
      }
      const hx = h.x + h.vx * age + Math.sin(age * 5 + h.born) * 4, hy = h.y - age * (h.rise || 45);
      if (h.broken) D.drawBrokenHeart(ctx, h.x, h.y, h.size, age); // (it stays where it broke; its halves fall)
      else if (h.puff) {
        // A puff of steam: a soft grey blob that swells and fades.
        if (age > 1.1) { hearts.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = 0.55 * Math.min(1, age * 8) * (1 - age / 1.1);
        ctx.fillStyle = '#b9bfc9';
        ctx.beginPath();
        ctx.arc(hx, hy, h.size * (1 + age * 1.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (h.note) {
        // A sung note: a little ♪ in the singer's colour, white edged,
        // rocking as it rises.
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, age * 6, (1.6 - age) * 2));
        ctx.translate(hx, hy);
        ctx.rotate(Math.sin(age * 4 + h.born) * 0.25);
        D.drawNote(ctx, h.size, h.color);
        ctx.restore();
      } else D.drawHeart(ctx, hx, hy, h.size, age);
    }
  }

  // The talk box's tail: from the edge of its bubble (which stays where it
  // opened, in its own window) to the slime, redrawn every frame, so the two
  // stay joined however the slime hops or is carried about. It leaves from
  // the point of the bubble's outline that faces the slime, sliding along
  // the bottom, round the corners, up the sides and over the top as the
  // slime goes round it. Flat white, a pointed wedge; a slight curve so it
  // reads as soft. Its tip stops a small gap short of the slime (and of what
  // it wears on its head), it grows out when the box opens, it bends a
  // little away from how the slime is moving, and it shrinks away as the
  // slime comes up against the bubble (under it, it's gone).
  // Every open box (a pinned one each, and the one that comes and goes),
  // each with its own tail to its own slime. The tail only shows while the
  // box is near its slime (BlaubeTalkTail.tailShown: while a full-length
  // tail reaches it): moved away, or with
  // the slime carried off, it shrinks out, and grows back as they meet.
  const tails = new Map(); // session id -> { rect, at, bend, frame, now, sent }
  let talkRect = null; // (the box of the slime you're talking to, for its glances)
  if (api.onTalkRect) api.onTalkRect((list) => {
    list = Array.isArray(list) ? list : list ? [list] : [];
    const seen = new Set();
    for (const r of list) {
      seen.add(r.id);
      const t = tails.get(r.id);
      if (t) t.rect = r;
      else tails.set(r.id, { rect: r, at: time, bend: 0, frame: time, now: null, sent: null });
    }
    for (const id of [...tails.keys()]) if (!seen.has(id)) tails.delete(id);
    talkRect = list.find((r) => r.id === talkingTo) || list[0] || null;
  });
  if (globalThis.__blaube) globalThis.__blaube.talkTail = (id) => { const t = tails.get(id ?? talkingTo) || [...tails.values()][0]; return t ? t.now : null; };
  function drawTalkTail() {
    for (const [id, t] of tails) drawTailFor(id, t);
  }
  function drawTailFor(id, t) {
    t.now = null;
    const b = buddies.get(id), rect = t.rect;
    if (!b || b.dying || rect.dark) return; // (a dark box has no tail)
    const body = b.body, c = body.centroid(), PAD = 12, RADIUS = 30, GAP = 8, W = 22, INSET = 10;
    const box = { x: rect.x + PAD, y: rect.y + PAD, w: rect.w - PAD * 2, h: rect.h - PAD * 2 };
    // Sitting on its own box, or over it: no tail (it would have nowhere to go).
    const bb = body.bbox();
    if ((body.onLedge && body.onLedge.talk === id) || (bb.maxX > box.x && bb.minX < box.x + box.w && bb.maxY > box.y - 2 && bb.minY < box.y + box.h)) return;
    const e = BlaubeTalkTail.edgeToward(box, c, RADIUS);
    // How far the slime reaches towards the bubble from its middle: its skin
    // that way, and, from below, what it wears on its head too.
    let reach = 0;
    for (let i = 0; i < body.n; i++) reach = Math.max(reach, -((body.px[i] - c.x) * e.nx + (body.py[i] - c.y) * e.ny));
    if (e.ny > 0) {
      let top = c.y;
      for (let i = 0; i < body.n; i++) top = Math.min(top, body.py[i]);
      reach += Math.max(0, top - (body.lookTop ?? top)) * e.ny;
    }
    const gap = e.out - reach, len = gap - GAP;
    // Near its slime it shows; farther off than a full-length tail reaches,
    // it shrinks out.
    const shown = BlaubeTalkTail.tailShown(len, body.o.radius);
    t.now = { edge: { x: e.x, y: e.y }, nx: e.nx, ny: e.ny, len: Math.max(0, len), aim: { x: c.x, y: c.y }, shown };
    if (len <= 0 || shown <= 0) return; // up against the bubble, under it, or far from it
    // As long as it needs to be to reach its slime, never longer than a
    // stubby wedge (tailLength), and as wide as it is long: close to the
    // bubble it gets shorter and thinner, down to nothing.
    const long = Math.min(len, BlaubeTalkTail.tailLength(body.o.radius)) * shown;
    if (long < 6) return; // (too little to read as a tail: none, not a stub)
    const thin = Math.min(1, long / 30);
    // Leaves from just inside the bubble (same white, so there's no seam).
    const base = { x: e.x - e.nx * INSET, y: e.y - e.ny * INSET };
    let tip = { x: e.x + e.nx * long, y: e.y + e.ny * long };
    const across = { x: -e.ny, y: e.nx }; // which way its base runs (along the outline)
    // Grows out from the bubble when it opens (with the bubble's own pop).
    const grow = Math.min(1, (time - t.at) / 0.26), ease = 1 - Math.pow(1 - grow, 3) * (1 - 1.6 * grow);
    tip = { x: base.x + (tip.x - base.x) * ease, y: base.y + (tip.y - base.y) * ease };
    t.now.tip = tip;
    // A speech tail: a wedge, wide where it joins the bubble, narrowing to a
    // sharp point (just softened by a hair) at the slime. Both sides curve
    // the same way, and the whole trails a little behind the slime's moves.
    const v = body.velocity(DT), dt = Math.min(0.1, Math.max(0, time - t.frame));
    t.frame = time;
    const want = Math.max(-14, Math.min(14, -(v.x * across.x + v.y * across.y) * 0.02)) * thin;
    t.bend += (want - t.bend) * Math.min(1, dt * 10);
    const w = Math.min(W, (long + INSET) * 0.28) * thin;
    const dx = tip.x - base.x, dy = tip.y - base.y, l = Math.hypot(dx, dy) || 1;
    const flip = -dy * across.x + dx * across.y < 0 ? -1 : 1; // (same way as the base runs)
    const nx = -dy / l * flip, ny = dx / l * flip; // across the wedge's own axis
    const mx = base.x + dx * 0.5 + t.bend * across.x, my = base.y + dy * 0.5 + t.bend * across.y;
    // Control points pinch the wedge in towards the tip, so it reads as a swoosh.
    const k = w * 0.42;
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle = '#ffffff';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2; // same white: only rounds the point by a pixel
    ctx.beginPath();
    ctx.moveTo(base.x - across.x * w, base.y - across.y * w);
    ctx.quadraticCurveTo(mx - nx * k, my - ny * k, tip.x, tip.y);
    ctx.quadraticCurveTo(mx + nx * k, my + ny * k, base.x + across.x * w, base.y + across.y * w);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // While a talk box is open, tells the app where its tail leaves the box,
  // so the box shrinks shut into it (the box itself never moves by itself).
  function followTalk() {
    if (!api.talkAt) return;
    for (const [id, t] of tails) {
      if (!t.now || !t.now.len || !t.now.shown) continue;
      const at = t.now.edge;
      if (t.sent && Math.hypot(at.x - t.sent.x, at.y - t.sent.y) < 6) continue;
      t.sent = { x: at.x, y: at.y };
      api.talkAt(id, t.sent);
    }
  }

  // Where a talk box goes for a slime: over its middle, clear of its head
  // and what it wears (at rest: the body's resting size, not every squish).
  function headTop(b) {
    const c = b.body.centroid(), r = b.body.o.radius;
    return { x: c.x, y: Math.min(b.body.lookTop ?? Infinity, c.y - r), r };
  }
  // Opens a slime's talk box at once, over where its head is at rest: the
  // box never moves after it opens, so a slime clicked mid-hop (it lands,
  // and stays put while you talk to it), or just landing and wobbling, gets
  // its box over where its head will settle on what's under it, not up in
  // the air or down over its head. `pressed`: that, from just before you
  // pressed on it (the press squishes it).
  function openTalkOver(id, b, pressed) {
    b.talkHold = time + 1.5;
    b.pendingHop = null; // (no hop for attention: it has it)
    api.talk(id, pressed || landedHead(b));
  }
  // Where its head will be once it's standing on what's under it: how tall
  // it stands (standHeight) up from the floor or ledge below it. Standing
  // there already, where its head has settled.
  function landedHead(b) {
    const at = headTop(b), body = b.body;
    if (body.grab) return at;
    const box = body.bbox(), c = body.centroid();
    const floor = floorAt((box.minX + box.maxX) / 2, box.maxY);
    // (What it wears on its head stands up over it the same, down or not.)
    const worn = Math.max(0, c.y - body.o.radius - at.y);
    at.y = floor - standHeight(b) - worn;
    return at;
  }
  // How tall a slime stands at rest, from what it stands on to the top of
  // its head (its middle plus a radius): a copy of its body, with its own
  // make-up, let settle on a floor for a moment, out of sight. Its shape in
  // the air (stretched, tucked, squashed by landing) says nothing about
  // that, and one that's always hopping is never seen at rest to learn it.
  const standHeights = new Map(); // what makes it up -> how tall it stands
  function standHeight(b) {
    // (Its size between breaths: how full its context is, how it droops.)
    const scale = (1 + CFG.contextInflate * (b.fill || 0) * (b.fill || 0)) * (1 - CFG.droop * (b.droop || 0));
    const o = b.body.o, key = [o.radius.toFixed(1), o.points, o.pressure, o.gravity, o.fullness, o.shapeStiffness, o.edgeStiffness, scale.toFixed(3)].join();
    if (standHeights.has(key)) return standHeights.get(key);
    const r = o.radius, t = new SoftBody(0, 0, Object.assign({}, o));
    const floor = r * 4;
    t.setBounds(-r * 4, -r * 4, r * 4, floor);
    t.areaScale = scale;
    t.teleport(0, floor - r * 1.05);
    for (let i = 0; i < 240; i++) t.step(DT);
    const h = floor - (t.centroid().y - r);
    if (standHeights.size > 50) standHeights.clear();
    standHeights.set(key, h);
    return h;
  }

  // Drawing is what costs the GPU (every frame shown costs about the same,
  // however little changed), so it isn't done on every screen refresh: only
  // as often as what's moving needs to stay smooth, a few pixels a frame at
  // most. Slow goings-on (breathing, working, leaves) get CFG.calmFps, faster
  // ones more, up to CFG.maxFps (an even share of the refresh: 72 on a
  // 144 Hz screen); anything held, flung or flying, or the cursor moving
  // near a slime, gets the full rate. Everything else still runs every
  // refresh, so timings don't change with the frame rate.
  const PX_PER_FRAME = 4;
  let vsync = 1 / 60, lastTick = 0, paintedAt = 0, wasEmpty = false, wantFps = 0;
  function paintNow(now) {
    const gap = now - lastTick;
    if (lastTick && gap > 0.002 && gap < 0.05) vsync += (gap - vsync) * 0.05;
    lastTick = now;
    if (!buddies.size) { // nothing to draw: clear once, then rest
      if (wasEmpty) return false;
      wasEmpty = true;
      return true;
    }
    wasEmpty = false;
    if (sys.asleep) return false; // the screen locked or the computer asleep: nobody can see
    // Speeding up shows at once; slowing down takes a moment (a hop's top
    // isn't the end of it).
    wantFps = Math.min(CFG.maxFps, Math.max(stageSpeed() / PX_PER_FRAME, wantFps - CFG.maxFps * Math.min(0.05, gap) / 0.4));
    // (Away from the computer counts the same: you may well be watching from
    // across the room, and a 10 fps stage looked broken. Only a locked or
    // sleeping screen stops drawing, above.)
    const fps = Math.max(Math.min(CFG.calmFps, CFG.maxFps), wantFps);
    const every = Math.max(1, Math.ceil(1 / vsync / fps - 0.05)) * vsync;
    if (now - paintedAt < every - vsync / 2) return false;
    paintedAt = now;
    return true;
  }

  // How fast the stage is moving: the fastest thing on it, in px/s (for a
  // slime, most of its skin, not the odd quick bit of it).
  let skin = new Float64Array(64);
  function stageSpeed() {
    if (drag || pet.target || rockets.length || sparks.length || snowballs.length) return Infinity;
    const near = Math.hypot(mouse.vx, mouse.vy) > 60; // (the cursor moving: near a slime, see below)
    let speed = 0;
    const dt = Math.max(1 / 240, vsync);
    for (const p of pets.values()) {
      speed = Math.max(speed, (Math.abs(p.x - (p.calmX ?? p.x)) + Math.abs(p.y - (p.calmY ?? p.y))) / dt);
      p.calmX = p.x; p.calmY = p.y;
    }
    for (const u of flutters) speed = Math.max(speed, Math.hypot(u.vx, u.vy));
    for (const b of buddies.values()) {
      const s = b.body;
      if (s.grab || b.splitting || b.dying) return Infinity;
      if (b.glasses && !b.glasses.held) speed = Math.max(speed, Math.hypot(b.glasses.vx, b.glasses.vy));
      if (skin.length < s.n) skin = new Float64Array(s.n);
      for (let i = 0; i < s.n; i++) skin[i] = Math.max(Math.abs(s.px[i] - s.ox[i]), Math.abs(s.py[i] - s.oy[i]));
      speed = Math.max(speed, skin.subarray(0, s.n).sort()[Math.floor(s.n * 0.75)] / DT);
      // Its eyes follow the cursor, it may perk up.
      if (near) {
        const c = s.centroid();
        if (Math.hypot(mouse.x - c.x, mouse.y - c.y) < s.o.radius * 3 + 150) return Infinity;
      }
    }
    return speed;
  }

  // Drawing between steps. The physics runs in fixed steps of 1/120 s, but
  // frames go up on the screen's own beat (every other refresh of a 144 Hz
  // one, say: 13.9 ms), so one frame showed one step's worth of movement and
  // the next two, and anything going along steadily stuttered. So a frame is
  // drawn part way between the last two steps, as far on as the time left
  // over reaches (alpha = acc / DT): a step behind, but smooth. Only the
  // drawing sees it: before each step, where everything is gets noted
  // (tweenNote); draw() runs with it all put part way back (tweenIn), the
  // clock too; afterwards it all goes back to where the step left it
  // (tweenOut), plus anything the drawing itself moved.
  const tween = { prev: new WeakMap(), gen: 0, live: [], time: 0 };
  const TW_BODY = { pos: [], ang: ['angle'] }, TW_XY = { pos: ['x', 'y'], ang: [] }, TW_XYA = { pos: ['x', 'y'], ang: ['a'] };
  const TW_PET = { pos: ['x', 'y'], ang: ['angle'] }, TW_BUBBLE = { pos: ['x', 'y', 'r'], ang: [] }, TW_FLUTTER = { pos: ['x', 'y'], ang: ['phase'] };
  const TW_LOOK = { pos: ['hx', 'hy'], ang: ['a', 't'] }, TW_ANCHOR = { pos: [], ang: ['a', 'q'] }, TW_EAR = { pos: [], ang: ['0', '1', '2', '3', '4', '5'] };
  const TW_ROPE = { pos: [], ang: ['phase'] };
  const TW_JUMP = 150; // px in one step: put somewhere new, not moving (no smear)
  function tweenEach(fn) {
    for (const b of buddies.values()) {
      fn(b.body, TW_BODY, true);
      if (b.gaze) fn(b.gaze, TW_XY);
      if (b.glasses) fn(b.glasses, TW_XYA);
      const L = b.lookState;
      if (L) {
        fn(L, TW_LOOK);
        if (L.anchors) for (const A of L.anchors.values()) fn(A, TW_ANCHOR);
        if (L.ears) for (const E of L.ears) fn(E.a, TW_EAR);
      }
    }
    for (const p of pets.values()) fn(p, TW_PET);
    for (const u of bubbles) fn(u, TW_BUBBLE);
    for (const f of flakes) fn(f, TW_XYA);
    for (const u of flutters) fn(u, TW_FLUTTER);
    for (const k of rockets) fn(k, TW_XY);
    for (const p of sparks) fn(p, TW_XY);
    for (const s of snowballs) fn(s, TW_XY);
    if (rope) fn(rope, TW_ROPE);
  }
  function tweenNote() {
    const gen = ++tween.gen;
    tweenEach((o, K, body) => {
      let p = tween.prev.get(o);
      const n = K.pos.length + K.ang.length + (body ? 2 * o.n : 0);
      if (!p || p.v.length !== n) tween.prev.set(o, p = { gen, v: new Float64Array(n), now: null, drawn: null });
      p.gen = gen;
      let j = 0;
      for (const k of K.pos) p.v[j++] = o[k];
      for (const k of K.ang) p.v[j++] = o[k];
      if (body) { p.v.set(o.px, j); p.v.set(o.py, j + o.n); }
    });
  }
  function tweenIn() {
    const k = Math.max(0, Math.min(1, acc / DT)), back = 1 - k, live = tween.live;
    live.length = 0;
    tween.time = time;
    if (back <= 0) return;
    time -= back * DT;
    tweenEach((o, K, body) => {
      const p = tween.prev.get(o);
      // (Made, or remade, in the last step: as it is.)
      if (!p || p.gen !== tween.gen || p.v.length !== K.pos.length + K.ang.length + (body ? 2 * o.n : 0)) return;
      const v = p.v, now = p.now || (p.now = new Float64Array(v.length)), drawn = p.drawn || (p.drawn = new Float64Array(v.length));
      let j = 0;
      for (const key of K.pos) {
        const x = o[key];
        now[j] = x;
        drawn[j] = Math.abs(x - v[j]) > TW_JUMP || !Number.isFinite(x + v[j]) ? x : x - (x - v[j]) * back;
        o[key] = drawn[j++];
      }
      for (const key of K.ang) {
        const x = o[key];
        now[j] = x;
        drawn[j] = Number.isFinite(x + v[j]) ? x - Math.atan2(Math.sin(x - v[j]), Math.cos(x - v[j])) * back : x;
        o[key] = drawn[j++];
      }
      if (body) {
        const n = o.n, px = o.px, py = o.py, ox = o.ox, oy = o.oy;
        let mx = 0, my = 0;
        for (let i = 0; i < n; i++) { mx += px[i] - v[j + i]; my += py[i] - v[j + n + i]; }
        const jump = Math.hypot(mx / n, my / n) > TW_JUMP;
        for (let i = 0; i < n; i++) {
          now[j + i] = px[i]; now[j + n + i] = py[i];
          // (The previous positions move along with them, so its speed reads the same.)
          const dx = jump ? 0 : (px[i] - v[j + i]) * back, dy = jump ? 0 : (py[i] - v[j + n + i]) * back;
          px[i] -= dx; py[i] -= dy; ox[i] -= dx; oy[i] -= dy;
          drawn[j + i] = px[i]; drawn[j + n + i] = py[i];
        }
      }
      live.push(o, K, body, now, drawn);
    });
  }
  function tweenOut() {
    time = tween.time;
    const live = tween.live;
    for (let m = 0; m < live.length; m += 5) {
      const o = live[m], K = live[m + 1], body = live[m + 2], now = live[m + 3], drawn = live[m + 4];
      let j = 0;
      for (const key of K.pos) { o[key] = now[j] + (o[key] - drawn[j]); j++; }
      for (const key of K.ang) { o[key] = now[j] + (o[key] - drawn[j]); j++; }
      if (body) {
        const n = o.n;
        if (o.px.length !== n || now.length !== j + 2 * n) continue;
        for (let i = 0; i < n; i++) {
          const dx = now[j + i] - drawn[j + i], dy = now[j + n + i] - drawn[j + n + i];
          o.px[i] += dx; o.py[i] += dy; o.ox[i] += dx; o.oy[i] += dy;
        }
      }
    }
    live.length = 0;
  }

  // (By the refresh's own time, not when this got round to running: that
  // wanders by a millisecond or so, and a frame drawn for the wrong moment
  // is a frame out of step.)
  function frame(stamp) {
    const now = (stamp || performance.now()) / 1000;
    acc += Math.max(0, Math.min(0.05, now - last));
    last = now;
    // How fast the cursor is going (a jump onto the screen doesn't count).
    // Worked out when it has moved (or has been still a moment), over the
    // time since the last time: the cursor is reported about 60 times a
    // second, so per refresh of a faster screen it would read as still,
    // then twice as fast.
    const mdx = mouse.x - mouse.px, mdy = mouse.y - mouse.py, since = now - (mouse.vAt ?? now - 1 / 60);
    if (mdx || mdy || since > 0.05) {
      const jump = Math.abs(mdx) > 1500 || Math.abs(mdy) > 1500, mdt = Math.max(0.004, Math.min(0.1, since));
      mouse.vx += ((jump ? 0 : mdx / mdt) - mouse.vx) * 0.5;
      mouse.vy += ((jump ? 0 : mdy / mdt) - mouse.vy) * 0.5;
      mouse.px = mouse.x; mouse.py = mouse.y; mouse.vAt = now;
    }
    // What the slimes get up to runs with the physics, a fixed 120 times a
    // second: its pushes (impulses, leans, squashes) are each one step's
    // worth, so once per screen refresh they were twice as strong on a
    // 240 Hz screen as on a 120 Hz one, and half as strong at 60 Hz.
    while (acc >= DT) {
      tweenNote();
      step();
      time += DT;
      acc -= DT;
      for (const b of buddies.values()) behave(b);
    }
    checkPetting();
    if (paintNow(now)) {
      tweenIn();
      try { draw(); } finally { tweenOut(); }
    }
    updateIgnore();
    followTalk();
    requestAnimationFrame(frame);
  }

  // --- Input --------------------------------------------------------------

  function buddyAt(x, y) {
    const list = drawOrder().filter((b) => !b.dying);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].body.contains(x, y)) return list[i];
    return null;
  }

  // The session a slime belongs to: its own, or its mother's.
  function sessionOf(b) {
    const m = b.kind === 'child' ? b.mother : b;
    return m && m.kind === 'mother' && m.session ? m.session : null;
  }

  // Tells the app where the grabbable things are, a few times a second; the
  // app decides when the window catches clicks (see main.js).
  let hitSent = 0;
  function updateIgnore() {
    const now = performance.now();
    if (now - hitSent < 50 && !drag === !updateIgnore.held) return;
    hitSent = now;
    updateIgnore.held = !!drag;
    const rects = [];
    for (const b of buddies.values()) {
      if (b.dying) continue;
      const box = b.body.bbox();
      rects.push([box.minX, box.minY, box.maxX, box.maxY]);
    }
    const h = petSize() * 0.7;
    for (const p of pets.values()) if (!p.dying) rects.push([p.x - h, p.y - h, p.x + h, p.y + h]);
    for (const b of buddies.values()) {
      const g = b.glasses;
      if (!g || b.dying) continue;
      const { hw, hh } = glassesBox(g);
      rects.push([g.x - hw, g.y - hh, g.x + hw, g.y + hh]);
    }
    api.setHitAreas(rects, !!drag);
  }

  function onMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.lastMove = performance.now() / 1000;
    if (drag) {
      if (drag.buddy) drag.buddy.body.moveGrab(e.clientX, e.clientY);
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
    }
    updateIgnore();
  }

  function onDown(e) {
    console.log(`[blaube] mousedown ${e.button} at ${e.clientX},${e.clientY} slime=${!!buddyAt(e.clientX, e.clientY)} pet=${!!petAt(e.clientX, e.clientY)}`);
    if (e.button !== 0) return;
    touched();
    const owner = glassesAt(e.clientX, e.clientY);
    if (owner) {
      // Pick up lost glasses, to hand them back.
      const g = owner.glasses;
      g.held = { dx: e.clientX - g.x, dy: e.clientY - g.y };
      drag = { glasses: g, owner, x0: e.clientX, y0: e.clientY, t0: time, moved: false };
      return;
    }
    const p = petAt(e.clientX, e.clientY);
    if (p) {
      // Pick up a pet; a quick click instead says what its task is.
      p.held = { dx: e.clientX - p.x, dy: e.clientY - p.y };
      drag = { pet: p, x0: e.clientX, y0: e.clientY, t0: time, moved: false };
      return;
    }
    const b = buddyAt(e.clientX, e.clientY);
    if (!b) return;
    drag = { buddy: b, x0: e.clientX, y0: e.clientY, t0: time, moved: false };
    b.pressedHead = landedHead(b); // (before the press squishes it: where its talk box goes, for a click)
    pickUp(b);
    b.body.startGrab(e.clientX, e.clientY);
    // Pressed: the skin under the cursor gives in, and it springs back.
    if (CFG.pokeDent > 0) {
      const c = b.body.centroid(), r = b.body.o.radius;
      const dx = c.x - e.clientX, dy = c.y - e.clientY, d = Math.hypot(dx, dy) || 1;
      // Full dent at the edge; pressed in the middle it squishes down instead.
      const edge = Math.min(1, d / r);
      b.body.pushAt(e.clientX, e.clientY, (dx / d) * CFG.pokeDent * r * 12 * edge, (dy / d) * CFG.pokeDent * r * 12 * edge, r * 0.5 * edge + 4, DT);
      if (edge < 0.6) b.body.squashTop(CFG.pokeDent * r * 6 * (0.6 - edge), DT);
    }
    b.startleUntil = time + 0.3;
    feel(b, -0.04); // (poke it over and over and it gets grumpy)
    if (b.merging) b.merging.since = time; // being held resets the trip home
  }

  function onUp(e) {
    if (e.button !== 0 || !drag) return;
    const tap = !drag.moved && time - drag.t0 < 0.35;
    if (drag.buddy) {
      const c = drag.buddy.body.centroid();
      console.log(`[blaube] mouseup ${tap ? 'tap' : 'drag'} after ${(time - drag.t0).toFixed(2)}s, mouse ${e.clientX},${e.clientY}, slime at ${c.x.toFixed(0)},${c.y.toFixed(0)}`);
    }
    if (drag.glasses) {
      // Dropped on their slime: back on they go. Anywhere else they fall.
      const { glasses: g, owner } = drag;
      g.held = null;
      g.since = time;
      g.va = (Math.random() - 0.5) * 10;
      if (owner.glasses === g && owner.body.contains(g.x, g.y)) wearGlasses(owner);
    } else if (drag.pet) {
      // Let go: it flies off with the speed it had (a throw).
      const p = drag.pet;
      p.held = null;
      if (tap) {
        p.vy = -420;
        p.va = (Math.random() < 0.5 ? -1 : 1) * Math.PI * 2;
        if (p.owner) p.owner.say([p.task.description, p.task.command].filter(Boolean).map((text) => ({ text })), 4);
      } else if (p.owner && CFG.fetch > 0 && Math.hypot(p.vx, p.vy) > 500) p.owner.fetch = { pet: p, start: time }; // (thrown: its slime goes after it)
    } else {
      drag.buddy.body.endGrab();
      if (tap) click(drag.buddy, e);
      else { throwSpin(drag.buddy); drag.buddy.thrownAt = time; }
    }
    drag = null;
    updateIgnore();
  }

  function onContext(e) {
    const b = buddyAt(e.clientX, e.clientY);
    if (!b) return;
    const s = sessionOf(b);
    if (b.big && e.altKey) api.openTuning();
    else if (s) api.showSessionMenu(s.id);
    else api.showAppMenu();
  }

  // On Windows the app reports presses (see main.js); elsewhere, and in the
  // shots script and the e2e tests (?debug, which send their own clicks), the
  // window's own mouse events drive the same handlers.
  const fromApp = !!(api.usesPointer && api.onPointer) && !new URLSearchParams(location.search).has('debug');
  if (fromApp) {
    api.onPointer((p) => {
      if (globalThis.__blaube && globalThis.__blaube.ownMouse) return;
      const e = { button: p.button, clientX: p.x, clientY: p.y, altKey: p.alt };
      if (p.kind === 'down' && p.button === 2) onContext(e);
      else if (p.kind === 'down') onDown(e);
      else if (p.button === 0) onUp(e);
    });
  } else {
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
  }
  // Scrolling over a slime squishes it: down presses it flat, up pulls it
  // tall. Keep at it and it giggles.
  window.addEventListener('wheel', (e) => {
    const b = CFG.scrollSquish > 0 && buddyAt(e.clientX, e.clientY);
    if (!b || b.body.grab || !b.body.onFloor()) return;
    const r = b.body.o.radius, d = Math.max(-1, Math.min(1, (e.deltaY || 0) / 60));
    b.body.squashTop(d * CFG.scrollSquish * r * 4, DT);
    b.squished = Math.min(3, (time - (b.squishedAt || -9) < 0.6 ? b.squished || 0 : 0) + Math.abs(d) * 0.15);
    b.squishedAt = time;
    if (b.squished > 1.2) { b.happyUntil = time + 1; b.squished = 0; if (Math.random() < 0.3) quipBack(b, 'hehe', 1.2); }
  }, { passive: true });
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!fromApp) onContext(e);
  });

  function click(b, e) {
    const s = sessionOf(b);
    if (s) {
      // Clicking a slime (or one of its children) opens its talk box;
      // Alt-click goes to its terminal instead.
      api.acknowledge(s.id);
      if ((e && e.altKey) || !api.talk) api.openSession(s.id);
      else { const t = buddies.get(s.id) || b; openTalkOver(s.id, t, t === b ? b.pressedHead : null); }
    } else {
      b.say(summaryLines(), 5);
      api.acknowledge(null);
    }
  }

  // --- Wiring -------------------------------------------------------------

  // A first look, not connected yet (or no Claude Code at all): the home
  // slime says what to do, once, by itself.
  let nudged = false;
  api.onState((s) => {
    settings = s.settings || settings;
    syncSessions(s.sessions || [], s.pending || 0, s.hidden || []);
    if (!nudged && (settings.noClaude || settings.hooksInstalled === false)) {
      nudged = true;
      setTimeout(() => {
        const first = [...buddies.values()].find((b) => b.kind === 'home') || [...buddies.values()].find((b) => b.kind === 'mother');
        if (!first) return;
        first.say(settings.noClaude ? [{ text: 'I can’t find Claude Code. Right-click me to install it' }]
          : [{ text: 'Right-click me to connect Claude Code' }, { text: 'so I can tell what your sessions are up to', dim: true }], 9, false, true);
      }, 2500);
    }
  });

  api.onConfig(applyConfig);
  // You told it something: a nod and "okay!" with a thumbs up. (Anything
  // else that nods, now and then a quiet thumbs up; the nod says it.)
  if (api.onNod) api.onNod((id, how) => {
    const b = buddies.get(id);
    if (!b) return;
    b.nodAt = time;
    b.nodQuiet = false; // (no thinking sign over it)
    if (b.body.onFloor()) b.body.impulse(0, 260, DT);
    if (how && how.prompt && how.typed !== false) okayBack(b);
    else quip(b, '👍', 1.6, 30, 'react');
  });
  if (api.onReact) api.onReact((m) => {
    const b = buddies.get(m.id);
    if (!b) return;
    // A few moments get a little reaction, at most one of a kind every few
    // seconds (a busy session shouldn't fidget).
    const once = (kind, gap) => { b.reacted = b.reacted || {}; if (time < (b.reacted[kind] || 0)) return false; b.reacted[kind] = time + gap; return true; };
    const grounded = b.body.onFloor() && !b.body.grab;
    // Its to-do list: a little hop for each item ticked off (not too
    // often), a proper one with a cheer when the list is done.
    if (m.kind === 'tick' && once('tick', 8)) {
      if (grounded) b.hop(0, -220);
      return;
    }
    if (m.kind === 'listdone' && once('listdone', 20)) {
      b.cheerUntil = time + 1.2;
      if (grounded) b.hop(0, -360);
      if (talkingTo !== m.id) quip(b, m.of > 1 ? `All ${m.of} done!` : 'Done!', 2);
      return;
    }
    // Stop: it digs in and squashes down, like braking.
    if (m.kind === 'brace') {
      b.winceUntil = time + 0.6;
      if (grounded) b.body.impulse(0, 320, DT);
      return;
    }
    if (m.kind === 'push' && once('push', 30)) {
      // Sent off: a little hop and a word.
      if (grounded) b.hop(0, -380);
      quip(b, 'Pushed!', 2);
      return;
    }
    // Tests only get a reaction when the result changes (fixed, or broken),
    // not on every run of a red-green loop.
    // (A failed test shows up as an error too, so only errors count.)
    if (m.kind === 'oops') struggle(b, Math.min(5, m.count || 1));
    if (m.kind === 'cheer') { b.stuck = null; b.fails = []; }
    if (m.kind === 'cheer' || m.kind === 'testfail') {
      const was = b.lastTests;
      b.lastTests = m.kind;
      if (was === m.kind || !once('tests', 45)) return;
      if (m.kind === 'cheer') {
        if (!was) return; // the first green run isn't news
        b.cheerUntil = time + 1.2;
        if (grounded) b.hop(0, -320);
        quip(b, 'Tests pass!', 2);
      } else {
        b.winceUntil = time + 0.8;
        b.droopUntil = time + 2.5;
        if (grounded) b.body.impulse((Math.random() - 0.5) * 120, 120, DT);
      }
      return;
    }
    if (m.kind === 'commit' && once('commit', 20)) { b.nodAt = time; b.nodQuiet = true; return; }
    // You thanked it, or told it off, in a prompt.
    if (m.kind === 'praise' || m.kind === 'scold') {
      if (CFG.feelings <= 0 || !once('tone', 8)) return;
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      if (m.kind === 'praise') {
        b.blushUntil = time + 3;
        b.squirmUntil = time + 0.6 + 0.4 * Math.min(1, CFG.feelings);
        b.happyUntil = time + 2.5;
        const top = b.body.bbox().minY, c = b.body.centroid();
        for (let i = 0; i < 2; i++) spawnHeart({ x: c.x + (i ? 12 : -12), y: top - 6, vx: (i ? 30 : -30), born: time + i * 0.15, size: 10 });
        quipBack(b, pick(['aw, thanks!', 'hehe', 'anytime!']), 1.8);
      } else {
        b.sheepishUntil = time + 2.5;
        b.droopUntil = time + 2.5;
        if (grounded) b.body.impulse(0, 120 * Math.min(1.5, CFG.feelings), DT);
        quipBack(b, pick(['sorry…', 'oops…', 'on it…']), 1.8);
      }
      return;
    }
    if (m.kind !== 'oops' || time < (b.nextWince || 0)) return;
    b.nextWince = time + 20;
    b.winceUntil = time + 0.7;
    b.droopUntil = time + 1.8;
    if (b.body.onFloor() && !b.body.grab) b.body.impulse((Math.random() - 0.5) * 120, 120, DT);
    if (m.count > 1) quip(b, 'oops', 1.8);
  });
  // You're typing to it: it listens, with a little "mm-hm" bob now and then.
  if (api.onTyping) api.onTyping((id) => {
    const b = buddies.get(id);
    if (!b || CFG.listen <= 0) return;
    b.listenAt = time;
    if (time > (b.nextMmhm || 0) && b.body.onFloor() && !b.body.grab) {
      b.nextMmhm = time + 0.5 + Math.random() * 0.9;
      b.body.squashTop(CFG.listen * b.body.o.radius * 2.5, DT);
    }
  });
  if (api.onTalking) api.onTalking((id) => { talkingTo = id; });
  // The app wants a slime's talk box open (a session you just started).
  if (api.onOpenTalk) api.onOpenTalk((id) => {
    let tries = 0;
    const go = () => { const b = buddies.get(id); if (b && api.talk) openTalkOver(id, b); else if (++tries < 30) setTimeout(go, 100); };
    go();
  });
  if (api.onSay) api.onSay((m) => {
    const b = buddies.get(m.id);
    if (!b) return;
    // A reply its talk box is showing: no bubble, so nothing said.
    if (m.voiceOnly) return;
    // Status updates are kept for the hover bubble, and only pop up by
    // themselves when the Status bubbles setting says Always. The big
    // moments get a bubble said out loud: a cheer for a turn done (its
    // summary under it, with Always), the words for needing you.
    if (m.status) {
      b.status = { text: m.text, at: time, state: b.state };
      // Never nagging: a cheer only for a turn you started (not one a loop
      // fed it), at most once a minute; needing you, said once per wait.
      if (m.aloud && m.done && m.typed !== false && time - (b.cheeredAt ?? -1e9) >= 60) {
        b.cheeredAt = time;
        cheer(b, m.long, CFG.statusBubbles === 'Always' ? [{ text: m.text, size: 12 }] : []);
        return;
      }
      const forWait = m.waiting || b.state === 'waiting';
      if (m.aloud && !m.done && !(forWait && b.waitSaid)) {
        if (forWait) b.waitSaid = true;
        b.say(m.text, m.seconds || 6, false, { important: true });
        return;
      }
      if (CFG.statusBubbles !== 'Always') return;
      b.say(m.text, m.seconds || 4);
      return;
    }
    b.say(m.text, m.seconds || 4, false, true);
  });
  api.onWorld((w) => setObstacles(w.obstacles));
  if (api.onSystem) api.onSystem(onSystem);
  // The battery, where the browser can see it.
  if (navigator.getBattery) navigator.getBattery().then((bat) => {
    const read = () => { sys.battery = { level: bat.level, charging: bat.charging }; };
    read();
    bat.addEventListener('levelchange', read);
    bat.addEventListener('chargingchange', read);
  }).catch(() => {});
  if (api.onLedges) api.onLedges(setLedges);

  api.onCommand((cmd) => {
    if (cmd.startsWith('choir:')) startChoir(cmd.slice(6));
    else if (cmd === 'choir-stop') stopChoir();
    else if (cmd === 'come-here') {
      for (const b of buddies.values()) b.body.teleport(W / 2 + (Math.random() - 0.5) * 200, H / 3);
    } else if (cmd === 'hop') {
      for (const b of buddies.values()) b.hop((Math.random() - 0.5) * 600, -900);
    } else if (cmd === 'life-demo') showOff();
    else if (cmd === 'yawn') {
      const b = bigs()[0];
      if (b) yawn(b, 1.6, 1);
    } else if (cmd === 'hello') {
      const b = buddies.get(HOME) || bigs()[0];
      if (b) b.say(summaryLines(), 6);
    }
  });

  window.addEventListener('resize', resize);
  resize();
  // No slime yet: it waits for the first state, so it doesn't show Blaube on
  // its own before we know whether there are sessions to show.
  // The app also reports the cursor, so the eyes follow it even when the
  // window isn't getting mouse moves.
  if (api.onCursor) api.onCursor((p) => {
    if (globalThis.__blaube && globalThis.__blaube.ownMouse) return; // (a test drives the mouse itself)
    if (fromApp) return onMove({ clientX: p.x, clientY: p.y });
    if (p.x !== mouse.x || p.y !== mouse.y) mouse.lastMove = performance.now() / 1000;
    mouse.x = p.x;
    mouse.y = p.y;
  });
  api.ready();
  requestAnimationFrame(frame);

  // Lets the renderer run in a plain browser for development and screenshots.
  function devShim() {
    const listeners = { state: [], command: [], config: [], world: [], ledges: [], system: [], typing: [], talkRect: [], react: [] };
    window.__blaube = {
      setState: (s) => listeners.state.forEach((f) => f(s)),
      command: (c) => listeners.command.forEach((f) => f(c)),
      setConfig: (c) => listeners.config.forEach((f) => f(c)),
      setWorld: (w) => listeners.world.forEach((f) => f(w)),
      setLedges: (l) => listeners.ledges.forEach((f) => f(l)),
      system: (m) => listeners.system.forEach((f) => f(m)),
      typing: (id) => listeners.typing.forEach((f) => f(id)),
      react: (m) => listeners.react.forEach((f) => f(m)),
      talkRect: (r) => listeners.talkRect.forEach((f) => f(r)),
      sys: () => sys,
      season: (k) => { seasonOverride = k; },
      flakes: () => flakes,
      flutters: () => flutters,
      flutter: (bat) => addFlutter(bat),
      holiday: (k) => { holiday = k; },
      clock: (t) => { clockAt = t; },
      bubbles: () => bubbles,
      now: () => time,
      idleFor: (seconds) => { mouse.lastMove = performance.now() / 1000 - seconds; },
      buddies: () => buddies,
      pets: () => pets,
    };
    return {
      setHitAreas() {},
      acknowledge() {},
      showAppMenu() {},
      showSessionMenu() {},
      openSession() {},
      openTuning() {},
      ready() {},
      onConfig: (f) => listeners.config.push(f),
      onWorld: (f) => listeners.world.push(f),
      onLedges: (f) => listeners.ledges.push(f),
      onSystem: (f) => listeners.system.push(f),
      onTyping: (f) => listeners.typing.push(f),
      onReact: (f) => listeners.react.push(f),
      onTalkRect: (f) => listeners.talkRect.push(f),
      onState: (f) => listeners.state.push(f),
      onCommand: (f) => listeners.command.push(f),
    };
  }
})();
