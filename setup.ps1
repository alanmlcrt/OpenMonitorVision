param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$ForceInstall,
    [switch]$RecreateBackendVenv
)

# First-time and repeatable local setup for OpenMonitorVision.
$ErrorActionPreference = "Stop"

$RootDir = $PSScriptRoot
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$PythonMajor = 3
$PythonMinor = 12

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

function Get-HashOrEmpty {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return ""
    }

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Get-PythonVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string[]]$Args = @()
    )

    $command = Get-Command $Exe -ErrorAction SilentlyContinue
    if (-not $command -and -not (Test-Path -LiteralPath $Exe)) {
        return $null
    }

    try {
        $output = & $Exe @Args -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"
        if ($LASTEXITCODE -ne 0 -or -not $output) {
            return $null
        }

        return [version]($output | Select-Object -First 1)
    } catch {
        return $null
    }
}

function Test-PythonSupported {
    param([Parameter(Mandatory = $true)][version]$Version)

    return $Version.Major -eq $PythonMajor -and $Version.Minor -eq $PythonMinor
}

function Find-ProjectPython {
    $candidates = @(
        [pscustomobject]@{ Label = "py -3.12"; Exe = "py"; Args = @("-3.12") },
        [pscustomobject]@{ Label = "python"; Exe = "python"; Args = @() },
        [pscustomobject]@{ Label = "python3.12"; Exe = "python3.12"; Args = @() }
    )

    foreach ($candidate in $candidates) {
        $version = Get-PythonVersion -Exe $candidate.Exe -Args $candidate.Args
        if ($version -and (Test-PythonSupported $version)) {
            return [pscustomobject]@{
                Label = $candidate.Label
                Exe = $candidate.Exe
                Args = $candidate.Args
                Version = $version
            }
        }
    }

    throw "Python 3.12.x is required. Install Python 3.12, then rerun .\setup.ps1."
}

function Remove-ProjectDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $resolvedRoot = (Resolve-Path -LiteralPath $AllowedRoot).Path

    if (-not $resolvedPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete outside project root: $resolvedPath"
    }

    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

function Invoke-Python {
    param(
        [Parameter(Mandatory = $true)]$Python,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$ErrorMessage = "Python command failed"
    )

    Invoke-Checked {
        & $Python.Exe @($Python.Args + $Arguments)
    } $ErrorMessage
}

function Get-BackendStamp {
    param([Parameter(Mandatory = $true)][version]$PythonVersion)

    $requirementsHash = Get-HashOrEmpty (Join-Path $BackendDir "requirements.txt")
    return "python=$PythonVersion`nrequirements=$requirementsHash"
}

function Setup-Backend {
    Set-Location $BackendDir

    $venvDir = Join-Path $BackendDir "venv"
    $venvPythonPath = Join-Path $venvDir "Scripts\python.exe"
    $stampPath = Join-Path $venvDir ".omv-setup.stamp"
    $needCreateVenv = $false
    $projectPython = $null

    if ($RecreateBackendVenv -and (Test-Path -LiteralPath $venvDir)) {
        $projectPython = Find-ProjectPython
        Write-Host "Recreating backend virtual environment..."
        Remove-ProjectDirectory -Path $venvDir -AllowedRoot $BackendDir
        $needCreateVenv = $true
    } elseif (-not (Test-Path -LiteralPath $venvPythonPath)) {
        $needCreateVenv = $true
    } else {
        $venvVersion = Get-PythonVersion -Exe $venvPythonPath
        if (-not $venvVersion -or -not (Test-PythonSupported $venvVersion)) {
            $projectPython = Find-ProjectPython
            Write-Host "Backend venv uses Python $venvVersion. Recreating with Python 3.12..."
            Remove-ProjectDirectory -Path $venvDir -AllowedRoot $BackendDir
            $needCreateVenv = $true
        }
    }

    if ($needCreateVenv) {
        if (-not $projectPython) {
            $projectPython = Find-ProjectPython
        }
        Write-Host "Creating backend venv with $($projectPython.Label) ($($projectPython.Version))..."
        Invoke-Python -Python $projectPython -Arguments @("-m", "venv", "venv") -ErrorMessage "Failed to create backend virtual environment"
    }

    $venvPython = [pscustomobject]@{
        Label = "backend venv"
        Exe = $venvPythonPath
        Args = @()
        Version = Get-PythonVersion -Exe $venvPythonPath
    }

    if (-not $venvPython.Version -or -not (Test-PythonSupported $venvPython.Version)) {
        throw "Backend venv is not using Python 3.12.x."
    }

    $expectedStamp = Get-BackendStamp $venvPython.Version
    $currentStamp = if (Test-Path -LiteralPath $stampPath) { Get-Content -Raw -LiteralPath $stampPath } else { "" }

    if ($ForceInstall -or $currentStamp.Trim() -ne $expectedStamp.Trim()) {
        Write-Host "Installing backend dependencies..."
        Invoke-Python -Python $venvPython -Arguments @("-m", "pip", "install", "-r", "requirements.txt") -ErrorMessage "Failed to install backend dependencies"
        Set-Content -LiteralPath $stampPath -Value $expectedStamp
    } else {
        Write-Host "Backend dependencies already up to date."
    }
}

function Setup-Frontend {
    Set-Location $FrontendDir

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        $npm = Get-Command npm -ErrorAction SilentlyContinue
    }
    if (-not $npm) {
        throw "npm is required. Install Node.js LTS, then rerun .\setup.ps1."
    }

    $stampPath = Join-Path $FrontendDir "node_modules\.omv-setup.stamp"
    $lockPath = Join-Path $FrontendDir "package-lock.json"
    $packagePath = Join-Path $FrontendDir "package.json"
    $expectedStamp = "package=$((Get-HashOrEmpty $packagePath))`nlock=$((Get-HashOrEmpty $lockPath))"
    $currentStamp = if (Test-Path -LiteralPath $stampPath) { Get-Content -Raw -LiteralPath $stampPath } else { "" }
    $nodeModules = Join-Path $FrontendDir "node_modules"

    if ($ForceInstall -or -not (Test-Path -LiteralPath $nodeModules) -or $currentStamp.Trim() -ne $expectedStamp.Trim()) {
        if (Test-Path -LiteralPath $lockPath) {
            Write-Host "Installing frontend dependencies with npm ci..."
            Invoke-Checked { & $npm.Source "ci" } "Failed to install frontend dependencies"
        } else {
            Write-Host "Installing frontend dependencies with npm install..."
            Invoke-Checked { & $npm.Source "install" } "Failed to install frontend dependencies"
        }
        Set-Content -LiteralPath $stampPath -Value $expectedStamp
    } else {
        Write-Host "Frontend dependencies already up to date."
    }
}

$runBackend = -not $FrontendOnly
$runFrontend = -not $BackendOnly

if ($runBackend) {
    Setup-Backend
}

if ($runFrontend) {
    Setup-Frontend
}

Set-Location $RootDir
Write-Host "Setup complete."
