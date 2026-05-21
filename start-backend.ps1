# Start the FastAPI backend
$ErrorActionPreference = "Stop"

Set-Location "$PSScriptRoot\backend"

function Get-ProjectPython {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return "python"
    }

    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        return "py -3"
    }

    throw "Python is not available on PATH. Install Python 3.12+ or add it to PATH, then rerun this script."
}

function Test-Venv {
    if (-not (Test-Path "venv\Scripts\python.exe")) {
        return $false
    }

    & ".\venv\Scripts\python.exe" --version *> $null
    return $LASTEXITCODE -eq 0
}

if (-not (Test-Venv)) {
    if (Test-Path "venv") {
        Write-Host "Existing venv is not usable. Recreating it..."
        Remove-Item -Recurse -Force "venv"
    } else {
        Write-Host "Creating virtual environment..."
    }

    $projectPython = Get-ProjectPython
    Invoke-Expression "$projectPython -m venv venv"
}

Write-Host "Activating venv..."
& ".\venv\Scripts\Activate.ps1"

Write-Host "Installing dependencies..."
python -m pip install -r requirements.txt --quiet

Write-Host "Starting backend on http://127.0.0.1:8000"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
