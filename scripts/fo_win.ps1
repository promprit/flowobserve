function Find-FoPython {
  # The real interpreter (sys.executable), never the WindowsApps stub; Python >= 3.9.
  $ErrorActionPreference = 'Continue'  # a candidate that writes to stderr or fails is skipped, not fatal
  foreach ($c in @(@('py', '-3'), @('python'))) {
    if (-not (Get-Command $c[0] -ErrorAction SilentlyContinue)) { continue }
    $pre = @($c | Select-Object -Skip 1)
    $exe = & $c[0] @pre -c 'import sys; sys.version_info >= (3, 9) and print(sys.executable)' 2>$null
    if ($LASTEXITCODE -eq 0 -and $exe) { return ([string]$exe).Trim() }
  }
  return $null
}

function Find-FoNode {
  # Node >= 24 from FO_NODE or PATH; returns the path or $null.
  $ErrorActionPreference = 'Continue'
  $node = $env:FO_NODE
  if (-not $node) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $node = $cmd.Source }
  }
  if (-not $node) { return $null }
  if ($env:FO_NODE -and -not (Test-Path -LiteralPath $node -PathType Leaf)) { return $null }
  $v = & $node --version 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $v) { return $null }
  if (([string]$v).Trim() -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) { return $node }
  return $null
}
