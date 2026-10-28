const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { page, entries } = require('../src/main/transcript.js');
const { shown } = require('../src/shared/talkHistory.js');

// Made-up transcript lines, in the shapes Claude Code writes them.
const T0 = Date.UTC(2026, 9, 26, 9, 0);
const ts = (s) => new Date(T0 + s * 1000).toISOString();
const user = (s, content, more) => Object.assign({ type: 'user', timestamp: ts(s), uuid: 'u' + s, message: { role: 'user', content } }, more);
const said = (s, blocks, more) => Object.assign({ type: 'assistant', timestamp: ts(s), message: { id: 'm' + s, role: 'assistant', content: blocks } }, more);
const text = (t) => ({ type: 'text', text: t });
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (s, id, content, toolUseResult, isError) => user(s, [{ type: 'tool_result', tool_use_id: id, content, is_error: !!isError }], { toolUseResult });
const lines = (list) => list.map((e, i) => ({ off: i * 100, e }));

test('a transcript reads as the talk box’s log: what you typed, the steps, the reply', () => {
	const got = entries(lines([
		{ type: 'file-history-snapshot', snapshot: {} },
		user(0, 'make the tests pass'),
		said(1, [{ type: 'thinking', thinking: 'secret thoughts' }]),
		said(2, [text('Let me look first.')]),
		said(3, [use('t1', 'Read', { file_path: '/work/app/src/tax.js' })]),
		result(4, 't1', 'file contents', { type: 'text', file: { filePath: '/work/app/src/tax.js' } }),
		said(5, [use('t2', 'Edit', { file_path: '/work/app/src/tax.js', old_string: 'a', new_string: 'b' })]),
		result(6, 't2', 'The file was updated', { filePath: '/work/app/src/tax.js', oldString: 'a', newString: 'b' }),
		said(7, [use('t3', 'Bash', { command: 'npm test', description: 'Run the tests' })]),
		result(8, 't3', 'Exit code 1', 'Error: Exit code 1\n# pass 3\n# fail 1', true),
		said(9, [use('t4', 'TodoWrite', { todos: [] })]),
		result(10, 't4', 'ok', {}),
		said(70, [text('Fixed: the rounding was off.')]),
		{ type: 'system', subtype: 'stop_hook_summary', timestamp: ts(71) },
	]));
	// (What it said on the way shows too, as the live log shows it.)
	assert.deepEqual(got.map((e) => [e.who, e.text]), [
		['you', 'make the tests pass'],
		['claude', 'Let me look first.'],
		['step', 'Read tax.js'],
		['step', 'Edited tax.js'],
		['step', 'Run the tests'],
		['claude', 'Fixed: the rounding was off.'],
	]);
	assert.equal(got[1].live, true);
	assert.equal(got[5].live, undefined);
	assert.equal(got[0].via, 'terminal');
	assert.equal(got[0].at, T0);
	assert.equal(got[3].detail, '− a\n+ b');
	assert.equal(got[3].file, '/work/app/src/tax.js');
	assert.equal(got[4].ok, false);
	assert.match(got[4].detail, /^\$ npm test\n/);
	assert.deepEqual(got[5].turn, { took: 70e3, steps: 3, files: ['/work/app/src/tax.js'] });
	assert.ok(got.every((e) => e.n < 0), 'its own numbers, never the live log’s');
	assert.equal(new Set(got.map((e) => e.n)).size, got.length);
});

test('what isn’t part of the conversation is left out; a compaction is one divider', () => {
	const got = entries(lines([
		user(0, '<command-name>/model</command-name>'),
		user(1, '<local-command-caveat>Caveat</local-command-caveat>', { isMeta: true }),
		user(2, 'a reminder', { isMeta: true }),
		user(3, [text('[Image #1] what is this?'), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]),
		said(4, [text('A cat.')]),
		said(5, [text('helper talk')], { isSidechain: true }),
		user(6, 'helper prompt', { isSidechain: true }),
		{ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', timestamp: ts(7) },
		user(8, 'This session is being continued from a previous conversation…', { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
		user(9, '<task-notification>woke up</task-notification>'),
		user(10, 'go on'),
		said(11, [text('Working')]),
		said(12, [use('t9', 'Grep', { pattern: 'x' })]),
		user(13, [text('[Request interrupted by user for tool use]')]),
		user(14, 'try again'),
		said(15, [text('API Error: overloaded')], { isApiErrorMessage: true }),
		{ type: 'api-request-blob', message: { role: 'user', content: [text('the request again')] } },
	]));
	assert.deepEqual(got.map((e) => [e.who, e.text]), [
		['you', '[Image #1] what is this?'],
		['claude', 'A cat.'],
		['note', 'Context compacted'],
		['you', 'go on'],
		['claude', 'Working'],
		['note', 'Interrupted'],
		['you', 'try again'],
		['note', 'Claude Code: API Error: overloaded'],
	]);
	assert.equal(got[2].divider, true);
	assert.equal(got[7].error, true);
});

test('a reply in pieces is one reply; a step whose call is on an earlier page is skipped', () => {
	const got = entries(lines([
		result(0, 'gone', 'x', {}),
		user(1, 'hi'),
		said(2, [text('Hello.')]),
		Object.assign(said(2, [text('How can I help?')]), { message: { id: 'm2', content: [text('How can I help?')] } }),
	]));
	assert.deepEqual(got.map((e) => [e.who, e.text]), [['you', 'hi'], ['claude', 'Hello.\n\nHow can I help?']]);
});

function fixture(turns) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-transcript-'));
	const file = path.join(dir, 'session.jsonl');
	const out = [];
	for (let i = 0; i < turns; i++) {
		const s = i * 10;
		out.push(user(s, `question ${i}`), said(s + 1, [use('r' + i, 'Read', { file_path: `/work/f${i}.js` })]), result(s + 2, 'r' + i, 'x'.repeat(200), {}), said(s + 3, [text(`answer ${i}`)]));
		out.push({ type: 'last-prompt', lastPrompt: `question ${i}` });
	}
	fs.writeFileSync(file, out.map((e) => JSON.stringify(e)).join('\n') + '\n');
	return file;
}

test('a page at a time from the end, each starting where a turn does, none missed or twice', async () => {
	const file = fixture(30);
	const first = await page(file, { bytes: 4000, least: 3 });
	assert.ok(first.from > 0, 'there’s more before it');
	assert.equal(first.entries[0].who, 'you');
	assert.equal(first.entries[first.entries.length - 1].text, 'answer 29');
	const all = [...first.entries];
	let from = first.from, pages = 1;
	while (from > 0 && pages < 50) {
		const p = await page(file, { before: from, bytes: 4000, least: 3 });
		assert.ok(p.from < from);
		assert.equal(p.entries[0].who, 'you');
		all.unshift(...p.entries);
		from = p.from; pages++;
	}
	assert.ok(pages > 2);
	const whole = await page(file);
	assert.equal(whole.from, 0);
	assert.deepEqual(all, whole.entries);
	assert.equal(whole.entries.filter((e) => e.who === 'you').length, 30);
	assert.deepEqual(whole.entries.slice(0, 3).map((e) => e.text), ['question 0', 'Read f0.js', 'answer 0']);
});

test('a page is read back far enough for a few turns, and holds so many at most', async () => {
	const few = await page(fixture(12), { bytes: 300, least: 4 });
	assert.deepEqual(few.entries.filter((e) => e.who === 'you').map((e) => e.text), ['question 8', 'question 9', 'question 10', 'question 11']);
	const capped = await page(fixture(12), { bytes: 300, least: 20, most: 900 });
	assert.ok(capped.entries.filter((e) => e.who === 'you').length <= 2, 'not more than it may read');
	assert.ok(capped.from > 0);
	const file = fixture(12);
	const p = await page(file, { turns: 5 });
	assert.deepEqual(p.entries.filter((e) => e.who === 'you').map((e) => e.text), ['question 7', 'question 8', 'question 9', 'question 10', 'question 11']);
	assert.ok(p.from > 0);
	const before = await page(file, { before: p.from, turns: 5 });
	assert.equal(before.entries.filter((e) => e.who === 'you')[4].text, 'question 6');
});

test('a line still being written is skipped; a missing transcript is an error for the caller', async () => {
	const file = fixture(2);
	fs.appendFileSync(file, '{"type":"user","message":{"content":"half');
	const p = await page(file);
	assert.equal(p.entries.filter((e) => e.who === 'you').length, 2);
	await assert.rejects(page(path.join(os.tmpdir(), 'blaube-no-such-transcript.jsonl')));
});

test('history shows up to where the live log begins, and what both have shows once', () => {
	const at = (s) => T0 + s * 1000;
	const history = [
		{ who: 'you', text: 'old question', at: at(0), n: -1 },
		{ who: 'claude', text: 'old answer', at: at(5), n: -2 },
		{ who: 'you', text: 'new question', at: at(100), n: -3 },
		{ who: 'step', text: 'Ran npm test · 2 failing', at: at(101), n: -4 },
		{ who: 'step', text: 'Read a.js', at: at(102), n: -5 },
		{ who: 'claude', text: 'Done.', at: at(110), n: -6 },
	];
	// (Blaube started mid-turn: its hooks saw the last step and the reply,
	// each a moment after the transcript did.)
	const log = [
		{ who: 'note', text: 'Picked up', at: at(50), n: 1 },
		{ who: 'step', text: 'Ran npm test · 1 failing', at: at(101.2), n: 2 },
		{ who: 'step', text: 'Read a.js', at: at(102.1), n: 3 },
		{ who: 'claude', text: 'Done.', at: at(110.5), n: 4 },
	];
	assert.deepEqual(shown(history, log).map((e) => e.n), [-1, -2, -3]);
	assert.deepEqual(shown(history, []), history, 'nothing live yet: all of it');
	assert.deepEqual(shown(history, [{ who: 'note', text: 'hi', at: at(1) }]), history, 'notes don’t start the live log');
	// (Something sent from the slime isn't in the transcript: what the hooks saw is where it starts.)
	const sent = [{ who: 'you', text: 'from the slime', via: 'blaube', at: at(1), n: 5 }, { who: 'you', text: 'new question', via: 'terminal', at: at(100.3), n: 6 }];
	assert.deepEqual(shown(history, sent).map((e) => e.n), [-1, -2]);
	// (The same words twice: each live one stands for one.)
	const twice = [{ who: 'step', text: 'Read a.js', at: at(10), n: -7 }, { who: 'step', text: 'Read a.js', at: at(11), n: -8 }];
	assert.deepEqual(shown(twice, [{ who: 'step', text: 'Read a.js', at: at(11.5), n: 7 }]).map((e) => e.n), [-7]);
});
