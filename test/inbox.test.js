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
