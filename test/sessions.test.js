const test = require('node:test');
const assert = require('node:assert');
const { SessionTracker } = require('../src/main/sessions.js');
const { startHookServer } = require('../src/main/hookServer.js');

const ev = (hook_event_name, extra = {}) => ({ session_id: 's1', cwd: '/Users/me/code/blaube', hook_event_name, ...extra });

test('follows a session through a typical turn', () => {
  const t = new SessionTracker();
  const changes = [];
  t.on('change', (c) => changes.push(c.to));
  t.handle(ev('SessionStart'));
  t.handle(ev('UserPromptSubmit'));
  t.handle(ev('PreToolUse', { tool_name: 'Bash' }));
  t.handle(ev('Notification', { message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' }));
  assert.equal(t.list()[0].state, 'waiting');
  assert.equal(t.list()[0].message, 'Claude needs your permission to use Bash');
  t.handle(ev('PostToolUse'));
  t.handle(ev('Stop'));
  t.handle(ev('Notification', { message: 'Claude is waiting for your input', notification_type: 'idle_prompt' }));
  assert.equal(t.list()[0].state, 'done');
  assert.equal(t.list()[0].project, 'blaube');
  assert.deepEqual(changes, ['idle', 'working', 'waiting', 'working', 'done']);
  t.handle(ev('SessionEnd'));
  assert.equal(t.list().length, 0);
});

test('stale working sessions fall back to idle', () => {
  let now = 0;
  const t = new SessionTracker(() => now);
  t.handle(ev('UserPromptSubmit'));
  now = 20 * 60 * 1000;
  assert.ok(t.prune());
  assert.equal(t.list()[0].state, 'idle');
});

test('hook server feeds the tracker', async () => {
  const t = new SessionTracker();
  const server = await startHookServer(t, 0);
  const { port } = server.address();
  const r = await fetch(`http://127.0.0.1:${port}/blaube/hook`, { method: 'POST', body: JSON.stringify(ev('UserPromptSubmit')) });
  assert.equal(r.status, 204);
  assert.equal(t.list()[0].state, 'working');
  server.close();
});

test('claude agents polling tracks sessions without hooks, and defers to hooks', () => {
  const t = new SessionTracker();
  t.applyAgents([{ sessionId: 'a', cwd: '/x/proj', status: 'busy' }]);
  assert.equal(t.list()[0].state, 'working');
  t.applyAgents([{ sessionId: 'a', cwd: '/x/proj', status: 'idle' }]);
  assert.equal(t.list()[0].state, 'done');
  // Hooks take over: a waiting state from a hook isn't overwritten by polling.
  t.handle({ session_id: 'a', hook_event_name: 'Notification', message: 'perm', notification_type: 'permission_prompt' });
  t.applyAgents([{ sessionId: 'a', cwd: '/x/proj', status: 'busy' }]);
  assert.equal(t.list()[0].state, 'waiting');
  // A polled-only session disappears when it leaves the list.
  t.applyAgents([{ sessionId: 'b', cwd: '/y', status: 'busy' }]);
  assert.deepEqual(t.list().map((s) => s.id).sort(), ['a', 'b']);
  t.applyAgents([]);
  assert.deepEqual(t.list().map((s) => s.id), ['a']);
});

test('a hooked session that was killed (no SessionEnd) merges back once claude agents stops listing it', () => {
  let now = 0;
  const t = new SessionTracker(() => now);
  t.handle(ev('UserPromptSubmit'));
  t.applyAgents([{ sessionId: 's1', cwd: '/x', status: 'busy' }]);
  t.applyAgents([]);
  t.applyAgents([]);
  t.applyAgents([]);
  assert.equal(t.list().length, 1, 'recent hook activity keeps it alive');
  now = 2 * 60 * 1000;
  t.applyAgents([]);
  assert.equal(t.list().length, 0);
});

test('subagents join and leave their session', () => {
  const t = new SessionTracker();
  let changes = 0;
  t.on('change', () => changes++);
  t.handle(ev('UserPromptSubmit'));
  t.handle(ev('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }));
  t.handle(ev('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }));
  assert.deepEqual(t.list()[0].agents.map((a) => [a.id, a.type, a.state]), [['a1', 'Explore', 'working']]);
  // A tool call inside a subagent we never saw start still adds it, and
  // doesn't change the session's own state.
  t.handle(ev('Stop'));
  t.handle(ev('PreToolUse', { agent_id: 'a2', agent_type: 'Plan', tool_name: 'Read' }));
  assert.equal(t.list()[0].state, 'done');
  assert.equal(t.list()[0].agents.length, 2);
  // A subagent asking for permission makes the whole session need you.
  t.handle(ev('Notification', { agent_id: 'a2', message: 'Claude needs your permission to use Bash' }));
  assert.equal(t.list()[0].state, 'waiting');
  assert.equal(t.list()[0].agents[1].state, 'waiting');
  t.handle(ev('SubagentStop', { agent_id: 'a1', agent_type: 'Explore' }));
  t.handle(ev('SubagentStop', { agent_id: 'a2', agent_type: 'Plan' }));
  assert.equal(t.list()[0].agents.length, 0);
  assert.ok(changes >= 6);
});

test('stale subagents are dropped', () => {
  let now = 0;
  const t = new SessionTracker(() => now);
  t.handle(ev('UserPromptSubmit'));
  t.handle(ev('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }));
  now = 20 * 60 * 1000;
  assert.ok(t.prune());
  assert.equal(t.list()[0].agents.length, 0);
});

test('background tasks: started, stopped by Claude, and pruned when gone', () => {
  let now = 1000;
  const t = new SessionTracker(() => now);
  t.handle({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
  const bg = (id, command) => ({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command, run_in_background: true }, tool_response: { backgroundTaskId: id } });
  t.handle(bg('b1', 'npm run dev'));
  t.handle(bg('b2', 'npm test -- --watch'));
  t.handle(bg('b2', 'npm test -- --watch'));
  t.handle({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.deepStrictEqual(t.sessions.get('s').tasks.map((x) => x.id), ['b1', 'b2']);

  t.handle({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'KillShell', tool_input: { shell_id: 'b1' } });
  assert.deepStrictEqual(t.sessions.get('s').tasks.map((x) => x.id), ['b2']);

  // Missing from the process list: kept while new, then after two misses dropped.
  assert.strictEqual(t.pruneTasks(new Set()), false);
  now += 10000;
  assert.strictEqual(t.pruneTasks(new Set()), false);
  assert.strictEqual(t.pruneTasks(new Set()), true);
  assert.strictEqual(t.sessions.get('s').tasks.length, 0);
});

test('a helper in its own worktree keeps working without making the session look busy', () => {
  const t = new SessionTracker();
  t.handle(ev('UserPromptSubmit'));
  t.handle(ev('Stop'));
  // No agent_id on the event, but the worktree folder names the helper.
  t.handle(ev('PreToolUse', { tool_name: 'Bash', cwd: 'C:\\Git\\play\\.claude\\worktrees\\agent-ac9ab22488de0f5e6' }));
  const s = t.sessions.get('s1');
  assert.strictEqual(s.state, 'done');
  assert.strictEqual(s.cwd, '/Users/me/code/blaube');
  assert.deepStrictEqual(s.agents.map((a) => a.id), ['ac9ab22488de0f5e6']);
});

test('tells thinking and running a tool apart', () => {
  const t = new SessionTracker();
  const act = () => t.sessions.get('s1').activity;
  t.handle(ev('UserPromptSubmit'));
  assert.strictEqual(act(), 'thinking');
  t.handle(ev('PreToolUse', { tool_name: 'Bash' }));
  assert.strictEqual(act(), 'tool');
  t.handle(ev('PostToolUse', { tool_name: 'Bash' }));
  assert.strictEqual(act(), 'thinking');
});

test('seedTasks adds transcript tasks once per session and skips known ids', () => {
  const t = new SessionTracker();
  t.handle({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
  t.handle({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm run dev', run_in_background: true }, tool_response: { backgroundTaskId: 'b1' } });
  assert.strictEqual(t.seedTasks('nope', [{ id: 'x', command: 'x' }]), false);
  assert.strictEqual(t.seedTasks('s', [{ id: 'b1', command: 'npm run dev' }, { id: 'b2', command: 'npm test' }]), true);
  assert.deepStrictEqual(t.sessions.get('s').tasks.map((x) => x.id), ['b1', 'b2']);
  assert.strictEqual(t.seedTasks('s', [{ id: 'b3', command: 'later' }]), false);
  assert.deepStrictEqual(t.sessions.get('s').tasks.map((x) => x.id), ['b1', 'b2']);
});

test('seeding counts as done even with nothing to add', () => {
  const t = new SessionTracker();
  t.handle({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
  assert.strictEqual(t.seedTasks('s', []), false);
  assert.strictEqual(t.seedTasks('s', [{ id: 'b1', command: 'a' }]), false);
  assert.strictEqual(t.sessions.get('s').tasks.length, 0);
});

test('a seeded task has no grace: dropped after two polls without it', () => {
  const t = new SessionTracker(() => 10000);
  t.handle({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
  t.seedTasks('s', [{ id: 'b1', command: 'npm run dev' }]);
  assert.strictEqual(t.sessions.get('s').tasks[0].startedAt, 0);
  assert.strictEqual(t.pruneTasks(new Set(['b1'])), false);
  assert.strictEqual(t.pruneTasks(new Set()), false);
  assert.strictEqual(t.pruneTasks(new Set()), true);
  assert.strictEqual(t.sessions.get('s').tasks.length, 0);
});

test('a prompt event fires on UserPromptSubmit only', () => {
  const t = new SessionTracker();
  const prompts = [];
  t.on('prompt', (s) => prompts.push(s.id));
  t.handle(ev('UserPromptSubmit'));
  t.handle(ev('PreToolUse', { tool_name: 'Bash' }));
  t.handle(ev('Stop'));
  assert.deepStrictEqual(prompts, ['s1']);
});

test('activity events: main session has an empty agentId, a helper has its own', () => {
  const t = new SessionTracker();
  const seen = [];
  t.on('activity', (a) => seen.push([a.payload.hook_event_name, a.agentId]));
  t.handle(ev('UserPromptSubmit'));
  t.handle(ev('PreToolUse', { tool_name: 'Bash' }));
  t.handle(ev('PreToolUse', { agent_id: 'a1', agent_type: 'Explore', tool_name: 'Read' }));
  t.handle(ev('PostToolUse', { tool_name: 'Bash' }));
  t.handle(ev('Notification', { message: 'Claude needs your permission' }));
  t.handle(ev('Stop'));
  assert.deepStrictEqual(seen, [['PreToolUse', ''], ['PreToolUse', 'a1'], ['Notification', ''], ['Stop', '']]);
});
