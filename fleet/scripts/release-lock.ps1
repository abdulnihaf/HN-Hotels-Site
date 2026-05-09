# C:\hn-control\_shared\release-lock.ps1
# Release a previously-acquired cross-chat lock.
#
# Usage:
#   & "C:\hn-control\_shared\release-lock.ps1" -Resource "chrome-tabs" [-OwnerChat "my-chat-id"]
#
# If -OwnerChat is provided, only releases the lock if it's owned by that chat
# (defends against accidentally releasing someone else's lock).
# If omitted, force-releases regardless of owner.

param(
  [Parameter(Mandatory=$true)][string]$Resource,
  [string]$OwnerChat = ""
)

$lockFile = Join-Path "C:\hn-control\.locks" "$Resource.lock"

if (!(Test-Path $lockFile)) {
  Write-Output "RELEASE_OK reason=no_lock_file"
  exit 0
}

if ($OwnerChat) {
  try {
    $existing = Get-Content $lockFile -Raw | ConvertFrom-Json
    if ($existing.owner_chat -ne $OwnerChat) {
      Write-Output "RELEASE_REFUSED reason=owned_by:$($existing.owner_chat) you_are:$OwnerChat"
      exit 1
    }
  } catch {
    # Corrupt — release it
  }
}

try {
  Remove-Item $lockFile -Force
  Write-Output "RELEASE_OK resource=$Resource"
  exit 0
} catch {
  Write-Output "RELEASE_FAILED err=$($_.Exception.Message)"
  exit 1
}
