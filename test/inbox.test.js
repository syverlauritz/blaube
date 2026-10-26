const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { Inbox } = require('../src/main/inbox.js');
const { SessionTracker } = require('../src/main/sessions.js');
const { startHookServer } = require('../src/main/hookServer.js');
const { inboxCommand, permissionCommand } = require('../src/main/claudeHooks.js');

test('a message goes straight to a waiting session, or queues until it asks', () => {
  const inbox = new Inbox();
  const got = [];
  inbox.wait('s1', (t) => got.push(t));
  assert.equal(inbox.view('s1').inbox, 'ready');
  assert.equal(inbox.send('s1', 'hello'), 'sent');
  assert.equal(got.length, 1);
  assert.match(got[0], /hello$/);
  assert.equal(inbox.view('s1').inbox, 'busy');
  // Busy: queued, then handed over the moment its hook asks again.
  assert.equal(inbox.send('s1', 'second'), 'queued');
  assert.equal(inbox.view('s1').queued, 1);
  inbox.wait('s1', (t) => got.push(t));
  assert.match(got[1], /second$/);
  assert.deepEqual(inbox.log('s1').map((e) => [e.who, e.status]), [['you', 'delivering'], ['you', 'delivering']]);
});

test('a newer hook replaces an older one, and typing in the terminal lets it go', () => {
  const inbox = new Inbox();
  const a = [], b = [];
  inbox.wait('s1', (t) => a.push(t));
  inbox.wait('s1', (t) => b.push(t));
  assert.deepEqual(a, [null]);
  inbox.observe({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'from the terminal' });
  assert.deepEqual(b, [null]);
  assert.equal(inbox.send('s1', 'later'), 'queued');
  inbox.observe({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'All done.' });
  inbox.observe({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<summary>Stop hook feedback</summary>' });
  // The reply answers the terminal prompt; the queued message comes after it.
  assert.deepEqual(inbox.log('s1').map((e) => e.who + ':' + e.text), ['you:from the terminal', 'claude:All done.', 'you:later']);
});

test('end to end: the installed hook command wakes Claude with the message', async () => {
  const inbox = new Inbox();
  const server = await startHookServer(new SessionTracker(), 0, inbox);
  const port = server.address().port;
  try {
    const run = () => new Promise((resolve) => {
      const p = spawn('sh', ['-c', inboxCommand(port)]);
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('exit', (code) => resolve({ code, err }));
      p.stdin.end(JSON.stringify({ session_id: 'e2e', hook_event_name: 'Stop' }));
    });
    const asked = new Promise((r) => inbox.once('change', r));
    const first = run();
    await asked;
    inbox.send('e2e', 'say PINEAPPLE');
    const r1 = await first;
    assert.equal(r1.code, 2, 'exit 2 wakes Claude');
    assert.match(r1.err, /say PINEAPPLE/);
    // Let go (the user typed in the terminal): exits quietly.
    const asked2 = new Promise((r) => inbox.once('change', r));
    const second = run();
    await asked2;
    inbox.observe({ session_id: 'e2e', hook_event_name: 'UserPromptSubmit' });
    const r2 = await second;
    assert.equal(r2.code, 0);
    assert.equal(r2.err, '');
  } finally {
    server.close();
  }
});

test('a permission prompt is answered from the slime: allow, always or deny', () => {
  const inbox = new Inbox();
  const got = [];
  const ask = (extra = {}) => inbox.ask('s1', Object.assign({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, extra), (t) => got.push(t && JSON.parse(t)));
  ask();
  const v = inbox.view('s1').ask;
  assert.deepEqual([v.tool, v.detail, v.always], ['Bash', 'npm test', '']);
  inbox.decide('s1', v.key, 'allow');
  assert.deepEqual(got[0].hookSpecificOutput.decision, { behavior: 'allow' });
  assert.equal(inbox.view('s1').ask, null);
  const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' };
  ask({ permission_suggestions: [rule] });
  inbox.decide('s1', inbox.view('s1').ask.key, 'always');
  assert.deepEqual(got[1].hookSpecificOutput.decision.updatedPermissions, [rule]);
  ask();
  inbox.decide('s1', inbox.view('s1').ask.key, 'deny');
  assert.equal(got[2].hookSpecificOutput.decision.behavior, 'deny');
  assert.deepEqual(inbox.log('s1').map((e) => e.text), ['Allowed Bash: npm test', 'Always allowed Bash: npm test', 'Denied Bash: npm test']);
});

test('answering in the terminal takes the prompt off the slime', () => {
  const inbox = new Inbox();
  const reply = () => true;
  inbox.ask('s1', { tool_name: 'Edit', tool_input: { file_path: '/x/a.js' } }, reply);
  assert.equal(inbox.view('s1').ask.detail, '/x/a.js');
  inbox.unasked('s1', reply);
  assert.equal(inbox.view('s1').ask, null);
});

test('end to end: the permission hook prints the decision, and never waits without a terminal', async () => {
  const inbox = new Inbox();
  const tracker = new SessionTracker();
  tracker.handle({ session_id: 'p1', hook_event_name: 'SessionStart', cwd: '/tmp/x' });
  const server = await startHookServer(tracker, 0, inbox);
  const port = server.address().port;
  const run = (entry) => new Promise((resolve) => {
    const p = spawn('sh', ['-c', permissionCommand(port)], { env: Object.assign({}, process.env, { CLAUDE_CODE_ENTRYPOINT: entry }) });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ code, out }));
    p.stdin.end(JSON.stringify({ session_id: 'p1', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }));
  });
  try {
    const asked = new Promise((r) => inbox.once('change', r));
    const pending = run('cli');
    await asked;
    assert.equal(tracker.sessions.get('p1').state, 'waiting');
    inbox.decide('p1', inbox.view('p1').ask.key, 'allow');
    const r = await pending;
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).hookSpecificOutput.decision.behavior, 'allow');
    const headless = await run('sdk-cli');
    assert.deepEqual(headless, { code: 0, out: '' });
  } finally {
    server.close();
  }
});

test('permission cards name tools and rules the way a person would', () => {
  const { toolName, alwaysLabel } = require('../src/main/inbox.js');
  assert.equal(toolName('mcp__claude_ai_Gmail__send_message'), 'Gmail: send message');
  assert.equal(toolName('Bash'), 'Bash');
  assert.equal(alwaysLabel([{ type: 'addRules', behavior: 'allow', rules: [{ toolName: 'Bash', ruleContent: 'npm run build:*' }] }]), 'Always allow npm run build:*');
  assert.equal(alwaysLabel([{ type: 'addDirectories', directories: ['/Users/me/proj/'] }]), 'Always allow files in proj');
  assert.equal(alwaysLabel([{ type: 'setMode', mode: 'acceptEdits' }]), 'Always allow edits for this session');
});

test('a queued message can be taken back before it goes in', () => {
  const inbox = new Inbox();
  inbox.send('s1', 'oops');
  inbox.send('s1', 'keep');
  const oops = inbox.log('s1')[0];
  assert.ok(inbox.unsend('s1', oops.n));
  const got = [];
  inbox.wait('s1', (t) => got.push(t));
  assert.match(got[0], /keep$/);
  assert.doesNotMatch(got[0], /oops/);
  assert.deepEqual(inbox.log('s1').map((e) => e.text), ['keep']);
});

test('a reply to the turn before lands above what the slime sent meanwhile, either way round', () => {
  for (const hookFirst of [false, true]) {
    const inbox = new Inbox();
    inbox.observe({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'P' });
    inbox.send('s1', 'Q'); // queued: Claude is busy with P
    const stop = () => inbox.observe({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'R1' });
    const ask = () => inbox.wait('s1', () => true);
    if (hookFirst) { ask(); stop(); } else { stop(); ask(); }
    assert.deepEqual(inbox.log('s1').map((e) => e.text), ['P', 'R1', 'Q'], hookFirst ? 'hook first' : 'stop first');
    inbox.observe({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>x' });
    inbox.observe({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'R2' });
    assert.deepEqual(inbox.log('s1').map((e) => e.text), ['P', 'R1', 'Q', 'R2']);
    assert.equal(inbox.log('s1')[2].status, 'sent');
  }
});

test('Claude’s questions are answered with the chosen labels, plans approved or sent back', () => {
  const inbox = new Inbox();
  const got = [];
  const questions = [{ question: 'Which pet?', header: 'Pet', options: [{ label: 'Cats', description: 'Purr' }, { label: 'Dogs', description: 'Woof' }], multiSelect: false }];
  inbox.ask('s1', { tool_name: 'AskUserQuestion', tool_input: { questions } }, (t) => got.push(JSON.parse(t)));
  const v = inbox.view('s1').ask;
  assert.equal(v.kind, 'question');
  assert.deepEqual(v.questions[0].options.map((o) => o.label), ['Cats', 'Dogs']);
  assert.equal(inbox.decide('s1', v.key, 'answer', {}), false, 'no answer, no reply');
  assert.equal(inbox.decide('s1', v.key, 'answer', { 'Something else?': 'x' }), false, 'an answer to another question is no answer');
  inbox.decide('s1', v.key, 'answer', { 'Which pet?': 'Cats' });
  assert.deepEqual(got[0].hookSpecificOutput.decision, { behavior: 'allow', updatedInput: { questions, answers: { 'Which pet?': 'Cats' } } });
  inbox.ask('s1', { tool_name: 'ExitPlanMode', tool_input: { plan: '1. Do it', planFilePath: '/p.md' } }, (t) => got.push(JSON.parse(t)));
  assert.equal(inbox.view('s1').ask.plan, '1. Do it');
  inbox.decide('s1', inbox.view('s1').ask.key, 'allow');
  assert.deepEqual(got[1].hookSpecificOutput.decision, { behavior: 'allow', updatedInput: { plan: '1. Do it', planFilePath: '/p.md' } });
  inbox.ask('s1', { tool_name: 'ExitPlanMode', tool_input: { plan: '1. Do it' } }, (t) => got.push(JSON.parse(t)));
  inbox.decide('s1', inbox.view('s1').ask.key, 'deny');
  assert.equal(got[2].hookSpecificOutput.decision.behavior, 'deny');
  assert.deepEqual(inbox.log('s1').map((e) => e.text), ['Answered: Which pet? → Cats', 'Approved the plan', 'Kept planning']);
});

test('a card with several questions only goes with every one answered; a plan sent back carries what to change', () => {
  const inbox = new Inbox();
  const got = [];
  const questions = [{ question: 'A?', options: [{ label: 'x' }] }, { question: 'B?', options: [{ label: 'y' }] }];
  inbox.ask('s1', { tool_name: 'AskUserQuestion', tool_input: { questions } }, (t) => got.push(JSON.parse(t)));
  const key = inbox.view('s1').ask.key;
  assert.equal(inbox.decide('s1', key, 'answer', { 'A?': 'x' }), false);
  assert.equal(got.length, 0);
  assert.equal(inbox.decide('s1', key, 'answer', { 'A?': 'x', 'B?': 'y, and more' }), true);
  assert.deepEqual(got[0].hookSpecificOutput.decision.updatedInput.answers, { 'A?': 'x', 'B?': 'y, and more' });
  inbox.ask('s1', { tool_name: 'ExitPlanMode', tool_input: { plan: 'p' }, permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] }, (t) => got.push(JSON.parse(t)));
  assert.equal(inbox.view('s1').ask.always, 'Go ahead, and auto-accept edits');
  inbox.decide('s1', inbox.view('s1').ask.key, 'deny', { message: 'use fewer steps' });
  assert.match(got[1].hookSpecificOutput.decision.message, /use fewer steps/);
});

test('a session without an inbox hook gets its messages typed in, once, and not logged twice', () => {
  const inbox = new Inbox();
  inbox.send('s1', 'hello there');
  inbox.send('s1', 'and this');
  const text = inbox.takeForTyping('s1');
  assert.equal(text, 'hello there and this');
  assert.equal(inbox.view('s1').queued, 0);
  assert.equal(inbox.takeForTyping('s1'), '', 'nothing twice');
  inbox.observe({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'hello there and this' });
  assert.deepEqual(inbox.log('s1').map((e) => e.text), ['hello there', 'and this'], 'its echo isn’t logged as a new prompt');
  inbox.send('s2', 'try me');
  const t2 = inbox.takeForTyping('s2');
  inbox.untake('s2', t2);
  assert.equal(inbox.view('s2').queued, 1, 'typing failed: back in the queue');
});

test('a web page can’t talk to Blaube’s server (only hooks can)', async () => {
  const http = require('node:http');
  const inbox = new Inbox();
  const tracker = new SessionTracker();
  const server = await startHookServer(tracker, 0, inbox);
  const port = server.address().port;
  const post = (path, headers, body) => new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => { res.resume(); done(res.statusCode); });
    req.end(body);
  });
  try {
    const fake = JSON.stringify({ session_id: 'evil', hook_event_name: 'SessionStart', cwd: '/x' });
    assert.equal(await post('/blaube/hook', { 'content-type': 'text/plain', origin: 'https://example.com' }, fake), 403);
    assert.equal(await post('/blaube/hook/inbox', { 'sec-fetch-site': 'cross-site' }, fake), 403);
    assert.equal(tracker.sessions.has('evil'), false);
    assert.equal(await post('/blaube/hook', { 'content-type': 'application/json' }, fake), 204, 'curl (no origin) still works');
    assert.equal(tracker.sessions.has('evil'), true);
  } finally { server.closeAllConnections(); server.close(); }
});

test('a permission answered in the terminal leaves the slime; failed typing re-queues exactly what was taken', () => {
  const inbox = new Inbox();
  const got = [];
  inbox.ask('s1', { tool_name: 'Bash', tool_input: { command: 'npm test' } }, (t) => got.push(t));
  inbox.ask('s1', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, (t) => got.push(t));
  inbox.observe({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(inbox.view('s1').ask.detail, 'rm -rf build', 'only the one that ran went');
  inbox.observe({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'ok' });
  assert.equal(inbox.view('s1').ask, null, 'the turn ended: nothing left to answer');

  const t = new Inbox();
  t.send('s2', 'ok');
  t.takeForTyping('s2');
  t.send('s2', 'ok, now ship it');
  const text = t.takeForTyping('s2');
  t.untake('s2', text);
  assert.equal(t.view('s2').queued, 1, '"ok" isn’t sent twice');
  t.send('s3', 'line one\nline two');
  const typed = t.takeForTyping('s3');
  assert.equal(typed, 'line one line two');
  t.observe({ session_id: 's3', hook_event_name: 'UserPromptSubmit', prompt: typed });
  assert.equal(t.log('s3').length, 1, 'its echo isn’t logged twice');
});

test('what it did shows as steps between what was said; its own bookkeeping does not', () => {
  const inbox = new Inbox();
  inbox.observe({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'fix it' });
  inbox.observe({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/a/b/face.js' } });
  inbox.observe({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: {} });
  inbox.observe({ session_id: 's1', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the tests' } });
  inbox.observe({ session_id: 's1', agent_id: 'h1', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'x.js' } });
  inbox.observe({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'Fixed.' });
  assert.deepEqual(inbox.log('s1').map((e) => [e.who, e.text, e.ok]), [
    ['you', 'fix it', undefined], ['step', 'Read face.js', true], ['step', 'Run the tests', false], ['claude', 'Fixed.', undefined],
  ]);
});

test('steps never push what was said out of the log', () => {
  const inbox = new Inbox();
  inbox.observe({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'first' });
  for (let i = 0; i < 200; i++) inbox.observe({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: `f${i}.js` } });
  const log = inbox.log('s1');
  assert.equal(log[0].text, 'first');
  assert.ok(log.filter((e) => e.who === 'step').length <= 60);
  assert.equal(log[log.length - 1].text, 'Edited f199.js');
});

test('a message from the slime goes in at the next step, if the hooks can hand it over', () => {
  const inbox = new Inbox();
  const heard = [];
  inbox.on('heard', (id) => heard.push(id));
  const post = { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} };
  // Hooks from an older Blaube can't hand anything back: it waits for the turn.
  assert.equal(inbox.send('s1', 'also the tests'), 'queued');
  assert.equal(inbox.step(post, false), '');
  assert.equal(inbox.view('s1').queued, 1);
  assert.equal(inbox.view('s1').stoppable, false);
  // Ones that can: it goes in with the next tool result, and nods.
  assert.equal(inbox.step({ ...post, hook_event_name: 'PreToolUse' }, true), '');
  const out = JSON.parse(inbox.step(post, true));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /Blaube[\s\S]*also the tests$/);
  assert.equal(inbox.view('s1').queued, 0);
  assert.equal(inbox.log('s1')[0].status, 'sent');
  assert.deepEqual(heard, ['s1']);
  // Nothing waiting: nothing handed back. Helpers' steps never carry it.
  assert.equal(inbox.step(post, true), '');
  inbox.send('s1', 'more');
  assert.equal(inbox.step({ ...post, agent_id: 'h1' }, true), '');
  assert.equal(inbox.view('s1').queued, 1);
});

test('Stop turns down every tool until the turn ends, and only for hooks that can say so', () => {
  const inbox = new Inbox();
  const pre = { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } };
  assert.equal(inbox.stop('s1'), false, 'never heard from its tool hooks');
  inbox.step(pre, true);
  assert.equal(inbox.stop('s1'), true);
  assert.equal(inbox.stop('s1'), false, 'once is enough');
  assert.equal(inbox.view('s1').stopping, true);
  for (const p of [pre, { ...pre, agent_id: 'h1' }, pre]) {
    const out = JSON.parse(inbox.step(p, true));
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /Stop/);
  }
  // While stopping, a message waits for the turn to end rather than going in.
  inbox.send('s1', 'next');
  assert.equal(inbox.step({ ...pre, hook_event_name: 'PostToolUse' }, true), '');
  inbox.observe({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'Stopped after reading.' });
  assert.equal(inbox.view('s1').stopping, false);
  assert.equal(inbox.step(pre, true), '');
  assert.ok(inbox.log('s1').some((e) => e.who === 'note' && /stop/.test(e.text)));
});

test('end to end: the tool hook hands Blaube\'s answer back to Claude', async () => {
  const { toolHookCommand } = require('../src/main/claudeHooks.js');
  const inbox = new Inbox();
  const tracker = new SessionTracker();
  const server = await startHookServer(tracker, 0, inbox);
  const port = server.address().port;
  const run = (payload) => new Promise((resolve) => {
    const p = spawn('sh', ['-c', toolHookCommand(port)]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ code, out }));
    p.stdin.end(JSON.stringify(payload));
  });
  try {
    const post = { session_id: 'e2e', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'a.js' }, cwd: '/tmp/e2e' };
    assert.deepEqual(await run(post), { code: 0, out: '' });
    inbox.send('e2e', 'say MANGO');
    const r = await run(post);
    assert.equal(r.code, 0);
    assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /say MANGO/);
    assert.ok(inbox.stop('e2e'));
    const s = await run({ ...post, hook_event_name: 'PreToolUse' });
    assert.equal(JSON.parse(s.out).hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    server.close();
  }
});

test('a step keeps what you would have seen in the terminal', () => {
  const { stepDetail } = require('../src/main/inbox.js');
  assert.equal(stepDetail({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.js', old_string: 'let a = 1;', new_string: 'const a = 1;\nconst b = 2;' } }),
    '− let a = 1;\n+ const a = 1;\n+ const b = 2;');
  assert.equal(stepDetail({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: '# pass 90\n', stderr: '' } }), '$ npm test\n# pass 90');
  assert.equal(stepDetail({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'false' }, error: 'Exit code 1' }), '$ false\nExit code 1');
  assert.equal(stepDetail({ hook_event_name: 'PostToolUseFailure', tool_name: 'Read', tool_input: { file_path: 'x' }, error: 'File does not exist.' }), 'File does not exist.');
  assert.equal(stepDetail({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'x' }, tool_response: { file: {} } }), '', 'reading: nothing to show');
  // Long output: its end, which is where the answer is.
  const long = stepDetail({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'build' }, tool_response: { stdout: 'x'.repeat(5000) + 'DONE' } });
  assert.ok(long.length <= 1501 && long.endsWith('DONE') && long.startsWith('…'));
  const inbox = new Inbox();
  inbox.observe({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: 'a.js' } });
  assert.equal(inbox.log('s1')[0].detail, '$ ls\na.js');
});

test('its to-do list follows TodoWrite and the task tools', () => {
  const inbox = new Inbox();
  const post = (tool_name, tool_input, tool_response) => inbox.observe({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response });
  post('TodoWrite', { todos: [
    { content: 'Read the code', activeForm: 'Reading the code', status: 'completed' },
    { content: 'Fix the bug', activeForm: 'Fixing the bug', status: 'in_progress' },
    { content: 'Run the tests', activeForm: 'Running the tests', status: 'pending' },
  ] });
  assert.deepEqual(inbox.view('s1').todos.map((t) => [t.text, t.status]), [['Read the code', 'completed'], ['Fix the bug', 'in_progress'], ['Run the tests', 'pending']]);
  assert.equal(inbox.view('s1').todos[1].doing, 'Fixing the bug');
  // Task tools: one at a time, by id.
  const inbox2 = new Inbox();
  const post2 = (tool_name, tool_input, tool_response) => inbox2.observe({ session_id: 's2', hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response });
  post2('TaskCreate', { subject: 'Write docs', activeForm: 'Writing docs' }, { task: { id: '1' } });
  post2('TaskCreate', { subject: 'Ship it' }, { task: { id: '2' } });
  post2('TaskUpdate', { taskId: '1', status: 'in_progress' });
  assert.deepEqual(inbox2.view('s2').todos.map((t) => t.status), ['in_progress', 'pending']);
  post2('TaskUpdate', { taskId: '1', status: 'completed' });
  post2('TaskUpdate', { taskId: '2', status: 'completed' });
  post2('TaskCreate', { subject: 'Next thing' }, { task: { id: '3' } });
  assert.deepEqual(inbox2.view('s2').todos.map((t) => t.text), ['Next thing'], 'a new list once the old one is done');
  inbox2.observe({ session_id: 's2', hook_event_name: 'SessionEnd' });
  assert.deepEqual(inbox2.view('s2').todos, []);
});

test('Stop also answers a waiting permission prompt with no, and a session that ends forgets it all', () => {
  const inbox = new Inbox();
  const got = [];
  inbox.step({ session_id: 's1', hook_event_name: 'PreToolUse' }, true);
  inbox.ask('s1', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, (t) => { got.push(t); return true; });
  assert.ok(inbox.stop('s1'));
  assert.equal(JSON.parse(got[0]).hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(inbox.view('s1').ask, null);
  inbox.observe({ session_id: 's1', hook_event_name: 'SessionEnd' });
  assert.equal(inbox.view('s1').stoppable, false);
  assert.equal(inbox.view('s1').stopping, false);
});

test('several sessions at once keep their own messages, steps and stops', () => {
  const inbox = new Inbox();
  const post = (id) => ({ session_id: id, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: id + '.js' } });
  inbox.step(post('a'), true); inbox.step(post('b'), true);
  inbox.send('a', 'for a');
  inbox.stop('b');
  assert.equal(inbox.step(post('b'), true), '', 'b is stopping: its message would wait anyway, and a\'s is not b\'s');
  assert.match(JSON.parse(inbox.step(post('a'), true)).hookSpecificOutput.additionalContext, /for a$/);
  assert.equal(JSON.parse(inbox.step({ ...post('b'), hook_event_name: 'PreToolUse' }, true)).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(inbox.step({ ...post('a'), hook_event_name: 'PreToolUse' }, true), '');
});

test('a tool with a huge output still reaches Blaube, and its step stays small', async () => {
  const inbox = new Inbox();
  const server = await startHookServer(new SessionTracker(), 0, inbox);
  const port = server.address().port;
  try {
    const body = JSON.stringify({ session_id: 'big', hook_event_name: 'PostToolUse', cwd: '/tmp/big', tool_name: 'Bash', tool_input: { command: 'cat log' }, tool_response: { stdout: 'x'.repeat(3e6) + 'END' } });
    const http = require('node:http');
    await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-blaube-out': '1' } }, (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', reject);
      req.end(body);
    });
    const step = inbox.log('big')[0];
    assert.equal(step.who, 'step');
    assert.ok(step.detail.length < 1600 && step.detail.endsWith('END'));
  } finally {
    server.close();
  }
});

test('ticking off a to-do item, and pressing Stop, are moments the slime can react to', () => {
  const inbox = new Inbox();
  const seen = [];
  inbox.on('ticked', (id, t) => seen.push(['ticked', id, t.done, t.of]));
  inbox.on('stopping', (id) => seen.push(['stopping', id]));
  const todos = (...st) => inbox.observe({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: st.map((status, i) => ({ content: 'item ' + i, status })) } });
  todos('in_progress', 'pending');
  todos('in_progress', 'pending'); // no change: nothing
  todos('completed', 'in_progress');
  todos('completed', 'completed');
  inbox.step({ session_id: 's1', hook_event_name: 'PreToolUse' }, true);
  inbox.stop('s1');
  assert.deepEqual(seen, [['ticked', 's1', 1, 2], ['ticked', 's1', 2, 2], ['stopping', 's1']]);
});

test('a session that carries on under a new id keeps its conversation, list and messages', () => {
  const inbox = new Inbox();
  inbox.owned.add('old');
  inbox.add('old', { who: 'you', text: 'hi', via: 'blaube', status: 'sent' });
  inbox.todos.set('old', [{ id: '1', text: 'x', doing: 'x', status: 'pending' }]);
  const tracker = new SessionTracker();
  tracker.handle({ session_id: 'old', hook_event_name: 'SessionStart', cwd: '/w' });
  assert.ok(tracker.rename('old', 'new'));
  inbox.rename('old', 'new');
  assert.equal(tracker.sessions.get('new').id, 'new');
  assert.ok(!tracker.sessions.has('old'));
  assert.equal(inbox.log('new')[0].text, 'hi');
  assert.ok(inbox.owned.has('new') && !inbox.owned.has('old'));
  assert.equal(inbox.view('new').todos.length, 1);
});

test('a hook payload too big to read whole still says what happened', async () => {
  const inbox = new Inbox();
  const tracker = new SessionTracker();
  const server = await startHookServer(tracker, 0, inbox);
  const port = server.address().port;
  try {
    const body = JSON.stringify({ session_id: 'huge', transcript_path: '/t', cwd: '/tmp/huge', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'cat big.log', description: 'Show the log' }, tool_response: { stdout: 'x'.repeat(6e6) } });
    const http = require('node:http');
    await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/blaube/hook', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', reject);
      req.end(body);
    });
    const step = inbox.log('huge')[0];
    assert.deepEqual([step.text, step.detail], ['Show the log', '$ cat big.log\n(too long to show)']);
  } finally {
    server.close();
  }
});

test('a reply says what its turn came to: time, steps, files changed', () => {
  let t = 1000;
  const inbox = new Inbox(() => t);
  inbox.observe({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'fix it' });
  t += 30e3;
  const post = (tool_name, tool_input) => inbox.observe({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name, tool_input });
  post('Read', { file_path: '/w/a.js' });
  post('Edit', { file_path: '/w/a.js', old_string: 'x', new_string: 'y' });
  post('Edit', { file_path: '/w/a.js', old_string: 'y', new_string: 'z' });
  post('Write', { file_path: '/w/b.js', content: 'new' });
  t += 150e3;
  inbox.observe({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'Fixed.' });
  const reply = inbox.log('s1').find((e) => e.who === 'claude');
  assert.deepEqual(reply.turn, { took: 180e3, steps: 4, files: ['/w/a.js', '/w/b.js'] });
  assert.equal(inbox.log('s1')[1].file, '/w/a.js');
  // A reply with nothing before it says nothing extra.
  const inbox2 = new Inbox();
  inbox2.observe({ session_id: 's2', hook_event_name: 'Stop', last_assistant_message: 'Hi.' });
  assert.equal(inbox2.log('s2')[0].turn, undefined);
});

test('a message added mid-turn doesn’t start a new turn: the reply counts every step', () => {
  let t = 1000;
  const inbox = new Inbox(() => t);
  inbox.observe({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'add 2027' });
  const post = (tool_name, tool_input) => { const p = { session_id: 's1', hook_event_name: 'PostToolUse', tool_name, tool_input }; inbox.observe(p); return inbox.step(p, true); };
  post('Edit', { file_path: '/w/tax.js', old_string: 'a', new_string: 'b' });
  t += 60e3;
  inbox.send('s1', 'and 2028');
  assert.match(post('Bash', { command: 'npm test' }), /2028/);
  post('Edit', { file_path: '/w/tax.test.js', old_string: 'a', new_string: 'b' });
  t += 60e3;
  inbox.observe({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'Both in.' });
  const reply = inbox.log('s1').find((e) => e.who === 'claude');
  assert.deepEqual(reply.turn, { took: 120e3, steps: 3, files: ['/w/tax.js', '/w/tax.test.js'] });
});
