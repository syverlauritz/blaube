// Sessions Blaube starts itself: Claude Code in print mode with streaming
// input and output, in a folder you pick. There's no terminal; you talk to
// it from its slime, and what you type goes straight in, even while it's
// working (it reads it next). It's a real Claude Code session with its own
// id, so it can be picked up later with `claude --resume <id>`.
const { spawn, spawnSync, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

// Where claude is when the usual places don't have it (installed with nvm,
// bun, a custom npm prefix): ask a login shell, as a terminal would. Asked
// once, in the background, when Blaube starts; only a real file counts (an
// alias named claude isn't a program).
let shellClaude = '';
function findInShell() {
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const ask = /zsh$/.test(shell) ? 'whence -p claude' : 'type -P claude';
  execFile(shell, ['-ilc', ask], { timeout: 8000, encoding: 'utf8' }, (err, out) => {
    const found = String(out || '').trim().split('\n').pop();
    try { if (path.isAbsolute(found) && fs.statSync(found).isFile()) shellClaude = found; } catch { /* not there */ }
  });
}

// Stops a process and everything it started (on Windows, claude.cmd runs
// claude under cmd.exe: stopping cmd.exe alone would leave claude going).
function stop(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
  else proc.kill();
}

// Windows: run a .cmd through cmd.exe ourselves, every part quoted (Node's
// shell option would leave paths with spaces, and anything else, unquoted).
const quote = (a) => `"${String(a).replace(/"/g, '""')}"`;

class Owned extends EventEmitter {
  // findClaude: where the claude binary is (or nothing: use PATH).
  constructor(findClaude) {
    super();
    this.findClaude = findClaude;
    if (!findClaude()) findInShell();
    this.sessions = new Map(); // id -> { proc, cwd, startedAt, err, buf }
  }

  has(id) { return this.sessions.has(id); }
  shellPath() { return shellClaude; } // where a login shell found claude, if it had to
  list() { return [...this.sessions.keys()]; }

  // Starts a session in `cwd`. `extra`: more arguments (a model);
  // `settings`: extra settings for it (written to a file, so no shell can
  // mangle them). Returns its id.
  // `resume`: a past session's id, to pick it up where it left off (it
  // keeps its id).
  start(cwd, extra = [], settings = null, resume = '') {
    const id = resume || crypto.randomUUID();
    const bin = this.findClaude() || shellClaude || 'claude';
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...(resume ? ['--resume', id] : ['--session-id', id]), ...extra];
    let settingsFile = '';
    if (settings) {
      settingsFile = path.join(os.tmpdir(), `blaube-session-${id}.json`);
      fs.writeFileSync(settingsFile, JSON.stringify(settings));
      args.push('--settings', settingsFile);
    }
    const env = Object.assign({}, process.env);
    for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || /^CLAUDE_CODE_(CHILD_SESSION|SESSION_|ENTRYPOINT)/.test(k)) delete env[k];
    const opts = { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true };
    const viaCmd = process.platform === 'win32' && (!path.isAbsolute(bin) || /\.(cmd|bat)$/i.test(bin));
    const proc = viaCmd
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${[quote(bin), ...args.map(quote)].join(' ')}"`], Object.assign(opts, { windowsVerbatimArguments: true }))
      : spawn(bin, args, opts);
    const s = { id, proc, cwd, startedAt: Date.now(), err: '', buf: '', pending: new Map(), interrupted: false }; // (s.id can change: see read)
    this.sessions.set(id, s);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      s.buf += chunk;
      let i;
      while ((i = s.buf.indexOf('\n')) >= 0) {
        const line = s.buf.slice(0, i);
        s.buf = s.buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        this.read(s.id, m);
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => { s.err = (s.err + d).slice(-2000); });
    // However it ends (it quits, is stopped, or never starts: a missing
    // program gives 'error' and 'close' but no 'exit'), it ends once, after
    // everything it printed has been read.
    let over = false;
    const ended = (code, signal) => {
      if (over) return;
      over = true;
      if (s.buf.trim()) { try { this.read(s.id, JSON.parse(s.buf)); } catch { /* half a line */ } }
      this.sessions.delete(s.id);
      if (settingsFile) fs.rm(settingsFile, { force: true }, () => {});
      this.emit('exit', s.id, code == null && !signal ? 1 : code, s.err.trim(), signal || null);
    };
    proc.on('error', (e) => { s.err = (s.err + e.message).slice(-2000); if (!proc.pid) ended(1, null); });
    proc.on('close', ended);
    proc.stdin.on('error', () => { /* it went away; 'exit' says so */ });
    this.emit('start', id, cwd);
    return id;
  }

  // One line of its output: a finished turn is what Blaube needs.
  read(id, m) {
    if (m.type === 'system' && m.subtype === 'init' && m.session_id && m.session_id !== id && this.sessions.has(id)) {
      // A picked-up session should carry on under its own id. If Claude
      // Code gave it a new one, everything follows the new one (its hooks
      // report under it).
      const s = this.sessions.get(id);
      this.sessions.delete(id);
      s.id = String(m.session_id);
      this.sessions.set(s.id, s);
      this.emit('renamed', id, s.id);
      return;
    }
    const s = this.sessions.get(id);
    if (m.type === 'system' && typeof m.permissionMode === 'string') this.emit('mode', id, m.permissionMode);
    if (m.type === 'control_response' && m.response && s) {
      const answer = s.pending.get(m.response.request_id);
      if (!answer) return;
      s.pending.delete(m.response.request_id);
      const ok = m.response.subtype === 'success';
      answer(ok, ok ? m.response.response || {} : String(m.response.error || 'refused'));
      return;
    }
    if (m.type === 'result') {
      const interrupted = !!(s && s.interrupted);
      if (s) s.interrupted = false;
      this.emit('result', id, { text: typeof m.result === 'string' ? m.result : '', error: !!m.is_error, subtype: m.subtype || '', interrupted });
    }
  }

  // Says something to it. Returns false if it isn't running.
  send(id, text) {
    const s = this.sessions.get(id);
    if (!s || !s.proc.stdin.writable) return false;
    s.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: String(text) } }) + '\n');
    return true;
  }

  // Asks Claude Code itself (not Claude) for something: { subtype:
  // 'set_model', model }, { subtype: 'set_permission_mode', mode }, or {
  // subtype: 'interrupt' } (stops its turn now). cb(ok, its answer or why
  // not). False if it isn't running.
  control(id, request, cb = () => {}) {
    const s = this.sessions.get(id);
    if (!s || !s.proc.stdin.writable) { cb(false, 'it isn’t running'); return false; }
    const rid = 'blaube-' + crypto.randomUUID();
    const late = setTimeout(() => { if (s.pending.delete(rid)) cb(false, 'no answer'); }, 5000);
    s.pending.set(rid, (ok, r) => { clearTimeout(late); cb(ok, r); });
    if (request.subtype === 'interrupt') s.interrupted = true;
    s.proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: rid, request }) + '\n');
    return true;
  }

  // Lets it finish and stop (it ends when its input does); stops it for
  // good if it hasn't after a few seconds.
  end(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    s.proc.stdin.end();
    setTimeout(() => { if (this.sessions.get(id) === s) stop(s.proc); }, 5000);
  }

  // Blaube is quitting: stop them now (their conversations are saved).
  killAll() {
    for (const s of this.sessions.values()) { try { s.proc.stdin.end(); stop(s.proc); } catch { /* gone */ } }
  }
}

module.exports = { Owned };
