// A name for a session Claude Code didn't name. Claude Code used to write a
// short title into each transcript ({ type: 'ai-title' }), but stopped
// (2.1.312 on, and never for sessions Blaube starts), leaving two sessions
// in one repo called the same. So Blaube asks Haiku for one, once, from
// what you first said, and writes it the way Claude Code would: everything
// that reads a session's title (and `claude --resume`) then has it. A
// /rename still beats it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { claudeEnv } = require('./claudeEnv');
const { prompt } = require('./transcript');
const { clean } = require('./rename');

const HEAD = 1 << 20; // bytes of a transcript looked through for what you first said

// What you first said in a transcript, or '' if nothing yet.
function firstPrompt(file) {
	let text = '';
	try {
		const fd = fs.openSync(file, 'r');
		try {
			const buf = Buffer.alloc(HEAD);
			text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD, 0));
		} finally { fs.closeSync(fd); }
	} catch { return ''; }
	for (const line of text.split('\n')) {
		if (!line.includes('"type":"user"')) continue;
		let e;
		try { e = JSON.parse(line); } catch { continue; } // (half a line, at the end)
		const p = prompt(e);
		if (p) return p;
	}
	return '';
}

const ask = (said) => 'Write a 2-5 word title for a coding task that starts with this message. ' +
	'Reply with the title only, no quotes or punctuation at the end.\n\nMessage: ' + said.slice(0, 2000);

// The title Haiku answered, tidied, or '' if it isn't one.
function tidy(answer) {
	const t = clean(String(answer || '').split('\n').find((l) => l.trim()) || '').replace(/^["'“‘`*#\s]+|["'”’`*.\s]+$/g, '');
	return t.length > 60 ? '' : t; // (a long answer is chat, not a title)
}

// cb(title | ''): Haiku's name for a task, asked of Claude Code with no
// tools, no settings and nothing saved (a few seconds, one small call).
function make(bin, said, cb, opts = {}) {
	if (!bin || !said || (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin))) return cb('');
	let dir;
	try { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-title-')); } catch { return cb(''); }
	let p;
	try {
		p = spawn(bin, ['-p', '--model', 'haiku', '--tools', '', '--setting-sources', 'local', '--no-session-persistence', '--output-format', 'text'], { cwd: dir, env: claudeEnv(), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
	} catch { fs.rm(dir, { recursive: true, force: true }, () => {}); return cb(''); }
	let out = '', over = false;
	const finish = (title) => {
		if (over) return;
		over = true;
		clearTimeout(timer);
		try { p.kill(); } catch { /* gone */ }
		fs.rm(dir, { recursive: true, force: true }, () => {});
		cb(title);
	};
	const timer = setTimeout(() => finish(''), opts.timeout || 30000);
	p.stdout.setEncoding('utf8');
	p.stdout.on('data', (d) => { out = (out + d).slice(-4000); });
	p.on('error', () => finish(''));
	p.on('close', (code) => finish(code === 0 ? tidy(out) : ''));
	p.stdin.on('error', () => {});
	p.stdin.end(ask(said));
}

// Names sessions, each once at most (a try that fails isn't repeated, so a
// signed-out Claude Code isn't asked over and over).
function namer(findBin, make_ = make) {
	const tried = new Set();
	let busy = 0;
	// s: { id, file, title }: done() once its title is written.
	return function ensure(s, done) {
		if (!s || !s.file || s.title || tried.has(s.id) || busy >= 2) return;
		const said = firstPrompt(s.file);
		if (!said) return; // (asked again once you've said something)
		tried.add(s.id);
		busy++;
		make_(findBin(), said, (title) => {
			busy--;
			if (!title) return;
			try {
				fs.appendFileSync(s.file, JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId: String(s.id) }) + '\n');
			} catch { return; }
			if (done) done(title);
		});
	};
}

module.exports = { firstPrompt, tidy, make, namer };
