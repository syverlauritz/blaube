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
    this.effortOf = null; // optional (payload) => 'low' | 'medium' | 'high' | 'xhigh' | ''
    // Sessions you merged back in by hand, so their next hook doesn't split
    // them right back out. Cleared when the session really ends.
    this.dismissed = new Map(); // id -> last time we heard from it
  }

  // "Merge back in": hides a session that's still running until it ends.
  dismiss(id) {
    this.dismissed.set(id, this.now());
    this.handle({ session_id: id, hook_event_name: 'SessionEnd' }, 'user');
  }

  list() {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Applies one hook payload, as Claude Code sends it on stdin.
  handle(payload, source = 'hook') {
    if (!payload || typeof payload !== 'object') return;
    const id = String(payload.session_id || 'unknown');
    const event = payload.hook_event_name;
    const prev = this.sessions.get(id);

    if (event === 'SessionEnd') {
      if (source !== 'user') this.dismissed.delete(id);
      if (prev) { this.sessions.delete(id); this.emit('change', { session: prev, from: prev.state, to: 'gone' }); }
      return;
    }
    if (this.dismissed.has(id)) { this.dismissed.set(id, this.now()); return; }

    const next = nextState(prev ? prev.state : 'idle', payload);
    if (!next) return;

    const cwd = payload.cwd || (prev && prev.cwd) || '';
    const session = {
      id,
      cwd,
      term: payload._term || (prev && prev.term) || '',
      effort: payload._effort || (this.effortOf && this.effortOf({ ...payload, cwd })) || (prev && prev.effort) || '',
      project: cwd ? path.basename(cwd.replace(/[\\/]+$/, '')) : 'Claude',
      state: next.state,
      message: next.message || '',
      seen: prev && prev.state === next.state ? prev.seen : false,
      // Once hooks report on a session they're the better source, so the
      // `claude agents` poller leaves it alone.
      hooked: source === 'hook' || !!(prev && prev.hooked),
      updatedAt: this.now(),
    };
    this.sessions.set(id, session);
    if (!prev || prev.state !== session.state || prev.effort !== session.effort) {
      this.emit('change', { session, from: prev ? prev.state : null, to: session.state });
    }
  }

  // Folds in `claude agents --json` output (busy/idle per running session).
  // It covers sessions whose hooks never fire, e.g. hooks not installed yet.
  applyAgents(agents) {
    const live = new Set();
    for (const a of agents) {
      if (!a || !a.sessionId) continue;
      live.add(a.sessionId);
      if (this.dismissed.has(a.sessionId)) { this.dismissed.set(a.sessionId, this.now()); continue; }
      const prev = this.sessions.get(a.sessionId);
      if (prev && prev.hooked) continue;
      const base = { session_id: a.sessionId, cwd: a.cwd };
      if (!prev) this.handle({ ...base, hook_event_name: 'SessionStart' }, 'agents');
      const cur = this.sessions.get(a.sessionId).state;
      if (a.status === 'busy' && cur !== 'working') this.handle({ ...base, hook_event_name: 'UserPromptSubmit' }, 'agents');
      else if (a.status !== 'busy' && cur === 'working') this.handle({ ...base, hook_event_name: 'Stop' }, 'agents');
    }
    for (const [id, s] of this.sessions) {
      if (!s.hooked && !live.has(id) && !id.startsWith('demo-')) this.handle({ session_id: id, hook_event_name: 'SessionEnd' }, 'agents');
    }
    for (const id of this.dismissed.keys()) if (!live.has(id)) this.dismissed.delete(id);
  }

  // Marks done/waiting sessions as seen, so Blaube stops pestering.
  acknowledge() {
    for (const s of this.sessions.values()) s.seen = true;
  }

  prune() {
    const t = this.now();
    let changed = false;
    for (const [id, at] of this.dismissed) if (t - at > FORGET_MS) this.dismissed.delete(id);
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
