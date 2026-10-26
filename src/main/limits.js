// How much of your Claude usage limits you've used, as Claude Code reports
// it to sessions Blaube started (stream-json `rate_limit_event`): what
// `/usage` would tell you in the terminal. The limits are your account's,
// so one session's report holds for all of them.

const WINDOWS = { five_hour: '5 hours', seven_day: 'the week', seven_day_opus: 'the week (Opus)', seven_day_sonnet: 'the week (Sonnet)' };

// Claude Code's rate_limit_info, tidied: { status, windows: [{ kind, used, resetsAt }] }
// (used 0..1, resetsAt in ms), or null if there's nothing in it.
function read(info) {
  if (!info || typeof info !== 'object') return null;
  const windows = [];
  const add = (kind, w) => {
    if (!w || typeof w.utilization !== 'number' || windows.some((x) => x.kind === kind)) return;
    windows.push({ kind, used: Math.max(0, Math.min(1, w.utilization)), resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : 0, status: String(w.status || '') });
  };
  for (const [kind, w] of Object.entries(info.unifiedWindows || {})) add(kind, w);
  if (info.rateLimitType) add(info.rateLimitType, info);
  if (!windows.length && !info.status) return null;
  windows.sort((a, b) => (a.kind === 'five_hour' ? -1 : b.kind === 'five_hour' ? 1 : 0));
  return { status: String(info.status || ''), windows };
}

// "3pm", "3:30pm", or "Fri" once it's more than a day away.
function when(at, now) {
  const d = new Date(at);
  if (at - now > 24 * 3600e3) return d.toLocaleDateString('en-US', { weekday: 'short' });
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
}

// Windows that haven't reset since the report (a reset one is back to 0).
const live = (lim, now) => (lim ? lim.windows.filter((w) => !w.resetsAt || w.resetsAt > now) : []);

// For the overview: "Usage: 46% of 5 hours (resets 3pm) · 79% of the week (resets Fri)".
function line(lim, now = Date.now()) {
  const ws = live(lim, now);
  if (!ws.length) return '';
  return 'Usage: ' + ws.map((w) => `${Math.round(w.used * 100)}% of ${WINDOWS[w.kind] || w.kind.replace(/_/g, ' ')}${w.resetsAt ? ` (resets ${when(w.resetsAt, now)})` : ''}`).join(' · ');
}

// Under the field, only once it's worth knowing (75% or more, or limited):
// "79% of the week used" / "5-hour limit reached · resets 3pm".
function warn(lim, now = Date.now()) {
  const ws = live(lim, now).filter((w) => w.used >= 0.75 || w.status === 'rejected');
  if (!ws.length) return '';
  const w = ws.slice().sort((a, b) => (b.status === 'rejected') - (a.status === 'rejected') || b.used - a.used)[0];
  const name = WINDOWS[w.kind] || w.kind.replace(/_/g, ' ');
  if (w.status === 'rejected' || w.used >= 1) return `${w.kind === 'five_hour' ? '5-hour' : 'Weekly'} limit reached${w.resetsAt ? ` · resets ${when(w.resetsAt, now)}` : ''}`;
  return `${Math.round(w.used * 100)}% of ${name} used`;
}

// The same, from Claude Code's answer to get_usage (rate_limits: windows of
// { utilization 0..100, resets_at ISO }), or null without plan limits.
function fromUsage(rl) {
  if (!rl || typeof rl !== 'object') return null;
  const windows = [];
  for (const kind of Object.keys(WINDOWS)) {
    const w = rl[kind];
    if (!w || typeof w.utilization !== 'number') continue;
    const used = Math.max(0, Math.min(1, w.utilization / 100));
    const at = w.resets_at ? Date.parse(w.resets_at) : NaN;
    windows.push({ kind, used, resetsAt: Number.isFinite(at) ? at : 0, status: used >= 1 ? 'rejected' : 'allowed' });
  }
  return windows.length ? { status: windows.some((w) => w.status === 'rejected') ? 'rejected' : 'allowed', windows } : null;
}

// When a usage limit it hit lifts: from what Blaube last heard of your
// limits, or else from Claude Code's words ("5-hour limit reached ∙ resets
// 3pm", "…will reset at 3:30pm (Europe/Oslo)"), as your local time. 0 if
// it doesn't say.
function liftsAt(lim, text, now = Date.now()) {
  const out = live(lim, now).filter((w) => (w.status === 'rejected' || w.used >= 1) && w.resetsAt);
  if (out.length) return Math.max(...out.map((w) => w.resetsAt));
  const m = /\breset(?:s)?(?: at)? (\d{1,2})(?::(\d\d))?\s*(am|pm)\b/i.exec(String(text || ''));
  if (!m || !/limit/i.test(text)) return 0;
  const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  const d = new Date(now);
  d.setHours(h, Number(m[2] || 0), 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1); // (that time tomorrow)
  return d.getTime();
}

// Worth a notification: a limit that just got to 90%, or ran out. Once per
// window, per level (`told`: what's been said, kept by the caller). Returns
// { title, body } or null.
function news(lim, told, now = Date.now()) {
  for (const w of live(lim, now)) {
    const out = w.status === 'rejected' || w.used >= 1;
    if (!out && w.used < 0.9) continue;
    const key = `${w.kind}@${w.resetsAt}@${out ? 'out' : '90'}`;
    if (told.has(key)) continue;
    told.add(key);
    const name = w.kind === 'five_hour' ? '5-hour' : WINDOWS[w.kind] && w.kind !== 'seven_day' ? `weekly (${WINDOWS[w.kind].replace(/.*\((.*)\)/, '$1')})` : 'weekly';
    const resets = w.resetsAt ? `It resets ${when(w.resetsAt, now)}.` : '';
    return out
      ? { title: `Your ${name} limit is used up`, body: `${resets} Sessions can carry on by themselves then (Carry on at… in their box).`.trim() }
      : { title: `${Math.round(w.used * 100)}% of your ${name} limit used`, body: resets || 'Your sessions stop when it runs out.' };
  }
  return null;
}

module.exports = { read, fromUsage, line, warn, when, liftsAt, news };
