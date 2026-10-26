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

test('what was said before a time, from the transcript', () => {
  const { messagesBefore } = require('../src/main/history.js');
  const h = home();
  const t = (min) => new Date(Date.UTC(2026, 9, 26, 9, min)).toISOString();
  const f = write(h, ID(9), [
    { type: 'user', timestamp: t(0), message: { content: 'first' } },
    { type: 'assistant', timestamp: t(1), message: { content: [{ type: 'text', text: 'working on it' }] } },
    { type: 'assistant', timestamp: t(2), message: { content: [{ type: 'text', text: 'done with first' }] } },
    { type: 'user', timestamp: t(10), message: { content: 'second (Blaube saw this)' } },
  ]);
  const before = Date.parse(t(10));
  assert.deepEqual(messagesBefore(f, before), [
    { who: 'you', text: 'first', at: Date.parse(t(0)) },
    { who: 'claude', text: 'done with first', at: Date.parse(t(2)) },
  ]);
  assert.equal(messagesBefore(f, before, 1).length, 1);
  assert.deepEqual(messagesBefore(path.join(h, 'missing.jsonl'), before), []);
});
