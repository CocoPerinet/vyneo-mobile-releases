# A disposable GitHub-hosted Windows-only integration test. NEVER run on COCO.
# Uses the real last signed Desktop NSIS as baseline and an unsigned
# higher-version candidate built locally from this PR. Neither is published.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_OS -ne 'Windows' -or
    [string]::IsNullOrEmpty($env:RUNNER_TEMP) -or
    [string]::IsNullOrEmpty($env:GITHUB_WORKSPACE) -or
    $env:GITHUB_EVENT_NAME -ne 'pull_request' -or
    $env:GITHUB_REPOSITORY -ne 'CocoPerinet/vyneo-mobile-releases' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'QA_HOSTED_GITHUB_PR_WINDOWS_RUNNER_REQUIRED'
}
if ((Get-Location).Path -ne (Resolve-Path (Join-Path $env:GITHUB_WORKSPACE 'desktop')).Path) {
  throw 'QA_WORKTREE_MISMATCH'
}

$repo = 'CocoPerinet/vyneo-mobile-releases'
$packageVersion = [version]((Get-Content -LiteralPath 'package.json' -Raw |
  ConvertFrom-Json).version)
$productName = (Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw |
  ConvertFrom-Json).productName

# Select the most recent non-prerelease Desktop release. Never pick Android,
# Preview, a release candidate, or an unreleased version from PR metadata.
$releases = @(gh release list -R $repo --limit 100 --json tagName,isPrerelease |
  ConvertFrom-Json | Where-Object {
    -not $_.isPrerelease -and $_.tagName -match '^desktop-v\d+\.\d+\.\d+$'
  } | Sort-Object { [version]($_.tagName -replace '^desktop-v','') } -Descending)
if ($LASTEXITCODE -ne 0 -or $releases.Count -eq 0) {
  throw 'NO_PUBLIC_DESKTOP_STABLE_BASELINE'
}
$baselineTag = $releases[0].tagName
$baselineVersion = [version]($baselineTag -replace '^desktop-v','')
if ($baselineVersion -gt $packageVersion) {
  throw 'CI_BASELINE_NEWER_THAN_PROJECT_VERSION'
}
$upgradeVersion = if ($packageVersion -gt $baselineVersion) {
  $packageVersion.ToString()
} else {
  ([version]::new($baselineVersion.Major, $baselineVersion.Minor,
    $baselineVersion.Build + 1)).ToString()
}
$dir = Join-Path $env:RUNNER_TEMP 'vyneo-nsis-upgrade-only'
$null = New-Item -ItemType Directory -Force -Path $dir
$config = Join-Path $dir 'upgraded-version.json'
@{ version = $upgradeVersion; bundle = @{ createUpdaterArtifacts = $false } } |
  ConvertTo-Json -Depth 5 |
  Set-Content -LiteralPath $config -Encoding utf8

$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
function Get-InstalledVyneo {
  $found = @(
    foreach ($root in $uninstallRoots) {
      Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
        Where-Object {
          $_.PSObject.Properties.Match('DisplayName').Count -gt 0 -and
          $_.DisplayName -ceq $productName
        }
    }
  )
  return $found
}
function Require-One([string]$expected) {
  $installed = @(Get-InstalledVyneo)
  if ($installed.Count -ne 1) {
    throw "INSTALL_ENTRY_COUNT_WRONG_$expected=$($installed.Count)"
  }
  if ($installed[0].DisplayVersion -ne $expected) {
    throw "INSTALL_VERSION_WRONG_EXPECTED_$expected"
  }
  return $installed[0]
}
function Run-Silent([string]$exe) {
  if (-not (Test-Path -LiteralPath $exe)) {
    throw 'SIGNED_OR_UNSIGNED_INSTALLER_MISSING'
  }
  $process = Start-Process -FilePath $exe -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "NSIS_SILENT_INSTALL_FAILED_EXIT=$($process.ExitCode)"
  }
}
function Installed-Binary([object]$item) {
  $location = [string]$item.InstallLocation
  $exe = Join-Path $location.Trim('"') 'vyneo-desktop.exe'
  if (-not (Test-Path -LiteralPath $exe)) {
    throw 'INSTALLED_BINARY_NOT_FOUND'
  }
  return $exe
}

$marker = Join-Path $env:APPDATA 'fr.visyren.vyneo.desktop\upgrade-smoke.marker'
$installedByTest = $false
try {
  if (@(Get-InstalledVyneo).Count -ne 0) {
    throw 'RUNNER_ALREADY_HAS_VYNEO_INSTALLED'
  }
  $oldAsset = "Vyneo-Desktop-$($baselineVersion.ToString())-windows-x64.exe"
  gh release download $baselineTag -R $repo --pattern $oldAsset --dir $dir
  if ($LASTEXITCODE -ne 0) { throw 'PREVIOUS_SIGNED_INSTALLER_DOWNLOAD_FAILED' }
  $oldExe = Join-Path $dir $oldAsset
  if ((Get-Item -LiteralPath $oldExe).Length -lt 1000000) {
    throw 'BASELINE_INSTALLER_UNEXPECTED_SIZE'
  }
  Write-Output "NSIS_QA_BASELINE=$baselineTag"

  # Never execute even the published stable installer before verifying it
  # against the public key EMBEDDED in the installed stable Tauri client.
  gh release download $baselineTag -R $repo --pattern ($oldAsset + '.sig') --dir $dir
  if ($LASTEXITCODE -ne 0) { throw 'PREVIOUS_SIGNED_INSTALLER_SIGNATURE_MISSING' }
  $stableSig = $oldExe + '.sig'
  $stablePub = Join-Path $dir 'pinned-stable-public.pub'
  $stableConfig = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw |
    ConvertFrom-Json
  $pinnedKey = [string]$stableConfig.plugins.updater.pubkey
  if ([string]::IsNullOrWhiteSpace($pinnedKey)) {
    throw 'PINNED_STABLE_PUBLIC_KEY_MISSING'
  }
  [System.IO.File]::WriteAllText($stablePub,$pinnedKey)
  cargo run --quiet --locked --manifest-path qa/signed-update-verifier/Cargo.toml -- $stablePub $stableSig $oldExe
  if ($LASTEXITCODE -ne 0) { throw 'PUBLISHED_STABLE_INSTALLER_SIGNATURE_INVALID' }
  Write-Output 'VYNEO_PUBLISHED_STABLE_PINNED_KEY_PASS'

  Run-Silent $oldExe
  $installedByTest = $true
  $previous = Require-One ($baselineVersion.ToString())
  $beforeKey = $previous.PSChildName
  $beforePath = Installed-Binary $previous
  $beforeSha = (Get-FileHash -LiteralPath $beforePath -Algorithm SHA256).Hash
  Write-Output "NSIS_QA_OLD_SIGNED_INSTALLER_PASS"

  # Marker models application data in AppData, not the installation folder.
  $null = New-Item -ItemType Directory -Force -Path (Split-Path $marker)
  [System.IO.File]::WriteAllText($marker,'user-data-survives-upgrade')

  # This version override exists only on this hosted runner. Keep the
  # production identifier, product name and native updater configuration.
  npm run tauri -- build --bundles nsis --config $config
  if ($LASTEXITCODE -ne 0) { throw 'QA_VERSION_OVERRIDE_BUILD_FAILED' }
  $candidates = @(Get-ChildItem -LiteralPath 'src-tauri/target/release/bundle/nsis' |
    Where-Object { $_.Name -eq "Vynéo_$($upgradeVersion)_x64-setup.exe" })
  if ($candidates.Count -ne 1) {
    throw 'EXPECTED_EXACTLY_ONE_UPGRADE_INSTALLER'
  }
  # Sign the exact candidate with a disposable key, verify intact bytes,
  # reject a tampered copy. This is not the production Tauri update key.
  & ./qa/verify-ephemeral-updater-signature.ps1 -Artifact $candidates[0].FullName
  if (-not $?) { throw 'SIGNED_NSIS_SECURITY_SMOKE_FAILED' }
  Run-Silent $candidates[0].FullName
  $upgraded = Require-One $upgradeVersion
  if ($upgraded.PSChildName -ne $beforeKey) {
    throw 'UPGRADE_CHANGED_UNINSTALL_KEY_CREATED_SECOND_APP'
  }
  $afterPath = Installed-Binary $upgraded
  if ($afterPath -ne $beforePath) {
    throw 'UPGRADE_CHANGED_INSTALL_DIRECTORY'
  }
  $afterSha = (Get-FileHash -LiteralPath $afterPath -Algorithm SHA256).Hash
  if ($afterSha -eq $beforeSha) {
    throw 'UPGRADE_DID_NOT_REPLACE_BINARY'
  }
  if ([System.IO.File]::ReadAllText($marker) -ne 'user-data-survives-upgrade') {
    throw 'UPGRADE_LOST_USER_DATA'
  }
  Write-Output "VYNEO_WINDOWS_NSIS_IN_PLACE_UPGRADE_PASS baseline=$($baselineVersion.ToString()) upgraded=$upgradeVersion entries=1 user_data=preserved"
} finally {
  # The dedicated GitHub runner is disposable. Never uninstall on COCO.
  if ($installedByTest) {
    $entries = @(Get-InstalledVyneo)
    foreach ($entry in $entries) {
      $uninstaller = ([string]$entry.UninstallString).Trim('"')
      if (Test-Path -LiteralPath $uninstaller) {
        try { Run-Silent $uninstaller }
        catch { Write-Warning 'RUNNER_TEST_UNINSTALL_FAILED' }
      }
    }
  }
  if (Test-Path -LiteralPath $marker) {
    Remove-Item -LiteralPath $marker -Force
  }
}
