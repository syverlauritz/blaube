const test = require('node:test');
const assert = require('node:assert');
const { words, runningTasks } = require('../src/main/tasks.js');

test('words: takes the last command of a line', () => {
	assert.deepStrictEqual(words('git status; npm run dev'), ['npm', 'run', 'dev']);
	assert.deepStrictEqual(words('cd app && npm start'), ['npm', 'start']);
	assert.deepStrictEqual(words('cat log | grep error'), ['grep', 'error']);
	assert.deepStrictEqual(words('a1 || b2 cc'), ['b2', 'cc']);
	assert.deepStrictEqual(words('echo hi\nnode server.js'), ['node', 'server.js']);
});

test('words: strips quotes', () => {
	assert.deepStrictEqual(words('node -e "serve()"'), ['node', '-e', 'serve()']);
	assert.deepStrictEqual(words("python -m 'http.server'"), ['python', '-m', 'http.server']);
});

test('words: drops redirects and their targets', () => {
	assert.deepStrictEqual(words('npm run dev > out.log'), ['npm', 'run', 'dev']);
	assert.deepStrictEqual(words('npm run dev 2> err.log'), ['npm', 'run', 'dev']);
	assert.deepStrictEqual(words('npm run dev >out.log'), ['npm', 'run', 'dev']);
	assert.deepStrictEqual(words('npm run dev 2>&1'), ['npm', 'run', 'dev']);
	assert.deepStrictEqual(words('npm run dev 2>/dev/null'), ['npm', 'run', 'dev']);
});

test('words: keeps at most 8 words and skips one-letter ones', () => {
	assert.strictEqual(words('cmd aa bb cc dd ee ff gg hh ii jj').length, 8);
	assert.deepStrictEqual(words('node a server.js'), ['node', 'server.js']);
});

test('words: nothing to look for', () => {
	assert.deepStrictEqual(words(''), []);
	assert.deepStrictEqual(words(undefined), []);
	assert.deepStrictEqual(words('ls;'), ['ls']);
});

test('runningTasks: no tasks means an empty set, without looking at processes', () => {
	let got;
	runningTasks([], (alive) => { got = alive; });
	assert.deepStrictEqual([...got], []);
});

test('words: &> and >& redirects are dropped with their targets', () => {
	assert.deepStrictEqual(words('npm run dev &> out.log'), ['npm', 'run', 'dev']);
	assert.deepStrictEqual(words('npm run dev >& out.log'), ['npm', 'run', 'dev']);
	assert.deepStrictEqual(words('npm run dev &>out.log'), ['npm', 'run', 'dev']);
});
