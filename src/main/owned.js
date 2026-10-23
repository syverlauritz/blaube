// Sessions Blaube starts itself: Claude Code in print mode with streaming
// input and output, in a folder you pick. There's no terminal; you talk to
// it from its slime, and what you type goes straight in, even while it's
// working (it reads it next). It's a real Claude Code session with its own
// id, so it can be picked up later with `claude --resume <id>`.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class Owned extends EventEmitter {
  // findClaude: where the claude binary is (or nothing: use PATH).
  constructor(findClaude) {
    super();
    this.findClaude = findClaude;
    this.sessions = new Map(); // id -> { proc, cwd, startedAt, err, buf }
  }

  has(id) { return this.sessions.has(id); }
  list() { return [...this.sessions.keys()]; }

  // Starts a session in `cwd`. `extra`: more arguments (a model, settings).
  // Returns its id.
  start(cwd, extra = []) {
    const id = crypto.randomUUID();
    const bin = this.findClaude() || 'claude';
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--session-id', id, ...extra];
    const env = Object.assign({}, process.env);
    for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || /^CLAUDE_CODE_(CHILD_SESSION|SESSION_|ENTRYPOINT)/.test(k)) delete env[k];
    const win = process.platform === 'win32';
    const proc = spawn(win && !path.isAbsolute(bin) ? 'claude' : bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: win && (!path.isAbsolute(bin) || bin.endsWith('.cmd')) });
    const s = { proc, cwd, startedAt: Date.now(), err: '', buf: '' };
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
        this.read(id, m);
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => { s.err = (s.err + d).slice(-2000); });
    proc.on('error', (e) => { s.err = (s.err + e.message).slice(-2000); });
    proc.on('exit', (code) => {
      this.sessions.delete(id);
      this.emit('exit', id, code, s.err.trim());
    });
    proc.stdin.on('error', () => { /* it went away; 'exit' says so */ });
    this.emit('start', id, cwd);
    return id;
  }

  // One line of its output.
  read(id, m) {
    if (m.type === 'system' && m.subtype === 'init') this.emit('ready', id, m);
    else if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      const text = m.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (text) this.emit('text', id, text);
    } else if (m.type === 'result') {
      this.emit('result', id, { text: typeof m.result === 'string' ? m.result : '', error: !!m.is_error, subtype: m.subtype || '' });
    }
  }

  // Says something to it. Returns false if it isn't running.
  send(id, text) {
    const s = this.sessions.get(id);
    if (!s || !s.proc.stdin.writable) return false;
    s.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: String(text) } }) + '\n');
    return true;
  }

  // Lets it finish and stop (it ends when its input does); stops it for
  // good if it hasn't after a few seconds.
  end(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    s.proc.stdin.end();
    setTimeout(() => { if (this.sessions.get(id) === s) s.proc.kill(); }, 5000);
  }

  endAll() { for (const id of this.list()) this.end(id); }
}

module.exports = { Owned };
