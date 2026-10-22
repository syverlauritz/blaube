// Finds the claude.exe process a hook came from. Hooks run in Git Bash a
// few processes below Claude Code, so walk up the parents until we hit it.
// The hook's own process must still be alive while this runs.
const { execFile } = require('node:child_process');

const SCRIPT = (pid) => `$id = ${pid}
for ($i = 0; $i -lt 16 -and $id; $i++) {
	$c = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
	if (-not $c) { break }
	if ($c.Name -match '^(claude|node)\.exe$') { $c.ProcessId; exit 0 }
	$id = $c.ParentProcessId
}
exit 1`;

function findClaudeAncestor(pid, cb) {
	if (process.platform !== 'win32' || !/^\d+$/.test(String(pid))) return cb(null);
	execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT(pid)], { timeout: 4000, windowsHide: true }, (err, stdout) => {
		const n = Number(String(stdout).trim());
		cb(!err && Number.isInteger(n) && n > 0 ? n : null);
	});
}

module.exports = { findClaudeAncestor };
