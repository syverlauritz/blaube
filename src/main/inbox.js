// Talking to a session from its slime. When a session finishes a turn, a
// background Stop hook (asyncRewake) asks Blaube's server for a message and
// waits. Sending one answers that waiting request; the hook hands the text to
// Claude and wakes the session, even when nobody is at the terminal. While
// Claude is busy nobody is waiting, so messages queue until the turn ends.
//
// Permission prompts come in the same way: a PermissionRequest hook asks
// and waits, and Allow or Deny on the slime answers it. So do Claude's
// multiple-choice questions (answered with the chosen labels) and its plans
// in plan mode (approved, or sent back to keep planning).
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
    // Sessions Blaube started itself (owned.js): what you say goes straight
    // into them, and their replies come from their own output.
    this.owned = new Set();
    this.typed = new Map(); // session id -> what was just typed into its terminal (its prompt echo isn't logged twice)
    this.nextKey = 1;
  }

  // A session wants permission for a tool; `reply(json)` answers its hook.
  ask(id, payload, reply) {
    const list = this.asks.get(id) || [];
    const always = Array.isArray(payload.permission_suggestions) && payload.permission_suggestions.length ? payload.permission_suggestions : null;
    const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
    const kind = payload.tool_name === 'AskUserQuestion' && Array.isArray(input.questions) ? 'question'
      : payload.tool_name === 'ExitPlanMode' ? 'plan' : 'tool';
    list.push({ key: this.nextKey++, kind, input, tool: toolName(payload.tool_name), detail: kind === 'tool' ? describe(payload.tool_name, input) : '', always, reply });
    this.asks.set(id, list);
    this.emit('change', id);
  }

  // The hook went away: answered in the terminal, or the session moved on.
  unasked(id, reply) {
    const list = (this.asks.get(id) || []).filter((a) => a.reply !== reply);
    if (list.length) this.asks.set(id, list); else this.asks.delete(id);
    this.emit('change', id);
  }

  // Allow ('allow'), allow from now on ('always') or deny ('deny'). A
  // question is answered with `answers` ({ question text: label }); a plan
  // is approved ('allow' / 'always') or sent back to keep planning ('deny').
  decide(id, key, choice, answers) {
    const list = this.asks.get(id) || [];
    const a = list.find((x) => x.key === key);
    if (!a) return false;
    const always = choice === 'always' && a.always ? { updatedPermissions: a.always } : {};
    let decision, note;
    if (a.kind === 'question') {
      if (!answers || typeof answers !== 'object') return false;
      const clean = {};
      for (const q of a.input.questions) if (answers[q.question] != null && String(answers[q.question]).trim()) clean[q.question] = String(answers[q.question]).trim();
      // Every question answered, or nothing goes (no half answers).
      if (Object.keys(clean).length !== a.input.questions.length) return false;
      decision = { behavior: 'allow', updatedInput: Object.assign({}, a.input, { answers: clean }) };
      note = 'Answered: ' + Object.entries(clean).map(([q, v]) => `${q} → ${v}`).join(' · ');
    } else if (a.kind === 'plan') {
      const change = answers && answers.message ? String(answers.message).trim() : '';
      decision = choice === 'deny'
        ? { behavior: 'deny', message: change
          ? `The user wants changes to the plan (sent from Blaube, their desktop buddy): ${change}`
          : 'The user wants to keep planning (sent from Blaube, their desktop buddy). Ask what to change, or refine the plan.' }
        : Object.assign({ behavior: 'allow', updatedInput: a.input }, always);
      note = choice === 'deny' ? (change ? `Kept planning: ${change}` : 'Kept planning') : choice === 'always' ? 'Approved the plan, auto-accepting edits' : 'Approved the plan';
    } else {
      decision = choice === 'deny'
        ? { behavior: 'deny', message: 'The user denied this from Blaube, their desktop buddy.' }
        : Object.assign({ behavior: 'allow' }, always);
      note = `${choice === 'deny' ? 'Denied' : choice === 'always' ? 'Always allowed' : 'Allowed'} ${a.tool}${a.detail ? ': ' + a.detail : ''}`;
    }
    a.reply(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
    this.add(id, { who: 'note', text: note });
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

  // The queued messages went in by being typed into the session's own
  // terminal (it had no inbox hook to hand them to). Returns the text.
  takeForTyping(id) {
    const q = this.queue.get(id) || [];
    if (!q.length) return '';
    this.queue.delete(id);
    for (const e of q) e.status = 'sent';
    const text = q.map((e) => e.text).join(' ');
    this.typed.set(id, text);
    this.emit('change', id);
    return text;
  }

  // Typing it didn't work: back in the queue.
  untake(id, text) {
    if (this.typed.get(id) !== text) return;
    this.typed.delete(id);
    const back = this.log(id).filter((e) => e.via === 'blaube' && e.status === 'sent' && text.includes(e.text));
    for (const e of back) e.status = 'queued';
    if (back.length) this.queue.set(id, back);
    this.emit('change', id);
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

  // Something you said to a session Blaube started (it went straight in).
  say(id, text) {
    text = String(text || '').trim();
    if (text) this.add(id, { who: 'you', text, via: 'blaube', status: 'sent' });
  }

  // A reply from a session Blaube started (from its own output).
  replied(id, text) {
    if (!String(text || '').trim()) return;
    const entry = this.add(id, { who: 'claude', text: String(text) });
    this.emit('reply', id, entry);
  }

  // Hook events, for the log and to know when a turn starts or a session ends.
  observe(payload) {
    const id = String(payload.session_id || '');
    if (!id || payload.agent_id) return;
    const event = payload.hook_event_name;
    // A session Blaube started tells its own story (say/replied).
    if (this.owned.has(id) && (event === 'UserPromptSubmit' || event === 'Stop')) return;
    if (event === 'UserPromptSubmit') {
      // You typed in the terminal: a turn starts, so stop the old hook
      // waiting (its message would land mid-turn); the next Stop asks again.
      const w = this.waiters.get(id);
      if (w) { this.waiters.delete(id); w(null); }
      // A wake-up from the inbox hook arrives as a prompt too, as a
      // <task-notification>; that's not something you typed.
      const prompt = String(payload.prompt || '');
      const echo = this.typed.get(id);
      if (echo && prompt.trim() === echo.trim()) { this.typed.delete(id); this.emit('change', id); } // we typed that
      else if (prompt && !/^\s*<task-notification>/.test(prompt)) this.add(id, { who: 'you', text: prompt, via: 'terminal' });
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
      for (const e of this.log(id)) if (e.status === 'queued' || e.status === 'delivering') e.status = 'unsent';
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
      inbox: this.owned.has(id) || this.waiters.has(id) ? 'ready' : this.reachable.has(id) ? 'busy' : 'unknown',
      owned: this.owned.has(id),
      queued: (this.queue.get(id) || []).length,
      ask: (() => {
        const a = (this.asks.get(id) || [])[0];
        if (!a) return null;
        // No "always" for something too long to show in full.
        let always = a.always && !a.detail.endsWith('…') ? alwaysLabel(a.always) : '';
        // On a plan, the "always" choice is going ahead in a more trusting mode.
        if (always && a.kind === 'plan') always = a.always.some((u) => u.type === 'setMode' && u.mode === 'acceptEdits') ? 'Go ahead, and auto-accept edits' : always.replace(/^Always allow/, 'Go ahead, and always allow');
        const out = { key: a.key, kind: a.kind, tool: a.tool, detail: a.detail, always, alwaysFull: always ? alwaysLabel(a.always, Infinity) : '' };
        if (a.kind === 'question') {
          out.questions = a.input.questions.slice(0, 4).map((q) => ({
            question: String(q.question || ''), header: String(q.header || ''), multiSelect: !!q.multiSelect,
            options: (Array.isArray(q.options) ? q.options : []).map((o) => ({ label: String(o.label || ''), description: String(o.description || '') })),
          }));
        }
        if (a.kind === 'plan') out.plan = clip(String(a.input.plan || ''));
        return out;
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
