$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Invoke-CheckedCommand {
	param(
		[Parameter(Mandatory = $true)]
		[string]$FilePath,

		[Parameter(ValueFromRemainingArguments = $true)]
		[string[]]$Arguments
	)

	& $FilePath @Arguments
	if ($LASTEXITCODE -ne 0) {
		throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
	}
}

Invoke-CheckedCommand git pull --ff-only

Invoke-CheckedCommand npm run fetch:products

git diff --quiet -- src/lib/products.ts
if ($LASTEXITCODE -eq 0) {
	Write-Host "No product changes detected."
	exit 0
}
if ($LASTEXITCODE -ne 1) {
	throw "Could not check product diff. git diff exited with ${LASTEXITCODE}."
}

Invoke-CheckedCommand npm run check
Invoke-CheckedCommand npm run test:smoke
Invoke-CheckedCommand npm run check:prices

Invoke-CheckedCommand git add src/lib/products.ts
Invoke-CheckedCommand git commit -m "chore: sync product prices"
Invoke-CheckedCommand git push
