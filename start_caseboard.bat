@echo off
setlocal enableextensions

REM Change to the folder this script lives in (portable between machines)
cd /d "%~dp0"

REM Ensure virtual environment exists
if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  py -3 -m venv .venv
)

REM If dependencies might be missing, prompt to run installer
if not exist ".venv\Lib\site-packages\reportlab" if not exist ".venv\Lib\site-packages\fpdf" (
  echo Dependencies not detected. Opening installer window...
  start powershell -ExecutionPolicy Bypass -File "%cd%\install_caseboard.ps1"
  echo Waiting for installer to close...
  pause
)


REM Kill any processes bound to port 8000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000') do taskkill /PID %%a /F >nul 2>&1

REM Start uvicorn in a new window (accessible to entire WiFi network)
start "Caseboard API" cmd /k ""%cd%\.venv\Scripts\python.exe" -m uvicorn app:app --reload --host 0.0.0.0 --port 8000"


REM Wait a moment for the server to start
ping 127.0.0.1 -n 3 >nul

REM Open management and TV apps in browser
start "" "http://192.168.0.98:8000/manage"
start "" "http://192.168.0.98:8000/tv"

endlocal
