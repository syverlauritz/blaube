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
  const MAX = 4000; // longer replies are cut until unfolded
  let current = null, askKey = 0, seen = 0;
  let drawn = { entries: [], thinking: -1, open: '' }, ends = []; // what the log shows, and each entry's last element
  const dots = document.createElement('div'); // the slime thinking
  dots.className = 'dots';
  dots.innerHTML = '<i></i><i></i><i></i><span class="doing"></span><ul class="helpers"></ul>'; // and what it's doing ("Editing face.js"), and its helpers
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
    if (s.ended) return (s.log.some((m) => m.status === 'unsent') ? `${s.project} has ended, so what you sent last didn’t go in.` : `${s.project} has ended.`) + (s.cwd ? ' Pick it up here to keep going.' : ' Right-click its slime next time to resume it in a new terminal.');
    if (s.owned) return s.log.length ? '' : 'Started by Blaube. Right-click me to end it or move it to a terminal.';
    if (s.ask) return '';
    if (!s.connected && !s.typeable) return s.canBring ? 'This session can’t hear Blaube. Bring it here to talk to it, or connect Claude Code from Blaube’s menu and restart it.' : 'Connect Claude Code from Blaube’s menu, then restart this session to talk to it.';
    // Queued, nobody waiting, and the turn is over (interrupted, say): it
    // only gets it when it next finishes a turn.
    if (s.queued && s.inbox !== 'ready' && s.state !== 'working' && s.inbox !== 'unknown') return `${s.project} gets this when it next finishes a turn. In a hurry? Go to its terminal.`;
    // Never heard from its inbox: it may not be able to hear you at all.
    if (s.inbox === 'unknown' && s.typeable) return s.queued ? `${s.project} started before Blaube could talk to it, so Blaube will type this into its terminal as soon as it’s free.` : '';
    if (s.inbox === 'unknown' && (s.queued || s.state !== 'working')) return `Haven’t heard from ${s.project} yet. If it doesn’t pick this up, ${s.canBring ? 'bring it here' : 'restart the session'}.`;
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
        // A code block copies in one tap.
        const box = document.createElement('div');
        box.className = 'code';
        box.append(pre, copyButton(() => pre.textContent));
        el.append(box);
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
          if (bit[0] === '`') { const c = document.createElement('code'); c.textContent = bit.slice(1, -1); if (PATHLIKE.test(c.textContent)) c.dataset.path = c.textContent; span.append(c); }
          else if (bit.startsWith('**')) { const b = document.createElement('b'); b.textContent = bit.slice(2, -2); span.append(b); }
          else links(span, bit);
        }
        el.append(span);
        if (j < lines.length - 1) el.append('\n');
      });
    });
  }

  // A file named in a reply (`src/tax.js:42`) opens right there in the box
  // with a tap: its start, or round the line it names. Only once the app
  // has checked it's a file in the session's folder does it look tappable.
  const PATHLIKE = /^(?:~?\/|\.{1,2}\/)?(?:[\w@.-]+\/)*[\w@.-]*\.[A-Za-z][\w]{0,9}(?::\d+(?:[-:]\d+)?)?$|^(?:[\w@.-]+\/)+[\w@.-]+(?::\d+(?:[-:]\d+)?)?$/;
  const known = new Map(); // `${session id}\n${path}` -> true / false
  function markPaths(el) {
    if (!current || current.demo || !api.filesExist) return;
    if (known.size > 2000) known.clear();
    const id = current.id;
    const codes = [...el.querySelectorAll('[data-path]')];
    const ask = [...new Set(codes.map((c) => c.dataset.path.replace(/:\d+(?:[-:]\d+)?$/, '')).filter((p) => !known.has(id + '\n' + p)))].slice(0, 40);
    const mark = () => {
      for (const c of codes) {
        const p = c.dataset.path.replace(/:\d+(?:[-:]\d+)?$/, '');
        if (!known.get(id + '\n' + p) || c.classList.contains('filelink')) continue;
        c.classList.add('filelink');
        c.tabIndex = 0;
        c.title = 'Show it here';
        c.onclick = () => peek(c, id, p, Number((/:(\d+)/.exec(c.dataset.path.slice(p.length)) || [])[1]) || 0);
        c.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); c.click(); } };
      }
    };
    if (!ask.length) return mark();
    api.filesExist(id, ask).then((found) => { for (const p of ask) known.set(id + '\n' + p, (found || []).includes(p)); mark(); });
  }
  function peek(code, id, rel, line) {
    const at = code.closest('.msg > span') || code.closest('.msg'); // (right under the line that names it)
    const open = at.nextElementSibling && at.nextElementSibling.classList.contains('peek') && at.nextElementSibling.dataset.path === rel ? at.nextElementSibling : null;
    if (open) { open.remove(); fitWindow(); return; }
    api.peekFile(id, rel).then((f) => {
      if (!f) { known.set(id + '\n' + rel, false); code.classList.remove('filelink'); code.onclick = null; return; }
      for (const old of [...inner.querySelectorAll('.peek')]) if (old.dataset.path === rel) old.remove();
      const box = document.createElement('div');
      box.className = 'peek';
      box.dataset.path = rel;
      const head = document.createElement('div');
      head.className = 'peekhead';
      const name = document.createElement('span');
      name.textContent = f.name + (line ? `, line ${line}` : '');
      const reveal = document.createElement('button');
      reveal.type = 'button'; reveal.textContent = '↗'; reveal.title = 'Show it in ' + (navigator.platform.startsWith('Mac') ? 'Finder' : 'its folder');
      reveal.onclick = () => api.reveal(id, f.path);
      const close = document.createElement('button');
      close.type = 'button'; close.textContent = '✕'; close.title = 'Close';
      close.onclick = () => { box.remove(); fitWindow(); };
      head.append(name, reveal, close);
      const pre = document.createElement('pre');
      const lines = f.text.split('\n');
      if (line && line <= lines.length) {
        pre.append(lines.slice(0, line - 1).join('\n') + (line > 1 ? '\n' : ''));
        const mk = document.createElement('mark');
        mk.textContent = lines[line - 1];
        pre.append(mk, (line < lines.length ? '\n' : '') + lines.slice(line).join('\n'));
      } else pre.textContent = f.text;
      if (f.cut) pre.append('\n…');
      box.append(head, pre);
      at.after(box);
      const mk = pre.querySelector('mark');
      if (mk) pre.scrollTop = Math.max(0, mk.offsetTop - pre.offsetTop - 60);
      fitWindow();
      requestAnimationFrame(() => box.scrollIntoView({ block: 'nearest' }));
    });
  }

  // What was said before this box's own log (from its transcript), on a tap
  // at the top. Kept per session while Blaube runs.
  const earlier = new Map(); // session id -> [messages] (empty: nothing earlier)
  function drawEarlier(s) {
    if (!s.earlier || !api.earlier) return;
    const got = earlier.get(s.id);
    if (got && !got.length) return;
    if (!got) {
      const b = document.createElement('button');
      b.className = 'earlierbtn';
      b.type = 'button';
      b.textContent = 'Earlier messages';
      b.onclick = () => {
        b.disabled = true;
        const id = s.id;
        api.earlier(id).then((list) => {
          earlier.set(id, list || []);
          if (!list || !list.length) { b.textContent = 'Nothing earlier'; return; }
          if (current && current.id === id) { const keep = log.scrollHeight - log.scrollTop; drawn.entries = []; render(current); log.scrollTop = log.scrollHeight - keep; }
        });
      };
      inner.append(b);
      return;
    }
    const box = document.createElement('div');
    box.className = 'earlier';
    for (const m of got) box.append(...message(m, false));
    const line = document.createElement('div');
    line.className = 'since old';
    line.textContent = 'Before Blaube was watching';
    box.append(line);
    inner.append(box);
  }

  // Web links in a reply ([text](url) or a bare https://…) open in your
  // browser: a PR it opened is a tap away.
  function links(span, text) {
    const re = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"'`]+|\[([^\]\n]+)\]\(((?!\w+:)[^\s)]+)\)/g;
    let at = 0, m;
    while ((m = re.exec(text))) {
      if (m[3]) { // [tax.js:42](src/tax.js#L42): a file in the session's folder
        span.append(text.slice(at, m.index));
        const f = document.createElement('span');
        f.className = 'fileref';
        f.textContent = m[3];
        let target = m[4];
        try { target = decodeURI(target); } catch { /* as it is */ }
        target = target.replace(/#L(\d+)(?:-L?\d+)?$/, ':$1');
        if (PATHLIKE.test(target)) f.dataset.path = target;
        span.append(f);
        at = m.index + m[0].length;
        continue;
      }
      let url = m[2] || m[0], label = m[1] || '';
      let tail = '';
      if (!m[2]) { const t = /[.,;:!?)\]]+$/.exec(url); if (t) { tail = t[0]; url = url.slice(0, -tail.length); } label = url; }
      span.append(text.slice(at, m.index));
      const a = document.createElement('a');
      a.className = 'link';
      a.href = url;
      a.textContent = label;
      a.title = url;
      a.addEventListener('click', (e) => { e.preventDefault(); if (api.openLink) api.openLink(url); });
      span.append(a, tail);
      at = m.index + m[0].length;
    }
    span.append(text.slice(at));
  }

  // A step goes into the run of steps it follows (or starts one). A run
  // shows its last SHOWN; the earlier ones fold behind "N more".
  const SHOWN = 3;
  const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
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
    // A step with more to it opens on a tap: the change, the output (an
    // image it looked at: the image, which a terminal can't show).
    const image = !m.detail && m.file && IMAGE.test(m.file) && api.image;
    const e = document.createElement(m.detail || image ? 'button' : 'div');
    e.className = 'step' + (m.ok === false ? ' failed' : '') + (fresh ? ' new' : '') + (m.detail || image ? ' opens' : '');
    e.textContent = m.text + (m.ok === false ? ' (failed)' : '');
    e.title = m.text;
    run.append(e);
    if (m.detail) {
      const pre = document.createElement('pre');
      pre.className = 'stepout';
      // (An edit's − and + lines are tinted, like a diff.)
      if (/^[−+] /.test(m.detail)) { pre.classList.add('diff'); colorDiff(pre, m.detail); } else pre.textContent = m.detail;
      // (What it printed copies in one tap.)
      const cp = copyButton(() => m.detail, 'Copy what it printed');
      cp.classList.add('copyout');
      pre.prepend(cp);
      const shown = () => openSteps.has(m.n);
      pre.hidden = !shown();
      e.classList.toggle('open', shown());
      e.setAttribute('aria-expanded', String(shown()));
      e.onclick = () => {
        if (shown()) openSteps.delete(m.n); else openSteps.add(m.n);
        pre.hidden = !shown();
        e.classList.toggle('open', shown());
        e.setAttribute('aria-expanded', String(shown()));
        // Opening one shows it, even from the folded part of a run.
        if (shown() && e.classList.contains('early')) { run.classList.add('open'); openRuns.add(Number(run.dataset.first)); run.relabel(); }
      };
      e.after(pre);
    }
    if (image) {
      const box = document.createElement('div');
      box.className = 'stepout stepimg';
      const shown = () => openSteps.has(m.n);
      const load = () => {
        if (box.firstChild || !current) return;
        api.image(current.id, m.file).then((r) => {
          if (!r) { box.textContent = 'It’s not there any more.'; return; }
          const img = document.createElement('img');
          img.src = r.url; img.alt = m.file.split(/[\\/]/).pop();
          img.draggable = false;
          img.onload = () => fitWindow();
          box.append(img);
        });
      };
      box.hidden = !shown();
      if (shown()) load();
      e.classList.toggle('open', shown());
      e.setAttribute('aria-expanded', String(shown()));
      e.onclick = () => {
        if (shown()) openSteps.delete(m.n); else openSteps.add(m.n);
        box.hidden = !shown();
        e.classList.toggle('open', shown());
        e.setAttribute('aria-expanded', String(shown()));
        if (shown()) load();
        if (shown() && e.classList.contains('early')) { run.classList.add('open'); openRuns.add(Number(run.dataset.first)); run.relabel(); }
        fitWindow();
      };
      e.after(box);
    }
    const rows = run.querySelectorAll('.step');
    if (rows.length > SHOWN) rows[rows.length - SHOWN - 1].classList.add('early');
    run.relabel();
    return run;
  }

  function message(m, fresh) {
    if (m.who === 'note') {
      const e = document.createElement('div');
      e.className = 'note' + (m.error ? ' error' : '');
      e.textContent = m.text;
      return [e];
    }
    const e = document.createElement('div');
    e.className = 'msg ' + m.who + (m.status === 'queued' || m.status === 'unsent' ? ' ' + m.status : '') + (fresh ? ' new' : '');
    e.dataset.at = m.at;
    e.dataset.text = m.text; // (what find looks in: not its buttons)
    // (A very long one is cut until you unfold it with Show more.)
    const cut = m.text.length > MAX && !open.has(m.at);
    rich(e, cut ? m.text.slice(0, MAX) + '…' : m.text);
    markPaths(e);
    const out = [e];
    if (cut) {
      e.dataset.measured = '1'; // (folded already, whatever its height)
      e.classList.add('folded');
      const more = document.createElement('button');
      more.className = 'more';
      more.textContent = 'Show more';
      more.onclick = () => { open.add(m.at); drawn.entries = []; render(current); };
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
    // Under a reply: what its turn came to (the files show in Finder); on
    // it, a copy button.
    if (m.who === 'claude') {
      const t = document.createElement('div');
      t.className = 'turnmeta';
      const bits = [];
      if (m.turn && m.turn.took >= 60e3) bits.push(took(m.turn.took));
      if (m.turn && m.turn.steps) bits.push(`${m.turn.steps} step${m.turn.steps === 1 ? '' : 's'}`);
      t.append(bits.join(' · '));
      const files = (m.turn && m.turn.files) || [];
      files.slice(0, 4).forEach((f, i) => {
        t.append(i || bits.length ? (i ? ', ' : ' · ') : '');
        const b = document.createElement('button');
        b.className = 'filelink';
        b.textContent = f.split(/[\\/]/).pop();
        b.title = `${f}\nShow it in ${navigator.platform.startsWith('Mac') ? 'Finder' : 'its folder'}, or drag it into another app`;
        b.onclick = () => api.reveal && api.reveal(current.id, f);
        // Drag it out: the file itself, into a mail, a chat, Finder.
        b.draggable = true;
        b.addEventListener('dragstart', (ev) => { ev.preventDefault(); if (api.dragOut) api.dragOut(current.id, f); });
        t.append(b);
        // Not what you wanted? Ask for that file's change back.
        const undo = document.createElement('button');
        undo.className = 'undo';
        undo.type = 'button';
        undo.dataset.label = 'undo';
        undo.title = `Ask Claude to undo what it changed in ${b.textContent}`;
        undo.setAttribute('aria-label', undo.title);
        undo.onclick = () => { if (current && !undo.disabled) { undo.disabled = true; api.send(current.id, `Undo the changes you made to ${f} in that last turn, and tell me what you put back.`); } };
        t.append(undo);
      });
      if (files.length > 4) t.append(` +${files.length - 4}`);
      // More than one file: undo the whole turn in one go.
      if (files.length > 1) {
        const all = document.createElement('button');
        all.className = 'undo all';
        all.type = 'button';
        all.dataset.label = 'undo all';
        all.title = `Ask Claude to undo everything it changed in that turn (${files.length} files)`;
        all.setAttribute('aria-label', all.title);
        all.onclick = () => { if (current && !all.disabled) { all.disabled = true; api.send(current.id, `Undo all the changes you made in that last turn (${files.join(', ')}), and tell me what you put back.`); } };
        t.append(all);
      }
      if (bits.length || files.length) out.push(t);
      const c = copyButton(() => m.text, 'Copy reply');
      c.classList.add('copyreply');
      e.append(c);
    }
    return out;
  }

  const took = (ms) => { const m = Math.round(ms / 60e3); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };

  // "Copy", then "Copied" for a moment.
  function copyButton(get, label = 'Copy') {
    const b = document.createElement('button');
    b.className = 'copy';
    b.type = 'button';
    // (Its word is drawn by CSS, so it's never part of the text around it:
    // not in what you select and copy, not in what find reads.)
    b.dataset.label = 'Copy';
    b.setAttribute('aria-label', label);
    b.title = `${label} (or drag it into another app)`;
    // Drag it into another app and the text goes there.
    b.draggable = true;
    b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', get()); e.dataTransfer.effectAllowed = 'copy'; });
    b.onclick = (e) => {
      e.stopPropagation();
      if (api.copy) api.copy(get());
      b.dataset.label = 'Copied';
      setTimeout(() => { b.dataset.label = 'Copy'; }, 1200);
    };
    return b;
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
    stop.title = (navigator.platform.startsWith('Mac') ? '⌘.' : 'Ctrl+.') + (s.owned ? ': stop it now' : ': it stops before its next step');
    stop.disabled = !!s.stopping;
    stop.lastChild.textContent = s.stopping ? 'Stopping…' : 'Stop';
    renderMode(s);
    renderTodo(s);
    renderOthers(s);
    if (document.body.classList.contains('overview')) drawOverview(s);
    $('git').textContent = s.git || '';
    $('git').hidden = !s.git || !!s.ended;
    renderGitFiles(s);
    renderTasks(s);
    renderQuick(s);
    renderAsk(s.ask, s.asks);
    $('hint').textContent = hint(s);
    text.disabled = !!s.demo || (!s.connected && !s.typeable) || !!s.ended;
    text.placeholder = s.ask && s.ask.kind === 'question' ? (s.ask.questions.length === 1 ? 'Or type your answer…' : 'Say something for later…')
      : s.ask && s.ask.kind === 'plan' ? 'What should change?'
      : !s.owned && s.state === 'working' && s.stoppable && !s.stopping ? 'Add something…'
      : !s.owned && (s.state === 'working' || s.state === 'waiting') ? 'Say something for later…' : 'Say something…';
    send.disabled = text.disabled || (!text.value.trim() && !files.length);
    // The slime's dots while it works on something you said: after the
    // last thing it got (anything still queued comes after them).
    // Working on something from its terminal: at the end of the log.
    let thinking = -1;
    if (s.state === 'working') {
      thinking = -2;
      for (let i = s.log.length - 1; i >= 0 && s.log[i].who !== 'claude'; i--) {
        if (s.log[i].who === 'you' && s.log[i].status !== 'queued') { thinking = i; break; }
      }
    }
    dots.querySelector('.doing').textContent = s.doing || '';
    // Helpers it sent off, each with what it's on ("Finding the tax tables:
    // Reading rates.js"); one waiting on you says so.
    const hl = dots.querySelector('.helpers');
    const hk = JSON.stringify(s.helpers || []);
    if (hl.dataset.key !== hk) {
      hl.dataset.key = hk;
      hl.textContent = '';
      for (const h of s.helpers || []) {
        const li = document.createElement('li');
        if (h.waiting) li.className = 'wants';
        const b = document.createElement('b');
        b.textContent = h.name;
        li.append(b, h.waiting ? ' needs you' : h.doing ? ` · ${h.doing}` : '');
        hl.append(li);
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
        drawEarlier(s);
        if (!s.log.length && !s.ask && (s.connected || s.typeable || s.owned)) {
          const e = document.createElement('div');
          e.className = 'empty';
          e.textContent = s.owned ? `What should we do in ${s.project}?` : `Say hi to ${s.project}! It hears you even when you’re not at its terminal.`;
          inner.append(e);
        }
      } else if (from === 0) { inner.textContent = ''; drawEarlier(s); }
      // Where what came in since you last looked begins (when replies did).
      const since = s.lookedAt ? s.log.findIndex((m, i) => i > 0 && m.at > s.lookedAt && s.log[i - 1].at <= s.lookedAt) : -1;
      const sinceShows = since > 0 && s.log.slice(since).some((m) => m.who === 'claude');
      for (let i = from; i < s.log.length; i++) {
        if (i === since && sinceShows) { const d = document.createElement('div'); d.className = 'since'; d.textContent = 'Since you last looked'; inner.append(d); }
        if (s.log[i].who === 'step') { ends[i] = addStep(s.log[i], !switched && i >= seen); continue; }
        const nodes = message(s.log[i], !switched && i >= seen);
        inner.append(...nodes);
        ends[i] = nodes[nodes.length - 1];
      }
      // (After the steps it has taken since, too.)
      let after = thinking;
      for (let i = thinking + 1; thinking >= 0 && i < s.log.length; i++) if (s.log[i].status !== 'queued') after = i;
      if (after >= 0 && ends[after]) ends[after].after(dots);
      else if (thinking === -2) {
        // (Before anything still waiting to go in.)
        let a = s.log.length - 1;
        while (a >= 0 && s.log[a].status === 'queued') a--;
        if (a >= 0 && ends[a]) ends[a].after(dots); else inner.prepend(dots);
      }
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
    if (!$('findBar').hidden && $('find').value.trim()) find($('find').value);
    fitWindow(); // reading sizes lays it out, even while hidden
    squeeze();
  }

  // A dot per slime; a tap (or ⌘[ ⌘], ⌘1–9) hops to its talk box.
  function renderOthers(s) {
    const box = $('others');
    const list = s.others || [];
    const key = JSON.stringify([s.id, list.map((o) => [o.id, o.color, o.state, o.project])]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    if (s.demo) return;
    const all = document.createElement('button');
    all.className = 'all';
    all.title = `Every session at a glance (${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}0)`;
    all.setAttribute('aria-label', all.title);
    all.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 7h12M6 12h12M6 17h12"/></svg>';
    all.onclick = () => showOverview(!document.body.classList.contains('overview'));
    if (list.length < 2) { box.append(all); return; }
    list.slice(0, 9).forEach((o, i) => {
      const b = document.createElement('button');
      b.style.setProperty('--c', o.color);
      b.className = (o.id === s.id ? 'here' : '') + (o.state === 'waiting' ? ' wants' : '');
      const how = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';
      b.title = `${o.project}${o.title ? `: ${o.title}` : ''}${o.state === 'waiting' ? ' (needs you)' : ''} · ${how}${i + 1}`;
      b.setAttribute('aria-label', b.title);
      if (o.id !== s.id) b.onclick = () => api.switchTo && api.switchTo(o.id);
      box.append(b);
    });
    box.append(all);
  }

  // Every session at a glance: what it's up to, and the small print. A tap
  // goes to its box. (Redrawn with every update while it's open.)
  function showOverview(on) {
    const was = document.body.classList.contains('overview');
    document.body.classList.toggle('overview', !!(on && current && !current.demo));
    // (Find means something else in each: start it afresh.)
    if (was !== document.body.classList.contains('overview') && !$('findBar').hidden) { $('find').value = ''; $('findBar').hidden = true; allQuery = ''; allHits = []; find(''); }
    if (on) { drawOverview(current); loadHub(); }
    requestAnimationFrame(fitWindow);
  }
  // Below the sessions: start one in a recent folder, or pick up a past one.
  let hub = null, planFirst = false;
  function loadHub() {
    if (!api.hub) return;
    api.hub().then((h) => { hub = h; if (document.body.classList.contains('overview') && current) drawOverview(current); });
  }
  function drawHub(box) {
    if (!hub) return;
    const section = (title) => { const h = document.createElement('div'); h.className = 'hubhead'; h.textContent = title; box.append(h); };
    section('New session in');
    // Plan first: it starts in plan mode, and shows you a plan to approve
    // before it changes anything.
    const plan = document.createElement('label');
    plan.className = 'planfirst';
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.checked = planFirst;
    tick.onchange = () => { planFirst = tick.checked; };
    plan.append(tick, ' Plan first');
    plan.title = 'It shows you a plan to approve before it changes anything';
    box.lastChild.append(plan);
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const f of hub.folders) {
      const b = document.createElement('button');
      b.textContent = f.name;
      b.title = f.path;
      b.onclick = () => api.newIn(f.path, { plan: planFirst });
      chips.append(b);
    }
    const pick = document.createElement('button');
    pick.textContent = 'Another folder…';
    pick.className = 'dim';
    pick.onclick = () => api.newIn('pick', { plan: planFirst });
    chips.append(pick);
    box.append(chips);
    if (hub.past.length) {
      section('Pick up where you left off');
      for (const p of hub.past) {
        const row = document.createElement('button');
        row.className = 'row past';
        const name = document.createElement('b');
        name.textContent = p.title;
        const m = document.createElement('small');
        m.textContent = p.where;
        row.append(name, m);
        row.onclick = () => api.pickUp(p.id);
        box.append(row);
      }
    }
  }
  function drawOverview(s) {
    const box = $('overview');
    const scroll = box.scrollTop;
    box.textContent = '';
    if (!$('findBar').hidden && allQuery) { drawHits(box); box.scrollTop = scroll; requestAnimationFrame(fitWindow); return; }
    if (s.today) { const t = document.createElement('div'); t.className = 'today'; t.textContent = s.today; box.append(t); }
    if (s.usage) { const u = document.createElement('div'); u.className = 'today usage'; u.textContent = s.usage; box.append(u); }
    for (const o of s.others || []) {
      const row = document.createElement('button');
      row.className = 'row' + (o.id === s.id ? ' here' : '') + (o.state === 'waiting' ? ' wants' : '');
      row.style.setProperty('--c', o.color);
      const name = document.createElement('b');
      name.textContent = o.project;
      if (o.title) { const t = document.createElement('i'); t.className = 'title'; t.textContent = o.title; name.append(t); }
      const status = document.createElement('span');
      status.className = 'status';
      status.textContent = o.status || '';
      row.append(name, status);
      if (o.meta) { const m = document.createElement('small'); m.textContent = o.meta; row.append(m); }
      row.onclick = () => { showOverview(false); if (o.id !== s.id && api.switchTo) api.switchTo(o.id); };
      box.append(row);
      // Asking permission: answered right here, without going to it.
      if (o.ask && api.answer) {
        const ask = document.createElement('div');
        ask.className = 'rowask';
        ask.style.setProperty('--c', o.color);
        const what = document.createElement('span');
        what.textContent = [o.ask.tool, o.ask.detail].filter(Boolean).join(': ');
        what.title = what.textContent;
        const deny = document.createElement('button');
        deny.type = 'button'; deny.textContent = 'Deny';
        const allow = document.createElement('button');
        allow.type = 'button'; allow.textContent = 'Allow'; allow.className = 'allow';
        deny.onclick = () => { ask.remove(); api.answer(o.id, o.ask.key, 'deny'); };
        allow.onclick = () => { ask.remove(); api.answer(o.id, o.ask.key, 'allow'); };
        ask.append(what, deny, allow);
        box.append(ask);
      }
    }
    drawHub(box);
    box.scrollTop = scroll;
    requestAnimationFrame(fitWindow);
  }

  // ⌘F: find in the conversation. Only what matches stays (messages,
  // notes, steps, and what a step printed); Esc or an empty field ends it.
  function find(q) {
    q = String(q || '').trim().toLowerCase();
    document.body.classList.toggle('searching', !!q);
    let hits = 0;
    for (const el of inner.children) {
      if (el === dots) continue;
      if (el.classList.contains('steps')) {
        let any = false;
        for (const st of el.querySelectorAll('.step')) {
          const out = st.nextElementSibling && st.nextElementSibling.classList.contains('stepout') ? st.nextElementSibling : null;
          const m = !q || (st.textContent + ' ' + (out ? out.textContent : '')).toLowerCase().includes(q);
          st.classList.toggle('miss', !m);
          if (out) out.classList.toggle('miss', !m);
          if (m && q) { any = true; hits++; }
        }
        el.classList.toggle('miss', !!q && !any);
        continue;
      }
      const m = !q || (el.dataset.text != null ? el.dataset.text : el.textContent).toLowerCase().includes(q);
      el.classList.toggle('miss', !m);
      if (m && q && (el.classList.contains('msg') || el.classList.contains('note'))) hits++;
    }
    $('findCount').textContent = q ? (hits ? `${hits} found` : 'nothing found') : '';
    requestAnimationFrame(fitWindow);
  }
  $('find').addEventListener('input', () => {
    if (document.body.classList.contains('overview')) searchAll($('find').value);
    else find($('find').value);
  });
  // In the overview, ⌘F looks through every session: the ones that said it,
  // with a snippet; a tap goes there with the same words found.
  let allQuery = '', allHits = [], pendingFind = '';
  // (Past sessions too, a moment after you stop typing: they're on disk.)
  let pastHits = [], pastFor = '', pastTimer = 0;
  function searchAll(q) {
    allQuery = String(q || '').trim();
    clearTimeout(pastTimer);
    if (!api.searchAll || allQuery.length < 2) { allHits = []; pastHits = []; pastFor = ''; if (current) drawOverview(current); return; }
    const asked = allQuery;
    const redraw = () => { if (current && document.body.classList.contains('overview')) drawOverview(current); };
    api.searchAll(asked).then((r) => { if (asked !== allQuery) return; allHits = r || []; redraw(); });
    if (api.searchPast) pastTimer = setTimeout(() => api.searchPast(asked).then((r) => { if (asked !== allQuery) return; pastHits = r || []; pastFor = asked; redraw(); }), 300);
  }
  function drawHits(box) {
    drawLiveHits(box);
    if (pastFor !== allQuery || !pastHits.length) return;
    const h = document.createElement('div'); h.className = 'hubhead'; h.textContent = 'Earlier sessions'; box.append(h);
    for (const p of pastHits) {
      const row = document.createElement('button');
      row.className = 'row past found';
      const name = document.createElement('b');
      name.textContent = p.title;
      const status = document.createElement('span');
      status.className = 'status';
      status.textContent = p.snippet;
      const m = document.createElement('small');
      m.textContent = p.where;
      row.append(name, status, m);
      row.title = 'Pick it up here';
      row.onclick = () => api.pickUp(p.id);
      box.append(row);
    }
  }
  function drawLiveHits(box) {
    if (!allHits.length) {
      if (pastFor === allQuery && pastHits.length) return;
      const n = document.createElement('div'); n.className = 'today';
      n.textContent = allQuery.length < 2 ? 'Type a little more…' : pastFor === allQuery ? 'Nothing found' : 'Looking…';
      box.append(n); return;
    }
    for (const h of allHits) {
      const row = document.createElement('button');
      row.className = 'row hit';
      const o = (current.others || []).find((x) => x.id === h.id);
      row.style.setProperty('--c', o ? o.color : 'var(--faint)');
      const name = document.createElement('b');
      name.textContent = h.project;
      const status = document.createElement('span');
      status.className = 'status';
      status.textContent = h.snippet;
      const m = document.createElement('small');
      m.textContent = `${h.hits} found`;
      row.append(name, status, m);
      row.onclick = () => {
        const q = allQuery;
        showOverview(false);
        if (h.id === current.id) openFind(q);
        else { pendingFind = q; api.switchTo(h.id); setTimeout(() => { pendingFind = ''; }, 2000); } // (if it never comes, forget it)
      };
      box.append(row);
    }
  }
  function openFind(q) {
    $('findBar').hidden = false;
    $('find').value = q;
    find(q);
    $('find').focus();
    requestAnimationFrame(fitWindow);
  }
  $('find').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); $('find').value = ''; find(''); $('findBar').hidden = true; allQuery = ''; allHits = []; if (document.body.classList.contains('overview') && current) drawOverview(current); text.focus(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'f' && current) {
      e.preventDefault();
      $('findBar').hidden = false;
      $('find').focus();
      $('find').select();
      requestAnimationFrame(fitWindow);
    }
  });
  // ⌘S saves the conversation as Markdown (to Downloads), ⇧⌘C copies it.
  let toastTimer = null;
  function toast(words, file = '') {
    const t = $('toast');
    t.textContent = words;
    t.title = file;
    t.onclick = () => { if (file && api.showFile) api.showFile(file); t.hidden = true; requestAnimationFrame(fitWindow); };
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; requestAnimationFrame(fitWindow); }, 4000);
    requestAnimationFrame(fitWindow);
  }
  document.addEventListener('keydown', (e) => {
    if (!current || current.demo || !(e.metaKey || e.ctrlKey) || e.altKey || !current.log.length) return;
    const k = e.key.toLowerCase();
    if (k === 's' && !e.shiftKey && api.save) {
      e.preventDefault();
      api.save(current.id).then((file) => toast(file ? `Saved to Downloads as ${file.split(/[\\/]/).pop()}` : 'Couldn’t save it', file));
    } else if (k === 'c' && e.shiftKey && api.copyAll) {
      e.preventDefault();
      api.copyAll(current.id);
      toast('Copied the conversation as Markdown');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!current || !(e.metaKey || e.ctrlKey) || e.altKey || !api.switchTo) return;
    if (e.key === '0') { e.preventDefault(); return showOverview(!document.body.classList.contains('overview')); }
    const list = (current.others || []).slice(0, 9);
    if (list.length < 2) return;
    const at = list.findIndex((o) => o.id === current.id);
    let to = null;
    if (/^[1-9]$/.test(e.key)) to = list[Number(e.key) - 1];
    else if (e.key === '[' || e.key === ']') to = list[(at + (e.key === ']' ? 1 : list.length - 1)) % list.length];
    if (!to) return;
    e.preventDefault();
    if (to.id !== current.id) api.switchTo(to.id);
  });

  // One tap for what you'd likely ask next (commit, tests, a PR...). Not
  // while a card is up, it's busy, or before anything has been said.
  function renderQuick(s) {
    const box = $('quick');
    // (One that ended can be picked up right here, without a terminal.)
    // (One that can't hear you can carry on here instead.)
    const deaf = s.canBring && api.bringHere && !s.typeable && (s.inbox === 'unknown' || !s.connected);
    const list = s.ended ? (s.cwd && !s.demo && api.continueHere ? [{ label: 'Pick it up here', prompt: 'Keep going with it here, no terminal needed', here: true }] : [])
      : s.ask || s.demo ? []
      : [...(deaf ? [{ label: 'Bring it here', prompt: 'It closes in its terminal and carries on here, conversation and all', bring: true }] : []),
        ...(!s.log.length || (!s.connected && !s.typeable && !s.owned) ? [] : (s.quick || []))].slice(0, 4);
    const key = JSON.stringify(list.map((q) => q.label));
    box.hidden = !list.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    for (const q of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = q.label;
      b.title = q.prompt;
      b.onclick = () => { if (!current) return; if (q.here) api.continueHere(current.id); else if (q.bring) api.bringHere(current.id); else api.send(current.id, q.prompt); box.hidden = true; };
      box.append(b);
    }
  }

  // Tap the git line for the files it's changed; tap one to see it.
  let gitOpen = false;
  $('git').addEventListener('click', () => { if (!current || !(current.gitFiles || []).length) return; gitOpen = !gitOpen; renderGitFiles(current); });
  function renderGitFiles(s) {
    const list = s.ended ? [] : (s.gitFiles || []);
    if (!list.length) gitOpen = false;
    $('git').classList.toggle('opens', !!list.length);
    $('git').setAttribute('aria-expanded', String(gitOpen));
    $('git').title = list.length ? (gitOpen ? 'Hide the files' : 'Show the changed files') : '';
    const box = $('gitFiles');
    const was = box.hidden;
    box.hidden = !gitOpen;
    const key = JSON.stringify(list) + gitOpen;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    if (gitOpen) for (const f of list) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = f.how;
      const name = document.createElement('span');
      name.textContent = f.name;
      const how = document.createElement('small');
      how.textContent = f.how;
      b.append(name, how);
      b.title = f.how === 'deleted' ? f.path : `${f.path}\nTap to see what changed`;
      li.append(b);
      if (f.how !== 'deleted') {
        // Tap: what changed in it; ↗: show it in Finder.
        const pre = document.createElement('pre');
        pre.className = 'stepout diff';
        pre.hidden = true;
        b.setAttribute('aria-expanded', 'false');
        b.onclick = () => {
          pre.hidden = !pre.hidden;
          b.setAttribute('aria-expanded', String(!pre.hidden));
          if (!pre.hidden && !pre.textContent && api.diff) api.diff(current.id, f.path).then((t) => { colorDiff(pre, t || '(can’t show it)'); requestAnimationFrame(fitWindow); });
          requestAnimationFrame(fitWindow);
        };
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'reveal';
        go.textContent = '↗';
        go.title = `Show it in ${navigator.platform.startsWith('Mac') ? 'Finder' : 'its folder'}`;
        go.setAttribute('aria-label', go.title);
        go.onclick = () => api.reveal && api.reveal(current.id, f.path);
        li.append(go, pre);
      }
      box.append(li);
    }
    if (was !== box.hidden || gitOpen) requestAnimationFrame(fitWindow);
  }

  // A diff, its added and removed lines tinted.
  function colorDiff(pre, text) {
    pre.textContent = '';
    for (const line of String(text).split('\n')) {
      const l = document.createElement('span');
      l.className = /^\+/.test(line) ? 'add' : /^[-−]/.test(line) ? 'del' : /^@@/.test(line) ? 'hunk' : '';
      l.textContent = line + '\n';
      pre.append(l);
    }
  }

  // What it left running in the background, each with a Stop (asked of
  // Claude, which started it: no terminal needed).
  function renderTasks(s) {
    const box = $('bg');
    const list = s.ended || s.demo ? [] : (s.tasks || []);
    const key = JSON.stringify(list.map((t) => t.id)) + s.id;
    box.hidden = !list.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    for (const t of list) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = t.label;
      name.title = t.command;
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.textContent = 'Stop';
      stop.title = `Ask Claude to stop ${t.command}`;
      stop.onclick = () => { if (!current) return; stop.disabled = true; api.send(current.id, `Stop the background task “${t.label}” (id ${t.id}, \`${t.command}\`).`); };
      // (And what it has printed lately, asked of Claude too.)
      const peek = document.createElement('button');
      peek.type = 'button';
      peek.textContent = 'Output';
      peek.title = `Ask Claude what ${t.command} has printed lately`;
      peek.onclick = () => { if (!current) return; api.send(current.id, `What has the background task “${t.label}” (id ${t.id}, \`${t.command}\`) printed lately? Show me the last lines that matter, and say if anything looks wrong.`); };
      li.append(name, peek, stop);
      box.append(li);
    }
    requestAnimationFrame(fitWindow);
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
    $('todoHead').setAttribute('aria-expanded', String(todoOpen));
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
          if (ask.kind !== 'question') planButtons();
          focusCard();
        }, 450);
      } else { updateSend(ask); focusCard(); }
    }
    if (ask.kind !== 'question') planButtons();
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
  // On a permission ask, a note turns Deny into "no, do this instead".
  function planButtons() {
    const typed = typedForCard();
    if (current.ask.kind === 'tool') { $('deny').textContent = typed ? 'Deny and say' : 'Deny'; return; }
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
    // (An edit's − and + lines tinted, as in its steps.)
    if (/\n[−+] /.test(ask.detail || '')) colorDiff($('askDetail'), ask.detail); else $('askDetail').textContent = ask.detail || '';
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
    $('askNote').textContent = kind === 'plan' ? 'Want changes? Type them below.' : kind === 'tool' ? 'Or type what to do instead.' : '';
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
    // The overview: as tall as its rows.
    if (document.body.classList.contains('overview')) {
      const ov = $('overview');
      // (Measured to its last row, so it shrinks too: a search, a session gone.)
      const last = ov.lastElementChild;
      const content = last ? last.getBoundingClientRect().bottom - ov.getBoundingClientRect().top + ov.scrollTop + 16 : 0;
      api.setHeight(current.id, Math.ceil(bubble.offsetHeight - ov.offsetHeight + content + 24 + 1));
      return;
    }
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
    if (first) { document.body.classList.remove('overview'); $('find').value = ''; $('findBar').hidden = true; document.body.classList.remove('searching'); $('toast').hidden = true; gitOpen = false; recall = -1; suggAsked++; drawSuggest([]); }
    if (first) { seen = s.log.length; text.value = drafts.get(s.id) || ''; if (files.length) { files = []; drawFiles(); } } // before the card reads it
    render(s);
    if (first) { fit(); send.disabled = text.disabled || (!text.value.trim() && !files.length); }
    if (first && pendingFind) { const q = pendingFind; pendingFind = ''; openFind(q); }
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
    fit(); send.disabled = !current || current.demo || (!text.value.trim() && !files.length); requestAnimationFrame(fitWindow); });
  text.addEventListener('input', () => { if (askKey && current.ask && current.ask.kind === 'tool') planButtons(); });
  // Its permission mode under the field, as the terminal shows it; ⇧⇥ (or
  // a tap) changes it in a session Blaube started.
  const MODES = { default: 'Asks before edits', acceptEdits: '⏵⏵ Accepting edits', plan: '⏸ Plan first', bypassPermissions: 'Bypassing permissions', dontAsk: 'Not asking first', auto: 'Auto mode' };
  const CYCLE = ['default', 'acceptEdits', 'plan'];
  function renderMode(s) {
    const m = $('mode'), mode = s.mode || 'default';
    const shown = s.canMode || mode !== 'default';
    // (How full its context is, once that's worth knowing.)
    const full = s.context >= 50 ? `${s.context}% context` : '';
    const about = [s.model, full, s.limit].filter(Boolean).join(' · '); // (and your usage limit, once it's close)
    m.hidden = !!s.ended || !!s.demo || (!shown && !about);
    m.className = 'mode ' + mode + (s.canMode ? ' can' : '');
    m.textContent = '';
    // (Which model it is, first: Opus 5.5 · Accepting edits.)
    if (about) { const n = document.createElement('span'); n.className = 'model' + (s.context >= 80 || /reached/.test(s.limit || '') ? ' full' : ''); n.textContent = about + (shown ? ' · ' : ''); m.append(n); }
    if (shown) m.append(MODES[mode] || mode);
    if (s.canMode) { const k = document.createElement('kbd'); k.textContent = '⇧⇥'; m.append(k); }
    m.title = s.canMode ? 'Change how it asks (Shift+Tab)' : 'Change it in its terminal (Shift+Tab there)';
  }
  function nextMode() {
    if (!current || !current.canMode || !api.mode) return;
    api.mode(current.id, CYCLE[(CYCLE.indexOf(current.mode || 'default') + 1) % CYCLE.length]);
  }
  $('mode').addEventListener('click', nextMode);
  text.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || !current || !current.canMode || !$('suggest').hidden) return;
    e.preventDefault();
    nextMode();
  });
  // "@" suggests the session's files and "/" at the start its commands, as
  // in the terminal: ↑↓ to choose, Tab or ↩ to put it in, Esc to leave it.
  const suggestEl = $('suggest');
  let sugg = { items: [], at: 0, from: 0 }, suggAsked = 0;
  function suggestToken() {
    const c = text.selectionStart;
    if (c !== text.selectionEnd) return null;
    const before = text.value.slice(0, c);
    let m = /(^|\s)@([^\s@]*)$/.exec(before);
    if (m) return { kind: 'file', q: m[2], from: c - m[2].length - 1 };
    m = /^\/([\w:-]*)$/.exec(before);
    if (m) return { kind: 'command', q: m[1], from: 0 };
    return null;
  }
  async function suggest() {
    const t = current && !current.demo && api.complete ? suggestToken() : null;
    const n = ++suggAsked;
    if (!t) return drawSuggest([]);
    const items = await api.complete(current.id, t.kind, t.q);
    if (n !== suggAsked) return;
    sugg = { items, at: 0, from: t.from };
    drawSuggest(items);
  }
  function drawSuggest(items) {
    if (!items.length) sugg.items = [];
    const was = !suggestEl.hidden;
    suggestEl.hidden = !items.length;
    suggestEl.textContent = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'option');
      if (i === sugg.at) b.className = 'on';
      const name = document.createElement('span'); name.className = 'pick'; name.textContent = it.label;
      b.append(name);
      if (it.about) { const a = document.createElement('span'); a.className = 'about'; a.textContent = it.about; b.append(a); }
      b.addEventListener('mousedown', (e) => e.preventDefault()); // (keeps the field focused)
      b.addEventListener('click', () => pickSuggestion(i));
      li.append(b); suggestEl.append(li);
    });
    if (was !== !suggestEl.hidden || items.length) requestAnimationFrame(fitWindow);
  }
  function pickSuggestion(i) {
    const it = sugg.items[i];
    if (!it) return;
    const c = text.selectionStart;
    text.value = text.value.slice(0, sugg.from) + it.insert + text.value.slice(c);
    const at = sugg.from + it.insert.length;
    text.setSelectionRange(at, at);
    drawSuggest([]);
    text.dispatchEvent(new Event('input'));
  }
  text.addEventListener('input', suggest);
  text.addEventListener('blur', () => { suggAsked++; drawSuggest([]); });
  text.addEventListener('keydown', (e) => {
    if (suggestEl.hidden || !sugg.items.length || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = sugg.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') sugg.at = (sugg.at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n, drawSuggest(sugg.items);
    else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) pickSuggestion(sugg.at);
    else if (e.key === 'Escape') { suggAsked++; drawSuggest([]); }
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  });
  // ↑ in an empty field brings back what you said before (↓ goes forward
  // again), as in the terminal.
  let recall = -1;
  text.addEventListener('input', () => { recall = -1; });
  text.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && current && $('ask').hidden
      && (recall >= 0 ? text.selectionStart === text.value.length : !text.value)) {
      const said = current.log.filter((m) => m.who === 'you' && m.text).map((m) => m.text).reverse();
      const next = recall + (e.key === 'ArrowUp' ? 1 : -1);
      if (next < -1 || next >= said.length || (next === -1 && recall === -1)) return;
      e.preventDefault();
      recall = next;
      text.value = next === -1 ? '' : said[next];
      text.dispatchEvent(new Event('input'));
      recall = next; // (the input above reset it)
      text.setSelectionRange(text.value.length, text.value.length);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      if ((e.metaKey || e.ctrlKey) && !text.value.trim()) return; // ⌘↩ on an empty field is for the card
      e.preventDefault(); $('form').requestSubmit();
    }
  });
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    suggAsked++; drawSuggest([]); // (one still on its way stays away too)
    const typed = text.value.trim();
    if ((!typed && !files.length) || !current || current.demo) return;
    // Pasted or dropped files go along as paths Claude can open.
    const v = files.length ? `${typed}${typed ? '\n\n' : ''}${files.length === 1 ? 'Attached file' : 'Attached files'} (open with your Read tool): ${files.map((f) => f.path).join(', ')}` : typed;
    const forFiles = files.length;
    files = []; drawFiles();
    // A card is up and you typed this after it came: it's for the card.
    const ask = askKey && current.ask;
    const forCard = ask && !forFiles && typedForCard();
    if (forCard && ask.kind === 'plan') {
      text.value = ''; fit(); drafts.delete(current.id);
      return finish('deny', { message: v }); // what to change
    }
    if (forCard && ask.kind === 'tool') {
      text.value = ''; fit(); drafts.delete(current.id);
      return finish('deny', { message: v }); // no, and do this instead
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
  // Images pasted into the field, and files dropped on the box: chips
  // above the field, sent with the message as paths Claude can open.
  let files = [];
  function drawFiles() {
    const box = $('files');
    box.textContent = '';
    box.hidden = !files.length;
    files.forEach((f, i) => {
      const chip = document.createElement('span');
      chip.className = 'file';
      chip.textContent = f.name;
      chip.title = f.path;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.setAttribute('aria-label', 'Remove ' + f.name);
      x.onclick = () => { files.splice(i, 1); drawFiles(); };
      chip.append(x);
      box.append(chip);
    });
    if (current) send.disabled = text.disabled || (!text.value.trim() && !files.length);
    requestAnimationFrame(fitWindow);
  }
  const addFile = (path, name) => { if (path && !files.some((f) => f.path === path)) { files.push({ path, name: name || path.split(/[\\/]/).pop() }); drawFiles(); } };
  $('attach').addEventListener('click', () => {
    if (!current || current.demo || !api.attach) return;
    api.attach(current.id).then((paths) => { for (const p of paths || []) addFile(p); text.focus(); });
  });
  text.addEventListener('paste', async (e) => {
    if (!current || text.disabled || !api.paste) return;
    const items = [...(e.clipboardData ? e.clipboardData.items : [])].filter((it) => it.kind === 'file' && /^image\//.test(it.type));
    if (!items.length) return;
    e.preventDefault();
    const into = current.id; // (if you hop to another slime meanwhile, it isn't theirs)
    for (const it of items) {
      const f = it.getAsFile();
      if (!f) continue;
      const saved = await api.paste(into, new Uint8Array(await f.arrayBuffer()), f.type);
      if (saved && current && current.id === into) addFile(saved, `Image ${files.filter((x) => /^Image /.test(x.name)).length + 1}`);
    }
  });
  document.addEventListener('dragover', (e) => { if (current && !text.disabled) { e.preventDefault(); document.body.classList.add('dropping'); } });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dropping');
    if (!current || text.disabled || !api.pathOf) return;
    for (const f of e.dataTransfer.files) addFile(api.pathOf(f), f.name);
    text.focus();
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
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    if (document.body.classList.contains('overview')) return showOverview(false); // back to the chat first
    close();
  });
  $('close').addEventListener('click', close);
  $('terminal').addEventListener('click', () => api.terminal());
  $('stop').addEventListener('click', () => { if (current && api.stop) { $('stop').disabled = true; api.stop(current.id); } });
  // ⌘. (Ctrl+. elsewhere) stops it too, as cancelling does on a Mac.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '.' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const stop = $('stop');
    if (stop.hidden || stop.disabled) return;
    e.preventDefault();
    stop.click();
  });
  const decide = (choice) => () => {
    if (!askKey) return;
    const ask = current.ask;
    if (ask && ask.kind === 'question') return answer(ask);
    // On a plan, what you typed after it came is what to change (the go-ahead
    // buttons wait while there's a note).
    if (ask && ask.kind === 'tool' && choice === 'deny' && typedForCard()) {
      const note = text.value.trim();
      text.value = ''; fit(); drafts.delete(current.id);
      return finish('deny', { message: note });
    }
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
  // The card from the keyboard: ⌘↩ allows (or goes ahead), ⇧⌘↩ always,
  // ⌘⌫ denies (or keeps planning). Arrow keys move between options.
  document.addEventListener('keydown', (e) => {
    // (Not when ↩ just sent what you typed: that was a message, not a yes.)
    if (!askKey || !current || !current.ask || $('ask').hidden || e.isComposing || e.defaultPrevented) return;
    if (document.activeElement === text && text.value.trim()) return;
    const mod = e.metaKey || e.ctrlKey;
    const press = (id) => { const b = $(id); if (b && !b.hidden && !b.disabled) { e.preventDefault(); b.click(); } };
    if (mod && e.key === 'Enter' && current.ask.kind !== 'question') return press(e.shiftKey ? 'always' : 'allow');
    if (mod && e.key === 'Backspace' && current.ask.kind !== 'question' && !(document.activeElement === text && text.value)) return press('deny');
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement && document.activeElement.classList.contains('opt')) {
      const all = [...document.querySelectorAll('#askQuestions .opt:not(:disabled)')];
      const at = all.indexOf(document.activeElement);
      const next = all[at + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); }
    }
  });
  const mac = navigator.platform.startsWith('Mac');
  $('allow').title = mac ? '⌘↩' : 'Ctrl+Enter';
  $('deny').title = mac ? '⌘⌫' : 'Ctrl+Backspace';
  $('always').title += mac ? ' (⇧⌘↩)' : ' (Ctrl+Shift+Enter)';
  $('allow').addEventListener('click', decide('allow'));
  $('deny').addEventListener('click', decide('deny'));
  $('always').addEventListener('click', decide('always'));
})();
