param(
    [switch]$InitializeOnly
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'runtime.ps1')
Initialize-CuhkConfig $bridgeRoot
$configPath = Join-Path $bridgeRoot 'config.json'
$codexHome = Join-Path $bridgeRoot 'gateway\runtime-state\codex-home'
$gatewayCommand = Join-Path $PSScriptRoot 'cuhk-gateway.cmd'
$codexCommand = Join-Path $PSScriptRoot 'cuhk-codex.cmd'

function Initialize-CuhkCodexHome {
    $null = New-Item -ItemType Directory -Force -Path $codexHome
    $markerPath = Join-Path $codexHome '.cuhk-gateway-home'
    if (-not (Test-Path -LiteralPath $markerPath)) {
        [IO.File]::WriteAllText(
            $markerPath,
            "This CODEX_HOME is reserved for CUHK Gateway CLI sessions.`r`n",
            [Text.UTF8Encoding]::new($false)
        )
    }
}

function Enable-CuhkGateway {
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    if (-not $config.gatewayEnabled) {
        if ($config.PSObject.Properties.Name -contains 'gatewayEnabled') {
            $config.gatewayEnabled = $true
        } else {
            $config | Add-Member -NotePropertyName gatewayEnabled -NotePropertyValue $true
        }
        $temporaryPath = "$configPath.tmp"
        $json = $config | ConvertTo-Json -Depth 10
        [IO.File]::WriteAllText($temporaryPath, "$json`r`n", [Text.UTF8Encoding]::new($false))
        Move-Item -Force -LiteralPath $temporaryPath -Destination $configPath
    }
}

try {
    $host.UI.RawUI.WindowTitle = 'CUHK Gateway Codex CLI'
    Write-Host 'Initializing the isolated Gateway CLI data directory...' -ForegroundColor Cyan
    Initialize-CuhkCodexHome
    Enable-CuhkGateway

    if ($InitializeOnly) {
        Write-Host "Initialization complete: $codexHome" -ForegroundColor Green
        exit 0
    }

    Write-Host 'Starting CUHK Gateway...' -ForegroundColor Cyan
    & $gatewayCommand start | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "CUHK Gateway failed to start (exit code $LASTEXITCODE)." }

    Write-Host 'Opening this folder''s Gateway CLI sessions...' -ForegroundColor Cyan
    & $codexCommand resume
    exit $LASTEXITCODE
} catch {
    Write-Host "Launch failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Press Enter to close this window.'
    [void](Read-Host)
    exit 1
}
