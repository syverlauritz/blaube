// Your usage limits, asked of Claude Code with no session of Blaube's
// running: a Claude Code that loads no settings, saves nothing and calls no
// model, asked get_usage and then closed (about a second of work).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { claudeEnv } = require('./claudeEnv');

// cb(answer | null): Claude Code's get_usage answer ({ rate_limits, ... }).
// Asked with no API key in its environment (see claudeEnv.js): a key would
// win over your signed-in subscription, and a key has no plan limits.
function probe(bin, cb, opts = {}) {
  if (!bin || (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin))) return cb(null); // (a script on Windows: not worth a shell)
  let dir;
  try { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-usage-')); } catch { return cb(null); }
  const env = claudeEnv();
  let p;
  try {
    p = spawn(bin, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'local', '--no-session-persistence'], { cwd: dir, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  } catch { fs.rm(dir, { recursive: true, force: true }, () => {}); return cb(null); }
  let buf = '', over = false;
  const finish = (answer) => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    try { p.kill(); } catch { /* gone */ }
    fs.rm(dir, { recursive: true, force: true }, () => {});
    cb(answer);
  };
  const timer = setTimeout(() => finish(null), opts.timeout || 15000);
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    buf = (buf + d).slice(-1e6);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.type === 'control_response' && m.response && m.response.request_id === 'blaube-usage') finish(m.response.subtype === 'success' ? m.response.response || null : null);
    }
  });
  p.on('error', () => finish(null));
  p.on('close', () => finish(null));
  p.stdin.on('error', () => {});
  p.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'blaube-usage', request: { subtype: 'get_usage', skip_behaviors: true } }) + '\n');
}

module.exports = { probe };
