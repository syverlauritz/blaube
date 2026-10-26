const test = require('node:test');
const assert = require('node:assert');
const { planAfter, progress } = require('../src/main/plan.js');
const { SessionTracker } = require('../src/main/sessions.js');

const todo = (todos) => ({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos } });

test('a TodoWrite list becomes the plan', () => {
  const p = planAfter(null, todo([
    { content: 'Add the parser', status: 'completed' },
    { content: 'Write tests', activeForm: 'Writing tests', status: 'in_progress' },
    { content: 'Update docs', status: 'pending' },
  ]));
  assert.deepEqual(progress(p), { done: 1, total: 3, current: 'Writing tests' });
});

test('TaskCreate and TaskUpdate build one up', () => {
  let p = null;
  p = planAfter(p, { tool_name: 'TaskCreate', tool_input: { subject: 'One' }, tool_response: { task: { id: '7' } } });
  p = planAfter(p, { tool_name: 'TaskCreate', tool_input: { subject: 'Two' } });
  p = planAfter(p, { tool_name: 'TaskUpdate', tool_input: { taskId: '7', status: 'completed' } });
  p = planAfter(p, { tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'in_progress' } });
  assert.deepEqual(progress(p), { done: 1, total: 2, current: 'Two' });
  p = planAfter(p, { tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'deleted' } });
  assert.deepEqual(progress(p), { done: 1, total: 1, current: '' });
  assert.equal(planAfter(p, { tool_name: 'Bash', tool_input: { command: 'ls' } }), p);
});

test('a session keeps its plan, and puts a finished one away at the next prompt', () => {
  const t = new SessionTracker();
  const ev = (e, extra = {}) => t.handle({ session_id: 's', cwd: '/tmp/x', hook_event_name: e, ...extra });
  ev('UserPromptSubmit');
  ev('PostToolUse', todo([{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }]));
  ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.deepEqual(t.sessions.get('s').progress, { done: 0, total: 2, current: 'A' });
  ev('UserPromptSubmit');
  assert.equal(t.sessions.get('s').progress.total, 2, 'unfinished, it stays');
  ev('PostToolUse', todo([{ content: 'A', status: 'completed' }, { content: 'B', status: 'completed' }]));
  ev('Stop');
  assert.equal(t.sessions.get('s').progress.done, 2);
  ev('UserPromptSubmit');
  assert.equal(t.sessions.get('s').progress, null);
});

test('a turn counts the files it edits and the commands it runs', () => {
  const t = new SessionTracker();
  const ev = (e, extra = {}) => t.handle({ session_id: 's', cwd: '/tmp/x', hook_event_name: e, ...extra });
  ev('UserPromptSubmit');
  ev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/a.js' } });
  ev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/a.js' } });
  ev('PreToolUse', { tool_name: 'Write', tool_input: { file_path: '/b.js' } });
  ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  ev('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test\necho done' } });
  ev('Stop');
  assert.deepEqual(t.sessions.get('s').turn, { files: ['/a.js', '/b.js'], cmds: 1, fails: 1, lastFail: 'npm test' });
  ev('UserPromptSubmit');
  assert.deepEqual(t.sessions.get('s').turn, { files: [], cmds: 0 });
});

test("a session tallies today's turns and time worked, fresh each day", () => {
  let now = new Date(2026, 9, 26, 10, 0).getTime();
  const t = new SessionTracker(() => now);
  const ev = (e, extra = {}) => t.handle({ session_id: 's', cwd: '/tmp/x', hook_event_name: e, ...extra });
  ev('UserPromptSubmit'); now += 5 * 60e3; ev('Stop');
  ev('UserPromptSubmit'); now += 3 * 60e3; ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }); now += 2 * 60e3; ev('Stop');
  ev('Stop'); // (a second Stop isn't another turn)
  assert.deepEqual(t.sessions.get('s').today, { day: new Date(now).toDateString(), turns: 2, workMs: 10 * 60e3 });
  // A turn over midnight only counts from midnight, and the tally starts again.
  now = new Date(2026, 9, 26, 23, 50).getTime(); ev('UserPromptSubmit');
  now = new Date(2026, 9, 27, 0, 20).getTime(); ev('Stop');
  assert.deepEqual(t.sessions.get('s').today, { day: new Date(now).toDateString(), turns: 1, workMs: 20 * 60e3 });
});
