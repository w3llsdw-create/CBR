@echo off
setlocal enableextensions

REM Change to the folder this script lives in (portable between machines)
cd /d "%~dp0"

REM Ensure virtual environment exists
if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  py -3 -m venv .venv
)

REM Upgrade pip quietly
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul 2>&1

REM Install minimal dependencies (ignore any broken requirements.txt)
".venv\Scripts\python.exe" -m pip install fastapi==0.120.0 uvicorn==0.38.0 pydantic==2.12.3 APScheduler==3.10.4 httpx==0.27.2 requests==2.32.3 >nul

REM Kill any processes bound to port 8000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000') do taskkill /PID %%a /F >nul 2>&1

REM Start uvicorn in a new window
start "Caseboard API" cmd /k ""%cd%\.venv\Scripts\python.exe" -m uvicorn app:app --reload --host 127.0.0.1 --port 8000"

REM Wait a moment for the server to start
ping 127.0.0.1 -n 3 >nul

REM Open management and TV apps in browser
start "" "http://127.0.0.1:8000/manage"
start "" "http://127.0.0.1:8000/tv"

endlocal
