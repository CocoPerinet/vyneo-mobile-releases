# Run ONLY on a fresh GitHub-hosted Windows PR runner. Does not
# execute, install, or upload the signed candidate. The signer key is
# ephemeral, never a production secret. Always delete it after QA.
param([Parameter(Mandatory = $true)][string]$Artifact)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_OS -ne 'Windows' -or
    $env:GITHUB_EVENT_NAME -ne 'pull_request' -or
    $env:GITHUB_REPOSITORY -ne 'CocoPerinet/vyneo-mobile-releases' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    [string]::IsNullOrEmpty($env:RUNNER_TEMP) -or
    [string]::IsNullOrEmpty($env:GITHUB_WORKSPACE) -or
    -not [string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY) -or
    -not [string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
  throw 'EPHEMERAL_SIGNED_QA_ONLY_ON_HOSTED_PR_WITHOUT_RELEASE_SECRET'
}

$desktop = (Resolve-Path -LiteralPath (Join-Path $env:GITHUB_WORKSPACE 'desktop')).Path
$bundleRoot = (Resolve-Path -LiteralPath (Join-Path $desktop 'src-tauri/target/release/bundle/nsis')).Path
$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
$artifactName = (Split-Path -Leaf $artifactPath)
$versionMatch = [regex]::Match($artifactName,
  '^Vynéo_(?<version>[0-9]+\.[0-9]+\.[0-9]+)_x64-setup\.exe$')
if ((Split-Path -Parent $artifactPath) -cne $bundleRoot -or
    -not $versionMatch.Success) {
  throw 'ONLY_LOCAL_PR_NSIS_CANDIDATE_CAN_BE_SIGNED'
}
$version = $versionMatch.Groups['version'].Value
$unexpectedVersion = ([version]::new(([version]$version).Major,
  ([version]$version).Minor, ([version]$version).Build + 1)).ToString()
$sig = $artifactPath + '.sig'
if (Test-Path -LiteralPath $sig) {
  throw 'PREEXISTING_SIGNATURE_MUST_NOT_BE_OVERWRITTEN'
}
$dir = Join-Path $env:RUNNER_TEMP ('vyneo-ephemeral-signing-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $dir
$key = Join-Path $dir 'throwaway.key'
$pub = $key + '.pub'
$mutated = Join-Path $dir 'tampered.exe'
$versionless = Join-Path $dir 'versionless.exe'
$verifier = Join-Path $desktop 'qa/signed-update-verifier/Cargo.toml'
try {
  Push-Location $desktop
  try {
    # Suppress key-generation output. The private key is never printed,
    # uploaded as an artifact, or checked into the repository.
    # PowerShell 5.1 converts native warnings on stderr to error records.
    # Tauri warns about passwordless keys; here they are disposable and
    # quarantined in RUNNER_TEMP. Check the real exit code, not the warning.
    $previousPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      npm.cmd run tauri -- signer generate --ci -w $key *> $null
      $generateExit = $LASTEXITCODE
      if ($generateExit -ne 0 -or -not (Test-Path -LiteralPath $key) -or
          -not (Test-Path -LiteralPath $pub)) {
        throw 'EPHEMERAL_KEY_GENERATION_FAILED'
      }
      # A signature without --app-version passes pure Minisign verification
      # but fails Tauri's requireSignedVersion gate at runtime.
      npm.cmd run tauri -- signer sign -f $key --app-version $version $artifactPath *> $null
      $signExit = $LASTEXITCODE
      if ($signExit -ne 0 -or -not (Test-Path -LiteralPath $sig)) {
        throw 'EPHEMERAL_NSIS_SIGNATURE_FAILED'
      }
      Copy-Item -LiteralPath $artifactPath -Destination $versionless
      npm.cmd run tauri -- signer sign -f $key $versionless *> $null
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath ($versionless + '.sig'))) {
        throw 'VERSIONLESS_SIGNATURE_FIXTURE_FAILED'
      }
    } finally { $ErrorActionPreference = $previousPreference }

    cargo run --quiet --locked --manifest-path $verifier -- $pub $sig $artifactPath $version
    if ($LASTEXITCODE -ne 0) { throw 'VALID_SIGNED_NSIS_REJECTED' }

    # Verify that a cryptographically valid file cannot be accepted with an
    # incorrect version, or without any version in its signed trusted comment.
    function Assert-VersionOrSignatureRejected(
        [string]$signaturePath, [string]$packagePath,
        [string]$announcedVersion, [string]$failure
    ) {
      $previousPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        cargo run --quiet --locked --manifest-path $verifier -- $pub $signaturePath $packagePath $announcedVersion *> $null
        $rejectExit = $LASTEXITCODE
      } finally { $ErrorActionPreference = $previousPreference }
      if ($rejectExit -eq 0) { throw $failure }
    }
    Assert-VersionOrSignatureRejected $sig $artifactPath $unexpectedVersion 'MISMATCHED_SIGNED_NSIS_VERSION_ACCEPTED'
    Assert-VersionOrSignatureRejected ($versionless + '.sig') $versionless $version 'VERSIONLESS_SIGNED_NSIS_ACCEPTED'

    # Flip one byte of a COPY of the signed executable; never modify
    # the candidate NSIS used by the separate in-place upgrade test.
    Copy-Item -LiteralPath $artifactPath -Destination $mutated
    $stream = [System.IO.File]::Open($mutated,
      [System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite)
    try {
      $stream.Position = 4096
      $byte = $stream.ReadByte()
      if ($byte -lt 0) { throw 'NSIS_ARTIFACT_TRUNCATED' }
      $stream.Position = 4096
      $stream.WriteByte($byte -bxor 1)
    } finally { $stream.Dispose() }

    Assert-VersionOrSignatureRejected $sig $mutated $version 'TAMPERED_SIGNED_NSIS_WAS_ACCEPTED'

    Write-Output 'VYNEO_EPHEMERAL_SIGNED_NSIS_VALID_PASS'
    Write-Output 'VYNEO_EPHEMERAL_WRONG_VERSION_REJECTED_PASS'
    Write-Output 'VYNEO_EPHEMERAL_MISSING_VERSION_REJECTED_PASS'
    Write-Output 'VYNEO_EPHEMERAL_TAMPERED_NSIS_REJECTED_PASS'
    Write-Output 'QA_NO_PRODUCTION_SIGNING_KEY_NO_RELEASE_NO_INSTALL'
    # GitHub's pwsh wrapper exits with the last native command exit code.
    # The intentionally failed signature/version checks may set it to 1.
    # Clear it only after asserting each expected rejection.
    $global:LASTEXITCODE = 0
  } finally {
    Pop-Location
  }
} finally {
  if (Test-Path -LiteralPath $sig) {
    Remove-Item -LiteralPath $sig -Force
  }
  if (Test-Path -LiteralPath $dir) {
    Remove-Item -LiteralPath $dir -Recurse -Force
  }
}
