const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { Inbox } = require('../src/main/inbox.js');
const { SessionTracker } = require('../src/main/sessions.js');
const { startHookServer } = require('../src/main/hookServer.js');
const { inboxCommand } = require('../src/main/claudeHooks.js');

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
  assert.deepEqual(inbox.log('s1').map((e) => [e.who, e.status]), [['you', 'sent'], ['you', 'sent']]);
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
  assert.deepEqual(inbox.log('s1').map((e) => e.who + ':' + e.text), ['you:from the terminal', 'you:later', 'claude:All done.']);
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
