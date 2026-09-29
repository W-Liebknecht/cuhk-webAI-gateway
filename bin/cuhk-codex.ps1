$ErrorActionPreference = 'Stop'

$bridgeRoot = Split-Path -Parent $PSScriptRoot
$codexHome = Join-Path $bridgeRoot 'gateway\runtime-state\codex-home'
$null = New-Item -ItemType Directory -Force -Path $codexHome
$env:CODEX_HOME = $codexHome

$controlPath = Join-Path $bridgeRoot 'gateway\runtime-state\control.json'
if (-not (Test-Path -LiteralPath $controlPath)) {
    throw 'CUHK Gateway is not started. Run bin\cuhk-gateway.cmd start first.'
}
$control = Get-Content -Raw -LiteralPath $controlPath | ConvertFrom-Json
if (-not $control.gatewayKey) { throw 'CUHK Gateway control state is invalid.' }
$gatewayPort = if ($control.ports -and $control.ports.gateway) { [int]$control.ports.gateway } else { 3460 }
if ($gatewayPort -lt 1 -or $gatewayPort -gt 65535) { throw 'CUHK Gateway port state is invalid.' }

$env:CUHK_GATEWAY_KEY = [string]$control.gatewayKey
$loopback = '127.0.0.1,localhost'
$existingNoProxy = [Environment]::GetEnvironmentVariable('NO_PROXY', 'Process')
$env:NO_PROXY = if ($existingNoProxy) { "$loopback,$existingNoProxy" } else { $loopback }
$env:no_proxy = $env:NO_PROXY

# Deliberately pinned to gpt-5.6-sol: non-GPT slugs make Codex 0.155 register its
# codex_apps MCP tools, whose schemas the emulated tool compiler rejects (HTTP 400).
# The gateway runs in locked panel mode, so this display name does not change routing.
$providerArgs = @(
    '-c', 'model_provider="cuhk_gateway"',
    '-c', 'model="gpt-5.6-sol"',
    '-c', 'model_providers.cuhk_gateway.name="CUHK Gateway"',
    '-c', 'model_providers.cuhk_gateway.env_key="CUHK_GATEWAY_KEY"',
    '-c', 'model_providers.cuhk_gateway.wire_api="responses"',
    '-c', 'model_providers.cuhk_gateway.stream_idle_timeout_ms=3600000',
    # The provider now coalesces identical requests by conversation and input;
    # one reconnect retrieves the original operation instead of resending it.
    '-c', 'model_providers.cuhk_gateway.request_max_retries=1',
    '-c', 'model_providers.cuhk_gateway.stream_max_retries=1'
)
$argumentFile = [IO.Path]::GetTempFileName()
try {
    $launchPayload = @{ args = @($providerArgs + $args); gatewayPort = $gatewayPort }
    $encodedArgs = ConvertTo-Json -InputObject $launchPayload -Compress -Depth 4
    [IO.File]::WriteAllText($argumentFile, $encodedArgs, [Text.UTF8Encoding]::new($false))
    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    $nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { $null }
    if (-not $nodeExecutable) {
        throw 'Node.js was not found. Install Node.js or add node.exe to PATH.'
    }
    & $nodeExecutable (Join-Path $PSScriptRoot 'cuhk-codex-client.cjs') $argumentFile
    $clientExit = $LASTEXITCODE
} finally {
    if (Test-Path -LiteralPath $argumentFile) { Remove-Item -LiteralPath $argumentFile }
}
exit $clientExit
