// A project's own scripts (package.json), run from its box: a dev server
// or a watcher keeps running in the background, Blaube's own, with what it
// prints a tap away and Open for where it's up; anything else runs as a
// step. No terminal tab left open for `npm run dev`.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { localUrl } = require('./taskOutput');

// The ones that keep running (a server, a watcher), by their name.
const LONG = /^(dev|start|serve|preview|watch|storybook)(:|$)|[:-](dev|serve|watch|start)$/; // (and `make run`? It may end: only Cargo's and Go's run are taken as long)
const NAME = /^[\w][\w:.@/-]{0,79}$/; // (what goes in the command: nothing a shell reads)

// Its scripts, the usual ones first: [{ name, long, command }], or []:
// package.json's, then a Makefile's targets, then Cargo's or Go's own, and
// `docker compose up` beside a compose file.
const COMPOSE = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];
const MANIFESTS = ['package.json', 'Makefile', 'makefile', 'Cargo.toml', 'go.mod', ...COMPOSE];
const seen = new Map(); // cwd -> { mtime, list } (read again only once one of them changes)
function scripts(cwd) {
  const mtime = MANIFESTS.map((f) => { try { return fs.statSync(path.join(cwd, f)).mtimeMs; } catch { return 0; } }).join();
  const hit = seen.get(cwd);
  if (hit && hit.mtime === mtime) return hit.list;
  const list = /[1-9]/.test(mtime) ? readAll(cwd) : [];
  seen.set(cwd, { mtime, list });
  if (seen.size > 100) seen.delete(seen.keys().next().value);
  return list;
}
function readAll(cwd) {
  const has = (f) => { try { return fs.statSync(path.join(cwd, f)).isFile(); } catch { return false; } };
  const out = has('package.json') ? readScripts(cwd) : [];
  const add = (name, command, long) => { if (out.length < 10 && NAME.test(name) && !out.some((x) => x.name === name)) out.push({ name, long, command }); };
  for (const mk of ['Makefile', 'makefile']) if (has(mk)) { for (const t of makeTargets(cwd, mk)) add(t, `make ${t}`, LONG.test(t)); break; }
  if (has('Cargo.toml')) { add('run', 'cargo run', true); add('test', 'cargo test', false); add('build', 'cargo build', false); }
  if (has('go.mod')) { add('run', 'go run .', true); add('test', 'go test ./...', false); add('build', 'go build ./...', false); }
  if (COMPOSE.some(has)) add('up', 'docker compose up', true); // (its containers, kept running; Stop stops them)
  return out;
}
// A Makefile's own targets (not its special or pattern ones), in order.
function makeTargets(cwd, file) {
  let text = '';
  try { text = fs.readFileSync(path.join(cwd, file), 'utf8').slice(0, 200e3); } catch { return []; }
  const out = [];
  for (const m of text.matchAll(/^([A-Za-z0-9][\w.-]*)\s*:(?![:=])/gm)) if (!out.includes(m[1]) && !/\.(o|c|h|PHONY)$/.test(m[1])) out.push(m[1]);
  return out.slice(0, 10);
}
function readScripts(cwd) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')); } catch { return []; }
  const all = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? Object.keys(pkg.scripts).filter((n) => NAME.test(n) && !/^(pre|post)/.test(n)) : [];
  const rank = (n) => { const i = ['dev', 'start', 'test', 'build', 'serve', 'preview', 'lint', 'watch'].indexOf(n); return i < 0 ? 99 : i; };
  const pm = manager(cwd);
  return all.sort((a, b) => rank(a) - rank(b)).slice(0, 10).map((name) => ({ name, long: LONG.test(name), command: `${pm} run ${name}` }));
}
// npm, unless its lockfile says otherwise.
function manager(cwd) {
  const has = (f) => { try { return fs.existsSync(path.join(cwd, f)); } catch { return false; } };
  return has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
}

// Whether its packages need installing: its node_modules is missing, or
// older than its lockfile (a pull brought new ones); or uv's .venv is missing. The command that
// installs them (`npm install`), or ''. Only where its lockfile is (not
// a package inside a workspace, whose packages are installed above it).
const LOCKS = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' };
const MARKS = { npm: '.package-lock.json', pnpm: '.modules.yaml', yarn: '.yarn-integrity' };
function needsInstall(cwd) {
  const mtime = (f) => { try { return fs.statSync(path.join(cwd, f)).mtimeMs; } catch { return 0; } };
  // (A Python project uv keeps: its .venv missing, a fresh clone. Whether
  // one is behind uv.lock can't be told from the outside: uv sync then.)
  if (mtime('uv.lock')) return mtime(path.join('.venv', 'pyvenv.cfg')) ? '' : 'uv sync';
  const pm = manager(cwd);
  const lock = pm === 'bun' ? Math.max(mtime('bun.lockb'), mtime('bun.lock')) : mtime(LOCKS[pm]);
  if (!lock) return '';
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')); } catch { return ''; }
  const deps = (k) => pkg && pkg[k] && typeof pkg[k] === 'object' ? Object.keys(pkg[k]).length : 0;
  if (!deps('dependencies') && !deps('devDependencies')) return '';
  const nm = mtime('node_modules');
  const mark = (MARKS[pm] && mtime(path.join('node_modules', MARKS[pm]))) || (pm === 'yarn' && mtime(path.join('node_modules', '.yarn-state.yml'))) || nm;
  return !nm || lock > mark + 1000 ? `${pm} install` : '';
}

// The ones running: id -> { id, session, cwd, name, command, out, url, proc }.
const KEEP = 64 << 10;
const running = new Map();
const events = new EventEmitter();
let next = 1;
function start(session, cwd, name, { platform = process.platform } = {}) {
  const s = scripts(cwd).find((x) => x.name === name);
  if (!s) return null;
  for (const r of running.values()) if (r.cwd === cwd && r.name === name) return r; // (already running)
  const win = platform === 'win32';
  const shell = process.env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  let proc;
  try {
    proc = win
      ? spawn('cmd.exe', ['/d', '/s', '/c', s.command], { cwd, windowsHide: true })
      : spawn(shell, ['-lc', s.command], { cwd, detached: true, env: Object.assign({}, process.env, { FORCE_COLOR: '0', BROWSER: 'none' }) });
  } catch { return null; }
  const r = { id: `run:${next++}`, session, cwd, name, command: s.command, out: '', url: '', proc, at: Date.now() };
  running.set(r.id, r);
  const keep = (d) => {
    r.out += d;
    if (r.out.length > KEEP * 2) r.out = r.out.slice(-KEEP);
    if (!r.url) { const u = localUrl(r.out.slice(0, 16 << 10)); if (u) { r.url = u; events.emit('url', r); } }
  };
  proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', keep); proc.stderr.on('data', keep);
  const end = (code) => {
    if (!running.has(r.id)) return;
    running.delete(r.id);
    r.code = code;
    events.emit('exit', r);
  };
  proc.on('error', (e) => { keep(e.message); end(1); });
  proc.on('close', (code, signal) => end(r.stopped ? 0 : code == null ? (signal ? 1 : 0) : code));
  return r;
}
function stop(id) {
  const r = running.get(id);
  if (!r) return false;
  r.stopped = true;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(r.proc.pid), '/T', '/F'], { windowsHide: true });
  else try { process.kill(-r.proc.pid, 'SIGTERM'); } catch { /* gone */ }
  return true;
}
function stopAll(session) { for (const r of [...running.values()]) if (!session || r.session === session) stop(r.id); }
const sessions = () => [...new Set([...running.values()].map((r) => r.session))];
// For its box: [{ id, label, command, url, mine }].
function list(session) {
  return [...running.values()].filter((r) => r.session === session).map((r) => ({ id: r.id, label: r.name, command: r.command, url: r.url, mine: true }));
}
function output(id) {
  const r = running.get(id);
  if (!r) return null;
  const text = r.out.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r(?!\n)/g, '\n');
  const cut = text.length > 16 << 10;
  return { text: (cut ? text.slice(text.indexOf('\n', text.length - (16 << 10)) + 1) : text).replace(/\s+$/, ''), exited: null, cut };
}
// Its last line that says something, for "stopped" notes.
function lastLine(text) { return String(text || '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').split('\n').map((l) => l.trim()).filter(Boolean).pop() || ''; }

module.exports = { needsInstall, scripts, manager, start, stop, stopAll, sessions, list, output, lastLine, events, LONG };
