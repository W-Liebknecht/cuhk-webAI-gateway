function Get-CuhkNode {
    if ($env:CUHK_NODE_EXE) {
        if (-not (Test-Path -LiteralPath $env:CUHK_NODE_EXE -PathType Leaf)) {
            throw 'CUHK_NODE_EXE does not point to an existing Node executable.'
        }
        return $env:CUHK_NODE_EXE
    }
    $local = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\node.exe'
    if (Test-Path -LiteralPath $local -PathType Leaf) { return $local }
    $command = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $bundled) { return $bundled }
    throw 'Node.js 22 or newer was not found. Install Node.js with npm and add it to PATH, or set CUHK_NODE_EXE.'
}

function Initialize-CuhkConfig([string]$Root) {
    $target = Join-Path $Root 'config.json'
    if (-not (Test-Path -LiteralPath $target)) {
        # Copy without replacing a configuration created by another launcher.
        try { [IO.File]::Copy((Join-Path $Root 'config.example.json'), $target, $false) }
        catch { if (-not (Test-Path -LiteralPath $target)) { throw } }
    }
}

function Reset-CuhkProcesses([string]$Root) {
    & (Get-CuhkNode) (Join-Path $Root 'bin\cuhk-gateway.cjs') stop
    if ($LASTEXITCODE -ne 0) { throw 'Unable to clean up the previous Gateway session.' }
    $env:CUHK_PROCESS_DIRECTORY = Join-Path $Root 'gateway\runtime-state\processes'
    $preload = '--require "' + (Join-Path $Root 'bin\process-owner.cjs').Replace('\', '/') + '"'
    if (-not ([string]$env:NODE_OPTIONS).Contains($preload)) { $env:NODE_OPTIONS = "$env:NODE_OPTIONS $preload".Trim() }
}

function Start-CuhkGateway([string]$Root) {
    # Both CLI launchers use this handoff. The background server must never
    # inherit the interactive terminal's output pipeline.
    $stateDirectory = Join-Path $Root 'gateway\runtime-state'
    $null = New-Item -ItemType Directory -Force -Path $stateDirectory
    $startupOutput = Join-Path $stateDirectory "gateway-start-$PID.log"
    $startupError = Join-Path $stateDirectory "gateway-start-$PID.error.log"
    try {
        $gatewayScript = Join-Path $Root 'bin\cuhk-gateway.cjs'
        $startup = Start-Process -FilePath (Get-CuhkNode) -ArgumentList @(('"' + $gatewayScript + '"'), 'start') -WindowStyle Hidden -PassThru -RedirectStandardOutput $startupOutput -RedirectStandardError $startupError
        $null = $startup.Handle
        # -Wait waits for descendants too on Windows, including the permanent
        # Gateway server. Wait only for the short-lived startup command.
        $startup.WaitForExit()
        $startup.Refresh()
        if (Test-Path -LiteralPath $startupOutput) { Get-Content -LiteralPath $startupOutput | Out-Host }
        if ($startup.ExitCode -ne 0) {
            if (Test-Path -LiteralPath $startupError) { Get-Content -LiteralPath $startupError | Out-Host }
            throw "CUHK Gateway failed to start (exit code $($startup.ExitCode))."
        }
    } finally {
        Remove-Item -LiteralPath $startupOutput, $startupError -ErrorAction SilentlyContinue
    }
}
