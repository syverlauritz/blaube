// Whether something typed in the talk box is a Claude Code slash command
// (/compact, /model opus, /my-plugin:thing) rather than a message that
// happens to start with a slash ("/api returns 500", "/tmp is full").
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUILT_IN = new Set(['add-dir', 'agents', 'btw', 'bug', 'clear', 'compact', 'config', 'context', 'cost', 'doctor', 'effort', 'exit', 'export', 'fast', 'help', 'hooks', 'init', 'login', 'logout', 'mcp', 'memory', 'model', 'output-style', 'permissions', 'plan', 'plugin', 'pr-comments', 'release-notes', 'rename', 'resume', 'review', 'rewind', 'security-review', 'skills', 'status', 'statusline', 'terminal-setup', 'todos', 'upgrade', 'usage', 'vim']);

// Your own commands: .md files in ~/.claude/commands and the project's
// .claude/commands (folders make "folder:name"). name -> file.
function custom(dir) {
  const out = new Map();
  const walk = (d, prefix) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + ':');
      else if (e.name.endsWith('.md')) {
        const f = path.join(d, e.name), n = e.name.slice(0, -3);
        out.set(prefix + n, f);
        if (!out.has(n)) out.set(n, f);
      }
    }
  };
  walk(dir, '');
  return out;
}
// Yours and the project's (the project's win).
function yours(cwd, home) {
  const mine = custom(path.join(home, '.claude', 'commands'));
  if (cwd) for (const [n, f] of custom(path.join(cwd, '.claude', 'commands'))) mine.set(n, f);
  return mine;
}

// The command's name if `text` is one, else ''.
function slashCommand(text, cwd = '', home = os.homedir()) {
  const m = /^\/([a-z][\w-]*(?::[\w-]+)*)(\s|$)/i.exec(String(text || '').trim());
  if (!m) return '';
  const name = m[1].toLowerCase();
  if (BUILT_IN.has(name) || name.includes(':')) return '/' + name; // a plugin's "plugin:command" too
  return yours(cwd, home).has(name) ? '/' + name : '';
}

// Your skills (yours, and the project's): [{ name, about, where }], from
// each skills/<name>/SKILL.md's description.
function skills(cwd = '', home = os.homedir()) {
  const out = [];
  for (const [dir, where] of [[cwd && path.join(cwd, '.claude', 'skills'), 'this project'], [path.join(home, '.claude', 'skills'), 'yours']]) {
    if (!dir) continue;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names.sort()) {
      let text = '';
      try { text = fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8').slice(0, 4000); } catch { continue; }
      const m = /^---\r?\n[\s\S]*?^description:\s*(.+)$/m.exec(text);
      if (!out.some((x) => x.name === n)) out.push({ name: n, about: m ? m[1].trim().replace(/^["']|["']$/g, '') : '', where });
    }
  }
  return out;
}

// What the box does with the built-in ones it handles itself, in words.
const ABOUT = {
  'add-dir': 'Another folder it may work in',
  agents: 'Opens the project’s agents folder',
  btw: 'A quick question on the side, while it works',
  bug: 'Reports a Claude Code bug on GitHub',
  clear: 'A fresh conversation, same slime',
  compact: 'Frees up its context',
  config: 'Opens your Claude Code settings',
  context: 'What fills its context',
  cost: 'How many tokens it has used',
  doctor: 'Checks your Claude Code install',
  export: 'Saves the conversation to Downloads',
  effort: 'How hard it thinks',
  help: 'What works here',
  init: 'Writes a CLAUDE.md for this project',
  review: 'Reviews a pull request',
  'pr-comments': 'The comments on its pull request',
  'security-review': 'Checks its changes for security problems',
  hooks: 'Opens the settings file hooks go in',
  exit: 'Ends it (a session Blaube started)',
  login: 'Signs Claude Code in, in your browser',
  logout: 'Signs Claude Code out',
  mcp: 'Its MCP servers, and how they are',
  memory: 'Opens the project’s CLAUDE.md',
  model: 'Switches its model',
  permissions: 'What it may do without asking',
  plan: 'Plans first, before changing anything',
  'release-notes': 'What’s new in Claude Code',
  plugin: 'Your Claude Code plugins',
  rename: 'Names this session',
  resume: 'Pick up a past session',
  skills: 'The skills it can use',
  status: 'What it’s running on',
  todos: 'Its to-do list',
  upgrade: 'Updates Claude Code',
  usage: 'How much of your limits you’ve used',
};

// Every command you could type, for "/" in the talk box: [{ name, mine,
// about }] (yours first), the ones starting with `q`.
function commandNames(q = '', cwd = '', home = os.homedir()) {
  q = String(q || '').toLowerCase();
  const mine = yours(cwd, home);
  const about = (f) => { try { const m = /^---\r?\n[\s\S]*?^description:\s*(.+)$/m.exec(fs.readFileSync(f, 'utf8').slice(0, 2000)); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; } catch { return ''; } };
  const out = [...mine.keys()].sort().filter((n) => !BUILT_IN.has(n) && n.toLowerCase().startsWith(q)).slice(0, 50).map((name) => ({ name, mine: true, about: about(mine.get(name)) }));
  for (const k of skills(cwd, home)) if (!BUILT_IN.has(k.name) && !mine.has(k.name) && k.name.toLowerCase().startsWith(q)) out.push({ name: k.name, mine: true, skill: true, about: k.about || 'A skill' });
  for (const name of [...BUILT_IN].sort()) out.push(Object.assign({ name, mine: false }, ABOUT[name] ? { about: ABOUT[name] } : {}));
  return out.filter((c) => c.name.toLowerCase().startsWith(q));
}

// "/release v2" for one of your skills, in a session in a terminal (where
// only Claude Code's own prompt can start one by name): the same ask, in
// words. '' when it isn't a skill.
function skillPrompt(text, cwd = '', home = os.homedir()) {
  const m = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  if (!m || BUILT_IN.has(m[1].toLowerCase()) || yours(cwd, home).has(m[1].toLowerCase())) return '';
  const k = skills(cwd, home).find((x) => x.name.toLowerCase() === m[1].toLowerCase());
  if (!k) return '';
  const rest = (m[2] || '').trim();
  return `Use your ${k.name} skill${rest ? ` for this: ${rest}` : '.'}`;
}

// Claude Code's own commands that are only a prompt (/init, /review...):
// the same ask in words, so a session in a terminal gets it without its
// terminal (one Blaube started takes the command itself). '' otherwise.
const ASKS = {
  init: 'Look through this codebase and write a CLAUDE.md at its root for future Claude Code sessions here: the commands to build, lint and test (and to run a single test), and the architecture that takes reading several files to understand. Keep it short and specific to this project, with no generic advice. If there is a CLAUDE.md already, improve it instead.',
  review: (args) => `Review ${args ? `pull request ${args}` : 'a pull request: if I haven’t named one, list the open ones with \`gh pr list\` and ask which'}. Read it with \`gh pr view\` and \`gh pr diff\`, then give a short, specific review: what it does, whether it’s correct, and any bugs, risks or missing tests, each with its file and line.`,
  'pr-comments': 'Fetch the comments on this branch’s GitHub pull request (`gh pr view --comments`, and the review comments with `gh api repos/{owner}/{repo}/pulls/{number}/comments`) and list them by file and line, with what each one asks for.',
  'security-review': 'Do a security review of the changes on this branch that aren’t on the main branch yet (git diff against it). Look for injection, mistakes in authentication and access checks, secrets in code, unsafe handling of input, and data exposure. Report only real, exploitable problems, each with its file and line, why it matters and how to fix it.',
};
function askInWords(text) {
  const m = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  const a = m && ASKS[m[1].toLowerCase()];
  if (!a) return '';
  const args = (m[2] || '').trim();
  return typeof a === 'function' ? a(args) : args ? `${a}\n\n${args}` : a;
}

// "/bug it hangs on start": a new Claude Code issue on GitHub, its title
// what you said, with its version and system filled in (nothing is sent
// until you send it there).
function bugUrl(text, version = '', system = `${process.platform} ${os.release()}`) {
  const said = String(text || '').trim().replace(/^\/bug\b\s*/i, '').slice(0, 300);
  const body = `${said ? said + '\n\n' : ''}**What happened**\n\n\n**What I expected**\n\n\n**Environment**\n- Claude Code: ${version || 'unknown'}\n- System: ${system}\n`;
  return `https://github.com/anthropics/claude-code/issues/new?${new URLSearchParams({ title: said.split('\n')[0].slice(0, 120), body })}`;
}

// One of your own commands is only a prompt: what it says, with what you
// typed after it in place of $ARGUMENTS ($1, $2... word by word), so it can
// go as a message without the terminal. '' when it isn't one of yours, or
// it runs shell commands first (!`...`), which only Claude Code can do.
function expand(text, cwd = '', home = os.homedir()) {
  const m = /^\/([a-z][\w-]*(?::[\w-]+)*)(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  if (!m) return '';
  if (BUILT_IN.has(m[1].toLowerCase())) return '';
  const mine = yours(cwd, home);
  const file = mine.get(m[1].toLowerCase()) || mine.get(m[1]);
  if (!file) return '';
  let body;
  try { body = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''); // (its settings)
  if (/!`/.test(body)) return '';
  const args = (m[2] || '').trim();
  const words = args ? args.split(/\s+/) : [];
  let used = false;
  body = body.replace(/\$ARGUMENTS|\$(\d)/g, (all, n) => { used = true; return n ? words[Number(n) - 1] || '' : args; });
  body = body.trim();
  if (args && !used) body += '\n\n' + args; // (as Claude Code does)
  return body;
}

// What a session Blaube started can do right away, without a terminal:
// /model sonnet switches its model, /plan makes it plan first. Returns {
// request } for Claude Code, { help } when something's missing, or null.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
function control(text) {
  const m = /^\/(model|plan|context|effort)(?:\s+(\S+))?\s*$/i.exec(String(text || '').trim());
  if (!m) return null;
  if (m[1].toLowerCase() === 'effort') {
    const level = (m[2] || '').toLowerCase();
    return EFFORTS.includes(level) ? { request: { subtype: 'apply_flag_settings', settings: { effortLevel: level } } } : { help: `Say how hard it should think: /effort ${EFFORTS.join(', /effort ')}.` };
  }
  if (m[1].toLowerCase() === 'context') return { request: { subtype: 'get_context_usage', detail: 'summary' } }; // (local estimates: no API calls)
  if (m[1].toLowerCase() === 'plan') return { request: { subtype: 'set_permission_mode', mode: 'plan' } };
  if (!m[2]) return { help: 'Say which: /model opus, /model sonnet or /model haiku (or a full model name).' };
  return { request: { subtype: 'set_model', model: m[2].toLowerCase() === 'default' ? 'default' : m[2] } };
}

// Claude Code's answer to get_context_usage, as the box shows it: "Context:
// 8% full (39.8k of 500k)" over a bar of what fills it, biggest first.
const kTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100e3 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));
function contextNote(r) {
  if (!r || !Array.isArray(r.categories) || !r.maxTokens) return null;
  const parts = r.categories.filter((c) => c && c.tokens > 0 && c.kind !== 'deferred').map((c) => ({ name: String(c.name || c.id), tokens: c.tokens, kind: c.kind === 'free' || c.kind === 'buffer' ? c.kind : 'used' }));
  parts.sort((a, b) => (a.kind === 'used' ? 0 : a.kind === 'buffer' ? 1 : 2) - (b.kind === 'used' ? 0 : b.kind === 'buffer' ? 1 : 2) || b.tokens - a.tokens);
  const used = r.totalTokens != null ? r.totalTokens : parts.filter((p) => p.kind === 'used').reduce((n, p) => n + p.tokens, 0);
  const pct = r.percentage != null ? Math.round(r.percentage) : Math.round(100 * used / r.maxTokens);
  return { text: `Context: ${pct}% full (${kTokens(used)} of ${kTokens(r.maxTokens)})`, context: { max: r.maxTokens, parts: parts.map((p) => Object.assign(p, { label: `${p.name} ${kTokens(p.tokens)}` })) } };
}

module.exports = { skills, skillPrompt, askInWords, bugUrl, slashCommand, commandNames, expand, control, contextNote, kTokens, EFFORTS };
