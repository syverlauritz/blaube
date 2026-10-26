const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const auth = require('../src/main/auth');

test('knows Claude Code’s signed-out words', () => {
  for (const t of ['Invalid API key · Please run /login', 'Not logged in · Please run /login', 'OAuth token has expired. Please obtain a new token or refresh your existing token.', 'API Error: 401 {"type":"error","error":{"type":"authentication_error"}}']) assert.ok(auth.signedOut(t), t);
  for (const t of ['5-hour limit reached ∙ resets 3pm', 'API Error: 529 Overloaded', '']) assert.ok(!auth.signedOut(t), t);
});

const fake = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-auth-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env node\nconst a = process.argv.slice(2).join(' ');\n${body}\n`, { mode: 0o755 });
  return bin;
};

test('asks Claude Code whether it’s signed in', async (t) => {
  if (process.platform === 'win32') return t.skip('a script as the binary');
  const ask = (bin) => new Promise((done) => auth.status(bin, done));
  assert.equal(await ask(fake(`if (a === 'auth status --json') console.log(JSON.stringify({ loggedIn: false }));`)), false);
  assert.equal(await ask(fake(`console.log(JSON.stringify({ loggedIn: true }));`)), true);
  assert.equal(await ask(fake(`console.log('what?');`)), null);
  assert.equal(await ask(''), null);
});

test('signs in with claude auth login, passing on the page it names', async (t) => {
  if (process.platform === 'win32') return t.skip('a script as the binary');
  let url = '';
  const ok = await new Promise((done) => auth.login(fake(`if (a !== 'auth login') process.exit(3);\nconsole.log('Opening browser to sign in…\\nIf it didn’t open, visit: https://claude.ai/oauth/authorize?x=1.');\nsetTimeout(() => console.log('Login successful.'), 100);`), (o, why) => done([o, why]), (u) => { url = u; }));
  assert.deepEqual(ok, [true, '']);
  assert.equal(url, 'https://claude.ai/oauth/authorize?x=1');
  const bad = await new Promise((done) => auth.login(fake(`console.error('Login failed: cancelled'); process.exit(1);`), (o, why) => done([o, why])));
  assert.deepEqual(bad, [false, 'Login failed: cancelled']);
  const late = await new Promise((done) => auth.login(fake(`setInterval(() => {}, 1000);`), (o, why) => done([o, why]), () => {}, 300));
  assert.equal(late[0], false);
});
