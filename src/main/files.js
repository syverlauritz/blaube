// A session's files, for "@" in the talk box (as in the terminal): typing
// @tax suggests src/tax.js. Read with git where it's a repository (so
// ignored files stay out), else a quick walk of the folder.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const MAX = 20000;
const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'out', 'target', '.venv', 'venv', '__pycache__', '.cache']);

// Up to MAX paths under `dir` (relative, with /), a few folders deep.
function walk(dir, depth = 6) {
  const out = [];
  const go = (d, rel, n) => {
    if (out.length >= MAX || n > depth) return;
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (out.length >= MAX) return;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) go(path.join(d, e.name), rel + e.name + '/', n + 1); }
      else if (e.isFile()) out.push(rel + e.name);
    }
  };
  go(dir, '', 0);
  return out;
}

const cache = new Map(); // cwd -> { at, list }
function list(cwd, cb, now = Date.now()) {
  const hit = cache.get(cwd);
  if (hit && now - hit.at < 10000) return cb(hit.list);
  const done = (l) => { cache.set(cwd, { at: Date.now(), list: l }); cb(l); };
  // (Paths from git are relative to cwd, as Claude reads them.)
  execFile('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd, timeout: 3000, maxBuffer: 32e6, windowsHide: true }, (err, out) => {
    if (err) return done(walk(cwd));
    done([...new Set(String(out).split('\0').filter(Boolean))].slice(0, MAX));
  });
}

// The best `n` of `paths` for what's typed after @: a name that starts with
// it first, then names that have it, then paths that have it, then paths
// with its letters in order. Shorter paths first among equals.
function match(paths, q, n = 8) {
  q = String(q || '').toLowerCase();
  const scored = [];
  for (const p of paths) {
    const low = p.toLowerCase();
    const name = low.slice(low.lastIndexOf('/') + 1);
    let score;
    if (!q) score = 4 - Math.min(3, (low.match(/\//g) || []).length); // nothing typed: the top of the project
    else if (name.startsWith(q)) score = 40;
    else if (name.includes(q)) score = 30;
    else if (low.startsWith(q)) score = 25;
    else if (low.includes(q)) score = 20;
    else {
      let i = 0;
      for (const ch of low) if (ch === q[i]) i++;
      if (i < q.length) continue;
      score = 10;
    }
    scored.push([score, p]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length || (a[1] < b[1] ? -1 : 1));
  return scored.slice(0, n).map((s) => s[1]);
}

module.exports = { list, match, walk };
