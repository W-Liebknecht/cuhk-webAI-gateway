param(
    [Parameter(Mandatory = $true)][string]$CaseRoot,
    [int]$Iterations = 18,
    [int]$DelaySeconds = 5
)

$ErrorActionPreference = 'Stop'
$CaseRoot = [IO.Path]::GetFullPath($CaseRoot)
$inputRoot = Join-Path $CaseRoot 'input'
$launchLog = Join-Path $CaseRoot 'launches.ndjson'
$resultPath = Join-Path $CaseRoot 'scan-result.json'

if (-not (Test-Path -LiteralPath $inputRoot -PathType Container)) {
    throw "Fixture input directory is missing: $inputRoot"
}

$receipt = [Guid]::NewGuid().ToString('N')
$launch = [ordered]@{
    at = [DateTime]::UtcNow.ToString('o')
    pid = $PID
    receipt = $receipt
}
Add-Content -LiteralPath $launchLog -Value ($launch | ConvertTo-Json -Compress)

Write-Output "ONLINE_SCAN_START pid=$PID receipt=$receipt"
for ($step = 1; $step -le $Iterations; $step++) {
    $count = @(Get-ChildItem -LiteralPath $inputRoot -File -Recurse).Count
    Write-Output "ONLINE_SCAN_PROGRESS step=$step/$Iterations count=$count receipt=$receipt"
    if ($step -eq 6) { [Console]::Error.WriteLine("ONLINE_SCAN_STDERR checkpoint=$step receipt=$receipt") }
    if ($step -lt $Iterations) { Start-Sleep -Seconds $DelaySeconds }
}

$result = [ordered]@{
    completedAt = [DateTime]::UtcNow.ToString('o')
    pid = $PID
    count = $count
    receipt = $receipt
    exitCode = 0
}
$result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8
Write-Output "ONLINE_SCAN_DONE count=$count receipt=$receipt"
