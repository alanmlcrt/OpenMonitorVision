# Start the FastAPI backend
Set-Location "$PSScriptRoot\backend"

if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv venv
}

Write-Host "Activating venv..."
& ".\venv\Scripts\Activate.ps1"

Write-Host "Installing dependencies..."
pip install -r requirements.txt --quiet

Write-Host "Starting backend on http://localhost:8000"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
