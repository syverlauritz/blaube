// A talk box conversation as Markdown: to save, share or paste somewhere.
// What you said and what Claude said, with what it did in between as a
// short list of steps, and a line for what each turn came to.

const pad = (n) => String(n).padStart(2, '0');
const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const base = (f) => String(f).split(/[\\/]/).pop();

function took(ms) {
  const m = Math.round(ms / 60e3);
  if (m < 1) return 'under a minute';
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// { project, cwd, log } -> Markdown text. `now` dates the header.
function toMarkdown({ project, cwd, log }, now = Date.now()) {
  const out = [`# ${project || 'Claude Code'}`, ''];
  out.push(`_${[cwd, `${day(now)} ${clock(now)}`].filter(Boolean).join(' · ')} · from Blaube_`, '');
  let steps = [];
  const flush = () => {
    if (!steps.length) return;
    out.push(...steps.map((s) => `- ${s.ok === false ? '✗ ' : ''}${s.text}`), '');
    steps = [];
  };
  let lastDay = day(now);
  for (const e of log || []) {
    if (e.who === 'step') { steps.push(e); continue; }
    flush();
    const when = e.at ? (day(e.at) === lastDay ? clock(e.at) : `${day(e.at)} ${clock(e.at)}`) : '';
    if (e.who === 'you') {
      const status = e.status === 'queued' ? ' (not sent yet)' : e.status === 'unsent' ? ' (not sent)' : '';
      out.push(`**You**${when ? ` · ${when}` : ''}${status}`, '', quote(e.text), '');
    } else if (e.who === 'claude') {
      out.push(`**Claude**${when ? ` · ${when}` : ''}`, '', String(e.text || '').trim(), '');
      const t = e.turn;
      const bits = [];
      if (t && t.took >= 60e3) bits.push(took(t.took));
      if (t && t.steps) bits.push(`${t.steps} step${t.steps === 1 ? '' : 's'}`);
      if (t && t.files && t.files.length) bits.push(`changed ${t.files.map((f) => `\`${base(f)}\``).join(', ')}`);
      if (bits.length) out.push(`_${bits.join(' · ')}_`, '');
    } else if (e.who === 'note') {
      out.push(`_${String(e.text || '').trim()}_`, '');
    }
  }
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// What you said, as a quote (so it reads apart from Claude's Markdown).
function quote(text) {
  return String(text || '').trim().split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
}

// A file name for it: "kalkis 2026-10-26.md".
function fileName(project, now = Date.now()) {
  const safe = String(project || 'conversation').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'conversation';
  return `${safe} ${day(now)}.md`;
}

module.exports = { toMarkdown, fileName };
