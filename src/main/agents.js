// Polls `claude agents --json`, which lists the Claude Code sessions running
// on this machine with a busy/idle status. Local only: no API calls.
const { execFile } = require('node:child_process');
const os = require('node:os');

const INTERVAL_MS = 5000;

function run(cb) {
  const opts = { timeout: 8000, maxBuffer: 1 << 20, windowsHide: true };
  if (process.platform === 'win32') {
    execFile('cmd.exe', ['/d', '/s', '/c', 'claude agents --json'], opts, cb);
  } else {
    // Apps launched from Finder don't get your shell's PATH, so ask a login shell.
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    execFile(shell, ['-lc', 'claude agents --json'], { ...opts, cwd: os.homedir() }, cb);
  }
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

// Calls onAgents(list) every few seconds while enabled() is true. Gives up
// quietly after a few failures in a row (e.g. Claude Code isn't installed).
function startAgentsPoller(onAgents, enabled) {
  let failures = 0, busy = false;
  const tick = () => {
    if (busy || !enabled() || failures >= 3) return;
    busy = true;
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

module.exports = { startAgentsPoller, parse };
