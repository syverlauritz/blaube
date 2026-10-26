// "!git log" in the talk box runs it in the session's folder, as the
// terminal's bash mode does: a login shell (so your PATH counts), at most
// two minutes, the last 200 KB of what it printed.
const { spawn, spawnSync } = require('node:child_process');

const KEEP = 200 << 10;

// cb(code, output): code null when it was stopped (too long).
function run(command, cwd, cb, { timeout = 120e3, platform = process.platform, env = null } = {}) {
  const win = platform === 'win32';
  const shell = process.env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  let proc;
  try {
    proc = win
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${command}"`], Object.assign({ cwd, windowsHide: true, windowsVerbatimArguments: true }, env ? { env: Object.assign({}, process.env, env) } : {}))
      : spawn(shell, ['-lc', command], Object.assign({ cwd, detached: true }, env ? { env: Object.assign({}, process.env, env) } : {}));
  } catch (e) { return cb(1, e.message); }
  let out = '', done = false;
  const keep = (d) => { out += d; if (out.length > KEEP * 2) out = out.slice(-KEEP); };
  proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', keep); proc.stderr.on('data', keep);
  const stop = () => {
    if (win) spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    else try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* gone */ }
  };
  let stopped = false;
  const late = setTimeout(() => { stopped = true; stop(); }, timeout);
  const end = (code) => { if (done) return; done = true; clearTimeout(late); cb(stopped ? null : code, out.length > KEEP ? out.slice(-KEEP) : out); };
  proc.on('error', (e) => { keep(e.message); end(1); });
  proc.on('close', (code) => end(code == null ? 1 : code));
  return { stop };
}

module.exports = { run };
