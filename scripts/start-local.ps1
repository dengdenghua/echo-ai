param(
    [switch]$Web,
    [switch]$NoOpen,
    [switch]$Check,
    [int]$BackendPort = 0,
    [int]$FrontendPort = 0,
    [int]$TentaclePort = 0
)
$ErrorActionPreference = 'Stop'
$repoDir = Split-Path $PSScriptRoot -Parent
$stateDir = Join-Path $repoDir '.codex-run'
$frontendDir = Join-Path $repoDir 'frontend'
$preflight = Join-Path $frontendDir 'scripts\dev-preflight.mjs'
if ($BackendPort) { $env:GATEWAY_PORT = [string]$BackendPort }
if ($FrontendPort) { $env:FRONTEND_PORT = [string]$FrontendPort }
if ($TentaclePort) { $env:ECHO_TENTACLE_WS_PORT = [string]$TentaclePort }
$nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$runtimePaths = Join-Path $stateDir 'runtime-paths.json'
if (!$nodePath -and (Test-Path -LiteralPath $runtimePaths)) {
    $nodePath = (Get-Content -LiteralPath $runtimePaths -Raw | ConvertFrom-Json).node
}
if (!$nodePath -or !(Test-Path -LiteralPath $nodePath)) { throw 'Node.js is missing. See docs/LOCAL-RUN.md.' }

# Preflight imports Python from this checkout and checks opaque source/state
# identity before reuse. No credential contents are read.
$reportText = (& $nodePath $preflight --check | Out-String)
$reportCode = $LASTEXITCODE
if ($Check) { Write-Output $reportText.Trim(); exit $reportCode }
$report = $reportText | ConvertFrom-Json
if (!$report.ok) { throw ("Local preflight failed: " + ($report.errors -join '; ') + '. See docs/LOCAL-RUN.md.') }
$pythonPath = $report.python.python
$env:PYTHONUTF8 = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONPATH = $repoDir + [IO.Path]::PathSeparator + $env:PYTHONPATH
$env:ECHO_HOME = $report.homeRoot
$env:ECHO_DATA_DIR = $report.dataRoot
$env:ECHO_DEV_DATA_DIR = $report.dataRoot
$env:ECHO_DEV_INSTANCE = '1'
$env:GATEWAY_PORT = [string]$report.ports.backend
$env:FRONTEND_PORT = [string]$report.ports.frontend
$env:ECHO_TENTACLE_WS_PORT = [string]$report.ports.tentacle
if (!$env:ECHO_BACKEND_URL) { $env:ECHO_BACKEND_URL = "http://127.0.0.1:$($report.ports.backend)" }
if (!$env:ECHO_INTERNAL_GATEWAY_BASE_URL) { $env:ECHO_INTERNAL_GATEWAY_BASE_URL = $env:ECHO_BACKEND_URL }
if (!$env:ELECTRON_START_URL) { $env:ELECTRON_START_URL = "http://127.0.0.1:$($report.ports.frontend)" }
$extensions = @($env:ECHO_APP_EXTENSIONS -split ',' | Where-Object { $_.Trim() })
$env:ECHO_APP_EXTENSIONS = (($extensions + 'tools.dev_instance') | Select-Object -Unique) -join ','
$env:PATH = "$(Split-Path $pythonPath);$(Split-Path $nodePath);$env:PATH"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
if (!$env:ECHO_OPENCODE_BIN -and (Test-Path -LiteralPath $runtimePaths)) {
    $openCodePath = (Get-Content -LiteralPath $runtimePaths -Raw | ConvertFrom-Json).opencode
    if ($openCodePath -and (Test-Path -LiteralPath $openCodePath)) { $env:ECHO_OPENCODE_BIN = $openCodePath }
}
function Test-OwnedService([string]$Name) {
    $statusText = (& $nodePath $preflight --probe $Name | Out-String)
    try {
        $status = $statusText | ConvertFrom-Json
        return $status.ready -and !$status.restartRequired
    } catch { return $false }
}
function Assert-FreePort([string]$Name) {
    & $nodePath $preflight --port-free $Name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "$Name port is occupied. No process was killed; select a different port." }
}
function Start-LocalProcess([string]$Name, [string]$Executable, [string]$Arguments, [string]$Directory) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir "$Name.out.log") -RedirectStandardError (Join-Path $stateDir "$Name.err.log") -PassThru
    $process.Id | Set-Content -LiteralPath (Join-Path $stateDir "$Name.pid")
    return $process
}
function Wait-OwnedService($Process, [string]$Name) {
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        if (Test-OwnedService $Name) { return }
        $Process.Refresh()
        if ($Process.HasExited) { throw "$Name exited. See $stateDir\$Name.err.log" }
        Start-Sleep -Seconds 1
    }
    throw "$Name startup timed out or identity mismatched. See $stateDir\$Name.err.log"
}
if (!(Test-OwnedService 'backend')) {
    Assert-FreePort 'backend'
    Assert-FreePort 'tentacle'
    $backendArgs = '-m runtime serve --config "' + $report.configPath + '" --host 127.0.0.1 --port ' + $report.ports.backend
    $backend = Start-LocalProcess 'backend' $pythonPath $backendArgs $repoDir
    Wait-OwnedService $backend 'backend'
}
if (!(Test-OwnedService 'frontend')) {
    Assert-FreePort 'frontend'
    $frontendArgs = '"' + $report.entries.vite + '" --host 127.0.0.1 --port ' + $report.ports.frontend + ' --strictPort'
    $frontend = Start-LocalProcess 'frontend' $nodePath $frontendArgs $frontendDir
    Wait-OwnedService $frontend 'frontend'
}
Write-Host "Echo is ready: $env:ELECTRON_START_URL"
Write-Host "Logs: $stateDir"
if ($NoOpen) { exit 0 }
if ($Web) { Start-Process $env:ELECTRON_START_URL; exit 0 }
$electronPath = Join-Path $frontendDir 'node_modules\electron\dist\electron.exe'
if (!(Test-Path -LiteralPath $electronPath)) { throw 'Electron is missing. Use Start-Echo.cmd -Web or reinstall frontend dependencies.' }
$desktop = Start-Process -FilePath $electronPath -ArgumentList ('"' + (Join-Path $frontendDir 'electron\main.cjs') + '"') -WorkingDirectory $frontendDir -WindowStyle Hidden -PassThru
$desktop.Id | Set-Content -LiteralPath (Join-Path $stateDir 'desktop.pid')
