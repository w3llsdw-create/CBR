# Installs/updates dependencies for Caseboard in the local .venv and keeps the window open.
# Run with: Right-click > Run with PowerShell

$ErrorActionPreference = 'Continue'

Write-Host "== Caseboard dependency installer ==" -ForegroundColor Cyan

# Move to this script's folder
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Ensure venv exists
if (-not (Test-Path .\.venv\Scripts\python.exe)) {
  Write-Host "Creating virtual environment..." -ForegroundColor Yellow
  if (Get-Command py -ErrorAction SilentlyContinue) {
    py -3 -m venv .venv
  } else {
    python -m venv .venv
  }
}

# Show Python exe path
$py = Join-Path (Get-Location) ".venv\Scripts\python.exe"
Write-Host "Using Python: $py" -ForegroundColor Green

# Upgrade pip visibly
& $py -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { Write-Host "pip upgrade failed." -ForegroundColor Red }

# Install required packages (visible output)
Write-Host "Installing dependencies..." -ForegroundColor Yellow
& $py -m pip install fastapi==0.120.0 uvicorn==0.38.0 pydantic==2.12.3 APScheduler==3.10.4 httpx==0.27.2 requests==2.32.3 reportlab==3.6.13 fpdf2==2.7.9
if ($LASTEXITCODE -ne 0) {
  Write-Host "Some dependencies failed to install. The app may still run if at least one PDF engine installed (reportlab or fpdf2)." -ForegroundColor Red
}

Write-Host "\nAll done. You can now start the app via start_caseboard.bat" -ForegroundColor Cyan

Write-Host "\nPress Enter to close this window..."
[void](Read-Host)
