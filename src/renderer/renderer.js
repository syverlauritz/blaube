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
  let mouse = { x: -1e4, y: -1e4, lastMove: performance.now() / 1000 };
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

    say(lines, seconds, sticky = false) {
      this.bubble = { lines: typeof lines === 'string' ? [{ text: lines }] : lines, until: time + seconds, sticky };
    }

    hop(vx, vy) {
      if (this.body.grab) return;
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
      this.body.impulse(vx, vy, DT);
    }
  }

  const buddies = new Map();

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
    for (const id of seen.keys()) if (!done.has(id)) seen.delete(id);
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
      if (l.up <= 0 && !l.vx && !l.vy) { l.up = 0; continue; }
      for (const b of buddies.values()) {
        if (!b.body.onLedge || b.body.onLedge.id !== l.id || b.body.grab) continue;
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
      if (s.activity === 'tool' && m.lastActivity !== 'tool') m.pulse = true;
      m.lastActivity = s.activity;
      const context = s.tokens ? s.tokens.context : 0;
      if (m.lastContext > 40000 && context < m.lastContext * 0.6) {
        m.say([{ text: '\u{1F62E}\u{200D}\u{1F4A8}', size: 30 }], 2);
        if (m.body.onFloor()) m.hop(0, -380);
      }
      m.lastContext = context;
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
        if (a.activity === 'tool' && c.lastActivity !== 'tool') c.pulse = true;
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
      if (b.kind !== 'home' && !live.has(b.key) && !b.merging && !b.dying) b.merging = { since: time };
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
  if (new URLSearchParams(location.search).has('debug')) globalThis.__blaube = { buddies, pets, now: () => time };
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
      if (!onFloor || time < p.nextHop || p.dying) continue;
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
      // When happy it sways softly from side to side, rocking on its base.
      const sway = p.happy ? Math.sin((time - p.heartAt) * 1.8) * 0.13 * Math.min(1, (time - p.heartAt) * 2) : 0;
      D.drawPet(ctx, {
        x: p.x, y: p.y, size: petSize() * grow, angle: p.angle, sway, color, lx, ly,
        blink: time > p.nextBlink - 0.13, happy: p.happy || time < (p.pettedUntil || 0), heart: p.heartAt >= 0 ? time - p.heartAt : Infinity,
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
    if (prev !== state) react(b, prev);
  }

  function react(b, prev) {
    switch (b.state) {
      case 'waiting':
        if (wantsAttention(b)) b.hop(0, -CFG.waitingHopStrength);
        b.nextHop = time + 2.2;
        break;
      case 'done': {
        const took = b.session && b.session.turnStart ? (Date.now() - b.session.turnStart) / 1000 : 0;
        if (took > 300) {
          // A long one: it's earned a little party.
          // The hearts come out of the top of its head as it jumps, wherever
          // that is by then.
          for (let i = 0; i < 7; i++) hearts.push({ from: b, dx: (Math.random() - 0.5) * 1.4, dy: 10 + Math.random() * 30, vx: (Math.random() - 0.5) * 120, rise: 220 + Math.random() * 80, born: time + 0.3 + i * 0.08, size: 9 + Math.random() * 6 });
          b.hop((Math.random() - 0.5) * 100, -CFG.doneHopStrength * 1.5);
        } else if (wantsAttention(b)) b.hop((Math.random() - 0.5) * 200, -CFG.doneHopStrength * 1.1);
        b.happyUntil = time + 2.5;
        b.nextHop = time + CFG.doneHopEvery;
        break;
      }
    }
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
      b.breathPhase += DT * b.breathRate * 1.5 * b.pain;
      body.areaScale = (1 + CFG.contextInflate * b.fill * b.fill) * (1 + CFG.breathe * Math.sin(time * b.breathRate + b.breathPhase));
      // ...and firmer: more pressure inside, so a full one barely sags.
      // (Capped: past about 0.85 the pressure solve overshoots and the skin
      // jitters, worst while it's held.)
      body.o.pressure = Math.min(0.85, CFG.pressure * (1 + CFG.contextTighten * b.fill));
      body.step(DT);
      updateGaze(b);
      b.look = lookOf(b);
      if (b.look !== 'none') Looks.stepLook(b, DT);
      if (b.splitting) pullStrand(b);
      if (body.lastImpact > CFG.dizzySpeed) b.dizzyUntil = time + 0.9;
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
    if (rel >= CFG.dizzySpeed * 0.8) { hit.dizzyUntil = time + 1; return; }
    if (hit.kind === 'home' || hit.body.grab || time < (hit.annoyCooldown || 0)) return;
    hit.annoyedUntil = time + 1.1 + Math.random() * 0.6;
    hit.annoyedAt = by;
    hit.annoyCooldown = time + 7 + Math.random() * 5;
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
    if (on !== b.stackedBy) { b.stackedBy = on; b.stackSince = time; b.stackReacted = false; b.stackPatience = Math.random() * 2; return; }
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
      if (b.blink >= 1) b.nextBlink = time + 2 + Math.random() * 4;
    } else b.blink = Math.max(0, b.blink - 0.2);

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
    if (b.kind !== 'home' && b.state === 'idle' && performance.now() / 1000 - mouse.lastMove > 120 && time > (b.nextIdleYawn || 0)) {
      if (b.nextIdleYawn) yawn(b, 1.6, 0.5);
      b.nextIdleYawn = time + 25 + Math.random() * 40;
    }
    // Yawns are catching.
    if (b.catchYawnAt && time > b.catchYawnAt) {
      b.catchYawnAt = 0;
      yawn(b, 1.3, 0.35);
    }
    stackPlay(b);
    pounce(b);
    // Hanging over the edge of a window: it clings and shuffles back on.
    const l = b.body.onLedge;
    if (l && !b.body.grab) {
      const c = b.body.centroid(), r = b.body.o.radius;
      if (c.x < l.x0 + r * 0.5) b.body.impulse(8, 0, DT);
      else if (c.x > l.x1 - r * 0.5) b.body.impulse(-8, 0, DT);
    }
    // A working slime rocks a little now and then while it thinks.
    if (b.kind !== 'home' && b.state === 'working' && !b.merging && !b.body.grab && b.body.onFloor() && time > (b.nextFidget || 0)) {
      if (b.nextFidget) b.hop((Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 60), -140 - Math.random() * 90);
      b.nextFidget = time + 1.8 + Math.random() * 3;
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
      b.hop(0, -CFG.waitingHopStrength);
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
    else if (time < (b.annoyedUntil || 0) && b.annoyedAt && !b.annoyedAt.dying && !body.grab) { expression = 'annoyed'; mouth = 'flat'; }
    else if (time < (b.yawnUntil || 0)) { expression = 'sleepy'; mouth = 'yawn'; }
    else if (time < (b.winceUntil || 0)) { expression = 'pained'; mouth = 'wobble'; }
    else if (time < (b.cheerUntil || 0)) { expression = 'happy'; mouth = 'grin'; }
    else if (body.grab || time < (b.surpriseUntil || 0)) { mouth = 'o'; }
    else if (b.merging && b.kind === 'child') { expression = 'happy'; mouth = 'smile'; }
    else if (nodding(b)) { expression = 'happy'; mouth = 'smile'; }
    else if (time < (b.pettedUntil || 0)) { expression = 'happy'; mouth = 'grin'; }
    else if (speed > 900 && !body.onFloor()) { mouth = 'grin'; }
    else if (time < (b.pounceUntil || 0) || (b.teaseSince && time - b.teaseSince > 0.3)) { mouth = b.caught ? 'grin' : 'o'; }
    else if (time < b.happyUntil) { expression = 'happy'; mouth = 'grin'; }
    else if (st === 'waiting') { expression = 'worried'; mouth = 'o'; }
    else if (b.pain > 0.05) { expression = 'pained'; mouth = 'wobble'; }
    else if (st === 'done' && unseen(b)) { expression = 'happy'; mouth = 'grin'; }
    else if (st === 'working') { expression = 'concentrate'; mouth = 'flat'; }
    else if (st === 'idle' && time - mouse.lastMove > 120) { expression = 'sleepy'; mouth = 'flat'; }
    // Saying something by itself (a status bubble): eyes open to tell you.
    // Just hovering doesn't wake it from its work.
    if (b.bubble && (expression === 'concentrate' || expression === 'sleepy')) { expression = 'normal'; mouth = 'smile'; }
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
    if (b.glanceAt && time < (b.glanceUntil || 0) && !b.glanceAt.dying && !body.grab && (expression === 'concentrate' || expression === 'normal' || expression === 'sleepy')) {
      checkIn = true;
      if (expression !== 'normal') { expression = 'normal'; mouth = 'flat'; }
    }
    const glaring = expression === 'annoyed';
    b.gazeTarget = glaring ? b.annoyedAt.body.centroid() : !checkIn || b.glanceAt === 'you' ? null : b.glanceAt.spot || b.glanceAt.body.centroid();
    const wantLook = checkIn || glaring || peeking ? 1 : (st === 'idle' || st === 'done') && expression === 'normal' && effort !== 'low' && !body.grab && !b.bubble ? 1 : 0;
    b.lookAmount = (b.lookAmount ?? wantLook) + (wantLook - (b.lookAmount ?? wantLook)) * 0.08;
    // While the face isn't turning (working, not looking at anything), its
    // gaze waits right on what it would look at, so a glance turns straight
    // there (it used to start from wherever the mouse was, often the
    // other way first).
    if (b.gaze && b.lookAmount < 0.15) {
      const to = b.gazeTarget || mouse;
      b.gaze.x = to.x; b.gaze.y = to.y; b.gaze.vx = 0; b.gaze.vy = 0;
    }
    return { expression, mouth, blink: b.blink, look: b.gaze || mouse, lookAmount: b.lookAmount, furrow: b.furrow, raise: b.raise, shake: b.pain || 0, nod: nodOf(b), scale: CFG.faceScale, style: CFG, bodyColor: b.color,
      effort, drool, glasses: effort === 'high' && !b.glasses, squint: effort === 'high' && !!b.glasses && expression === 'normal',
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
    // How far down its to-do list it is.
    const todo = b.kind === 'mother' && b.session && b.session.todo;
    if (todo) lines.push({ text: `${todo.done} of ${todo.of} on its list done`, dim: true });
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
    if (under) { hovered = under; hoverSeen = time; }
    else if (drag || time - hoverSeen > 0.35) hovered = null;
    ctx.clearRect(0, 0, W, H);
    const list = drawOrder();
    if (CFG.shadow) for (const b of list) D.drawShadow(ctx, b.body, floorAt(b.body.centroid().x, b.body.bbox().maxY));
    drawTalkTail();

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
      const sweat = ramp(b.fill || 0, CFG.sweatAt, 1);
      if (sweat > 0) D.drawSweat(ctx, b.body, time, sweat);
      if (b.merging && b.kind === 'child' && !b.dying) {
        const box = b.body.bbox();
        D.drawHeart(ctx, b.body.centroid().x, Math.min(box.minY, b.body.lookTop ?? Infinity) - 14, Math.max(9, b.body.o.radius * 0.18), (time - b.merging.since) % 1.8);
      }
      if (b.kind === 'home' || b.dying) continue;
      if (b === hovered || b.bubble) continue; // the bubble sits where these go
      if (b === buddies.get(talkingTo)) continue; // its talk box is there instead
      if (b.state === 'working' && !nodding(b) && !b.merging) D.drawThinking(ctx, b.body, time, activityOf(b), W);
      if (b.state === 'working' && nodding(b) && b.nodQuiet && !b.merging) D.drawThinking(ctx, b.body, time, activityOf(b), W); // a commit's nod keeps its sign
      if (b.state === 'waiting') D.drawExclaim(ctx, b.body, time, W, '?');
      else if (b.state === 'done' && unseen(b)) D.drawExclaim(ctx, b.body, time, W);
    }
    drawPets();
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
      D.drawHeart(ctx, h.x + h.vx * age + Math.sin(age * 5 + h.born) * 4, h.y - age * (h.rise || 45), h.size, age);
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
    acc += Math.min(0.05, now - last);
    last = now;
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
    b.body.startGrab(e.clientX, e.clientY);
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
      }
    } else {
      drag.buddy.body.endGrab();
      if (tap) click(drag.buddy, e);
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
        if (grounded) b.body.impulse((Math.random() - 0.5) * 120, 120, DT);
      }
      return;
    }
    if (m.kind === 'commit' && once('commit', 20)) { b.nodAt = time; b.nodQuiet = true; return; }
    if (m.kind !== 'oops' || time < (b.nextWince || 0)) return;
    b.nextWince = time + 20;
    b.winceUntil = time + 0.7;
    if (b.body.onFloor() && !b.body.grab) b.body.impulse((Math.random() - 0.5) * 120, 120, DT);
    if (m.count > 1) b.say([{ text: 'oops' }], 1.8);
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
    // Status updates are kept for the hover bubble, and only pop up by
    // themselves when the Status bubbles setting says Always.
    if (m.status) {
      b.status = { text: m.text, at: time, state: b.state };
      if (CFG.statusBubbles !== 'Always') return;
    }
    b.say(m.text, m.seconds || 4);
  });
  api.onWorld((w) => setObstacles(w.obstacles));
  if (api.onLedges) api.onLedges(setLedges);

  api.onCommand((cmd) => {
    if (cmd === 'come-here') {
      for (const b of buddies.values()) b.body.teleport(W / 2 + (Math.random() - 0.5) * 200, H / 3);
    } else if (cmd === 'hop') {
      for (const b of buddies.values()) b.hop((Math.random() - 0.5) * 600, -900);
    } else if (cmd === 'yawn') {
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
    const listeners = { state: [], command: [], config: [], world: [] };
    window.__blaube = {
      setState: (s) => listeners.state.forEach((f) => f(s)),
      command: (c) => listeners.command.forEach((f) => f(c)),
      setConfig: (c) => listeners.config.forEach((f) => f(c)),
      setWorld: (w) => listeners.world.forEach((f) => f(w)),
      buddies: () => buddies,
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
      onState: (f) => listeners.state.push(f),
      onCommand: (f) => listeners.command.push(f),
    };
  }
})();
