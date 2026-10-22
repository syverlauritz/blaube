// The other apps' windows on the desktop, so the slimes can stand on them.
// A small PowerShell helper lists the visible top-level windows (front to
// back) and prints them when something changed: about 60 times a second
// while a window moves, a dozen times a second otherwise.
// Windows only; elsewhere this does nothing.
const { spawn } = require('node:child_process');

const SCRIPT = `
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class BlaubeWins {
	delegate bool EnumProc(IntPtr h, IntPtr p);
	[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
	[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
	[DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
	[DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
	[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
	[DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
	[DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
	public static string List(uint skip) {
		var sb = new StringBuilder();
		EnumWindows((h, p) => {
			if (!IsWindowVisible(h) || IsIconic(h) || GetWindowTextLength(h) == 0) return true;
			if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // tool windows
			uint pid; GetWindowThreadProcessId(h, out pid);
			if (pid == skip) return true;
			int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
			if (cloaked != 0) return true; // hidden store apps, other desktops
			var cls = new StringBuilder(64); GetClassName(h, cls, 64);
			var c = cls.ToString();
			if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
			RECT r; if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) return true; // the visible frame
			if (r.R - r.L < 80 || r.B - r.T < 40) return true;
			sb.Append(h.ToInt64()).Append(' ').Append(r.L).Append(' ').Append(r.T).Append(' ').Append(r.R).Append(' ').Append(r.B).Append(';');
			return true;
		}, IntPtr.Zero);
		return sb.ToString();
	}
}
"@
$last = ''; $busy = 0
while ($true) {
	$now = [BlaubeWins]::List(__PID__)
	if ($now -ne $last) { $last = $now; $busy = 60; [Console]::Out.WriteLine($now); [Console]::Out.Flush() }
	# Quick while something is moving (about 60 a second), slower when still.
	if ($busy -gt 0) { $busy--; Start-Sleep -Milliseconds 8 } else { Start-Sleep -Milliseconds 80 }
}`;

// Calls onList([{ id, x, y, width, height }], front to back, in physical
// screen pixels) whenever the windows move, open or close. Returns a stop
// function.
function watchWindows(skipPid, onList) {
	if (process.platform !== 'win32') return () => {};
	let child = null, stopped = false;
	const start = () => {
		const script = SCRIPT.replace('__PID__', String(skipPid));
		child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
		let buf = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			buf += chunk;
			let i;
			while ((i = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, i).trim();
				buf = buf.slice(i + 1);
				onList(parse(line));
			}
		});
		child.on('exit', () => { if (!stopped) setTimeout(start, 2000); });
	};
	start();
	return () => { stopped = true; if (child) child.kill(); };
}

function parse(line) {
	return line.split(';').filter(Boolean).map((w) => {
		const [id, l, t, r, b] = w.split(' ').map(Number);
		return { id, x: l, y: t, width: r - l, height: b - t };
	});
}

// The parts of each window's top edge you can actually see (not covered by
// a window in front of it), as ledges { id, x0, x1, y, wx } (wx: the
// window's left side, to tell when it moved) in the same
// coordinates as the windows. Windows filling the whole work area
// (maximised) and edges at the very top of it make no ledge.
function ledges(windows, area) {
	const out = [];
	windows.forEach((w, i) => {
		const y = w.y;
		if (y <= area.y + 4 || y >= area.y + area.height - 8) return;
		if (w.width >= area.width - 4 && w.height >= area.height - 40) return;
		let spans = [[Math.max(w.x, area.x), Math.min(w.x + w.width, area.x + area.width)]];
		for (let j = 0; j < i && spans.length; j++) {
			const f = windows[j];
			if (y < f.y || y > f.y + f.height) continue;
			const a = f.x, b = f.x + f.width;
			spans = spans.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : [[s, Math.min(a, e)], [Math.max(b, s), e]].filter(([p, q]) => q - p > 1)));
		}
		for (const [s, e] of spans) if (e - s >= 30) out.push({ id: w.id, x0: s, x1: e, y, wx: w.x });
	});
	return out;
}

module.exports = { watchWindows, ledges, parse };
