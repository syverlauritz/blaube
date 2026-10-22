// Tracks Claude Code sessions from hook events. Each session is one of:
//   idle    - open, nothing happening yet
//   working - Claude is thinking or running tools
//   waiting - Claude needs you (permission prompt, question)
//   done    - Claude finished its turn
// A session also keeps a list of the subagents it is running right now, and
// of the background tasks (servers and such) Claude started for it.
const path = require('node:path');
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
      if (prev) { this.sessions.delete(id); this.emit('change', { session: prev, from: prev.state, to: 'gone' }); }
      return;
    }

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
      project: cwd ? path.basename(cwd.replace(/[\\/]+$/, '')) : 'Claude',
      state: next.state,
      // While working: 'thinking' (the model) or 'tool' (running a tool).
      activity: activityAfter(event, prev && prev.activity),
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
    if (!prev || prev.state !== session.state) {
      this.emit('change', { session, from: prev ? prev.state : null, to: session.state });
    }
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
    const agentState = event === 'Notification' ? 'waiting' : event === 'PreToolUse' || event === 'PostToolUse' ? 'working' : null;
    if (!agentState) return false;
    let agent = session.agents.find((a) => a.id === agentId);
    const changed = !agent || agent.state !== agentState;
    if (!agent) {
      agent = { id: agentId, type: String(p.agent_type || 'agent'), state: agentState, updatedAt: 0 };
      session.agents = [...session.agents, agent];
    }
    agent.state = agentState;
    agent.activity = activityAfter(event, agent.activity);
    agent.updatedAt = this.now();
    if (event === 'PreToolUse') this.emit('activity', { session, agentId, payload: p });
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
  }

  // Marks done/waiting sessions as seen, so Blaube stops pestering.
  acknowledge() {
    for (const s of this.sessions.values()) s.seen = true;
  }

  prune() {
    const t = this.now();
    let changed = false;
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
  if (event === 'PostToolUse' || event === 'UserPromptSubmit') return 'thinking';
  return prev || 'thinking';
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

module.exports = { SessionTracker, nextState, worktreeAgentId };
