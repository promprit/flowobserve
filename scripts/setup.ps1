# Set up flowobserve on Windows: build, copy the hook, wire ~/.claude. Safe to re-run.
# -ClaudeDir 'DIR1;DIR2' wires those Claude config dirs instead (several accounts, as in Dryas's accounts.json).
# Exit codes: 0 installed; 1 failed (or wiring incomplete); 3 installed, but the Dryas flowobserve stage is off.
param([string]$ClaudeDir = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fo_win.ps1')
$Repo = Split-Path -Parent $PSScriptRoot
$FoHome = if ($env:FO_HOME) { $env:FO_HOME } else { Join-Path $HOME '.flowobserve' }
$ClaudeDirs = @($ClaudeDir -split ';' | Where-Object { $_ })
if (-not $ClaudeDirs) { $ClaudeDirs = @(if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { Join-Path $HOME '.claude' }) }
$Exclude = @($ClaudeDirs | ForEach-Object { '--exclude'; $_ })

function Die([string]$m) { [Console]::Error.WriteLine("setup: $m"); exit 1 }

if ((Split-Path -Leaf $FoHome.TrimEnd('\', '/')) -ne '.flowobserve') { Die 'FO_HOME must end in .flowobserve' }

$Node = Find-FoNode
if (-not $Node) { Die 'Node >= 24 not found (or set FO_NODE)' }
$Py = Find-FoPython
if (-not $Py) { Die 'Python >= 3.9 not found' }

if (-not $env:FO_SKIP_BUILD) {
  # Shim pnpm through corepack when it is not installed; this process only.
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) { Die 'pnpm not found and corepack is unavailable: npm i -g pnpm' }
    $shim = Join-Path $FoHome 'bin\pnpm-shim'
    New-Item -ItemType Directory -Force -Path $shim | Out-Null
    [IO.File]::WriteAllText((Join-Path $shim 'pnpm.cmd'), "@corepack pnpm %*`r`n", [Text.Encoding]::ASCII)
    $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    $env:PATH = "$shim;$env:PATH"
  }
  Push-Location $Repo
  try {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Die 'pnpm install failed' }
    & pnpm build
    if ($LASTEXITCODE -ne 0) { Die 'pnpm build failed' }
  } finally { Pop-Location }
}

# Copy the hook files (temp file, then move).
$Bin = Join-Path $FoHome 'bin'
New-Item -ItemType Directory -Force -Path $Bin, (Join-Path $FoHome 'spool') | Out-Null
foreach ($f in 'fo_hook.py', 'fo_derive.py', 'fo_redact.py') {
  $dst = Join-Path $Bin $f
  Copy-Item (Join-Path $Repo "hook\$f") "$dst.tmp" -Force
  Move-Item "$dst.tmp" $dst -Force
}

# Wire Claude Code, then check.
$Hook = Join-Path $Bin 'fo_hook.py'
$Inst = Join-Path $Repo 'scripts\fo_install.py'
$disabled = Join-Path $FoHome 'disabled'  # uninstall's off switch for hook entries left behind
if (Test-Path -LiteralPath $disabled) { Remove-Item -LiteralPath $disabled -Force }
$warned = $false
$off = $null
foreach ($d in $ClaudeDirs) {
  & $Py $Inst wire --python $Py --claude-dir $d --hook $Hook
  if ($LASTEXITCODE -ne 0) { Die "wire failed: $d" }
  $status = & $Py $Inst status --claude-dir $d --hook $Hook
  if ($LASTEXITCODE -ne 0) { Die "status failed: $d" }
  Write-Output "claude dir: $d"
  $status | ForEach-Object { Write-Output $_ }
  if ($status | Where-Object { $_ -match '^\s*warn\b' }) { $warned = $true }
  if ($status | Where-Object { $_ -match '^\s*off\b' }) { $off = $d }
}
# Dryas accounts (~/.dryas/accounts.json) not wired yet: say how; never edit a dir that was not asked for.
$missing = @(& $Py $Inst accounts --unwired --hook $Hook @Exclude | Where-Object { $_ })
if ($missing) {
  foreach ($d in $missing) { Write-Output "note: Dryas account $d is not wired for flowobserve" }
  Write-Output ("note: to wire every account, run: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -ClaudeDir '" + (($ClaudeDirs + $missing) -join ';') + "'")
}

$Root = $env:FO_PROJECTS_ROOT
if (-not $Root) { $Root = (& $Py $Inst helper-root --home $FoHome | Select-Object -First 1) }
if ($Root -and $env:FO_PROJECTS_ROOT -and (-not [IO.Path]::IsPathRooted($Root) -or -not (Test-Path -LiteralPath $Root -PathType Container))) {
  Write-Output "warn: FO_PROJECTS_ROOT is not an absolute directory: $Root; helper.json not written"
} elseif ($Root) {
  & $Py $Inst helper-json --home $FoHome --root $Root
  if ($LASTEXITCODE -ne 0) { Die 'helper.json failed' }
} else {
  Write-Output 'note: no projects root found; helper.json not written (set FO_PROJECTS_ROOT)'
}

if (Get-Command code -ErrorAction SilentlyContinue) {
  $exts = @()
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $exts = @(& code --list-extensions 2>$null) } catch { } finally { $ErrorActionPreference = $prevEap }
  if (-not ($exts | Where-Object { ([string]$_).Trim() -ieq 'mhelbich.claude-code-usage-status' })) {
    Write-Output 'warn: Live usage limits need the Claude Code Usage Status extension (mhelbich.claude-code-usage-status)'
  }
}

Write-Output 'flowobserve installed. Start the board with: powershell -ExecutionPolicy Bypass -File scripts\start.ps1'
if ($warned) { Die 'status reported a warning' }
if ($off) {
  # The Dryas stage lives in ~/.dryas/chain.local.json, shared by every account: one Dryas setup run turns it on for all.
  $extra = if ($off -ne (Join-Path $HOME '.claude')) { " --claude-dir '$off'" } else { '' }
  Write-Output "note: turn on the Dryas flowobserve stage (once; it is shared by every account): <dryas clone>\install\install.ps1 --flowobserve$extra"
  [Console]::Error.WriteLine('setup: installed; Dryas stage off (exit 3)')
  exit 3
}
