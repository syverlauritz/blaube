const test = require('node:test');
const assert = require('node:assert');
const { lastEffortIn, normalize, transcriptFor } = require('../src/main/effort.js');

test('reads the newest effort from a transcript', () => {
  const req = (e) => JSON.stringify({ type: 'api-request', params: { output_config: { effort: e } } });
  const text = [req('low'), '{"type":"user","message":"effort is \\"high\\""}', req('max'), '{"type":"assistant"}', '{"type":"api-req'].join('\n');
  assert.equal(lastEffortIn(text), 'xhigh');
  assert.equal(lastEffortIn('{"type":"user"}'), '');
});

test('normalizes effort names', () => {
  assert.equal(normalize('High'), 'high');
  assert.equal(normalize('max'), 'xhigh');
  assert.equal(normalize('banana'), '');
});

test('finds the transcript from the session and folder', () => {
  assert.equal(transcriptFor('abc', '/Users/me/Git/blaube', '/h'), '/h/.claude/projects/-Users-me-Git-blaube/abc.jsonl');
});
