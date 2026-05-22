param(
    [switch]$SkipSetup,
    [switch]$ForceSetup
)

# Start the Vite dev server.
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
    $setupArgs = @("-FrontendOnly")
    if ($ForceSetup) {
        $setupArgs += "-ForceInstall"
    }

    Invoke-Checked {
        & (Join-Path $PSScriptRoot "setup.ps1") @setupArgs
    } "Frontend setup failed"
}

Set-Location (Join-Path $PSScriptRoot "frontend")

Write-Host "Starting frontend on http://127.0.0.1:5173"
Invoke-Checked {
    npm run dev
} "Frontend stopped with an error"
