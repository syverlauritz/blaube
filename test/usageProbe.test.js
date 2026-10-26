const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { probe } = require('../src/main/usageProbe');

test('asks a settings-free, unsaved Claude Code for your usage, and closes it', async (t) => {
  if (process.platform === 'win32') return t.skip('a script as the binary');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-probe-'));
  const bin = path.join(dir, 'claude');
  const seen = path.join(dir, 'args.json');
  fs.writeFileSync(bin, `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify(process.argv.slice(2)));
require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.type === 'user') process.stdout.write(JSON.stringify({ type: 'assistant', oops: 'a model call' }) + '\\n');
  if (m.request && m.request.subtype === 'get_usage') process.stdout.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { rate_limits_available: true, rate_limits: { five_hour: { utilization: 9, resets_at: '2026-10-26T15:00:00Z' } } } } }) + '\\n');
});
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const r = await new Promise((done) => probe(bin, done));
  assert.equal(r.rate_limits.five_hour.utilization, 9);
  const args = JSON.parse(fs.readFileSync(seen, 'utf8'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.deepEqual(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2), ['--setting-sources', 'local']);
  assert.equal(await new Promise((done) => probe(path.join(dir, 'missing'), done)), null);
});
