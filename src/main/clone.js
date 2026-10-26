// "Clone a repository…" when starting a session: git clone, then a session
// in it, instead of a terminal for the clone.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

// What you pasted, as something git can clone, and the folder name it
// gets: { url, name }, or null. owner/repo means GitHub.
function parse(text) {
  const t = String(text || '').trim();
  let m = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(t);
  if (m && !t.startsWith('.')) return { url: `https://github.com/${m[1]}/${m[2]}.git`, name: m[2], gh: `${m[1]}/${m[2]}` };
  m = /^(?:https?|ssh|git|file):\/\/[^\s'"`]+?\/([\w.-]+?)(?:\.git)?\/?$/.exec(t);
  const hub = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(t);
  if (m) return Object.assign({ url: t, name: m[1] }, hub ? { gh: `${hub[1]}/${hub[2]}` } : {});
  m = /^[\w.-]+@[\w.-]+:[\w./-]*?([\w.-]+?)(?:\.git)?$/.exec(t);
  if (m) return { url: t, name: m[1] };
  return null;
}

// A folder for it in `parent` that isn't taken: repo, repo-2, repo-3...
function destFor(parent, name) {
  const base = name.replace(/^\.+/, '') || 'repo';
  for (let n = 1; n < 100; n++) {
    const p = path.join(parent, n === 1 ? base : `${base}-${n}`);
    if (!fs.existsSync(p)) return p;
  }
  return null;
}

// cb(error message or '', dest). `gh`: owner/repo on GitHub, cloned with
// the GitHub CLI's sign-in when git has none for it (a private one).
const NEEDS_SIGN_IN = /could not read Username|Authentication failed|terminal prompts disabled|Repository not found/i;
function clone(url, dest, cb, { run = execFile, timeout = 10 * 60e3, gh = '' } = {}) {
  run('git', ['clone', '--', url, dest], { timeout, windowsHide: true, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) }, (err, _out, errOut) => {
    if (!err) return cb('', dest);
    if (gh && NEEDS_SIGN_IN.test(String(errOut || ''))) {
      return run('gh', ['repo', 'clone', gh, dest], { timeout, windowsHide: true }, (err2) => {
        if (!err2) return cb('', dest);
        cb(`${gh} needs you signed in to GitHub (it may be private): sign in with the GitHub CLI, or paste its SSH address (git@github.com:${gh}.git)`, dest);
      });
    }
    const lines = String(errOut || err.message || '').trim().split('\n').filter((l) => l && !/^Cloning into/.test(l));
    const said = lines.find((l) => /^fatal:/.test(l)) || lines.pop() || 'git couldn’t clone it';
    cb(said.replace(/^fatal:\s*/, ''), dest);
  });
}

module.exports = { parse, destFor, clone };
