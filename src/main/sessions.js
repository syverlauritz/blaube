// Tracks Claude Code sessions from hook events. Each session is one of:
//   idle    - open, nothing happening yet
//   working - Claude is thinking or running tools
//   waiting - Claude needs you (permission prompt, question)
//   done    - Claude finished its turn
// A session also keeps a list of the subagents it is running right now, and
// of the background tasks (servers and such) Claude started for it.
const path = require('node:path');
const { classify } = require('../shared/actions');
const { EventEmitter } = require('node:events');

const STALE_WORKING_MS = 15 * 60 * 1000; // no hooks for this long means it probably died
const FORGET_MS = 6 * 60 * 60 * 1000;
const HOOKED_GONE_MS = 60 * 1000;
const TASK_GRACE_MS = 5000; // a new task may not show up as a process right away
const KILL_TOOLS = new Set(['KillShell', 'KillBash', 'TaskStop']);

// A helper (subagent) running in its own git worktree works in a folder
// named after it. Its events don't always carry its agent_id, so the
// folder tells us whose they are.
function worktreeAgentId(cwd) {
  const m = /[\\/]\.claude[\\/]worktrees[\\/]agent-([0-9a-z]+)/i.exec(String(cwd || ''));
  return m ? m[1] : '';
}

class SessionTracker extends EventEmitter {
  constructor(now = () => Date.now()) {
    super();
    this.now = now;
    this.sessions = new Map();
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

    if (prev && this.handleAgent(prev, payload)) return;
    if (prev && this.handleTask(prev, payload)) this.emit('change', { session: prev, from: prev.state, to: prev.state });

    const next = nextState(prev ? prev.state : 'idle', payload);
    if (!next) return;

    const cwd = payload.cwd || (prev && prev.cwd) || '';
    const session = {
      id,
      cwd,
      term: payload._term || (prev && prev.term) || '',
      entry: payload._entry || (prev && prev.entry) || '',
      transcript: payload.transcript_path || (prev && prev.transcript) || '',
      pid: payload._pid || (prev && prev.pid) || 0,
      // Its permission mode, as Claude Code last said ('default',
      // 'acceptEdits', 'plan'...).
      mode: typeof payload.permission_mode === 'string' ? payload.permission_mode : (prev && prev.mode) || '',
      project: cwd ? path.basename(cwd.replace(/[\\/]+$/, '')) : 'Claude',
      state: next.state,
      // While working: 'thinking' (the model) or 'tool' (running a tool).
      activity: activityAfter(event, prev && prev.activity),
      // What its current tool call is about (read, edit, test, push...).
      action: event === 'PreToolUse' ? classify(payload.tool_name, payload.tool_input) : (prev && prev.action) || '',
      // When the current turn started (the prompt you sent).
      turnStart: event === 'UserPromptSubmit' ? this.now() : (prev && prev.turnStart) || 0,
      message: next.message || '',
      seen: prev && prev.state === next.state ? prev.seen : false,
      // Once hooks report on a session they're the better source, so the
      // `claude agents` poller leaves it alone.
      hooked: source === 'hook' || !!(prev && prev.hooked),
      agents: prev ? prev.agents : [],
      tasks: prev ? prev.tasks : [],
      tasksSeeded: !!(prev && prev.tasksSeeded),
      updatedAt: this.now(),
    };
    this.sessions.set(id, session);
    if (event === 'UserPromptSubmit') this.emit('prompt', session);
    if (source === 'hook' && (event === 'PreToolUse' || event === 'Stop' || event === 'Notification')) this.emit('activity', { session, agentId: '', payload });
    if (source === 'hook' && (event === 'PostToolUse' || event === 'PostToolUseFailure')) this.emit('tooldone', { session, agentId: '', payload, failed: event === 'PostToolUseFailure' });
    if (!prev || prev.state !== session.state) {
      this.emit('change', { session, from: prev ? prev.state : null, to: session.state });
    }
  }

  // Its permission mode changed (said by Claude Code outside a hook).
  setMode(id, mode) {
    const s = this.sessions.get(id);
    if (!s || !mode || s.mode === mode) return;
    s.mode = mode;
    this.emit('change', { session: s, from: s.state, to: s.state });
  }

  // Subagent events only touch the session's list of subagents. Returns true
  // when the payload is fully handled here. Tool calls made inside a
  // subagent carry its agent_id, which also catches subagents that were
  // already running when Blaube started.
  handleAgent(session, p) {
    const event = p.hook_event_name;
    const agentId = p.agent_id ? String(p.agent_id) : worktreeAgentId(p.cwd);
    if (event === 'SubagentStart' || event === 'SubagentStop') {
      if (!agentId) return true;
      const had = session.agents.some((a) => a.id === agentId);
      if (event === 'SubagentStop') {
        if (had) session.agents = session.agents.filter((a) => a.id !== agentId);
      } else if (!had) {
        session.agents = [...session.agents, { id: agentId, type: String(p.agent_type || 'agent'), state: 'working', updatedAt: this.now() }];
      }
      session.updatedAt = this.now();
      if (had !== (event === 'SubagentStart')) this.emit('change', { session, from: session.state, to: session.state });
      return true;
    }
    if (!agentId) return false;
    const agentState = event === 'Notification' ? 'waiting' : event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure' ? 'working' : null;
    if (!agentState) return false;
    let agent = session.agents.find((a) => a.id === agentId);
    const changed = !agent || agent.state !== agentState;
    if (!agent) {
      agent = { id: agentId, type: String(p.agent_type || 'agent'), state: agentState, updatedAt: 0 };
      session.agents = [...session.agents, agent];
    }
    agent.state = agentState;
    agent.activity = activityAfter(event, agent.activity);
    if (event === 'PreToolUse') agent.action = classify(p.tool_name, p.tool_input);
    agent.updatedAt = this.now();
    if (event === 'PreToolUse') this.emit('activity', { session, agentId, payload: p });
    if (event === 'PostToolUse' || event === 'PostToolUseFailure') this.emit('tooldone', { session, agentId, payload: p, failed: event === 'PostToolUseFailure' });
    session.updatedAt = this.now();
    if (changed) this.emit('change', { session, from: session.state, to: session.state });
    // A subagent asking for permission means the session needs you too.
    return event !== 'Notification';
  }

  // Notices background tasks starting (a tool run with run_in_background)
  // and being stopped by Claude. Returns true if the list changed. Tasks
  // that end by themselves are caught by pruneTasks.
  handleTask(session, p) {
    const input = p.tool_input || {};
    const resp = p.tool_response && typeof p.tool_response === 'object' ? p.tool_response : {};
    if (p.hook_event_name === 'PostToolUse' && (input.run_in_background || resp.backgroundTaskId) && input.command) {
      const id = String(resp.backgroundTaskId || p.tool_use_id || input.command);
      if (session.tasks.some((t) => t.id === id)) return false;
      session.tasks = [...session.tasks, { id, command: String(input.command), description: String(input.description || ''), startedAt: this.now(), missing: 0 }];
      return true;
    }
    if (p.hook_event_name === 'PreToolUse' && KILL_TOOLS.has(p.tool_name)) {
      const id = String(input.shell_id || input.task_id || input.bash_id || '');
      const before = session.tasks.length;
      session.tasks = session.tasks.filter((t) => t.id !== id);
      return session.tasks.length !== before;
    }
    return false;
  }

  // Every task, with its session's claude process id.
  allTasks() {
    return [...this.sessions.values()].flatMap((s) => s.tasks.map((t) => Object.assign({}, t, { pid: s.pid })));
  }

  // Adds tasks found in a session's transcript (from before Blaube was
  // running). Only once per session: after that the hooks keep it current.
  seedTasks(id, tasks) {
    const s = this.sessions.get(id);
    if (!s || s.tasksSeeded) return false;
    s.tasksSeeded = true;
    const fresh = tasks.filter((t) => !s.tasks.some((x) => x.id === t.id));
    s.tasks = [...s.tasks, ...fresh.map((t) => Object.assign({ startedAt: 0, missing: 0 }, t))];
    return fresh.length > 0;
  }

  // Drops tasks that are no longer running. alive is a set of task ids; a
  // task has to be missing twice in a row, so one slow poll can't kill it.
  pruneTasks(alive) {
    const t = this.now();
    let changed = false;
    for (const s of this.sessions.values()) {
      for (const task of s.tasks) task.missing = alive.has(task.id) || t - task.startedAt < TASK_GRACE_MS ? 0 : task.missing + 1;
      const keep = s.tasks.filter((task) => task.missing < 2);
      if (keep.length !== s.tasks.length) { s.tasks = keep; changed = true; }
    }
    return changed;
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
      if (prev && a.pid) prev.pid = a.pid;
      if (prev && prev.hooked) continue;
      const base = { session_id: a.sessionId, cwd: a.cwd, _pid: a.pid };
      if (!prev) this.handle({ ...base, hook_event_name: 'SessionStart' }, 'agents');
      const cur = this.sessions.get(a.sessionId).state;
      if (a.status === 'busy' && cur !== 'working') this.handle({ ...base, hook_event_name: 'UserPromptSubmit' }, 'agents');
      else if (a.status !== 'busy' && cur === 'working') this.handle({ ...base, hook_event_name: 'Stop' }, 'agents');
    }
    for (const [id, s] of this.sessions) {
      if (live.has(id) || id.startsWith('demo-')) { s.missing = 0; continue; }
      s.missing = (s.missing || 0) + 1;
      // Hooked sessions normally end with a SessionEnd hook, but a killed
      // session never sends one. Once it's been gone from `claude agents`
      // for a few polls and quiet for a minute, treat it as closed.
      const gone = s.hooked ? s.missing >= 3 && this.now() - s.updatedAt > HOOKED_GONE_MS : true;
      if (gone) this.handle({ session_id: id, hook_event_name: 'SessionEnd' }, 'agents');
    }
    for (const id of this.dismissed.keys()) if (!live.has(id)) this.dismissed.delete(id);
  }

  // Marks done/waiting sessions as seen, so Blaube stops pestering.
  // A session carries on under another id (a picked-up one Claude Code
  // gave a new id): same slime, new name for it.
  rename(from, to) {
    const s = this.sessions.get(from);
    if (!s || this.sessions.has(to)) return false;
    this.sessions.delete(from);
    s.id = to;
    this.sessions.set(to, s);
    this.emit('change', { session: s, from: s.state, to: s.state });
    return true;
  }

  acknowledge() {
    for (const s of this.sessions.values()) s.seen = true;
  }

  prune() {
    const t = this.now();
    let changed = false;
    for (const [id, at] of this.dismissed) if (t - at > FORGET_MS) this.dismissed.delete(id);
    for (const [id, s] of this.sessions) {
      if (t - s.updatedAt > FORGET_MS) { this.sessions.delete(id); changed = true; continue; }
      const agents = s.agents.filter((a) => t - a.updatedAt <= STALE_WORKING_MS);
      if (agents.length !== s.agents.length) { s.agents = agents; changed = true; }
      if (s.state === 'working' && t - s.updatedAt > STALE_WORKING_MS) { s.state = 'idle'; changed = true; }
    }
    return changed;
  }
}

// A tool runs between its PreToolUse and PostToolUse; the rest of a turn
// is the model thinking.
function activityAfter(event, prev) {
  if (event === 'PreToolUse') return 'tool';
  if (event === 'PostToolUse' || event === 'PostToolUseFailure' || event === 'UserPromptSubmit') return 'thinking';
  return prev || 'thinking';
}

function nextState(current, p) {
  switch (p.hook_event_name) {
    case 'SessionStart':
      return { state: current === 'working' ? 'working' : 'idle' };
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return { state: 'working' };
    case 'Notification': {
      // "idle_prompt" fires a while after Claude finished and is still
      // waiting for your next prompt: that's still just "done".
      if (p.notification_type === 'idle_prompt' || /waiting for your input/i.test(p.message || '')) {
        return current === 'idle' ? null : { state: 'done' };
      }
      return { state: 'waiting', message: p.message || 'Claude needs you' };
    }
    case 'PermissionRequest':
      // Sent the moment Claude asks (the Notification comes ~6 s later).
      return { state: 'waiting', message: `Claude needs your permission to use ${p.tool_name || 'a tool'}` };
    case 'Stop':
      return { state: 'done' };
    default:
      return null;
  }
}

module.exports = { SessionTracker, nextState, worktreeAgentId };
