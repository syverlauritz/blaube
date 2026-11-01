# Installs (or updates) Blaube on Windows, with no SmartScreen step:
#
#   irm https://raw.githubusercontent.com/syverlauritz/blaube/main/install.ps1 | iex
#
# It downloads the newest installer from GitHub, runs it quietly (no admin
# needed: Blaube installs just for you), and opens Blaube. Run it again to
# update (Blaube also updates itself).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # (the progress bar makes downloads very slow)

$repo = 'syverlauritz/blaube'
$url = "https://github.com/$repo/releases/latest/download/Blaube-Setup-windows.exe"
$setup = Join-Path $env:TEMP 'Blaube-Setup-windows.exe'

function Say($text) { Write-Host '● ' -ForegroundColor DarkYellow -NoNewline; Write-Host $text }

Say 'Downloading Blaube...'
Invoke-WebRequest -Uri $url -OutFile $setup -UseBasicParsing

Get-Process -Name 'Blaube' -ErrorAction SilentlyContinue | ForEach-Object {
  Say 'Quitting the Blaube that''s running...'
  $_.CloseMainWindow() | Out-Null
  if (-not $_.WaitForExit(5000)) { $_ | Stop-Process -Force }
}

Say 'Installing...'
Start-Process -FilePath $setup -ArgumentList '/S' -Wait
Remove-Item $setup -ErrorAction SilentlyContinue

$exe = Join-Path $env:LOCALAPPDATA 'Programs\blaube\Blaube.exe'
if (Test-Path $exe) {
  Say 'Blaube is installed. Opening it...'
  Start-Process -FilePath $exe
} else {
  Say 'Blaube is installed. Open it from the Start menu.'
}

Write-Host ''
Write-Host '  Next: right-click the blob and choose "Connect Claude Code...",'
Write-Host '  then start (or restart) a Claude Code session. Its blob pops out.'
Write-Host ''
