const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const accounts = require('../src/main/accounts.js');
const history = require('../src/main/history.js');

function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-acct-'));
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(path.join(h, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'work@example.com' } }));
  fs.mkdirSync(path.join(h, '.claude-personal'));
  fs.writeFileSync(path.join(h, '.claude-personal', '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com' } }));
  fs.mkdirSync(path.join(h, '.claude-empty')); // (never used by Claude Code)
  fs.writeFileSync(path.join(h, '.claude-notes'), 'a file, not a folder');
  return h;
}

test('finds each Claude Code account folder, with who it was signed in as', () => {
  const h = home();
  assert.deepStrictEqual(accounts.list(h), [
    { dir: '', name: 'default', email: 'work@example.com' },
    { dir: path.join(h, '.claude-personal'), name: 'personal', email: 'me@example.com' },
  ]);
  assert.equal(accounts.label(accounts.list(h)[1]), 'personal · me@example.com');
  assert.equal(accounts.label({ dir: '', email: '' }), 'Default (~/.claude)');
});

test('each account runs, connects and is found in its own folder', () => {
  const h = home(), p = path.join(h, '.claude-personal');
  assert.deepStrictEqual(accounts.envFor(''), {});
  assert.deepStrictEqual(accounts.envFor(p), { CLAUDE_CONFIG_DIR: p });
  assert.equal(accounts.settingsOf('', h), path.join(h, '.claude', 'settings.json'));
  assert.equal(accounts.settingsOf(p, h), path.join(p, 'settings.json'));
  assert.equal(accounts.dirOfTranscript(path.join(p, 'projects', '-x', 'a.jsonl'), h), p);
  assert.equal(accounts.dirOfTranscript(path.join(h, '.claude', 'projects', '-x', 'a.jsonl'), h), '');
  assert.equal(accounts.dirOfTranscript('', h), '');
  assert.equal(accounts.dirOfTranscript('/elsewhere/projects/-x/a.jsonl', h), '');
});

test('past sessions come from every account', () => {
  const h = home();
  const id1 = '11111111-1111-1111-1111-111111111111', id2 = '22222222-2222-2222-2222-222222222222';
  const line = (cwd, text) => JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: text } }) + '\n';
  for (const [root, id, text] of [[path.join(h, '.claude'), id1, 'work thing'], [path.join(h, '.claude-personal'), id2, 'personal thing']]) {
    fs.mkdirSync(path.join(root, 'projects', '-p'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', '-p', `${id}.jsonl`), line(h, text));
  }
  const ids = history.pastSessions(new Set(), 8, h).map((s) => s.id).sort();
  assert.deepStrictEqual(ids, [id1, id2]);
});
