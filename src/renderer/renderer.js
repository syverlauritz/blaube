// Blaube's stage: a full-screen transparent canvas with one big slime (the
// orchestrator) that splits off a small slime for each Claude Code session
// and absorbs it again when the session ends.
(function () {
  'use strict';

  const { SoftBody, collideBodies, BlaubeDraw: D } = globalThis;

  const api = window.blaube || devShim();
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const DT = 1 / 120;
  const MAIN_R = 62;
  const CHILD_R = 30;
  const MAIN_MIN_R = 40;
  const MAIN_HUE = 212;
  const SPLIT_TIME = 0.55;

  let W = 0, H = 0;
  let mouse = { x: -1e4, y: -1e4, lastMove: performance.now() / 1000 };
  let drag = null; // { buddy, x0, y0, t0, moved }
  let ignoring = null;
  let settings = { hooksInstalled: true };
  let time = 0;

  class Buddy {
    constructor(key, x, y, r, hue, session) {
      this.key = key;
      this.isMain = key === 'main';
      this.body = new SoftBody(x, y, { radius: r, points: this.isMain ? 32 : 22 });
      this.body.setBounds(0, 0, W, H);
      this.hue = hue;
      this.targetR = r;
      this.session = session || null;
      this.state = session ? session.state : 'idle';
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

  function hueFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return MAIN_HUE + ((h % 5) - 2) * 18;
  }

  function mainRadius() {
    let children = 0;
    for (const b of buddies.values()) if (!b.isMain && !b.dying) children++;
    return Math.max(MAIN_MIN_R, Math.sqrt(MAIN_R * MAIN_R - 0.5 * children * CHILD_R * CHILD_R));
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
    const b = new Buddy(session.id, c.x + side * r * 0.35, c.y - r * 0.15, CHILD_R * 0.45, hueFor(session.id), session);
    b.targetR = CHILD_R;
    b.parent = m;
    b.state = 'idle';
    buddies.set(session.id, b);
    b.hop(side * 520, -760);
    m.hop(-side * 140, -180);
    return b;
  }

  function react(b, prev) {
    switch (b.state) {
      case 'working':
        if (prev !== 'waiting') b.hop((Math.random() - 0.5) * 120, -320);
        if (b.bubble && b.bubble.sticky) b.bubble = null;
        break;
      case 'waiting':
        b.hop(0, -650);
        b.say([{ text: `${label(b)} needs you`, color: D.STATE_COLORS.waiting }, { text: b.session.message || 'Waiting for you' }], 1e9, true);
        break;
      case 'done':
        b.hop((Math.random() - 0.5) * 200, -820);
        b.happyUntil = time + 2.5;
        b.nextHop = time + 0.8;
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
      body.areaScale = 1 + 0.025 * Math.sin(time * 2.2 + b.born * 3);
      body.step(DT);
      if (b.splitting) pullStrand(b);
      if (body.lastImpact > 2300) b.dizzyUntil = time + 0.9;

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

    const st = b.isMain ? aggregateState() : b.state;
    const unseen = b.session && !b.session.seen;
    if (st === 'waiting' && (b.isMain || unseen)) {
      b.hop(0, -560);
      b.nextHop = time + 2.2;
    } else if (st === 'done' && unseen && !b.isMain) {
      // Finished: bounce up and down until someone clicks it.
      b.hop((Math.random() - 0.5) * 60, -700);
      b.nextHop = time + 0.75;
    } else if (st === 'working') {
      // Deep concentration: mostly still, with the odd wobble.
      b.hop((Math.random() - 0.5) * 120, -140);
      b.nextHop = time + 3 + Math.random() * 3;
    } else {
      b.hop((Math.random() - 0.5) * 700, -420 - Math.random() * 200);
      b.nextHop = time + 10 + Math.random() * 15;
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
    return { expression, mouth, blink: b.blink, look: mouse };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const list = [...buddies.values()].sort((a, b) => (a.isMain ? -1 : 0) - (b.isMain ? -1 : 0));
    for (const b of list) D.drawShadow(ctx, b.body);

    // Goo bridge while a slime is splitting off.
    for (const b of list) {
      if (!b.splitting) continue;
      const p = (time - b.born) / SPLIT_TIME;
      const a = b.parent.body.centroid(), c = b.body.centroid();
      ctx.save();
      ctx.strokeStyle = `hsl(${b.parent.hue} 92% 60%)`;
      ctx.lineCap = 'round';
      const thin = Math.min(1, (b.parent.body.o.radius + b.body.o.radius) / (Math.hypot(c.x - a.x, c.y - a.y) || 1));
      ctx.lineWidth = CHILD_R * 1.2 * (1 - p) ** 1.5 * thin;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + c.x) / 2, Math.max(a.y, c.y) + 10, c.x, c.y);
      ctx.stroke();
      ctx.restore();
    }

    for (const b of list) {
      const unseen = b.session && !b.session.seen && (b.state === 'waiting' || b.state === 'done');
      const glow = unseen ? D.STATE_COLORS[b.state] : null;
      D.drawBody(ctx, b.body, b.hue, glow);
      if (b.body.o.radius > 12) D.drawFace(ctx, b.body, faceFor(b));
      const st = b.isMain ? aggregateState() : b.state;
      if (st === 'working' && !b.isMain && !b.dying) D.drawThinking(ctx, b.body, time);
      if (!b.isMain && !b.dying) {
        if (b.state === 'done' && b.session && !b.session.seen) D.drawExclaim(ctx, b.body, time, D.STATE_COLORS.done);
        else D.drawDots(ctx, b.body, [b.state], time);
        D.drawLabel(ctx, b.body, label(b));
      }
    }
    for (const b of list) {
      if (b.bubble) D.drawBubble(ctx, b.body, b.bubble.lines, Math.min(1, (b.bubble.until - time) * 3), W);
    }
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
    if (b.isMain) api.showAppMenu();
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
  buddies.set('main', new Buddy('main', W * 0.75, H - MAIN_R - 10, MAIN_R, MAIN_HUE));
  api.setIgnoreMouse(true);
  ignoring = true;
  api.ready();
  requestAnimationFrame(frame);

  // Lets the renderer run in a plain browser for development and screenshots.
  function devShim() {
    const listeners = { state: [], command: [] };
    window.__blaube = {
      setState: (s) => listeners.state.forEach((f) => f(s)),
      command: (c) => listeners.command.forEach((f) => f(c)),
      buddies: () => buddies,
    };
    return {
      setIgnoreMouse() {},
      acknowledge() {},
      showAppMenu() {},
      showSessionMenu() {},
      openSession() {},
      ready() {},
      onState: (f) => listeners.state.push(f),
      onCommand: (f) => listeners.command.push(f),
    };
  }
})();
