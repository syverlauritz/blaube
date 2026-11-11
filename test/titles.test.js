const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { firstPrompt, tidy, namer } = require('../src/main/titles');

const line = (o) => JSON.stringify(o) + '\n';
function transcript(lines) {
	const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'titles-')), 's.jsonl');
	fs.writeFileSync(f, lines.map(line).join(''));
	return f;
}
const user = (content, more = {}) => Object.assign({ type: 'user', message: { role: 'user', content } }, more);

test('firstPrompt skips meta lines, commands and tool results', () => {
	const f = transcript([
		{ type: 'summary' },
		user('<command-name>/clear</command-name>'),
		user('a reminder', { isMeta: true }),
		user([{ type: 'tool_result', content: 'x' }]),
		user([{ type: 'text', text: 'the hero video stutters on safari' }]),
		user('later'),
	]);
	assert.strictEqual(firstPrompt(f), 'the hero video stutters on safari');
	assert.strictEqual(firstPrompt(transcript([{ type: 'summary' }])), '');
	assert.strictEqual(firstPrompt('/no/such/file'), '');
});

test('tidy keeps a short title and drops chat', () => {
	assert.strictEqual(tidy('Fix Safari hero video stutter\n'), 'Fix Safari hero video stutter');
	assert.strictEqual(tidy('"Contact form fix."'), 'Contact form fix');
	assert.strictEqual(tidy('**Globe graph UI**'), 'Globe graph UI');
	assert.strictEqual(tidy(''), '');
	assert.strictEqual(tidy('I would be happy to help you come up with a title for this task, here it is'), '');
});

test('namer writes the title once, only for untitled sessions with a prompt', () => {
	const f = transcript([user('make the contact form send emails')]);
	const asked = [];
	const ensure = namer(() => 'claude', (bin, said, cb) => { asked.push(said); cb('Contact form emails'); });
	let named = '';
	ensure({ id: 'a', file: f, title: '' }, (t) => { named = t; });
	ensure({ id: 'a', file: f, title: '' }, () => assert.fail('asked twice'));
	assert.deepStrictEqual(asked, ['make the contact form send emails']);
	assert.strictEqual(named, 'Contact form emails');
	const last = JSON.parse(fs.readFileSync(f, 'utf8').trim().split('\n').pop());
	assert.deepStrictEqual(last, { type: 'ai-title', aiTitle: 'Contact form emails', sessionId: 'a' });

	ensure({ id: 'b', file: f, title: 'Mine' }, () => assert.fail('already named'));
	const empty = transcript([{ type: 'summary' }]);
	ensure({ id: 'c', file: empty, title: '' }, () => assert.fail('nothing said yet'));
	assert.strictEqual(asked.length, 1);
});
