// Tracks Claude Code sessions from hook events. Each session is one of:
//   idle    - open, nothing happening yet
//   working - Claude is thinking or running tools
//   waiting - Claude needs you (permission prompt, question)
//   done    - Claude finished its turn
const path = require('node:path');
const { EventEmitter } = require('node:events');

const STALE_WORKING_MS = 15 * 60 * 1000; // no hooks for this long means it probably died
const FORGET_MS = 6 * 60 * 60 * 1000;

class SessionTracker extends EventEmitter {
  constructor(now = () => Date.now()) {
    super();
    this.now = now;
    this.sessions = new Map();
  }

  list() {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Applies one hook payload, as Claude Code sends it on stdin.
  handle(payload) {
    if (!payload || typeof payload !== 'object') return;
    const id = String(payload.session_id || 'unknown');
    const event = payload.hook_event_name;
    const prev = this.sessions.get(id);

    if (event === 'SessionEnd') {
      if (prev) { this.sessions.delete(id); this.emit('change', { session: prev, from: prev.state, to: 'gone' }); }
      return;
    }

    const next = nextState(prev ? prev.state : 'idle', payload);
    if (!next) return;

    const cwd = payload.cwd || (prev && prev.cwd) || '';
    const session = {
      id,
      cwd,
      term: payload._term || (prev && prev.term) || '',
      project: cwd ? path.basename(cwd.replace(/[\\/]+$/, '')) : 'Claude',
      state: next.state,
      message: next.message || '',
      seen: prev && prev.state === next.state ? prev.seen : false,
      updatedAt: this.now(),
    };
    this.sessions.set(id, session);
    if (!prev || prev.state !== session.state) {
      this.emit('change', { session, from: prev ? prev.state : null, to: session.state });
    }
  }

  // Marks done/waiting sessions as seen, so Blaube stops pestering.
  acknowledge() {
    for (const s of this.sessions.values()) s.seen = true;
  }

  prune() {
    const t = this.now();
    let changed = false;
    for (const [id, s] of this.sessions) {
      if (t - s.updatedAt > FORGET_MS) { this.sessions.delete(id); changed = true; }
      else if (s.state === 'working' && t - s.updatedAt > STALE_WORKING_MS) { s.state = 'idle'; changed = true; }
    }
    return changed;
  }
}

function nextState(current, p) {
  switch (p.hook_event_name) {
    case 'SessionStart':
      return { state: current === 'working' ? 'working' : 'idle' };
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return { state: 'working' };
    case 'Notification': {
      // "idle_prompt" fires a while after Claude finished and is still
      // waiting for your next prompt: that's still just "done".
      if (p.notification_type === 'idle_prompt' || /waiting for your input/i.test(p.message || '')) {
        return current === 'idle' ? null : { state: 'done' };
      }
      return { state: 'waiting', message: p.message || 'Claude needs you' };
    }
    case 'Stop':
      return { state: 'done' };
    default:
      return null;
  }
}

module.exports = { SessionTracker, nextState };
