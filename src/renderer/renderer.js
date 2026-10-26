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
  const sys = { idle: 0, idleAt: -1, away: false, awayFrom: 0, before: null, battery: null, low: 0, lowSaid: false };
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

    say(lines, seconds, sticky = false, aloud = true) {
      this.bubble = { lines: typeof lines === 'string' ? [{ text: lines }] : lines, until: time + seconds, sticky };
      if (aloud) speak(this, this.bubble.lines.map((l) => l.text).join(' '));
    }

    hop(vx, vy) {
      if (this.body.grab) return;
      // Low on battery: tired, smaller hops.
      if (sys.low > 0) { vx *= 1 - 0.3 * sys.low; vy *= 1 - 0.3 * sys.low; }
      if (talkingTo && buddies.get(talkingTo) === this) return; // stays put while you talk to it
      // Up on a window it minds the edge: a hop that would land past it
      // turns back (mothers wander off now and then; helpers never).
      const l = this.body.onLedge;
      if (l && vy < 0 && (this.kind === 'child' || Math.random() < 0.85)) {
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

  // Talking out loud: a babble in its own voice (voice.js), lower the
  // bigger it is, with the mouth moving along. One line at a time each; a
  // new one cuts the last short.
  let audio = null;
  function ensureAudio() {
    if (!audio) {
      const ctx = new AudioContext();
      const out = ctx.createDynamicsCompressor(); // several at once stay soft
      out.connect(ctx.destination);
      audio = { ctx, out };
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio;
  }
  function speak(b, text, how = {}) {
    if (CFG.voice === 'Off' || !text || b.dying || b.singing) return;
    try {
      ensureAudio();
      if (b.speech) b.speech.line.stop();
      const at = audio.ctx.currentTime + 0.03;
      const line = BlaubeVoice.speak(audio.ctx, text, {
        at, out: audio.out, pitch: BlaubeVoice.pitchFor(b.body.o.radius, !b.big) * (how.higher || 1), seed: BlaubeVoice.hash(b.key), volume: CFG.voiceVolume * (how.softer || 1), wah: CFG.voiceWah, pace: how.pace,
      });
      b.speech = { line, at };
    } catch (e) { b.speech = null; }
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
        hearts.push({ note: true, x: c.x + (Math.random() - 0.5) * b.body.o.radius, y: b.body.bbox().minY - 8, vx: (Math.random() - 0.5) * 30, born: time, size: 24 + Math.random() * 8, color: b.color });
      }
    }
  }

  // How its mouth is shaped right now, while it talks (null when quiet).
  function talkMouth(b) {
    if (!b.speech || !audio) return null;
    let m = BlaubeVoice.mouthAt(b.speech.line, audio.ctx.currentTime - b.speech.at);
    // Done: it eases shut before it lets go.
    if (!m) {
      if (!b.mouth || b.mouth.open < 0.05) { b.speech = null; b.mouth = null; return null; }
      m = { open: 0, wide: b.mouth.wide, round: b.mouth.round };
    }
    // Eased, so the jaw moves instead of popping open and shut.
    const was = b.mouth || { open: 0, wide: m.wide, round: m.round };
    b.mouth = { open: was.open + (m.open - was.open) * 0.4, wide: was.wide + (m.wide - was.wide) * 0.3, round: was.round + (m.round - was.round) * 0.3 };
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
    D.setFont(CFG.font);
    // Canvas text doesn't load a font by itself; ask for it.
    if (CFG.font !== 'System' && document.fonts) document.fonts.load(`13px "${CFG.font}"`).catch(() => {});
    if (document.fonts) for (const w of [600, 700]) document.fonts.load(`${w} 15px "Nunito"`).catch(() => {}); // the bubbles' rounded letters
    // The Size setting scales every slime (and pet) at once.
    for (const k of ['mainRadius', 'childRadius', 'mainMinRadius']) CFG[k] *= CFG.size;
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
  // standing on a window that moves rides along with it.
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
    const next = (CFG.windowLedges === 'Off' ? [] : rawLedges).map((m) => Object.assign({}, m));
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
    for (const id of seen.keys()) if (!done.has(id)) { seen.delete(id); shook.delete(id); }
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
    const fresh = knownWindows ? [...ids].filter((id) => !knownWindows.has(id)) : [];
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
            if (time > b.dizzyUntil) quip(b, 'whoa…', 1.2);
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

  // A mother gives up some of her volume to each of her children.
  // Sessions grow with the tokens they've used: a step bigger each time
  // the total doubles, counted from 100k.
  function tokenScale(m) {
    const total = m.session && m.session.tokens ? m.session.tokens.total : 0;
    if (!total) return 1;
    return Math.min(CFG.maxTokenGrowth, 1 + CFG.tokenGrowth * Math.log2(1 + total / 100000));
  }

  // Helpers grow the same way with their own tokens, counted from 20k
  // (they use far fewer), and never past three quarters of their mother.
  function childRadius(b) {
    const total = (b.agent && b.agent.tokens) || 0;
    let r = CFG.childRadius * (total ? Math.min(CFG.maxTokenGrowth, 1 + CFG.tokenGrowth * Math.log2(1 + total / 20000)) : 1);
    if (b.mother && !b.mother.dying) r = Math.min(r, Math.max(CFG.childRadius, b.mother.body.o.radius * 0.75));
    return r;
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

  function radiusFor(m) {
    // She gives up some of her volume to each child (as big as it is now).
    let given = 0;
    for (const b of buddies.values()) if (b.mother === m && !b.dying) given += b.body.o.radius * b.body.o.radius;
    const R = CFG.mainRadius * tokenScale(m);
    return Math.max(Math.min(CFG.mainMinRadius, R), Math.sqrt(Math.max(0, R * R - 0.5 * given)));
  }

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

  function syncSessions(sessions, pending = 0) {
    const live = new Set();
    for (const s of sessions) {
      live.add(s.id);
      let m = buddies.get(s.id);
      if (!m || m.dying) m = addMother(s);
      m.merging = null;
      if (s.activity === 'tool' && m.lastActivity !== 'tool') { m.pulse = true; m.toolSince = time; (m.tools || (m.tools = [])).push(time); }
      m.lastActivity = s.activity;
      const context = s.tokens ? s.tokens.context : 0;
      if (m.lastContext > 40000 && context < m.lastContext * 0.6) {
        m.say([{ text: '\u{1F62E}\u{200D}\u{1F4A8}', size: 30 }], 2);
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
        if (b.kind === 'mother') farewell(b);
      }
    }
    // With no sessions left, the biggest one stays behind as the home slime.
    if (!sessions.length && !pending && !buddies.has(HOME)) {
      const keep = bigs().sort((a, b) => b.body.o.radius - a.body.o.radius)[0];
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
  if (new URLSearchParams(location.search).has('debug')) globalThis.__blaube = { buddies, pets, now: () => time, sys };
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
        hearts.push({ x: p.x, y: p.y - petSize(), vx: 0, born: time, size: 8 });
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
    // ones may repeat); a helper always wears something, shared or not.
    if (b.chosenLook && b.chosenLookFor === b.key) return b.chosenLook;
    const order = Looks.lookOrder(b.key, !b.big);
    if (b.kind === 'child') b.chosenLook = order.find((n) => n !== 'none');
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
    if (prev !== state) { b.stateSince = time; react(b, prev); }
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
          for (let i = 0; i < 7; i++) hearts.push({ from: b, dx: (Math.random() - 0.5) * 1.4, dy: 10 + Math.random() * 30, vx: (Math.random() - 0.5) * 120, rise: 220 + Math.random() * 80, born: time + 0.3 + i * 0.08, size: 9 + Math.random() * 6 });
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
    const near = !drag && Math.hypot(mouse.x - c.x, mouse.y - c.y) < r * 2.5;
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
    return (b.session && b.session.project) || 'Claude';
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
      if (Math.abs(b.targetR - r) > 0.05) body.setRadius(r + (b.targetR - r) * (b.dying ? 0.08 : 0.02));
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
      body.areaScale = (1 + CFG.contextInflate * b.fill * b.fill) * (1 + CFG.breathe * (1 + 12 * CFG.sleepSlump * (b.sleep || 0)) * Math.sin(time * b.breathRate + b.breathPhase)) * (1 - CFG.droop * b.droop);
      // ...and firmer: more pressure inside, so a full one barely sags.
      // (Capped: past about 0.85 the pressure solve overshoots and the skin
      // jitters, worst while it's held.)
      // Dozing (idle, nobody around for two minutes): it slumps, softer and
      // flatter. When you come back it wakes with a big stretch up.
      const asleep = b.state === 'idle' && idleFor() > dozeAfter() && !body.grab;
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
      if (b.gulpAt && time - b.gulpAt < 1.2) { const t = time - b.gulpAt; body.areaScale *= 1 + 0.1 * CFG.gulp * Math.sin(t * 9) * Math.exp(-t * 3); }
      body.o.pressure = Math.min(0.85, CFG.pressure * trait(b, 'firm') * (1 + CFG.contextTighten * b.fill)) * (1 - 0.5 * b.droop) * (1 - 2 * CFG.sleepSlump * b.sleep);
      if (sys.low > 0) { body.areaScale *= 1 - 0.06 * sys.low; body.o.pressure *= 1 - 0.35 * sys.low; }
      // Pressure alone tops out early, so a full one also holds its round
      // shape harder and its skin goes taut: it barely squashes or sags.
      const firm = b.fill * b.fill * CFG.contextFirm;
      body.o.shapeStiffness = CFG.shapeStiffness + 0.08 * firm;
      body.o.edgeStiffness = CFG.edgeStiffness + 0.4 * firm;
      liven(b);
      const pre = body.velocity(DT);
      b.vel = pre; // (others watch it fly; see spectate)
      body.step(DT);
      splat(b, pre);
      updateGaze(b);
      b.look = lookOf(b);
      if (b.look !== 'none') Looks.stepLook(b, DT);
      if (b.splitting) pullStrand(b);
      if (body.lastImpact > CFG.dizzySpeed) { if (time > (b.dizzyUntil || 0)) feel(b, -0.15); b.dizzyUntil = time + 0.9; }
      // A good thump makes it blink (a hard one makes it dizzy, above).
      else if (body.lastImpact > 650 && CFG.eyeLife > 0 && time > (b.thumpBlinkAt || 0)) { b.nextBlink = time; b.thumpBlinkAt = time + 0.3; }
      if (body.lastImpact > 650 && CFG.contactJiggle > 0) passJiggle(b, body.lastImpact);
      if (flakes.length) stirFlakes(b, pre);
      smear(b, pre);
      if (body.lastImpact > CFG.splashSpeed && CFG.splashDrops > 0) splash(b, pre);
      if (b.effort === 'high' && !b.glasses && !b.splitting && !b.merging && !b.dying && body.lastImpact > CFG.glassesSpeed) knockGlasses(b);
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
          if (close || time - b.merging.since > 8) {
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
          } else if (body.onFloor() && !body.grab && time - (b.merging.lastHop || 0) > 0.6) {
            b.merging.lastHop = time;
            b.hop(Math.sign(dx) * Math.min(700, Math.abs(dx) * 2.2 + 120), -520 - Math.max(0, -dy) * 1.5);
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
    stepDrops();
    stepStrands();
    stepBubbles();
    stepSeason();
    stepFlutters();
    stepFireworks();
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
    b.say('My glasses!', 1.6);
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
    if (b.sneeze) {
      const r = body.o.radius;
      if (time < b.sneeze.at) { if (body.onFloor()) body.squashTop(-r * 0.12 * 60 * DT * 60 * DT, DT); }
      else {
        const dir = (Math.random() < 0.5 ? -1 : 1);
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
    if (time < (b.shakeOffUntil || 0) && body.onFloor()) body.lean((Math.sin(time * 70) > 0 ? 1 : -1) * body.o.radius * 2.2 * 60 * DT, DT);
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
    if (CFG.flinch > 0 && ms > CFG.flinchSpeed && d < r * 1.8 && !body.contains(mouse.x, mouse.y) && time > (b.flinchAt || 0)) {
      b.flinchAt = time + 1.2;
      b.startleUntil = time + 0.45;
      b.surpriseUntil = time + 0.45;
      body.lean(-(Math.sign(dx) || 1) * CFG.flinch * r * 3.2, DT);
      body.squashTop(CFG.flinch * r * 2.2, DT);
    }
    // The cursor resting on top of its head: like a cat, it pushes up into
    // your hand and shuts its eyes.
    if (CFG.headPat > 0 && !drag && body.contains(mouse.x, mouse.y) && mouse.y < c.y - r * 0.35 && performance.now() / 1000 - mouse.lastMove > 0.7) {
      b.patted = true;
      if (!b.patSince) b.patSince = time;
      const top = body.bbox().minY;
      if (mouse.y - top > r * 0.1) body.squashTop(-CFG.headPat * r * 0.6 * 60 * DT, DT);
      if (time - b.patSince > 1.5 && !b.patHeart) { b.patHeart = true; hearts.push({ x: c.x, y: top - 6, vx: 0, born: time, size: 10 }); }
    } else { b.patSince = 0; b.patHeart = false; }
    // The cursor resting right on its face: it goes shy, blushing and looking
    // away, peeking back now and then; keep it up and it giggles and squirms.
    const staring = CFG.shy > 0 && !drag && !b.patted && body.contains(mouse.x, mouse.y) && performance.now() / 1000 - mouse.lastMove > 0.8;
    b.stare = staring ? (b.stare || 0) + DT : Math.max(0, (b.stare || 0) - DT * 2);
    // (Thanked, it goes bashful the same way for a moment.)
    b.shy = Math.max(ramp(b.stare, 0.6, 2.2) * Math.min(1, CFG.shy), time < (b.blushUntil || 0) ? Math.min(0.9, (b.blushUntil - time) / 1.5) : 0);
    if (b.shy > 0.3) {
      if (time > (b.nextPeek || 0)) {
        b.peekBack = !b.peekBack;
        b.nextPeek = time + (b.peekBack ? 0.35 : 0.9 + Math.random() * 0.8);
        if (!b.peekBack) b.shySide = Math.random() < 0.5 ? -1 : 1;
      }
      b.glanceAt = b.peekBack ? 'you' : { spot: { x: c.x + (b.shySide || 1) * r * 3, y: c.y + r * 0.8 } };
      b.glanceUntil = time + 0.1;
      if (b.stare > 4.5) {
        b.stare = 1.6;
        quip(b, 'hehe', 1);
        b.squirmUntil = time + 0.8;
      }
    }
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
    const calm = (b.state === 'idle' || b.state === 'done') && !meditating(b) && !b.stackedBy && time > (b.pounceUntil || 0);
    if (!calm) return;
    // A cursor close by: it leans over toward it, curious. Not when you're
    // on it (that's petting), and not if it's been sitting still a while.
    const near = 1 - ramp(d, r * 1.4, r * 4.5);
    const fresh = performance.now() / 1000 - mouse.lastMove < 4;
    // Its mood toward you: fond (petted lately) leans in more; grumpy
    // (poked, shaken, splatted) leans away and gives you a look.
    const mood = b.mood || 0;
    if (mood < -0.45 && near > 0.3 && fresh) { b.annoyedAt = YOU; b.annoyedUntil = time + 0.3; }
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
  const CHATTER = ['…', '!', '?', '♪', 'hm', 'ooh', 'haha', 'mhm', 'ya', 'heh'];
  function chat(b, r, c) {
    if (CFG.socialize <= 0) return false;
    const ch = b.chat;
    if (ch) {
      const o = ch.a === b ? ch.b : ch.a;
      if (time > ch.until || o.dying || o.body.grab || !o.body.onFloor() || o.chat !== ch) { b.chat = null; return false; }
      const side = Math.sign(o.body.centroid().x - c.x) || 1;
      const speaker = Math.floor((time - ch.from) / ch.turn) % 2 === (ch.a === b ? 0 : 1);
      const k = CFG.socialize * r * DT;
      b.body.lean(side * (speaker ? 14 : 6) * k, DT);
      b.body.impulse(-b.body.velocity(DT).x * 0.15, 0, DT); // feet planted
      if (speaker) b.body.squashTop(Math.sin((time - ch.from) * 14) * 18 * k, DT);
      // Now and then a word of it floats up.
      const turn = Math.floor((time - ch.from) / ch.turn);
      if (speaker && b.chatTurn !== turn) { b.chatTurn = turn; if (Math.random() < 0.4) quip(b, CHATTER[Math.floor(Math.random() * CHATTER.length)], ch.turn * 0.9); }
      b.glanceAt = o;
      b.glanceUntil = time + 0.2;
      return true;
    }
    if (time < (b.nextChat || 0)) return false;
    b.nextChat = time + (6 + Math.random() * 10) / CFG.socialize;
    if (Math.random() > 0.4 * trait(b, 'curious')) return false;
    for (const o of buddies.values()) {
      if (o === b || o.dying || o.chat || o.body.grab || !o.body.onFloor() || !(o.state === 'idle' || o.state === 'done')) continue;
      const oc = o.body.centroid();
      if (Math.hypot(oc.x - c.x, oc.y - c.y) > (r + o.body.o.radius) * 1.7) continue;
      b.chat = o.chat = { a: b, b: o, from: time, until: time + 3 + Math.random() * 3, turn: 0.7 + Math.random() * 0.5 };
      return true;
    }
    return false;
  }

  // Goo: a hard hit flings a few droplets off the skin where it hit. They
  // fall and land like little beads, then roll back to their slime and get
  // soaked up (or, if it's gone, shrink away).
  // Goo marks on the floor: a wet patch where a slime lands hard, a smear
  // where one slides along. They dry up in a few seconds.
  const marks = [];
  function smear(b, v) {
    if (CFG.gooTrail <= 0 || b.dying || b.kind === 'home' || b.body.o.radius < 14) return;
    const body = b.body;
    if (!body.onFloor()) { b.smearAt = null; return; }
    const box = body.bbox(), x = (box.minX + box.maxX) / 2, y = box.maxY, hit = body.lastImpact || 0, life = 3 * CFG.gooTrail;
    if (hit > 600) marks.push({ x0: x, x1: x, y, w: (box.maxX - box.minX) * 0.45 * Math.min(1.4, hit / 1600), born: time, color: b.color, life });
    if (Math.abs(v.x) > 140) {
      const at = b.smearAt;
      if (at && Math.abs(at.y - y) < 6 && Math.abs(x - at.x) > 8) { marks.push({ x0: at.x, x1: x, y, w: 0, h: body.o.radius * 0.07, born: time, color: b.color, life }); b.smearAt = { x, y }; }
      else if (!at || Math.abs(at.y - y) >= 6) b.smearAt = { x, y };
    } else b.smearAt = null;
    if (marks.length > 300) marks.splice(0, marks.length - 300);
  }
  // Drawn solid on a layer of their own, then laid down see-through in one
  // go, so overlapping bits of a smear don't show as darker beads.
  let markLayer = null;
  function drawMarks() {
    for (let i = marks.length - 1; i >= 0; i--) if (time - marks[i].born > marks[i].life) marks.splice(i, 1);
    if (!marks.length) return;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    if (!markLayer || markLayer.width !== cw || markLayer.height !== ch) { markLayer = document.createElement('canvas'); markLayer.width = cw; markLayer.height = ch; }
    // Only the strip they're in is cleared and copied, not the whole screen.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const m of marks) { x0 = Math.min(x0, m.x0 - m.w, m.x1); x1 = Math.max(x1, m.x0 + m.w, m.x1); y0 = Math.min(y0, m.y); y1 = Math.max(y1, m.y); }
    const tf = ctx.getTransform(), d = tf.a;
    const rx = Math.max(0, Math.floor((x0 - 20) * d)), ry = Math.max(0, Math.floor((y0 - 20) * d));
    const rw = Math.min(cw, Math.ceil((x1 + 20) * d)) - rx, rh = Math.min(ch, Math.ceil((y1 + 4) * d)) - ry;
    if (rw <= 0 || rh <= 0) return;
    const m2 = markLayer.getContext('2d');
    m2.setTransform(1, 0, 0, 1, 0, 0);
    m2.clearRect(rx, ry, rw, rh);
    m2.setTransform(tf);
    m2.lineCap = 'round';
    for (const m of marks) {
      const k = 1 - (time - m.born) / m.life;
      m2.fillStyle = m2.strokeStyle = m.color;
      if (m.w) { // a wet patch, drying in from its edges
        m2.beginPath(); m2.ellipse(m.x0, m.y - 2.5 * k - 1, m.w * (0.5 + 0.5 * k), 3.5 * k + 1, 0, 0, Math.PI * 2); m2.fill();
      } else {
        const lw = Math.max(1, m.h * 2 * k);
        m2.lineWidth = lw;
        m2.beginPath(); m2.moveTo(m.x0, m.y - lw / 2); m2.lineTo(m.x1, m.y - lw / 2); m2.stroke();
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.42;
    ctx.drawImage(markLayer, rx, ry, rw, rh, rx, ry, rw, rh);
    ctx.restore();
  }

  const drops = [];
  function splash(b, v) {
    if (time < (b.splashedAt || 0) || drops.length > 60) return;
    b.splashedAt = time + 0.35;
    const body = b.body, c = body.centroid(), sp = Math.hypot(v.x, v.y) || 1, ux = v.x / sp, uy = v.y / sp;
    // Where it hit: the skin furthest along the way it was going.
    let j = 0, best = -Infinity;
    for (let i = 0; i < body.n; i++) { const d = (body.px[i] - c.x) * ux + (body.py[i] - c.y) * uy; if (d > best) { best = d; j = i; } }
    const n = Math.round((2 + Math.random() * 3) * CFG.splashDrops * Math.min(1.5, body.lastImpact / 2500));
    for (let k = 0; k < n; k++) {
      const a = Math.atan2(-uy, -ux) + (Math.random() - 0.5) * 2.2, s = (0.15 + Math.random() * 0.3) * Math.min(sp, 3000);
      drops.push({ owner: b, x: body.px[j] - ux * 4, y: body.py[j] - uy * 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 150, r: body.o.radius * (0.05 + Math.random() * 0.06), born: time, landed: 0 });
    }
  }
  function stepDrops() {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i], age = time - d.born;
      const home = d.owner && !d.owner.dying && !d.owner.removed ? d.owner : null;
      if (age > 6 || (home && age > 0.3 && home.body.contains(d.x, d.y))) { drops.splice(i, 1); continue; }
      const was = d.y;
      d.vy += CFG.gravity * DT;
      d.x += d.vx * DT; d.y += d.vy * DT;
      if (d.x < d.r) { d.x = d.r; d.vx = Math.abs(d.vx) * 0.4; }
      if (d.x > W - d.r) { d.x = W - d.r; d.vx = -Math.abs(d.vx) * 0.4; }
      if (d.y < d.r) { d.y = d.r; d.vy = Math.abs(d.vy) * 0.3; }
      const floor = floorAt(d.x, was + d.r) - d.r; // window tops catch them too
      if (d.y >= floor) {
        d.y = floor;
        d.vy = d.vy > 300 ? -d.vy * 0.25 : 0;
        if (!d.landed) d.landed = time;
        // Rolls back home after a moment.
        const hx = home ? home.body.centroid().x - d.x : 0;
        d.vx = time - d.landed > 0.4 && home ? d.vx + (Math.sign(hx) * 220 - d.vx) * 0.08 : d.vx * 0.9;
      }
    }
  }
  function drawDrops() {
    for (const d of drops) {
      const age = time - d.born;
      const k = d.owner && !d.owner.dying ? 1 : Math.max(0, 1 - (time - (d.owner.dying || d.born)) / 0.5);
      const fade = Math.min(1, (6 - age) / 0.5) * k;
      if (fade <= 0) continue;
      // Stretched a little along the way it's flying.
      const sp = Math.hypot(d.vx, d.vy), st = Math.min(1.8, 1 + sp / 1500);
      ctx.save();
      ctx.fillStyle = d.owner.color;
      ctx.translate(d.x, d.y);
      ctx.rotate(Math.atan2(d.vy, d.vx));
      ctx.beginPath();
      ctx.ellipse(0, 0, d.r * st * fade, (d.r / Math.sqrt(st)) * fade, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // --- Goo bubbles -----------------------------------------------------------
  // A bored slime now and then blows a bubble of its own goo: it breathes
  // in, puffs one out of its mouth, and watches it float off. Run the cursor
  // into one and it pops (the slime giggles); a nearby slime might hop up to
  // pop it first.
  const bubbles = [], pops = [];
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
    if (by && !o.dying) { o.happyUntil = time + 1.4; if (Math.random() < 0.5) quip(o, by === 'you' ? 'hehe' : 'pop!', 1); }
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
      // Its own goo, stretched thin: paler, and see-through.
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
  const spooky = () => { const d = new Date(); return d.getMonth() === 9 && d.getDate() >= 24; };
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
      hearts.push({ puff: true, x: c.x + side * r * (0.25 + Math.random() * 0.3), y: top + 4, vx: side * (8 + Math.random() * 18), rise: 30 + Math.random() * 20, born: time, size: r * (0.08 + Math.random() * 0.05) });
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
    b.nextTap = time + 0.42;
    const side = b.key.length % 2 ? 1 : -1, c = b.body.centroid(), bot = b.body.bbox().maxY;
    b.body.pushAt(c.x + side * r * 0.55, bot, 0, 240, r * 0.32, DT);
  }

  // Editing, it types: quick little dips of its top, in bursts.
  function typeAway(b, r) {
    if (CFG.workLife <= 0 || b.state !== 'working' || meditating(b) || activityOf(b) !== 'edit' || time < (b.nextKey || 0)) return;
    const burst = Math.sin(time * 0.9 + (b.breathPhase || 0)) > -0.3; // (now and then a pause)
    b.nextKey = time + (burst ? 0.09 + Math.random() * 0.1 : 0.4);
    if (burst) b.body.squashTop(r * 1.6 * Math.min(1.5, CFG.workLife), DT);
  }

  function strain(b, r) {
    if (CFG.strain <= 0 || b.state !== 'working' || meditating(b)) return;
    const src = b.kind === 'child' ? b.agent : b.session;
    if (!src || src.activity !== 'tool') { b.strainUntil = 0; return; }
    if (time > (b.nextStrain || 0)) {
      if (b.nextStrain) b.strainUntil = time + 0.3 + Math.random() * 0.25;
      b.nextStrain = time + 2.5 + Math.random() * 4;
    }
    if (time < (b.strainUntil || 0) && Math.round(time / DT) % 4 === 0) {
      b.strainDir = -(b.strainDir || 1);
      b.body.lean(b.strainDir * CFG.strain * r * 1.2, DT);
    }
  }

  // Thrown hard into a wall (or the ceiling): it splats and sticks there a
  // moment, the skin touching the wall glued in place while the rest sags
  // under its own weight, then it peels off and drops.
  function splat(b, v) {
    const body = b.body, bd = body.bounds, o = b.splat;
    if (o) {
      if (body.grab || time > o.until) {
        b.splat = null;
        if (!body.grab) body.impulse(-o.nx * 140, o.ny ? 60 : -60, DT); // peels off
        b.dizzyUntil = Math.max(b.dizzyUntil, time + 0.5);
        return;
      }
      for (let i = 0; i < body.n; i++) {
        const on = o.nx ? Math.abs(body.px[i] - o.wall) < 3 : Math.abs(body.py[i] - o.wall) < 3;
        if (!on) continue;
        // Glued: no speed off the wall, and it only creeps along it.
        if (o.nx) { body.ox[i] = body.px[i]; body.oy[i] = body.py[i] - (body.py[i] - body.oy[i]) * 0.15; }
        else { body.oy[i] = body.py[i]; body.ox[i] = body.px[i] - (body.px[i] - body.ox[i]) * 0.15; }
      }
      // A little suction holds it on.
      body.impulse(o.nx * 400 * DT, o.ny * 400 * DT, DT);
      return;
    }
    if (body.grab || b.dying || CFG.splatHold <= 0) return;
    const c = body.contact;
    let hit = null;
    if (c.left && body.bbox().minX <= bd.left + 1 && -v.x > CFG.splatSpeed) hit = { nx: -1, ny: 0, wall: bd.left };
    else if (c.right && body.bbox().maxX >= bd.right - 1 && v.x > CFG.splatSpeed) hit = { nx: 1, ny: 0, wall: bd.right };
    else if (c.top && body.bbox().minY <= bd.top + 1 && -v.y > CFG.splatSpeed) hit = { nx: 0, ny: -1, wall: bd.top };
    if (!hit) return;
    hit.until = time + CFG.splatHold * (0.8 + Math.random() * 0.4);
    b.splat = hit;
    feel(b, -0.2);
    b.pendingHop = null;
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
        hearts.push({ x: (c.x + n.mum.body.centroid().x) / 2, y: Math.min(b.body.bbox().minY, n.mum.body.bbox().minY) - 8, vx: 0, born: time, size: 12 });
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
  let holiday = null; // (dev: force 'christmas' or 'newyear')
  const christmas = () => { const d = new Date(); return holiday === 'christmas' || (d.getMonth() === 11 && d.getDate() >= 20 && d.getDate() <= 26); };
  // The first minutes of the new year: fireworks, and they all cheer.
  const newYear = () => { const d = new Date(); return holiday === 'newyear' || (d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() < 10); };
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

  // --- The computer -------------------------------------------------------

  function onSystem(m) {
    if (m.kind === 'idle') {
      sys.idle = m.seconds;
      sys.idleAt = performance.now() / 1000;
      if (!sys.away && m.seconds > CFG.awayAfter) goAway(m.seconds);
      else if (sys.away && m.seconds < 5) comeBack();
      return;
    }
    if (m.kind === 'battery-level') { sys.battery = { level: m.level, charging: !!m.charging }; return; }
    if (m.kind === 'sleep') goAway(0);
    else if (m.kind === 'wake') { wakeUp(); comeBack(); }
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
    if (morning) wakeUp();
    if (!CFG.welcomeBack || (!news.length && !morning)) return;
    const by = buddies.get(HOME) || news[0] || bigs()[0];
    if (!by) return;
    const mins = Math.round((Date.now() - sys.awayFrom) / 60000);
    const head = morning ? 'Good morning!' : mins >= 2 ? `While you were away (${mins} min):` : 'While you were away:';
    by.say([{ text: head }, ...(morning && news.length ? [{ text: 'While you were away:' }] : []),
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
      b.body.lean(f.dir * Math.sin(p * Math.PI * 2) * CFG.idleFidget * r * 14 * DT, DT);
    }
    if (time < (b.nextIdleFidget || 0)) return;
    const first = !b.nextIdleFidget;
    b.nextIdleFidget = time + (3 + Math.random() * 6) / Math.max(0.3, CFG.idleFidget * trait(b, 'fidgety'));
    if (first) return;
    const roll = Math.random();
    if (roll < 0.45) b.shift = { dir: Math.random() < 0.5 ? -1 : 1, from: time, until: time + 1.2 + Math.random() * 0.8 };
    else if (roll < 0.65) b.body.squashTop(CFG.idleFidget * r * 3, DT);
    else if (roll < 0.8) b.body.squashTop(-CFG.idleFidget * r * 3.5, DT);
    else {
      // A look around: at another slime, or at nothing in particular.
      const others = [...buddies.values()].filter((o) => o !== b && !o.dying);
      const c = b.body.centroid();
      b.glanceAt = others.length && Math.random() < 0.6 ? others[Math.floor(Math.random() * others.length)]
        : { spot: { x: c.x + (Math.random() < 0.5 ? -1 : 1) * r * (1.5 + Math.random() * 3), y: c.y - r * Math.random() * 2.5 } };
      b.glanceUntil = time + 0.6 + Math.random() * 1.2;
    }
  }

  // Two slimes hit each other: if they met fast enough, the one that got
  // hit (the slower one) sees stars for a moment.
  function bump(a, b) {
    if (time < (a.bumpedAt || 0) + 0.6 || time < (b.bumpedAt || 0) + 0.6) return;
    const va = a.body.velocity(DT), vb = b.body.velocity(DT);
    const rel = Math.hypot(va.x - vb.x, va.y - vb.y);
    if (rel < 300) return;
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
      hearts.push({ x: mum.body.centroid().x, y: top - 8, vx: 0, born: time, size: 13 });
      return;
    }
    if (CFG.gooStrands > 0 && rel > 500) stick(a, b);
    if (rel >= CFG.dizzySpeed * 0.8) { hit.dizzyUntil = time + 1; return; }
    if (hit.kind === 'home' || hit.body.grab || time < (hit.annoyCooldown || 0)) return;
    hit.annoyedUntil = time + 1.1 + Math.random() * 0.6;
    hit.annoyedAt = by;
    hit.annoyCooldown = time + 7 + Math.random() * 5;
  }

  // Two slimes that hit hard stick for a moment where they touched: a goo
  // strand stretches between them as they come apart, tugging both, thins
  // out and snaps, flinging a drop back to each.
  const strands = [];
  function stick(a, b) {
    if (strands.length > 6 || strands.some((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a))) return;
    const near = (x, o) => { const c = o.body.centroid(); let best = 0, bd = Infinity; for (let i = 0; i < x.body.n; i++) { const d = Math.hypot(x.body.px[i] - c.x, x.body.py[i] - c.y); if (d < bd) { bd = d; best = i; } } return best; };
    strands.push({ a, b, ia: near(a, b), ib: near(b, a), born: time });
  }
  // Lifted off the floor after a rest, it comes away with a strand of goo
  // still stuck to the spot it sat on, until that snaps.
  function stickToFloor(b) {
    const body = b.body;
    if (CFG.gooStrands <= 0 || strands.length > 6 || !body.onFloor() || time - (b.restSince ?? time) < 1.5 || b.body.o.radius < 20) return;
    const c = body.centroid();
    let ia = 0, best = -Infinity;
    for (let i = 0; i < body.n; i++) { const k = body.py[i] - Math.abs(body.px[i] - c.x) * 0.3; if (k > best) { best = k; ia = i; } }
    strands.push({ a: b, b: null, fx: body.px[ia], fy: body.py[ia], ia, ib: 0, born: time });
  }
  function stepStrands() {
    for (let i = strands.length - 1; i >= 0; i--) {
      const t = strands[i], A = t.a.body, B = t.b && t.b.body;
      if (t.a.dying || t.a.removed || (t.b && (t.b.dying || t.b.removed))) { strands.splice(i, 1); continue; }
      const ax = A.px[t.ia], ay = A.py[t.ia], bx = B ? B.px[t.ib] : t.fx, by = B ? B.py[t.ib] : t.fy;
      const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const max = (A.o.radius + (B ? B.o.radius : A.o.radius * 0.2)) * 1.3 * CFG.gooStrands, age = time - t.born;
      t.d = d; t.max = max;
      if (d > max || age > (B ? 3 : 2.5)) {
        // Snap: what's left of it flies back to each side.
        strands.splice(i, 1);
        if (d > 12) for (const [o, x, y, sx, sy] of [[t.a, ax, ay, ux, uy], [t.b || t.a, bx, by, -ux, -uy]]) drops.push({ owner: o, x: x + sx * 6, y: y + sy * 6, vx: -sx * 260, vy: -sy * 260 - 80, r: o.body.o.radius * 0.07, born: time, landed: 0 });
        continue;
      }
      // Stretched, it pulls: hardest at the spot it's stuck to.
      const pull = Math.max(0, d - 6) * 26 * CFG.gooStrands * DT;
      A.pushAt(ax, ay, ux * pull, uy * pull, A.o.radius * 0.45, DT);
      if (B) B.pushAt(bx, by, -ux * pull, -uy * pull, B.o.radius * 0.45, DT);
    }
  }
  function drawStrands() {
    for (const t of strands) {
      if (!t.d || t.d < 4) continue;
      const A = t.a.body, B = t.b ? t.b.body : null, ax = A.px[t.ia], ay = A.py[t.ia], bx = B ? B.px[t.ib] : t.fx, by = B ? B.py[t.ib] : t.fy;
      const thin = Math.max(0.15, 1 - t.d / t.max), w = (B ? Math.min(A.o.radius, B.o.radius) : A.o.radius * 0.8) * 0.22 * thin;
      // Sagging a little in the middle, thinnest there.
      const mx = (ax + bx) / 2, my = (ay + by) / 2 + t.d * 0.12;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = t.a.color;
      ctx.lineWidth = w * 1.6;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, (ax + mx) / 2, (ay + my) / 2 + t.d * 0.03); ctx.stroke();
      ctx.strokeStyle = (t.b || t.a).color;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, (bx + mx) / 2, (by + my) / 2 + t.d * 0.03); ctx.stroke();
      ctx.lineWidth = w;
      ctx.strokeStyle = t.a.color;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
      ctx.restore();
    }
  }

  // While splitting, a goo strand ties the new slime to the one it came
  // from: a spring whose rest length grows and whose strength fades until
  // it snaps.
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
      if (o === b || o.dying || o.body.grab || o.kind === 'home' || passThrough(o, b)) continue;
      const oc = o.body.centroid();
      if (Math.abs(oc.x - c.x) < r * 0.9 && oc.y < c.y - r * 0.5 && o.body.bbox().maxY > top - 6) { on = o; break; }
    }
    if (on !== b.stackedBy) {
      b.stackedBy = on; b.stackSince = time; b.stackReacted = false; b.stackPatience = Math.random() * 2;
      // Dropped onto its head from high up: it gives like a trampoline and
      // springs the faller back up. Boing!
      const fall = on && on.vel ? on.vel.y : 0;
      if (on && CFG.trampoline > 0 && fall > 650 && b.body.onFloor()) {
        b.body.squashTop(Math.min(900, fall * 0.35) * Math.min(1.5, CFG.trampoline), DT);
        on.bounceAt = time + 0.08; on.bounceV = Math.min(1500, fall) * 1.0 * Math.min(1.5, CFG.trampoline);
        b.surpriseUntil = time + 0.6; on.cheerUntil = time + 1.2;
        quip(on, 'boing!', 1);
      }
      return;
    }
    if (!on) return;
    const family = on.mother === b || b.mother === on || (on.mother && on.mother === b.mother);
    const t = time - b.stackSince;
    if (t > 0.5 && !b.stackReacted) {
      b.stackReacted = true;
      on.happyUntil = time + (family ? 3 : 1.5);
      if (family) {
        b.happyUntil = time + 3;
        hearts.push({ x: c.x, y: top - 10, vx: 0, born: time, size: 11 });
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
    const ok = b.state === 'idle' && !b.body.grab && !b.merging && !b.prank && !b.tag && !b.snow && !b.parade && (b.sleep || 0) < 0.1 && idleFor() < 30 && b !== buddies.get(talkingTo);
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
      if (!ok) { b.trick = null; return; }
      if (!b.body.onFloor()) { b.trick.up = true; return; }
      if (b.pendingHop || time < b.trick.next || (b.trick.n && !b.trick.up)) return; // (each from the ground)
      if (b.trick.n >= 3) { b.trick = null; b.happyUntil = time + 1.5; return; }
      b.trick.n++;
      b.trick.up = false;
      const vx = (Math.random() - 0.5) * 40, vy = -(240 + b.trick.n * 130) * Math.min(1.4, CFG.tricks);
      b.hop(vx, vy);
      // Now and then the last one's a somersault.
      if (b.trick.n === 3 && Math.random() < 0.45 * CFG.flips) b.flip = { dir: Math.random() < 0.5 ? -1 : 1, vy, at: time };
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
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.prank && !o.trick && !o.snow && !o.parade && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
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
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.prank && !o.trick && !o.tag && !o.snow && !o.copy && !o.five && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
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
    const free = (o) => (o.state === 'idle' || o.state === 'done') && !o.body.grab && !o.merging && !o.dying && !o.prank && !o.trick && !o.tag && !o.parade && !o.stackedBy && (o.sleep || 0) < 0.1 && o !== buddies.get(talkingTo);
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
        if (Math.random() < 0.6) quip(b, n.f.kind === 'snow' ? 'brr' : 'nom', 1);
      } else if (body.onFloor() && Math.round(t / 0.18) % 2 === 0 && t < 1.6) body.squashTop(r * 0.5 * 60 * DT, DT); // (chewing)
      return;
    }
    const ok = (b.state === 'idle' || b.state === 'done') && !body.grab && body.onFloor() && !b.tag && !b.prank && !b.trick && !b.blow && (b.sleep || 0) < 0.1;
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
      quip(b, 'got it!', 1.2);
      hearts.push({ x: c.x, y: box.minY - 10, vx: 0, born: time, size: 10 });
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
      hearts.push({ x: (oc.x + bc.x) / 2 + (Math.random() - 0.5) * 12, y: Math.min(b.body.bbox().minY, o.body.bbox().minY) - 6, vx: (Math.random() - 0.5) * 30, born: time, size: 10 + Math.random() * 4 });
    }
  }

  // Thrown hard, it tumbles head over heels through the air, the way it was
  // flung; too many turns and it lands dizzy.
  function throwSpin(b) {
    const v = b.body.velocity(DT), r = b.body.o.radius;
    if (CFG.tumble <= 0 || Math.hypot(v.x, v.y) < 900 || Math.abs(v.x) < 250 || b.splat) return;
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
    if (b.body.grab || b.splat || time - t.at > 6) { b.tumble = null; b.body.o.upright = CFG.upright; return; }
    if (!t.landed && time - t.at > 0.15 && b.body.onFloor()) {
      t.landed = time;
      b.body.o.upright = CFG.upright;
      b.body.spin(-b.body.angularVelocity(DT) * 0.6, DT); // (the floor grabs it)
      if (t.turned > Math.PI * 4) { b.dizzyUntil = Math.max(b.dizzyUntil, time + 2); quip(b, 'whoa…', 1.2); }
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
    const near = CFG.circleDizzy > 0 && !b.body.grab && !b.dying && b.kind !== 'home' && d > r * 0.5 && d < r * 3.5 && performance.now() / 1000 - mouse.lastMove < 0.4;
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
      quip(b, 'whoa…', 1.4);
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
      quip(b, 'plan done!', 1.8);
    } else {
      if (free) b.hop(0, -300);
      quip(b, `${pr.done}/${pr.total} \u2713`, 1.2, 15);
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
      cl.x += (tx - cl.x) * Math.min(1, DT * 3);
      cl.y += (ty - cl.y) * Math.min(1, DT * 3);
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
    if (!ok || time < (b.nextPile ?? (b.nextPile = time + (90 + Math.random() * 200) / CFG.play))) return;
    b.nextPile = time + (180 + Math.random() * 360) / CFG.play;
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
    if ((b.mood || 0) < 0.75 || b.kind === 'child' || b.body.grab || !b.body.onFloor() || b.pendingHop || time < (b.nextTag || 0)) return;
    if (b.state !== 'idle' && b.state !== 'done') return;
    if (performance.now() / 1000 - mouse.lastMove > 3 || mouse.x < 0 || mouse.x > W) return;
    const c = b.body.centroid(), r = b.body.o.radius, dx = mouse.x - c.x;
    if (Math.abs(dx) < r * 3) return;
    b.nextTag = time + 1.2 + Math.random() * 1.5;
    b.happyUntil = time + 1;
    b.hop(Math.sign(dx) * Math.min(480, (Math.abs(dx) - r * 2) * 1.2), -330);
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
    at(34, () => { seasonOverride = was; showingOff = false; });
  }
  let showingOff = false;

  // A little exclamation ("boo!", "hic!") in a balloon, unless it's
  // already showing something that matters more.
  function quip(b, text, seconds, size) {
    if (b.bubble && b.bubble.until - time > 0.3) return;
    b.say([size ? { text, size } : { text }], seconds, false, false);
  }

  function pounce(b) {
    if (time < (b.pounceUntil || 0)) {
      if (!b.caught && b.body.contains(mouse.x, mouse.y)) {
        b.caught = true;
        hearts.push({ x: mouse.x, y: mouse.y - 10, vx: 0, born: time, size: 12 });
      }
      return;
    }
    const calm = b.kind !== 'home' && (b.state === 'idle' || b.state === 'done') && !b.body.grab && !b.merging && !drag && b.body.onFloor() && !b.stackedBy;
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

  function behave(b) {
    // Blinking.
    if (time > b.nextBlink) {
      b.blink = Math.min(1, b.blink + 0.25);
      if (b.blink >= 1) {
        // Now and then a quick second blink right after.
        const again = !b.doubled && Math.random() < 0.18 * CFG.eyeLife;
        b.doubled = again;
        b.nextBlink = time + (again ? 0.16 : (2 + Math.random() * 4) / trait(b, 'blinky'));
      }
    } else b.blink = Math.max(0, b.blink - 0.2);

    if (b.bubble && time > b.bubble.until) b.bubble = null;
    // How long it's sat still on the ground (it sticks a little, after a while).
    if (b.body.onFloor() && !b.body.grab) b.restSince ??= time; else b.restSince = undefined;
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
    burp(b);
    somersault(b);
    tumble(b);
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
    if (b.kind !== 'home' && b.state === 'idle' && idleFor() > dozeAfter() && time > (b.nextIdleYawn || 0)) {
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
    snowFight(b);
    parade(b);
    blow(b);
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
    // A working slime rocks a little now and then while it thinks.
    if (b.kind !== 'home' && b.state === 'working' && !b.merging && !b.body.grab && b.body.onFloor() && time > (b.nextFidget || 0)) {
      if (b.nextFidget) b.hop((Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 60), (-140 - Math.random() * 90) * trait(b, 'bouncy'));
      b.nextFidget = time + (1.8 + Math.random() * 3) / trait(b, 'fidgety');
    }
    if (b.body.grab || !b.body.onFloor() || b.merging || time < b.nextHop) return;
    if (b.kind === 'child' && b.mother && !b.mother.dying) {
      const c = b.body.centroid(), mc = b.mother.body.centroid();
      const dx = mc.x - c.x, far = b.mother.body.o.radius * 2 + b.body.o.radius * 6;
      // Mum up on a window: jump high enough to get up there too.
      const rise = b.body.bbox().maxY - b.mother.body.bbox().maxY;
      const up = rise > b.body.o.radius && b.mother.body.onLedge;
      if (up) {
        // Aimed: high enough to clear the edge, landing near mum.
        const vy = Math.sqrt(2 * CFG.gravity * (rise + b.body.o.radius * 2));
        const air = (vy + Math.sqrt(vy * vy - 2 * CFG.gravity * rise)) / CFG.gravity;
        const l = b.mother.body.onLedge, cr = b.body.o.radius;
        // Land on the near side of mum, or the far side if that has no room.
        const gap = b.mother.body.o.radius + cr * 1.3;
        let tx = mc.x - Math.sign(dx) * gap;
        if (tx < l.x0 + cr * 1.2 || tx > l.x1 - cr * 1.2) tx = mc.x + Math.sign(dx) * gap;
        tx = Math.max(l.x0 + cr * 1.2, Math.min(l.x1 - cr * 1.2, tx));
        b.hop(Math.max(-600, Math.min(600, (tx - c.x) / air)), -vy);
        b.nextHop = time + 1.4 + Math.random() * 1.6;
        return;
      }
      if (Math.abs(dx) > far) {
        b.hop(Math.sign(dx) * Math.min(600, (Math.abs(dx) - far * 0.7) * 1.8 + 120), -380 - Math.random() * 140);
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
      const seek = CFG.seekYou > 0 && b.kind === 'mother' && time - (b.stateSince || 0) > CFG.seekAfter && mouse.x >= 0 && mouse.x <= W && Math.abs(dx) > r * 2.5;
      b.hop(seek ? Math.sign(dx) * Math.min(520, Math.abs(dx) * 1.4 + 80) * CFG.seekYou : 0, -CFG.waitingHopStrength * (seek ? 0.75 : 1));
      b.nextHop = time + 2.2;
    } else {
      // Finished: bounce up and down until you look at it.
      b.hop((Math.random() - 0.5) * 60, -CFG.doneHopStrength);
      b.nextHop = time + CFG.doneHopEvery;
    }
  }

  // Where a slime is looking. It chases the mouse on a soft spring (so it
  // lags and overshoots a little), and now and then its eyes dart a bit off
  // target and back, like real eyes never quite hold still.
  function updateGaze(b) {
    const g = b.gaze || (b.gaze = { x: mouse.x, y: mouse.y, vx: 0, vy: 0, jx: 0, jy: 0, nextDart: time + Math.random() });
    if (time > g.nextDart) {
      const r = b.body.o.radius;
      const dart = Math.random() < 0.7;
      g.jx = dart ? (Math.random() - 0.5) * r * 0.8 : 0;
      g.jy = dart ? (Math.random() - 0.5) * r * 0.5 : 0;
      g.nextDart = time + 0.3 + Math.random() * 1.6;
    }
    const k = 45, d = 9, to = b.gazeTarget || mouse;
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
    const st = b.state;
    const body = b.body;
    const v = body.velocity(DT);
    const speed = Math.hypot(v.x, v.y);
    let expression = 'normal', mouth = 'smile';
    if (time < b.dizzyUntil) { expression = 'dizzy'; mouth = 'flat'; }
    else if (b.splat) { expression = 'dizzy'; mouth = 'wobble'; }
    else if (time < (b.annoyedUntil || 0) && b.annoyedAt && !b.annoyedAt.dying && !body.grab) { expression = 'annoyed'; mouth = 'flat'; }
    else if (time < (b.yawnUntil || 0)) { expression = 'sleepy'; mouth = 'yawn'; }
    else if (time < (b.winceUntil || 0)) { expression = 'pained'; mouth = 'wobble'; }
    else if (time < (b.cheerUntil || 0)) { expression = 'happy'; mouth = 'grin'; }
    else if (time < (b.burpUntil || 0)) { expression = 'normal'; mouth = 'o'; } // (*burp*)
    else if (b.hug || (b.huggedBy && b.huggedBy.hug && b.huggedBy.hug.o === b)) { expression = 'happy'; mouth = 'smile'; } // (a hug)
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
    else if ((b.shy || 0) > 0.3) { expression = 'normal'; mouth = 'smile'; }
    else if (time < (b.wantsPetsUntil || 0) && time > (b.pettedUntil || 0)) { expression = 'normal'; mouth = 'smile'; }
    else if (time - (b.sneezedAt ?? -9) < 0.5) { expression = 'happy'; mouth = 'flat'; }
    else if (b.merging && b.kind === 'child') { expression = 'happy'; mouth = 'smile'; }
    else if (nodding(b)) { expression = 'happy'; mouth = 'smile'; }
    else if (time < (b.pettedUntil || 0)) { expression = 'happy'; mouth = 'grin'; }
    else if (time < (b.greetUntil || 0) && st !== 'working') { expression = 'happy'; mouth = 'smile'; }
    else if (speed > 900 && !body.onFloor()) { mouth = 'grin'; }
    else if (time < (b.pounceUntil || 0) || (b.teaseSince && time - b.teaseSince > 0.3)) { mouth = b.caught ? 'grin' : 'o'; }
    else if (time < b.happyUntil) { expression = 'happy'; mouth = 'grin'; }
    else if (st === 'waiting' && b.cloud && !b.cloud.gone) { expression = 'worried'; mouth = 'wobble'; }
    else if (st === 'waiting') { expression = 'worried'; mouth = 'o'; }
    else if (b.pain > 0.05) { expression = 'pained'; mouth = 'wobble'; }
    else if (st === 'done' && unseen(b)) { expression = 'happy'; mouth = 'grin'; }
    else if (st === 'working' && b.stuck) { expression = 'pained'; mouth = 'wobble'; }
    else if (st === 'working' && b.tapping) { expression = 'normal'; mouth = 'flat'; b.glanceAt = { spot: { x: body.centroid().x + (b.key.length % 2 ? 1 : -1) * body.o.radius * 2, y: body.bbox().maxY + body.o.radius } }; b.glanceUntil = time + 0.1; }
    else if (st === 'working') { expression = 'concentrate'; mouth = 'flat'; }
    else if (st === 'idle' && idleFor() > dozeAfter()) { expression = 'sleepy'; mouth = 'flat'; }
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
      b.nextFurrow = time + 4 + Math.random() * 8;
    }
    // Hovered while it works: it peeks up at you, half-open eyes following
    // the cursor, then goes back to work when you move on.
    const peeking = expression === 'concentrate' && b === hovered && !body.grab;
    if (peeking) { expression = 'peek'; mouth = 'flat'; }
    const moving = expression === 'concentrate' && time < b.furrowUntil;
    const wantFurrow = moving && b.browMove === 'furrow' ? 1 : 0, wantRaise = moving && b.browMove === 'raise' ? 1 : 0;
    b.furrow = (b.furrow || 0) + (wantFurrow - (b.furrow || 0)) * 0.15;
    b.raise = (b.raise || 0) + (wantRaise - (b.raise || 0)) * 0.15;
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
          b.glanceUntil = time + 0.3 + Math.random() * Math.random() * 1.6;
        }
        // Sometimes a quick second look right after; otherwise a while
        // before the next, depending on how curious this one is.
        b.nextGlance = b.nextGlance && Math.random() < 0.2 ? b.glanceUntil + 0.25 + Math.random() * 0.4
          : time + (2 + Math.random() * Math.random() * 12) / b.curiosity;
      }
    }
    // A leaf (or snowflake) drifting down close by: its eyes follow it.
    if (flakes.length && CFG.seasons > 0 && !body.grab && time > (b.nextLeafLook || 0) && !(b.glanceAt && time < (b.glanceUntil || 0))) {
      b.nextLeafLook = time + 2 + Math.random() * 4;
      const c = body.centroid(), r = body.o.radius;
      const f = flakes.find((f) => !f.on && !f.landed && Math.abs(f.x - c.x) < r * 3 && c.y - f.y > r && c.y - f.y < r * 6);
      if (f) { b.glanceAt = { spot: f }; b.glanceUntil = time + 1.5 + Math.random(); }
    }
    // Listening to you type: eyes on the talk box, attentive.
    const listening = CFG.listen > 0 && time - (b.listenAt ?? -9) < 1.2 && talkRect && !body.grab;
    if (listening) {
      b.glanceAt = { spot: { x: talkRect.x + talkRect.w / 2, y: talkRect.y + talkRect.h * 0.7 } };
      b.glanceUntil = time + 0.1;
      if (expression === 'concentrate' || expression === 'sleepy' || expression === 'peek') { expression = 'normal'; mouth = 'smile'; }
    }
    if (b.glanceAt && time < (b.glanceUntil || 0) && !b.glanceAt.dying && !body.grab && (expression === 'concentrate' || expression === 'normal' || expression === 'sleepy')) {
      checkIn = true;
      if (expression !== 'normal') { expression = 'normal'; mouth = 'flat'; }
    }
    const glaring = expression === 'annoyed';
    b.gazeTarget = glaring ? b.annoyedAt.body.centroid() : !checkIn || b.glanceAt === 'you' ? null : b.glanceAt.spot || b.glanceAt.body.centroid();
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
    const seen = !over && !glaring && !body.grab && body.onFloor() && spectate(b);
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
      const act = activityOf(b), c = body.centroid(), r = body.o.radius, k = 0.55 * Math.min(1.5, CFG.workLife);
      if (act === 'read') {
        const line = (time * 0.6 + (b.breathPhase || 0)) % 1;
        b.gazeTarget = { x: c.x + (line * 2.4 - 1.2) * r, y: c.y + r * (1.2 + 0.4 * Math.floor(time * 0.6 % 3)) };
        wantLook = k;
      } else if (act === 'edit') {
        b.gazeTarget = { x: c.x + Math.sin(time * 1.3) * r * 0.5, y: c.y + r * 2.5 };
        wantLook = k;
      } else if (act === 'web') {
        b.gazeTarget = { x: c.x + (b.key.length % 2 ? 1 : -1) * r * 1.6, y: c.y - r * 2.5 };
        wantLook = k;
      }
    }
    b.lookAmount = (b.lookAmount ?? wantLook) + (wantLook - (b.lookAmount ?? wantLook)) * 0.08;
    // While the face isn't turning (working, not looking at anything), its
    // gaze waits right on what it would look at, so a glance turns straight
    // there (it used to start from wherever the mouse was, often the
    // other way first).
    if (b.gaze && b.lookAmount < 0.15) {
      const to = b.gazeTarget || mouse;
      b.gaze.x = to.x; b.gaze.y = to.y; b.gaze.vx = 0; b.gaze.vy = 0;
    }
    // Talking: the mouth follows its babble (not mid-yawn or seeing stars).
    // Shut between syllables, it's its own mouth (a smile, mostly).
    const talk = talkMouth(b);
    b.talkOpen = talk ? talk.open : 0; // the body bobs along (see liven)
    if (b.singing && expression !== 'dizzy') expression = 'happy'; // eyes shut, singing its heart out
    if (talk && mouth !== 'yawn' && expression !== 'dizzy') {
      if (talk.open >= 0.06) mouth = 'talk';
      if (expression === 'concentrate' || expression === 'sleepy' || expression === 'peek') expression = 'normal';
    }
    // A big toss: past the top it looks down at what's coming ("uh-oh"),
    // and just before it lands it screws its eyes shut and braces.
    let wideBy = time < (b.booUntil || 0) ? 1 : time < (b.wantsPetsUntil || 0) && time > (b.pettedUntil || 0) ? 0.5 : 0; // (boo!, or me too!: big eyes)
    if (CFG.eyeLife > 0 && !body.grab && !meditating(b) && expression !== 'dizzy') {
      if (v.y < -900 && !body.onFloor()) b.tossUp = time;
      if (b.tossUp && time - b.tossUp < 2 && !body.onFloor() && v.y > 0) {
        const box = body.bbox(), below = floorAt(body.centroid().x, box.maxY) - box.maxY;
        if (below < body.o.radius * 0.9 && v.y > 600) { expression = 'pained'; mouth = 'flat'; }
        else { expression = 'normal'; mouth = 'o'; wideBy = 0.6; }
      }
      if (body.onFloor()) b.tossUp = 0;
      // Needing you, with you right there: big pleading eyes, on you.
      if (st === 'waiting' && !body.grab) {
        const c = body.centroid();
        if (Math.hypot(mouse.x - c.x, mouse.y - c.y) < body.o.radius * 3) { wideBy = 0.5; b.lookAmount += (1 - b.lookAmount) * 0.1; b.gazeTarget = null; }
      }
    }
    // Startled (poked, flinching): eyes go wide for a moment.
    const wide = CFG.eyeLife * Math.max(wideBy, wideSeen, over ? 0.5 : 0, Math.min(1, ((b.startleUntil || 0) - time) / 0.3));
    return { expression, mouth, talk, blink: b.blink, wide, look: b.gaze || mouse, lookAmount: b.lookAmount, furrow: b.furrow, raise: b.raise, shake: Math.max(b.pain || 0, time < (b.strainUntil || 0) ? 0.6 * Math.min(1, CFG.strain) : 0), nod: nodOf(b), scale: CFG.faceScale, style: b.shy > 0 ? { ...CFG, cheeks: Math.min(0.95, CFG.cheeks + b.shy * 0.55) } : CFG, bodyColor: b.color,
      effort, drool, glasses: effort === 'high' && !b.glasses, squint: effort === 'high' && !!b.glasses && expression === 'normal',
      fullTurn: (body.fullTurn = !!((b.flip && b.flip.spun) || b.tumble)), // (mid-somersault the face, and what it wears, go all the way round)
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
    const lines = [{ text: info.title || label(b) }, { text, color: D.STATE_COLORS[b.state] }];
    const extra = [info.branch, modelName(info.model)].filter(Boolean).join(' · ');
    if (extra) lines.push({ text: extra, dim: true });
    // How long it's been waiting on you.
    const waited = b.state === 'waiting' && b.stateSince !== undefined ? Math.floor((time - b.stateSince) / 60) : 0;
    if (waited >= 1) lines.push({ text: `Waiting ${waited} min`, dim: true });
    // How long this turn has been going.
    const turn = b.state === 'working' && b.kind === 'mother' && b.session && b.session.turnStart ? Math.floor((Date.now() - b.session.turnStart) / 60000) : 0;
    if (turn >= 1) lines.push({ text: `Working for ${turn} min`, dim: true });
    // What its turn has done: files edited, commands run.
    const tw = b.kind === 'mother' && b.session && b.session.turn;
    const did = tw ? [tw.files.length ? `${tw.files.length} file${tw.files.length > 1 ? 's' : ''} edited` : '', tw.cmds ? `${tw.cmds} command${tw.cmds > 1 ? 's' : ''} run` : '', tw.fails ? `${tw.fails} failed` : ''].filter(Boolean) : [];
    if (did.length && (b.state === 'working' || b.state === 'done' || b.state === 'waiting')) lines.push({ text: (b.state === 'done' ? 'Did: ' : 'So far: ') + did.join(' \u00b7 '), dim: true });
    if (tw && tw.lastFail && b.state !== 'idle') lines.push({ text: `Last failed: ${tw.lastFail}`, dim: true });
    // How far through its todo list.
    const pr = b.kind === 'mother' && b.session && b.session.progress;
    if (pr && pr.total) lines.push({ text: `Plan: ${pr.done} of ${pr.total}${pr.current ? ' \u00b7 ' + pr.current : ''}`, dim: true });
    // How full its context window is.
    const tk = b.kind === 'mother' && b.session && b.session.tokens;
    if (tk && tk.limit && tk.context) lines.push({ text: `${Math.min(100, Math.round((tk.context / tk.limit) * 100))}% of context used`, dim: true });
    // Until you've talked to one, say you can.
    if (b.session && !String(b.session.id).startsWith('demo-')) {
      if (settings.hooksInstalled === false) lines.push({ text: 'Connect Claude Code in my menu for more', dim: true });
      else if (!settings.talked) lines.push({ text: 'Click to talk', dim: true });
    }
    return lines;
  }

  // "claude-opus-5-5" -> "Opus 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5".
  function modelName(id) {
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(String(id || ''));
    if (!m) return '';
    const minor = m[3] && m[3].length < 3 ? '.' + m[3] : '';
    return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + minor;
  }

  // Big slimes first, so children are drawn on top (and get clicked first).
  const drawOrder = () => [...buddies.values()].sort((a, b) => (a.body.grab ? 2 : a.big ? 0 : 1) - (b.body.grab ? 2 : b.big ? 0 : 1));

  function draw() {
    D.setCrowd(); // a fresh frame: no balloons placed yet
    const under = drag || petAt(mouse.x, mouse.y) || glassesAt(mouse.x, mouse.y) ? null : buddyAt(mouse.x, mouse.y);
    if (under) {
      // Coming back to a slime after a while: it perks up to say hi.
      if (under !== hovered && time - (under.lastHover || -99) > 6 && CFG.eyeLife > 0) {
        under.greetUntil = time + 0.8;
        if (under.body.onFloor() && !under.body.grab && under.state !== 'working') under.body.squashTop(-under.body.o.radius * 3 * CFG.eyeLife, DT);
      }
      under.lastHover = time;
      hovered = under; hoverSeen = time;
    }
    else if (drag || time - hoverSeen > 0.35) hovered = null;
    ctx.clearRect(0, 0, W, H);
    const list = drawOrder();
    if (CFG.shadow) for (const b of list) D.drawShadow(ctx, b.body, floorAt(b.body.centroid().x, b.body.bbox().maxY));
    drawTalkTail();
    drawDrops();
    drawStrands();
    drawSeason(true);
    drawMarks();

    // Goo bridge while a slime is splitting off.
    for (const b of list) {
      if (!b.splitting) continue;
      const p = (time - b.born) / SPLIT_TIME;
      const a = b.parent.body.centroid(), c = b.body.centroid();
      ctx.save();
      ctx.strokeStyle = b.parent.color;
      ctx.lineCap = 'round';
      const thin = Math.min(1, (b.parent.body.o.radius + b.body.o.radius) / (Math.hypot(c.x - a.x, c.y - a.y) || 1));
      ctx.lineWidth = CFG.childRadius * 1.2 * (1 - p) ** 1.5 * thin;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + c.x) / 2, Math.max(a.y, c.y) + 10, c.x, c.y);
      ctx.stroke();
      ctx.restore();
    }

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
      if (b.dream && time < b.dream.until && !b.bubble && b !== hovered && (b.sleep || 0) > 0.8) D.drawDream(ctx, b.body, time, W, b.dream.what);
      const sweat = Math.max(ramp(b.fill || 0, CFG.sweatAt, 1), busySweat(b));
      if (sweat > 0) D.drawSweat(ctx, b.body, time, sweat);
      drawBeads(b);
      if (b.merging && b.kind === 'child' && !b.dying) {
        const box = b.body.bbox();
        D.drawHeart(ctx, b.body.centroid().x, Math.min(box.minY, b.body.lookTop ?? Infinity) - 14, Math.max(9, b.body.o.radius * 0.18), (time - b.merging.since) % 1.8);
      }
      if (b.kind === 'home' || b.dying) continue;
      if (b === hovered || b.bubble) continue; // the bubble sits where these go
      if (b === buddies.get(talkingTo)) continue; // its talk box is there instead
      if (b.state === 'working' && !nodding(b) && !b.merging && !b.singing) D.drawThinking(ctx, b.body, time, activityOf(b), W);
      if (b.state === 'working' && nodding(b) && b.nodQuiet && !b.merging) D.drawThinking(ctx, b.body, time, activityOf(b), W); // a commit's nod keeps its sign
      if (b.state === 'waiting') D.drawExclaim(ctx, b.body, time, W, '?');
      else if (b.state === 'done' && unseen(b)) D.drawExclaim(ctx, b.body, time, W);
    }
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
      if (lines && b !== buddies.get(talkingTo)) D.drawBubble(ctx, b.body, lines, alpha, W);
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
    if (!target || Math.abs(dx) < 2) return;
    const dir = Math.sign(dx);
    if (dir !== pet.dir) { pet.flips.push(time); pet.dir = dir; }
    pet.flips = pet.flips.filter((t) => time - t < 1.2);
    if (pet.flips.length < 3) return;
    target.pettedUntil = time + 1.2;
    // Tickled: it giggles (a slime, not a pet), now and then.
    if (target.body && !target.speech && time > (target.nextGiggle || 0)) {
      target.nextGiggle = time + 1.4 + Math.random();
      target.giggles = (target.giggles || 0) + 1;
      speak(target, GIGGLES[Math.floor(Math.random() * GIGGLES.length)], { higher: 1.25, pace: 0.55 });
    }
    if (time > (target.nextHeart || 0)) {
      target.nextHeart = time + 0.28;
      const isPet = target.task !== undefined;
      const c = isPet ? { x: target.x, y: target.y } : target.body.centroid();
      const top = isPet ? target.y - petSize() : target.body.bbox().minY;
      hearts.push({ x: c.x + (Math.random() - 0.5) * 30, y: top - 6, vx: (Math.random() - 0.5) * 40, born: time, size: isPet ? 7 : 10 + Math.random() * 4 });
      if (!isPet && target.body.onFloor()) target.body.impulse(dir * 60, -40, DT);
      if (isPet && target.vy === 0) target.vy = -140;
    }
  }

  // Little hearts floating up and fading (from petting).
  const hearts = [];
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
      if (h.puff) {
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

  // The talk box's tail: from under its bubble (which drifts after the slime
  // in its own window) to the slime's head, redrawn every frame, so the two
  // stay joined however the slime hops. Flat white, the bubbles' tail
  // shape, just longer; a slight curve so it reads as soft.
  // Its tip goes to the body (under whatever the slime wears, which is
  // drawn over it), it grows out when the box opens, and like the balloons'
  // tails (face.js) it bends away from how the bubble is moving.
  let talkRect = null, talkTailAt = 0;
  if (api.onTalkRect) api.onTalkRect((r) => {
    if (r && (!talkRect || talkRect.id !== r.id)) talkTailAt = time;
    talkRect = r;
  });
  function drawTalkTail() {
    const b = talkRect && buddies.get(talkRect.id);
    if (!b || talkRect.id !== talkingTo) return;
    const c = b.body.centroid(), r = b.body.o.radius, PAD = 12;
    const bx = talkRect.x + PAD, by = talkRect.y + PAD, bw = talkRect.w - PAD * 2, bh = talkRect.h - PAD * 2;
    let base, tip, across; // where it leaves the bubble, where it ends, and which way its base runs
    if (talkRect.side === 'bottom') {
      base = { x: Math.max(bx + 30, Math.min(bx + bw - 30, c.x)), y: by + bh - 18 }; // well inside: no gap while it moves
      tip = { x: c.x, y: headTop(b).y - 9 }; // just above the head and what it wears
      across = { x: 1, y: 0 };
    } else {
      const left = talkRect.side === 'left';
      base = { x: left ? bx + 18 : bx + bw - 18, y: Math.max(by + 30, Math.min(by + bh - 30, c.y - r * 0.4)) };
      tip = { x: c.x + (left ? r * 0.7 : -r * 0.7), y: c.y - r * 0.4 };
      across = { x: 0, y: 1 };
    }
    // Grows out from the bubble when it opens (with the bubble's own pop).
    const grow = Math.min(1, (time - talkTailAt) / 0.26), ease = 1 - Math.pow(1 - grow, 3) * (1 - 1.6 * grow);
    tip = { x: base.x + (tip.x - base.x) * ease, y: base.y + (tip.y - base.y) * ease };
    // The balloons' tail: a 9 px half base, slightly lopsided sides, bent
    // against the bubble's movement.
    const bend = Math.max(-18, Math.min(18, -(talkRect.vx || 0) * 0.05));
    const mx = (base.x + tip.x) / 2 + bend * across.x, my = (base.y + tip.y) / 2 + bend * across.y;
    // Chubby, with a round tip: a cartoon tail, not a pointer.
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(base.x - across.x * 22, base.y - across.y * 22);
    ctx.quadraticCurveTo(mx - across.x * 12, my - across.y * 12, tip.x - across.x * 7, tip.y - across.y * 7);
    ctx.lineTo(tip.x + across.x * 7, tip.y + across.y * 7);
    ctx.quadraticCurveTo(mx + across.x * 13, my + across.y * 13, base.x + across.x * 22, base.y + across.y * 22);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // While its talk box is open, tells the app where the slime's head is, so
  // the box (and its tail) stays with it when it's nudged or carried.
  // Only moves that matter count (not breathing, squishes or an ear's sway):
  // the box drifts after real moves; the tail takes up the rest.
  let talkSent = null;
  function followTalk() {
    const b = talkingTo && buddies.get(talkingTo);
    if (!b || !api.talkAt) { talkSent = null; return; }
    // Smoothed hard: breathing (fast when it's in pain), squishes and an
    // ear's sway mustn't move the box (or stretch it, when it's short of
    // room): only the slime really moving does.
    const raw = headTop(b);
    const sm = b.talkAnchor || (b.talkAnchor = { x: raw.x, y: raw.y });
    if (Math.hypot(raw.x - sm.x, raw.y - sm.y) > 80) { sm.x = raw.x; sm.y = raw.y; } // a real jump: follow at once
    sm.x += (raw.x - sm.x) * 0.04;
    sm.y += (raw.y - sm.y) * 0.04;
    const at = { x: sm.x, y: sm.y, r: raw.r };
    if (talkSent && Math.hypot(at.x - talkSent.x, at.y - talkSent.y) < 16) return;
    talkSent = at;
    api.talkAt(talkingTo, at);
  }

  // Where a talk box goes for a slime: over its middle, clear of its head
  // and what it wears (at rest: the body's resting size, not every squish).
  function headTop(b) {
    const c = b.body.centroid(), r = b.body.o.radius;
    return { x: c.x, y: Math.min(b.body.lookTop ?? Infinity, c.y - r), r };
  }

  function frame() {
    const now = performance.now() / 1000;
    const fdt = Math.max(0.004, now - last);
    acc += Math.min(0.05, now - last);
    last = now;
    // How fast the cursor is going (a jump onto the screen doesn't count).
    const mdx = mouse.x - mouse.px, mdy = mouse.y - mouse.py;
    const jump = Math.abs(mdx) > 1500 || Math.abs(mdy) > 1500;
    mouse.vx += ((jump ? 0 : mdx / fdt) - mouse.vx) * 0.5;
    mouse.vy += ((jump ? 0 : mdy / fdt) - mouse.vy) * 0.5;
    mouse.px = mouse.x; mouse.py = mouse.y;
    while (acc >= DT) {
      step();
      time += DT;
      acc -= DT;
    }
    for (const b of buddies.values()) behave(b);
    checkPetting();
    draw();
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
    stickToFloor(b);
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
      else throwSpin(drag.buddy);
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
  // shots script, the window's own mouse events drive the same handlers.
  const fromApp = !!(api.usesPointer && api.onPointer);
  if (fromApp) {
    api.onPointer((p) => {
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
    if (b.squished > 1.2) { b.happyUntil = time + 1; b.squished = 0; if (Math.random() < 0.3) quip(b, 'hehe', 1.2); }
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
      else api.talk(s.id, headTop(buddies.get(s.id) || b));
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
    syncSessions(s.sessions || [], s.pending || 0);
    if (!nudged && (settings.noClaude || settings.hooksInstalled === false)) {
      nudged = true;
      setTimeout(() => {
        const first = [...buddies.values()].find((b) => b.kind === 'home') || [...buddies.values()].find((b) => b.kind === 'mother');
        if (!first) return;
        first.say(settings.noClaude ? [{ text: 'I can’t find Claude Code. Right-click me to install it' }]
          : [{ text: 'Right-click me to connect Claude Code' }, { text: 'so I can tell what your sessions are up to', dim: true }], 9);
      }, 2500);
    }
  });

  api.onConfig(applyConfig);
  // You told it something: a nod and a thumbs up.
  if (api.onNod) api.onNod((id) => {
    const b = buddies.get(id);
    if (!b) return;
    b.nodAt = time;
    b.nodQuiet = false; // the 👍 nod has its own bubble
    if (b.body.onFloor()) b.body.impulse(0, 260, DT);
    b.say([{ text: '👍', size: 30 }], 1.6);
  });
  if (api.onReact) api.onReact((m) => {
    const b = buddies.get(m.id);
    if (!b) return;
    // A few moments get a little reaction, at most one of a kind every few
    // seconds (a busy session shouldn't fidget).
    const once = (kind, gap) => { b.reacted = b.reacted || {}; if (time < (b.reacted[kind] || 0)) return false; b.reacted[kind] = time + gap; return true; };
    const grounded = b.body.onFloor() && !b.body.grab;
    if (m.kind === 'push' && once('push', 30)) {
      // Sent off: a little hop and a word.
      if (grounded) b.hop(0, -380);
      b.say([{ text: 'Pushed!' }], 2);
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
        b.say([{ text: 'Tests pass!' }], 2);
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
        for (let i = 0; i < 2; i++) hearts.push({ x: c.x + (i ? 12 : -12), y: top - 6, vx: (i ? 30 : -30), born: time + i * 0.15, size: 10 });
        b.say([{ text: pick(['aw, thanks!', 'hehe', 'anytime!']) }], 1.8);
      } else {
        b.sheepishUntil = time + 2.5;
        b.droopUntil = time + 2.5;
        if (grounded) b.body.impulse(0, 120 * Math.min(1.5, CFG.feelings), DT);
        b.say([{ text: pick(['sorry…', 'oops…', 'on it…']) }], 1.8);
      }
      return;
    }
    if (m.kind !== 'oops' || time < (b.nextWince || 0)) return;
    b.nextWince = time + 20;
    b.winceUntil = time + 0.7;
    b.droopUntil = time + 1.8;
    if (b.body.onFloor() && !b.body.grab) b.body.impulse((Math.random() - 0.5) * 120, 120, DT);
    if (m.count > 1) b.say([{ text: 'oops' }], 1.8);
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
  if (api.onTalking) api.onTalking((id) => { talkingTo = id; const b = id && buddies.get(id); if (b) b.talkAnchor = null; });
  // The app wants a slime's talk box open (a session you just started).
  if (api.onOpenTalk) api.onOpenTalk((id) => {
    let tries = 0;
    const go = () => { const b = buddies.get(id); if (b && api.talk) api.talk(id, headTop(b)); else if (++tries < 30) setTimeout(go, 100); };
    go();
  });
  if (api.onSay) api.onSay((m) => {
    const b = buddies.get(m.id);
    if (!b) return;
    // Out loud only (its talk box is showing the words).
    // The end of a turn arrives twice, about at once: the Done status and
    // the reply itself. Whichever comes first is said; the other would
    // only cut it off and start again.
    const turnLine = (text) => {
      if (b.speech && time - (b.turnSaidAt ?? -99) < 2) return;
      b.turnSaidAt = time;
      speak(b, text);
    };
    if (m.voiceOnly) { turnLine(m.text); return; }
    // Status updates are kept for the hover bubble, and only pop up by
    // themselves when the Status bubbles setting says Always. Only the big
    // moments (done, needs you) are said out loud, bubble or not.
    if (m.status) {
      b.status = { text: m.text, at: time, state: b.state };
      if (m.aloud && m.soft) speak(b, m.text, { softer: 0.55 });
      else if (m.aloud) turnLine(m.text);
      if (CFG.statusBubbles !== 'Always') return;
    }
    b.say(m.text, m.seconds || 4, false, false);
    if (!m.status) turnLine(m.text);
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
      goo: () => bubbles,
      strands: () => strands,
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
