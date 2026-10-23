const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../src/shared/actions.js');

const bash = (command) => classify('Bash', { command });

test('tools by name', () => {
  assert.equal(classify('Read', { file_path: '/a' }), 'read');
  assert.equal(classify('Grep', { pattern: 'x' }), 'read');
  assert.equal(classify('Edit', {}), 'edit');
  assert.equal(classify('Write', {}), 'edit');
  assert.equal(classify('WebSearch', {}), 'web');
  assert.equal(classify('TodoWrite', {}), 'todo');
  assert.equal(classify('Agent', {}), 'helper');
  assert.equal(classify('mcp__claude_ai_Gmail__send_message', {}), 'app');
  assert.equal(classify('SomethingNew', {}), 'run');
});

test('shell commands by what they do', () => {
  assert.equal(bash('git add -A && git commit -m "x" && git push origin main'), 'push', 'a push wins');
  assert.equal(bash('git commit -m "fix"'), 'commit');
  assert.equal(bash('git pull --rebase'), 'pull');
  assert.equal(bash('npm test 2>&1 | tail'), 'test');
  assert.equal(bash('npm run e2e'), 'test');
  assert.equal(bash('python -m pytest -q'), 'test');
  assert.equal(bash('cargo test'), 'test');
  assert.equal(bash('npm install --save-dev x'), 'install');
  assert.equal(bash('pip install requests'), 'install');
  assert.equal(bash('rm -rf dist && npm run build'), 'delete');
  assert.equal(bash('mkdir -p src/x'), 'folder');
  assert.equal(bash('curl -s https://example.com'), 'web');
  assert.equal(bash('ls -la src'), 'read');
  assert.equal(bash('git status'), 'read');
  assert.equal(bash('npm run build'), 'run');
  assert.equal(bash('echo "rm is fine to mention"'), 'run', 'not fooled by words inside a string');
});
