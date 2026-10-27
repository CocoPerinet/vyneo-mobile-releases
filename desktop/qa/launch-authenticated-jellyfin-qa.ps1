# Requires an explicit user-approved launch. Does not authenticate or approve
# Jellyfin Quick Connect; ONLY the human can approve that separate step.
param([switch]$Approved)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $Approved) { throw 'AUTH_QA_USER_APPROVAL_REQUIRED' }
if ($env:COMPUTERNAME -notin @('JJJ','COCO') -or $env:USERNAME -cne 'bindl') {
  throw 'ONLY_AUTHORIZED_WINDOWS_COCO_QA'
}
$desktop=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($desktop -cne 'E:\Projects\Vyneo-Jellyfin-Parity-QA\desktop') {
  throw 'QA_WORKTREE_MISMATCH'
}
$exe=Join-Path $env:TEMP 'vyneo-auth-qa-portable\vyneo-auth-qa.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  throw 'BUILD_PORTABLE_QA_BEFORE_LAUNCH'
}
$config=Get-Content -LiteralPath (Join-Path $desktop 'src-tauri/tauri.authenticated-qa.conf.json') -Encoding UTF8 -Raw |
  ConvertFrom-Json
if ($config.identifier -cne 'fr.visyren.vyneo.desktop.authqa') {
  throw 'QA_IDENTITY_MISMATCH'
}
$stable=Get-Content -LiteralPath (Join-Path $desktop 'src-tauri/tauri.conf.json') -Encoding UTF8 -Raw |
  ConvertFrom-Json
$entries=@(Get-ItemProperty -Path @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
) -ErrorAction SilentlyContinue | Where-Object {
  $_.PSObject.Properties.Match('DisplayName').Count -gt 0 -and
  $_.DisplayName -ceq $stable.productName
})
if ($entries.Count -ne 1 -or $entries[0].DisplayVersion -cne '0.2.4') {
  throw 'STABLE_SINGLE_INSTALLATION_REQUIRED'
}
if (@(Get-Process -Name 'vyneo-auth-qa' -ErrorAction SilentlyContinue).Count -ne 0) {
  throw 'QA_ALREADY_RUNNING'
}
# Recover only our previous orphaned QA tasks that execute this exact
# portable QA path. Never touch the installed Vynéo stable or other tasks.
$stale=@(Get-ScheduledTask -TaskName 'VyneoAuthenticatedJellyfinQA*' -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Actions.Count -eq 1 -and $_.Actions[0].Execute -ceq $exe
  })
foreach ($task in $stale) {
  Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false
}
$taskName='VyneoAuthenticatedJellyfinQA'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$created=$false
try {
  $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
  $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $action=New-ScheduledTaskAction -Execute $exe
  Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
  $created=$true
  Start-ScheduledTask -TaskName $taskName
  Write-Output 'VYNEO_AUTH_QA_INTERACTIVE_WINDOW_REQUESTED_NO_INSTALL'
  Write-Output 'QA_QUICK_CONNECT_REQUIRES_HUMAN_APPROVAL'
  $until=(Get-Date).AddMinutes(15)
  $startupDeadline=(Get-Date).AddSeconds(20)
  $observed=$false
  Start-Sleep -Seconds 3
  while((Get-Date) -lt $until) {
    $running=@(Get-Process -Name 'vyneo-auth-qa' -ErrorAction SilentlyContinue).Count
    if ($running -gt 0) { $observed=$true }
    if ($observed -and $running -eq 0) { break }
    if (-not $observed -and (Get-Date) -ge $startupDeadline) {
      throw 'QA_INTERACTIVE_WINDOW_FAILED_TO_START'
    }
    Start-Sleep -Seconds 5
  }
} finally {
  if ($created) {
    $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $task) {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
  }
}
