// Talking to a session from its slime. When a session finishes a turn, a
// background Stop hook (asyncRewake) asks Blaube's server for a message and
// waits. Sending one answers that waiting request; the hook hands the text to
// Claude and wakes the session, even when nobody is at the terminal. While
// Claude is busy nobody is waiting, so messages queue until the turn ends.
//
// Permission prompts come in the same way: a PermissionRequest hook asks
// and waits, and Allow or Deny on the slime answers it.
//
// It also keeps a short log of each session's conversation since Blaube
// started (prompts typed in the terminal, messages sent from the slime and
// Claude's replies), for the talk box.
const { EventEmitter } = require('node:events');

const MAX_LOG = 60;

// How a message from the slime reaches Claude: as a system reminder, so it
// says plainly that it's the user talking.
const frame = (text) => `The user sent you this message from Blaube, their desktop buddy for Claude Code. Treat it as their next prompt and reply as usual:\n\n${text}`;

class Inbox extends EventEmitter {
  constructor(now = () => Date.now()) {
    super();
    this.now = now;
    this.waiters = new Map(); // session id -> the hook's waiting response
    this.queue = new Map(); // session id -> [log entry]
    this.logs = new Map(); // session id -> [{ who: 'you' | 'claude', text, via, at, status }]
    this.reachable = new Set(); // sessions whose inbox hook has asked at least once
    this.asks = new Map(); // session id -> [{ key, tool, detail, always, reply }]
    this.nextKey = 1;
  }

  // A session wants permission for a tool; `reply(json)` answers its hook.
  ask(id, payload, reply) {
    const list = this.asks.get(id) || [];
    const always = Array.isArray(payload.permission_suggestions) && payload.permission_suggestions.length ? payload.permission_suggestions : null;
    list.push({ key: this.nextKey++, tool: toolName(payload.tool_name), detail: describe(payload.tool_name, payload.tool_input), always, reply });
    this.asks.set(id, list);
    this.emit('change', id);
  }

  // The hook went away: answered in the terminal, or the session moved on.
  unasked(id, reply) {
    const list = (this.asks.get(id) || []).filter((a) => a.reply !== reply);
    if (list.length) this.asks.set(id, list); else this.asks.delete(id);
    this.emit('change', id);
  }

  // Allow ('allow'), allow from now on ('always') or deny ('deny').
  decide(id, key, choice) {
    const list = this.asks.get(id) || [];
    const a = list.find((x) => x.key === key);
    if (!a) return false;
    const decision = choice === 'deny'
      ? { behavior: 'deny', message: 'The user denied this from Blaube, their desktop buddy.' }
      : Object.assign({ behavior: 'allow' }, choice === 'always' && a.always ? { updatedPermissions: a.always } : {});
    a.reply(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
    this.add(id, { who: 'note', text: `${choice === 'deny' ? 'Denied' : choice === 'always' ? 'Always allowed' : 'Allowed'} ${a.tool}${a.detail ? ': ' + a.detail : ''}` });
    this.unasked(id, a.reply);
    return true;
  }

  // A session's inbox hook is asking for a message. `reply(text)` answers
  // it (null: nothing, stop waiting); returns false if it can't any more.
  wait(id, reply) {
    this.reachable.add(id);
    const queued = this.queue.get(id);
    if (queued && queued.length) {
      this.queue.delete(id);
      this.deliver(id, queued.map((e) => e.text), reply);
      return;
    }
    // Only the newest hook waits; an older one (from before you typed in
    // the terminal, say) is let go.
    const old = this.waiters.get(id);
    if (old) old(null);
    this.waiters.set(id, reply);
    this.emit('change', id);
  }

  // The waiting request went away (Blaube's side closed, the session ended).
  gone(id, reply) {
    if (this.waiters.get(id) === reply) { this.waiters.delete(id); this.emit('change', id); }
  }

  deliver(id, texts, reply) {
    reply(frame(texts.join('\n\n')));
    // 'delivering' until the wake-up shows up as the next turn starting, so
    // a reply to the turn before still lands above them (see observe).
    for (const e of this.log(id)) if (e.status === 'queued') e.status = 'delivering';
    this.emit('delivered', id);
    this.emit('change', id);
  }

  // Sends a message from the slime: straight in if the session is waiting,
  // otherwise queued for the end of its turn. Returns 'sent' or 'queued'.
  send(id, text) {
    text = String(text || '').trim();
    if (!text) return null;
    const waiter = this.waiters.get(id);
    const entry = this.add(id, { who: 'you', text, via: 'blaube', status: waiter ? 'delivering' : 'queued' });
    if (waiter) {
      this.waiters.delete(id);
      this.deliver(id, [text], waiter);
      return 'sent';
    }
    const q = this.queue.get(id) || [];
    q.push(entry);
    this.queue.set(id, q);
    this.emit('change', id);
    return 'queued';
  }

  // Takes back a message that hasn't gone in yet (by its log entry's n).
  unsend(id, n) {
    const q = this.queue.get(id) || [];
    const e = q.find((x) => x.n === n);
    if (!e) return false;
    const rest = q.filter((x) => x !== e);
    if (rest.length) this.queue.set(id, rest); else this.queue.delete(id);
    this.logs.set(id, this.log(id).filter((x) => x !== e));
    this.emit('change', id);
    return true;
  }

  // Hook events, for the log and to know when a turn starts or a session ends.
  observe(payload) {
    const id = String(payload.session_id || '');
    if (!id || payload.agent_id) return;
    const event = payload.hook_event_name;
    if (event === 'UserPromptSubmit') {
      // You typed in the terminal: a turn starts, so stop the old hook
      // waiting (its message would land mid-turn); the next Stop asks again.
      const w = this.waiters.get(id);
      if (w) { this.waiters.delete(id); w(null); }
      // A wake-up from the inbox hook arrives as a prompt too, as a
      // <task-notification>; that's not something you typed.
      const prompt = String(payload.prompt || '');
      if (prompt && !/^\s*<task-notification>/.test(prompt)) this.add(id, { who: 'you', text: prompt, via: 'terminal' });
      else {
        // The wake-up: what the slime sent is in this turn now.
        for (const e of this.log(id)) if (e.status === 'delivering') e.status = 'sent';
        this.emit('change', id);
      }
    } else if (event === 'Stop' && payload.last_assistant_message) {
      // The reply answers the turn that just ended, so it goes above
      // anything sent from the slime that hasn't been read yet.
      const log = this.logs.get(id) || [];
      let at = log.length;
      while (at > 0 && (log[at - 1].status === 'queued' || log[at - 1].status === 'delivering')) at--;
      for (const e of log) if (e.status === 'delivering' && log.indexOf(e) < at) e.status = 'sent';
      const entry = this.add(id, { who: 'claude', text: String(payload.last_assistant_message) });
      if (at < log.length - 1) { log.splice(log.indexOf(entry), 1); log.splice(at, 0, entry); }
      this.emit('reply', id, entry);
    } else if (event === 'SessionEnd') {
      const w = this.waiters.get(id);
      if (w) w(null);
      this.waiters.delete(id);
      this.queue.delete(id);
      this.reachable.delete(id);
      for (const a of this.asks.get(id) || []) a.reply(null);
      this.asks.delete(id);
      this.emit('change', id);
    }
  }

  log(id) { return this.logs.get(id) || []; }

  add(id, entry) {
    const log = this.logs.get(id) || [];
    const e = Object.assign({ at: this.now(), n: this.nextKey++ }, entry);
    log.push(e);
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
    this.logs.set(id, log);
    this.emit('change', id);
    return e;
  }

  // What the talk box needs to know about a session.
  view(id) {
    return {
      log: this.log(id),
      // 'ready': it's waiting, a message goes straight in; 'busy': its hook
      // has asked before, so a message arrives when the turn ends; 'unknown':
      // never heard from its inbox hook (started before it was installed).
      inbox: this.waiters.has(id) ? 'ready' : this.reachable.has(id) ? 'busy' : 'unknown',
      queued: (this.queue.get(id) || []).length,
      ask: (() => {
        const a = (this.asks.get(id) || [])[0];
        if (!a) return null;
        // No "always" for something too long to show in full.
        const always = a.always && !a.detail.endsWith('…') ? alwaysLabel(a.always) : '';
        return { key: a.key, tool: a.tool, detail: a.detail, always, alwaysFull: always ? alwaysLabel(a.always, Infinity) : '' };
      })(),
      asks: (this.asks.get(id) || []).length,
    };
  }
}

// What a tool call would do, in a line: the command, the file, the address.
function describe(tool, input) {
  if (!input || typeof input !== 'object') return '';
  // An edit or a new file: which file, and what changes.
  if (input.file_path && typeof input.new_string === 'string') {
    return clip(`${input.file_path}\n− ${String(input.old_string || '').trim()}\n+ ${input.new_string.trim()}`);
  }
  if (input.file_path && typeof input.content === 'string') {
    return clip(`${input.file_path}\n${input.content.split('\n').slice(0, 8).join('\n')}${input.content.split('\n').length > 8 ? '\n…' : ''}`);
  }
  // In full (up to a point): you can't judge what you can't see.
  const v = input.command || input.file_path || input.notebook_path || input.url || input.pattern || input.path || input.query || input.description;
  const text = v ? String(v) : JSON.stringify(input);
  return clip(text);
}

const clip = (text) => (text.length > 4000 ? text.slice(0, 4000) + '…' : text);

// A tool's name as a person would say it: "Bash", "Gmail: send message".
function toolName(name) {
  const n = String(name || 'a tool');
  const m = /^mcp__(.+?)__(.+)$/.exec(n);
  if (!m) return n;
  const server = m[1].replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ');
  return `${server}: ${m[2].replace(/[_-]+/g, ' ')}`;
}

// What "Always allow" would allow from now on, from Claude Code's
// suggested permission updates: "Always allow npm run build:*".
function alwaysLabel(updates, max = 70) {
  const parts = [];
  for (const u of updates) {
    if (u.type === 'addRules' && u.behavior === 'allow') {
      for (const r of u.rules || []) parts.push(r.ruleContent ? r.ruleContent : `every ${toolName(r.toolName)}`);
    } else if (u.type === 'addDirectories') {
      for (const d of u.directories || []) parts.push(`files in ${String(d).split(/[\\/]/).filter(Boolean).pop() || d}`);
    } else if (u.type === 'setMode') {
      parts.push(u.mode === 'acceptEdits' ? 'edits for this session' : `${u.mode} mode`);
    }
  }
  if (!parts.length) return 'Always allow this';
  const text = 'Always allow ' + parts.join(', ');
  return text.length > max ? text.slice(0, max - 2) + '…' : text;
}

module.exports = { Inbox, frame, describe, toolName, alwaysLabel };
