# Unwire flowobserve from ~/.claude on Windows. Keeps ~/.flowobserve data and .bak files.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fo_win.ps1')
$Repo = Split-Path -Parent $PSScriptRoot
$FoHome = if ($env:FO_HOME) { $env:FO_HOME } else { Join-Path $HOME '.flowobserve' }
$ClaudeDir = if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { Join-Path $HOME '.claude' }

$Py = Find-FoPython
if (-not $Py) { [Console]::Error.WriteLine('uninstall: Python >= 3.9 not found; cannot unwire'); exit 1 }
& $Py (Join-Path $Repo 'scripts\fo_install.py') unwire --claude-dir $ClaudeDir --hook (Join-Path $FoHome 'bin\fo_hook.py')
if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine('uninstall: unwire failed'); exit 1 }
$shim = Join-Path $FoHome 'bin\pnpm-shim'
if (Test-Path $shim) { Remove-Item $shim -Recurse -Force }
Write-Output 'flowobserve unwired. Close the server window if it is open. Data in ~/.flowobserve kept.'
