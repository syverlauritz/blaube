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
  let editing = null; // (one of yours you're changing: { id, uuid })
  let drawn = { entries: [], thinking: -1, open: '', hist: '' }, ends = [], histEnd = null; // what the log shows, and each entry's last element
  const dots = document.createElement('div'); // the slime thinking
  dots.className = 'dots';
  // What it's doing, and how long it's been at it ("Editing face.js · 1m 20s"), as the terminal counts.
  const tickDoing = () => {
    const el = dots.querySelector('.doing');
    const t = current && current.state === 'working' && current.turnStart ? Math.floor((Date.now() - current.turnStart) / 1000) : 0;
    const took = t >= 10 ? (t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${t % 60}s`) : '';
    el.textContent = [el.dataset.doing || 'Thinking…', took].filter(Boolean).join(' · ');
  };
  setInterval(() => { if (current && current.state === 'working') tickDoing(); }, 1000);
  dots.innerHTML = '<i></i><i></i><i></i><span class="doing"></span><button class="bgit" type="button" hidden title="Let it carry on in the background (Ctrl+B in the terminal)">Run in background</button><ul class="helpers"></ul>'; // and what it's doing ("Editing face.js"), and its helpers
  dots.querySelector('.bgit').onclick = (e) => { e.currentTarget.hidden = true; if (current) api.background(current.id); };
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
    if (Number.isFinite(tail.x)) { root.setProperty('--ox', tail.x + 'px'); root.setProperty('--oy', tail.y + 'px'); } // (where it is now, as its slime moves)
    else if (tail.side === 'bottom') { root.setProperty('--ox', tail.at + 'px'); root.setProperty('--oy', '100%'); }
    else { root.setProperty('--ox', tail.side === 'left' ? '0px' : '100%'); root.setProperty('--oy', tail.at + 'px'); }
  }

  function hint(s) {
    if (s.demo) return 'Demo blobs can’t talk back. Try a real session!';
    if (s.ended) return (s.log.some((m) => m.status === 'unsent') ? `${s.project} has ended, so what you sent last didn’t go in.` : `${s.project} has ended.`) + (s.cwd ? ' Pick it up here to keep going.' : ' Right-click its blob next time to resume it in a new terminal.');
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

  // Markdown, built as elements (never as HTML): paragraphs, headings,
  // lists (nested too), quotes, tables, rules and code blocks; in a line,
  // `code`, **bold**, *italic* and links. Line breaks inside a paragraph
  // are kept, as the terminal keeps them.
  function rich(el, src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    let para = null, quote = null, stack = []; // the paragraph or quote being added to, and the lists open
    const end = () => { para = null; quote = null; stack = []; };
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m = /^\s*(```|~~~)/.exec(line);
      if (m) {
        // A code block copies in one tap.
        const body = [];
        for (i++; i < lines.length && !lines[i].trim().startsWith(m[1]); i++) body.push(lines[i]);
        end();
        const pre = document.createElement('pre');
        pre.textContent = body.join('\n');
        const box = document.createElement('div');
        box.className = 'code';
        box.append(pre, copyButton(() => pre.textContent));
        el.append(box);
        continue;
      }
      if (!line.trim()) { end(); continue; }
      if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
        end();
        const h = document.createElement(m[1].length <= 2 ? 'h3' : m[1].length === 3 ? 'h4' : 'h5');
        h.className = 'head';
        inline(h, m[2]);
        el.append(h);
        continue;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { end(); el.append(document.createElement('hr')); continue; }
      // A table: a row of cells, then a row of dashes under it.
      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
        end();
        const box = document.createElement('div');
        box.className = 'tablebox';
        const table = document.createElement('table');
        const row = (list, tag) => { const tr = document.createElement('tr'); for (const c of list) { const td = document.createElement(tag); inline(td, c); tr.append(td); } return tr; };
        const head = document.createElement('thead');
        head.append(row(cells(line), 'th'));
        const body = document.createElement('tbody');
        for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) body.append(row(cells(lines[i]), 'td'));
        i--;
        table.append(head, body);
        box.append(table);
        el.append(box);
        continue;
      }
      if ((m = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/.exec(line))) {
        para = null; quote = null;
        const indent = m[1].replace(/\t/g, '  ').length, kind = /\d/.test(m[2]) ? 'OL' : 'UL';
        while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
        let top = stack[stack.length - 1];
        if (!top || indent > top.indent || top.list.tagName !== kind) {
          const list = document.createElement(kind.toLowerCase());
          if (kind === 'OL' && parseInt(m[2], 10) !== 1) list.start = parseInt(m[2], 10);
          if (top && indent > top.indent && top.list.lastElementChild) top.list.lastElementChild.append(list);
          else { if (top) stack.pop(); el.append(list); }
          top = { indent, list };
          stack.push(top);
        }
        const li = document.createElement('li');
        inline(li, m[3]);
        top.list.append(li);
        continue;
      }
      // An indented line under a list item goes on with it.
      if (stack.length && /^\s+\S/.test(line)) {
        const li = stack[stack.length - 1].list.lastElementChild;
        li.append('\n');
        inline(li, line.trim());
        continue;
      }
      if ((m = /^\s*>\s?(.*)$/.exec(line))) {
        para = null; stack = [];
        if (quote) quote.append('\n');
        else { quote = document.createElement('blockquote'); el.append(quote); }
        inline(quote, m[1]);
        continue;
      }
      quote = null; stack = [];
      if (para) para.append('\n');
      else { para = document.createElement('p'); el.append(para); }
      inline(para, line);
    }
  }

  // A line's own formatting: `code`, **bold**, *italic*, and links.
  function inline(el, text) {
    for (const bit of String(text).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|(?<![\w*])\*(?![\s*])[^*\n]*?[^\s*]\*(?![\w*]))/)) {
      if (!bit) continue;
      if (bit[0] === '`') { const c = document.createElement('code'); c.textContent = bit.slice(1, -1); if (PATHLIKE.test(c.textContent)) c.dataset.path = c.textContent; el.append(c); }
      else if (bit.startsWith('**')) { const b = document.createElement('b'); b.textContent = bit.slice(2, -2); el.append(b); }
      else if (bit[0] === '*' && bit.length > 2 && bit.endsWith('*')) { const e = document.createElement('em'); e.textContent = bit.slice(1, -1); el.append(e); }
      else links(el, bit);
    }
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
    const at = code.closest('.msg > *, .asidea > *') || code.closest('.msg'); // (right under the block that names it)
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
      reveal.type = 'button'; reveal.textContent = 'Show in ' + (navigator.platform.startsWith('Mac') ? 'Finder' : 'folder'); reveal.title = 'Show it in ' + (navigator.platform.startsWith('Mac') ? 'Finder' : 'its folder');
      reveal.onclick = () => api.reveal(id, f.path);
      const close = document.createElement('button');
      close.type = 'button'; close.textContent = 'Close'; close.title = 'Close it';
      close.onclick = () => { box.remove(); fitWindow(); };
      // (And your code editor, at that line.)
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'ined'; edit.textContent = current && current.editor ? `Open in ${current.editor}` : '';
      edit.title = 'Open it in your editor' + (line ? `, at line ${line}` : '');
      edit.hidden = !(current && current.editor);
      edit.onclick = () => api.openInEditor(id, rel, line);
      head.append(name, edit, reveal, close);
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

  // What came before this box's own log, from its transcript: the newest
  // page as it opens, each earlier one on a tap at the top (Show earlier).
  // Drawn just like the live log, which takes over where it begins (see
  // shared/talkHistory.js). Kept per session while Blaube runs.
  const pages = new Map(); // session id -> { entries, from (0: nothing earlier), loading }
  function loadHistory(id, more) {
    const p = pages.get(id);
    if (!api.history || (p && p.loading) || (more && !(p && p.from > 0))) return;
    if (p) p.loading = true; else pages.set(id, { entries: [], from: 0, loading: true });
    api.history(id, more ? p.from : undefined).then((r) => {
      const had = pages.get(id) || { entries: [] };
      const got = r && Array.isArray(r.entries) ? r : { entries: [], from: 0 };
      pages.set(id, { entries: more ? got.entries.concat(had.entries) : got.entries, from: got.from || 0, loading: false });
      if (!current || current.id !== id) return;
      const keep = log.scrollHeight - log.scrollTop;
      drawn.entries = []; render(current);
      if (more) log.scrollTop = log.scrollHeight - keep; // (what you were reading stays put)
    });
  }
  const historyOf = (s) => {
    const p = !s.demo && s.earlier && pages.get(s.id);
    return p ? BlaubeTalkHistory.shown(p.entries, s.log) : [];
  };
  // Draws it; returns its last element (null: nothing drawn).
  function drawHistory(s, hist) {
    const p = pages.get(s.id);
    if (!p || s.demo || !s.earlier) return null;
    if (p.from > 0) {
      const b = document.createElement('button');
      b.className = 'earlierbtn';
      b.type = 'button';
      b.textContent = p.loading ? 'Loading…' : 'Show earlier';
      b.disabled = !!p.loading;
      b.onclick = () => { b.disabled = true; b.textContent = 'Loading…'; loadHistory(s.id, true); };
      inner.append(b);
    }
    let last = null;
    for (const m of hist) {
      if (m.who === 'step') { last = addStep(m, false); continue; }
      const nodes = message(m, false);
      inner.append(...nodes);
      last = nodes[nodes.length - 1];
    }
    return last;
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
        more.textContent = run.classList.contains('open') ? 'Hide earlier steps' : `Show ${early} earlier step${early === 1 ? '' : 's'}`;
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
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = m.text;
    e.append(what);
    if (m.ok === false) { const f = document.createElement('span'); f.className = 'fail'; f.textContent = 'Failed'; e.append(f); }
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
    // A question asked on the side (/btw), and its answer.
    if (m.who === 'note' && m.aside) {
      const e = document.createElement('div');
      e.className = 'aside';
      const q = document.createElement('div');
      q.className = 'asideq';
      q.textContent = m.aside.question;
      const a = document.createElement('div');
      a.className = 'asidea';
      rich(a, m.aside.answer);
      markPaths(a);
      e.append(q, a);
      return [e];
    }
    // (Where its context was compacted, in a conversation from its transcript.)
    if (m.who === 'note' && m.divider) {
      const e = document.createElement('div');
      e.className = 'since old';
      e.textContent = m.text;
      return [e];
    }
    if (m.who === 'note') {
      const e = document.createElement('div');
      // (A long one, such as /help or /permissions, wraps: it's worth reading.)
      e.className = 'note' + (m.error ? ' error' : '') + (String(m.text || '').length > 40 ? ' long' : '');
      e.textContent = m.text;
      // (/status: everything Claude Code's own /status says, a tap away.)
      if (Array.isArray(m.sections) && m.sections.length) {
        const more = document.createElement('details');
        more.className = 'statusmore';
        const sum = document.createElement('summary');
        sum.textContent = 'Show all of it';
        more.append(sum);
        for (const x of m.sections) {
          const h = document.createElement('div');
          h.className = 'stitle';
          h.textContent = x.title;
          const dl = document.createElement('dl');
          for (const w of x.rows) {
            const dt = document.createElement('dt');
            dt.textContent = w.label;
            const dd = document.createElement('dd');
            dd.textContent = w.value;
            dl.append(dt, dd);
          }
          more.append(h, dl);
        }
        more.addEventListener('toggle', () => requestAnimationFrame(fitWindow));
        e.append(more);
      }
      // (/context: a bar of what fills it, as the terminal draws it.)
      if (m.context && m.context.max) {
        e.classList.add('context');
        const bar = document.createElement('div');
        bar.className = 'ctxbar';
        const keys = document.createElement('div');
        keys.className = 'ctxkeys';
        m.context.parts.forEach((p, i) => {
          const seg = document.createElement('span');
          seg.className = 'seg ' + p.kind;
          if (p.kind === 'used') seg.style.setProperty('--i', i);
          seg.style.width = (100 * p.tokens / m.context.max).toFixed(2) + '%';
          seg.title = p.label;
          bar.append(seg);
          const k = document.createElement('span');
          k.className = 'key ' + p.kind;
          if (p.kind === 'used') k.style.setProperty('--i', i);
          k.textContent = p.label;
          keys.append(k);
        });
        e.append(bar, keys);
      }
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
      t.textContent = 'Not sent';
      out.push(t);
    }
    if (m.status === 'queued') {
      const t = document.createElement('div');
      t.className = 'meta';
      t.textContent = current.inbox === 'unknown' ? (current.typeable ? 'Waiting: goes in when it’s free · ' : `Waiting for ${current.project} to pick this up · `)
        : current.stoppable && current.state === 'working' && !current.stopping ? 'Waiting: goes in at its next step · ' : 'Waiting: goes in after this turn · ';
      const undo = document.createElement('button');
      undo.className = 'unsend';
      undo.textContent = 'Unsend';
      undo.onclick = () => api.unsend(current.id, m.n);
      t.append(undo);
      out.push(t);
    }
    // Your own, in a session Blaube started: change it (Esc Esc in the
    // terminal), going back to before it.
    if (m.who === 'you' && m.uuid && (m.status === 'sent' || !m.status) && current.owned && api.editFrom) {
      const t = document.createElement('div');
      t.className = 'meta edit';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'unsend';
      b.textContent = 'Edit';
      b.title = 'Change this: it goes back to before it (its files too), then what you write goes instead';
      b.onclick = () => startEdit(m);
      t.append(b);
      out.push(t);
    }
    if (m.via === 'terminal') e.title = 'Typed in the terminal';
    // Under a reply: what its turn came to (the files show in Finder); on
    // it, a copy button.
    if (m.who === 'claude') {
      const t = document.createElement('div');
      t.className = 'turnmeta';
      const bits = [];
      if (m.turn && m.turn.took >= 60e3) bits.push('Took ' + took(m.turn.took));
      if (m.turn && m.turn.steps) bits.push(`${m.turn.steps} step${m.turn.steps === 1 ? '' : 's'}`);
      t.append(bits.join(' · '));
      const files = (m.turn && m.turn.files) || [];
      files.slice(0, 4).forEach((f, i) => {
        t.append(i ? ', ' : (bits.length ? ' · ' : '') + 'Changed ');
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
        undo.dataset.label = 'Undo';
        undo.title = `Ask Claude to undo what it changed in ${b.textContent}`;
        undo.setAttribute('aria-label', undo.title);
        undo.onclick = () => { if (current && !undo.disabled) { undo.disabled = true; api.send(current.id, `Undo the changes you made to ${f} in that last turn, and tell me what you put back.`); } };
        t.append(undo);
      });
      if (files.length > 4) t.append(` and ${files.length - 4} more`);
      // More than one file: undo the whole turn in one go. (In a session
      // Blaube started, the last turn's are put back by Claude Code itself.)
      const rewind = m.turn && m.turn.rewind && current.owned && isLastTurn(m) ? m.turn.rewind : '';
      if (files.length > 1 || (rewind && files.length)) {
        const all = document.createElement('button');
        all.className = 'undo all';
        all.type = 'button';
        all.dataset.label = 'Undo all';
        all.title = `Ask Claude to undo everything it changed in that turn (${files.length} files)`;
        all.setAttribute('aria-label', all.title);
        if (rewind) all.title = `Put back everything it changed in that turn (${files.length === 1 ? files[0] : files.length + ' files'})`;
        all.onclick = async () => {
          if (!current || all.disabled) return;
          all.disabled = true;
          const id = current.id;
          if (rewind && api.rewind && await api.rewind(id, rewind)) return;
          api.send(id, `Undo all the changes you made in that last turn (${files.join(', ')}), and tell me what you put back.`);
        };
        t.append(all);
      }
      if (bits.length || files.length) out.push(t);
      const c = copyButton(() => m.text, 'Copy reply');
      c.classList.add('copyreply');
      e.append(c);
      // Pass it on to another session ("tell the website what the API
      // changed"), instead of copying between terminals.
      const others = (current.others || []).filter((o) => o.id !== current.id && !o.demo);
      if (others.length && api.forward) {
        const f = document.createElement('button');
        f.type = 'button';
        f.className = 'copy fwd';
        f.dataset.label = 'Send to…';
        f.setAttribute('aria-label', 'Send this reply to another session');
        f.title = 'Send this reply to another session';
        f.onclick = (ev) => {
          ev.stopPropagation();
          const open = e.querySelector('.fwdmenu');
          if (open) { open.remove(); return; }
          const menu = document.createElement('div');
          menu.className = 'fwdmenu';
          for (const o of (current.others || []).filter((x) => x.id !== current.id)) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = o.shownName || o.project;
            b.style.setProperty('--c', o.color);
            b.onclick = (ev2) => { ev2.stopPropagation(); menu.remove(); api.forward(current.id, o.id, m.text); };
            menu.append(b);
          }
          e.append(menu);
          requestAnimationFrame(fitWindow);
        };
        e.append(f);
      }
    }
    return out;
  }

  // Is this the reply that ended its latest turn? (Only that turn's changes
  // can be put back by themselves.)
  const isLastTurn = (m) => {
    const l = (current && current.log) || [];
    for (let i = l.length - 1; i >= 0; i--) if (l[i].who === 'claude' && l[i].turn) return l[i].turn.rewind === m.turn.rewind;
    return false;
  };
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
    if (switched && editing && editing.id !== s.id) stopEdit(true);
    $('name').textContent = s.project;
    $('name').title = s.project;
    $('state').textContent = WORDS[s.state] || s.state;
    $('dot').style.background = DOTS[s.state] || DOTS.idle;
    $('stateChip').className = 'state ' + s.state;
    $('stateChip').hidden = !!s.demo;
    // Its name beside the folder's (double-click either to rename it).
    $('subname').hidden = !s.shownSub;
    $('subname').textContent = s.shownSub || '';
    const root = document.documentElement.style;
    const color = s.color || '#d97757';
    root.setProperty('--color', color);
    // White on the slime's colour only where it reads; ink otherwise.
    root.setProperty('--on', contrast(color, '#ffffff') >= 4.5 ? '#fff' : '#1b2440');
    if (s.tail) placeTail(s.tail);
    kept = !!s.pinned;
    document.body.classList.toggle('dark', !!s.dark);
    $('theme').setAttribute('aria-pressed', String(!!s.dark));
    $('theme').title = s.dark ? 'Light mode' : 'Dark mode';
    $('pin').classList.toggle('on', kept);
    $('pin').setAttribute('aria-pressed', String(kept));
    $('pin').title = kept ? 'Pinned: it stays open. Click to let it close when you click away' : 'Keep it open (pin it), and move it by its top';
    $('terminal').style.display = s.demo || s.ended || s.owned ? 'none' : '';
    const stop = $('stop');
    stop.hidden = !(s.stoppable && s.state === 'working' && !s.ended);
    stop.title = (s.owned ? 'Stop it now' : 'It stops before its next step') + (navigator.platform.startsWith('Mac') ? ' (⌘.)' : ' (Ctrl+.)');
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
    renderMcp(s);
    renderQuick(s);
    renderAsk(s.ask, s.asks);
    $('hint').textContent = hint(s);
    text.disabled = !!s.demo || (!s.connected && !s.typeable) || !!s.ended;
    text.placeholder = s.ask && s.ask.kind === 'question' ? (s.ask.questions.length === 1 ? 'Or type your answer…' : 'Write a message for after this…')
      : s.ask && s.ask.kind === 'plan' ? 'What should change in the plan?'
      : !s.owned && s.state === 'working' && s.stoppable && !s.stopping ? 'Add to what it’s doing…'
      : !s.owned && (s.state === 'working' || s.state === 'waiting') ? 'Write a message for when it’s done…' : `Message ${s.demo ? 'it' : s.project}…`;
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
    dots.querySelector('.doing').dataset.doing = s.doing || '';
    tickDoing();
    dots.querySelector('.bgit').hidden = !s.canBackground || !api.background;
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
        li.append(b, h.waiting ? ' needs you' : h.doing ? `: ${h.doing}` : '');
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
    // (And what came before it, from its transcript, once that's read.)
    if (s.earlier && !s.demo && !pages.has(s.id)) loadHistory(s.id);
    const hist = historyOf(s);
    const page = pages.get(s.id);
    const histKey = page && s.earlier && !s.demo ? [hist.length, page.entries.length, page.from, !!page.loading].join() : '';
    const openKey = [...open].join();
    const sel = window.getSelection();
    const selecting = !switched && sel && !sel.isCollapsed && log.contains(sel.anchorNode);
    const extends_ = !switched && openKey === drawn.open && histKey === drawn.hist && drawn.entries.length > 0 && entries.length >= drawn.entries.length
      && drawn.entries.every((j, i) => j === entries[i]);
    const changed = switched || !extends_ || entries.length !== drawn.entries.length || thinking !== drawn.thinking;
    if (changed && (!selecting || switched)) {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      const from = extends_ ? drawn.entries.length : 0;
      dots.remove();
      if (!extends_) {
        inner.textContent = '';
        ends = [];
        histEnd = drawHistory(s, hist);
        if (!s.log.length && !hist.length && !s.ask && (s.connected || s.typeable || s.owned)) {
          const e = document.createElement('div');
          e.className = 'empty';
          e.textContent = s.owned ? `What should we do in ${s.project}?` : `Say hi to ${s.project}! It hears you even when you’re not at its terminal.`;
          inner.append(e);
        }
      } else if (from === 0) { inner.textContent = ''; histEnd = drawHistory(s, hist); }
      // Where what came in since you last looked begins (when replies did).
      const since = s.lookedAt ? s.log.findIndex((m, i) => i > 0 && m.at > s.lookedAt && s.log[i - 1].at <= s.lookedAt) : -1;
      const sinceShows = since > 0 && s.log.slice(since).some((m) => m.who === 'claude');
      for (let i = from; i < s.log.length; i++) {
        if (i === since && sinceShows) { const d = document.createElement('div'); d.className = 'since'; d.textContent = 'New since you last looked'; inner.append(d); }
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
        if (a >= 0 && ends[a]) ends[a].after(dots); else if (histEnd && histEnd.isConnected) histEnd.after(dots); else inner.prepend(dots);
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
        if (e.offsetHeight < 560 || open.has(at)) continue; // (taller than most of the box)
        e.classList.add('folded');
        const more = document.createElement('button');
        more.className = 'more';
        more.textContent = 'Show more';
        more.onclick = () => { open.add(at); drawn.entries = []; render(current); };
        e.after(more);
      }
      drawn = { entries, thinking, open: openKey, hist: histKey };
      if (atBottom || switched) log.scrollTop = log.scrollHeight;
    }
    if (!$('findBar').hidden && $('find').value.trim()) find($('find').value);
    fitWindow(); // reading sizes lays it out, even while hidden
    squeeze();
  }

  // A tab per session, its colour and its name; a tap (or ⌘[ ⌘], ⌘1–9)
  // hops to its talk box. All sessions opens the overview.
  function renderOthers(s) {
    const box = $('others');
    const list = s.demo ? [] : (s.others || []);
    const all = $('allSessions');
    all.hidden = !!s.demo;
    const waiting = list.filter((o) => o.id !== s.id && o.state === 'waiting').length;
    const count = $('sessionCount');
    count.hidden = list.length < 2;
    count.textContent = waiting ? `${waiting} need${waiting === 1 ? 's' : ''} you` : String(list.length);
    count.classList.toggle('wants', !!waiting);
    const key = JSON.stringify([s.id, list.map((o) => [o.id, o.color, o.state, o.project, o.shownName])]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    if (list.length < 2) return;
    const how = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';
    list.slice(0, 9).forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.setProperty('--c', o.color);
      b.className = (o.id === s.id ? 'here' : '') + (o.state === 'waiting' ? ' wants' : '');
      const name = document.createElement('span');
      name.textContent = o.shownName || o.project;
      b.append(name);
      if (o.state === 'waiting' && o.id !== s.id) { const w = document.createElement('small'); w.textContent = 'needs you'; b.append(w); }
      b.title = `${o.project}${o.title ? `: ${o.title}` : ''}${o.state === 'waiting' ? ' (needs you)' : ''} · ${how}${i + 1}`;
      if (o.id === s.id) b.setAttribute('aria-current', 'true');
      else b.onclick = () => api.switchTo && api.switchTo(o.id);
      box.append(b);
    });
  }
  $('allSessions').title = `Every session at a glance, and new ones (${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}0)`;
  $('allSessions').addEventListener('click', () => showOverview(!document.body.classList.contains('overview')));

  // Every session at a glance: what it's up to, and the small print. A tap
  // goes to its box. (Redrawn with every update while it's open.)
  function showOverview(on) {
    const was = document.body.classList.contains('overview');
    document.body.classList.toggle('overview', !!(on && current && !current.demo));
    const showing = document.body.classList.contains('overview');
    $('allSessions').setAttribute('aria-expanded', String(showing));
    $('allSessions').firstChild.textContent = showing ? 'Back to the chat' : 'All sessions';
    // (Find means something else in each: start it afresh.)
    if (was !== document.body.classList.contains('overview') && !$('findBar').hidden) { $('find').value = ''; $('findBar').hidden = true; allQuery = ''; allHits = []; find(''); }
    if (on) { drawOverview(current); loadHub(); }
    requestAnimationFrame(fitWindow);
  }
  // Below the sessions: start one in a recent folder, or pick up a past one.
  let hub = null, planFirst = false, ownTree = false, newModel = 'default', forYou = [];
  function loadHub() {
    if (!api.hub) return;
    const redraw = () => { if (document.body.classList.contains('overview') && current) drawOverview(current); };
    api.hub().then((h) => { hub = h; redraw(); });
    // (And what's waiting for you on GitHub, from your gh.)
    if (api.githubTodo) api.githubTodo().then((list) => { if (JSON.stringify(list) !== JSON.stringify(forYou)) { forYou = list || []; redraw(); } });
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
    // Own worktree: it works in a git worktree of its own (claude --worktree),
    // so two sessions in one project don't trip over each other.
    const tree = document.createElement('label');
    tree.className = 'planfirst';
    const tick2 = document.createElement('input');
    tick2.type = 'checkbox';
    tick2.checked = ownTree;
    tick2.onchange = () => { ownTree = tick2.checked; };
    tree.append(tick2, ' Own worktree');
    tree.title = 'It works on a copy of the project in a git worktree of its own, so sessions side by side don’t trip over each other';
    // Its model, as `claude --model` would start it with.
    const modelPick = document.createElement('select');
    modelPick.className = 'newmodel';
    modelPick.title = 'The model it starts with (/model changes it later)';
    modelPick.setAttribute('aria-label', 'Model');
    for (const m of hub.models || []) { const o = document.createElement('option'); o.value = m.value; o.textContent = m.displayName.replace(/\s*\(.*\)$/, ''); o.title = m.displayName; modelPick.append(o); }
    if (![...modelPick.options].some((o) => o.value === newModel)) newModel = modelPick.options[0] ? modelPick.options[0].value : 'default';
    modelPick.value = newModel;
    modelPick.onchange = () => { newModel = modelPick.value; };
    const opts = document.createElement('div');
    opts.className = 'newopts';
    opts.append(plan, tree, modelPick);
    box.append(opts);
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const f of hub.folders) {
      const b = document.createElement('button');
      b.textContent = f.name;
      b.title = f.path;
      b.onclick = () => api.newIn(f.path, { plan: planFirst, worktree: ownTree, model: newModel });
      chips.append(b);
    }
    const pick = document.createElement('button');
    pick.textContent = 'Another folder…';
    pick.className = 'dim';
    pick.onclick = () => api.newIn('pick', { plan: planFirst, worktree: ownTree, model: newModel });
    chips.append(pick);
    // Or a project you don't have yet: cloned, or made, then started in.
    const formChip = (label, placeholder, verb, busy, act) => {
      const cl = document.createElement('button');
      cl.textContent = label;
      cl.className = 'dim';
      cl.onclick = () => {
        const form = document.createElement('form');
        form.className = 'cloneform';
        const input = document.createElement('input');
        input.placeholder = placeholder;
        input.setAttribute('aria-label', placeholder);
        const go = document.createElement('button');
        go.type = 'submit';
        go.textContent = verb;
        const said = document.createElement('div');
        said.className = 'clonesaid';
        form.append(input, go, said);
        form.onsubmit = async (e) => {
          e.preventDefault();
          if (!input.value.trim() || go.disabled) return;
          go.disabled = input.disabled = true;
          go.textContent = busy;
          said.textContent = '';
          const err = await act(input.value.trim(), { plan: planFirst, model: newModel });
          if (!err) return;
          go.disabled = input.disabled = false;
          go.textContent = verb;
          said.textContent = err;
          requestAnimationFrame(fitWindow);
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); form.replaceWith(cl); requestAnimationFrame(fitWindow); } });
        cl.replaceWith(form);
        input.focus();
        requestAnimationFrame(fitWindow);
      };
      chips.append(cl);
    };
    if (api.clone) formChip('Clone a repository…', 'owner/repo, or its address', 'Clone', 'Cloning…', api.clone);
    if (api.newProject) formChip('New project…', 'Its name', 'Make it', 'Making it…', api.newProject);
    if (api.issue) formChip('Work on an issue or PR…', 'An issue’s or PR’s link, or owner/repo#42', 'Start', 'Starting…', api.issue);
    box.append(chips);
    // Issues assigned to you and reviews asked of you: a tap starts a
    // session in your clone (cloned first if need be) to fix or review it.
    if (forYou.length && api.issue) {
      section('For you on GitHub');
      for (const x of forYou) {
        const row = document.createElement('button');
        row.className = 'row past github';
        const name = document.createElement('b');
        name.textContent = x.kind === 'review' ? `Review: ${x.title}` : x.kind === 'mine' ? `Yours: ${x.title}` : x.title;
        const m = document.createElement('small');
        m.textContent = `${x.repo}#${x.number}${x.when ? ` · ${x.when}` : ''}`;
        row.append(name, m);
        row.title = x.kind === 'review' ? 'Starts a session that checks it out and reviews it' : x.kind === 'mine' ? 'Starts a session that gets it ready to merge: its checks, what reviewers said' : 'Starts a session that reads it and fixes it';
        row.onclick = async () => {
          row.disabled = true;
          m.textContent = 'Starting…';
          const err = await api.issue(x.url, { plan: planFirst, model: newModel, mine: x.kind === 'mine' });
          if (err) { row.disabled = false; m.textContent = err; requestAnimationFrame(fitWindow); }
        };
        box.append(row);
      }
    }
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
    // Claude Code is signed out: every session would fail, so say so first.
    if (s.signedOut && api.signIn) {
      const row = document.createElement('div');
      row.className = 'signedout';
      row.textContent = s.signingIn ? 'Signing Claude Code in: finish in your browser…' : 'Claude Code is signed out, so no session can get an answer.';
      if (!s.signingIn) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Sign in'; b.title = 'Signs Claude Code in, in your browser, as /login does'; b.onclick = () => api.signIn(''); row.append(' ', b); }
      box.append(row);
    }
    for (const o of s.others || []) {
      const row = document.createElement('button');
      row.className = 'row' + (o.id === s.id ? ' here' : '') + (o.state === 'waiting' ? ' wants' : '');
      row.style.setProperty('--c', o.color);
      const name = document.createElement('b');
      name.textContent = o.project;
      if (o.shownSub) { const t = document.createElement('i'); t.className = 'title'; t.textContent = o.shownSub; name.append(t); }
      const status = document.createElement('span');
      status.className = 'status';
      status.textContent = o.status || '';
      row.append(name, status);
      if (o.meta) { const m = document.createElement('small'); m.textContent = o.meta; row.append(m); }
      row.onclick = () => { showOverview(false); if (o.id !== s.id && api.switchTo) api.switchTo(o.id); };
      box.append(row);
      // A dev server it runs: open it right here.
      for (const u of o.urls || []) {
        const link = document.createElement('div');
        link.className = 'rowask rowlink';
        const what = document.createElement('span');
        what.textContent = `${u.label} · ${u.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
        const go = document.createElement('button');
        go.type = 'button'; go.textContent = 'Open'; go.title = u.url;
        go.onclick = () => api.openLink(u.url);
        link.append(what, go);
        box.append(link);
      }
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
    const deaf = s.canBring && api.bringHere && (s.offerBring || (!s.typeable && (s.inbox === 'unknown' || !s.connected)));
    const list = s.ended ? (s.cwd && !s.demo && api.continueHere ? [{ label: 'Pick it up here', prompt: 'Keep going with it here, no terminal needed', here: true }] : [])
      : s.ask || s.demo ? []
      : [...(deaf ? [{ label: 'Bring it here', prompt: 'It closes in its terminal and carries on here, conversation and all', bring: true }] : []),
        ...(!s.log.length || (!s.connected && !s.typeable && !s.owned) ? [] : (s.quick || []))].slice(0, 4);
    const key = JSON.stringify(list.map((q) => q.label + (q.run || '') + (q.install ? '!' : '') + (q.env ? '=' : '')));
    box.hidden = !list.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    for (const q of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = q.label;
      b.title = q.run === 'push' ? 'Runs git push right here' : q.run === 'pull' ? 'Runs git pull right here (only if it needs no merge)' : q.run === 'finish' ? `Runs ${q.label === 'Finish the merge' ? 'git commit --no-edit' : `git ${q.label.split(' ').pop()} --continue`} right here` : q.sure ? `${q.prompt} (tap twice)` : q.prompt;
      // (One that can't be taken back asks to be sure: a second tap.)
      let sureAt = 0;
      const was = b.textContent;
      if (q.sure) b.classList.add('careful');
      b.onclick = () => { if (!current) return; if (q.sure && Date.now() - sureAt > 4000) { sureAt = Date.now(); b.textContent = q.sure; b.classList.add('sure'); setTimeout(() => { if (Date.now() - sureAt >= 4000) { b.textContent = was; b.classList.remove('sure'); } }, 4100); return; } if (q.here) api.continueHere(current.id); else if (q.signIn) api.signIn(current.id); else if (q.bring) api.bringHere(current.id); else if ('later' in q) api.later(current.id, q.later); else if (q.run && api.gitRun) api.gitRun(current.id, q.run); else if (q.install && api.install) api.install(current.id); else if (q.env && api.makeEnv) api.makeEnv(current.id); else api.send(current.id, q.prompt); box.hidden = true; };
      box.append(b);
    }
  }

  // Double-click its name to rename it: /rename, ready in the field.
  for (const el of [$('name'), $('subname')]) el.addEventListener('dblclick', () => {
    if (!current || current.demo || current.ended) return;
    const t = $('text');
    t.value = '/rename ' + (current.title || '');
    t.dispatchEvent(new Event('input'));
    t.focus();
    t.setSelectionRange(8, t.value.length);
  });

  // Tap the git line for the files it's changed; tap one to see it.
  // (Its branches too: switch to one, or start a new one.)
  let gitOpen = false, gitFor = '';
  const discardSure = new Map(); // file (or commit) -> when its ↺ (or Undo) was tapped once
  $('git').addEventListener('click', () => { if (!current || !current.git || current.ended) return; gitOpen = !gitOpen; renderGitFiles(current); });
  function renderGitFiles(s) {
    const list = s.ended ? [] : (s.gitFiles || []);
    if (gitFor !== s.id) { gitFor = s.id; gitOpen = false; }
    if (!s.git || s.ended) gitOpen = false;
    const opens = !!s.git && !s.ended && !String(s.id).startsWith('demo-');
    $('git').classList.toggle('opens', opens);
    $('git').setAttribute('aria-expanded', String(gitOpen));
    $('git').title = opens ? (gitOpen ? 'Hide the files and branches' : list.length ? 'Show the changed files and branches' : 'Show its branches') : '';
    renderBranches(s, list);
    const box = $('gitFiles');
    const was = box.hidden;
    box.hidden = !gitOpen;
    const key = JSON.stringify(list) + gitOpen + (s.editor || '') + '|' + (s.putBack || '');
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    // Changes you just discarded: Put back (from git's stash).
    if (gitOpen && s.putBack) {
      const li = document.createElement('li');
      li.className = 'putback';
      const said = document.createElement('span');
      said.textContent = `Discarded ${s.putBack.split('/').pop()}`;
      const back = document.createElement('button');
      back.type = 'button';
      back.textContent = 'Put back';
      back.title = `Brings back your changes to ${s.putBack}`;
      back.onclick = async () => {
        back.disabled = true;
        const err = await api.putBack(current.id);
        if (err) { said.textContent = err; back.remove(); requestAnimationFrame(fitWindow); }
      };
      li.append(said, back);
      box.append(li);
    }
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
        go.textContent = navigator.platform.startsWith('Mac') ? 'Finder' : 'Folder';
        go.title = `Show it in ${navigator.platform.startsWith('Mac') ? 'Finder' : 'its folder'}`;
        go.setAttribute('aria-label', go.title);
        go.onclick = () => api.reveal && api.reveal(current.id, f.path);
        // (✎: in your code editor.)
        const ed = document.createElement('button');
        ed.type = 'button';
        ed.className = 'reveal edit';
        ed.textContent = 'Edit';
        ed.title = `Open it in ${s.editor}`;
        ed.setAttribute('aria-label', ed.title);
        ed.onclick = () => api.openInEditor(current.id, f.path, 0);
        li.append(...(s.editor ? [ed] : []), go, pre);
      }
      // (↺: discard its changes; a second tap to be sure.)
      if (/^(changed|deleted|new)$/.test(f.how) && api.discard) {
        const un = document.createElement('button');
        un.type = 'button';
        un.className = 'reveal discard';
        un.textContent = 'Discard';
        un.title = f.how === 'new' ? 'Discard this new file' : 'Discard your changes to it';
        un.setAttribute('aria-label', un.title);
        // (When it was tapped once, kept across the list being drawn again.)
        if (Date.now() - (discardSure.get(f.path) || 0) < 4000) { un.textContent = 'Discard?'; un.classList.add('sure'); }
        un.onclick = async () => {
          const sure = discardSure.get(f.path) || 0;
          if (Date.now() - sure > 4000) {
            discardSure.clear();
            discardSure.set(f.path, Date.now());
            un.textContent = 'Discard?';
            un.classList.add('sure');
            setTimeout(() => { if (un.isConnected && Date.now() - (discardSure.get(f.path) || 0) >= 4000) { un.textContent = 'Discard'; un.classList.remove('sure'); } }, 4100);
            return;
          }
          discardSure.delete(f.path);
          un.disabled = true;
          const err = await api.discard(current.id, f.path);
          if (err) { un.disabled = false; un.textContent = 'Discard'; un.classList.remove('sure'); un.title = err; b.title = err; }
        };
        const pre = li.querySelector('pre');
        if (pre) li.insertBefore(un, pre); else li.append(un);
      }
      // (In conflict: keep your version or theirs, one tap each.)
      if (f.how === 'conflict' && api.settle) {
        const keeps = [['mine', 'Mine', 'Keep your version of it, dropping their changes to it'], ['theirs', 'Theirs', 'Keep their version of it, dropping your changes to it']].map(([side, label, title]) => {
          const k = document.createElement('button');
          k.type = 'button';
          k.className = 'reveal keep';
          k.textContent = label;
          k.title = title;
          k.onclick = async () => {
            for (const x of keeps) x.disabled = true;
            const err = await api.settle(current.id, f.path, side);
            if (err) { for (const x of keeps) x.disabled = false; k.title = err; b.title = err; }
          };
          return k;
        });
        const pre = li.querySelector('pre');
        for (const k of keeps) if (pre) li.insertBefore(k, pre); else li.append(k);
      }
      box.append(li);
    }
    if (was !== box.hidden || gitOpen) requestAnimationFrame(fitWindow);
  }

  // Under the files: the branch it's on and the others, newest first, to
  // switch to (only while it's not busy and nothing tracked has changed:
  // new files go along), and New branch… to start one here.
  function renderBranches(s, list) {
    const box = $('branches');
    const busy = s.state === 'working' || s.state === 'waiting';
    const dirty = list.some((f) => f.how !== 'new');
    const key = [s.id, gitOpen, s.git, busy, dirty, s.pr ? s.pr.url : '', (s.scripts || []).join()].join('|');
    box.hidden = !gitOpen;
    if (!gitOpen) { box.dataset.key = ''; return; }
    if (box.dataset.key === key) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT' && box.contains(document.activeElement)) return; // (not while you're naming a new branch)
    box.dataset.key = key;
    const draw = String(Number(box.dataset.draw || 0) + 1); // (only the newest draws: a key can come back while an older one's still asking)
    box.dataset.draw = draw;
    const on = String(s.git).split(' · ')[0];
    const said = document.createElement('div');
    said.className = 'clonesaid';
    const why = busy ? 'Switching waits until it’s done.' : '';
    const switchTo = async (name, create, btn) => {
      btn.disabled = true;
      said.textContent = '';
      const err = await api.switchBranch(s.id, name, create);
      btn.disabled = false;
      if (err) { said.textContent = err; requestAnimationFrame(fitWindow); }
    };
    Promise.all([api.branches(s.id), api.parked ? api.parked(s.id) : [], api.merged ? api.merged(s.id) : { names: [] }, api.web ? api.web(s.id) : null, api.stashes ? api.stashes(s.id) : []]).then(([names, parked, done, web, stashed]) => {
      if (box.dataset.key !== key || box.dataset.draw !== draw) return;
      box.textContent = '';
      // Its pull request, a tap from your browser.
      if (s.pr) {
        const p = document.createElement('button');
        p.type = 'button';
        p.className = 'prlink';
        p.textContent = `PR #${s.pr.number}${s.pr.title ? ' · ' + s.pr.title : ''} ↗`;
        p.title = `Open it on GitHub\n${s.pr.url}`;
        p.onclick = () => api.openLink(s.pr.url);
        box.append(p);
      } else if (web) {
        // (Or, pushed, GitHub's own page to open one: no model call.)
        const w = document.createElement('button');
        w.type = 'button';
        w.className = 'prlink web';
        w.textContent = web.label;
        w.title = web.url;
        w.onclick = () => api.openLink(web.url);
        box.append(w);
      }
      const label = document.createElement('span');
      label.className = 'branchon';
      label.textContent = 'Branches';
      box.append(label);
      for (const n of names.slice(0, 8)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = n;
        if (n === on) { b.className = 'on'; b.disabled = true; b.title = 'It’s on this branch'; } else {
          b.disabled = !!why;
          b.title = why || (dirty ? `Switch to ${n}: your changes here are set aside, and come back when you switch back` : `Switch to ${n}`);
          // (Changes set aside on it: they come back with it.)
          if (parked.includes(n)) { b.classList.add('parked'); b.title += '\nIt has changes set aside: they come back when you switch to it'; }
          b.onclick = () => switchTo(n, false, b);
        }
        box.append(b);
      }
      // (Branches already merged: tidied away in a tap, two to be sure.)
      const extra = [];
      if (done.names.length) {
        const row = document.createElement('div');
        row.className = 'behindrow merged';
        const said = document.createElement('span');
        said.textContent = `${done.names.length} branch${done.names.length === 1 ? '' : 'es'} already merged into ${done.base}`;
        said.title = done.names.join('\n');
        const go = document.createElement('button');
        go.type = 'button';
        go.textContent = 'Delete them';
        go.title = `Deletes ${done.names.join(', ')} (their work is all in ${done.base})`;
        let sure = 0;
        go.onclick = async () => {
          if (Date.now() - sure > 4000) { sure = Date.now(); go.textContent = 'Delete them?'; go.classList.add('sure'); setTimeout(() => { if (go.isConnected && Date.now() - sure >= 4000) { go.textContent = 'Delete them'; go.classList.remove('sure'); } }, 4100); return; }
          go.disabled = true;
          const gone = await api.deleteMerged(s.id, done.names);
          if (!gone.length) { go.disabled = false; go.textContent = 'Delete them'; go.classList.remove('sure'); said.textContent = 'git wouldn’t delete them'; return; }
          if (row.isConnected) row.remove();
          for (const c of [...box.querySelectorAll(':scope > button')]) if (gone.includes(c.textContent)) c.remove();
          requestAnimationFrame(fitWindow);
        };
        row.append(said, go);
        extra.push(row);
      }
      // (Changes you set aside yourself, git stash: a tap brings them back.)
      for (const x of stashed) {
        const row = document.createElement('div');
        row.className = 'behindrow stashed';
        const what = document.createElement('span');
        what.textContent = `Set aside: ${x.subject} · ${x.when}`;
        what.title = `${x.ref}: ${x.subject}`;
        const back = document.createElement('button');
        back.type = 'button';
        back.textContent = 'Bring back';
        back.disabled = busy || dirty;
        back.title = busy ? 'Once it’s done' : dirty ? 'Commit or set aside your changes here first' : 'Brings these changes back here (git stash pop)';
        back.onclick = async () => {
          back.disabled = true;
          const err = await api.bringBack(s.id, x.ref, x.at);
          if (err) { what.textContent = err; back.disabled = false; requestAnimationFrame(fitWindow); } else { row.remove(); requestAnimationFrame(fitWindow); }
        };
        row.append(what, back);
        extra.push(row);
      }
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'dim';
      add.textContent = 'New branch…';
      add.disabled = busy;
      add.title = busy ? why : 'Start a new branch from here (its changes come along)';
      add.onclick = () => {
        const form = document.createElement('form');
        form.className = 'cloneform';
        const input = document.createElement('input');
        input.placeholder = 'Its name, like fix-login';
        input.setAttribute('aria-label', 'The new branch’s name');
        const go = document.createElement('button');
        go.type = 'submit';
        go.textContent = 'Make it';
        form.append(input, go);
        form.onsubmit = (e) => { e.preventDefault(); if (input.value.trim()) switchTo(input.value.trim(), true, go); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); form.replaceWith(add); requestAnimationFrame(fitWindow); } });
        add.replaceWith(form);
        input.focus();
        requestAnimationFrame(fitWindow);
      };
      box.append(add, said, ...extra);
      // Its scripts (package.json), a tap to run (as /run does).
      if ((s.scripts || []).length) {
        const row = document.createElement('div');
        row.className = 'runrow';
        const run = document.createElement('span');
        run.className = 'branchon';
        run.textContent = 'Run';
        row.append(run);
        box.append(row);
        for (const n of s.scripts) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'script';
          b.textContent = n;
          b.title = `Run its ${n} script (/run ${n})`;
          b.onclick = () => api.send(s.id, `/run ${n}`);
          row.append(b);
        }
      }
      requestAnimationFrame(fitWindow);
      // Then its latest commits: tap one for what it changed.
      return api.commits ? api.commits(s.id) : [];
    }).then((list) => {
      if (box.dataset.key !== key || box.dataset.draw !== draw || !list || !list.length) return;
      const ul = document.createElement('ul');
      ul.className = 'gitfiles commits';
      for (const c of list) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        const name = document.createElement('span');
        name.textContent = c.subject || c.short;
        const when = document.createElement('small');
        when.textContent = c.unpushed ? 'not pushed' : c.when;
        b.append(name, when);
        b.title = `${c.short} · ${c.when}\nTap to see what it changed`;
        b.setAttribute('aria-expanded', 'false');
        const pre = document.createElement('pre');
        pre.className = 'stepout diff';
        pre.hidden = true;
        b.onclick = () => {
          pre.hidden = !pre.hidden;
          b.setAttribute('aria-expanded', String(!pre.hidden));
          if (!pre.hidden && !pre.textContent) api.commit(s.id, c.hash).then((t) => { colorDiff(pre, t || '(can’t show it)'); requestAnimationFrame(fitWindow); });
          requestAnimationFrame(fitWindow);
        };
        li.append(b);
        // (Its newest, pushed nowhere: Undo, twice to be sure.)
        if (c.undoable && api.undoCommit && !busy) {
          const un = document.createElement('button');
          un.type = 'button';
          un.className = 'reveal undo';
          un.textContent = 'Undo';
          un.title = 'Take this commit back, keeping its changes (git reset --soft HEAD~1)';
          // (Tapped once: kept across the list being drawn again.)
          const sureAt = () => discardSure.get(c.hash) || 0;
          if (Date.now() - sureAt() < 4000) { un.textContent = 'Undo it?'; un.classList.add('sure'); }
          un.onclick = async () => {
            if (Date.now() - sureAt() > 4000) { discardSure.clear(); discardSure.set(c.hash, Date.now()); un.textContent = 'Undo it?'; un.classList.add('sure'); setTimeout(() => { if (Date.now() - sureAt() >= 4000) { un.textContent = 'Undo'; un.classList.remove('sure'); } }, 4100); return; }
            discardSure.delete(c.hash);
            un.disabled = true;
            const err = await api.undoCommit(s.id, c.hash);
            if (err) { un.textContent = 'Undo'; un.classList.remove('sure'); un.disabled = false; } // (the box says why; done: its git line changes, and this is drawn again)
          };
          li.append(un);
        } else if (c.revertable && api.revert && !busy) {
          // (Any other, pushed: Revert, a new commit undoing it, twice to be sure.)
          const rv = document.createElement('button');
          rv.type = 'button';
          rv.className = 'reveal revert';
          rv.textContent = 'Revert';
          rv.title = 'Undo what this commit did with a new commit (git revert), history kept';
          const sureAt = () => discardSure.get('revert:' + c.hash) || 0;
          if (Date.now() - sureAt() < 4000) { rv.textContent = 'Revert it?'; rv.classList.add('sure'); }
          rv.onclick = async () => {
            if (Date.now() - sureAt() > 4000) { discardSure.clear(); discardSure.set('revert:' + c.hash, Date.now()); rv.textContent = 'Revert it?'; rv.classList.add('sure'); setTimeout(() => { if (Date.now() - sureAt() >= 4000) { rv.textContent = 'Revert'; rv.classList.remove('sure'); } }, 4100); return; }
            discardSure.delete('revert:' + c.hash);
            rv.disabled = true;
            const err = await api.revert(s.id, c.hash);
            if (err) { rv.textContent = 'Revert'; rv.classList.remove('sure'); rv.disabled = false; rv.title = err; }
          };
          li.append(rv);
        }
        li.append(pre);
        ul.append(li);
      }
      box.append(ul);
      requestAnimationFrame(fitWindow);
    }).then(() => (api.branchChanges && box.dataset.key === key ? api.branchChanges(s.id) : null)).then((ch) => {
      // And all its branch changed since it left main: a tap for the
      // files, a tap on one for its change (to look over before a PR).
      if (!ch || box.dataset.key !== key || box.dataset.draw !== draw) return;
      // Main moved on since it branched off: Bring them in (Claude merges
      // them, sorting out any conflicts).
      const base = ch.base.replace(/^origin\//, '');
      if (ch.behind > 0) {
        const row = document.createElement('div');
        row.className = 'behindrow';
        const said = document.createElement('span');
        said.textContent = `${base} has ${ch.behind} newer commit${ch.behind === 1 ? '' : 's'}`;
        const go = document.createElement('button');
        go.type = 'button';
        go.textContent = 'Bring them in';
        go.disabled = busy;
        go.title = busy ? 'Once it’s done' : `Asks Claude to merge ${ch.base} into this branch`;
        go.onclick = () => api.send(s.id, `Merge the latest ${ch.base} into this branch${/^origin\//.test(ch.base) ? ` (fetch it first)` : ''}. If anything conflicts, resolve it keeping both sides’ intent. Then run the tests and tell me what came in and anything you had to choose.`);
        row.append(said, go);
        box.append(row);
      }
      if (!ch.files.length) { requestAnimationFrame(fitWindow); return; }
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'onbranch';
      head.textContent = `On this branch since ${base}: ${ch.stat || `${ch.files.length} files`}`;
      head.setAttribute('aria-expanded', 'false');
      const ul = document.createElement('ul');
      ul.className = 'gitfiles commits branchfiles';
      ul.hidden = true;
      for (const f of ch.files) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = f.how;
        const name = document.createElement('span');
        name.textContent = f.path;
        const how = document.createElement('small');
        how.textContent = f.how;
        b.append(name, how);
        const pre = document.createElement('pre');
        pre.className = 'stepout diff';
        pre.hidden = true;
        b.onclick = () => {
          if (f.how === 'deleted') return;
          pre.hidden = !pre.hidden;
          if (!pre.hidden && !pre.textContent) api.branchDiff(s.id, f.path).then((t) => { colorDiff(pre, t || '(can’t show it)'); requestAnimationFrame(fitWindow); });
          requestAnimationFrame(fitWindow);
        };
        li.append(b, pre);
        ul.append(li);
      }
      head.onclick = () => { ul.hidden = !ul.hidden; head.setAttribute('aria-expanded', String(!ul.hidden)); requestAnimationFrame(fitWindow); };
      box.append(head, ul);
      requestAnimationFrame(fitWindow);
    });
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
  const bgOpen = new Set(); // tasks whose output is open
  function renderTasks(s) {
    const box = $('bg');
    const list = s.ended || s.demo ? [] : (s.tasks || []);
    const key = JSON.stringify(list.map((t) => [t.id, t.url])) + s.id;
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
      stop.title = s.owned || t.mine ? `Stop ${t.command}` : `Ask Claude to stop ${t.command}`;
      // (A session Blaube started stops it itself; any other is asked to.)
      stop.onclick = async () => {
        if (!current) return;
        stop.disabled = true;
        const id = current.id;
        if (api.stopTask && await api.stopTask(id, t.id)) return;
        api.send(id, `Stop the background task “${t.label}” (id ${t.id}, \`${t.command}\`).`);
      };
      // (And what it has printed lately: read from its file, live while
      // it's open, or else asked of Claude.)
      const peek = document.createElement('button');
      peek.type = 'button';
      peek.textContent = 'Output';
      peek.title = `Show what ${t.command} has printed lately`;
      const out = document.createElement('pre');
      out.className = 'bgout';
      out.hidden = true;
      const ask = () => api.send(current.id, `What has the background task “${t.label}” (id ${t.id}, \`${t.command}\`) printed lately? Show me the last lines that matter, and say if anything looks wrong.`);
      const show = async () => {
        const r = current && api.taskOutput ? await api.taskOutput(current.id, t.id) : null;
        if (!r) return false;
        const end = out.scrollHeight - out.scrollTop - out.clientHeight < 8; // (follows the end unless you scrolled up)
        out.textContent = (r.cut ? '…\n' : '') + (r.text || '(nothing yet)') + (r.exited != null ? `\n[ended, code ${r.exited}]` : '');
        out.classList.toggle('failed', !!r.exited);
        if (end) out.scrollTop = out.scrollHeight;
        return true;
      };
      peek.onclick = async () => {
        if (!current) return;
        if (!out.hidden) { out.hidden = true; bgOpen.delete(t.id); clearInterval(out.timer); peek.setAttribute('aria-expanded', 'false'); requestAnimationFrame(fitWindow); return; }
        if (!(await show())) return ask();
        bgOpen.add(t.id);
        out.hidden = false;
        peek.setAttribute('aria-expanded', 'true');
        out.scrollTop = out.scrollHeight;
        out.timer = setInterval(() => { if (!out.isConnected || out.hidden) return clearInterval(out.timer); show(); }, 1500);
        requestAnimationFrame(fitWindow);
      };
      // (A dev server: open where it says it's on.)
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = 'Open';
      go.title = t.url;
      go.onclick = () => api.openLink(t.url);
      li.append(name, ...(t.url ? [go] : []), peek, stop, out);
      box.append(li);
      if (bgOpen.has(t.id)) peek.onclick(); // (still open from before it was redrawn)
    }
    requestAnimationFrame(fitWindow);
  }

  // Its MCP servers that couldn't connect (or need you to sign in), as /mcp
  // would show them, with Reconnect.
  function renderMcp(s) {
    const box = $('mcp');
    const list = s.ended || s.demo ? [] : (s.mcp || []);
    const key = JSON.stringify(list) + s.id;
    box.hidden = !list.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    for (const m of list) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = m.status === 'needs-auth' ? `${m.name} needs you to sign in` : `${m.name} couldn’t connect`;
      name.title = m.error || '';
      const again = document.createElement('button');
      again.type = 'button';
      // (Signing in: in your browser, as /mcp does in the terminal.)
      const auth = m.status === 'needs-auth' && api.mcpSignIn;
      const word = auth ? 'Sign in' : 'Reconnect';
      again.textContent = word;
      again.title = auth ? `Sign in to ${m.name}, in your browser` : `Try connecting to ${m.name} again`;
      again.onclick = async () => { if (!current) return; again.disabled = true; again.textContent = auth ? 'Signing in…' : 'Connecting…'; if (!(await (auth ? api.mcpSignIn : api.mcpReconnect)(current.id, m.name))) { again.disabled = false; again.textContent = word; } };
      li.append(name, again);
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
    $('todoCount').textContent = `${done} of ${list.length} done`;
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
    $('askMore').textContent = count > 1 ? `${count - 1} more waiting after this` : '';
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
    if ((current.ask.kind || 'tool') === 'tool') { $('deny').textContent = typed ? 'Deny and say' : 'Deny'; return; }
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

  // What a tool would do, in plain words ("run a command", "edit a file").
  const TOOLS = { Bash: 'run a command', PowerShell: 'run a command', Edit: 'edit a file', MultiEdit: 'edit a file', NotebookEdit: 'edit a notebook', Write: 'write a file', Read: 'read a file', Glob: 'look for files', Grep: 'search in files', WebFetch: 'open a web page', WebSearch: 'search the web', Task: 'start a helper', Agent: 'start a helper', Skill: 'use a skill' };
  function toolWords(tool) {
    const t = String(tool || '');
    if (TOOLS[t]) return TOOLS[t];
    const mcp = /^mcp__(.+?)__(.+)$/.exec(t); // (a tool from an MCP server: its name, and whose)
    if (mcp) return `use ${mcp[2].replace(/[_-]+/g, ' ')} (from ${mcp[1].replace(/[_-]+/g, ' ')})`;
    return t ? `use ${t}` : 'go ahead';
  }

  // Lays the card out for what's being asked: a tool, a question, a plan.
  function buildAsk(ask) {
    const kind = ask.kind || 'tool';
    const card = $('ask');
    card.dataset.kind = kind;
    $('askWhat').textContent = kind === 'question' ? (ask.questions.length > 1 ? `Claude has ${ask.questions.length} questions for you` : 'Claude has a question for you')
      : kind === 'plan' ? 'Here’s the plan. Go ahead with it?' : `Allow Claude to ${toolWords(ask.tool)}?`;
    $('askWhat').title = kind === 'tool' && ask.tool ? `The ${ask.tool} tool` : '';
    // How to answer from the keyboard, in words.
    const mac = navigator.platform.startsWith('Mac');
    const go = mac ? '⌘Return' : 'Ctrl+Enter', no = mac ? '⌘Delete' : 'Ctrl+Backspace';
    $('askKeys').textContent = kind === 'tool' ? `${go} allows · ${no} denies`
      : kind === 'plan' ? `${go} goes ahead · ${no} keeps planning`
      : ask.questions.length === 1 && !ask.questions[0].multiSelect && ask.questions[0].options.length > 1 ? `Press 1 to ${Math.min(9, ask.questions[0].options.length)} to pick` : '';
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
    $('askNote').textContent = kind === 'plan' ? 'Want changes? Write them in the field below, then Send changes.' : kind === 'tool' ? 'Or write in the field below what it should do instead, then Deny and say.' : '';
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
      const aside = q.multiSelect ? '(pick any)' : '';
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
    $('allow').textContent = left ? `${left} question${left === 1 ? '' : 's'} left to answer` : 'Send';
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
    // Everything but the log, each at its full height (a card taller than
    // the window has room for asks for that room).
    let chrome = 0;
    for (const el of bubble.children) {
      if (el === log || !el.offsetParent) continue;
      const cs = getComputedStyle(el);
      chrome += Math.max(el.offsetHeight, el.scrollHeight) + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    }
    const pad = 14; // the log's own padding
    // A card's questions or plan may be scrolled: ask for their full height.
    let card = 0;
    for (const el of [$('askQuestions'), $('askPlan'), $('askDetail')]) if (el.offsetParent) card += el.scrollHeight - el.clientHeight;
    // A hidden (squeezed) log still wants its height back; an empty one doesn't.
    if (inner.offsetHeight) innerH = inner.offsetHeight;
    const logH = inner.children.length ? innerH + pad : 0; // (with a card up too: what it's asking about stays in view if there's room)
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
    text.style.height = Math.min(200, text.scrollHeight) + 'px';
    text.style.overflowY = text.scrollHeight > 200 ? 'auto' : 'hidden';
  }

  api.onState((s) => {
    const first = !current || current.id !== s.id;
    if (first && current) drafts.set(current.id, text.value);
    if (first) { showOverview(false); $('find').value = ''; $('findBar').hidden = true; document.body.classList.remove('searching'); $('toast').hidden = true; gitOpen = false; recall = -1; suggAsked++; drawSuggest([]); }
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
  if (api.onTail) api.onTail(placeTail);
  // Dragging an edge or a corner resizes it (the app moves the window; what's
  // in it flows to fit).
  for (const g of document.querySelectorAll('.grips i')) {
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !api.resize) return;
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      const edge = g.dataset.edge;
      let last = { x: e.screenX, y: e.screenY };
      document.body.classList.add('resizing');
      api.resize('start', edge, last.x, last.y);
      const move = (m) => { last = { x: m.screenX, y: m.screenY }; api.resize('move', edge, last.x, last.y); };
      const up = () => {
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.removeEventListener('lostpointercapture', up);
        document.body.classList.remove('resizing');
        api.resize('end', edge, last.x, last.y);
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
      g.addEventListener('lostpointercapture', up);
    });
  }
  text.addEventListener('input', () => {
    // Its slime listens as you type (at most a few times a second).
    if (current && api.typing && Date.now() - (text.typedAt || 0) > 120) { text.typedAt = Date.now(); api.typing(current.id); }
    if (askKey && current.ask && current.ask.kind === 'plan') planButtons();
    fit(); send.disabled = !current || current.demo || (!text.value.trim() && !files.length); requestAnimationFrame(fitWindow); });
  text.addEventListener('input', () => { if (askKey && current.ask && current.ask.kind === 'tool') planButtons(); });
  // Its permission mode under the field, as the terminal shows it; ⇧⇥ (or
  // a tap) changes it in a session Blaube started.
  const MODES = { default: 'Asks before edits', acceptEdits: 'Accepting edits', plan: 'Plan first', bypassPermissions: 'Bypassing permissions', dontAsk: 'Not asking first', auto: 'Auto mode' };
  const CYCLE = ['default', 'acceptEdits', 'plan'];
  function renderMode(s) {
    const m = $('mode'), mode = s.mode || 'default';
    const shown = s.canMode || mode !== 'default';
    // (How full its context is, once that's worth knowing.)
    const full = s.context >= 50 ? `${s.context}% of context used` : '';
    const about = [s.model, full, s.limit].filter(Boolean).join(' · '); // (and your usage limit, once it's close)
    m.hidden = !!s.ended || !!s.demo || (!shown && !about);
    m.className = 'mode ' + mode + (s.canMode ? ' can' : '');
    m.textContent = '';
    // (Which model it is, first: Opus 5.5 · Accepting edits.)
    if (about) {
      const n = document.createElement('span'); n.className = 'model' + (s.context >= 80 || /reached/.test(s.limit || '') ? ' full' : ''); n.textContent = about + (shown ? ' · ' : '');
      // (In a session Blaube started, a tap shows what fills its context, as /context does.)
      if (s.canMode) { n.classList.add('ctx'); n.title = 'What fills its context (/context)'; n.addEventListener('click', (e) => { e.stopPropagation(); if (current) api.send(current.id, '/context'); }); }
      m.append(n);
    }
    if (shown) m.append(MODES[mode] || mode);
    if (s.canMode) { const k = document.createElement('kbd'); k.textContent = 'Shift+Tab'; m.append(k); }
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
    // (/model in a session Blaube started: the models it can switch to.)
    m = /^\/model\s+([\w.[\]-]*)$/i.exec(before);
    if (m && current.owned) return { kind: 'model', q: m[1], from: c - m[1].length };
    // (/run: its scripts.)
    m = /^\/run\s+([\w:.@/-]*)$/i.exec(before);
    if (m) return { kind: 'script', q: m[1], from: c - m[1].length };
    m = /^\/effort\s+(\w*)$/i.exec(before);
    if (m && current.owned) return { kind: 'effort', q: m[1], from: c - m[1].length };
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
  // Editing one of yours: the field holds it, and sending goes back first.
  function startEdit(m) {
    editing = { id: current.id, uuid: m.uuid };
    $('editing').hidden = false;
    text.value = m.text;
    text.dispatchEvent(new Event('input'));
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
    requestAnimationFrame(fitWindow);
  }
  function stopEdit(clear) {
    if (!editing) return;
    editing = null;
    $('editing').hidden = true;
    if (clear) { text.value = ''; text.dispatchEvent(new Event('input')); }
    requestAnimationFrame(fitWindow);
  }
  $('editCancel').addEventListener('click', () => { stopEdit(true); text.focus(); });
  text.addEventListener('keydown', (e) => { if (e.key === 'Escape' && editing && !e.isComposing) { e.preventDefault(); e.stopPropagation(); stopEdit(true); } });
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (editing) {
      const typed = text.value.trim();
      if (!typed || !current || editing.id !== current.id) return stopEdit(true);
      const { id, uuid } = editing;
      stopEdit(true);
      drafts.delete(id);
      fit();
      pinned = true;
      api.editFrom(id, uuid, typed);
      return;
    }
    suggAsked++; drawSuggest([]); // (one still on its way stays away too)
    const typed = text.value.trim();
    if ((!typed && !files.length) || !current || current.demo) return;
    // Pasted or dropped files go along as paths Claude can open.
    const v = files.length ? `${typed}${typed ? '\n\n' : ''}${files.length === 1 ? 'Attached file' : 'Attached files'} (open with your Read tool): ${files.map((f) => f.path).join(', ')}` : typed;
    // "/resume": the overview, where past sessions are picked up.
    if (!files.length && /^\/resume\s*$/i.test(typed)) { text.value = ''; fit(); drafts.delete(current.id); showOverview(true); return; }
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
  let closing = false, kept = false; // (kept: pinned, it stays open)
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
    if (kept) return; // (pinned, only its ✕ closes it)
    close();
  });
  $('close').addEventListener('click', close);
  // The pin: pinned, it stays open (clicking away, Esc and other slimes'
  // boxes leave it be), and several can be open at once.
  $('pin').addEventListener('click', () => { if (api.pin) api.pin(!kept); });
  // Dark mode, for every box (the app keeps it).
  $('theme').addEventListener('click', () => { if (api.dark) api.dark(!document.body.classList.contains('dark')); });
  // Dragging its header moves it, anywhere (not from its buttons, fields,
  // tabs or name).
  document.querySelector('header').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !api.resize || e.target.closest('button, input, textarea, select, a, nav, .subname')) return;
    e.preventDefault();
    const h = e.currentTarget;
    h.setPointerCapture(e.pointerId);
    let last = { x: e.screenX, y: e.screenY };
    document.body.classList.add('moving');
    api.resize('start', 'move', last.x, last.y);
    const move = (m) => { last = { x: m.screenX, y: m.screenY }; api.resize('move', 'move', last.x, last.y); };
    const up = () => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('lostpointercapture', up);
      document.body.classList.remove('moving');
      api.resize('end', 'move', last.x, last.y);
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('lostpointercapture', up);
  });
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
