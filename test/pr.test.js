const test = require('node:test');
const assert = require('node:assert');
const { parse, words, news, look, known } = require('../src/main/pr');

const view = (o = {}) => JSON.stringify(Object.assign({ number: 12, url: 'https://github.com/o/r/pull/12', state: 'OPEN', isDraft: false, title: 'Tax', reviewDecision: '', statusCheckRollup: [] }, o));
const run = (status, conclusion) => ({ __typename: 'CheckRun', status, conclusion });

test('a pull request is read from gh, its checks counted', () => {
  const pr = parse(view({ statusCheckRollup: [run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'FAILURE'), run('IN_PROGRESS', ''), { __typename: 'StatusContext', state: 'PENDING' }, { __typename: 'StatusContext', state: 'SUCCESS' }, run('COMPLETED', 'SKIPPED')] }));
  assert.deepEqual(pr.checks, { pass: 3, fail: 1, pending: 2 });
  assert.equal(pr.number, 12);
  assert.equal(parse('no pull requests found'), null);
  assert.equal(parse(view({ url: 'javascript:alert(1)' })), null, 'only a web address');
  assert.equal(parse('{"number":"12"}'), null);
});

test('it says how a pull request stands in a few words', () => {
  const at = (o) => words(parse(view(o)));
  assert.equal(at({}), 'PR #12');
  assert.equal(at({ statusCheckRollup: [run('COMPLETED', 'SUCCESS')] }), 'PR #12 · checks pass');
  assert.equal(at({ statusCheckRollup: [run('COMPLETED', 'FAILURE'), run('COMPLETED', 'TIMED_OUT')] }), 'PR #12 · 2 checks failing');
  assert.equal(at({ statusCheckRollup: [run('QUEUED', null)] }), 'PR #12 · checks running');
  assert.equal(at({ reviewDecision: 'CHANGES_REQUESTED' }), 'PR #12 · changes requested');
  assert.equal(at({ reviewDecision: 'APPROVED', statusCheckRollup: [run('COMPLETED', 'SUCCESS')] }), 'PR #12 · approved, checks pass');
  assert.equal(at({ isDraft: true }), 'PR #12 (draft)');
  assert.equal(at({ state: 'MERGED' }), 'PR #12 merged');
  assert.equal(words(null), '');
});

test('what changed is worth saying only when it is news', () => {
  const p = (o) => parse(view(o));
  const running = p({ statusCheckRollup: [run('IN_PROGRESS', '')] });
  assert.equal(news(running, p({ statusCheckRollup: [run('COMPLETED', 'SUCCESS')] })), 'PR #12: checks passed');
  assert.equal(news(running, p({ statusCheckRollup: [run('COMPLETED', 'FAILURE')] })), 'PR #12: 1 check failed');
  assert.equal(news(p({}), p({ state: 'MERGED' })), 'PR #12 is merged');
  assert.equal(news(p({}), p({ reviewDecision: 'APPROVED' })), 'PR #12 is approved');
  assert.equal(news(p({}), p({})), '');
  assert.equal(news(null, p({})), '', 'first look: nothing to compare');
});

test('gh is asked once a minute per branch, never on main, and never prompts', async () => {
  let calls = 0, seen = null;
  const fake = (bin, args, opts, cb) => { calls++; seen = { bin, args, opts }; setImmediate(() => cb(null, view())); };
  const ask = (branch, o = {}) => new Promise((r) => look('/w', branch, r, Object.assign({ run: fake, bin: '/x/gh' }, o)));
  assert.equal(await ask('main'), null);
  assert.equal(calls, 0);
  const [a, b] = await Promise.all([ask('topic'), ask('topic')]);
  assert.equal(calls, 1, 'two asking at once: one gh');
  assert.equal(a.number, 12); assert.equal(b, a);
  assert.deepEqual(seen.args.slice(0, 3), ['pr', 'view', '--json']);
  assert.equal(seen.opts.cwd, '/w');
  assert.equal(seen.opts.env.GH_PROMPT_DISABLED, '1');
  await ask('topic');
  assert.equal(calls, 1, 'cached');
  await ask('topic', { now: Date.now() + 61e3 });
  assert.equal(calls, 2);
  assert.equal(known('/w', 'topic').number, 12);
  const none = await new Promise((r) => look('/w', 'other', r, { run: (b, a, o, cb) => cb(new Error('no pull requests found')), bin: 'gh' }));
  assert.equal(none, null);
});
