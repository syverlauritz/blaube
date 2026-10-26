// Whether Claude Code is signed in, and signing it in without a terminal:
// `claude auth status` and `claude auth login` (it opens your browser, as
// /login does). Neither calls a model.
const { execFile, spawn } = require('node:child_process');
const { claudeEnv } = require('./claudeEnv');

// Claude Code's words when it isn't signed in (or its sign-in ran out).
const SIGNED_OUT = /run \/login|not logged in|please log ?in|invalid api key|oauth token (?:has )?(?:expired|been revoked)|authentication_error|invalid bearer token/i;
const signedOut = (text) => SIGNED_OUT.test(String(text || ''));

const quiet = (env) => claudeEnv(env || process.env); // (no API key: it's your Claude login that's asked about)

// cb(true: signed in | false: signed out | null: couldn't tell).
function status(bin, cb) {
  if (!bin) return cb(null);
  execFile(bin, ['auth', 'status', '--json'], { timeout: 15000, encoding: 'utf8', env: quiet(), windowsHide: true }, (err, out) => {
    let r = null;
    try { r = JSON.parse(String(out || '').trim()); } catch { /* not JSON */ }
    cb(r && typeof r.loggedIn === 'boolean' ? r.loggedIn : null);
  });
}

// Signs in (your browser opens). onUrl(url): the page it says to open, if
// it says one (for when no browser opened). cb(ok, why not). Given up on
// after `timeout` (5 minutes).
function login(bin, cb, onUrl = () => {}, timeout = 5 * 60e3) {
  if (!bin) return cb(false, 'Claude Code isn’t installed');
  let p;
  try { p = spawn(bin, ['auth', 'login'], { env: quiet(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { return cb(false, e.message); }
  let said = '', url = '', over = false;
  const finish = (ok, why) => { if (over) return; over = true; clearTimeout(timer); cb(ok, why); };
  const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } finish(false, 'It wasn’t finished in time'); }, timeout);
  const read = (d) => {
    said = (said + d).slice(-4000);
    const m = !url && /https:\/\/\S+/.exec(said);
    if (m) { url = m[0].replace(/[).,]+$/, ''); onUrl(url); }
  };
  p.stdout.setEncoding('utf8'); p.stdout.on('data', read);
  p.stderr.setEncoding('utf8'); p.stderr.on('data', read);
  p.stdin.on('error', () => {});
  p.on('error', (e) => finish(false, e.message));
  p.on('close', (code) => finish(code === 0, code === 0 ? '' : said.trim().split('\n').filter(Boolean).pop() || 'It didn’t sign in'));
  return p;
}

module.exports = { signedOut, status, login };
