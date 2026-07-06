[CmdletBinding(SupportsShouldProcess = $true)]
param(
	[string]$TaskName = "Dr Biomaster Product Sync",
	[string]$At = "08:00"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$runner = Resolve-Path (Join-Path $PSScriptRoot "run-scheduled-product-sync.ps1")
$powershell = (Get-Command powershell.exe).Source

try {
	$time = [DateTime]::ParseExact($At, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
} catch {
	throw "Invalid -At value '$At'. Use HH:mm, for example 08:00."
}

$trigger = New-ScheduledTaskTrigger -Daily -At $time
$action = New-ScheduledTaskAction `
	-Execute $powershell `
	-Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" `
	-WorkingDirectory $repoRoot
$settings = New-ScheduledTaskSettingsSet `
	-StartWhenAvailable `
	-AllowStartIfOnBatteries `
	-DontStopIfGoingOnBatteries `
	-ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal `
	-UserId "$env:USERDOMAIN\$env:USERNAME" `
	-LogonType Interactive `
	-RunLevel Limited

if ($PSCmdlet.ShouldProcess($TaskName, "Register daily product sync task at $At")) {
	Register-ScheduledTask `
		-TaskName $TaskName `
		-Action $action `
		-Trigger $trigger `
		-Settings $settings `
		-Principal $principal `
		-Description "Sync Dr Biomaster product prices and push updates after tests pass." `
		-Force | Out-Null

	Write-Host "Installed scheduled task '$TaskName' at $At."
	Write-Host "Logs will be written to: $(Join-Path $repoRoot 'logs')"
	Write-Host "To run it now: Start-ScheduledTask -TaskName '$TaskName'"
}
