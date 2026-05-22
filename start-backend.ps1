param(
    [switch]$SkipSetup,
    [switch]$ForceSetup
)

# Start the FastAPI backend.
$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Script,
        [string]$ErrorMessage = "Command failed"
    )

    & $Script
    if ($LASTEXITCODE -ne 0) {
        throw "$ErrorMessage (exit code $LASTEXITCODE)"
    }
}

if (-not $SkipSetup) {
    $setupArgs = @("-BackendOnly")
    if ($ForceSetup) {
        $setupArgs += "-ForceInstall"
    }

    Invoke-Checked {
        & (Join-Path $PSScriptRoot "setup.ps1") @setupArgs
    } "Backend setup failed"
}

Set-Location (Join-Path $PSScriptRoot "backend")

$python = ".\venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "Backend venv is missing. Run .\setup.ps1 -BackendOnly first."
}

Write-Host "Starting backend on http://127.0.0.1:8000"
Invoke-Checked {
    & $python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
} "Backend stopped with an error"
