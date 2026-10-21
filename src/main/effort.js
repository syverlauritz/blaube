// Works out a session's effort level (low / medium / high / xhigh). Claude
// Code doesn't put it in hook payloads, but each API request it logs to the
// session transcript carries `params.output_config.effort`, so we read the
// newest one from the end of the transcript. Falls back to `effortLevel` in
// ~/.claude/settings.json.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LEVELS = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };
const TAIL_BYTES = 256 * 1024;
const MIN_REREAD_MS = 2000;

const cache = new Map(); // transcript path -> { mtimeMs, readAt, effort }

function normalize(v) {
  return LEVELS[String(v || '').toLowerCase()] || '';
}

// Where Claude Code keeps a session's transcript when the hook didn't say.
function transcriptFor(sessionId, cwd, home = os.homedir()) {
  if (!sessionId || !cwd) return '';
  return path.join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
}

// The effort of the newest API request in a chunk of transcript text.
function lastEffortIn(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.includes('"api-request"') || !l.includes('"effort"')) continue;
    try {
      const e = normalize(JSON.parse(l).params.output_config.effort);
      if (e) return e;
    } catch { /* partial or odd line */ }
  }
  return '';
}

function fromTranscript(file, now = Date.now()) {
  let st;
  try { st = fs.statSync(file); } catch { return ''; }
  const hit = cache.get(file);
  if (hit && (hit.mtimeMs === st.mtimeMs || now - hit.readAt < MIN_REREAD_MS)) return hit.effort;
  let effort = '';
  try {
    const fd = fs.openSync(file, 'r');
    const len = Math.min(TAIL_BYTES, st.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    effort = lastEffortIn(buf.toString('utf8'));
  } catch { /* unreadable */ }
  if (!effort && hit) effort = hit.effort;
  cache.set(file, { mtimeMs: st.mtimeMs, readAt: now, effort });
  return effort;
}

let settingsCache = { readAt: 0, effort: '' };
function fromSettings(now = Date.now()) {
  if (now - settingsCache.readAt < 10000) return settingsCache.effort;
  let effort = '';
  try {
    const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    effort = normalize(s.effortLevel);
  } catch { /* none */ }
  settingsCache = { readAt: now, effort };
  return effort;
}

// Best guess for a hook payload (or { session_id, cwd } from `claude agents`).
function effortFor(payload) {
  if (!payload) return '';
  return normalize(payload.effort || payload.effort_level)
    || fromTranscript(payload.transcript_path || transcriptFor(payload.session_id, payload.cwd))
    || fromSettings();
}

module.exports = { effortFor, lastEffortIn, normalize, transcriptFor };
