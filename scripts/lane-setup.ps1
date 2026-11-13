<#
.SYNOPSIS
  Create (or refresh) a lane worktree: branch lane/<name> from main, local data copied in, deps installed, dev port assigned.

.DESCRIPTION
  Idempotent: run it again to re-copy changed data, re-run pnpm i and print the same port.
  - Worktree: <parent of main checkout>\junc26-lanes\<name>, branch lane/<name> from main.
  - Copies .env, data\valio\ and data\venues\ (if present) from the main checkout. These are gitignored or uncommitted: never commit them.
  - Runs pnpm i inside the worktree. Never junction or symlink node_modules: `git worktree remove --force` deletes through links.
  - Picks a dev port in 5171-5179 that is neither listening nor recorded by another lane, and records it in scratch\lane-port.

.EXAMPLE
  pwsh scripts/lane-setup.ps1 kitchen
  pwsh scripts/lane-setup.ps1 kitchen -Port 5173 -SkipInstall
#>
param(
	[Parameter(Mandatory = $true, Position = 0)][ValidatePattern('^[a-z0-9][a-z0-9-]*$')][string]$Name,
	[int]$Port = 0,
	[string]$Base = 'main',
	[switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'

# The main checkout is the first entry of `git worktree list`, wherever this script is run from.
$mainRoot = ((git worktree list --porcelain | Select-Object -First 1) -replace '^worktree ', '').Trim()
if (-not $mainRoot) { throw 'Not inside a git repository.' }
$mainRoot = (Resolve-Path $mainRoot).Path
$lanesRoot = Join-Path (Split-Path $mainRoot -Parent) 'junc26-lanes'
$wt = Join-Path $lanesRoot $Name
$branch = "lane/$Name"

# 1. Worktree and branch (reuse when present).
git -C $mainRoot worktree prune
$listed = git -C $mainRoot worktree list --porcelain | Where-Object { $_ -like 'worktree *' } |
	ForEach-Object { (($_ -replace '^worktree ', '') -replace '/', '\').TrimEnd('\') }
if ($listed -contains $wt.TrimEnd('\')) {
	Write-Host "worktree  exists: $wt"
} else {
	New-Item -ItemType Directory -Force $lanesRoot | Out-Null
	git -C $mainRoot show-ref --verify --quiet "refs/heads/$branch"
	if ($LASTEXITCODE -eq 0) {
		git -C $mainRoot worktree add $wt $branch
	} else {
		git -C $mainRoot worktree add -b $branch $wt $Base
	}
	if ($LASTEXITCODE -ne 0) { throw "git worktree add failed for $wt" }
	Write-Host "worktree  created: $wt ($branch from $Base)"
}

# 2. Local-only files. robocopy /E /XO copies new and newer files only, so re-runs are cheap.
$envSrc = Join-Path $mainRoot '.env'
if (Test-Path $envSrc) { Copy-Item $envSrc (Join-Path $wt '.env') -Force; Write-Host 'copied    .env' }
else { Write-Warning '.env not found in the main checkout; the lane runs in fixture mode only.' }
foreach ($d in 'data\valio', 'data\venues') {
	$src = Join-Path $mainRoot $d
	if (Test-Path $src) {
		robocopy $src (Join-Path $wt $d) /E /XO /NFL /NDL /NJH /NJS /NP | Out-Null
		if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $d (exit $LASTEXITCODE)" }
		$global:LASTEXITCODE = 0
		Write-Host "copied    $d"
	}
}

# 3. Dependencies, installed inside the worktree.
if (-not $SkipInstall) {
	Push-Location $wt
	try { pnpm i; if ($LASTEXITCODE -ne 0) { throw 'pnpm i failed' } } finally { Pop-Location }
}

# 4. Dev port: keep the recorded one; otherwise the first in 5171-5179 not taken by another lane or a listener.
$portFile = Join-Path $wt 'scratch\lane-port'
New-Item -ItemType Directory -Force (Split-Path $portFile) | Out-Null
if ($Port -eq 0 -and (Test-Path $portFile)) { $Port = [int](Get-Content $portFile -Raw) }
if ($Port -eq 0) {
	$taken = @()
	if (Test-Path $lanesRoot) {
		$taken += Get-ChildItem $lanesRoot -Directory | Where-Object { $_.FullName -ne $wt } |
			ForEach-Object { Join-Path $_.FullName 'scratch\lane-port' } | Where-Object { Test-Path $_ } |
			ForEach-Object { [int](Get-Content $_ -Raw) }
	}
	$listening = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object LocalPort)
	$Port = 5171..5179 | Where-Object { $taken -notcontains $_ -and $listening -notcontains $_ } | Select-Object -First 1
	if (-not $Port) { throw 'No free port in 5171-5179. Remove an idle lane worktree or pass -Port.' }
}
Set-Content -Path $portFile -Value $Port -NoNewline

Write-Host ''
Write-Host "lane      $Name"
Write-Host "branch    $branch"
Write-Host "path      $wt"
Write-Host "port      $Port"
Write-Host "run       cd `"$wt`"; pnpm dev --port $Port --strictPort"
