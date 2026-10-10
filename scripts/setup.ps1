param(
    [string]$DependencyRoot,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $bridgeRoot 'bin\runtime.ps1')
$nodeExecutable = Get-CuhkNode
$version = & $nodeExecutable --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Node.js 22 or newer is required.' }
if (-not $DependencyRoot) { $DependencyRoot = Join-Path $bridgeRoot '.dependencies' }
$DependencyRoot = [IO.Path]::GetFullPath($DependencyRoot)
$lock = Get-Content -LiteralPath (Join-Path $bridgeRoot 'dependencies.lock.json') -Raw | ConvertFrom-Json

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE. See the output above; existing checkouts were not reset." }
}

if ($CheckOnly) {
    Invoke-Checked $nodeExecutable @((Join-Path $bridgeRoot 'scripts\check-install.cjs'))
    exit 0
}
$gitCommand = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($npmCommand) { $npmExecutable = $npmCommand.Source }
else { $npmExecutable = Join-Path (Split-Path $nodeExecutable -Parent) 'npm.cmd' }
if (-not (Test-Path -LiteralPath $npmExecutable)) { throw 'npm.cmd was not found. Install a full Node.js distribution including npm.' }
$originalPath = $env:PATH
$originalElectronSkip = $env:ELECTRON_SKIP_BINARY_DOWNLOAD
$originalOpenCliFetch = $env:OPENCLI_FETCH
try {
    $env:PATH = "$(Split-Path $nodeExecutable -Parent);$originalPath"
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    $env:OPENCLI_FETCH = '0'
    $null = New-Item -ItemType Directory -Path $DependencyRoot -Force
    foreach ($name in @('opencli', 'claude-code-router')) {
        $entry = $lock.$name
        $target = Join-Path $DependencyRoot $name
        if (-not (Test-Path -LiteralPath $target)) {
            Invoke-Checked $gitCommand @('init', $target)
            Invoke-Checked $gitCommand @('-C', $target, 'remote', 'add', 'origin', $entry.repository)
        }
        if (-not (Test-Path -LiteralPath (Join-Path $target '.git'))) { throw "Refusing to overwrite an existing non-Git directory: $target" }
        $current = & $gitCommand -C $target rev-parse --verify --quiet HEAD
        if ($LASTEXITCODE -ne 0) {
            Invoke-Checked $gitCommand @('-C', $target, 'fetch', '--depth', '1', 'origin', $entry.revision)
            Invoke-Checked $gitCommand @('-C', $target, 'checkout', '--detach', 'FETCH_HEAD')
            $current = & $gitCommand -C $target rev-parse HEAD
        }
        if ($current -ne $entry.revision) { throw "Revision mismatch in $target. Move that checkout aside or choose another -DependencyRoot; setup never resets it." }
        $dirty = @(& $gitCommand -C $target diff HEAD --name-only)
        # OpenCLI commits its generated manifest/extension bundle. Rebuilding
        # these is expected; changes to source or lockfiles still fail closed.
        if ($name -eq 'opencli') { $dirty = @($dirty | Where-Object { $_ -ne 'cli-manifest.json' -and $_ -notmatch '^extension/dist/' }) }
        if ($name -eq 'claude-code-router') { $dirty = @($dirty | Where-Object { $_ -ne 'packages/ui/src/generated/claude-code-config-options.json' }) }
        if ($dirty.Count) { throw "Refusing to run npm ci on modified dependency source: $target ($($dirty -join ', '))" }
        Push-Location $target
        try {
            Invoke-Checked $npmExecutable @('ci', '--no-audit', '--no-fund')
            if ($name -eq 'opencli') {
                Invoke-Checked $npmExecutable @('run', 'build')
                Push-Location (Join-Path $target 'extension')
                try {
                    Invoke-Checked $npmExecutable @('ci', '--no-audit', '--no-fund')
                    Invoke-Checked $npmExecutable @('run', 'build')
                } finally { Pop-Location }
            } else { Invoke-Checked $npmExecutable @('run', 'build:assets') }
        } finally { Pop-Location }
    }
    $adapterModules = Join-Path $bridgeRoot 'opencli-adapter\node_modules'
    if (-not (Test-Path -LiteralPath $adapterModules)) {
        $null = New-Item -ItemType Junction -Path $adapterModules -Target (Join-Path $DependencyRoot 'opencli\node_modules')
    }
    Initialize-CuhkConfig $bridgeRoot
    # Explicit paths also permit verification in a temporary dependency directory.
    $savedOpenCli = $env:CUHK_OPENCLI_ENTRY
    $savedCcr = $env:CUHK_CCR_ROOT
    try {
        $env:CUHK_OPENCLI_ENTRY = Join-Path $DependencyRoot 'opencli\dist\src\main.js'
        $env:CUHK_CCR_ROOT = Join-Path $DependencyRoot 'claude-code-router'
        Invoke-Checked $nodeExecutable @((Join-Path $bridgeRoot 'scripts\check-install.cjs'))
        Invoke-Checked $nodeExecutable @((Join-Path $bridgeRoot 'scripts\dependency-inventory.cjs'), $DependencyRoot)
    } finally {
        $env:CUHK_OPENCLI_ENTRY = $savedOpenCli
        $env:CUHK_CCR_ROOT = $savedCcr
    }
    Write-Host "Dependencies prepared: $DependencyRoot"
    Write-Host 'Next: load opencli\extension in Chrome, log in to the school website, then open CUHK-AI-Settings.cmd. See docs/install.md.'
} finally {
    $env:PATH = $originalPath
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = $originalElectronSkip
    $env:OPENCLI_FETCH = $originalOpenCliFetch
}
