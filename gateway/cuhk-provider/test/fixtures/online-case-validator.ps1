param([Parameter(Mandatory = $true)][string]$CaseRoot)

$ErrorActionPreference = 'Stop'
$casePath = Join-Path ([IO.Path]::GetFullPath($CaseRoot)) 'case.json'
if (-not (Test-Path -LiteralPath $casePath -PathType Leaf)) {
    [Console]::Error.WriteLine('ONLINE_CASE_ERROR missing case.json')
    exit 7
}

$value = Get-Content -Raw -LiteralPath $casePath | ConvertFrom-Json
if ($value.status -ne 'corrected') {
    [Console]::Error.WriteLine('ONLINE_CASE_ERROR set status to corrected and preserve case_id plus locked_value')
    exit 7
}
if ($value.locked_value -ne 'KEEP-中文-$-\-"') {
    [Console]::Error.WriteLine('ONLINE_CASE_ERROR locked_value changed')
    exit 8
}
Write-Output "ONLINE_CASE_VALID case_id=$($value.case_id)"
exit 0
