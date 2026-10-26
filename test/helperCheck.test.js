const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionTracker } = require('../src/main/sessions.js');
const { verdict, evidence, notifications, reconcile } = require('../src/main/helperCheck.js');

// A made-up session folder: its transcript, and its helpers' files next to it.
const NOW = Date.parse('2026-10-26T12:00:00Z');
const min = 60e3;
function folder() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-helpers-'));
	const transcript = path.join(dir, 's1.jsonl');
	fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
	fs.writeFileSync(transcript, '');
	const sub = (id) => path.join(dir, 's1', 'subagents', `agent-${id}`);
	return {
		transcript,
		// One helper: its info file, its transcript (last entry) and when that was last written.
		helper(id, { meta = {}, last, ago = 0, trail = [] }) {
			fs.writeFileSync(sub(id) + '.meta.json', JSON.stringify(Object.assign({ agentType: 'general-purpose', description: 'Do it', requestShape: 'background' }, meta)));
			if (!last) return;
			const lines = [{ type: 'user', timestamp: new Date(NOW - ago - 5000).toISOString(), message: { role: 'user', content: 'go' } }, Object.assign({ timestamp: new Date(NOW - ago).toISOString() }, last), ...trail];
			fs.writeFileSync(sub(id) + '.jsonl', lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
			fs.utimesSync(sub(id) + '.jsonl', (NOW - ago) / 1000, (NOW - ago) / 1000);
		},
		// Claude Code telling her a helper's done, as it writes it.
		note(id, status, ago = 0) {
			const content = `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_x</tool-use-id>\n<output-file>C:\\tmp\\${id}.output</output-file>\n<status>${status}</status>\n<summary>Agent "Do it" ${status}</summary>\n</task-notification>`;
			fs.appendFileSync(transcript, JSON.stringify({ type: 'user', timestamp: new Date(NOW - ago).toISOString(), message: { role: 'user', content } }) + '\n');
			// (and a copy inside an API request, which has no time of its own)
			fs.appendFileSync(transcript, JSON.stringify({ type: 'api-request-blob', content: [{ type: 'text', text: content }] }) + '\n');
		},
	};
}
const ended = { type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'All done.' }] } };
const usingTool = { type: 'assistant', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } };
const toolBack = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } };

function trackerWith(ids, at = NOW - 30 * min) {
	let now = at;
	const t = new SessionTracker(() => now);
	t.handle({ session_id: 's1', cwd: '/Users/me/code/blaube', hook_event_name: 'UserPromptSubmit' });
	for (const id of ids) t.handle({ session_id: 's1', hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'general-purpose' });
	t.handle({ session_id: 's1', hook_event_name: 'Stop' });
	return { t, set: (v) => { now = v; } };
}
async function check(t, transcript) {
	const gone = [];
	await reconcile(t.list(), () => transcript, (s, a, why) => {
		gone.push(`${a.id}: ${why}`);
		t.handle({ session_id: s.id, hook_event_name: 'SubagentStop', agent_id: a.id });
	}, () => NOW);
	return gone;
}
const ids = (t) => t.sessions.get('s1').agents.map((a) => a.id).sort();

test('a helper whose SubagentStop never came goes home once its transcript says it ended its turn', async () => {
	const f = folder();
	f.helper('a1', { last: ended, ago: 2 * min }); // ended 2 min ago, no stop reached us
	f.helper('a2', { last: ended, ago: 20e3 }); // only just ended: a moment more (it may be sent another message)
	const { t } = trackerWith(['a1', 'a2']);
	const gone = await check(t, f.transcript);
	assert.deepStrictEqual(gone, ['a1: it ended its turn']);
	assert.deepStrictEqual(ids(t), ['a2']);
});

test('a background helper that finished (or failed) is let go when her task-notification says so', async () => {
	const f = folder();
	f.helper('b1', { last: ended, ago: 10e3 });
	f.note('b1', 'completed', 9e3);
	// Failed on an API error mid tool call: never marked finished, no stop.
	f.helper('b2', { last: usingTool, ago: 3 * min });
	f.note('b2', 'failed', 3 * min - 1000);
	// Finished once, then sent another message: at it again since.
	f.helper('b3', { last: usingTool, ago: 5e3 });
	f.note('b3', 'completed', 4 * min);
	const { t } = trackerWith(['b1', 'b2', 'b3']);
	const gone = await check(t, f.transcript);
	assert.deepStrictEqual(gone.sort(), ['b1: she was told it completed', 'b2: she was told it failed']);
	assert.deepStrictEqual(ids(t), ['b3']);
	const told = await notifications(f.transcript);
	assert.strictEqual(told.get('b2').status, 'failed');
});

test('after Blaube restarts, a stray hook from a finished helper brings it out only until the check', async () => {
	const f = folder();
	f.helper('c1', { meta: { finished: true }, last: ended, ago: 10e3 });
	f.helper('c2', { last: usingTool, ago: 40 * min }); // went quiet long ago (killed with its session's terminal, say)
	const { t } = trackerWith([], NOW);
	// Fresh tracker: only tool hooks name them.
	t.handle({ session_id: 's1', hook_event_name: 'PostToolUse', agent_id: 'c1', tool_name: 'Read' });
	t.handle({ session_id: 's1', hook_event_name: 'PostToolUse', agent_id: 'c2', tool_name: 'Bash' });
	t.sessions.get('s1').agents.find((a) => a.id === 'c2').updatedAt = NOW - 40 * min;
	assert.deepStrictEqual(ids(t), ['c1', 'c2']);
	const gone = await check(t, f.transcript);
	assert.deepStrictEqual(gone.sort(), ['c1: marked finished', 'c2: quiet too long']);
	assert.deepStrictEqual(ids(t), []);
});

test('helpers that are really at work stay out', async () => {
	const f = folder();
	f.helper('d1', { last: usingTool, ago: 12 * min, trail: [{ type: 'attachment', attachment: { type: 'deferred_tools_record' } }] }); // a long test run: nothing written till it's back (bar its bookkeeping)
	f.helper('d2', { last: toolBack, ago: 2 * min }); // thinking
	f.helper('d3', { last: toolBack, ago: 8 * min }); // "thinking" for 8 min: something went wrong
	const { t } = trackerWith(['d1', 'd2', 'd3']);
	const gone = await check(t, f.transcript);
	assert.deepStrictEqual(gone, ['d3: quiet too long']);
	assert.deepStrictEqual(ids(t), ['d1', 'd2']);
	// One asking you something waits as long as you do (within reason).
	assert.strictEqual(verdict({ state: 'waiting', updatedAt: NOW - 30 * min }, { lastAt: NOW - 30 * min, lastKind: 'tool' }, { alive: true }, NOW), '');
	// One with no transcript to look at goes by its hooks.
	assert.strictEqual(verdict({ state: 'working', updatedAt: NOW - 10 * min }, {}, { alive: true }, NOW), '');
	assert.strictEqual(verdict({ state: 'working', updatedAt: NOW - 16 * min }, {}, { alive: true }, NOW), 'quiet too long');
});

test('a foreground helper can’t outlive its mother’s turn; none outlive her', async () => {
	const f = folder();
	f.helper('e1', { meta: { requestShape: 'foreground' }, last: toolBack, ago: min });
	const { t } = trackerWith(['e1']);
	assert.deepStrictEqual(await check(t, f.transcript), ['e1: its mother finished her turn']);
	assert.strictEqual(verdict({ state: 'working', updatedAt: NOW }, { lastAt: NOW, lastKind: 'tool' }, { alive: false }, NOW), 'its mother is gone');
	// Her session ending takes its helpers with it.
	const { t: t2 } = trackerWith(['e2']);
	t2.handle({ session_id: 's1', hook_event_name: 'SessionEnd' });
	assert.strictEqual(t2.sessions.size, 0);
});

test('evidence reads a helper’s files, and copes with them missing', async () => {
	const f = folder();
	f.helper('g1', { meta: { finished: true }, last: usingTool, ago: min });
	const e = await evidence(f.transcript, 'g1');
	assert.deepStrictEqual([e.finished, e.foreground, e.lastKind, Math.round((NOW - e.lastAt) / 1000)], [true, false, 'tool', 60]);
	const none = await evidence(f.transcript, 'nobody');
	assert.deepStrictEqual([none.finished, none.lastAt, none.lastKind], [false, 0, '']);
	assert.strictEqual((await evidence('', 'x')).lastAt, 0);
});

test('a finished helper is not brought back by stragglers or by its old worktree', () => {
	let now = 1000;
	const t = new SessionTracker(() => now);
	const ev = (hook_event_name, extra = {}) => t.handle({ session_id: 's1', cwd: '/Users/me/code/blaube', hook_event_name, ...extra });
	ev('UserPromptSubmit');
	ev('SubagentStart', { agent_id: 'ab12' });
	ev('SubagentStop', { agent_id: 'ab12' });
	// Its last PostToolUse arriving just after its stop.
	ev('PostToolUse', { agent_id: 'ab12', tool_name: 'Bash' });
	assert.deepStrictEqual(ids(t), []);
	// Her own call from inside its old worktree folder is hers, not the helper's.
	now += 60e3;
	ev('PreToolUse', { tool_name: 'Bash', cwd: '/Users/me/code/blaube/.claude/worktrees/agent-ab12' });
	assert.deepStrictEqual(ids(t), []);
	assert.strictEqual(t.sessions.get('s1').activity, 'tool');
	// Sent another message later on, it carries on: same id, out again.
	ev('PreToolUse', { agent_id: 'ab12', tool_name: 'Read' });
	assert.deepStrictEqual(ids(t), ['ab12']);
	// A helper she waited for comes back with its answer: done.
	ev('SubagentStart', { agent_id: 'cd34' });
	ev('PostToolUse', { tool_name: 'Agent', tool_response: { status: 'completed', agentId: 'cd34', content: [] } });
	assert.deepStrictEqual(ids(t), ['ab12']);
	// (One sent off in the background isn't done just because it started.)
	ev('PostToolUse', { tool_name: 'Agent', tool_response: { status: 'async_launched', agentId: 'ab12' } });
	assert.deepStrictEqual(ids(t), ['ab12']);
});
