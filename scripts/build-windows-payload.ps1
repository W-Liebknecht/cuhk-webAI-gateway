param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$NodeExecutable,
    [Parameter(Mandatory)][string]$SettingsExecutable,
    [Parameter(Mandatory)][string]$NodeLicense,
    [Parameter(Mandatory)][string]$PythonLicense
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw "Output directory already exists: $output" }
foreach ($file in @($NodeExecutable, $SettingsExecutable, $NodeLicense, $PythonLicense)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required build input missing: $file" }
}
foreach ($name in @('opencli', 'claude-code-router')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root ".dependencies\$name\node_modules"))) {
        throw "Build dependency missing: $name. Run scripts/setup.ps1 first."
    }
}
$null = New-Item -ItemType Directory -Path $output -Force
$files = & git -C $root -c core.quotepath=false ls-files --cached --others --exclude-standard
if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed.' }
foreach ($file in $files) {
    if ($file -match '^(memory/|research/|\.github/|artifacts/|gateway/cuhk-provider/test/)' -or
        $file -in @('.gitattributes', '.gitignore', 'config.json')) { continue }
    $source = Join-Path $root $file
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    $destination = Join-Path $output $file
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force
    Copy-Item -LiteralPath $source -Destination $destination
}
$null = New-Item -ItemType Directory -Path (Join-Path $output 'runtime') -Force
Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $output 'runtime\node.exe')
$null = New-Item -ItemType Directory -Path (Join-Path $output 'app') -Force
Copy-Item -LiteralPath $SettingsExecutable -Destination (Join-Path $output 'app\CUHK-AI-Settings.exe')
$null = New-Item -ItemType Directory -Path (Join-Path $output 'licenses') -Force
Copy-Item -LiteralPath $NodeLicense -Destination (Join-Path $output 'licenses\NODE-LICENSE.txt')
Copy-Item -LiteralPath $PythonLicense -Destination (Join-Path $output 'licenses\PYTHON-LICENSE.txt')
foreach ($name in @('opencli', 'claude-code-router')) {
    $source = Join-Path $root ".dependencies\$name"
    $destination = Join-Path $output ".dependencies\$name"
    $null = New-Item -ItemType Directory -Path $destination -Force
    & robocopy.exe $source $destination /E /XD .git .github /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "Copying $name failed with robocopy exit code $LASTEXITCODE" }
    $global:LASTEXITCODE = 0
}
Write-Host "Windows installer payload ready: $output"
