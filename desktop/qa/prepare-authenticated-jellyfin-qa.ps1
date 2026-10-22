# Prepare, but NEVER launch, install, sign or publish the real-account QA.
# It is safe to run while the user's installed Vynéo 0.2.4 is open.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:COMPUTERNAME -notin @('JJJ','COCO') -or $env:USERNAME -cne 'bindl') {
  throw 'ONLY_AUTHORIZED_WINDOWS_COCO_QA'
}
$desktop = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$expectedDesktop = 'E:\Projects\Vyneo-Jellyfin-Parity-QA\desktop'
if ($desktop -cne $expectedDesktop) { throw 'QA_WORKTREE_MISMATCH' }
$base = Get-Content -LiteralPath (Join-Path $desktop 'src-tauri/tauri.conf.json') -Encoding UTF8 -Raw |
  ConvertFrom-Json
$config = Get-Content -LiteralPath (Join-Path $desktop 'src-tauri/tauri.authenticated-qa.conf.json') -Encoding UTF8 -Raw |
  ConvertFrom-Json
if ($base.identifier -cne 'fr.visyren.vyneo.desktop' -or
    $config.identifier -cne 'fr.visyren.vyneo.desktop.authqa' -or
    $config.build.frontendDist -cne '../frontend/dist' -or
    $config.bundle.createUpdaterArtifacts -ne $false) {
  throw 'AUTHENTICATED_QA_IDENTITY_OR_CONFIG_INVALID'
}
$entries = @(Get-ItemProperty -Path @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
) -ErrorAction SilentlyContinue | Where-Object {
  $_.PSObject.Properties.Match('DisplayName').Count -gt 0 -and
  $_.DisplayName -ceq $base.productName
})
if ($entries.Count -ne 1 -or $entries[0].DisplayVersion -cne '0.2.4') {
  throw 'EXACTLY_ONE_VYNEO_STABLE_024_REQUIRED'
}
$stableExe = Join-Path ([string]$entries[0].InstallLocation).Trim('"') 'vyneo-desktop.exe'
if (-not (Test-Path -LiteralPath $stableExe)) { throw 'STABLE_EXE_NOT_FOUND' }
$hashBefore = (Get-FileHash -LiteralPath $stableExe -Algorithm SHA256).Hash
$qaBinary = Join-Path $desktop 'src-tauri/target/debug/vyneo-desktop.exe'
$destination = Join-Path $env:TEMP 'vyneo-auth-qa-portable'
try {
  # SSH PowerShell does not always inherit the interactive Rust PATH.
  # Use the ALREADY installed toolchain, without touching system settings.
  $cargoBin = Join-Path $env:USERPROFILE '.cargo/bin'
  if (-not (Test-Path -LiteralPath (Join-Path $cargoBin 'cargo.exe'))) {
    throw 'EXISTING_RUST_TOOLCHAIN_NOT_FOUND'
  }
  $oldPath = $env:PATH
  $env:PATH = $cargoBin + ';' + $oldPath
  Push-Location $desktop
  try {
    # PowerShell 5.1 promotes harmless native stderr (Vite/Rust warnings)
    # to error records. Validate the real exit code for each command.
    $oldPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      npm.cmd run check
      $checkExit = $LASTEXITCODE
      if ($checkExit -ne 0) { throw 'AUTH_QA_FRONTEND_CHECK_FAILED' }
      npm.cmd run tauri -- build --debug --no-bundle --features interactive-jellyfin-qa --config src-tauri/tauri.authenticated-qa.conf.json
      $buildExit = $LASTEXITCODE
      if ($buildExit -ne 0) { throw 'AUTH_QA_BUILD_FAILED' }
    } finally { $ErrorActionPreference = $oldPreference }
  } finally {
    Pop-Location
    $env:PATH = $oldPath
  }
  if (-not (Test-Path -LiteralPath $qaBinary)) {
    throw 'AUTH_QA_PORTABLE_BINARY_MISSING'
  }
  $null = New-Item -ItemType Directory -Path $destination -Force
  Copy-Item -LiteralPath $qaBinary -Destination (Join-Path $destination 'vyneo-auth-qa.exe') -Force
  Write-Output 'VYNEO_AUTHENTICATED_QA_COMPILED_NO_INSTALL_NO_LAUNCH'
  Write-Output ('QA_PORTABLE_PATH=' + (Join-Path $destination 'vyneo-auth-qa.exe'))
} finally {
  if (-not (Test-Path -LiteralPath $stableExe) -or
      (Get-FileHash -LiteralPath $stableExe -Algorithm SHA256).Hash -cne $hashBefore) {
    throw 'QA_CHANGED_STABLE_BINARY'
  }
}
