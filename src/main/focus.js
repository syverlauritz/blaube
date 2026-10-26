// Works out which Claude Code sessions you're looking at, so their slimes
// stop asking for attention. Windows only for now: a small PowerShell loop
// reports the window in front, and a session counts as in front when that
// window's process is one of its ancestors. Several sessions in one window
// (terminal tabs) are told apart by the window title, which Claude Code sets
// to the session's title.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class BlaubeFg {
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$last = ''; $lastPid = 0; $procsAt = [DateTime]::MinValue
while ($true) {
	$h = [BlaubeFg]::GetForegroundWindow(); $p = [uint32]0
	[void][BlaubeFg]::GetWindowThreadProcessId($h, [ref]$p)
	$sb = New-Object System.Text.StringBuilder 512
	[void][BlaubeFg]::GetWindowText($h, $sb, 512)
	$title = $sb.ToString()
	$stale = ([DateTime]::Now - $procsAt).TotalSeconds -gt 10
	if ("$p|$title" -ne $last -or $stale) {
		$out = @{ pid = $p; title = $title }
		if ($p -ne $lastPid -or $stale) {
			$out.procs = (Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }) -join ';'
			$procsAt = [DateTime]::Now; $lastPid = $p
		}
		$last = "$p|$title"
		[Console]::Out.WriteLine((ConvertTo-Json -Compress $out)); [Console]::Out.Flush()
	}
	Start-Sleep -Milliseconds 700
}
`;

// Strips the spinner/status glyph Claude Code puts in front of the title.
const cleanTitle = (t) => String(t || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

function transcriptPath(s) {
	if (s.transcript) return s.transcript;
	if (!s.cwd) return '';
	return path.join(os.homedir(), '.claude', 'projects', s.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${s.id}.jsonl`);
}

// The session's title, as Claude Code shows it: a /rename title if there is
// one, otherwise the title Claude gave it. Read from the end of its
// transcript and cached until the file changes, and for a while even if
// it does: a working session's transcript changes all the time, and this
// is asked on every hook event (up to 1 MB read per session each time).
const titles = new Map();
const TITLE_FRESH = 15e3;
function sessionTitle(s) {
	const file = transcriptPath(s);
	if (!file) return '';
	const hit = titles.get(file);
	if (hit && Date.now() - hit.at < TITLE_FRESH) return hit.title;
	let st;
	try { st = fs.statSync(file); } catch { return ''; }
	if (hit && hit.mtime === st.mtimeMs) { hit.at = Date.now(); return hit.title; }
	let text = '';
	try {
		const len = Math.min(st.size, 1 << 20);
		const buf = Buffer.alloc(len);
		const fd = fs.openSync(file, 'r');
		try { fs.readSync(fd, buf, 0, len, st.size - len); } finally { fs.closeSync(fd); }
		text = buf.toString('utf8');
	} catch { return ''; }
	const lastOf = (key) => {
		const re = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`, 'g');
		let m, v = '';
		while ((m = re.exec(text))) v = m[1];
		try { return v ? JSON.parse(`"${v}"`) : ''; } catch { return ''; }
	};
	const title = cleanTitle(lastOf('customTitle') || lastOf('aiTitle'));
	titles.set(file, { mtime: st.mtimeMs, title, at: Date.now() });
	return title;
}

// Which of the sessions are in the window in front.
function sessionsInFront(sessions, fg, parents) {
	if (!fg || !fg.pid) return [];
	const inWindow = (pid) => {
		for (let p = pid, hops = 0; p && hops < 64; p = parents.get(p), hops++) if (p === fg.pid) return true;
		return false;
	};
	const candidates = sessions.filter((s) => s.pid && inWindow(s.pid));
	const title = cleanTitle(fg.title);
	const byTitle = title ? sessions.filter((s) => sessionTitle(s) === title) : [];
	if (byTitle.length) return byTitle;
	return candidates.length === 1 ? candidates : [];
}

// Calls onChange() whenever the window in front changes. front(sessions)
// then says which of them you're looking at.
function startFocusWatcher(onChange) {
	if (process.platform !== 'win32') return { front: () => [], stop() {} };
	let fg = null, parents = new Map(), child = null, stopped = false, buf = '';
	const start = () => {
		const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
		child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			buf += chunk;
			let i;
			while ((i = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, i).trim();
				buf = buf.slice(i + 1);
				try {
					const msg = JSON.parse(line);
					if (msg.procs) {
						parents = new Map();
						for (const pair of msg.procs.split(';')) {
							const [p, pp] = pair.split(',').map(Number);
							if (p) parents.set(p, pp);
						}
					}
					fg = { pid: Number(msg.pid), title: String(msg.title || '') };
					onChange();
				} catch { /* not a status line */ }
			}
		});
		child.on('exit', () => { if (!stopped) setTimeout(start, 5000); });
	};
	start();
	return {
		front: (sessions) => sessionsInFront(sessions, fg, parents),
		stop() { stopped = true; if (child) child.kill(); },
	};
}

module.exports = { startFocusWatcher, sessionsInFront, cleanTitle, transcriptPath };
