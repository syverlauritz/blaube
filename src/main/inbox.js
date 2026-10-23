// Talking to a session from its slime. When a session finishes a turn, a
// background Stop hook (asyncRewake) asks Blaube's server for a message and
// waits. Sending one answers that waiting request; the hook hands the text to
// Claude and wakes the session, even when nobody is at the terminal. While
// Claude is busy nobody is waiting, so messages queue until the turn ends.
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
    this.queue = new Map(); // session id -> [text]
    this.logs = new Map(); // session id -> [{ who: 'you' | 'claude', text, via, at, status }]
    this.reachable = new Set(); // sessions whose inbox hook has asked at least once
  }

  // A session's inbox hook is asking for a message. `reply(text)` answers
  // it (null: nothing, stop waiting); returns false if it can't any more.
  wait(id, reply) {
    this.reachable.add(id);
    const queued = this.queue.get(id);
    if (queued && queued.length) {
      this.queue.delete(id);
      this.deliver(id, queued, reply);
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
    for (const e of this.log(id)) if (e.status === 'queued') e.status = 'sent';
    this.emit('delivered', id);
    this.emit('change', id);
  }

  // Sends a message from the slime: straight in if the session is waiting,
  // otherwise queued for the end of its turn. Returns 'sent' or 'queued'.
  send(id, text) {
    text = String(text || '').trim();
    if (!text) return null;
    const waiter = this.waiters.get(id);
    this.add(id, { who: 'you', text, via: 'blaube', status: waiter ? 'sent' : 'queued' });
    if (waiter) {
      this.waiters.delete(id);
      this.deliver(id, [text], waiter);
      return 'sent';
    }
    const q = this.queue.get(id) || [];
    q.push(text);
    this.queue.set(id, q);
    this.emit('change', id);
    return 'queued';
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
      else this.emit('change', id);
    } else if (event === 'Stop' && payload.last_assistant_message) {
      this.add(id, { who: 'claude', text: String(payload.last_assistant_message) });
      this.emit('reply', id, String(payload.last_assistant_message));
    } else if (event === 'SessionEnd') {
      const w = this.waiters.get(id);
      if (w) w(null);
      this.waiters.delete(id);
      this.queue.delete(id);
      this.reachable.delete(id);
      this.emit('change', id);
    }
  }

  log(id) { return this.logs.get(id) || []; }

  add(id, entry) {
    const log = this.logs.get(id) || [];
    log.push(Object.assign({ at: this.now() }, entry));
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
    this.logs.set(id, log);
    this.emit('change', id);
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
    };
  }
}

module.exports = { Inbox, frame };
