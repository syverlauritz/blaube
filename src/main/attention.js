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
function glance({ state, doing = '', message = '', lastReply = '', todo = null, context = 0, git = '', turnStart = 0, now = Date.now() }) {
  const clip = (t, n = 80) => { t = String(t || '').replace(/[`*_#>]+/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const mins = turnStart ? Math.floor((now - turnStart) / 60000) : 0;
  const status = state === 'waiting' ? `Needs you${message ? ': ' + clip(message, 70) : ''}`
    : state === 'working' ? `${doing ? clip(doing, 60) : 'Working'}${mins >= 1 ? ` · ${mins}m` : ''}`
    : state === 'done' ? `Done${lastReply ? ': ' + clip(lastReply, 70) : ''}`
    : lastReply ? clip(lastReply, 80) : 'Idle';
  const meta = [todo && todo.of ? `${todo.done} of ${todo.of} on its list` : '', context >= 50 ? `${context}% context` : '', git].filter(Boolean).join(' · ');
  return { status, meta };
}

module.exports = { mostWanted, notification, glance };
