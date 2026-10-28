// Talking to a session while it works, as in the terminal: a message goes
// in at its next step and is answered straight away, and what Claude
// writes between its steps shows in the talk box as it's written.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Inbox, midFrame, frame, turnOf } = require('../src/main/inbox.js');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-midturn-')), 'session.jsonl');
const line = (e) => JSON.stringify(e) + '\n';
const you = (text) => line({ type: 'user', message: { role: 'user', content: text } });
const result = (id) => line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const says = (mid, text, more = {}) => line(Object.assign({ type: 'assistant', uuid: mid + text.length, message: { id: mid, role: 'assistant', content: [{ type: 'text', text }] } }, more));
const uses = (mid, id, name = 'Read') => line({ type: 'assistant', message: { id: mid, role: 'assistant', content: [{ type: 'tool_use', id, name, input: { file_path: '/w/a.js' } }] } });
const hook = (file, event, more = {}) => Object.assign({ session_id: 's1', hook_event_name: event, transcript_path: file, tool_name: 'Read', tool_input: { file_path: '/w/a.js' } }, more);
const said = (inbox) => inbox.log('s1').map((e) => e.who + ':' + e.text);

test('a message sent while it works asks for a short answer at once, then the work', () => {
	const m = midFrame('use tabs');
	assert.match(m, /while you were working/);
	assert.match(m, /very next text, before any more tool calls/);
	assert.match(m, /one or two short sentences/);
	assert.match(m, /carry on with the work, folding in any change/);
	assert.match(m, /small chat bubble/);
	assert.match(m, /use tabs$/);
	// (After a turn, it's still their next prompt.)
	assert.match(frame('hi'), /Treat it as their next prompt/);
});

test('a queued message goes in at the first tool hook: PreToolUse, PostToolUse or a failure', () => {
	for (const event of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']) {
		const inbox = new Inbox(undefined, { poll: 0 });
		inbox.send('s1', 'also the docs');
		const out = JSON.parse(inbox.step({ session_id: 's1', hook_event_name: event, tool_name: 'Bash' }, true)).hookSpecificOutput;
		assert.equal(out.hookEventName, event);
		assert.equal(out.additionalContext, midFrame('also the docs'));
		assert.equal(inbox.view('s1').queued, 0);
		assert.equal(inbox.log('s1')[0].midTurn, true);
	}
	// Not by a helper's tool, and Stop still turns its tools down first.
	const inbox = new Inbox(undefined, { poll: 0 });
	inbox.send('s1', 'wait');
	assert.equal(inbox.step({ session_id: 's1', hook_event_name: 'PreToolUse', agent_id: 'h1' }, true), '');
	assert.equal(inbox.stop('s1'), true);
	const out = JSON.parse(inbox.step({ session_id: 's1', hook_event_name: 'PreToolUse' }, true)).hookSpecificOutput;
	assert.equal(out.permissionDecision, 'deny');
	assert.equal(out.additionalContext, undefined);
	assert.equal(inbox.view('s1').queued, 1);
});

test('what it writes between steps shows as it is written, in order, and the reply only once', () => {
	const file = tmp();
	fs.writeFileSync(file, you('old prompt') + says('m0', 'An old reply.'));
	let now = 1000;
	const inbox = new Inbox(() => now, { poll: 0 });
	const replies = [];
	inbox.on('reply', (id, e) => replies.push(e.text));
	inbox.observe(hook(file, 'UserPromptSubmit', { prompt: 'fix it' }));
	fs.appendFileSync(file, you('fix it') + says('m1', 'Let me look first.') + uses('m1', 't1'));
	inbox.observe(hook(file, 'PreToolUse'));
	now += 5000;
	fs.appendFileSync(file, result('t1'));
	inbox.observe(hook(file, 'PostToolUse'));
	assert.deepEqual(said(inbox), ['you:fix it', 'claude:Let me look first.', 'step:Read a.js']);
	assert.equal(inbox.log('s1')[1].live, true);
	// A helper's words, Claude Code's own and API errors aren't Claude's lines.
	fs.appendFileSync(file, says('h1', 'helper talk', { isSidechain: true }) + says('m2', 'No response requested.', { message: { id: 'm2', model: '<synthetic>', content: [{ type: 'text', text: 'x' }] } }) + says('m3', 'API Error', { isApiErrorMessage: true }));
	// In pieces, one message is one line; picked up between hooks too.
	fs.appendFileSync(file, says('m4', 'Found it.') + says('m4', 'Fixing now.'));
	inbox.tick();
	assert.deepEqual(said(inbox).slice(3), ['claude:Found it.\n\nFixing now.']);
	assert.deepEqual(replies, [], 'a line on the way is not the reply');
	// (Nothing new: nothing added. Only the new end is read.)
	inbox.catchUp('s1');
	assert.equal(inbox.log('s1').length, 4);
	fs.appendFileSync(file, uses('m4', 't2') + result('t2') + says('m5', 'Done: it was a typo.'));
	inbox.observe(hook(file, 'PostToolUse'));
	now += 5000;
	inbox.observe({ session_id: 's1', hook_event_name: 'Stop', transcript_path: file, last_assistant_message: 'Done: it was a typo.' });
	const log = inbox.log('s1');
	assert.deepEqual(said(inbox), ['you:fix it', 'claude:Let me look first.', 'step:Read a.js', 'claude:Found it.\n\nFixing now.', 'step:Read a.js', 'claude:Done: it was a typo.']);
	const reply = log[log.length - 1];
	assert.equal(reply.live, undefined);
	assert.equal(reply.turn.steps, 2, 'the turn counts from the prompt, past what it said on the way');
	assert.deepEqual(replies, ['Done: it was a typo.']);
	// The turn is over: nothing more is read until the next one.
	fs.appendFileSync(file, says('m6', 'late'));
	inbox.tick();
	assert.equal(inbox.log('s1').length, 6);
});

test('a reply the transcript has not caught up with is still shown once', () => {
	const file = tmp();
	fs.writeFileSync(file, '');
	const inbox = new Inbox(undefined, { poll: 0 });
	inbox.observe(hook(file, 'UserPromptSubmit', { prompt: 'hi' }));
	fs.appendFileSync(file, you('hi'));
	inbox.observe({ session_id: 's1', hook_event_name: 'Stop', transcript_path: file, last_assistant_message: 'Hello!' });
	// It lands only once the next turn has started.
	inbox.observe(hook(file, 'UserPromptSubmit', { prompt: 'again' }));
	fs.appendFileSync(file, says('m1', 'Hello!') + you('again') + says('m2', 'On it.'));
	inbox.observe(hook(file, 'PreToolUse'));
	assert.deepEqual(said(inbox), ['you:hi', 'claude:Hello!', 'you:again', 'claude:On it.']);
});

test('first heard of mid-turn: only this turn’s lines, from the end of its transcript', () => {
	const file = tmp();
	fs.writeFileSync(file, you('before') + says('m0', 'Earlier answer.') + you('now this') + says('m1', 'Starting.') + uses('m1', 't1'));
	const inbox = new Inbox(undefined, { poll: 0 });
	inbox.observe(hook(file, 'PreToolUse'));
	assert.deepEqual(said(inbox), ['claude:Starting.']);
});

test('a session Blaube started: its lines as it writes them, its reply once', () => {
	const inbox = new Inbox(undefined, { poll: 0 });
	inbox.owned.add('s1');
	inbox.say('s1', 'go');
	inbox.said('s1', 'Reading the file.', 'm1');
	inbox.observe({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/w/a.js' }, transcript_path: '/nowhere.jsonl' });
	inbox.said('s1', 'All good.', 'm2');
	inbox.replied('s1', 'All good.');
	assert.deepEqual(said(inbox), ['you:go', 'claude:Reading the file.', 'step:Read a.js', 'claude:All good.']);
	assert.equal(turnOf(inbox.log('s1').slice(0, 3), Date.now()).steps, 1);
	assert.equal(inbox.tails.size, 0, 'its transcript isn’t read: its own output says');
});
