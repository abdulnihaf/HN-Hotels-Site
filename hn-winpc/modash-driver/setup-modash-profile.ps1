# setup-modash-profile.ps1
# One-time owner script: opens Chrome with an isolated user-data-dir for the given
# Modash trial account, owner logs in manually, closes Chrome, cookies persist.
# After this, the poller can drive Modash searches under this account autonomously.
#
# Usage:
#   powershell -File C:\Modash\setup-modash-profile.ps1 -ProfileNum 1 -Email "contact@hamzahotel.com"
#   powershell -File C:\Modash\setup-modash-profile.ps1 -ProfileNum 2 -Email "..."
#
# Then register on the API so the poller picks it up:
#   $key = Read-Host -AsSecureString "Dashboard key"
#   ... (see HOWTO.md)

param(
  [Parameter(Mandatory=$true)][int]$ProfileNum,
  [string]$Email = "",
  [string]$ProfilesDir = "C:\hn-control\modash-driver\profiles",
  [string]$ChromeExe = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $ProfilesDir)) {
  New-Item -ItemType Directory -Path $ProfilesDir -Force | Out-Null
  Write-Host "Created $ProfilesDir"
}

$profileDir = Join-Path $ProfilesDir "profile-$ProfileNum"
if (!(Test-Path $profileDir)) {
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

if (!(Test-Path $ChromeExe)) {
  Write-Error "Chrome not found at $ChromeExe — pass -ChromeExe with the actual path."
  exit 1
}

Write-Host ""
Write-Host "===================================================="
Write-Host "  Modash profile setup · profile-$ProfileNum"
Write-Host "  Account email: $Email"
Write-Host "  user-data-dir: $profileDir"
Write-Host "===================================================="
Write-Host ""
Write-Host "STEPS:"
Write-Host "  1. Chrome will open to marketer.modash.io"
Write-Host "  2. Log in with your trial account credentials"
Write-Host "  3. Verify you can see the discovery page"
Write-Host "  4. Close Chrome (cookies will be saved)"
Write-Host ""
Write-Host "Press Enter to continue..."
Read-Host | Out-Null

# Launch Chrome with isolated user-data-dir
& $ChromeExe `
    "--user-data-dir=$profileDir" `
    "--no-first-run" `
    "--no-default-browser-check" `
    "https://marketer.modash.io/discovery/instagram"

Write-Host ""
Write-Host "Profile saved. Cookies are in: $profileDir"
Write-Host ""
Write-Host "NEXT — register this profile so the poller picks it up. From any machine:"
Write-Host ""
Write-Host "  curl -X POST 'https://hnhotels.in/api/influencer-pipeline?action=modash-register-profile' \\"
Write-Host "       -H 'X-Dashboard-Key: <YOUR_DASHBOARD_KEY>' -H 'Content-Type: application/json' \\"
Write-Host "       -d '{\"profile_num\": $ProfileNum, \"email\": \"$Email\"}'"
Write-Host ""
Write-Host "  curl -X POST 'https://hnhotels.in/api/influencer-pipeline?action=modash-mark-active' \\"
Write-Host "       -H 'X-Dashboard-Key: <YOUR_DASHBOARD_KEY>' -H 'Content-Type: application/json' \\"
Write-Host "       -d '{\"profile_num\": $ProfileNum}'"
Write-Host ""
