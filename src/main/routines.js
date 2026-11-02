// Things you asked for once, done again by themselves on a schedule ("every
// weekday at 9: look over my open PRs"): each time, a fresh session starts
// in the folder with what you said, while Blaube is open. One missed
// (Blaube closed, the computer asleep) runs once when it's back, not once
// per time it missed.
//
// A routine: { id, cwd, prompt, every: 'hour' | 'day' | 'weekdays', at:
// 'HH:MM' (not for 'hour'), model, created, last }.
const EVERY = ['hour', 'day', 'weekdays'];
const HOUR = 3600e3;

function valid(r) {
  return !!r && typeof r.cwd === 'string' && !!r.cwd && typeof r.prompt === 'string' && !!r.prompt.trim()
    && EVERY.includes(r.every) && (r.every === 'hour' || /^([01]\d|2[0-3]):[0-5]\d$/.test(r.at || ''));
}

// When it's next due after `after` (ms), in local time.
function next(r, after) {
  if (r.every === 'hour') return after + HOUR;
  const [h, m] = r.at.split(':').map(Number);
  const d = new Date(after);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= after) d.setDate(d.getDate() + 1);
  if (r.every === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Is it time? (Since it last ran, or since it was made.)
function due(r, now) {
  return valid(r) && now >= next(r, r.last || r.created || now);
}

// "every day at 09:00", "weekdays at 17:30", "every hour"
function when(r) {
  if (r.every === 'hour') return 'every hour';
  return `${r.every === 'weekdays' ? 'weekdays' : 'every day'} at ${r.at}`;
}

// "today 09:00", "tomorrow 09:00", "Mon 09:00", or "in 40m" (within the hour).
function nextLabel(r, now) {
  const at = next(r, r.last || r.created || now);
  const t = Math.max(at, now);
  if (t - now < HOUR) return `in ${Math.max(1, Math.round((t - now) / 60e3))}m`;
  const d = new Date(t), today = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86400e3);
  if (days === 0) return `today ${hm}`;
  if (days === 1) return `tomorrow ${hm}`;
  return `${d.toLocaleDateString('en', { weekday: 'short' })} ${hm}`;
}

function make({ cwd, prompt, every, at, model }, now = Date.now()) {
  const r = { id: 'r' + now.toString(36) + Math.random().toString(36).slice(2, 6), cwd, prompt: String(prompt || '').trim().slice(0, 20000), every, at: every === 'hour' ? '' : at, model: typeof model === 'string' && /^[\w.\-[\]]{1,60}$/.test(model) ? model : '', created: now, last: 0 };
  return valid(r) ? r : null;
}

module.exports = { EVERY, valid, next, due, when, nextLabel, make };
