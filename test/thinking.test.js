const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { latestThinking, tailOf, thinkingOf, helperFile } = require('../src/main/thinking.js');

const FIX = path.join(__dirname, 'fixtures', 'thinking');
const SESSION = path.join(FIX, 'fixture-session.jsonl');
const L = (o) => JSON.stringify(o);
const think = (t, extra = {}) => L(Object.assign({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: t, signature: 's' }] } }, extra));

test('the newest real thinking of this turn, past empty and redacted blocks, tools and text', () => {
	const t = latestThinking(fs.readFileSync(SESSION, 'utf8'));
	assert.ok(t.startsWith('The batter recipe lives in recipes/pancakes.md.'), t);
	assert.ok(t.endsWith('a note about frozen berries.'), t);
	assert.ok(!/\s{2,}|\n/.test(t), 'whitespace collapsed');
});

test('a helper transcript (all sidechain) is read as its own', () => {
	const raw = fs.readFileSync(helperFile(SESSION, 'fixture-helper'), 'utf8');
	assert.match(latestThinking(raw, false), /^Buttermilk shows up/);
	assert.strictEqual(latestThinking(raw, true), '', 'a session skips helper lines');
});

test('nothing from an earlier turn, and nothing when it is all empty or redacted', () => {
	assert.strictEqual(latestThinking([think('old idea'), L({ type: 'user', message: { content: 'next thing' } })].join('\n')), '');
	assert.strictEqual(latestThinking([
		L({ type: 'user', message: { content: 'go' } }),
		think(''),
		L({ type: 'assistant', message: { content: [{ type: 'redacted_thinking', data: 'abc' }] } }),
		L({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } }),
		L({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking out loud' }] } }),
	].join('\n')), '');
	// A tool's result coming back isn't a new turn; a half line is skipped.
	assert.strictEqual(latestThinking([think('keep going'), L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } }), '{"type":"assistant","message":{"content":[{"type":"thin'].join('\n')), 'keep going');
});

test('tail: the end of it, cut at a word', () => {
	assert.strictEqual(tailOf('short and sweet'), 'short and sweet');
	const t = tailOf('alpha beta gamma delta epsilon', 14);
	assert.strictEqual(t, '…delta epsilon');
});

test('reads only the end of a big file, and keeps the answer until the file changes', async () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-')), 't.jsonl');
	const filler = L({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(1000) }] } });
	fs.writeFileSync(file, [L({ type: 'user', message: { content: 'go' } }), think('lost far back'), ...Array(400).fill(filler), think('the plan is to fix the hover bubble first')].join('\n') + '\n');
	assert.strictEqual(await thinkingOf(file), 'the plan is to fix the hover bubble first');
	fs.appendFileSync(file, think('and then the blush') + '\n');
	assert.strictEqual(await thinkingOf(file), 'and then the blush');
	assert.strictEqual(await thinkingOf(path.join(path.dirname(file), 'missing.jsonl')), '');
	assert.strictEqual(await thinkingOf(''), '');
});
