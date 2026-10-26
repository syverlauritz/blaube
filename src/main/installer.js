// Installing Claude Code without a terminal: Blaube runs the official
// installer the setup page tells you to paste into one (its native build,
// into ~/.local/bin), and says how it went. Only when you ask, after a
// dialog that says what it runs.
const { spawn } = require('node:child_process');
const { claudeEnv } = require('./claudeEnv');

const SCRIPT = { unix: 'https://claude.ai/install.sh', windows: 'https://claude.ai/install.ps1' };

// What runs: [program, args, the line the setup page has you paste].
function command(platform = process.platform) {
  if (platform === 'win32') {
    const line = `irm ${SCRIPT.windows} | iex`;
    return ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', line], line];
  }
  const line = `curl -fsSL ${SCRIPT.unix} | bash`;
  return ['/bin/bash', ['-lc', line], line];
}

// cb(ok, its last lines). Gives up after `timeout` (5 minutes).
function install(cb, { platform = process.platform, run = spawn, timeout = 5 * 60e3 } = {}) {
  const [bin, args] = command(platform);
  let p;
  try { p = run(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: claudeEnv() }); } catch (e) { return cb(false, e.message); }
  let out = '', over = false;
  const finish = (ok) => { if (over) return; over = true; clearTimeout(late); cb(ok, out.trim().split('\n').slice(-6).join('\n')); };
  const keep = (d) => { out = (out + d).slice(-8000); };
  p.stdout.on('data', keep);
  p.stderr.on('data', keep);
  const late = setTimeout(() => { keep('\n(it took over five minutes, so it was stopped)'); finish(false); try { p.kill(); } catch { /* gone */ } }, timeout);
  p.on('error', (e) => { keep(e.message); finish(false); });
  p.on('close', (code) => finish(code === 0));
}

module.exports = { command, install };
