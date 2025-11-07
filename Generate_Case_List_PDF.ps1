# Current Case List PDF Generator - PowerShell Version
# Double-click this file to generate a PDF report of all current cases

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "          Current Case List PDF Generator" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# Set the Python path for the virtual environment
$PythonPath = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

# Check if virtual environment Python is available
if (-not (Test-Path $PythonPath)) {
    Write-Host "ERROR: Virtual environment not found" -ForegroundColor Red
    Write-Host "Please ensure the Python virtual environment is set up in .venv folder" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Using Python from virtual environment..." -ForegroundColor Green

# Check if reportlab is installed
try {
    & $PythonPath -c "import reportlab" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "reportlab not installed"
    }
    Write-Host "reportlab is already installed." -ForegroundColor Green
} catch {
    Write-Host "Installing reportlab package..." -ForegroundColor Yellow
    & $PythonPath -m pip install reportlab
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install reportlab" -ForegroundColor Red
        Write-Host "Please check your internet connection and try again." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "reportlab installed successfully!" -ForegroundColor Green
}

Write-Host ""
Write-Host "Generating PDF report..." -ForegroundColor Yellow
Write-Host ""

# Run the PDF generator
$ScriptPath = Join-Path $PSScriptRoot "generate_case_list_pdf.py"
& $PythonPath $ScriptPath

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "PDF report generated successfully!" -ForegroundColor Green
    Write-Host "The file should have opened automatically." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "ERROR: Failed to generate PDF report" -ForegroundColor Red
    Write-Host "Please check the error messages above." -ForegroundColor Red
}

Write-Host ""
Read-Host "Press Enter to close this window"