const test = require('node:test');
const assert = require('node:assert');
const { toMarkdown, fileName } = require('../src/main/markdown.js');

const at = new Date(2026, 9, 26, 9, 5).getTime();

test('a conversation becomes Markdown: you quoted, Claude as written, steps as a list', () => {
  const md = toMarkdown({
    project: 'kalkis',
    cwd: '/Users/s/kalkis',
    log: [
      { who: 'you', text: 'add the 2027 brackets\nand tests', at },
      { who: 'step', text: 'Read tax.js', at },
      { who: 'step', text: 'Ran npm test', ok: false, at },
      { who: 'claude', text: 'Done! The **brackets** are in.', at: at + 4 * 60e3, turn: { took: 4 * 60e3, steps: 2, files: ['/Users/s/kalkis/src/tax.js'] } },
      { who: 'note', text: 'You asked it to stop', at },
      { who: 'you', text: 'also 2028', status: 'unsent', at },
    ],
  }, at);
  assert.equal(md, [
    '# kalkis',
    '',
    '_/Users/s/kalkis · 2026-10-26 09:05 · from Blaube_',
    '',
    '**You** · 09:05',
    '',
    '> add the 2027 brackets',
    '> and tests',
    '',
    '- Read tax.js',
    '- ✗ Ran npm test',
    '',
    '**Claude** · 09:09',
    '',
    'Done! The **brackets** are in.',
    '',
    '_4m · 2 steps · changed `tax.js`_',
    '',
    '_You asked it to stop_',
    '',
    '**You** · 09:05 (not sent)',
    '',
    '> also 2028',
    '',
  ].join('\n'));
});

test('an empty conversation is just its header; a safe file name', () => {
  assert.equal(toMarkdown({ project: 'x', log: [] }, at), '# x\n\n_2026-10-26 09:05 · from Blaube_\n');
  assert.equal(fileName('a/b: c', at), 'a-b- c 2026-10-26.md');
  assert.equal(fileName('', at), 'conversation 2026-10-26.md');
});
