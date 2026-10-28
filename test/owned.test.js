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

test('a fork starts from a copy of a session’s conversation under a new id; sends carry their id', async (t) => {
  if (process.platform === 'win32') return t.skip('a script as the binary');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-owned-'));
  const bin = path.join(dir, 'claude');
  // Says what it was started with, and echoes each message it gets.
  fs.writeFileSync(bin, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'args', args: process.argv.slice(2), checkpoints: process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING }) + '\\n');
require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => process.stdout.write(JSON.stringify({ type: 'echo', got: JSON.parse(l) }) + '\\n'));
`, { mode: 0o755 });
  const owned = new Owned(() => bin);
  const seen = [];
  const orig = owned.read.bind(owned);
  owned.read = (id, m) => { seen.push(m); return orig(id, m); };
  const id = owned.start(dir, [], null, '', 'orig-1234');
  assert.notEqual(id, 'orig-1234');
  owned.send(id, 'try it the other way', 'u-1');
  const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); return fn(); };
  assert.ok(await until(() => seen.some((m) => m.type === 'echo')));
  const args = seen.find((m) => m.type === 'args');
  assert.deepEqual(args.args.slice(args.args.indexOf('--resume'), args.args.indexOf('--resume') + 4), ['--resume', 'orig-1234', '--fork-session', '--session-id']);
  assert.equal(args.args[args.args.indexOf('--session-id') + 1], id);
  assert.equal(args.checkpoints, '1', 'checkpoints on, so a turn can be put back');
  assert.equal(seen.find((m) => m.type === 'echo').got.uuid, 'u-1');
  owned.end(id);
});

test('/clear: a fresh session takes its place, and the old one ends quietly', async (t) => {
  if (process.platform === 'win32') return t.skip('a script as the binary');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-owned-'));
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-tree-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'args', args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ type: 'result', result: 'late' }) + '\\n'); process.exit(0); }); process.stdin.resume();
`, { mode: 0o755 });
  const owned = new Owned(() => bin);
  const seen = [], events = [];
  const orig = owned.read.bind(owned);
  owned.read = (id, m) => { seen.push(Object.assign({ id }, m)); return orig(id, m); };
  owned.on('renamed', (a, b) => events.push(['renamed', a, b]));
  owned.on('exit', (a) => events.push(['exit', a]));
  owned.on('result', (a) => events.push(['result', a]));
  const id = owned.start(dir, ['--worktree', '--model', 'opus'], { a: 1 });
  const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); return fn(); };
  assert.ok(await until(() => seen.some((m) => m.type === 'args')));
  const to = owned.clear(id, tree);
  assert.ok(to && to !== id);
  assert.deepEqual(events[0], ['renamed', id, to]);
  assert.ok(owned.has(to) && !owned.has(id));
  assert.ok(await until(() => seen.some((m) => m.type === 'args' && m.id === to)));
  const args = seen.find((m) => m.type === 'args' && m.id === to);
  assert.equal(fs.realpathSync(args.cwd), fs.realpathSync(tree), 'starts where it was working (its worktree)');
  assert.ok(!args.args.includes('--worktree') && args.args.includes('opus') && args.args.includes('--settings'));
  assert.equal(args.args[args.args.indexOf('--session-id') + 1], to);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!events.some((e) => e[0] === 'exit' || e[0] === 'result'), 'the old one ends without saying so, or anything else');
  assert.equal(owned.clear('nope'), null);
  owned.end(to);
});

test('reopen: the same conversation again, with more arguments, once the old one has closed', async (t) => {
  if (process.platform === 'win32') return t.skip('a script as the binary');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-owned-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'args', args: process.argv.slice(2) }) + '\\n');
process.stdin.on('end', () => setTimeout(() => process.exit(0), 150)); process.stdin.resume();
`, { mode: 0o755 });
  const owned = new Owned(() => bin);
  const seen = [], exits = [];
  const orig = owned.read.bind(owned);
  owned.read = (id, m) => { seen.push(m); return orig(id, m); };
  owned.on('exit', (a) => exits.push(a));
  const id = owned.start(dir, ['--model', 'opus']);
  const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); return fn(); };
  assert.ok(await until(() => seen.length === 1));
  const ok = await new Promise((done) => owned.reopen(id, ['--add-dir', '/tmp/other'], '', done));
  assert.ok(ok && owned.has(id));
  assert.ok(await until(() => seen.length === 2));
  const args = seen[1].args;
  assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', id]);
  assert.ok(args.includes('opus') && args.join(' ').endsWith('--add-dir /tmp/other'));
  assert.deepEqual(exits, [], 'no end said');
  owned.end(id);
  assert.equal(await new Promise((done) => owned.reopen('nope', [], '', done)), false);
});

test('going back: a copy cut at an entry takes its place, the cut not kept for later restarts', async (t) => {
  if (process.platform === 'win32') return t.skip('a script as the binary');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-owned-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'args', args: process.argv.slice(2) }) + '\\n');
process.stdin.on('end', () => process.exit(0)); process.stdin.resume();
`, { mode: 0o755 });
  const owned = new Owned(() => bin);
  const seen = [];
  const orig = owned.read.bind(owned);
  owned.read = (id, m) => { seen.push(Object.assign({ id }, m)); return orig(id, m); };
  const id = owned.start(dir, ['--model', 'opus']);
  const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); return fn(); };
  assert.ok(await until(() => seen.length === 1));
  const to = owned.clear(id, '', 'a1');
  assert.ok(await until(() => seen.some((m) => m.id === to)));
  const args = seen.find((m) => m.id === to).args;
  assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 4), ['--resume', id, '--fork-session', '--session-id']);
  assert.deepEqual(args.slice(-2), ['--resume-session-at', 'a1']);
  await new Promise((done) => owned.reopen(to, ['--add-dir', '/tmp'], '', done));
  assert.ok(await until(() => seen.filter((m) => m.id === to).length === 2));
  assert.ok(!seen.filter((m) => m.id === to)[1].args.includes('--resume-session-at'), 'a later restart keeps the whole (new) conversation');
  owned.end(to);
});

test('Claude Code trying again, falling back to another model, or remembering something, is passed on', async (t) => {
  if (process.platform === 'win32') return t.skip('a script as the binary');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-owned-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 4000, error_status: 529, error: 'overloaded' });
out({ type: 'system', subtype: 'model_fallback', content: 'Opus is overloaded, so this turn uses Sonnet.', originalModel: 'claude-opus', fallbackModel: 'claude-sonnet' });
out({ type: 'system', subtype: 'memory_saved', writtenPaths: ['/home/me/.claude/memory/pnpm.md'] });
process.stdin.on('end', () => process.exit(0)); process.stdin.resume();
`, { mode: 0o755 });
  const owned = new Owned(() => bin);
  const got = [];
  owned.on('retry', (id, r) => got.push(['retry', r]));
  owned.on('fallback', (id, f) => got.push(['fallback', f]));
  owned.on('remembered', (id, files) => got.push(['remembered', files]));
  const id = owned.start(dir);
  for (let i = 0; i < 100 && got.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, [['retry', { attempt: 2, max: 10, delay: 4000, status: 529, error: 'overloaded' }], ['fallback', { text: 'Opus is overloaded, so this turn uses Sonnet.', from: 'claude-opus', to: 'claude-sonnet' }], ['remembered', ['/home/me/.claude/memory/pnpm.md']]]);
  owned.end(id);
});

test('a session is busy from a message until its turn’s result, and again when it speaks up by itself', () => {
  const owned = new Owned(() => 'claude');
  owned.sessions.set('s', { id: 's', proc: { stdin: { writable: true, write() {} } }, pending: new Map() });
  assert.equal(owned.busy('s'), false);
  owned.send('s', 'go');
  assert.equal(owned.busy('s'), true);
  owned.read('s', { type: 'result', subtype: 'success', result: 'ok' });
  assert.equal(owned.busy('s'), false);
  owned.read('s', { type: 'assistant', message: { content: [] } }); // (a helper came back: it carries on)
  assert.equal(owned.busy('s'), true);
  assert.equal(owned.busy('nobody'), false);
});

test('what Claude writes as it works is said as it comes, not its helpers’ words or Claude Code’s', () => {
  const owned = new Owned(() => 'claude');
  owned.sessions.set('s', { id: 's', proc: { stdin: { writable: true, write() {} } }, pending: new Map() });
  const got = [];
  owned.on('said', (id, text, mid) => got.push([id, text, mid]));
  owned.read('s', { type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Now the tests.' }] } });
  owned.read('s', { type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } });
  owned.read('s', { type: 'assistant', parent_tool_use_id: 'toolu_1', message: { id: 'h', content: [{ type: 'text', text: 'helper talk' }] } });
  owned.read('s', { type: 'assistant', message: { id: 'x', model: '<synthetic>', content: [{ type: 'text', text: 'No messages to compact' }] } });
  assert.deepEqual(got, [['s', 'Now the tests.', 'm1']]);
});
