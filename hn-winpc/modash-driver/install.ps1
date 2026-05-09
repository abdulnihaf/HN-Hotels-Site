# install.ps1 — one-time hn-winpc setup for the Modash poller.
#
# What this does:
#   1. Verifies Node.js >= 18 is installed (installs via winget if missing)
#   2. cd into the modash-driver dir, runs `npm ci` to install Playwright
#   3. Installs Playwright's bundled Chromium (separate from the aggregator Chrome —
#      this is a Playwright-managed Chromium, doesn't touch the system Chrome)
#   4. Creates the C:\Modash\profiles\ directory
#   5. Registers a Windows Scheduled Task that runs the poller at user logon
#
# Run AS the "HN Hotels" user (the one running aggregator-pulse), in PowerShell.
#
# Usage:
#   cd C:\Modash\modash-driver
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -CronToken "<paste CRON_TOKEN>"

param(
  [Parameter(Mandatory=$true)][string]$CronToken,
  [string]$InstallDir = "C:\Modash\modash-driver",
  [string]$ProfilesDir = "C:\Modash\profiles"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Modash poller install ==="
Write-Host "Install dir: $InstallDir"
Write-Host "Profiles dir: $ProfilesDir"
Write-Host ""

# 1. Verify Node.js
try {
  $nodeVer = node --version 2>$null
  Write-Host "Node.js detected: $nodeVer"
  if ($nodeVer -match 'v(\d+)\.' -and [int]$matches[1] -lt 18) {
    Write-Error "Node.js >= 18 required. Got $nodeVer."
    exit 1
  }
} catch {
  Write-Host "Node.js not found. Installing via winget..."
  winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
  Write-Host "Node installed. You may need to restart this PowerShell session before continuing."
  exit 0
}

# 2. Install npm deps
Write-Host "Installing dependencies..."
Push-Location $InstallDir
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
  Write-Error "npm ci failed"
  Pop-Location; exit 1
}

# 3. Install Playwright Chromium (isolated from system Chrome)
Write-Host "Installing Playwright Chromium..."
npx playwright install chromium
if ($LASTEXITCODE -ne 0) {
  Write-Error "playwright install failed"
  Pop-Location; exit 1
}
Pop-Location

# 4. Profiles directory
if (!(Test-Path $ProfilesDir)) {
  New-Item -ItemType Directory -Path $ProfilesDir -Force | Out-Null
  Write-Host "Created $ProfilesDir"
}

# 5. Save CRON_TOKEN as user env var (persists across sessions)
[System.Environment]::SetEnvironmentVariable("CRON_TOKEN", $CronToken, "User")
[System.Environment]::SetEnvironmentVariable("MODASH_PROFILES_DIR", $ProfilesDir, "User")
[System.Environment]::SetEnvironmentVariable("MODASH_API_BASE", "https://hnhotels.in/api/influencer-pipeline", "User")
Write-Host "Saved env vars (User scope)."

# 6. Register Scheduled Task — runs at logon, restarts on failure
$taskName = "HN-Modash-Poller"
$nodePath = (Get-Command node).Source
$pollerPath = Join-Path $InstallDir "poller.js"
$logPath = Join-Path $InstallDir "poller.log"

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument "`"$pollerPath`"" `
  -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -RestartCount 999 `
  -ExecutionTimeLimit (New-TimeSpan -Days 365) `
  -StartWhenAvailable

# Remove existing task if present
schtasks /Delete /TN $taskName /F 2>$null | Out-Null

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Polls hnhotels.in for Modash search jobs and runs them under pre-logged Chromium profiles." `
  -RunLevel Limited `
  -Force | Out-Null

Write-Host ""
Write-Host "Scheduled Task registered: $taskName"
Write-Host "Logs: $logPath"
Write-Host ""
Write-Host "=== Install done ==="
Write-Host ""
Write-Host "NEXT STEPS:"
Write-Host "  For each Modash account (1..N):"
Write-Host "    powershell -File $InstallDir\setup-modash-profile.ps1 -ProfileNum 1 -Email '<email>'"
Write-Host "    (then register via curl — see setup script output)"
Write-Host ""
Write-Host "  Start the poller now without waiting for next logon:"
Write-Host "    Start-ScheduledTask -TaskName $taskName"
Write-Host ""
Write-Host "  Verify it's running:"
Write-Host "    Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo"
Write-Host "    Get-Content $logPath -Tail 20"
