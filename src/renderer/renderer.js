// Blaube's stage: a full-screen transparent canvas. Every Claude Code
// session (one per terminal) is a big mother slime, and every subagent that
// session runs splits off it as a small child slime and merges back in when
// it's done. With no sessions, a single home slime sits there on its own.
(function () {
  'use strict';

  const { SoftBody, collideBodies, BlaubeDraw: D, BlaubeConfig } = globalThis;

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
  let drag = null; // { buddy, x0, y0, t0, moved }
  let ignoring = null;
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
    return body;
  }

  // A mother wears the colour picked for its session (or the default one).
  // Her children get a colour near hers, picked from their id.
  const baseColor = (m) => (m && m.session && m.session.color) || CFG.color;

  function colorFor(b) {
    if (b.big) return baseColor(b);
    let h = 0;
    for (let i = 0; i < b.key.length; i++) h = (h * 31 + b.key.charCodeAt(i)) >>> 0;
    const u = ((h % 1000) / 999) * 2 - 1, v = (((h >>> 10) % 1000) / 999) * 2 - 1;
    return D.vary(baseColor(b.mother), u * CFG.childHueSpread, v * CFG.childLightSpread);
  }

  function applyConfig(cfg) {
    CFG = BlaubeConfig.sanitize(cfg);
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
  }

  function setObstacles(rects) {
    obstacles = (rects || []).map((r) => ({ x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height }));
    for (const b of buddies.values()) b.body.setObstacles(CFG.dockCollision ? obstacles : []);
  }

  // The surface under x: the top of an obstacle there, or the screen bottom.
  function floorAt(x) {
    let y = H;
    if (CFG.dockCollision) for (const r of obstacles) if (x >= r.x0 && x <= r.x1) y = Math.min(y, r.y0);
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
  function radiusFor(m) {
    let children = 0;
    for (const b of buddies.values()) if (b.mother === m && !b.dying) children++;
    const R = CFG.mainRadius, r = CFG.childRadius;
    return Math.max(Math.min(CFG.mainMinRadius, R), Math.sqrt(Math.max(0, R * R - 0.5 * children * r * r)));
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

  function syncSessions(sessions) {
    const live = new Set();
    for (const s of sessions) {
      live.add(s.id);
      let m = buddies.get(s.id);
      if (!m || m.dying) m = addMother(s);
      m.merging = null;
      m.session = s;
      m.color = colorFor(m);
      setState(m, s.state);
      if (s.seen && m.bubble && m.bubble.sticky) m.bubble = null;
      for (const a of s.agents || []) {
        const key = `${s.id}/${a.id}`;
        live.add(key);
        let c = buddies.get(key);
        if (!c || c.dying) c = split(m, key, 'child');
        c.merging = null;
        c.mother = m;
        c.agent = a;
        c.color = colorFor(c);
        setState(c, a.state);
      }
    }
    // Finished sessions and subagents head back in.
    for (const b of buddies.values()) {
      if (b.kind !== 'home' && !live.has(b.key) && !b.merging && !b.dying) b.merging = { since: time };
    }
    // With no sessions left, the biggest one stays behind as the home slime.
    if (!sessions.length && !buddies.has(HOME)) {
      const keep = bigs().sort((a, b) => b.body.o.radius - a.body.o.radius)[0];
      if (keep) {
        rekey(keep, HOME);
        Object.assign(keep, { kind: 'home', session: null, state: 'idle', merging: null, bubble: null });
        keep.color = colorFor(keep);
      } else {
        buddies.set(HOME, new Buddy(HOME, 'home', W * 0.8, H * 0.5, CFG.mainRadius));
      }
    }
    for (const b of buddies.values()) if (b.merging) b.mergeInto = mergeTarget(b);
  }

  // The first session takes over the home slime. Later ones split off the
  // nearest mother and grow to full size.
  function addMother(s) {
    const home = buddies.get(HOME);
    if (home && !home.dying) {
      rekey(home, s.id);
      home.kind = 'mother';
      return home;
    }
    const src = bigs()[0];
    if (!src) return new Buddy(s.id, 'mother', W * 0.8, H * 0.5, CFG.mainRadius);
    return split(src, s.id, 'mother');
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
      case 'done':
        if (wantsAttention(b)) b.hop((Math.random() - 0.5) * 200, -CFG.doneHopStrength * 1.1);
        b.happyUntil = time + 2.5;
        b.nextHop = time + CFG.doneHopEvery;
        break;
    }
  }

  function label(b) {
    if (b.kind === 'child') return (b.agent && b.agent.type) || 'agent';
    return (b.session && b.session.project) || 'Claude';
  }

  const kidsOf = (m) => [...buddies.values()].filter((b) => b.mother === m && !b.dying);

  function summaryLines() {
    const mothers = [...buddies.values()].filter((b) => b.kind === 'mother' && !b.dying && b.session);
    if (!mothers.length) {
      return [{ text: settings.hooksInstalled ? 'No Claude Code sessions right now' : 'Right-click me to connect Claude Code' }];
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
    for (const b of [...buddies.values()]) {
      if (b.removed) continue;
      const body = b.body;
      const r = body.o.radius;
      if (b.big && !b.dying) b.targetR = radiusFor(b);
      if (Math.abs(b.targetR - r) > 0.05) body.setRadius(r + (b.targetR - r) * (b.dying ? 0.08 : 0.02));
      body.areaScale = 1 + CFG.breathe * Math.sin(time * b.breathRate + b.breathPhase);
      body.step(DT);
      updateGaze(b);
      if (b.splitting) pullStrand(b);
      if (body.lastImpact > CFG.dizzySpeed) b.dizzyUntil = time + 0.9;

      if (b.merging && !b.dying) {
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
          if (!passThrough(a, b)) collideBodies(a.body, b.body);
        }
      }
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
    if (b.body.grab || !b.body.onFloor() || b.merging || time < b.nextHop) return;

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
    const k = 45, d = 9;
    g.vx += (k * (mouse.x + g.jx - g.x) - d * g.vx) * DT;
    g.vy += (k * (mouse.y + g.jy - g.y) - d * g.vy) * DT;
    g.x += g.vx * DT;
    g.y += g.vy * DT;
  }

  function faceFor(b) {
    const st = b.state;
    const body = b.body;
    const v = body.velocity(DT);
    const speed = Math.hypot(v.x, v.y);
    let expression = 'normal', mouth = 'smile';
    if (time < b.dizzyUntil) { expression = 'dizzy'; mouth = 'flat'; }
    else if (body.grab) { mouth = 'o'; }
    else if (speed > 900 && !body.onFloor()) { mouth = 'grin'; }
    else if (time < b.happyUntil) { expression = 'happy'; mouth = 'grin'; }
    else if (st === 'waiting') { expression = 'worried'; mouth = 'o'; }
    else if (st === 'done' && unseen(b)) { expression = 'happy'; mouth = 'grin'; }
    else if (st === 'working') { expression = 'concentrate'; mouth = 'flat'; }
    else if (st === 'idle' && time - mouse.lastMove > 120) { expression = 'sleepy'; mouth = 'flat'; }
    // Only idle, awake slimes look at the mouse; busy ones mind their work.
    // Eased, so the face glides back instead of snapping.
    const wantLook = st === 'idle' && expression === 'normal' ? 1 : 0;
    b.lookAmount = (b.lookAmount ?? wantLook) + (wantLook - (b.lookAmount ?? wantLook)) * 0.08;
    return { expression, mouth, blink: b.blink, look: b.gaze || mouse, lookAmount: b.lookAmount, scale: CFG.faceScale, style: CFG };
  }

  // Big slimes first, so children are drawn on top (and get clicked first).
  const drawOrder = () => [...buddies.values()].sort((a, b) => (a.big ? 0 : 1) - (b.big ? 0 : 1));

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const list = drawOrder();
    if (CFG.shadow) for (const b of list) D.drawShadow(ctx, b.body, floorAt(b.body.centroid().x));

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
      const glow = wantsAttention(b) && CFG.glow ? D.STATE_COLORS[b.state] : null;
      D.drawBody(ctx, b.body, b.color, { glow, outline: CFG.outline });
      const face = faceFor(b);
      if (b.body.o.radius > 12) D.drawFace(ctx, b.body, face);
      if (face.expression === 'sleepy') D.drawZzz(ctx, b.body, time);
      if (b.kind === 'home' || b.dying) continue;
      if (b.state === 'working') D.drawThinking(ctx, b.body, time);
      if (b.state === 'waiting') D.drawExclaim(ctx, b.body, time, D.STATE_COLORS.waiting, '?');
      else if (b.state === 'done' && unseen(b)) D.drawExclaim(ctx, b.body, time, D.STATE_COLORS.done);
      else D.drawDots(ctx, b.body, [b.state], time);
      D.drawLabel(ctx, b.body, label(b));
    }
    for (const b of list) {
      if (b.bubble) D.drawBubble(ctx, b.body, b.bubble.lines, Math.min(1, (b.bubble.until - time) * 3), W);
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
    draw();
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

  function updateIgnore() {
    const want = !(drag || buddyAt(mouse.x, mouse.y));
    if (want !== ignoring) {
      ignoring = want;
      api.setIgnoreMouse(want);
    }
  }

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.lastMove = performance.now() / 1000;
    if (drag) {
      drag.buddy.body.moveGrab(e.clientX, e.clientY);
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
    }
    updateIgnore();
  });

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const b = buddyAt(e.clientX, e.clientY);
    if (!b) return;
    drag = { buddy: b, x0: e.clientX, y0: e.clientY, t0: time, moved: false };
    b.body.startGrab(e.clientX, e.clientY);
    if (b.merging) b.merging.since = time; // being held resets the trip home
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !drag) return;
    const b = drag.buddy;
    b.body.endGrab();
    if (!drag.moved && time - drag.t0 < 0.35) click(b);
    drag = null;
    updateIgnore();
  });

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const b = buddyAt(e.clientX, e.clientY);
    if (!b) return;
    const s = sessionOf(b);
    if (b.big && e.altKey) api.openTuning();
    else if (s) api.showSessionMenu(s.id);
    else api.showAppMenu();
  });

  function click(b) {
    const s = sessionOf(b);
    if (s) {
      // Clicking a slime (or one of its children) opens its session.
      api.acknowledge(s.id);
      api.openSession(s.id);
    } else {
      b.say(summaryLines(), 5);
      api.acknowledge(null);
    }
  }

  // --- Wiring -------------------------------------------------------------

  api.onState((s) => {
    settings = s.settings || settings;
    syncSessions(s.sessions || []);
  });

  api.onConfig(applyConfig);
  if (api.onSay) api.onSay((m) => { const b = buddies.get(m.id); if (b) b.say(m.text, 4); });
  api.onWorld((w) => setObstacles(w.obstacles));

  api.onCommand((cmd) => {
    if (cmd === 'come-here') {
      for (const b of buddies.values()) b.body.teleport(W / 2 + (Math.random() - 0.5) * 200, H / 3);
    } else if (cmd === 'hop') {
      for (const b of buddies.values()) b.hop((Math.random() - 0.5) * 600, -900);
    } else if (cmd === 'hello') {
      const b = buddies.get(HOME) || bigs()[0];
      if (b) b.say(summaryLines(), 6);
    }
  });

  window.addEventListener('resize', resize);
  resize();
  buddies.set(HOME, new Buddy(HOME, 'home', W * 0.8, H * 0.5, CFG.mainRadius));
  api.setIgnoreMouse(true);
  ignoring = true;
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
      setIgnoreMouse() {},
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
