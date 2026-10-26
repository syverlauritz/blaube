// Which session wants you most (for the talk shortcut), and when a
// session is worth a system notification (the slimes can't be seen).

// Needs you first, then finished and not looked at yet, then the most
// recently busy. Demo slimes never.
function mostWanted(sessions) {
  const real = sessions.filter((s) => !String(s.id).startsWith('demo-'));
  const rank = (s) => (s.state === 'waiting' ? 0 : s.state === 'done' && !s.seen ? 1 : s.state === 'working' ? 2 : 3);
  real.sort((a, b) => rank(a) - rank(b) || (b.updatedAt || 0) - (a.updatedAt || 0));
  return real[0] || null;
}

// A notification for something that happened to a session, or null.
// `seen`: the slimes are where you can see them (in front of your windows),
// or you're talking to this one. Finishing counts only after a wait
// (`secs` of work); needing you always counts.
function notification({ event, project, title, text, secs = 0, seen = false, enabled = true }) {
  if (!enabled || seen) return null;
  const name = title || project || 'Claude';
  const short = (t, n = 140) => { t = String(t || '').replace(/[`*_#>]+/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  if (event === 'waiting') return { title: `${name} needs you`, body: short(text) || 'It’s waiting for your answer.' };
  if (event === 'done' && secs >= 20) return { title: `${name} is done`, body: short(text) || 'It finished its turn.' };
  return null;
}

// One session at a glance, for the overview: what it's up to (in words)
// and the small print (to-do progress, context, git).
function glance({ state, doing = '', message = '', lastReply = '', todo = null, context = 0, git = '', turnStart = 0, unread = 0, now = Date.now() }) {
  const clip = (t, n = 80) => { t = String(t || '').replace(/[`*_#>]+/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const mins = turnStart ? Math.floor((now - turnStart) / 60000) : 0;
  const status = state === 'waiting' ? `Needs you${message ? ': ' + clip(message, 70) : ''}`
    : state === 'working' ? `${doing ? clip(doing, 60) : 'Working'}${mins >= 1 ? ` · ${mins}m` : ''}`
    : state === 'done' ? `Done${lastReply ? ': ' + clip(lastReply, 70) : ''}`
    : lastReply ? clip(lastReply, 80) : 'Idle';
  const meta = [unread ? `${unread} new repl${unread === 1 ? 'y' : 'ies'} since you looked` : '', todo && todo.of ? `${todo.done} of ${todo.of} on its list` : '', context >= 50 ? `${context}% context` : '', git].filter(Boolean).join(' · ');
  return { status, meta };
}

// The day so far, across every session's log: replies, time Claude spent
// working on them, files changed. "Today" starts at local midnight.
function today(logs, now = Date.now()) {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  let replies = 0, worked = 0;
  const files = new Set();
  for (const log of logs) {
    for (const e of log) {
      if (e.who !== 'claude' || e.at < start) continue;
      replies++;
      if (e.turn) { worked += e.turn.took || 0; for (const f of e.turn.files || []) files.add(f); }
    }
  }
  if (!replies) return '';
  const m = Math.round(worked / 60e3);
  const time = m < 1 ? '' : m < 60 ? `${m}m of work` : `${Math.floor(m / 60)}h ${m % 60}m of work`;
  return ['Today: ' + `${replies} repl${replies === 1 ? 'y' : 'ies'}`, time, files.size ? `${files.size} file${files.size === 1 ? '' : 's'} changed` : ''].filter(Boolean).join(' · ');
}

module.exports = { mostWanted, notification, glance, today };
