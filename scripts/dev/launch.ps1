# Blaube (dev): starts Blaube from the newest main on GitHub, whatever
# branch your own checkout is on. It runs from a folder of its own
# (.run-main, next to .git), always exactly origin/main, never edited by
# hand. Made by scripts/dev/install.ps1, which puts a shortcut to this in
# the Start menu and on the desktop.
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev\launch.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

function Say($text, $icon = 'Information') {
	[void][System.Windows.Forms.MessageBox]::Show($text, 'Blaube (dev)', 'OK', $icon)
}

try {
	$repo = Split-Path -Parent (git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir)
	$run = Join-Path $repo '.run-main'
	if (-not (Test-Path (Join-Path $run '.git'))) {
		git -C $repo fetch -q origin main
		git -C $repo worktree add -q --detach $run origin/main
		if ($LASTEXITCODE) { throw "Couldn't make $run" }
	}

	# Already going? Then this one isn't started twice.
	$going = Get-CimInstance Win32_Process -Filter "Name='electron.exe' or Name='Blaube.exe'" |
		Where-Object { $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch 'BLAUBE_TEST' }
	if ($going) {
		Say "Blaube is already running.`n`nQuit it from its menu (Quit), then open Blaube (dev) again to get the newest main.`n`nThe sessions it started come back by themselves."
		exit
	}

	# The newest main. (Offline: the last one fetched.)
	git -C $run fetch -q origin main
	$fetched = -not $LASTEXITCODE
	if (git -C $run status --porcelain --untracked-files=no) {
		Say "$run has changes in it, so it wasn't updated.`n`nIt's only for running Blaube: put those changes in your own checkout, then delete the folder (git worktree remove --force `"$run`")." 'Warning'
		exit
	}
	git -C $run checkout -q --detach origin/main
	if ($LASTEXITCODE) { throw "Couldn't move $run to origin/main" }

	# Its packages, when package-lock.json changed since the last time.
	$lock = (Get-FileHash (Join-Path $run 'package-lock.json')).Hash
	$mark = Join-Path $run 'node_modules\.blaube-lock'
	$had = if (Test-Path $mark) { Get-Content $mark } else { '' }
	if ($had -ne $lock -or -not (Test-Path (Join-Path $run 'node_modules\electron\dist\electron.exe'))) {
		$p = Start-Process cmd.exe -ArgumentList '/c', 'title Updating Blaube... && npm ci' -WorkingDirectory $run -Wait -PassThru
		if ($p.ExitCode) { throw 'npm ci failed' }
		# (Newer npm can leave out Electron's own download: fetched here then.)
		if (-not (Test-Path (Join-Path $run 'node_modules\electron\dist\electron.exe'))) {
			$p = Start-Process cmd.exe -ArgumentList '/c', 'title Updating Blaube... && node node_modules\electron\install.js' -WorkingDirectory $run -Wait -PassThru
			if ($p.ExitCode) { throw "Couldn't download Electron" }
		}
		Set-Content -Path $mark -Value $lock -Encoding ascii
	}

	Start-Process (Join-Path $run 'node_modules\electron\dist\electron.exe') -ArgumentList '.' -WorkingDirectory $run
	if (-not $fetched) { Say "Couldn't reach GitHub, so Blaube started from the last main it got." 'Warning' }
} catch {
	Say "Blaube (dev) couldn't start Blaube:`n`n$($_.Exception.Message)" 'Error'
}
