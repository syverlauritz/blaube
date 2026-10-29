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

test("a helper's own tokens, from its transcript (subagents/agent-<id>.jsonl)", () => {
	const { helperTokens } = require('../src/main/usage.js');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-'));
	const file = path.join(dir, 's1.jsonl');
	fs.writeFileSync(file, line('a', { input_tokens: 10, output_tokens: 90 }));
	const sub = path.join(dir, 's1', 'subagents');
	fs.mkdirSync(sub, { recursive: true });
	const u = { input_tokens: 3, cache_creation_input_tokens: 30000, cache_read_input_tokens: 9000, output_tokens: 500 };
	// (One call written as two lines counts once; cache reads don't count.)
	fs.writeFileSync(path.join(sub, 'agent-a1b2c3.jsonl'), line('h1', u, { isSidechain: true }) + line('h1', u, { isSidechain: true }));
	fs.writeFileSync(path.join(sub, 'agent-a1b2c3.meta.json'), '{"agentType":"Explore"}');
	fs.writeFileSync(path.join(sub, 'agent-other.jsonl'), line('o', { input_tokens: 99999 }, { isSidechain: true }));
	assert.strictEqual(helperTokens(file, 'a1b2c3'), 30503);
	// It keeps up as the helper works.
	fs.appendFileSync(path.join(sub, 'agent-a1b2c3.jsonl'), line('h2', { input_tokens: 1, cache_creation_input_tokens: 2000, output_tokens: 496 }, { isSidechain: true }));
	assert.strictEqual(helperTokens(file, 'a1b2c3'), 33000);
	assert.strictEqual(helperTokens(file, 'nobody'), 0);
	assert.strictEqual(helperTokens('', 'a1b2c3'), 0);
});

test("a helper's numbers as the terminal shows them: when it began, and its newest call's tokens", () => {
	const { helperStats } = require('../src/main/usage.js');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-'));
	const file = path.join(dir, 's1.jsonl');
	const sub = path.join(dir, 's1', 'subagents');
	fs.mkdirSync(sub, { recursive: true });
	const at = '2026-10-26T10:00:00.000Z';
	fs.writeFileSync(path.join(sub, 'agent-k1.jsonl'), JSON.stringify({ type: 'user', isSidechain: true, timestamp: at, message: { content: 'go' } }) + '\n' + line('c1', { input_tokens: 5, cache_read_input_tokens: 20000, output_tokens: 300 }, { isSidechain: true, timestamp: '2026-10-26T10:00:05.000Z' }));
	assert.deepStrictEqual(helperStats(file, 'k1'), { since: Date.parse(at), tokens: 20305 });
	fs.appendFileSync(path.join(sub, 'agent-k1.jsonl'), line('c2', { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 116000, output_tokens: 0 }, { isSidechain: true }));
	assert.deepStrictEqual(helperStats(file, 'k1'), { since: Date.parse(at), tokens: 117002 });
	assert.deepStrictEqual(helperStats(file, 'nobody'), { since: 0, tokens: 0 });
});

test('a helper runs on its own model, not always its mother’s', () => {
	const { helperModel, sessionInfo } = require('../src/main/usage.js');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-'));
	const file = path.join(dir, 's1.jsonl');
	const sub = path.join(dir, 's1', 'subagents');
	fs.mkdirSync(sub, { recursive: true });
	fs.writeFileSync(file, line('m1', { input_tokens: 1, output_tokens: 1 }));
	fs.writeFileSync(path.join(sub, 'agent-k1.jsonl'), JSON.stringify({ type: 'assistant', isSidechain: true, message: { id: 'h1', model: 'claude-haiku-5-5', usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');
	assert.strictEqual(helperModel(file, 'k1'), 'claude-haiku-5-5');
	assert.strictEqual(sessionInfo(file).model, 'claude-opus-5-5');
	assert.strictEqual(helperModel(file, 'nobody'), '');
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

test('an API error Claude Code wrote down is found, the newest one said', () => {
	const { sessionApiErrors } = require('../src/main/usage.js');
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-')), 't.jsonl');
	const err = (text, extra = {}) => JSON.stringify(Object.assign({ type: 'assistant', isApiErrorMessage: true, message: { model: '<synthetic>', content: [{ type: 'text', text }] } }, extra)) + '\n';
	fs.writeFileSync(file, line('a', { input_tokens: 5 }));
	assert.deepStrictEqual(sessionApiErrors(file), { count: 0, text: '' });
	fs.appendFileSync(file, err('API Error: 529 Overloaded') + err('a helper’s', { isSidechain: true }) + err('5-hour limit reached ∙ resets 3pm'));
	assert.deepStrictEqual(sessionApiErrors(file), { count: 2, text: '5-hour limit reached ∙ resets 3pm' });
});
