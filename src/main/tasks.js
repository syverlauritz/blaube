// Checks which background tasks (servers, watchers, long builds Claude
// started with run_in_background) are still running. No hook fires when one
// ends, so we look for its command among the running processes instead.
// The PowerShell tool hides the command it runs, so we look at what it
// started too: every process under the session's claude.exe counts.
const { execFile } = require('node:child_process');

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// The words we look for: those of the last command in the line (the one
// that keeps running, as in `git status; npm run dev`), without quotes or
// redirects. npm shows up as "npm-cli.js run dev", so words match anywhere.
function words(command) {
	const parts = String(command || '').split(/;|&&|\|\||\||\n/).map((p) => p.trim()).filter(Boolean);
	const last = parts[parts.length - 1] || '';
	const out = [];
	const tokens = last.replace(/['"`]/g, ' ').split(/\s+/).filter(Boolean);
	for (let i = 0; i < tokens.length && out.length < 8; i++) {
		const w = tokens[i];
		// A redirect (>, 2>, &>, >&, 2>&1...) and, when it stands alone, its target.
		if (/^[&\d]?[<>]/.test(w)) { if (/^[&\d]?[<>]+&?$/.test(w)) i++; continue; }
		if (w.length >= 2) out.push(w);
	}
	return out;
}

function listProcesses(cb) {
	const opts = { timeout: 8000, maxBuffer: 32 << 20, windowsHide: true };
	const parse = (stdout, re) => stdout.split(/\r?\n/).map((l) => re.exec(l)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: squash(m[3]) }));
	if (process.platform === 'win32') {
		execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.CommandLine)" }'], opts,
			(err, stdout) => cb(err ? null : parse(stdout, /^(\d+)\|(\d+)\|(.*)$/)));
	} else {
		execFile('ps', ['-axww', '-o', 'pid=,ppid=,command='], opts, (err, stdout) => cb(err ? null : parse(stdout, /^\s*(\d+)\s+(\d+)\s+(.*)$/)));
	}
}

// Calls cb(set of task ids still running). Each task is { id, command, pid }
// where pid is its session's claude process, if known. A task with no words
// to look for counts as running. cb(null) if the process list couldn't be read.
function runningTasks(tasks, cb) {
	if (!tasks.length) return cb(new Set());
	listProcesses((procs) => {
		if (!procs) return cb(null);
		const parent = new Map(procs.map((p) => [p.pid, p.ppid]));
		const under = (pid, root) => {
			for (let p = parent.get(pid), hops = 0; p && hops < 64; p = parent.get(p), hops++) if (p === root) return true;
			return false;
		};
		// Each task claims one process tree, so two tasks can't both live off
		// one process (`npm run toy` that runs `npm run dev` inside, or the
		// same command started twice). Most specific and newest tasks first.
		const claimed = new Set();
		const isClaimed = (pid) => claimed.has(pid) || [...claimed].some((root) => under(pid, root));
		const order = tasks.map((t) => ({ t, w: words(t.command) }))
			.sort((a, b) => b.w.length - a.w.length || (b.t.startedAt || 0) - (a.t.startedAt || 0));
		const alive = new Set();
		for (const { t, w } of order) {
			if (!w.length) { alive.add(t.id); continue; }
			const pool = t.pid && parent.has(t.pid) ? procs.filter((p) => under(p.pid, t.pid)) : procs;
			const hits = pool.filter((p) => w.every((x) => p.cmd.includes(x)) && !isClaimed(p.pid));
			const ids = new Set(hits.map((p) => p.pid));
			const top = hits.find((p) => ![...ids].some((other) => other !== p.pid && under(p.pid, other)));
			if (top) { claimed.add(top.pid); alive.add(t.id); }
		}
		cb(alive);
	});
}

module.exports = { runningTasks, words };
