param(
    [Parameter(Mandatory=$true)][string]$SourceDir,
    [Parameter(Mandatory=$true)][string]$ZipPath
)
$ErrorActionPreference = 'Stop'
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path (Join-Path $SourceDir '*') -DestinationPath $ZipPath -Force
Write-Host ("ZIPPED: " + $ZipPath)
