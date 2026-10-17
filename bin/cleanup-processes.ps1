param([int]$ExcludePid = 0)
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$directory = Join-Path $bridgeRoot 'gateway\runtime-state\processes'
$protected = @{}
$all = @(Get-CimInstance Win32_Process)
# Protect this cleanup command and its callers (panel, current launcher, test runner).
$current = $PID
while ($current -and -not $protected.ContainsKey($current)) {
    $protected[$current] = $true
    $entry = $all | Where-Object ProcessId -eq $current | Select-Object -First 1
    if (-not $entry) { break }
    $current = [int]$entry.ParentProcessId
}
if ($ExcludePid) { $protected[$ExcludePid] = $true }
$known = @{}
function Find-OwnedProcesses($snapshot) {
    foreach ($entry in $snapshot) {
        $id = [int]$entry.ProcessId
        if ($protected.ContainsKey($id)) { continue }
        $command = [string]$entry.CommandLine
        $owned = $false
        foreach ($relative in @('bin\cuhk-codex-launch.ps1', 'bin\cuhk-claude-launch.ps1', 'bin\cuhk-codex.ps1', 'bin\cuhk-claude.ps1', 'bin\cuhk-codex-client.cjs', 'bin\cuhk-opencli.mjs', 'research\claude-code-router\packages\core\dist\main\server.js', '.dependencies\claude-code-router\packages\core\dist\main\server.js')) {
            if ($command.IndexOf((Join-Path $bridgeRoot $relative), [StringComparison]::OrdinalIgnoreCase) -ge 0) { $owned = $true; break }
        }
        if ($command.Contains((Join-Path $bridgeRoot 'gateway\runtime-state\claude-home\gateway-settings-'))) { $owned = $true }
        $recordPath = Join-Path $directory "$id.json"
        if (Test-Path -LiteralPath $recordPath) {
            try {
                $record = Get-Content -Raw -LiteralPath $recordPath | ConvertFrom-Json
                $created = ([DateTimeOffset]$entry.CreationDate).ToUnixTimeMilliseconds()
                if ($record.pid -eq $id -and $entry.ExecutablePath -eq $record.executable -and [Math]::Abs($created - $record.startedAt) -lt 2000) { $owned = $true }
            } catch { }
        }
        if ($known.ContainsKey($id) -and $known[$id] -eq $entry.CreationDate) { $owned = $true }
        if ($owned) { $known[$id] = $entry.CreationDate }
    }
    do {
        $added = $false
        foreach ($entry in $snapshot) {
            $id = [int]$entry.ProcessId
            if (-not $protected.ContainsKey($id) -and -not $known.ContainsKey($id) -and $known.ContainsKey([int]$entry.ParentProcessId)) {
                $parent = $snapshot | Where-Object ProcessId -eq $entry.ParentProcessId | Select-Object -First 1
                if ($parent -and $parent.CreationDate -eq $known[[int]$entry.ParentProcessId] -and $entry.CreationDate -ge $parent.CreationDate) {
                    $known[$id] = $entry.CreationDate
                    $added = $true
                }
            }
        }
    } while ($added)
    @($snapshot | Where-Object { $known.ContainsKey([int]$_.ProcessId) -and $known[[int]$_.ProcessId] -eq $_.CreationDate })
}
$terminated = @{}
for ($attempt = 0; $attempt -lt 12; $attempt++) {
    $targets = @(Find-OwnedProcesses $all)
    if (-not $targets.Count) {
        if (Test-Path -LiteralPath $directory) { Get-ChildItem -LiteralPath $directory -Filter '*.json' -File | Remove-Item -Force }
        Write-Output (@{ ok = $true; remaining = 0; terminated = @($terminated.Keys) } | ConvertTo-Json -Compress)
        exit 0
    }
    foreach ($target in $targets) {
        # Verify creation identity again immediately before termination; never trust a stale PID.
        $live = Get-CimInstance Win32_Process -Filter "ProcessId = $($target.ProcessId)"
        if ($live -and $live.CreationDate -eq $target.CreationDate) {
            Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
            $terminated[[int]$target.ProcessId] = $true
        }
    }
    Start-Sleep -Milliseconds 200
    $all = @(Get-CimInstance Win32_Process)
}
throw "CUHK cleanup failed: related processes remain: $((Find-OwnedProcesses $all).ProcessId -join ', ')"
