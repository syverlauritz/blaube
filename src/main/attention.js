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

module.exports = { mostWanted, notification };
