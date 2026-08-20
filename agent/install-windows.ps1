#!/usr/bin/env powershell
param(
  [Parameter(Mandatory=$true)][string]$Token,
  [string]$Url = "http://localhost:3002",
  [string]$InstallDir = "$env:ProgramFiles\VigilAI"
)

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
@"
VIGILAI_TOKEN=$Token
VIGILAI_INGEST_URL=$Url
"@ | Set-Content -Path "$InstallDir\agent.env" -Encoding UTF8

$runner = @"
`$envFile = Join-Path '$InstallDir' 'agent.env'
Get-Content `$envFile | ForEach-Object {
  if (`$_ -match '^([^#=]+)=(.*)$') { Set-Item -Path env:`$matches[1] -Value `$matches[2] }
}
node (Join-Path '$InstallDir' 'vigilai-agent.mjs')
"@
Set-Content -Path "$InstallDir\run-agent.ps1" -Value $runner -Encoding UTF8

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\run-agent.ps1`""
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "VigilAIAgent" -Action $action -Trigger $trigger -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName "VigilAIAgent"
Write-Host "VigilAI Windows agent scheduled task installed."
