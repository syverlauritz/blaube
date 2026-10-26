// What's waiting for you on GitHub, from the GitHub CLI you're signed in to:
// open issues assigned to you, pull requests someone asked you to review,
// and your own open pull requests (`gh search`). A tap in the overview starts a session on one.
// Blaube holds no token of its own; without gh it's just not shown.
const { execFile } = require('node:child_process');

const FIELDS = 'number,title,url,repository,updatedAt';
const URL = /^https:\/\/github\.com\/(\w[\w.-]*\/[\w.][\w.-]*)\/(issues|pull)\/(\d{1,7})$/;

// `gh search … --json` -> [{ kind, number, title, url, repo, at }].
function parse(text, kind) {
  let list;
  try { list = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.map((j) => {
    const m = j && URL.exec(String(j.url || ''));
    if (!m || (kind !== 'issue') !== (m[2] === 'pull')) return null;
    return { kind, number: Number(m[3]), title: String(j.title || '').replace(/\s+/g, ' ').trim().slice(0, 120), url: m[0], repo: m[1], at: Date.parse(j.updatedAt) || 0 };
  }).filter(Boolean);
}

// Reviews asked of you first, then your own pull requests, then your
// issues, newest first: at most 8.
// Asked at most every five minutes. cb(list).
let cache = null, asking = null;
function look(cb, { run = execFile, bin = '', now = Date.now(), fresh = 5 * 60e3 } = {}) {
  if (!bin) return cb([]);
  if (cache && now - cache.at < fresh) return cb(cache.list);
  if (asking) { asking.push(cb); return; }
  asking = [cb];
  const env = Object.assign({}, process.env, { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' });
  const WHO = { review: '--review-requested=@me', mine: '--author=@me', issue: '--assignee=@me' };
  const ask = (what, kind) => new Promise((done) => run(bin, ['search', what, WHO[kind], '--state=open', '--limit=10', '--json', FIELDS], { timeout: 15000, windowsHide: true, env }, (err, out) => done(err ? [] : parse(out, kind))));
  Promise.all([ask('prs', 'review'), ask('prs', 'mine'), ask('issues', 'issue')]).then(([reviews, mine, issues]) => {
    const by = (a, b) => b.at - a.at;
    const list = [...reviews.sort(by), ...mine.sort(by), ...issues.sort(by)].slice(0, 8);
    cache = { at: Date.now(), list };
    const waiting = asking;
    asking = null;
    for (const f of waiting) f(list);
  });
}
function forget() { cache = null; }

module.exports = { parse, look, forget };
