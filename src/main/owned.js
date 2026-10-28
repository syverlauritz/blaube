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
const { claudeEnv } = require('./claudeEnv');

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
  // keeps its id). `fork`: a session's id to start a copy of (its
  // conversation so far, under a new id; the original carries on).
  // `once`: arguments for this start only (not kept for a restart).
  start(cwd, extra = [], settings = null, resume = '', fork = '', once = []) {
    const id = (!fork && resume) || crypto.randomUUID();
    const bin = this.findClaude() || shellClaude || 'claude';
    const from = fork ? ['--resume', fork, '--fork-session', '--session-id', id] : resume ? ['--resume', id] : ['--session-id', id];
    // (--allow-dangerously-skip-permissions only lets "Don't ask" be picked later, from its box; it starts as it always does.)
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--allow-dangerously-skip-permissions', ...from, ...extra, ...once];
    let settingsFile = '';
    if (settings) {
      settingsFile = path.join(os.tmpdir(), `blaube-session-${id}.json`);
      fs.writeFileSync(settingsFile, JSON.stringify(settings));
      args.push('--settings', settingsFile);
    }
    const env = claudeEnv(); // (your Claude login, never an API key: see claudeEnv.js)
    env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = '1'; // (so a turn's changes can be put back: rewind_files)
    const opts = { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true };
    const viaCmd = process.platform === 'win32' && (!path.isAbsolute(bin) || /\.(cmd|bat)$/i.test(bin));
    const proc = viaCmd
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${[quote(bin), ...args.map(quote)].join(' ')}"`], Object.assign(opts, { windowsVerbatimArguments: true }))
      : spawn(bin, args, opts);
    const s = { id, proc, cwd, extra, settings, startedAt: Date.now(), err: '', buf: '', pending: new Map(), interrupted: false }; // (s.id can change: see read)
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
        if (s.cleared) continue; // (/clear: a new one has its slime now)
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
      if (s.buf.trim() && !s.cleared) { try { this.read(s.id, JSON.parse(s.buf)); } catch { /* half a line */ } }
      if (this.sessions.get(s.id) === s) this.sessions.delete(s.id);
      if (settingsFile) fs.rm(settingsFile, { force: true }, () => {});
      if (s.replaced) return; // (/clear: it carries on as a new one)
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
    if (m.type === 'system' && m.subtype === 'compact_boundary') this.emit('compacted', id);
    // Claude's API busy (overloaded, rate limited): Claude Code tries again
    // by itself; and when it falls back to another model, it says why.
    if (m.type === 'system' && m.subtype === 'api_retry') this.emit('retry', id, { attempt: Number(m.attempt) || 0, max: Number(m.max_retries) || 0, delay: Number(m.retry_delay_ms) || 0, status: m.error_status || null, error: String(m.error || '') });
    if (m.type === 'system' && m.subtype === 'memory_saved' && Array.isArray(m.writtenPaths) && m.writtenPaths.length) this.emit('remembered', id, m.writtenPaths.map(String));
    if (m.type === 'system' && m.subtype === 'model_fallback') this.emit('fallback', id, { text: String(m.content || ''), from: String(m.originalModel || m.original_model || ''), to: String(m.fallbackModel || m.fallback_model || '') });
    if (m.type === 'rate_limit_event' && m.rate_limit_info) this.emit('limits', m.rate_limit_info, id); // (your usage limits, see limits.js)
    // Claude Code's own answer to a command (not Claude's): "No messages to compact".
    if (m.type === 'assistant' && m.message && m.message.model === '<synthetic>' && s) {
      const c = m.message.content;
      s.said = Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : String(c || '');
    }
    if (m.type === 'control_response' && m.response && s) {
      const answer = s.pending.get(m.response.request_id);
      if (!answer) return;
      s.pending.delete(m.response.request_id);
      const ok = m.response.subtype === 'success';
      answer(ok, ok ? m.response.response || {} : String(m.response.error || 'refused'));
      return;
    }
    if (m.type === 'result') {
      const interrupted = !!(s && s.interrupted), said = (s && s.said) || '';
      if (s) { s.interrupted = false; s.said = ''; }
      this.emit('result', id, { text: typeof m.result === 'string' ? m.result : '', error: !!m.is_error, subtype: m.subtype || '', interrupted, said });
    }
  }

  // Says something to it. Returns false if it isn't running.
  // `uuid`: the message's id, to put its turn's changes back by later.
  send(id, text, uuid) {
    const s = this.sessions.get(id);
    if (!s || !s.proc.stdin.writable) return false;
    s.proc.stdin.write(JSON.stringify(Object.assign({ type: 'user', message: { role: 'user', content: String(text) } }, uuid ? { uuid } : {})) + '\n');
    return true;
  }

  // Asks Claude Code itself (not Claude) for something: { subtype:
  // 'set_model', model }, { subtype: 'set_permission_mode', mode }, or {
  // subtype: 'interrupt' } (stops its turn now). cb(ok, its answer or why
  // not). False if it isn't running.
  // `wait`: how long to wait for its answer (one that asks the model, longer).
  control(id, request, cb = () => {}, wait = 5000) {
    const s = this.sessions.get(id);
    if (!s || !s.proc.stdin.writable) { cb(false, 'it isn’t running'); return false; }
    const rid = 'blaube-' + crypto.randomUUID();
    const late = setTimeout(() => { if (s.pending.delete(rid)) cb(false, 'no answer'); }, wait);
    s.pending.set(rid, (ok, r) => { clearTimeout(late); cb(ok, r); });
    if (request.subtype === 'interrupt') s.interrupted = true;
    s.proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: rid, request }) + '\n');
    return true;
  }

  // /clear: a fresh conversation in the same folder, as a new session that
  // takes this one's place ('renamed' to its id); this one ends quietly (its
  // conversation is saved, to pick up later). Returns the new id.
  // `cwd`: where it's working now (its own worktree, say: then it starts
  // there rather than making another).
  // `at`: keep its conversation up to that entry instead (going back to
  // before something you said: a copy of it, cut there, takes its place).
  clear(id, cwd = '', at = '') {
    const s = this.sessions.get(id);
    if (!s) return null;
    const here = cwd && cwd !== s.cwd;
    s.replaced = s.cleared = true;
    this.sessions.delete(id);
    try { s.proc.stdin.end(); } catch { /* gone */ }
    setTimeout(() => stop(s.proc), 5000).unref();
    const extra = here ? s.extra.filter((a) => a !== '--worktree') : s.extra;
    const to = at ? this.start(here ? cwd : s.cwd, extra, s.settings, '', id, ['--resume-session-at', at]) : this.start(here ? cwd : s.cwd, extra, s.settings);
    this.emit('renamed', id, to);
    return to;
  }

  // Starts it again with more arguments (`--add-dir ~/other`), same
  // conversation, same id: once it has finished its turn and closed (two at
  // once on one conversation would trip over each other). `cwd`: where it's
  // working now, as for clear. cb(ok).
  reopen(id, more = [], cwd = '', cb = () => {}) {
    const s = this.sessions.get(id);
    if (!s) return cb(false);
    const here = cwd && cwd !== s.cwd;
    s.replaced = true;
    s.proc.once('close', () => {
      if (this.sessions.get(id) === s) this.sessions.delete(id);
      this.start(here ? cwd : s.cwd, [...(here ? s.extra.filter((a) => a !== '--worktree') : s.extra), ...more], s.settings, id);
      cb(true);
    });
    try { s.proc.stdin.end(); } catch { /* gone */ }
    setTimeout(() => { if (s.proc.exitCode == null && s.proc.signalCode == null) stop(s.proc); }, 60e3).unref();
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
