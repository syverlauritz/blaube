const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const taskKill = require('../src/main/taskKill');

test('reads who is whose parent', () => {
  const map = taskKill.parents('  10     1\n  20    10\n 30 20\nnoise\n');
  assert.ok(taskKill.under(map, 30, 10));
  assert.ok(!taskKill.under(map, 10, 30));
  assert.ok(!taskKill.under(map, 99, 10));
});

test('stops what writes to a task’s output file, only under its session’s process', async (t) => {
  try { execFileSync('lsof', ['-v'], { stdio: 'ignore' }); } catch (e) { if (e.code === 'ENOENT') return t.skip('no lsof'); }
  if (process.platform === 'win32') return t.skip('no lsof');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-kill-')), 'bash_1.output');
  const fd = fs.openSync(file, 'w');
  // (A session's claude process, and the task it runs.)
  const session = spawn('sh', ['-c', 'sleep 30 & wait'], { stdio: ['ignore', fd, 'ignore'] });
  fs.closeSync(fd);
  await new Promise((r) => setTimeout(r, 300));
  const notMine = await new Promise((r) => taskKill.stop(file, 999999, r));
  assert.equal(notMine, 0, 'not under that process: left alone');
  const killed = [];
  const n = await new Promise((r) => taskKill.stop(file, process.pid, r, { kill: (p, sig) => { killed.push(p); process.kill(p, sig); } }));
  assert.ok(n >= 1, 'stopped');
  assert.ok(!killed.includes(process.pid));
  await new Promise((r) => { session.on('exit', r); setTimeout(r, 2000); });
  assert.ok(session.exitCode !== null || session.signalCode !== null, 'and it ended');
});
