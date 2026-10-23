// The talk box: a session's conversation since Blaube started, and a field
// to send it a message (see src/main/inbox.js).
(function () {
  'use strict';
  const api = window.blaubeTalk;
  const $ = (id) => document.getElementById(id);
  const text = $('text'), send = $('send'), log = $('log');
  const STATES = {
    working: ['Working', '#e0a03c'], waiting: ['Needs you', '#e0533c'],
    done: ['Done', '#5cb85c'], idle: ['Idle', '#9a9a9a'],
  };
  let current = null, shown = '';

  function notes(s) {
    if (s.demo) return 'Demo slimes can’t talk back. Try a real session.';
    if (!s.connected) return 'Choose “Update Claude Code connection…” in Blaube’s menu, then restart this session to talk to it from here.';
    if (s.queued) return s.inbox === 'unknown'
      ? 'Waiting to hear from this session. Your message goes in when it next finishes a turn; if it never does, restart the session.'
      : 'Your message goes in as soon as it finishes this turn.';
    if (s.inbox === 'busy') return 'It’s busy: anything you send goes in when it finishes this turn.';
    if (s.inbox === 'unknown') return s.state === 'working'
      ? 'Messages go in when it finishes this turn.'
      : 'Blaube hasn’t heard from this session yet. If messages don’t arrive, restart the session.';
    return '';
  }

  function render(s) {
    const switched = !current || current.id !== s.id;
    current = s;
    $('name').textContent = s.project;
    const [word, dot] = STATES[s.state] || [s.state, '#9a9a9a'];
    $('state').textContent = word;
    $('state').style.setProperty('--dot', dot);
    $('terminal').style.display = s.demo ? 'none' : '';
    $('note').textContent = notes(s);
    text.disabled = !!s.demo;
    send.disabled = s.demo || !text.value.trim();
    // Only rebuild the log when it changed, so scrolling isn't reset.
    const key = s.id + JSON.stringify(s.log);
    if (key === shown) return;
    shown = key;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.textContent = '';
    if (!s.log.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = `Say something to ${s.project}. It reaches the session even if you’re not at its terminal.`;
      log.append(e);
    }
    for (const m of s.log) {
      const e = document.createElement('div');
      e.className = 'msg ' + m.who;
      e.textContent = m.text.length > 4000 ? m.text.slice(0, 4000) + '…' : m.text;
      log.append(e);
      const meta = m.status === 'queued' ? 'Waiting for it to finish…' : m.via === 'terminal' ? 'In the terminal' : '';
      if (meta) {
        const t = document.createElement('div');
        t.className = 'meta ' + m.who;
        t.textContent = meta;
        log.append(t);
      }
    }
    if (atBottom || switched) log.scrollTop = log.scrollHeight;
  }

  function fit() {
    text.style.height = 'auto';
    text.style.height = Math.min(96, text.scrollHeight + 2) + 'px';
    text.style.overflowY = text.scrollHeight > 96 ? 'auto' : 'hidden';
  }

  api.onState((s) => {
    const first = !current || current.id !== s.id;
    render(s);
    if (first) { text.value = ''; fit(); }
    if (s.focus) text.focus();
  });
  text.addEventListener('input', () => { fit(); send.disabled = !current || current.demo || !text.value.trim(); });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form').requestSubmit(); }
  });
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = text.value.trim();
    if (!v || !current || current.demo) return;
    api.send(v);
    text.value = '';
    fit();
    send.disabled = true;
    log.scrollTop = log.scrollHeight;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close(); });
  $('close').addEventListener('click', () => api.close());
  $('terminal').addEventListener('click', () => api.terminal());
})();
