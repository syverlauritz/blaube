const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pastSessions, recentMessages, ago } = require('../src/main/history.js');

const ID = (n) => `0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;
function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-history-'));
  fs.mkdirSync(path.join(h, '.claude', 'projects', '-work-app'), { recursive: true });
  return h;
}
const write = (h, id, entries, at) => {
  const f = path.join(h, '.claude', 'projects', '-work-app', id + '.jsonl');
  fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  if (at) fs.utimesSync(f, at / 1000, at / 1000);
  return f;
};
const user = (text) => ({ type: 'user', cwd: '/work/app', message: { role: 'user', content: text } });
const claude = (text) => ({ type: 'assistant', cwd: '/work/app', message: { role: 'assistant', content: [{ type: 'text', text }] } });

test('past sessions: newest first, titled, live ones and empty ones left out', () => {
  const h = home();
  write(h, ID(1), [user('fix the login bug'), claude('Fixed.')], Date.now() - 3600e3);
  write(h, ID(2), [user('first'), { type: 'summary', aiTitle: 'Speed up the build' }, claude('Done')], Date.now() - 60e3);
  write(h, ID(3), [user('running now')], Date.now());
  write(h, ID(4), [{ type: 'system', cwd: '/work/app' }], Date.now());
  const list = pastSessions(new Set([ID(3)]), 8, h);
  assert.deepEqual(list.map((s) => [s.id, s.title, s.cwd]), [[ID(2), 'Speed up the build', '/work/app'], [ID(1), 'fix the login bug', '/work/app']]);
});

test('how a session ended: what you said and Claude’s answers, not tool chatter', () => {
  const h = home();
  const f = write(h, ID(1), [
    user('make it faster'),
    claude('Let me look.'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'file' }] } },
    claude('It’s 2× faster now.'),
    user('<command-name>/compact</command-name>'),
    { type: 'user', isMeta: true, message: { content: 'reminder' } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'helper talk' }] } },
    user('thanks'),
  ]);
  assert.deepEqual(recentMessages(f), [
    { who: 'you', text: 'make it faster' }, { who: 'claude', text: 'It’s 2× faster now.' }, { who: 'you', text: 'thanks' },
  ]);
  assert.equal(recentMessages(f, 1).length, 1);
});

test('ago', () => {
  const now = 1e12;
  assert.equal(ago(now - 5 * 60e3, now), '5 min ago');
  assert.equal(ago(now - 3 * 3600e3, now), '3 h ago');
  assert.equal(ago(now - 30 * 3600e3, now), 'yesterday');
});

test('past sessions can be searched for what was said in them', async () => {
  const { searchPast } = require('../src/main/history.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-past-'));
  const dir = path.join(home, '.claude', 'projects', '-x');
  fs.mkdirSync(dir, { recursive: true });
  const write = (id, msgs) => fs.writeFileSync(path.join(dir, id + '.jsonl'), msgs.map((m) => JSON.stringify(m)).join('\n') + '\n');
  const A = 'aaaaaaaa-0000-0000-0000-000000000000', B = 'bbbbbbbb-0000-0000-0000-000000000000';
  write(A, [{ type: 'user', cwd: '/p/tax', message: { content: 'fix the VAT rounding' } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'VAT now rounds half up.' }] } }]);
  write(B, [{ type: 'user', cwd: '/p/web', message: { content: 'make the button blue' } }, { type: 'user', message: { content: [{ type: 'tool_result', content: 'vat' }] } }]);
  const got = await searchPast('vat', new Set(), { home });
  assert.equal(got.length, 1, 'tool output doesn’t count');
  assert.equal(got[0].id, A);
  assert.equal(got[0].hits, 2);
  assert.equal(got[0].cwd, '/p/tax');
  assert.match(got[0].snippet, /VAT now rounds/);
  assert.deepEqual(await searchPast('vat', new Set([A]), { home }), [], 'not ones running now');
  assert.deepEqual(await searchPast('v', new Set(), { home }), []);
});

test('what you said keeps its id, to go back to before it', () => {
  const h = home();
  const f = write(h, ID(3), [Object.assign(user('make it faster'), { uuid: 'u-1' }), claude('Done.')]);
  assert.deepEqual(recentMessages(f), [{ who: 'you', text: 'make it faster', uuid: 'u-1' }, { who: 'claude', text: 'Done.' }]);
});
