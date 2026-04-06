param(
  [switch]$ServerOnly
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$serverCommand = "cd /d `"$repoRoot`" && npm run dev:server:noreload"

Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $serverCommand | Out-Null

if (-not $ServerOnly) {
  Set-Location $repoRoot
  npm run dev:client
}