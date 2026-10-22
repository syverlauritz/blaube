const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sessionUsage } = require('../src/main/usage.js');

const line = (id, usage, extra = {}) => JSON.stringify(Object.assign({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage } }, extra)) + '\n';

test('sums tokens once per API call and reads context from the last one', () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-')), 't.jsonl');
	const u1 = { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 100 };
	fs.writeFileSync(file, line('a', u1) + line('a', u1) + JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n');
	assert.deepStrictEqual(sessionUsage(file), { total: 1110, context: 6010, limit: 200000 });

	// Appended lines are picked up; a half-written line waits.
	const u2 = { input_tokens: 5, cache_creation_input_tokens: 200, cache_read_input_tokens: 6000, output_tokens: 50 };
	fs.appendFileSync(file, line('b', u2) + '{"type":"assis');
	assert.deepStrictEqual(sessionUsage(file), { total: 1365, context: 6205, limit: 200000 });

	// Subagent calls don't count toward the session's own context.
	fs.appendFileSync(file, 'tant"}\n' + line('c', { input_tokens: 1, cache_read_input_tokens: 99 }, { isSidechain: true }));
	assert.strictEqual(sessionUsage(file).context, 6205);
});

test('knows a 1M context session', () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-')), 't.jsonl');
	fs.writeFileSync(file, '{"type":"api-request","betas":["context-1m-2025-08-07"]}\n' + line('a', { input_tokens: 1, cache_read_input_tokens: 50000 }));
	assert.strictEqual(sessionUsage(file).limit, 1000000);
});

test('no file, no usage', () => {
	assert.strictEqual(sessionUsage(path.join(os.tmpdir(), 'blaube-missing.jsonl')), null);
	assert.strictEqual(sessionUsage(''), null);
});

test('finds background tasks in a transcript, minus the ones Claude stopped', () => {
	const { sessionTasks } = require('../src/main/usage.js');
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-')), 't.jsonl');
	const call = (id, name, input) => JSON.stringify({ type: 'assistant', message: { id: 'm' + id, content: [{ type: 'tool_use', id, name, input }] } }) + '\n';
	const result = (id, taskId) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id }] }, toolUseResult: { backgroundTaskId: taskId } }) + '\n';
	fs.writeFileSync(file,
		call('t1', 'PowerShell', { command: 'npm run dev', description: 'Dev server', run_in_background: true }) + result('t1', 'b1')
		+ call('t2', 'Bash', { command: 'npm test -- --watch', run_in_background: true }) + result('t2', 'b2')
		+ call('t3', 'Bash', { command: 'ls' })
		+ call('t4', 'KillShell', { shell_id: 'b2' }));
	assert.deepStrictEqual(sessionTasks(file), [{ id: 'b1', command: 'npm run dev', description: 'Dev server' }]);
});

test("helpers' tokens count toward the total, not the context", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-'));
	const file = path.join(dir, 's1.jsonl');
	fs.writeFileSync(file, line('a', { input_tokens: 10, cache_read_input_tokens: 5000, output_tokens: 90 }));
	fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
	fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-x.jsonl'), line('h', { input_tokens: 400, cache_read_input_tokens: 90000, output_tokens: 600 }, { isSidechain: true }));
	assert.deepStrictEqual(sessionUsage(file), { total: 1100, context: 5010, limit: 200000 });
});

test('reads the effort of the newest call, for the session and each helper', () => {
	const { sessionEffort } = require('../src/main/usage.js');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-'));
	const file = path.join(dir, 's1.jsonl');
	fs.writeFileSync(file, line('a', { input_tokens: 1 }, { effort: 'medium' }) + line('b', { input_tokens: 1 }, { effort: 'High' }) + line('c', { input_tokens: 1 }, { effort: 'low', isSidechain: true }));
	assert.strictEqual(sessionEffort(file), 'high');
	fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
	fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-x.jsonl'), line('h', { input_tokens: 1 }, { effort: 'low', isSidechain: true }));
	assert.strictEqual(sessionEffort(file, 'x'), 'low');
	assert.strictEqual(sessionEffort(file, 'missing'), '');
	assert.strictEqual(sessionEffort(path.join(dir, 'none.jsonl')), '');
});

test("a task started in a helper line is not the session's", () => {
	const { sessionTasks } = require('../src/main/usage.js');
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-')), 't.jsonl');
	const call = (id, input, extra) => JSON.stringify(Object.assign({ type: 'assistant', message: { id: 'm' + id, content: [{ type: 'tool_use', id, name: 'Bash', input }] } }, extra)) + '\n';
	const result = (id, taskId, extra) => JSON.stringify(Object.assign({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id }] }, toolUseResult: { backgroundTaskId: taskId } }, extra)) + '\n';
	fs.writeFileSync(file,
		call('h1', { command: 'npm run helper', run_in_background: true }, { isSidechain: true }) + result('h1', 'bh', { isSidechain: true })
		+ call('t1', { command: 'npm run dev', run_in_background: true }) + result('t1', 'b1'));
	assert.deepStrictEqual(sessionTasks(file).map((t) => t.id), ['b1']);
});

test('effort of the session and of a helper are read separately', () => {
	const { sessionEffort } = require('../src/main/usage.js');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-'));
	const file = path.join(dir, 's1.jsonl');
	fs.writeFileSync(file, line('a', { input_tokens: 1 }, { effort: 'xhigh' }));
	fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
	fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-x.jsonl'), line('h', { input_tokens: 1 }, { effort: 'low', isSidechain: true }));
	assert.strictEqual(sessionEffort(file), 'xhigh');
	assert.strictEqual(sessionEffort(file, 'x'), 'low');
	assert.strictEqual(sessionEffort(''), '');
});

test('lastText is the newest thing Claude said, not a helper or a tool call', () => {
	const { lastText } = require('../src/main/usage.js');
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-')), 't.jsonl');
	const say = (id, content, extra) => JSON.stringify(Object.assign({ type: 'assistant', message: { id, usage: { input_tokens: 1 }, content } }, extra)) + '\n';
	fs.writeFileSync(file,
		say('a', [{ type: 'text', text: 'First.' }])
		+ say('b', [{ type: 'text', text: 'All done.' }])
		+ say('c', [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }])
		+ say('d', [{ type: 'text', text: 'Helper chatter.' }], { isSidechain: true }));
	assert.strictEqual(lastText(file), 'All done.');
	assert.strictEqual(lastText(''), '');
	assert.strictEqual(lastText(path.join(os.tmpdir(), 'blaube-missing.jsonl')), '');
});
