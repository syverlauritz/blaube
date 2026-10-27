# Sets up the portrait screen for filming, and puts it back after.
#
#   powershell -File scripts/film/desktop.ps1 set      # sky wallpaper on the portrait screen, desktop icons hidden
#   powershell -File scripts/film/desktop.ps1 restore  # your wallpaper and icons back
#
# What was there before is kept in desktop-before.json next to this file.
param([Parameter(Mandatory)][ValidateSet('set', 'restore')][string]$what)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDesktopWallpaper {
	void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
	[return: MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
	[return: MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint monitorIndex);
	uint GetMonitorDevicePathCount();
	RECT GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
}
[ComImport, Guid("C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD")] public class DesktopWallpaperClass { }
public static class FilmDesk {
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string c, string n);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string n);
	[DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
	[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
	delegate bool EnumProc(IntPtr h, IntPtr p);
	[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
	static IntPtr DefView() {
		IntPtr v = FindWindowEx(FindWindow("Progman", null), IntPtr.Zero, "SHELLDLL_DefView", null);
		if (v != IntPtr.Zero) return v;
		EnumWindows((h, p) => { var d = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null); if (d != IntPtr.Zero) { v = d; return false; } return true; }, IntPtr.Zero);
		return v;
	}
	static IDesktopWallpaper W() { return (IDesktopWallpaper)new DesktopWallpaperClass(); }
	// The portrait screen: the one taller than it is wide.
	public static string Portrait() { var w = W(); for (uint i = 0; i < w.GetMonitorDevicePathCount(); i++) { var id = w.GetMonitorDevicePathAt(i); var r = w.GetMonitorRECT(id); if (r.Bottom - r.Top > r.Right - r.Left) return id; } return null; }
	public static string GetWallpaper(string id) { return W().GetWallpaper(id); }
	public static void SetWallpaper(string id, string file) { W().SetWallpaper(id, file); }
	public static bool IconsShown() { var l = FindWindowEx(DefView(), IntPtr.Zero, "SysListView32", null); return l != IntPtr.Zero && IsWindowVisible(l); }
	public static void ToggleIcons() { SendMessage(DefView(), 0x0111, (IntPtr)0x7402, IntPtr.Zero); }
}
"@
$keep = Join-Path $PSScriptRoot 'desktop-before.json'
$mon = [FilmDesk]::Portrait()
if (-not $mon) { throw 'No portrait screen found' }
if ($what -eq 'set') {
	if (-not (Test-Path $keep)) { @{ monitor = $mon; wallpaper = [FilmDesk]::GetWallpaper($mon); icons = [FilmDesk]::IconsShown() } | ConvertTo-Json | Out-File -Encoding utf8 $keep }
	[FilmDesk]::SetWallpaper($mon, (Join-Path $PSScriptRoot 'sky.png'))
	if ([FilmDesk]::IconsShown()) { [FilmDesk]::ToggleIcons() }
	'set'
} else {
	if (-not (Test-Path $keep)) { 'nothing to restore'; return }
	$b = Get-Content $keep -Raw | ConvertFrom-Json
	if ($null -ne $b.wallpaper) { [FilmDesk]::SetWallpaper($b.monitor, $b.wallpaper) }
	if ($b.icons -and -not [FilmDesk]::IconsShown()) { [FilmDesk]::ToggleIcons() }
	Remove-Item $keep
	'restored'
}
