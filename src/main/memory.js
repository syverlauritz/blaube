// "# always use pnpm" in a session's box: a note for its project's
// CLAUDE.md, which every session there reads, as the terminal's # does.
const fs = require('node:fs');
const path = require('node:path');

// The note in a message, or '' if it isn't one ("# " and then words).
function noteIn(text) {
  const m = /^#\s+(\S[\s\S]*)$/.exec(String(text || '').trim());
  return m && !/^#/.test(m[1]) ? m[1].replace(/\s+/g, ' ').trim() : '';
}

// Adds it as a bullet at the end of <dir>/CLAUDE.md (made if there's
// none). Returns the file.
function remember(dir, note) {
  const file = path.join(dir, 'CLAUDE.md');
  let before = '';
  try { before = fs.readFileSync(file, 'utf8'); } catch { /* a new one */ }
  const gap = !before ? '' : before.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${gap}- ${note}\n`);
  return file;
}

// What a session reads first and what it has remembered on its own, as
// the terminal's /memory lists them, from the files themselves (where
// Claude Code's memory docs say they are): your CLAUDE.md in its config
// folder, then CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md in its
// folder and every folder above it; and its auto memory, the notes in the
// memory folder beside its transcript (each with a name and a line about
// it at the top). { reads: [paths], memories: [{ name, description }] }.
function whatItReads(cwd, configDir, transcript = '') {
  const reads = [];
  const add = (f) => { try { if (fs.statSync(f).isFile() && !reads.includes(f)) reads.push(f); } catch { /* not there */ } };
  if (configDir) add(path.join(configDir, 'CLAUDE.md'));
  const up = [];
  for (let d = path.resolve(cwd || '.'); ; d = path.dirname(d)) { up.unshift(d); if (path.dirname(d) === d) break; }
  for (const d of up) for (const f of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md']) add(path.join(d, f));
  const memories = [];
  const dir = transcript ? path.join(path.dirname(transcript), 'memory') : '';
  let names = [];
  try { names = dir ? fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'MEMORY.md').sort() : []; } catch { /* none yet */ }
  for (const n of names) {
    let head = '';
    try { head = fs.readFileSync(path.join(dir, n), 'utf8').slice(0, 2000); } catch { continue; }
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
    const field = (k) => { const m = front && new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(front[1]); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };
    memories.push({ name: field('name') || path.basename(n, '.md'), description: field('description') });
  }
  return { reads, memories };
}

module.exports = { noteIn, remember, whatItReads };
