// Blaube's stage: a full-screen transparent canvas with one big slime (the
// orchestrator) that splits off a small slime for each Claude Code session
// and absorbs it again when the session ends.
(function () {
  'use strict';

  const { SoftBody, collideBodies, BlaubeDraw: D, BlaubeConfig } = globalThis;

  const api = window.blaube || devShim();
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const DT = 1 / 120;
  const SPLIT_TIME = 0.55;
  let CFG = Object.assign({}, BlaubeConfig.DEFAULTS);
  let obstacles = []; // Dock/taskbar rectangles in window coordinates

  let W = 0, H = 0;
  let mouse = { x: -1e4, y: -1e4, lastMove: performance.now() / 1000 };
  let drag = null; // { buddy, x0, y0, t0, moved } or { glasses, owner }
  let ignoring = null;
  let settings = { hooksInstalled: true };
  let time = 0;

  class Buddy {
    constructor(key, x, y, r, session) {
      this.key = key;
      this.isMain = key === 'main';
      this.body = makeBody(x, y, r, this.isMain);
      this.color = colorFor(key);
      this.targetR = r;
      this.session = session || null;
      this.state = session ? session.state : 'idle';
      this.effort = (session && session.effort) || 'medium';
      this.glasses = null; // high effort: the glasses, while they're off its face
      this.born = time;
      this.parent = null; // set while splitting off
      this.merging = null; // { since }
      this.dying = 0;
      this.bubble = null; // { lines, until, sticky }
      this.blink = 0;
      this.nextBlink = time + 1 + Math.random() * 4;
      this.dizzyUntil = 0;
      this.happyUntil = 0;
      this.nextHop = time + 8 + Math.random() * 10;
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

  function bodyOpts(isMain) {
    return Object.assign({}, CFG, { points: isMain ? CFG.mainPoints : CFG.childPoints });
  }

  function makeBody(x, y, r, isMain) {
    const body = new SoftBody(x, y, Object.assign(bodyOpts(isMain), { radius: r }));
    body.setBounds(0, 0, W, H);
    body.setObstacles(CFG.dockCollision ? obstacles : []);
    return body;
  }

  // Small slimes get a colour near the big one's, picked from their id.
  function colorFor(key) {
    if (key === 'main') return CFG.color;
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const u = ((h % 1000) / 999) * 2 - 1, v = (((h >>> 10) % 1000) / 999) * 2 - 1;
    return D.vary(CFG.color, u * CFG.childHueSpread, v * CFG.childLightSpread);
  }

  function applyConfig(cfg) {
    CFG = BlaubeConfig.sanitize(cfg);
    for (const b of buddies.values()) {
      const want = b.isMain ? CFG.mainPoints : CFG.childPoints;
      if (b.body.n !== want) {
        // Rebuild with the new point count, keeping place and momentum.
        const c = b.body.centroid(), v = b.body.velocity(DT);
        b.body = makeBody(c.x, c.y, b.body.o.radius, b.isMain);
        b.body.impulse(v.x, v.y, DT);
      }
      b.body.configure(bodyOpts(b.isMain));
      b.body.setObstacles(CFG.dockCollision ? obstacles : []);
      b.color = colorFor(b.key);
      if (!b.isMain && !b.dying) b.targetR = CFG.childRadius;
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

  const main = () => buddies.get('main');

  // The big slime gives up some of its volume to each small one.
  function mainRadius() {
    let children = 0;
    for (const b of buddies.values()) if (!b.isMain && !b.dying) children++;
    const R = CFG.mainRadius, r = CFG.childRadius;
    return Math.max(Math.min(CFG.mainMinRadius, R), Math.sqrt(Math.max(0, R * R - 0.5 * children * r * r)));
  }

  // --- Sessions -----------------------------------------------------------

  function syncSessions(sessions) {
    const live = new Set();
    for (const s of sessions) {
      live.add(s.id);
      let b = buddies.get(s.id);
      if (!b) b = split(s);
      if (b.merging && s.state !== 'gone') b.merging = null;
      const prev = b.state;
      b.session = s;
      b.state = s.state;
      b.effort = s.effort || 'medium';
      if (b.effort !== 'high') b.glasses = null;
      if (prev !== s.state) react(b, prev);
      if (s.seen && b.bubble && b.bubble.sticky) b.bubble = null;
    }
    for (const b of buddies.values()) {
      if (!b.isMain && !live.has(b.key) && !b.merging) b.merging = { since: time };
    }
  }

  function split(session) {
    const m = main();
    const c = m.body.centroid();
    const side = Math.random() < 0.5 ? -1 : 1;
    const r = m.body.o.radius;
    const b = new Buddy(session.id, c.x + side * r * 0.35, c.y - r * 0.15, CFG.childRadius * 0.45, session);
    b.targetR = CFG.childRadius;
    b.parent = m;
    b.state = 'idle';
    buddies.set(session.id, b);
    b.hop(side * CFG.splitImpulse * 0.7, -CFG.splitImpulse);
    m.hop(-side * CFG.splitImpulse * 0.2, -CFG.splitImpulse * 0.25);
    return b;
  }

  function react(b, prev) {
    switch (b.state) {
      case 'working':
        if (prev !== 'waiting') b.hop((Math.random() - 0.5) * 120, -320);
        if (b.bubble && b.bubble.sticky) b.bubble = null;
        break;
      case 'waiting':
        b.hop(0, -CFG.waitingHopStrength);
        b.say([{ text: `${label(b)} needs you`, color: D.STATE_COLORS.waiting }, { text: b.session.message || 'Waiting for you' }], 1e9, true);
        break;
      case 'done':
        b.hop((Math.random() - 0.5) * 200, -CFG.doneHopStrength * 1.1);
        b.happyUntil = time + 2.5;
        b.nextHop = time + CFG.doneHopEvery;
        break;
    }
  }

  const label = (b) => (b.session && b.session.project) || 'Claude';

  function summaryLines() {
    const kids = [...buddies.values()].filter((b) => !b.isMain && !b.dying && b.session);
    if (!kids.length) {
      return [{ text: settings.hooksInstalled ? 'No Claude Code sessions right now' : 'Right-click me to connect Claude Code' }];
    }
    const word = { working: 'working', waiting: 'needs you', done: 'done', idle: 'idle' };
    return kids.map((b) => ({ text: `${label(b)}: ${word[b.state] || b.state}`, color: D.STATE_COLORS[b.state] }));
  }

  function aggregateState() {
    let s = 'idle';
    for (const b of buddies.values()) {
      if (b.isMain || b.dying) continue;
      if (b.state === 'waiting') return 'waiting';
      if (b.state === 'working') s = 'working';
      else if (b.state === 'done' && s === 'idle' && !b.session.seen) s = 'done';
    }
    return s;
  }

  // --- Simulation ---------------------------------------------------------

  function step() {
    const m = main();
    m.targetR = mainRadius();

    for (const b of [...buddies.values()]) {
      const body = b.body;
      const r = body.o.radius;
      if (Math.abs(b.targetR - r) > 0.05) body.setRadius(r + (b.targetR - r) * (b.dying ? 0.08 : 0.02));
      body.areaScale = 1 + CFG.breathe * Math.sin(time * 2.2 + b.born * 3);
      body.step(DT);
      if (b.splitting) pullStrand(b);
      if (body.lastImpact > CFG.dizzySpeed) b.dizzyUntil = time + 0.9;
      if (b.effort === 'high' && !b.isMain && !b.glasses && !b.splitting && !b.dying && body.lastImpact > CFG.glassesSpeed) knockGlasses(b);
      if (b.glasses) stepGlasses(b);
      if (b.effort === 'xhigh' && b.state === 'working' && !b.isMain && !body.grab && !b.merging && !b.splitting && !b.dying) levitate(b);

      if (b.merging && !b.dying) {
        const c = body.centroid(), mc = m.body.centroid();
        const dx = mc.x - c.x, dy = mc.y - c.y;
        const close = Math.hypot(dx, dy) < m.body.o.radius + r * 0.4;
        if (close || time - b.merging.since > 8) {
          b.dying = time;
          b.targetR = 2;
          m.hop(0, -260);
        } else if (body.onFloor() && !body.grab && time - (b.merging.lastHop || 0) > 0.6) {
          b.merging.lastHop = time;
          b.hop(Math.sign(dx) * Math.min(700, Math.abs(dx) * 2.2 + 120), -520 - Math.max(0, -dy) * 1.5);
        }
      }
      if (b.dying && body.o.radius < 4) buddies.delete(b.key);
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

  // High effort: hit something hard enough and the glasses fly off.
  function knockGlasses(b) {
    const body = b.body, c = body.centroid(), r = body.o.radius, v = body.velocity(DT);
    b.glasses = {
      x: c.x + Math.sin(b.body.angle) * r * 0.18, y: c.y - Math.cos(b.body.angle) * r * 0.18,
      vx: v.x * 0.5 + (Math.random() - 0.5) * 400, vy: Math.min(0, v.y) * 0.4 - 650,
      a: body.angle, va: (Math.random() - 0.5) * 24,
      r: r * CFG.faceScale, held: false, since: time, lx: 0, ly: 0,
    };
    b.say('My glasses!', 1.6);
  }

  function glassesBox(g) {
    return { hw: g.r * 0.72, hh: g.r * 0.28 };
  }

  function stepGlasses(b) {
    const g = b.glasses;
    if (g.held) {
      // Track the throw speed from how the cursor moves them.
      g.vx = g.vx * 0.8 + ((g.x - g.lx) / DT) * 0.2;
      g.vy = g.vy * 0.8 + ((g.y - g.ly) / DT) * 0.2;
      g.lx = g.x; g.ly = g.y;
      g.a *= 0.9;
      return;
    }
    const { hw, hh } = glassesBox(g);
    g.vy += CFG.gravity * DT;
    g.x += g.vx * DT; g.y += g.vy * DT; g.a += g.va * DT;
    const floor = floorAt(g.x) - hh;
    if (g.y > floor) {
      g.y = floor;
      g.vy = g.vy > 120 ? -g.vy * 0.35 : 0;
      g.vx *= 0.86;
      g.va *= 0.5;
      g.a += (Math.round(g.a / Math.PI) * Math.PI - g.a) * 0.25; // settle flat, or upside down
    }
    if (g.y < hh) { g.y = hh; g.vy = Math.abs(g.vy) * 0.4; }
    if (g.x < hw) { g.x = hw; g.vx = Math.abs(g.vx) * 0.5; }
    if (g.x > W - hw) { g.x = W - hw; g.vx = -Math.abs(g.vx) * 0.5; }
    // The owner bumps into them: back on they go.
    const c = b.body.centroid();
    if (time - g.since > 0.6 && !b.merging && Math.hypot(g.x - c.x, g.y - c.y) < b.body.o.radius * 0.95) wearGlasses(b);
  }

  function wearGlasses(b) {
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

  // Extra high effort, thinking: floats above the ground like it's meditating.
  function levitate(b) {
    const body = b.body, c = body.centroid(), r = body.o.radius, v = body.velocity(DT);
    const target = floorAt(c.x) - r - CFG.levitateHeight + Math.sin(time * 1.6 + b.born * 3) * 8;
    const ay = -CFG.gravity + (target - c.y) * 16 - v.y * 4.5;
    const ax = -v.x * 2.5;
    body.impulse(ax * DT, ay * DT, DT);
  }

  // While splitting, a goo strand ties the new slime to the big one: a
  // spring whose rest length grows and whose strength fades until it snaps.
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

  // Slimes that are splitting off or merging into the big one overlap it freely.
  function passThrough(a, b) {
    const pair = (x, y) => x.isMain && (y.splitting || y.merging || y.dying);
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

    const g = b.glasses;
    if (g) {
      // Lost its glasses: hop over to them (or wait while you hold them).
      if (!g.held) {
        const dx = g.x - b.body.centroid().x;
        b.hop(Math.sign(dx) * Math.min(520, Math.abs(dx) * 2 + 90), -340 - Math.min(400, Math.max(0, b.body.centroid().y - g.y) * 1.6));
      }
      b.nextHop = time + 0.9 + Math.random() * 0.4;
      return;
    }

    const st = b.isMain ? aggregateState() : b.state;
    const unseen = b.session && !b.session.seen;
    if (st === 'waiting' && (b.isMain || unseen)) {
      b.hop(0, -CFG.waitingHopStrength);
      b.nextHop = time + 2.2;
    } else if (st === 'done' && unseen && !b.isMain) {
      // Finished: bounce up and down until someone clicks it.
      b.hop((Math.random() - 0.5) * 60, -CFG.doneHopStrength);
      b.nextHop = time + CFG.doneHopEvery;
    } else if (st === 'working' && (b.effort === 'low' || b.effort === 'xhigh')) {
      // Zoned out, or deep in meditation: no fidgeting.
      b.nextHop = time + 1;
    } else if (st === 'working') {
      // Deep concentration: mostly still, with the odd wobble.
      b.hop((Math.random() - 0.5) * 120, -140);
      b.nextHop = time + 3 + Math.random() * 3;
    } else if (CFG.idleHopEvery > 0) {
      const k = CFG.idleHopStrength;
      b.hop((Math.random() - 0.5) * k * 1.4, -k * (0.8 + Math.random() * 0.4));
      b.nextHop = time + CFG.idleHopEvery * (0.6 + Math.random() * 0.8);
    } else {
      b.nextHop = time + 1;
    }
  }

  function faceFor(b) {
    const st = b.isMain ? aggregateState() : b.state;
    const body = b.body;
    const v = body.velocity(DT);
    const speed = Math.hypot(v.x, v.y);
    let expression = 'normal', mouth = 'smile';
    if (time < b.dizzyUntil) { expression = 'dizzy'; mouth = 'flat'; }
    else if (body.grab) { mouth = 'o'; }
    else if (speed > 900 && !body.onFloor()) { mouth = 'grin'; }
    else if (time < b.happyUntil) { expression = 'happy'; mouth = 'grin'; }
    else if (st === 'waiting') { expression = 'worried'; mouth = 'o'; }
    else if (st === 'done' && b.session && !b.session.seen) { expression = 'happy'; mouth = 'grin'; }
    else if (st === 'working' && !b.isMain) { expression = 'concentrate'; mouth = 'flat'; }
    else if (st === 'idle' && time - mouse.lastMove > 120) { expression = 'sleepy'; mouth = 'flat'; }
    const effort = b.isMain ? 'medium' : b.effort;
    const working = st === 'working' && !b.isMain;
    let drool = null;
    if (effort === 'low' && expression !== 'dizzy' && !body.grab) {
      if (working) { mouth = 'slack'; drool = ((time - b.born) / 4.5) % 1; }
      else if (mouth === 'smile') mouth = 'flat';
    }
    if (effort === 'xhigh' && expression !== 'dizzy') mouth = mouth === 'o' || mouth === 'grin' ? mouth : 'smile';
    return {
      expression, mouth, blink: b.blink, look: mouse, scale: CFG.faceScale,
      effort, working, drool,
      glasses: effort === 'high' && !b.glasses,
      squint: effort === 'high' && !!b.glasses && expression === 'normal',
    };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const list = [...buddies.values()].sort((a, b) => (a.isMain ? -1 : 0) - (b.isMain ? -1 : 0));
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
      const unseen = b.session && !b.session.seen && (b.state === 'waiting' || b.state === 'done');
      const zen = b.effort === 'xhigh' && b.state === 'working' && !b.isMain && !b.dying;
      const glow = unseen && CFG.glow ? D.STATE_COLORS[b.state] : zen ? '#ffffff' : null;
      D.drawBody(ctx, b.body, b.color, { glow, outline: CFG.outline });
      if (b.body.o.radius > 12) D.drawFace(ctx, b.body, faceFor(b));
      const st = b.isMain ? aggregateState() : b.state;
      if (zen) D.drawMotes(ctx, b.body, time);
      else if (st === 'working' && !b.isMain && !b.dying && b.effort !== 'low') D.drawThinking(ctx, b.body, time);
      if (!b.isMain && !b.dying) {
        if (b.state === 'done' && b.session && !b.session.seen) D.drawExclaim(ctx, b.body, time, D.STATE_COLORS.done);
        else D.drawDots(ctx, b.body, [b.state], time);
        D.drawLabel(ctx, b.body, label(b));
      }
    }
    for (const b of list) if (b.glasses) D.drawGlasses(ctx, b.glasses.x, b.glasses.y, b.glasses.r, b.glasses.a);
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
    const list = [...buddies.values()].filter((b) => !b.dying);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].body.contains(x, y)) return list[i];
    // Children drawn on top win; main is checked last.
    return null;
  }

  function updateIgnore() {
    const want = !(drag || buddyAt(mouse.x, mouse.y) || glassesAt(mouse.x, mouse.y));
    if (want !== ignoring) {
      ignoring = want;
      api.setIgnoreMouse(want);
    }
  }

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.lastMove = performance.now() / 1000;
    if (drag && drag.glasses) {
      drag.glasses.x = e.clientX;
      drag.glasses.y = e.clientY;
    } else if (drag) {
      drag.buddy.body.moveGrab(e.clientX, e.clientY);
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
    }
    updateIgnore();
  });

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const owner = glassesAt(e.clientX, e.clientY);
    if (owner) {
      const g = owner.glasses;
      g.held = true;
      g.x = g.lx = e.clientX; g.y = g.ly = e.clientY;
      g.vx = g.vy = g.va = 0;
      drag = { glasses: g, owner };
      return;
    }
    const b = buddyAt(e.clientX, e.clientY);
    if (!b) return;
    drag = { buddy: b, x0: e.clientX, y0: e.clientY, t0: time, moved: false };
    b.body.startGrab(e.clientX, e.clientY);
    if (b.merging) b.merging.since = time; // being held resets the trip home
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !drag) return;
    if (drag.glasses) {
      const { glasses: g, owner } = drag;
      g.held = false;
      g.since = time;
      g.va = (Math.random() - 0.5) * 10;
      // Handing them back: drop them on their owner.
      if (owner.glasses === g && owner.body.contains(g.x, g.y)) wearGlasses(owner);
      drag = null;
      updateIgnore();
      return;
    }
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
    if (b.isMain && e.altKey) api.openTuning();
    else if (b.isMain) api.showAppMenu();
    else api.showSessionMenu(b.key);
  });

  function click(b) {
    if (b.isMain) {
      b.say(summaryLines(), 5);
      api.acknowledge(null);
    } else {
      // Clicking a slime opens its session.
      api.acknowledge(b.key);
      api.openSession(b.key);
    }
    b.hop(0, -300);
  }

  // --- Wiring -------------------------------------------------------------

  api.onState((s) => {
    settings = s.settings || settings;
    syncSessions(s.sessions || []);
  });

  api.onConfig(applyConfig);
  api.onWorld((w) => setObstacles(w.obstacles));

  api.onCommand((cmd) => {
    const m = main();
    if (cmd === 'come-here') {
      for (const b of buddies.values()) b.body.teleport(W / 2 + (Math.random() - 0.5) * 200, H / 3);
    } else if (cmd === 'hop') {
      for (const b of buddies.values()) b.hop((Math.random() - 0.5) * 600, -900);
    } else if (cmd === 'hello') {
      m.say(summaryLines(), 6);
    }
  });

  window.addEventListener('resize', resize);
  resize();
  buddies.set('main', new Buddy('main', W * 0.8, H * 0.5, CFG.mainRadius));
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
