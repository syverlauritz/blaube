# Brings the window a console process runs in to the front. In Windows
# Terminal it also picks the right tab: it gives the process's console a
# unique title for a moment, finds the tab with that title, selects it and
# then puts the old title back. Exits 0 when it found a window.
param([int]$ProcessId)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class BlaubeWin {
	[DllImport("kernel32.dll")] public static extern bool FreeConsole();
	[DllImport("kernel32.dll")] public static extern bool AttachConsole(int pid);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern int GetConsoleTitle(StringBuilder b, int n);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool SetConsoleTitle(string t);
	[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
	[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
	[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);

	// Returns the old title, or null when we can't reach the console.
	public static string SwapTitle(int pid, string title) {
		FreeConsole();
		if (!AttachConsole(pid)) return null;
		var b = new StringBuilder(1024);
		GetConsoleTitle(b, b.Capacity);
		if (title != null) SetConsoleTitle(title);
		FreeConsole();
		return b.ToString();
	}

	public static IntPtr ConsoleWindow(int pid) {
		FreeConsole();
		if (!AttachConsole(pid)) return IntPtr.Zero;
		var h = GetConsoleWindow();
		FreeConsole();
		return h;
	}

	public static void Front(IntPtr h) {
		if (IsIconic(h)) ShowWindow(h, 9);
		// Windows only lets the app you last used take focus. Tapping Alt
		// counts as using us.
		keybd_event(0x12, 0, 0, UIntPtr.Zero);
		keybd_event(0x12, 0, 2, UIntPtr.Zero);
		SetForegroundWindow(h);
	}
}
'@

$UIA = [System.Windows.Automation.AutomationElement]
$Cond = [System.Windows.Automation.PropertyCondition]

function Find-TerminalTab([string]$name) {
	$wins = $UIA::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,
		(New-Object $Cond($UIA::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')))
	$isTab = New-Object $Cond($UIA::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
	foreach ($w in $wins) {
		foreach ($tab in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isTab)) {
			if ($tab.Current.Name -like "*$name*") { return @{ Window = $w; Tab = $tab } }
		}
	}
	return $null
}

$marker = "Blaube-$ProcessId-$([guid]::NewGuid().ToString('N').Substring(0, 6))"
$old = [BlaubeWin]::SwapTitle($ProcessId, $marker)
if ($null -ne $old) {
	$hit = $null
	for ($i = 0; $i -lt 10 -and -not $hit; $i++) { Start-Sleep -Milliseconds 60; $hit = Find-TerminalTab $marker }
	[void][BlaubeWin]::SwapTitle($ProcessId, $old)
	if ($hit) {
		$hit.Tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
		[BlaubeWin]::Front([IntPtr]$hit.Window.Current.NativeWindowHandle)
		exit 0
	}
	# A classic console window (not Windows Terminal).
	$h = [BlaubeWin]::ConsoleWindow($ProcessId)
	if ($h -ne [IntPtr]::Zero -and [BlaubeWin]::IsWindowVisible($h)) { [BlaubeWin]::Front($h); exit 0 }
}

# Otherwise the nearest parent with a window, e.g. VS Code or the Claude app.
$id = $ProcessId
for ($i = 0; $i -lt 12 -and $id; $i++) {
	$p = Get-Process -Id $id -ErrorAction SilentlyContinue
	if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { [BlaubeWin]::Front($p.MainWindowHandle); exit 0 }
	$c = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
	if (-not $c) { break }
	$id = $c.ParentProcessId
}
exit 1
