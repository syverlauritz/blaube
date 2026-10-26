const test = require('node:test');
const assert = require('node:assert');
const { names } = require('../src/shared/names.js');

test('a single session is just its repo, whatever its chat is called', () => {
	const m = names([{ id: 'a', project: 'blaube', title: 'Fix the login bug' }]);
	assert.deepEqual(m.get('a'), { name: 'blaube', sub: '', full: 'blaube' });
});

test('sessions from different repos keep to their repo names', () => {
	const m = names([{ id: 'a', project: 'blaube', title: 'One' }, { id: 'b', project: 'kalkis', title: 'Two' }]);
	assert.equal(m.get('a').full, 'blaube');
	assert.equal(m.get('b').full, 'kalkis');
});

test('two sessions in one repo get their chat names, repo first', () => {
	const m = names([{ id: 'a', project: 'blaube', title: 'Fix the login bug' }, { id: 'b', project: 'blaube', title: 'Add brackets' }, { id: 'c', project: 'kalkis', title: 'Other' }]);
	assert.deepEqual(m.get('a'), { name: 'blaube', sub: 'Fix the login bug', full: 'blaube · Fix the login bug' });
	assert.equal(m.get('b').full, 'blaube · Add brackets');
	assert.equal(m.get('c').full, 'kalkis');
});

test('a session with no chat name yet stays the repo name, even beside a twin', () => {
	const m = names([{ id: 'a', project: 'blaube', title: '' }, { id: 'b', project: 'blaube', title: 'Add brackets' }]);
	assert.equal(m.get('a').full, 'blaube');
	assert.equal(m.get('b').full, 'blaube · Add brackets');
});

test('titles are only looked up where repos clash', () => {
	const asked = [];
	names([{ id: 'a', project: 'x' }, { id: 'b', project: 'y' }, { id: 'c', project: 'y' }], (s) => { asked.push(s.id); return 't'; });
	assert.deepEqual(asked, ['b', 'c']);
});
