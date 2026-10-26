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
const { testCounts, words: countWords } = require('./testCounts');
const { classify } = require('../shared/actions');

const MAX_LOG = 60;
const MAX_STEPS = 40; // what it did (read, edited, ran) is dropped before what was said

// How a message from the slime reaches Claude: as a system reminder, so it
// says plainly that it's the user talking, and that the answer will be read
// in a small bubble (so: short and plain).
const frame = (text) => `The user sent you this message from Blaube, their desktop buddy for Claude Code. Treat it as their next prompt. They'll read your reply in a small chat bubble, so keep the reply itself short and plain (a few sentences, no headings or tables, little or no code) unless they ask for detail; do the work as usual:\n\n${text}`;

// The same, for sessions Blaube starts itself (they live in the bubble).
const STYLE = 'You are talking with the user through Blaube, a small chat bubble above a desktop buddy, not a terminal. This only shapes how you write your replies: do the work, checks and tool use exactly as thoroughly as you normally would. Keep replies short, plain and direct: a few sentences, no headings or tables, lists only when they help. Say what you did or found first; give more detail only when asked. If a short snippet is the answer, show it; don\'t create files just to hold example code.';

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
    // Sessions whose tool hooks hand Blaube's answer back to Claude (they
    // were connected by this Blaube): a message can go in at the next step,
    // and Stop works.
    this.steerable = new Set();
    this.stops = new Set(); // sessions you asked to stop (until the turn ends)
    this.todos = new Map(); // session id -> [{ id, text, doing, status }]
    this.nextKey = 1;
  }

  // A tool hook from a session (PreToolUse, PostToolUse...). Returns what
  // the hook hands back to Claude, or '' for nothing.
  // - Stop: every tool is turned down until the turn ends, with a word that
  //   you asked it to stop, so it wraps up and its Stop hook still runs
  //   (and it can still hear you afterwards).
  // - Messages from the slime go in at the next step, as Claude Code does
  //   with what you type while it works, instead of after the turn.
  step(payload, talksBack) {
    const id = String(payload.session_id || '');
    if (!id) return '';
    if (talksBack && !this.steerable.has(id)) { this.steerable.add(id); this.emit('change', id); }
    if (!talksBack) return '';
    const event = payload.hook_event_name;
    if (this.stops.has(id) && event === 'PreToolUse') {
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'The user pressed Stop in Blaube, their desktop buddy. Stop now: don\'t use any more tools. In one short sentence, say where you got to.' } });
    }
    if (payload.agent_id || this.stops.has(id) || this.owned.has(id)) return '';
    if (event !== 'PostToolUse') return '';
    const q = this.queue.get(id);
    if (!q || !q.length) return '';
    this.queue.delete(id);
    for (const e of q) { e.status = 'sent'; e.sentAt = this.now(); e.midTurn = true; } // (part of the turn it's in, not a new one)
    this.emit('heard', id);
    this.emit('change', id);
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: frame(q.map((e) => e.text).join('\n\n')) } });
  }

  // Stop button: it stops before its next step. False if it can't.
  stop(id) {
    if (!this.steerable.has(id) || this.stops.has(id)) return false;
    this.stops.add(id);
    // Whatever it's asking you is answered no, so it isn't left waiting.
    for (const a of [...(this.asks.get(id) || [])]) {
      a.reply(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'The user pressed Stop in Blaube, their desktop buddy. Stop now and say where you got to.' } } }));
      this.unasked(id, a.reply);
    }
    this.add(id, { who: 'note', text: 'You asked it to stop', stop: true });
    this.emit('stopping', id);
    return true;
  }

  // A session wants permission for a tool; `reply(json)` answers its hook.
  ask(id, payload, reply) {
    const list = this.asks.get(id) || [];
    const always = Array.isArray(payload.permission_suggestions) && payload.permission_suggestions.length ? payload.permission_suggestions : null;
    const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
    const kind = payload.tool_name === 'AskUserQuestion' && Array.isArray(input.questions) ? 'question'
      : payload.tool_name === 'ExitPlanMode' ? 'plan' : 'tool';
    list.push({ key: this.nextKey++, kind, input, raw: String(payload.tool_name || ''), tool: toolName(payload.tool_name), detail: kind === 'tool' ? describe(payload.tool_name, input) : '', always, reply });
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
      // Denied with a note, as "No, and tell Claude what to do differently".
      const say = choice === 'deny' && answers && answers.message ? String(answers.message).trim() : '';
      decision = choice === 'deny'
        ? { behavior: 'deny', message: say
          ? `The user denied this from Blaube, their desktop buddy, and said what to do instead: ${say}`
          : 'The user denied this from Blaube, their desktop buddy.' }
        : Object.assign({ behavior: 'allow' }, always);
      note = `${choice === 'deny' ? 'Denied' : choice === 'always' ? 'Always allowed' : 'Allowed'} ${a.tool}${a.detail ? ': ' + a.detail : ''}${say ? ` · “${say}”` : ''}`;
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
    for (const e of this.log(id)) if (e.status === 'queued') { e.status = 'delivering'; e.sentAt = this.now(); }
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
    // As it will be typed: one line (Return would send it early).
    const text = q.map((e) => e.text).join(' ').replace(/\s*\n\s*/g, ' ');
    this.typed.set(id, { text, entries: q });
    this.emit('change', id);
    return text;
  }

  // Typing it didn't work: exactly those messages go back in the queue.
  untake(id, text) {
    const t = this.typed.get(id);
    if (!t || t.text !== text) return;
    this.typed.delete(id);
    for (const e of t.entries) e.status = 'queued';
    this.queue.set(id, [...t.entries, ...(this.queue.get(id) || [])]);
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
  say(id, text, uuid) {
    text = String(text || '').trim();
    if (text) this.add(id, Object.assign({ who: 'you', text, via: 'blaube', status: 'sent' }, uuid ? { uuid } : {}));
  }

  // A reply from a session Blaube started (from its own output).
  replied(id, text) {
    if (!String(text || '').trim()) return;
    const turn = turnOf(this.log(id), this.now());
    const entry = this.add(id, Object.assign({ who: 'claude', text: String(text) }, turn ? { turn } : {}));
    this.emit('reply', id, entry);
  }

  // Hook events, for the log and to know when a turn starts or a session ends.
  observe(payload) {
    const id = String(payload.session_id || '');
    if (!id || payload.agent_id) return;
    const event = payload.hook_event_name;
    if (this.stops.has(id) && (event === 'Stop' || event === 'UserPromptSubmit' || event === 'SessionEnd')) { this.stops.delete(id); this.emit('change', id); }
    // Its to-do list, as the terminal shows it.
    if (event === 'PostToolUse') {
      const doneOf = () => (this.todos.get(id) || []).filter((t) => t.status === 'completed').length;
      const before = doneOf();
      if (todo(this.todos, id, payload)) {
        const after = doneOf(), of = (this.todos.get(id) || []).length;
        if (after > before) this.emit('ticked', id, { done: after, of });
        this.emit('change', id);
      }
    }
    if (event === 'SessionEnd') this.todos.delete(id);
    // What it did, a line per step, between what was said.
    if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
      const text = stepText(payload.tool_name, payload.tool_input);
      const i = payload.tool_input || {};
      const file = /^(Edit|MultiEdit|Write|NotebookEdit|Read)$/.test(payload.tool_name) ? String(i.file_path || i.notebook_path || '') : '';
      const cmd = (payload.tool_name === 'Bash' || payload.tool_name === 'PowerShell') && payload.tool_input && typeof payload.tool_input.command === 'string' ? payload.tool_input.command.slice(0, 200) : '';
      const detail = stepDetail(payload);
      // (A test run says how it went: "Ran npm test · 2 failing".)
      const counts = cmd && TESTS.test(cmd) ? testCounts(detail) : null;
      if (text) this.add(id, Object.assign({ who: 'step', text: text + countWords(counts), ok: event === 'PostToolUse', kind: classify(payload.tool_name, payload.tool_input), detail }, file ? { file } : {}, cmd ? { cmd } : {}, counts ? { tests: counts } : {}));
    }
    // A session Blaube started tells its own story (say/replied).
    if (this.owned.has(id) && (event === 'UserPromptSubmit' || event === 'Stop')) return;
    // The terminal answered a permission prompt (the tool ran, or the turn
    // moved on): take its card off the slime, so it can't be answered twice.
    if (this.asks.has(id) && (event === 'PostToolUse' || event === 'PostToolUseFailure' || event === 'UserPromptSubmit' || event === 'Stop')) {
      const same = (a) => event.startsWith('PostToolUse') ? a.raw === payload.tool_name && JSON.stringify(a.input) === JSON.stringify(payload.tool_input || {}) : true;
      for (const a of (this.asks.get(id) || []).filter(same)) { a.reply(null); this.unasked(id, a.reply); }
    }
    if (event === 'UserPromptSubmit') {
      // You typed in the terminal: a turn starts, so stop the old hook
      // waiting (its message would land mid-turn); the next Stop asks again.
      const w = this.waiters.get(id);
      if (w) { this.waiters.delete(id); w(null); }
      // A wake-up from the inbox hook arrives as a prompt too, as a
      // <task-notification>; that's not something you typed.
      const prompt = String(payload.prompt || '');
      const echo = this.typed.get(id);
      if (echo && prompt.trim() === echo.text.trim()) { this.typed.delete(id); this.emit('change', id); } // we typed that
      else if (prompt && !/^\s*<task-notification>/.test(prompt)) this.add(id, { who: 'you', text: prompt, via: 'terminal' });
      else {
        // The wake-up: what the slime sent is in this turn now.
        for (const e of this.log(id)) if (e.status === 'delivering') e.status = 'sent';
        this.emit('change', id);
      }
    } else if (event === 'Stop' && payload.last_assistant_message) {
      // The reply answers the turn that just ended, so it goes above
      // anything sent from the slime that hasn't been read yet.
      const turn = turnOf(this.log(id), this.now());
      const entry = this.add(id, Object.assign({ who: 'claude', text: String(payload.last_assistant_message) }, turn ? { turn } : {}));
      const log = this.logs.get(id);
      log.pop();
      let at = log.length;
      while (at > 0 && (log[at - 1].status === 'queued' || log[at - 1].status === 'delivering')) at--;
      for (let i = 0; i < at; i++) if (log[i].status === 'delivering') log[i].status = 'sent';
      log.splice(at, 0, entry);
      this.emit('reply', id, entry);
    } else if (event === 'SessionEnd') {
      for (const e of this.log(id)) if (e.status === 'queued' || e.status === 'delivering') e.status = 'unsent';
      const w = this.waiters.get(id);
      if (w) w(null);
      this.waiters.delete(id);
      this.queue.delete(id);
      this.reachable.delete(id);
      this.steerable.delete(id);
      for (const a of this.asks.get(id) || []) a.reply(null);
      this.asks.delete(id);
      this.emit('change', id);
    }
  }

  // A session that's gone for good: nothing is kept for it.
  forget(id) {
    if (this.waiters.has(id) || this.asks.has(id) || this.owned.has(id)) return false; // (still talking to it)
    for (const m of [this.queue, this.logs, this.typed, this.todos, this.reachable, this.steerable, this.stops]) m.delete(id);
    return true;
  }

  // Everything about a session moves to its new id.
  rename(from, to) {
    for (const m of [this.waiters, this.queue, this.logs, this.asks, this.typed, this.todos]) if (m.has(from)) { m.set(to, m.get(from)); m.delete(from); }
    for (const set of [this.reachable, this.owned, this.steerable, this.stops]) if (set.has(from)) { set.delete(from); set.add(to); }
    this.emit('change', to);
  }

  log(id) { return this.logs.get(id) || []; }

  add(id, entry) {
    const log = this.logs.get(id) || [];
    const e = Object.assign({ at: this.now(), n: this.nextKey++ }, entry);
    log.push(e);
    // (In batches: every trim redraws the talk box from scratch.)
    const steps = log.filter((x) => x.who === 'step');
    if (steps.length > MAX_STEPS + 20) { const drop = new Set(steps.slice(0, steps.length - MAX_STEPS)); log.splice(0, log.length, ...log.filter((x) => !drop.has(x))); }
    if (log.length > MAX_LOG + MAX_STEPS) log.splice(0, log.length - MAX_LOG - MAX_STEPS);
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
      todos: this.todos.get(id) || [],
      stoppable: this.steerable.has(id),
      stopping: this.stops.has(id),
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

// What the turn that just ended came to: how long since what started it,
// how many steps, which files it changed. Null if there's nothing to say.
function turnOf(log, now) {
  let start = -1;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.who === 'claude') break;
    if (e.who !== 'you' || e.status === 'queued' || e.status === 'delivering') continue;
    start = i;
    if (!e.midTurn) break; // (a message added mid-turn: the turn began before it)
  }
  if (start < 0) return null;
  const steps = log.slice(start + 1).filter((e) => e.who === 'step');
  const files = [...new Set(steps.filter((e) => e.file && e.kind === 'edit').map((e) => e.file))];
  return Object.assign({ took: Math.max(0, now - (log[start].sentAt || log[start].at)), steps: steps.length, files }, log[start].uuid ? { rewind: log[start].uuid } : {}); // (from when it went in, not when it was typed; rewind: the message to put its changes back to)
}

// The test command its last turn ran and that failed (its last run of
// tests, so tests fixed later in the turn don't count), or ''.
const TESTS = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|npx\s+(?:jest|vitest|mocha|playwright\s+test)|pytest|jest|vitest|mocha|rspec|go\s+test|cargo\s+test|node\s+--test|make\s+test|dotnet\s+test|mvn\s+test|gradlew?\s+test)\b/;
function failedTests(log) {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.who === 'you' && !e.midTurn && e.status !== 'queued') break;
    if (e.who === 'step' && e.cmd && TESTS.test(e.cmd)) return e.ok === false ? e.cmd : '';
  }
  return '';
}

// Whether you stopped its last turn (so it can be asked to carry on).
// Whether its last turn ended on an API error (overloaded, say): nothing
// you said since, and nothing Claude said after it.
function erredLast(log) {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if ((e.who === 'you' && !e.midTurn && e.status !== 'queued') || e.who === 'claude') return '';
    // (What Claude Code said. Blaube's own "couldn't…" notes aren't
    // Claude's errors: trying again wouldn't help, and would cost a turn.)
    if (e.who === 'note' && e.error && /^Claude Code: /.test(e.text || '')) return e.text;
  }
  return '';
}

// A script Blaube ran for it (runs.js) that stopped with an error since
// anything was said: { command, tail } (its last lines), or null.
function runFailed(log) {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if ((e.who === 'you' && !e.midTurn && e.status !== 'queued') || e.who === 'claude') return null;
    if (e.who === 'note' && e.runFailed) return e.runFailed;
  }
  return null;
}

function stoppedLast(log) {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.who === 'you' && !e.midTurn && e.status !== 'queued') return false;
    if (e.who === 'note' && e.stop) return true;
  }
  return false;
}

// Keeps a session's to-do list up to date from TodoWrite (the whole list
// each time) or the task tools (one item at a time). True if it changed.
function todo(all, id, p) {
  const i = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
  const r = p.tool_response && typeof p.tool_response === 'object' ? p.tool_response : {};
  const status = (v) => (v === 'completed' || v === 'in_progress' || v === 'pending' ? v : null);
  if (p.tool_name === 'TodoWrite' && Array.isArray(i.todos)) {
    all.set(id, i.todos.filter((t) => t && t.content).slice(0, 30).map((t, n) => ({ id: String(t.id || n), text: String(t.content), doing: String(t.activeForm || t.content), status: status(t.status) || 'pending' })));
    return true;
  }
  const list = all.get(id) || [];
  if (p.tool_name === 'TaskCreate' && i.subject) {
    const tid = String((r.task && r.task.id) || r.id || r.taskId || list.length + 1);
    // A fresh list once the last one is all done.
    const keep = list.length && list.every((t) => t.status === 'completed') ? [] : list;
    all.set(id, [...keep, { id: tid, text: String(i.subject), doing: String(i.activeForm || i.subject), status: 'pending' }].slice(-30));
    return true;
  }
  if (p.tool_name === 'TaskUpdate' && i.taskId != null) {
    const t = list.find((x) => x.id === String(i.taskId));
    if (!t) return false;
    if (i.status === 'deleted') { all.set(id, list.filter((x) => x !== t)); return true; }
    if (status(i.status)) t.status = i.status;
    if (i.subject) t.text = String(i.subject);
    if (i.activeForm) t.doing = String(i.activeForm);
    return true;
  }
  return false;
}

// One step it took, said after the fact: "Edited face.js", "Ran npm test".
// Nothing for the ones that show up some other way (questions, plans,
// helpers get their own slime) or say nothing (its own bookkeeping).
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || 'a file';
const short = (t, n = 60) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
function stepText(tool, input) {
  const i = input && typeof input === 'object' ? input : {};
  switch (tool) {
    case 'Read': return 'Read ' + base(i.file_path);
    case 'Edit': case 'MultiEdit': return 'Edited ' + base(i.file_path);
    case 'Write': return 'Wrote ' + base(i.file_path);
    case 'NotebookEdit': return 'Edited ' + base(i.notebook_path);
    case 'Grep': return `Searched for “${short(i.pattern, 30)}”`;
    case 'Glob': return 'Looked for ' + short(i.pattern, 40);
    case 'WebSearch': return 'Searched the web: ' + short(i.query, 40);
    case 'WebFetch': try { return 'Read ' + new URL(i.url).hostname; } catch { return 'Read a web page'; }
    case 'Bash': case 'PowerShell': return i.description ? short(i.description) : 'Ran ' + short(i.command, 50);
    case 'Agent': case 'Task': return i.description ? 'Helper finished: ' + short(i.description, 45) : 'A helper finished';
    case 'AskUserQuestion': case 'ExitPlanMode': case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList': case 'TaskGet': case 'ToolSearch': return '';
    default: return String(tool || '').startsWith('mcp__') ? 'Used ' + toolName(tool) : tool ? 'Used ' + tool : '';
  }
}

// What you'd have seen in the terminal for a step, for when you open it:
// the change an edit made, the command and the end of what it printed, or
// what went wrong. Kept short; the log holds a lot of these.
const DETAIL = 1500;
function stepDetail(payload) {
  const i = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const r = payload.tool_response;
  const tail = (t) => { t = String(t || '').replace(/\s+$/, ''); return t.length > DETAIL ? '…' + t.slice(-DETAIL) : t; };
  const head = (t) => { t = String(t || ''); return t.length > DETAIL ? t.slice(0, DETAIL) + '…' : t; };
  const printed = () => {
    if (typeof r === 'string') return r;
    if (!r || typeof r !== 'object') return '';
    return [r.stdout, r.stderr].filter((x) => typeof x === 'string' && x.trim()).join('\n') || (typeof r.output === 'string' ? r.output : '');
  };
  const failed = payload.hook_event_name === 'PostToolUseFailure' ? String(payload.error || printed() || '') : '';
  const tool = payload.tool_name;
  if (tool === 'Edit' && typeof i.new_string === 'string') {
    const lines = (t, mark) => String(t || '').trim().split('\n').map((l) => mark + ' ' + l).join('\n');
    return head([lines(i.old_string, '−'), lines(i.new_string, '+')].filter((x) => x.length > 2).join('\n') + (failed ? '\n\n' + failed : ''));
  }
  if (tool === 'MultiEdit' && Array.isArray(i.edits)) return head(i.edits.map((e) => `− ${String(e.old_string || '').trim()}\n+ ${String(e.new_string || '').trim()}`).join('\n\n'));
  if (tool === 'Write' && typeof i.content === 'string') return head(i.content);
  if (tool === 'Bash' || tool === 'PowerShell') return tail(`$ ${i.command || ''}\n${failed || printed()}`);
  return failed ? tail(failed) : '';
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

module.exports = { Inbox, frame, describe, toolName, alwaysLabel, stepText, stepDetail, turnOf, failedTests, stoppedLast, erredLast, runFailed, STYLE };
