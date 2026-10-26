const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { slashCommand } = require('../src/main/commands.js');

test('slash commands, and messages that only start with a slash', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-cmd-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-proj-'));
  fs.mkdirSync(path.join(home, '.claude', 'commands', 'git'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'commands', 'git', 'ship.md'), 'x');
  fs.mkdirSync(path.join(proj, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'commands', 'deploy.md'), 'x');
  const is = (t) => slashCommand(t, proj, home);
  assert.equal(is('/compact'), '/compact');
  assert.equal(is('  /model opus'), '/model');
  assert.equal(is('/deploy staging'), '/deploy');
  assert.equal(is('/git:ship'), '/git:ship');
  assert.equal(is('/my-plugin:do-thing now'), '/my-plugin:do-thing');
  assert.equal(is('/api returns 500 now, can you fix it'), '');
  assert.equal(is('/tmp is full'), '');
  assert.equal(is('/usr/local/bin is missing'), '');
  assert.equal(is('hello /compact'), '');
});

test('your own commands go as the prompt they stand for; "/" lists them first', () => {
  const { expand, commandNames } = require('../src/main/commands.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-cmd-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-proj-'));
  const dir = path.join(home, '.claude', 'commands');
  fs.mkdirSync(path.join(dir, 'git'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'git', 'ship.md'), '---\ndescription: "Ship a branch"\n---\nShip $1 to $2. ($ARGUMENTS)\n');
  fs.writeFileSync(path.join(dir, 'tidy.md'), 'Tidy the diff.');
  fs.writeFileSync(path.join(dir, 'st.md'), 'Status: !`git status`');
  fs.mkdirSync(path.join(proj, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'commands', 'tidy.md'), 'Tidy it the project way.');
  assert.equal(expand('/git:ship web prod', proj, home), 'Ship web to prod. (web prod)');
  assert.equal(expand('/tidy', proj, home), 'Tidy it the project way.', 'the project’s wins');
  assert.equal(expand('/tidy  carefully', '', home), 'Tidy the diff.\n\ncarefully', 'words with nowhere to go are added');
  assert.equal(expand('/st', '', home), '', 'shell commands need Claude Code');
  assert.equal(expand('/compact', '', home), '');
  fs.writeFileSync(path.join(dir, 'review.md'), 'Mine.');
  assert.equal(expand('/review', '', home), '', 'a built-in stays Claude Code’s');
  assert.equal(expand('/api is down', '', home), '');
  const names = commandNames('', proj, home);
  assert.deepEqual(names.slice(0, 4).map((c) => c.name), ['git:ship', 'ship', 'st', 'tidy']);
  assert.equal(names[0].about, 'Ship a branch');
  assert.ok(names.some((c) => c.name === 'compact' && !c.mine));
  assert.deepEqual(commandNames('co', proj, home).map((c) => c.name), ['compact', 'config', 'context', 'cost']);
});

test('/context is asked of Claude Code, and its answer drawn as what fills it', () => {
  const { control, contextNote } = require('../src/main/commands');
  assert.deepEqual(control('/context'), { request: { subtype: 'get_context_usage', detail: 'summary' } });
  const n = contextNote({
    categories: [
      { id: 'system_prompt', name: 'System prompt', tokens: 3803, kind: 'used' },
      { id: 'system_tools', name: 'System tools', tokens: 29244, kind: 'used' },
      { id: 'system_tools_deferred', name: 'System tools (deferred)', tokens: 34354, kind: 'deferred' },
      { id: 'messages', name: 'Messages', tokens: 61000, kind: 'used' },
      { id: 'autocompact_buffer', name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
      { id: 'free_space', name: 'Free space', tokens: 372953, kind: 'free' },
    ],
    totalTokens: 94047, maxTokens: 500000, percentage: 19, gridRows: [[]],
  });
  assert.equal(n.text, 'Context: 19% full (94k of 500k)');
  assert.deepEqual(n.context.parts.map((p) => p.label), ['Messages 61k', 'System tools 29.2k', 'System prompt 3.8k', 'Autocompact buffer 33k', 'Free space 373k']);
  assert.equal(n.context.max, 500000);
  assert.equal(contextNote(null), null);
});
