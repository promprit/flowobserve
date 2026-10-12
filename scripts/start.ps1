$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fo_win.ps1')
$Repo = Split-Path -Parent $PSScriptRoot
$Url = 'http://127.0.0.1:4317'

function Die([string]$m) { [Console]::Error.WriteLine("start: $m"); exit 1 }

try {
  $r = Invoke-WebRequest -Uri "$Url/health" -UseBasicParsing -TimeoutSec 1
  if ($r.Content -match '"ok"\s*:\s*true') {
    Write-Output "flowobserve is already running: $Url"
    exit 0
  }
} catch { }

$Node = Find-FoNode
if (-not $Node) { Die 'Node >= 24 not found (or set FO_NODE)' }
$Main = Join-Path $Repo 'server\dist\main.js'
if (-not (Test-Path $Main)) { Die 'server\dist\main.js missing: run scripts\setup.ps1 first' }

$env:FO_HOME = if ($env:FO_HOME) { $env:FO_HOME } else { Join-Path $HOME '.flowobserve' }
# fo-root-fallback begin
if (-not $env:FO_PROJECTS_ROOT) {
  try {
    $helper = Get-Content -LiteralPath (Join-Path $env:FO_HOME 'helper.json') -Raw | ConvertFrom-Json
    $root = $helper.root
    if (($root -is [string]) -and $root -and (Test-Path -LiteralPath $root -PathType Container)) { $env:FO_PROJECTS_ROOT = $root }
  } catch { }
}
# fo-root-fallback end
$env:FO_PORT = '4317'
$env:FO_EDITION = 'vscode'  # no iTerm2 helper on Windows: VS Code actions only
$Host.UI.RawUI.WindowTitle = 'flowobserve server (close this window to stop)'
Write-Output $Url
Write-Output 'Close this window or press Ctrl+C to stop.'

Push-Location (Join-Path $Repo 'server')
try {
  & $Node --disable-warning=ExperimentalWarning $Main
  $code = $LASTEXITCODE
} finally { Pop-Location }
exit $code
