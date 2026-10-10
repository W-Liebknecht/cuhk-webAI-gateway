$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$claudeHome = Join-Path $bridgeRoot 'gateway\runtime-state\claude-home'
$null = New-Item -ItemType Directory -Force -Path $claudeHome
$controlPath = Join-Path $bridgeRoot 'gateway\runtime-state\control.json'
if (-not (Test-Path -LiteralPath $controlPath)) { throw 'CUHK Gateway is not started. Run bin\cuhk-gateway.cmd start first.' }
$control = Get-Content -Raw -LiteralPath $controlPath | ConvertFrom-Json
if (-not $control.gatewayKey) { throw 'CUHK Gateway control state is invalid.' }
$gatewayPort = if ($control.ports -and $control.ports.gateway) { [int]$control.ports.gateway } else { 3460 }
if ($gatewayPort -lt 1 -or $gatewayPort -gt 65535) { throw 'CUHK Gateway port state is invalid.' }

$env:CLAUDE_CONFIG_DIR = $claudeHome
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:$gatewayPort"
$env:ANTHROPIC_API_KEY = [string]$control.gatewayKey
# Prevent inherited subscription/provider credentials from overriding this route.
foreach ($name in @('ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY')) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
$env:ANTHROPIC_MODEL = 'cuhk-gateway'
$env:ANTHROPIC_CUSTOM_MODEL_OPTION = 'cuhk-gateway'
$env:ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = 'CUHK Gateway'
$env:ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION = 'Model and thinking level follow the CUHK control panel'
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = 'cuhk-gateway'
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = 'cuhk-gateway'
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = 'cuhk-gateway'
$env:ANTHROPIC_DEFAULT_FABLE_MODEL = 'cuhk-gateway'
$env:CLAUDE_CODE_SUBAGENT_MODEL = 'cuhk-gateway'
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
$env:CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
# Messages usage represents the school page percentage on a 100k display scale.
# Pin the custom alias's client window to the same scale for its context meter.
$env:CLAUDE_CODE_MAX_CONTEXT_TOKENS = '100000'
$env:API_TIMEOUT_MS = '3600000'
$env:ANTHROPIC_CUSTOM_HEADERS = "x-cuhk-owner-pid: $PID"
$existingNoProxy = [Environment]::GetEnvironmentVariable('NO_PROXY', 'Process')
$env:NO_PROXY = if ($existingNoProxy) { "127.0.0.1,localhost,$existingNoProxy" } else { '127.0.0.1,localhost' }
$env:no_proxy = $env:NO_PROXY

# Seed only the isolated home; no credentials/config are copied from ~/.claude.
$onboardingPath = Join-Path $claudeHome '.claude.json'
if (-not (Test-Path -LiteralPath $onboardingPath)) {
    [IO.File]::WriteAllText($onboardingPath, '{"hasCompletedOnboarding":true}', [Text.UTF8Encoding]::new($false))
}
# CLI-level env wins over project/local settings that may point at another
# provider. Preserve project tools/permissions while keeping this launcher routed
# through Gateway. Do not leave a second credential file on disk.
# Keep transient keys inside the same ignored state directory as control.json.
# Recover leftovers from a CLI that was forcibly terminated before finally ran.
Get-ChildItem -LiteralPath $claudeHome -Filter 'gateway-settings-*.json' -File | ForEach-Object {
    if ($_.Name -match '^gateway-settings-(\d+)\.json$') {
        $settingsOwnerPid = [int]$Matches[1]
        if (-not (Get-Process -Id $settingsOwnerPid -ErrorAction SilentlyContinue)) {
            Remove-Item -LiteralPath $_.FullName -ErrorAction SilentlyContinue
        }
    }
}
$gatewaySettingsPath = Join-Path $claudeHome "gateway-settings-$PID.json"
try {
    $gatewayEnv = @{}
    foreach ($name in @('ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', 'CLAUDE_CODE_MAX_CONTEXT_TOKENS', 'API_TIMEOUT_MS', 'ANTHROPIC_CUSTOM_HEADERS', 'NO_PROXY', 'no_proxy')) {
        $gatewayEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    foreach ($name in @('ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY')) { $gatewayEnv[$name] = '' }
    [IO.File]::WriteAllText($gatewaySettingsPath, (@{ env = $gatewayEnv } | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    & claude @args --settings $gatewaySettingsPath
    $clientExit = $LASTEXITCODE
} finally {
    Remove-Item -LiteralPath $gatewaySettingsPath -ErrorAction SilentlyContinue
}
exit $clientExit
