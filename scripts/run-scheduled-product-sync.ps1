$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$logDir = Join-Path $repoRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDir "product-sync-$timestamp.log"

Start-Transcript -Path $logPath -Append | Out-Null

try {
	Write-Host "Starting scheduled product sync at $(Get-Date -Format o)"
	Write-Host "Repository: $repoRoot"

	& (Join-Path $PSScriptRoot "sync-products-and-push.ps1")
	if ($LASTEXITCODE -ne 0) {
		throw "Product sync exited with code $LASTEXITCODE"
	}

	Write-Host "Scheduled product sync completed at $(Get-Date -Format o)"
	exit 0
} catch {
	Write-Error $_
	exit 1
} finally {
	Stop-Transcript | Out-Null
}
