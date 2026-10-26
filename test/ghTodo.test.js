const test = require('node:test');
const assert = require('node:assert');
const { parse, look, forget } = require('../src/main/ghTodo');

const item = (o) => Object.assign({ number: 7, title: 'Fix  the\nrounding', url: 'https://github.com/acme/tax/issues/7', repository: { nameWithOwner: 'acme/tax' }, updatedAt: '2026-10-20T10:00:00Z' }, o);

test('issues and review requests are read from gh search, only real GitHub links', () => {
  assert.deepEqual(parse(JSON.stringify([item()]), 'issue'), [{ kind: 'issue', number: 7, title: 'Fix the rounding', url: 'https://github.com/acme/tax/issues/7', repo: 'acme/tax', at: Date.parse('2026-10-20T10:00:00Z') }]);
  assert.equal(parse(JSON.stringify([item({ url: 'https://github.com/acme/tax/pull/9' })]), 'review')[0].number, 9);
  assert.deepEqual(parse(JSON.stringify([item({ url: 'https://evil.com/acme/tax/issues/7' }), item({ url: 'javascript:x' }), item({ url: 'https://github.com/acme/tax/pull/9' })]), 'issue'), [], 'a PR isn’t an issue');
  assert.deepEqual(parse('not json', 'issue'), []);
  assert.deepEqual(parse('{}', 'issue'), []);
});

test('looked up with your gh, reviews first, at most every five minutes', async () => {
  forget();
  const calls = [];
  const run = (bin, args, opts, cb) => {
    calls.push(args.join(' '));
    assert.equal(opts.env.GH_PROMPT_DISABLED, '1');
    const review = args[1] === 'prs';
    setImmediate(() => cb(null, JSON.stringify(review ? [item({ url: 'https://github.com/acme/web/pull/3', title: 'Header' })] : [item(), item({ number: 8, url: 'https://github.com/acme/tax/issues/8', updatedAt: '2026-10-25T10:00:00Z' })])));
  };
  const list = await new Promise((r) => look(r, { run, bin: 'gh', now: 1000 }));
  assert.deepEqual(list.map((x) => `${x.kind} ${x.repo}#${x.number}`), ['review acme/web#3', 'issue acme/tax#8', 'issue acme/tax#7']);
  assert.ok(calls.some((c) => /^search prs --review-requested=@me --state=open/.test(c)) && calls.some((c) => /^search issues --assignee=@me --state=open/.test(c)));
  await new Promise((r) => look(r, { run, bin: 'gh', now: Date.now() + 1000 }));
  assert.equal(calls.length, 2, 'not asked again so soon');
  assert.deepEqual(await new Promise((r) => look(r, { run, bin: '' })), [], 'no gh: nothing');
  forget();
  assert.deepEqual(await new Promise((r) => look(r, { run: (b, a, o, cb) => cb(new Error('not signed in')), bin: 'gh' })), []);
});
