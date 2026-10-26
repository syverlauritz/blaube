// Polls `claude agents --json`, which lists the Claude Code sessions running
// on this machine with a busy/idle status. Local only: no API calls.
const { execFile } = require('node:child_process');
const { claudeEnv } = require('./claudeEnv');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const INTERVAL_MS = 5000;

// Apps launched from Finder don't get your shell's PATH, so look in the
// places the Claude Code installers put the binary before asking a shell.
function findClaude() {
  const home = os.homedir();
  const candidates = process.platform === 'win32'
    ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')]
    : [path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

function run(cb) {
  const opts = { timeout: 8000, maxBuffer: 1 << 20, windowsHide: true, cwd: os.homedir(), env: claudeEnv() };
  const bin = findClaude();
  if (bin && !bin.endsWith('.cmd')) return execFile(bin, ['agents', '--json'], opts, cb);
  if (process.platform === 'win32') return execFile('cmd.exe', ['/d', '/s', '/c', 'claude agents --json'], opts, cb);
  // Interactive login shell, so PATH set in .zshrc/.bashrc counts too.
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  execFile(shell, ['-ilc', 'claude agents --json'], opts, cb);
}

function parse(stdout) {
  const start = stdout.indexOf('[');
  if (start < 0) return null;
  try {
    const list = JSON.parse(stdout.slice(start));
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

// Calls onAgents(list) every few seconds while enabled() is true. After a
// few failures in a row (e.g. Claude Code isn't installed, or is updating)
// it only tries once a minute, but never stops for good: it's how sessions
// with older hooks get their process id, which a click needs.
const SLOW_MS = 60 * 1000;
function startAgentsPoller(onAgents, enabled) {
  let failures = 0, busy = false, lastTry = 0;
  const tick = () => {
    if (busy || !enabled()) return;
    if (failures >= 3 && Date.now() - lastTry < SLOW_MS) return;
    busy = true;
    lastTry = Date.now();
    run((err, stdout) => {
      busy = false;
      const list = err ? null : parse(String(stdout));
      if (!list) { failures++; return; }
      failures = 0;
      onAgents(list);
    });
  };
  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  return { stop: () => clearInterval(timer), retry: () => { failures = 0; tick(); } };
}

// One-off: calls cb(list) or cb(null).
function listAgents(cb) {
  run((err, stdout) => cb(err ? null : parse(String(stdout))));
}

module.exports = { startAgentsPoller, listAgents, parse, findClaude };
