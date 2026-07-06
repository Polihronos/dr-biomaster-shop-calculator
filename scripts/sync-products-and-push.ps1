$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

git pull --ff-only

npm run fetch:products

git diff --quiet -- src/lib/products.ts
if ($LASTEXITCODE -eq 0) {
	Write-Host "No product changes detected."
	exit 0
}

npm run check
npm run test:smoke
npm run check:prices

git add src/lib/products.ts
git commit -m "chore: sync product prices"
git push
