// Your code editor, to open a session's file in at the line a reply names
// (or its whole folder), as `code -g file:42` would from a terminal. The
// first one installed of VS Code, Cursor, Windsurf and Zed; none: ''.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// [{ name, bin, kind }]: where each one's command line tool is, on this system.
function candidates(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'darwin') {
    const apps = ['/Applications', path.join(home, 'Applications')];
    const out = [];
    for (const dir of apps) {
      out.push({ name: 'VS Code', bin: path.join(dir, 'Visual Studio Code.app/Contents/Resources/app/bin/code'), kind: 'code' });
      out.push({ name: 'Cursor', bin: path.join(dir, 'Cursor.app/Contents/Resources/app/bin/cursor'), kind: 'code' });
      out.push({ name: 'Windsurf', bin: path.join(dir, 'Windsurf.app/Contents/Resources/app/bin/windsurf'), kind: 'code' });
      out.push({ name: 'Zed', bin: path.join(dir, 'Zed.app/Contents/MacOS/cli'), kind: 'zed' });
    }
    return out;
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      { name: 'VS Code', bin: path.join(local, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'), kind: 'code' },
      { name: 'Cursor', bin: path.join(local, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'), kind: 'code' },
    ];
  }
  const bins = ['/usr/bin', '/usr/local/bin', '/snap/bin', path.join(home, '.local', 'bin')];
  const out = [];
  for (const [name, exe, kind] of [['VS Code', 'code', 'code'], ['Cursor', 'cursor', 'code'], ['Windsurf', 'windsurf', 'code'], ['Zed', 'zed', 'zed']]) for (const d of bins) out.push({ name, bin: path.join(d, exe), kind });
  return out;
}

// The one to use (the first installed), or null. `over`: a stand-in (tests).
function find(opts = {}) {
  if (opts.over !== undefined) return opts.over;
  return candidates(opts.platform, opts.home, opts.env).find((c) => isFile(c.bin)) || null;
}

// What it's run with to open `target` (at `line`, for a file).
function args(ed, target, line = 0) {
  const at = line > 0 ? `${target}:${Math.floor(line)}` : target;
  if (ed.kind === 'zed') return [at];
  return line > 0 ? ['-g', at] : [target];
}

// cb(error or '').
function open(ed, target, line, cb = () => {}, { run = execFile } = {}) {
  if (!ed) return cb('No code editor found');
  const win = ed.bin.endsWith('.cmd');
  const a = args(ed, target, line);
  // (A .cmd needs cmd.exe; its arguments are paths Blaube checked, quoted.)
  if (win) return run('cmd.exe', ['/d', '/s', '/c', `"${[ed.bin, ...a].map((x) => `"${String(x).replace(/"/g, '')}"`).join(' ')}"`], { windowsHide: true, windowsVerbatimArguments: true, timeout: 15000 }, (err) => cb(err ? err.message : ''));
  run(ed.bin, a, { timeout: 15000 }, (err) => cb(err ? err.message : ''));
}

module.exports = { candidates, find, args, open };
