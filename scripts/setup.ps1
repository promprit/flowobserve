# Set up flowobserve on Windows: build, copy the hook, wire ~/.claude. Safe to re-run.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fo_win.ps1')
$Repo = Split-Path -Parent $PSScriptRoot
$FoHome = if ($env:FO_HOME) { $env:FO_HOME } else { Join-Path $HOME '.flowobserve' }
$ClaudeDir = if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { Join-Path $HOME '.claude' }

function Die([string]$m) { [Console]::Error.WriteLine("setup: $m"); exit 1 }

if (-not $FoHome.TrimEnd('\', '/').EndsWith('.flowobserve')) { Die 'FO_HOME must end in .flowobserve' }

$Node = Find-FoNode
if (-not $Node) { Die 'Node >= 24 not found (or set FO_NODE)' }
$Py = Find-FoPython
if (-not $Py) { Die 'Python >= 3.9 not found' }

if (-not $env:FO_SKIP_BUILD) {
  # Shim pnpm through corepack when it is not installed; this process only.
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
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
& $Py $Inst wire --python $Py --claude-dir $ClaudeDir --hook $Hook
if ($LASTEXITCODE -ne 0) { Die 'wire failed' }
$status = & $Py $Inst status --claude-dir $ClaudeDir --hook $Hook
if ($LASTEXITCODE -ne 0) { Die 'status failed' }
$status | ForEach-Object { Write-Output $_ }
if ($status | Where-Object { $_ -match '^\s*warn\b' }) { Die 'status reported a warning' }

Write-Output 'flowobserve installed. Start the board with: powershell -ExecutionPolicy Bypass -File scripts\start.ps1'
