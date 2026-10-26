const test = require('node:test');
const assert = require('node:assert');
const { claudeEnv, unsetPrefix } = require('../src/main/claudeEnv');

test('a Claude Code Blaube starts gets no API key or token (your Claude login is used)', () => {
	const from = { PATH: '/bin', HOME: '/home/x', ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'https://example.test', ANTHROPIC_MODEL: 'opus' };
	const env = claudeEnv(from);
	assert.ok(!('ANTHROPIC_API_KEY' in env) && !('ANTHROPIC_AUTH_TOKEN' in env));
	assert.strictEqual(env.ANTHROPIC_BASE_URL, 'https://example.test'); // (not a key: kept)
	assert.strictEqual(env.ANTHROPIC_MODEL, 'opus');
	assert.strictEqual(env.PATH, '/bin');
	assert.strictEqual(from.ANTHROPIC_API_KEY, 'sk-test'); // (a copy: Blaube's own is left alone)
});

test('a Claude Code Blaube starts doesn’t think it’s a child of the session Blaube came from', () => {
	const env = claudeEnv({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_USE_BEDROCK: '1' }, { EXTRA: 'y' });
	assert.deepStrictEqual(env, { CLAUDE_CODE_USE_BEDROCK: '1', EXTRA: 'y' });
});

test('the line for a shell Blaube can’t hand an environment to takes the keys out itself', () => {
	assert.strictEqual(unsetPrefix(), 'env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN ');
});

test('the usage probe, owned sessions, sign-in and the agents poll all use it', () => {
	const fs = require('node:fs');
	const path = require('node:path');
	for (const f of ['owned.js', 'usageProbe.js', 'auth.js', 'agents.js', 'installer.js', 'terminal.js']) {
		assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', f), 'utf8'), /claudeEnv\(/, f);
	}
});
