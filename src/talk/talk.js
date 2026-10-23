// The talk box: a session's conversation since Blaube started, a field to
// send it a message, and its permission prompts (see src/main/inbox.js).
(function () {
  'use strict';
  const api = window.blaubeTalk;
  const $ = (id) => document.getElementById(id);
  const text = $('text'), send = $('send'), log = $('log'), inner = $('inner');
  // The same words and colours as the slime's hover bubble (renderer.js, face.js).
  const WORDS = { working: 'Working', waiting: 'Needs you', done: 'Done', idle: 'Idle' };
  const DOTS = { working: '#f5a623', waiting: '#ff4d6d', done: '#2ecc71', idle: '#a0aec0' };
  const MAX = 4000; // longer replies are cut, with a way to the rest
  let current = null, shown = '', askKey = 0, seen = 0;
  const drafts = new Map(); // what you'd typed, per session
  const open = new Set(); // long replies you unfolded (by time)

  // A pale wash of the slime's colour.
  function tint(hex, k) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    if (Number.isNaN(n)) return '#fbeee8';
    const mix = (c) => Math.round(c + (255 - c) * (1 - k));
    return `rgb(${mix(n >> 16 & 255)}, ${mix(n >> 8 & 255)}, ${mix(n & 255)})`;
  }

  // WCAG contrast between two colours.
  function contrast(a, b) {
    const lum = (hex) => {
      const n = parseInt(String(hex).replace('#', ''), 16);
      const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  // The tail points at the slime: from the bottom edge (box above it) or
  // the left or right edge (box beside it), `at` px along that edge. The
  // box pops open from there.
  function placeTail(tail) {
    const t = $('tail'), path = t.firstElementChild, root = document.documentElement.style;
    document.body.className = tail.side;
    if (tail.side !== 'bottom') {
      const left = tail.side === 'left';
      t.setAttribute('viewBox', '0 0 23 18');
      path.setAttribute('d', left ? 'M23 0 Q11 6 0 9 Q11 12 23 18 Z' : 'M0 0 Q12 6 23 9 Q12 12 0 18 Z');
      t.style.left = ''; t.style.top = tail.at + 'px';
      root.setProperty('--ox', left ? '0px' : '100%'); root.setProperty('--oy', tail.at + 'px');
    } else {
      t.setAttribute('viewBox', '0 0 18 23');
      path.setAttribute('d', 'M0 0 Q6 12 9 23 Q12 12 18 0 Z');
      t.style.top = ''; t.style.left = tail.at + 'px';
      root.setProperty('--ox', tail.at + 'px'); root.setProperty('--oy', '100%');
    }
  }

  function hint(s) {
    if (s.demo) return 'Demo slimes can’t talk back. Try a real session!';
    if (s.ask) return '';
    if (!s.connected) return 'Update the Claude Code connection in Blaube’s menu, then restart this session to talk to it.';
    // Queued, nobody waiting, and the turn is over (interrupted, say): it
    // only gets it when it next finishes a turn.
    if (s.queued && s.inbox !== 'ready' && s.state !== 'working' && s.inbox !== 'unknown') return `${s.project} gets this when it next finishes a turn. In a hurry? Go to its terminal.`;
    // Never heard from its inbox: it may not be able to hear you at all.
    if (s.inbox === 'unknown' && (s.queued || s.state !== 'working')) return `Haven’t heard from ${s.project} yet. If it doesn’t pick this up, restart the session.`;
    // Busy needs no words: the header says "working", and anything you
    // send is marked as waiting for the end of the turn.
    return '';
  }

  // A little Markdown, built as elements (never as HTML): code blocks,
  // `code`, **bold**, headings and bullets.
  function rich(el, src) {
    const parts = src.split(/^```[^\n]*\n?/m);
    parts.forEach((part, i) => {
      if (i % 2) {
        const pre = document.createElement('pre');
        pre.textContent = part.replace(/\n$/, '');
        el.append(pre);
        return;
      }
      const lines = part.replace(/^\n+|\n+$/g, '').split('\n');
      lines.forEach((line, j) => {
        let l = line, head = false;
        if (/^#{1,6}\s/.test(l)) { l = l.replace(/^#+\s*/, ''); head = true; }
        l = l.replace(/^(\s*)[-*+]\s+/, '$1• ');
        const span = document.createElement('span');
        if (head) span.className = 'head';
        for (const bit of l.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/)) {
          if (!bit) continue;
          if (bit[0] === '`') { const c = document.createElement('code'); c.textContent = bit.slice(1, -1); span.append(c); }
          else if (bit.startsWith('**')) { const b = document.createElement('b'); b.textContent = bit.slice(2, -2); span.append(b); }
          else span.append(bit);
        }
        el.append(span);
        if (j < lines.length - 1) el.append('\n');
      });
    });
  }

  function message(m, fresh) {
    if (m.who === 'note') {
      const e = document.createElement('div');
      e.className = 'note';
      e.textContent = m.text;
      return [e];
    }
    const e = document.createElement('div');
    e.className = 'msg ' + m.who + (m.status === 'queued' ? ' queued' : '') + (fresh ? ' new' : '');
    e.dataset.at = m.at;
    const cut = m.text.length > MAX;
    rich(e, cut ? m.text.slice(0, MAX) : m.text);
    const out = [e];
    if (cut) {
      const more = document.createElement('button');
      more.className = 'more';
      more.textContent = '…the rest is in the terminal ↗';
      more.onclick = () => api.terminal();
      out.push(more);
    }
    if (m.status === 'queued') {
      const t = document.createElement('div');
      t.className = 'meta';
      t.textContent = current.inbox === 'unknown' ? `waiting for ${current.project} to pick this up · ` : 'after its turn · ';
      const undo = document.createElement('button');
      undo.className = 'unsend';
      undo.textContent = 'unsend';
      undo.onclick = () => api.unsend(current.id, m.n);
      t.append(undo);
      out.push(t);
    }
    if (m.via === 'terminal') e.title = 'Typed in the terminal';
    return out;
  }

  function render(s) {
    const switched = !current || current.id !== s.id;
    current = s;
    $('name').textContent = s.project;
    $('name').title = s.project;
    $('state').textContent = WORDS[s.state] || s.state;
    $('dot').style.background = DOTS[s.state] || DOTS.idle;
    // A long name in a display font gets hard to read: plain font then.
    $('name').classList.toggle('plain', s.project.length > 16);
    const root = document.documentElement.style;
    const color = s.color || '#d97757';
    root.setProperty('--color', color);
    root.setProperty('--tint', tint(color, 0.11));
    root.setProperty('--wash', tint(color, 0.24));
    root.setProperty('--faint', tint(color, 0.45));
    // White on the slime's colour only where it reads; ink otherwise.
    root.setProperty('--on', contrast(color, '#ffffff') >= 4.5 ? '#fff' : '#1b2440');
    if (s.font) {
      root.setProperty('--name', s.font === 'System' ? 'var(--ui)' : `"${s.font}", var(--ui)`);
      root.setProperty('--nameWeight', s.font === 'System' || s.font === 'DynaPuff' ? '700' : '400');
    }
    if (s.tail) placeTail(s.tail);
    $('terminal').style.display = s.demo ? 'none' : '';
    renderAsk(s.ask, s.asks);
    $('hint').textContent = hint(s);
    text.disabled = !!s.demo || !s.connected;
    text.placeholder = s.state === 'working' ? 'Say something for later…' : 'Say something…';
    send.disabled = text.disabled || !text.value.trim();
    // The slime's dots while it works on something you said: after the
    // last thing it got (anything still queued comes after them).
    let thinking = -1;
    if (s.state === 'working') {
      for (let i = s.log.length - 1; i >= 0 && s.log[i].who !== 'claude'; i--) {
        if (s.log[i].who === 'you' && s.log[i].status !== 'queued') { thinking = i; break; }
      }
    }
    // Only rebuild the log when it changed, so scrolling isn't reset; and not
    // while you're selecting text in it (it catches up after).
    const key = s.id + JSON.stringify(s.log) + thinking + [...open].join();
    const sel = window.getSelection();
    const selecting = !switched && sel && !sel.isCollapsed && log.contains(sel.anchorNode);
    if (key !== shown && !selecting) {
      shown = key;
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      inner.textContent = '';
      if (!s.log.length) {
        const e = document.createElement('div');
        e.className = 'empty';
        e.textContent = `Say hi to ${s.project}! It hears you even when you’re not at its terminal.`;
        inner.append(e);
      }
      const dots = document.createElement('div');
      dots.className = 'dots';
      dots.innerHTML = '<i></i><i></i><i></i>';
      if (!switched && s.log.slice(seen).some((m) => m.who === 'claude')) {
        const w = $('wrap');
        w.classList.remove('boing'); void w.offsetWidth; w.classList.add('boing');
      }
      s.log.forEach((m, i) => {
        inner.append(...message(m, !switched && i >= seen));
        if (i === thinking) inner.append(dots);
      });
      seen = s.log.length;
      // Long replies fold, with Show more (by how tall they are).
      for (const e of inner.querySelectorAll('.msg.claude')) {
        const at = Number(e.dataset.at);
        if (e.offsetHeight < 280 || open.has(at)) continue;
        e.classList.add('folded');
        const more = document.createElement('button');
        more.className = 'more';
        more.textContent = 'Show more';
        more.onclick = () => { open.add(at); shown = ''; render(current); };
        e.after(more);
      }
      if (atBottom || switched) log.scrollTop = log.scrollHeight;
    }
    fitWindow(); // reading sizes lays it out, even while hidden
  }

  function renderAsk(ask, count) {
    const card = $('ask');
    card.hidden = !ask;
    if (!ask) { askKey = 0; return; }
    if (ask.key !== askKey) {
      // A new question: make it look new, and don't let a double-click
      // that answered the last one answer this one too.
      askKey = ask.key;
      card.classList.remove('new'); void card.offsetWidth; card.classList.add('new');
      for (const b of card.querySelectorAll('button')) b.disabled = true;
      setTimeout(() => { if (askKey === ask.key) for (const b of card.querySelectorAll('button')) b.disabled = false; }, 450);
    }
    $('askWhat').textContent = `Can I use ${ask.tool}?`;
    $('askMore').textContent = count > 1 ? `+${count - 1} more after this` : '';
    $('askDetail').textContent = ask.detail || '';
    $('askDetail').hidden = !ask.detail;
    $('always').textContent = ask.always || '';
    $('always').title = ask.alwaysFull || '';
    $('always').hidden = !ask.always;
  }

  // The window hugs what's in it (the app keeps it between a min and max,
  // and adds room for the tail on whichever side it goes).
  function fitWindow() {
    if (!current) return;
    const bubble = document.querySelector('.bubble');
    const chrome = bubble.offsetHeight - log.clientHeight; // everything but the log
    const pad = parseFloat(getComputedStyle(log).paddingTop) + parseFloat(getComputedStyle(log).paddingBottom);
    api.setHeight(current.id, Math.ceil(chrome + inner.offsetHeight + pad + 24 + 1)); // 24: room round the bubble
  }

  // When the log gets shorter (a permission card, a taller field), keep the
  // newest message in view if it was.
  let pinned = true;
  // The top fades only once there's something scrolled away under it.
  log.addEventListener('scroll', () => {
    pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.classList.toggle('scrolled', log.scrollTop > 2);
  });
  new ResizeObserver(() => { if (pinned) log.scrollTop = log.scrollHeight; }).observe(log);

  function fit() {
    text.style.height = 'auto';
    text.style.height = Math.min(104, text.scrollHeight) + 'px';
    text.style.overflowY = text.scrollHeight > 104 ? 'auto' : 'hidden';
  }

  api.onState((s) => {
    const first = !current || current.id !== s.id;
    if (first && current) drafts.set(current.id, text.value);
    if (first) seen = s.log.length;
    render(s);
    if (first) { text.value = drafts.get(s.id) || ''; fit(); send.disabled = s.demo || !text.value.trim(); }
    if (s.focus) {
      const w = $('wrap');
      w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop');
      text.focus();
    }
  });
  // Beside the slime the bubble is narrower (the tail takes room), so text
  // wraps differently: measure again.
  if (api.onTail) api.onTail((t) => { placeTail(t); fitWindow(); });
  text.addEventListener('input', () => { fit(); send.disabled = !current || current.demo || !text.value.trim(); requestAnimationFrame(fitWindow); });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form').requestSubmit(); }
  });
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = text.value.trim();
    if (!v || !current || current.demo) return;
    api.send(current.id, v);
    text.value = '';
    drafts.delete(current.id);
    fit();
    send.disabled = true;
    pinned = true;
    log.scrollTop = log.scrollHeight;
  });
  // Closing shrinks it back into its tail, then hides it.
  let closing = false;
  function close() {
    if (closing) return;
    closing = true;
    const w = $('wrap');
    w.classList.remove('pop', 'boing');
    w.classList.add('shut');
    setTimeout(() => { api.close(); w.classList.remove('shut'); closing = false; }, 170);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.isComposing) close(); });
  $('close').addEventListener('click', close);
  $('terminal').addEventListener('click', () => api.terminal());
  const decide = (choice) => () => {
    if (!askKey) return;
    api.decide(current.id, askKey, choice);
    $('ask').hidden = true;
    askKey = 0;
    text.focus();
  };
  $('allow').addEventListener('click', decide('allow'));
  $('deny').addEventListener('click', decide('deny'));
  $('always').addEventListener('click', decide('always'));
})();
