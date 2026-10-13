# Unwire flowobserve from ~/.claude on Windows. Keeps ~/.flowobserve data and .bak files.
# -ClaudeDir 'DIR1;DIR2' unwires those Claude config dirs instead.
param([string]$ClaudeDir = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fo_win.ps1')
$Repo = Split-Path -Parent $PSScriptRoot
$FoHome = if ($env:FO_HOME) { $env:FO_HOME } else { Join-Path $HOME '.flowobserve' }
$ClaudeDirs = @($ClaudeDir -split ';' | Where-Object { $_ })
if (-not $ClaudeDirs) { $ClaudeDirs = @(if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { Join-Path $HOME '.claude' }) }
$Exclude = @($ClaudeDirs | ForEach-Object { '--exclude'; $_ })

$Py = Find-FoPython
if (-not $Py) { [Console]::Error.WriteLine('uninstall: Python >= 3.9 not found; cannot unwire'); exit 1 }
$Inst = Join-Path $Repo 'scripts\fo_install.py'
$Hook = Join-Path $FoHome 'bin\fo_hook.py'
foreach ($d in $ClaudeDirs) {
  & $Py $Inst unwire --claude-dir $d --hook $Hook
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("uninstall: unwire failed: $d"); exit 1 }
}
& $Py $Inst accounts --wired --hook $Hook @Exclude | Where-Object { $_ } | ForEach-Object {
  Write-Output "note: $_ is still wired (a no-op now); to unwire it run: powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1 -ClaudeDir '$_'"
}
# Hook entries left anywhere (other accounts, the Dryas stage) now do nothing.
if (Test-Path -LiteralPath $FoHome -PathType Container) { [IO.File]::WriteAllText((Join-Path $FoHome 'disabled'), '') }
if ((& $Py $Inst dryas-stage | Select-Object -First 1) -eq 'on') {
  Write-Output "note: the Dryas chain still runs the flowobserve stage (a no-op now). To turn it off for every account, run once: <dryas clone>\install\install.ps1 --no-flowobserve"
}
$shim = Join-Path $FoHome 'bin\pnpm-shim'
if (Test-Path $shim) { Remove-Item $shim -Recurse -Force }
Write-Output 'flowobserve unwired. Close the server window if it is open. Data in ~/.flowobserve kept.'
