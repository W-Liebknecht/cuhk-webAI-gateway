$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
try {
    $nodeExecutable = Get-CuhkNode
    & $nodeExecutable @args
    exit $LASTEXITCODE
} catch {
    Write-Error $_
    exit 1
}
