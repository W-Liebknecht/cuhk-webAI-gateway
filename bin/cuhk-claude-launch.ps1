param([switch]$InitializeOnly)
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'runtime.ps1')
Initialize-CuhkConfig $bridgeRoot
$claudeHome = Join-Path $bridgeRoot 'gateway\runtime-state\claude-home'
$configPath = Join-Path $bridgeRoot 'config.json'
try {
    $host.UI.RawUI.WindowTitle = 'CUHK Gateway Claude Code CLI'
    $null = New-Item -ItemType Directory -Force -Path $claudeHome
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    if (-not $config.gatewayEnabled) {
        $config | Add-Member -NotePropertyName gatewayEnabled -NotePropertyValue $true -Force
        [IO.File]::WriteAllText("$configPath.tmp", ($config | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
        Move-Item -Force -LiteralPath "$configPath.tmp" -Destination $configPath
    }
    if ($InitializeOnly) { Write-Host "Initialization complete: $claudeHome"; exit 0 }
    & (Join-Path $PSScriptRoot 'cuhk-gateway.cmd') start | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'CUHK Gateway failed to start.' }
    # Start a fresh interactive session even when this cwd has no history.
    # Claude's /resume picker remains available inside the native CLI.
    & (Join-Path $PSScriptRoot 'cuhk-claude.cmd')
    exit $LASTEXITCODE
} catch {
    Write-Host "Launch failed: $($_.Exception.Message)" -ForegroundColor Red
    if (-not $InitializeOnly) { [void](Read-Host 'Press Enter to close') }
    exit 1
}
