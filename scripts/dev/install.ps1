# Puts "Blaube (dev)" in the Start menu and on the desktop: it starts
# Blaube from the newest main (see launch.ps1). Run once:
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev\install.ps1
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir)
$run = Join-Path $repo '.run-main'
if (-not (Test-Path (Join-Path $run '.git'))) {
	git -C $repo fetch -q origin main
	git -C $repo worktree add -q --detach $run origin/main
	if ($LASTEXITCODE) { throw "Couldn't make $run" }
}
# (The shortcut runs the launcher in .run-main, so it's always main's.)
$launch = Join-Path $run 'scripts\dev\launch.ps1'
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))
foreach ($dir in $places) {
	$lnk = $shell.CreateShortcut((Join-Path $dir 'Blaube (dev).lnk'))
	$lnk.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
	$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launch`""
	$lnk.WorkingDirectory = $run
	$lnk.IconLocation = Join-Path $run 'node_modules\electron\dist\electron.exe'
	$lnk.Description = 'Blaube from the newest main'
	$lnk.Save()
}
Write-Host "Blaube (dev) is in the Start menu and on the desktop. It runs from $run"
