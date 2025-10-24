@echo off
cd /d "C:\Users\David Wells\CBR"
REM Kill any running uvicorn processes
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000') do taskkill /PID %%a /F >nul 2>&1
REM Start uvicorn in a new window
start "Caseboard API" cmd /k "".venv\Scripts\python.exe" -m uvicorn app:app --reload --host 127.0.0.1 --port 8000"
REM Wait a moment for the server to start
ping 127.0.0.1 -n 3 >nul
REM Open management and TV apps in browser
start "" "http://127.0.0.1:8000/manage"
start "" "http://127.0.0.1:8000/tv"
