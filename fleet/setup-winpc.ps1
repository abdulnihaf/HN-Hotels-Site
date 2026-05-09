# setup-winpc.ps1 - one-shot onboarding for the HN office Windows PC appliance.
#
# Target hardware: HP EliteDesk 800 G3 DM 35W (or any Windows 10/11 machine).
#
# Run as Administrator. Right-click PowerShell -> "Run as Administrator", then:
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\setup-winpc.ps1
#
# What this does (idempotent - safe to re-run):
#   1. Renames PC to hn-winpc.
#   2. Enables OpenSSH Server (built into Windows 10/11).
#   3. Authorizes the laptop's SSH pubkey for passwordless login (BOTH locations
#      because Windows OpenSSH treats admin users specially).
#   4. Installs Tailscale via the latest MSI from pkgs.tailscale.com.
#   5. Configures power plan for always-on appliance use (never sleep, never
#      hibernate, USB selective suspend off).
#   6. Disables Windows Update reboot prompts during business hours.
#   7. Captures device fingerprint for fleet/devices.json.
#
# What this does NOT do (you do these manually):
#   - Sign into Tailscale (run `tailscale up` after install OR use the auth key
#     baked in the TAILSCALE_AUTHKEY var below - get one from
#     login.tailscale.com/admin/settings/keys, reusable, ephemeral=OFF).
#   - Install Google Chrome (download from google.com/chrome - Edge alone is
#     insufficient because the aggregator extension targets Chrome MV3).
#   - Log in to Swiggy + Zomato partner portals.
#   - Load the aggregator-pulse extension into Chrome.
#
# The script exits non-zero on the first hard failure but logs every step.

#Requires -RunAsAdministrator

# Tailscale auth key: pass via -AuthKey arg OR $env:TS_AUTHKEY at runtime; do NOT
# hardcode (this script is in the repo). Run as one of:
#   $env:TS_AUTHKEY = 'tskey-auth-...'; .\setup-winpc.ps1
#   .\setup-winpc.ps1 -AuthKey 'tskey-auth-...'
param(
    [string]$AuthKey = ''
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# --- CONFIG -------------------------------------------------------------------
$LaptopPubkey      = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE3dsouKr9nCWMyc1AWtfYuT9vHIqygSWCUVcMkuW9Lb nihaf-laptop@hn-fleet'
$TargetHostname    = 'hn-winpc'
$TailscaleAuthKey  = if ($AuthKey) { $AuthKey } elseif ($env:TS_AUTHKEY) { $env:TS_AUTHKEY } else { '' }
$TailscaleMsiUrl   = 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi'

# --- helpers ------------------------------------------------------------------
function Section($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Ok($msg)      { Write-Host "  [OK]  $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "  [..]  $msg" -ForegroundColor Yellow }
function Fail($msg)    { Write-Host "  [!!]  $msg" -ForegroundColor Red; exit 1 }

# --- 0. preflight -------------------------------------------------------------
Section "Preflight"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail "Must run as Administrator. Right-click PowerShell -> Run as Administrator."
}
Ok "Running as Administrator"

$winVer = [System.Environment]::OSVersion.Version
Ok ("Windows version: {0}.{1}.{2}.{3}" -f $winVer.Major, $winVer.Minor, $winVer.Build, $winVer.Revision)

# --- 1. hostname --------------------------------------------------------------
Section "Hostname -> $TargetHostname"

$current = $env:COMPUTERNAME
if ($current -ieq $TargetHostname) {
    Ok "Hostname already $TargetHostname"
} else {
    Rename-Computer -NewName $TargetHostname -Force
    Ok "Hostname: $current -> $TargetHostname (takes effect after reboot)"
    Warn "Reboot required at end of script for hostname to take effect"
    $script:NeedsReboot = $true
}

# --- 2. OpenSSH Server --------------------------------------------------------
Section "OpenSSH Server"

$sshd = Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'
if ($sshd.State -ne 'Installed') {
    Warn "Installing OpenSSH Server (may take a minute)..."
    Add-WindowsCapability -Online -Name $sshd.Name | Out-Null
    Ok "OpenSSH Server installed"
} else {
    Ok "OpenSSH Server already installed"
}

Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
Ok "sshd service: running, auto-start"

# Firewall rule for inbound SSH on port 22.
$rule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
if (-not $rule) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
    Ok "Firewall: inbound TCP/22 allowed"
} else {
    Ok "Firewall rule already exists"
}

# Make sshd_config use the modern key types & disable password auth (key-only).
$sshdConfig = "$env:ProgramData\ssh\sshd_config"
if (Test-Path $sshdConfig) {
    $cfg = Get-Content $sshdConfig -Raw
    $changed = $false
    if ($cfg -notmatch '(?m)^\s*PasswordAuthentication\s+no') {
        $cfg = $cfg -replace '(?m)^\s*#?\s*PasswordAuthentication\s+\w+', 'PasswordAuthentication no'
        if ($cfg -notmatch '(?m)^\s*PasswordAuthentication\s+no') { $cfg += "`nPasswordAuthentication no" }
        $changed = $true
    }
    if ($cfg -notmatch '(?m)^\s*PubkeyAuthentication\s+yes') {
        $cfg = $cfg -replace '(?m)^\s*#?\s*PubkeyAuthentication\s+\w+', 'PubkeyAuthentication yes'
        if ($cfg -notmatch '(?m)^\s*PubkeyAuthentication\s+yes') { $cfg += "`nPubkeyAuthentication yes" }
        $changed = $true
    }
    if ($changed) {
        Set-Content -Path $sshdConfig -Value $cfg -Encoding ASCII
        Restart-Service sshd
        Ok "sshd_config: PasswordAuth=off, PubkeyAuth=on (sshd restarted)"
    } else {
        Ok "sshd_config: already key-only"
    }
}

# --- 3. authorize laptop pubkey -----------------------------------------------
Section "Authorize laptop SSH pubkey"

# CRITICAL Windows quirk: members of the Administrators group do NOT use
# %USERPROFILE%\.ssh\authorized_keys. They use a system-wide file at
# C:\ProgramData\ssh\administrators_authorized_keys. We populate both so this
# works whether the user is admin or not.

# 3a. user authorized_keys (for non-admin users)
$userSshDir = Join-Path $env:USERPROFILE '.ssh'
if (-not (Test-Path $userSshDir)) { New-Item -ItemType Directory -Path $userSshDir | Out-Null }
$userAuth = Join-Path $userSshDir 'authorized_keys'
if (-not (Test-Path $userAuth)) { New-Item -ItemType File -Path $userAuth | Out-Null }
$content = if (Test-Path $userAuth) { Get-Content $userAuth -ErrorAction SilentlyContinue } else { @() }
if ($content -notcontains $LaptopPubkey) {
    Add-Content -Path $userAuth -Value $LaptopPubkey
    Ok "User authorized_keys: pubkey appended"
} else {
    Ok "User authorized_keys: already has pubkey"
}

# 3b. administrators_authorized_keys (for admin users - including the default
#     account on most home Windows installs).
$adminAuth = "$env:ProgramData\ssh\administrators_authorized_keys"
$adminAuthDir = Split-Path $adminAuth
if (-not (Test-Path $adminAuthDir)) { New-Item -ItemType Directory -Path $adminAuthDir | Out-Null }
if (-not (Test-Path $adminAuth)) { New-Item -ItemType File -Path $adminAuth | Out-Null }
$content2 = Get-Content $adminAuth -ErrorAction SilentlyContinue
if ($content2 -notcontains $LaptopPubkey) {
    Add-Content -Path $adminAuth -Value $LaptopPubkey
    Ok "administrators_authorized_keys: pubkey appended"
} else {
    Ok "administrators_authorized_keys: already has pubkey"
}

# ACL on administrators_authorized_keys MUST allow only Administrators + SYSTEM,
# else sshd silently refuses to use the file (Windows OpenSSH security check).
icacls $adminAuth /inheritance:r 2>&1 | Out-Null
icacls $adminAuth /grant 'Administrators:F' 'SYSTEM:F' 2>&1 | Out-Null
icacls $adminAuth /remove 'Authenticated Users' 'Users' "$env:USERNAME" 2>&1 | Out-Null
Ok "administrators_authorized_keys: ACL locked to Administrators + SYSTEM"

# --- 4. Tailscale -------------------------------------------------------------
Section "Tailscale install"

$tailscaleExe = "$env:ProgramFiles\Tailscale\tailscale.exe"
if (Test-Path $tailscaleExe) {
    Ok "Tailscale already installed at $tailscaleExe"
} else {
    Warn "Downloading Tailscale MSI from $TailscaleMsiUrl"
    $msi = Join-Path $env:TEMP 'tailscale-setup.msi'
    Invoke-WebRequest -Uri $TailscaleMsiUrl -OutFile $msi -UseBasicParsing
    Warn "Installing (silent)..."
    Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/quiet', '/qn', '/norestart' -Wait
    if (Test-Path $tailscaleExe) {
        Ok "Tailscale installed at $tailscaleExe"
        Remove-Item $msi -Force -ErrorAction SilentlyContinue
    } else {
        Fail "Tailscale MSI install reported success but binary missing. Try a manual install from https://tailscale.com/download/windows"
    }
}

# Sign in if an auth key was provided.
if ($TailscaleAuthKey -and $TailscaleAuthKey -match '^tskey-') {
    Warn "Signing into Tailscale with provided auth key (--accept-routes off, no-exit-node)..."
    & $tailscaleExe up `
        --authkey=$TailscaleAuthKey `
        --hostname=$TargetHostname `
        --advertise-tags='' `
        --accept-routes=false `
        --advertise-exit-node=false `
        --shields-up=false 2>&1 | Out-Host
    Ok "Tailscale: signed in (or already up)"
} else {
    Warn "No auth key configured. After this script completes, run from elevated PowerShell:"
    Warn "  & '$tailscaleExe' up --hostname=$TargetHostname"
    Warn "Then complete the browser sign-in with nihafwork@gmail.com."
}

# --- 5. always-on power settings ----------------------------------------------
Section "Power plan (appliance-mode: never sleep)"

# High Performance plan
powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>&1 | Out-Null
Ok "Active plan: High Performance"

# Never sleep / hibernate / turn off disk on AC.
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0
powercfg /change disk-timeout-ac 0
powercfg /change monitor-timeout-ac 30
Ok "Sleep=never, hibernate=never, disk=never, monitor=30min idle"

# Disable USB selective suspend (network adapter on USB-C docks gets killed otherwise).
$sub = '2a737441-1930-4402-8d77-b2bebba308a3'  # USB settings
$set = '48e6b7a6-50f5-4782-a5d4-53bb8f07e226'  # USB selective suspend
powercfg /SETACVALUEINDEX SCHEME_CURRENT $sub $set 0 2>&1 | Out-Null
powercfg /SETDCVALUEINDEX SCHEME_CURRENT $sub $set 0 2>&1 | Out-Null
powercfg -s SCHEME_CURRENT 2>&1 | Out-Null
Ok "USB selective suspend disabled"

# --- 6. Windows Update - defer reboots ----------------------------------------
Section "Windows Update - defer reboots during business hours"

# Active hours: 06:00 to 23:00 (Windows won't auto-reboot during this window).
$wuKey = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
if (Test-Path $wuKey) {
    Set-ItemProperty -Path $wuKey -Name 'ActiveHoursStart' -Value 6 -Type DWord -ErrorAction SilentlyContinue
    Set-ItemProperty -Path $wuKey -Name 'ActiveHoursEnd' -Value 23 -Type DWord -ErrorAction SilentlyContinue
    Ok "Active hours: 06:00-23:00 (no auto-reboot during this window)"
} else {
    Warn "WindowsUpdate settings key not found - skipping active hours config"
}

# --- 7. capture device fingerprint --------------------------------------------
Section "Device fingerprint"

$os    = Get-CimInstance Win32_OperatingSystem
$cs    = Get-CimInstance Win32_ComputerSystem
$cpu   = Get-CimInstance Win32_Processor | Select-Object -First 1
$disk  = Get-CimInstance Win32_DiskDrive | Where-Object MediaType -match 'Fixed' | Select-Object -First 1
$net   = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -and $_.IPAddress } | Select-Object -First 1
$ip    = if ($net) { ($net.IPAddress | Where-Object { $_ -match '^\d+\.' } | Select-Object -First 1) } else { '?' }

$ramGb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
$diskGb = if ($disk) { [math]::Round($disk.Size / 1GB, 0) } else { '?' }

@"

----------------------------------------------------------
Paste this into fleet/devices.json on the LAPTOP, replacing
the existing hn-winpc block:
----------------------------------------------------------

  "hn-winpc": {
    "role": "appliance-primary",
    "primary_user": "$env:USERNAME",
    "platform": "windows",
    "os_family": "$([regex]::Match($os.Caption, 'Windows \d+').Value)",
    "os_version": "$($os.Version)",
    "os_edition": "$($os.Caption)",
    "os_build": "$($os.BuildNumber)",
    "arch": "$env:PROCESSOR_ARCHITECTURE",
    "model": "$($cs.Manufacturer) $($cs.Model)",
    "chip": "$($cpu.Name.Trim())",
    "ram_gb": $ramGb,
    "storage_gb": $diskGb,
    "hostname_local": "$TargetHostname",
    "hostname_tailscale": "$TargetHostname",
    "local_ip_at_setup": "$ip",
    "registered_at": "$(Get-Date -Format 'yyyy-MM-dd')",
    "always_on": true,
    "purpose": "PRIMARY appliance - aggregator pulse runs here (Chrome + extension 24/7).",
    "capabilities": ["chrome-runtime", "aggregator-pulse", "windows-automation"]
  }

----------------------------------------------------------
"@ | Write-Host

# --- 8. final manual steps ----------------------------------------------------
Section "Manual steps you still need to do"
Write-Host @"

  1. If no auth key was used: run
       & 'C:\Program Files\Tailscale\tailscale.exe' up --hostname=$TargetHostname
     and complete browser sign-in with nihafwork@gmail.com.

  2. Install Google Chrome from https://www.google.com/chrome
     (Edge alone is not enough - aggregator extension targets Chrome MV3).

  3. Chrome -> Settings -> On startup -> "Continue where you left off".
     Log in to:
       https://partner.swiggy.com/food/
       https://www.zomato.com/partners/

  4. Settings -> Apps -> Startup -> toggle Google Chrome ON
     (auto-launches on boot/login).

  5. From the LAPTOP, run:  ./fleet/verify-bridge.sh hn-winpc
     to confirm the bridge is up.

  6. Once verified, the aggregator extension gets pushed from laptop and
     loaded in Chrome. (Separate step - not this script.)

"@ -ForegroundColor Yellow

if ($script:NeedsReboot) {
    Section "Reboot required"
    Warn "The hostname change requires a reboot."
    Write-Host "  Reboot now? (Y/n): " -NoNewline
    $reply = Read-Host
    if ($reply -ieq '' -or $reply -ieq 'y') {
        Restart-Computer -Force
    } else {
        Warn "Reboot when convenient. Setup is otherwise complete."
    }
}

Ok "Setup script done. Hostname will be $TargetHostname after reboot."
