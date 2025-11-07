@echo off
echo =====================================================
echo          Current Case List PDF Generator
echo =====================================================
echo.

REM Set the Python path for the virtual environment
set PYTHON_PATH="%~dp0.venv\Scripts\python.exe"

REM Check if virtual environment Python is available
%PYTHON_PATH% --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Virtual environment not found
    echo Please ensure the Python virtual environment is set up in .venv folder
    pause
    exit /b 1
)

echo Using Python from virtual environment...

REM Check if reportlab is installed
%PYTHON_PATH% -c "import reportlab" >nul 2>&1
if errorlevel 1 (
    echo Installing reportlab package...
    %PYTHON_PATH% -m pip install reportlab
    if errorlevel 1 (
        echo ERROR: Failed to install reportlab
        echo Please check your internet connection and try again.
        pause
        exit /b 1
    )
    echo reportlab installed successfully!
) else (
    echo reportlab is already installed.
)

echo.
echo Generating PDF report...
echo.

REM Run the PDF generator
%PYTHON_PATH% generate_case_list_pdf.py

if errorlevel 1 (
    echo.
    echo ERROR: Failed to generate PDF report
    echo Please check the error messages above.
) else (
    echo.
    echo PDF report generated successfully!
    echo The file should have opened automatically.
)

echo.
echo Press any key to close this window...
pause >nul