# C:\hn-control\_shared\acquire-lock.ps1
# Cross-chat advisory lock for shared resources on hn-winpc.
# Used by all 3 (or more) chats coordinating on the appliance.
#
# Lock file: C:\hn-control\.locks\<resource>.lock
# Format: JSON { owner_chat, acquired_at (ISO-8601), ttl_sec }
# Stale locks (older than ttl_sec) are auto-released.
#
# Usage:
#   & "C:\hn-control\_shared\acquire-lock.ps1" -Resource "chrome-tabs" -TimeoutSec 60 -OwnerChat "my-chat-id"
#
# Returns:
#   exit 0 — lock acquired
#   exit 1 — could not acquire within TimeoutSec (other chat holds it, or write failed)

param(
  [Parameter(Mandatory=$true)][string]$Resource,
  [int]$TimeoutSec = 60,
  [string]$OwnerChat = "unknown",
  [int]$TtlSec = 600
)

$ErrorActionPreference = "Stop"

$lockDir = "C:\hn-control\.locks"
if (!(Test-Path $lockDir)) {
  New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
}

$lockFile = Join-Path $lockDir "$Resource.lock"
$start = Get-Date

while ($true) {
  $now = Get-Date

  # If lock file exists, check if it's stale
  if (Test-Path $lockFile) {
    try {
      $existing = Get-Content $lockFile -Raw | ConvertFrom-Json
      $acquiredAt = [datetime]::Parse($existing.acquired_at)
      $age = ($now - $acquiredAt).TotalSeconds
      if ($age -lt $existing.ttl_sec) {
        # Held by another chat, still fresh
        if (($now - $start).TotalSeconds -gt $TimeoutSec) {
          Write-Output "ACQUIRE_FAILED reason=held_by:$($existing.owner_chat) age_sec=$([int]$age)"
          exit 1
        }
        Start-Sleep -Seconds 2
        continue
      }
      # Stale — fall through to overwrite
    } catch {
      # Corrupt lock file — overwrite
    }
  }

  # Write our lock
  $payload = @{
    owner_chat   = $OwnerChat
    resource     = $Resource
    acquired_at  = $now.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    ttl_sec      = $TtlSec
    pid          = $PID
    hostname     = [System.Net.Dns]::GetHostName()
  } | ConvertTo-Json -Compress

  try {
    # Atomic-ish: write to .tmp then rename
    $tmpFile = "$lockFile.tmp.$PID"
    Set-Content -Path $tmpFile -Value $payload -NoNewline -Encoding UTF8
    Move-Item -Path $tmpFile -Destination $lockFile -Force
    Write-Output "ACQUIRED resource=$Resource owner=$OwnerChat ttl_sec=$TtlSec"
    exit 0
  } catch {
    if (($now - $start).TotalSeconds -gt $TimeoutSec) {
      Write-Output "ACQUIRE_FAILED reason=write_error err=$($_.Exception.Message)"
      exit 1
    }
    Start-Sleep -Seconds 2
  }
}
