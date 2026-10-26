// While you were away: what happened in your sessions since you last used
// the computer, said once when you're back (so you needn't go round every
// terminal to find out).

// sessions: [{ id, project, title, state }]; logs: id -> log entries
// ({ who, at, turn }); since: when you went away. '' if nothing happened.
function recap(sessions, logs, since) {
  const name = (s) => s.title || s.project || 'A session';
  const real = sessions.filter((s) => !String(s.id).startsWith('demo-'));
  const finished = [], need = [];
  let replies = 0;
  const files = new Set();
  for (const s of real) {
    const fresh = (logs.get(s.id) || []).filter((e) => e.who === 'claude' && e.at >= since);
    replies += fresh.length;
    for (const e of fresh) for (const f of (e.turn && e.turn.files) || []) files.add(`${s.id}/${f}`);
    if (s.state === 'waiting') need.push(name(s));
    else if (fresh.length && (s.state === 'done' || s.state === 'idle')) finished.push(name(s));
  }
  if (!replies && !need.length) return '';
  const list = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, 2).join(', ')} and ${xs.length - 2} more`);
  return [
    finished.length ? `${list(finished)} finished` : '',
    need.length ? `${list(need)} need${need.length === 1 ? 's' : ''} you` : '',
    replies ? `${replies} repl${replies === 1 ? 'y' : 'ies'}` : '',
    files.size ? `${files.size} file${files.size === 1 ? '' : 's'} changed` : '',
  ].filter(Boolean).join(' · ');
}

module.exports = { recap };
