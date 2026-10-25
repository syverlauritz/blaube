// The talk box: a session's conversation since Blaube started, a field to
// send it a message, and its permission prompts (see src/main/inbox.js).
(function () {
  'use strict';
  const api = window.blaubeTalk;
  const $ = (id) => document.getElementById(id);
  const text = $('text'), send = $('send'), log = $('log'), inner = $('inner');
  // The same words and colours as the slime's hover bubble (renderer.js, face.js).
  const WORDS = { working: 'Working', waiting: 'Needs you', done: 'Done', idle: 'Idle', ended: 'Ended' };
  const DOTS = { working: '#f5a623', waiting: '#ff4d6d', done: '#2ecc71', idle: '#a0aec0', ended: '#c3c8d2' };
  const MAX = 4000; // longer replies are cut, with a way to the rest
  let current = null, askKey = 0, seen = 0;
  let drawn = { entries: [], thinking: -1, open: '' }, ends = []; // what the log shows, and each entry's last element
  const dots = document.createElement('div'); // the slime thinking
  dots.className = 'dots';
  dots.innerHTML = '<i></i><i></i><i></i>';
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

  // The box pops open from (and shrinks back into) the edge its tail leaves
  // from, `at` px along it (the tail itself is drawn by the slime's layer).
  function placeTail(tail) {
    const root = document.documentElement.style;
    if (tail.side === 'bottom') { root.setProperty('--ox', tail.at + 'px'); root.setProperty('--oy', '100%'); }
    else { root.setProperty('--ox', tail.side === 'left' ? '0px' : '100%'); root.setProperty('--oy', tail.at + 'px'); }
  }

  function hint(s) {
    if (s.demo) return 'Demo slimes can’t talk back. Try a real session!';
    if (s.ended) return (s.log.some((m) => m.status === 'unsent') ? `${s.project} has ended, so what you sent last didn’t go in.` : `${s.project} has ended.`) + ' Right-click its slime next time to resume it in a new terminal.';
    if (s.owned) return s.log.length ? '' : 'Started by Blaube. Right-click me to end it or move it to a terminal.';
    if (s.ask) return '';
    if (!s.connected && !s.typeable) return 'Connect Claude Code from Blaube’s menu, then restart this session to talk to it.';
    // Queued, nobody waiting, and the turn is over (interrupted, say): it
    // only gets it when it next finishes a turn.
    if (s.queued && s.inbox !== 'ready' && s.state !== 'working' && s.inbox !== 'unknown') return `${s.project} gets this when it next finishes a turn. In a hurry? Go to its terminal.`;
    // Never heard from its inbox: it may not be able to hear you at all.
    if (s.inbox === 'unknown' && s.typeable) return s.queued ? `${s.project} started before Blaube could talk to it, so Blaube will type this into its terminal as soon as it’s free.` : '';
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

  // A step goes into the run of steps it follows (or starts one). A run
  // shows its last SHOWN; the earlier ones fold behind "N more".
  const SHOWN = 3;
  const openRuns = new Set(); // runs you unfolded (by their first step's n)
  const openSteps = new Set(); // steps you opened (by n)
  function addStep(m, fresh) {
    let run = inner.lastElementChild;
    if (!run || !run.classList.contains('steps')) {
      run = document.createElement('div');
      run.className = 'steps';
      run.dataset.first = m.n;
      if (openRuns.has(m.n)) run.classList.add('open');
      const more = document.createElement('button');
      more.className = 'earlier';
      more.hidden = true;
      more.onclick = () => {
        const open = run.classList.toggle('open');
        if (open) openRuns.add(Number(run.dataset.first)); else openRuns.delete(Number(run.dataset.first));
        label();
      };
      const label = () => {
        const early = run.querySelectorAll('.step.early').length;
        more.hidden = !early;
        more.textContent = run.classList.contains('open') ? 'fewer steps' : `${early} more step${early === 1 ? '' : 's'}`;
      };
      run.relabel = label;
      run.append(more);
      inner.append(run);
    }
    // A step with more to it opens on a tap: the change, the output.
    const e = document.createElement(m.detail ? 'button' : 'div');
    e.className = 'step' + (m.ok === false ? ' failed' : '') + (fresh ? ' new' : '') + (m.detail ? ' opens' : '');
    e.textContent = m.text + (m.ok === false ? ' (failed)' : '');
    e.title = m.text;
    run.append(e);
    if (m.detail) {
      const pre = document.createElement('pre');
      pre.className = 'stepout';
      pre.textContent = m.detail;
      const shown = () => openSteps.has(m.n);
      pre.hidden = !shown();
      e.classList.toggle('open', shown());
      e.onclick = () => {
        if (shown()) openSteps.delete(m.n); else openSteps.add(m.n);
        pre.hidden = !shown();
        e.classList.toggle('open', shown());
        // Opening one shows it, even from the folded part of a run.
        if (shown() && e.classList.contains('early')) { run.classList.add('open'); openRuns.add(Number(run.dataset.first)); run.relabel(); }
      };
      e.after(pre);
    }
    const rows = run.querySelectorAll('.step');
    if (rows.length > SHOWN) rows[rows.length - SHOWN - 1].classList.add('early');
    run.relabel();
    return run;
  }

  function message(m, fresh) {
    if (m.who === 'note') {
      const e = document.createElement('div');
      e.className = 'note';
      e.textContent = m.text;
      return [e];
    }
    const e = document.createElement('div');
    e.className = 'msg ' + m.who + (m.status === 'queued' || m.status === 'unsent' ? ' ' + m.status : '') + (fresh ? ' new' : '');
    e.dataset.at = m.at;
    const cut = m.text.length > MAX && !current.owned; // a session Blaube started has nowhere else to read it
    rich(e, cut ? m.text.slice(0, MAX) : m.text);
    const out = [e];
    if (cut) {
      const more = document.createElement('button');
      more.className = 'more';
      more.textContent = '…the rest is in the terminal ↗';
      more.onclick = () => api.terminal();
      out.push(more);
    }
    if (m.status === 'unsent') {
      const t = document.createElement('div');
      t.className = 'meta';
      t.textContent = 'not sent';
      out.push(t);
    }
    if (m.status === 'queued') {
      const t = document.createElement('div');
      t.className = 'meta';
      t.textContent = current.inbox === 'unknown' ? (current.typeable ? 'goes in when it’s free · ' : `waiting for ${current.project} to pick this up · `)
        : current.stoppable && current.state === 'working' && !current.stopping ? 'at its next step · ' : 'after its turn · ';
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
    // White on the slime's colour only where it reads; ink otherwise.
    root.setProperty('--on', contrast(color, '#ffffff') >= 4.5 ? '#fff' : '#1b2440');
    if (s.font) {
      root.setProperty('--name', s.font === 'System' ? 'var(--ui)' : `"${s.font}", var(--ui)`);
      root.setProperty('--nameWeight', s.font === 'System' || s.font === 'DynaPuff' ? '700' : '400');
    }
    if (s.tail) placeTail(s.tail);
    $('terminal').style.display = s.demo || s.ended || s.owned ? 'none' : '';
    const stop = $('stop');
    stop.hidden = !(s.stoppable && s.state === 'working' && !s.ended);
    stop.disabled = !!s.stopping;
    stop.lastChild.textContent = s.stopping ? 'Stopping…' : 'Stop';
    renderTodo(s);
    renderAsk(s.ask, s.asks);
    $('hint').textContent = hint(s);
    text.disabled = !!s.demo || (!s.connected && !s.typeable) || !!s.ended;
    text.placeholder = s.ask && s.ask.kind === 'question' ? (s.ask.questions.length === 1 ? 'Or type your answer…' : 'Say something for later…')
      : s.ask && s.ask.kind === 'plan' ? 'What should change?'
      : !s.owned && s.state === 'working' && s.stoppable && !s.stopping ? 'Add something…'
      : !s.owned && (s.state === 'working' || s.state === 'waiting') ? 'Say something for later…' : 'Say something…';
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
    // Only what changed is drawn: new entries are added at the end, so
    // scrolling, text you're selecting and replies you unfolded stay put.
    // Anything else (another session, a status change) redraws it all, but
    // never while you're selecting text in it (it catches up after).
    const entries = s.log.map((m) => JSON.stringify(m));
    if (!s.log.length) entries.push(s.ask ? 'asking' : 'empty'); // the greeting comes and goes with a card
    const openKey = [...open].join();
    const sel = window.getSelection();
    const selecting = !switched && sel && !sel.isCollapsed && log.contains(sel.anchorNode);
    const extends_ = !switched && openKey === drawn.open && drawn.entries.length > 0 && entries.length >= drawn.entries.length
      && drawn.entries.every((j, i) => j === entries[i]);
    const changed = switched || !extends_ || entries.length !== drawn.entries.length || thinking !== drawn.thinking;
    if (changed && (!selecting || switched)) {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      const from = extends_ ? drawn.entries.length : 0;
      dots.remove();
      if (!extends_) {
        inner.textContent = '';
        ends = [];
        if (!s.log.length && !s.ask && (s.connected || s.typeable || s.owned)) {
          const e = document.createElement('div');
          e.className = 'empty';
          e.textContent = s.owned ? `What should we do in ${s.project}?` : `Say hi to ${s.project}! It hears you even when you’re not at its terminal.`;
          inner.append(e);
        }
      } else if (from === 0) inner.textContent = '';
      for (let i = from; i < s.log.length; i++) {
        if (s.log[i].who === 'step') { ends[i] = addStep(s.log[i], !switched && i >= seen); continue; }
        const nodes = message(s.log[i], !switched && i >= seen);
        inner.append(...nodes);
        ends[i] = nodes[nodes.length - 1];
      }
      // (After the steps it has taken since, too.)
      let after = thinking;
      for (let i = thinking + 1; thinking >= 0 && i < s.log.length; i++) if (s.log[i].status !== 'queued') after = i;
      if (after >= 0 && ends[after]) ends[after].after(dots);
      if (!switched && s.log.slice(seen).some((m) => m.who === 'claude')) {
        const w = $('wrap');
        w.classList.remove('boing'); void w.offsetWidth; w.classList.add('boing');
      }
      seen = s.log.length;
      // Long replies fold, with Show more (by how tall they are).
      for (const e of inner.querySelectorAll('.msg.claude:not([data-measured])')) {
        e.dataset.measured = '1';
        const at = Number(e.dataset.at);
        if (e.offsetHeight < 280 || open.has(at)) continue;
        e.classList.add('folded');
        const more = document.createElement('button');
        more.className = 'more';
        more.textContent = 'Show more';
        more.onclick = () => { open.add(at); drawn.entries = []; render(current); };
        e.after(more);
      }
      drawn = { entries, thinking, open: openKey };
      if (atBottom || switched) log.scrollTop = log.scrollHeight;
    }
    fitWindow(); // reading sizes lays it out, even while hidden
    squeeze();
  }

  // Its to-do list: how far it is and what it's on; the list on a tap.
  // Gone once it's all done and the slime has stopped working.
  let todoOpen = false;
  function renderTodo(s) {
    const list = s.todos || [];
    const done = list.filter((t) => t.status === 'completed').length;
    $('todo').hidden = !list.length || s.ended || (done === list.length && s.state !== 'working');
    if ($('todo').hidden) return;
    const now = list.find((t) => t.status === 'in_progress');
    $('todoFill').style.width = Math.round(100 * done / list.length) + '%';
    $('todoNow').textContent = now ? now.doing : done === list.length ? 'All done' : 'Next: ' + (list.find((t) => t.status !== 'completed') || list[0]).text;
    $('todoCount').textContent = `${done} of ${list.length}`;
    $('todoHead').title = todoOpen ? 'Hide the list' : 'Show the whole list';
    const ul = $('todoList');
    ul.hidden = !todoOpen;
    ul.textContent = '';
    for (const t of list) {
      const li = document.createElement('li');
      li.className = t.status;
      li.textContent = t.status === 'in_progress' ? t.doing : t.text;
      ul.append(li);
    }
  }
  $('todoHead').addEventListener('click', () => { todoOpen = !todoOpen; if (current) renderTodo(current); requestAnimationFrame(fitWindow); });
  new ResizeObserver(() => requestAnimationFrame(fitWindow)).observe($('todo'));

  // Whatever changes size inside (a plan laid out, a font arriving), the
  // window fits it again.
  new ResizeObserver(() => requestAnimationFrame(fitWindow)).observe(inner);
  new ResizeObserver(() => requestAnimationFrame(fitWindow)).observe($('ask'));
  if (document.fonts) document.fonts.ready.then(() => fitWindow());

  // A card can leave the log only a sliver: hide it rather than show half a line.
  function squeeze() {
    const bubble = document.querySelector('.bubble');
    let used = 0;
    for (const el of bubble.children) if (el !== log && el.offsetParent) used += el.offsetHeight + parseFloat(getComputedStyle(el).marginTop) + parseFloat(getComputedStyle(el).marginBottom);
    // (Less room than a line and its padding: hide it; a long reply that
    // doesn't fit just scrolls.)
    if (inner.offsetHeight) innerH = inner.offsetHeight;
    log.classList.toggle('squeezed', !inner.children.length || bubble.clientHeight - used < Math.min(56, innerH + 14) - 1);
  }
  new ResizeObserver(squeeze).observe(document.querySelector('.bubble'));

  // What you've picked so far on a question card, per question:
  // { labels: Set, other: 'what you typed' }.
  let picks = {};
  let innerH = 0; // how tall the log's content was, last time it showed
  const answered = new Set(); // cards you've answered (a late update mustn't bring one back)
  // Per card, kept while you look at another slime and come back: your
  // picks, and what was in the field when it first came (a draft from
  // before it isn't an answer to it).
  const cards = new Map(); // key -> { picks, draft, at }
  let cardDraft = '', cardAt = 0;

  function renderAsk(ask, count) {
    const card = $('ask');
    if (ask && answered.has(ask.key)) ask = null;
    card.hidden = !ask;
    if (!ask) { askKey = 0; document.body.classList.remove('carding'); return; }
    if (ask.key !== askKey) {
      askKey = ask.key;
      const seenBefore = cards.has(ask.key);
      if (!seenBefore) cards.set(ask.key, { picks: {}, draft: text.value, at: Date.now() });
      const c = cards.get(ask.key);
      picks = c.picks;
      cardDraft = c.draft;
      cardAt = c.at;
      buildAsk(ask);
      if (!seenBefore) {
        // A new question: make it look new, and don't let a double-click
        // that answered the last one answer this one too.
        card.classList.remove('new'); void card.offsetWidth; card.classList.add('new');
        for (const b of card.querySelectorAll('button')) b.disabled = true;
        setTimeout(() => {
          if (askKey !== ask.key) return;
          for (const b of card.querySelectorAll('button')) b.disabled = false;
          updateSend(ask);
          if (ask.kind === 'plan') planButtons();
          focusCard();
        }, 450);
      } else { updateSend(ask); focusCard(); }
    }
    if (ask.kind === 'plan') planButtons();
    $('askMore').textContent = count > 1 ? `+${count - 1} more after this` : '';
    $('always').textContent = ask.always || '';
    $('always').title = ask.alwaysFull || '';
    $('always').hidden = !ask.always || ask.kind === 'question';
    requestAnimationFrame(fadeCard);
  }

  // What's in the field counts for the card only if you typed it after the
  // card came (not a draft from before).
  const typedForCard = () => { const v = text.value.trim(); return !!v && v !== cardDraft.trim() && Date.now() - cardAt > 450; };

  // On a plan, a note you've typed means changes first: Go ahead waits
  // until the note is sent (Send changes) or cleared.
  function planButtons() {
    const typed = typedForCard();
    $('deny').textContent = typed ? 'Send changes' : 'Keep planning';
    if (Date.now() - cardAt > 450) { $('allow').disabled = typed; $('always').disabled = typed; }
  }

  // On a card with several questions the field is away: start at the options.
  function focusCard() {
    if (!document.body.classList.contains('carding') || !document.hasFocus()) return;
    const first = document.querySelector('#askQuestions .opt');
    if (first && !document.activeElement.closest('#askQuestions')) first.focus();
  }

  // A card that scrolls fades at the bottom, so it's clear there's more.
  function fadeCard() {
    for (const el of [$('askQuestions'), $('askPlan')]) el.classList.toggle('overflowing', el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }
  for (const el of [$('askQuestions'), $('askPlan')]) {
    el.addEventListener('scroll', fadeCard);
    new ResizeObserver(fadeCard).observe(el); // the box grew: maybe it all fits now
  }

  // Lays the card out for what's being asked: a tool, a question, a plan.
  function buildAsk(ask) {
    const kind = ask.kind || 'tool';
    const card = $('ask');
    card.dataset.kind = kind;
    $('askWhat').textContent = kind === 'question' ? (ask.questions.length > 1 ? 'A couple of things first:' : 'Quick question:')
      : kind === 'plan' ? 'Here’s my plan. Shall I go ahead?' : `Can I use ${ask.tool}?`;
    $('askDetail').textContent = ask.detail || '';
    $('askDetail').hidden = kind !== 'tool' || !ask.detail;
    const plan = $('askPlan');
    plan.hidden = kind !== 'plan';
    plan.textContent = '';
    if (kind === 'plan') rich(plan, ask.plan || '(no plan text)');
    const qs = $('askQuestions');
    qs.textContent = '';
    $('deny').textContent = kind === 'plan' ? 'Keep planning' : 'Deny';
    $('allow').textContent = kind === 'plan' ? 'Go ahead' : kind === 'question' ? 'Send' : 'Allow';
    $('deny').hidden = kind === 'question';
    const oneTap = kind === 'question' && ask.questions.length === 1 && !ask.questions[0].multiSelect;
    $('askNote').textContent = kind === 'plan' ? 'Want changes? Type them below.' : '';
    // Several questions (or picking several): everything happens on the card.
    document.body.classList.toggle('carding', kind === 'question' && !oneTap);
    if (kind !== 'question') { $('askRow').hidden = false; return; }
    // One question you answer with a single pick: a tap sends it.
    $('askRow').hidden = oneTap;
    ask.questions.forEach((q, qi) => {
      const pick = picks[q.question] || (picks[q.question] = { labels: new Set(), other: '' });
      const box = document.createElement('div');
      box.className = 'q';
      const line = document.createElement('div');
      line.className = 'text';
      line.append(q.question);
      const aside = q.multiSelect ? 'pick any' : '';
      if (aside) { const a = document.createElement('span'); a.textContent = ' ' + aside; line.append(a); }
      const opts = document.createElement('div');
      // Short options with nothing to explain are round chips; others rows.
      opts.className = 'opts' + (q.options.every((o) => !o.description || o.description === o.label) && q.options.every((o) => o.label.length <= 24) ? ' chips' : '');
      q.options.forEach((o, oi) => {
        const b = document.createElement('button');
        b.className = 'opt';
        b.textContent = o.label;
        if (o.description && o.description !== o.label) { const d = document.createElement('small'); d.textContent = o.description; b.append(d); }
        b.onclick = () => {
          if (q.multiSelect) {
            if (pick.labels.has(o.label)) pick.labels.delete(o.label); else pick.labels.add(o.label);
            b.classList.toggle('on', pick.labels.has(o.label));
          } else {
            pick.labels = new Set([o.label]);
            pick.other = '';
            other.value = '';
            for (const x of opts.children) x.classList.toggle('on', x === b);
          }
          if (oneTap) {
            // Let you see it land, then send.
            b.classList.remove('picked'); void b.offsetWidth; b.classList.add('picked');
            for (const x of opts.children) x.disabled = true;
            const key = ask.key;
            setTimeout(() => { if (askKey === key) answer(ask); }, 280);
            return;
          }
          updateSend(ask);
        };
        b.dataset.n = String(oi + 1);
        if (pick.labels.has(o.label)) b.classList.add('on');
        opts.append(b);
      });
      // Or say it your own way.
      const other = document.createElement('input');
      other.className = 'other';
      other.placeholder = 'Or say it your way…';
      other.addEventListener('input', () => {
        pick.other = other.value;
        if (!q.multiSelect && other.value.trim()) { pick.labels.clear(); for (const x of opts.children) x.classList.remove('on'); }
        if (oneTap) $('askRow').hidden = !other.value.trim();
        updateSend(ask);
      });
      other.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && other.value) { e.stopPropagation(); other.value = ''; other.dispatchEvent(new Event('input')); return; }
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        // Only a complete answer goes; otherwise on to the next question.
        if (!$('allow').disabled) answer(ask);
        else nextUnanswered(ask, qi);
      });
      // Your own words: behind a small "something else" chip until you want it
      // (one plain question uses the main field below instead).
      box.append(line, opts);
      if (!oneTap) {
        const chip = document.createElement('button');
        chip.className = 'otherchip';
        chip.textContent = 'Something else…';
        other.value = pick.other;
        other.hidden = !pick.other;
        chip.hidden = !!pick.other;
        chip.onclick = () => { chip.hidden = true; other.hidden = false; other.focus(); };
        box.append(chip, other);
      }
      box.dataset.q = String(qi);
      qs.append(box);
    });
  }

  const hasAnswer = (q) => { const p = picks[q.question]; return !!p && (p.labels.size > 0 || !!p.other.trim()); };

  // Send is ready once every question has an answer; until then it says
  // how many are left.
  function updateSend(ask) {
    if (ask.kind !== 'question' || askKey !== ask.key) return;
    const left = ask.questions.filter((q) => !hasAnswer(q)).length;
    $('allow').disabled = left > 0;
    $('allow').textContent = left ? `${left} to go` : 'Send';
  }

  function nextUnanswered(ask, after = -1) {
    const i = ask.questions.findIndex((q, k) => k > after && !hasAnswer(q));
    const j = i >= 0 ? i : ask.questions.findIndex((q) => !hasAnswer(q));
    const box = document.querySelector(`#askQuestions .q[data-q="${j}"]`);
    if (!box) return;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const first = box.querySelector('.opt');
    if (first) first.focus();
  }

  function answer(ask) {
    if (!askKey || askKey !== ask.key) return;
    if (ask.questions.some((q) => !hasAnswer(q))) { nextUnanswered(ask); return; }
    const answers = {};
    for (const q of ask.questions) {
      const p = picks[q.question];
      answers[q.question] = [...p.labels, p.other.trim()].filter(Boolean).join(', ');
    }
    finish('answer', answers);
  }

  // Sends your choice for the card that's up, and puts it away for good.
  function finish(choice, extra) {
    if (!askKey) return;
    answered.add(askKey);
    cards.delete(askKey);
    api.decide(current.id, askKey, choice, extra);
    $('ask').hidden = true;
    askKey = 0;
    document.body.classList.remove('carding');
    text.focus();
  }

  // The window hugs what's in it (the app keeps it between a min and max,
  // and adds room for the tail on whichever side it goes).
  function fitWindow() {
    if (!current) return;
    const bubble = document.querySelector('.bubble');
    const chrome = bubble.offsetHeight - log.offsetHeight; // everything but the log
    const pad = 14; // the log's own padding
    // A card's questions or plan may be scrolled: ask for their full height.
    let card = 0;
    for (const el of [$('askQuestions'), $('askPlan'), $('askDetail')]) if (el.offsetParent) card += el.scrollHeight - el.clientHeight;
    // A hidden (squeezed) log still wants its height back; an empty one doesn't.
    if (inner.offsetHeight) innerH = inner.offsetHeight;
    const logH = inner.children.length && !(askKey && log.classList.contains('squeezed')) ? innerH + pad : 0;
    api.setHeight(current.id, Math.ceil(chrome + card + logH + 24 + 1)); // 24: room round the bubble
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
    if (first) { seen = s.log.length; text.value = drafts.get(s.id) || ''; } // before the card reads it
    render(s);
    if (first) { fit(); send.disabled = text.disabled || !text.value.trim(); }
    if (s.focus) {
      const w = $('wrap');
      w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop');
      text.focus();
    }
  });
  // Beside the slime the bubble is narrower (the tail takes room), so text
  // wraps differently: measure again.
  // The app couldn't use an answer (already answered in the terminal, say):
  // let the card come back if it's still there, and say so.
  if (api.onRefused) api.onRefused((key) => {
    answered.delete(key);
    $('hint').textContent = 'That didn’t go through. If it’s still asking, try again.';
    setTimeout(() => { if (current) $('hint').textContent = hint(current); }, 4000);
  });
  if (api.onTail) api.onTail((t) => { placeTail(t); fitWindow(); });
  text.addEventListener('input', () => {
    if (askKey && current.ask && current.ask.kind === 'plan') planButtons();
    fit(); send.disabled = !current || current.demo || !text.value.trim(); requestAnimationFrame(fitWindow); });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form').requestSubmit(); }
  });
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = text.value.trim();
    if (!v || !current || current.demo) return;
    // A card is up and you typed this after it came: it's for the card.
    const ask = askKey && current.ask;
    const forCard = ask && typedForCard();
    if (forCard && ask.kind === 'plan') {
      text.value = ''; fit(); drafts.delete(current.id);
      return finish('deny', { message: v }); // what to change
    }
    if (forCard && ask.kind === 'question' && ask.questions.length === 1) {
      const p = picks[ask.questions[0].question] || (picks[ask.questions[0].question] = { labels: new Set(), other: '' });
      p.other = v; // added to any picks, not instead of them
      text.value = ''; fit(); drafts.delete(current.id);
      return answer(ask);
    }
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
    if (api.closing) api.closing();
    const w = $('wrap');
    w.classList.remove('pop', 'boing');
    w.classList.add('shut');
    setTimeout(() => { api.close(); w.classList.remove('shut'); closing = false; }, 170);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.isComposing) close(); });
  $('close').addEventListener('click', close);
  $('terminal').addEventListener('click', () => api.terminal());
  $('stop').addEventListener('click', () => { if (current && api.stop) { $('stop').disabled = true; api.stop(current.id); } });
  const decide = (choice) => () => {
    if (!askKey) return;
    const ask = current.ask;
    if (ask && ask.kind === 'question') return answer(ask);
    // On a plan, what you typed after it came is what to change (the go-ahead
    // buttons wait while there's a note).
    if (ask && ask.kind === 'plan' && typedForCard()) {
      if (choice !== 'deny') return;
      const note = text.value.trim();
      text.value = ''; fit(); drafts.delete(current.id);
      return finish('deny', { message: note });
    }
    finish(choice);
  };
  // Number keys pick an option on a one-question card (like the terminal).
  document.addEventListener('keydown', (e) => {
    if (!askKey || !current.ask || current.ask.kind !== 'question' || current.ask.questions.length !== 1) return;
    if (e.metaKey || e.ctrlKey || e.altKey || text.value) return;
    // Typing in a field ("15 minutes") is typing, not picking option 1.
    if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    const b = document.querySelector(`#askQuestions .opt[data-n="${e.key}"]`);
    if (b && !b.disabled) { e.preventDefault(); b.click(); }
  });
  $('allow').addEventListener('click', decide('allow'));
  $('deny').addEventListener('click', decide('deny'));
  $('always').addEventListener('click', decide('always'));
})();
