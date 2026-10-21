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

test('a session merged back in by hand stays merged until it ends', () => {
  const t = new SessionTracker();
  t.handle(ev('UserPromptSubmit'));
  t.dismiss('s1');
  assert.equal(t.list().length, 0);
  t.handle(ev('PreToolUse'));
  t.applyAgents([{ sessionId: 's1', cwd: '/Users/me/code/blaube', status: 'busy' }]);
  assert.equal(t.list().length, 0);
  t.handle(ev('SessionEnd'));
  t.handle(ev('SessionStart'));
  assert.equal(t.list().length, 1);
});
