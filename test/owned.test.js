const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Owned } = require('../src/main/owned.js');

// A stand-in for Claude Code's stream-json mode: answers control requests,
// and a message with a result unless it's interrupted first.
const FAKE = `#!/usr/bin/env node
let model = 'claude-opus';
let turn = null;
require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l);
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  if (m.type === 'control_request') {
    const r = m.request;
    if (r.subtype === 'set_model') { if (r.model === 'nope') return out({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'unknown model' } }); model = 'claude-' + r.model; return out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { model } } }); }
    if (r.subtype === 'interrupt') { clearTimeout(turn); out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } }); return out({ type: 'result', subtype: 'error_during_execution', is_error: true }); }
    return;
  }
  if (m.type === 'user') turn = setTimeout(() => out({ type: 'result', subtype: 'success', result: model + ' says hi' }), m.message.content === 'slow' ? 5000 : 10);
});
`;

test('a session Blaube started switches model and stops at once, through Claude Code itself', async (t) => {
  if (process.platform === 'win32') return t.skip('a script as the binary');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-owned-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, FAKE, { mode: 0o755 });
  const owned = new Owned(() => bin);
  const id = owned.start(dir);
  const ask = (req) => new Promise((r) => owned.control(id, req, (ok, a) => r({ ok, a })));
  assert.deepEqual(await ask({ subtype: 'set_model', model: 'sonnet' }), { ok: true, a: { model: 'claude-sonnet' } });
  assert.deepEqual(await ask({ subtype: 'set_model', model: 'nope' }), { ok: false, a: 'unknown model' });
  const result = () => new Promise((r) => owned.once('result', (_id, res) => r(res)));
  let next = result();
  owned.send(id, 'hi');
  assert.equal((await next).text, 'claude-sonnet says hi');
  assert.equal((await next).interrupted, false);
  next = result();
  owned.send(id, 'slow');
  await ask({ subtype: 'interrupt' });
  const got = await next;
  assert.equal(got.interrupted, true, 'its result says it was stopped, not that something went wrong');
  assert.equal(owned.control('nobody', { subtype: 'interrupt' }), false);
  const gone = new Promise((r) => owned.once('exit', r));
  owned.end(id);
  await gone;
});

test('/model and /plan are asked of Claude Code; anything else is a message', () => {
  const { control } = require('../src/main/commands.js');
  assert.deepEqual(control('/model sonnet'), { request: { subtype: 'set_model', model: 'sonnet' } });
  assert.deepEqual(control('/plan'), { request: { subtype: 'set_permission_mode', mode: 'plan' } });
  assert.match(control('/model').help, /opus/);
  assert.equal(control('/model is broken in prod'), null);
  assert.equal(control('hello'), null);
});
