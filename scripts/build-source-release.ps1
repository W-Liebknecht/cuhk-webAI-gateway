param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) { $OutputPath = Join-Path $root 'dist\cuhk-ai-bridge-source.zip' }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $OutputPath) { throw "Refusing to replace an existing archive: $OutputPath" }
$null = New-Item -ItemType Directory -Force -Path (Split-Path $OutputPath -Parent)
$stage = Join-Path ([IO.Path]::GetTempPath()) ('cuhk-source-' + [guid]::NewGuid().ToString('N'))
$payload = Join-Path $stage 'cuhk-ai-bridge'
$null = New-Item -ItemType Directory -Path $payload -Force
try {
    # Enumerate Git-visible source only; never recurse into dependency junctions.
    $files = & git -C $root -c core.quotepath=false ls-files --cached --others --exclude-standard
    if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed.' }
    $included = @()
    foreach ($file in ($files | Sort-Object -Unique)) {
        if ($file -eq 'config.json' -or $file -match '^(memory/|\.worktrees/|\.dependencies/|dist/|gateway/(runtime-state|host-state)/)') { continue }
        if ($file -match '^research/' -and $file -ne 'research/README.md') { continue }
        if ($file -notmatch '^(bin/|app/|scripts/|docs/|gateway/cuhk-provider/|opencli-adapter/|artifacts/|\.github/)' -and
            $file -notin @('README.md', 'CUHK-CODEX-START.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SUPPORT.md',
                'THIRD_PARTY_NOTICES.md', 'LICENSE', '.gitignore', '.gitattributes', 'research/README.md',
                'CUHK-AI-Settings.cmd', 'config.example.json', 'dependencies.lock.json')) { continue }
        $source = Join-Path $root $file
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
        $destination = Join-Path $payload $file
        $null = New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent)
        Copy-Item -LiteralPath $source -Destination $destination
        $included += $file
    }
    $manifest = @{ format = 'source-only'; bundledThirdPartyRuntimes = $false; files = $included }
    [IO.File]::WriteAllText((Join-Path $payload 'SOURCE-MANIFEST.json'), ($manifest | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $OutputPath)
    Write-Host "Source release: $OutputPath ($($included.Count) files)"
} finally {
    # This exact GUID-named staging directory was created above. Never remove a
    # caller-supplied path or traverse any checkout/dependency directory.
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if ((Split-Path $resolvedStage -Parent) -ne ([IO.Path]::GetTempPath()).TrimEnd('\') -or
        (Split-Path $resolvedStage -Leaf) -notmatch '^cuhk-source-[a-f0-9]{32}$') { throw 'Unexpected release staging path; cleanup refused.' }
    if (Test-Path -LiteralPath $resolvedStage) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
}
