@echo off
setlocal EnableExtensions
title KMUTNB Attendance - Start all services

cd /d "%~dp0"
set "PROJECT_ROOT=%CD%"
set "BACKEND_PYTHON=%PROJECT_ROOT%\backend\.venv-windows\Scripts\python.exe"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22.12+ LTS or 24 LTS.
  exit /b 1
)

node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 24 || (major === 22 && minor >= 12) ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
  for /f "delims=" %%V in ('node -p "process.versions.node"') do echo [ERROR] Node.js 22.12+ or 24 is required. Current version: %%V
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found. Repair the Node.js installation.
  exit /b 1
)

if not exist "%BACKEND_PYTHON%" (
  echo [ERROR] backend\.venv-windows is missing. Run setup_windows.bat first.
  exit /b 1
)

for %%F in (
  "%PROJECT_ROOT%\backend\.env"
  "%PROJECT_ROOT%\ocr-service\.env"
  "%PROJECT_ROOT%\frontend\.env.local"
) do (
  if not exist "%%~F" (
    echo [ERROR] Missing configuration file: %%~F
    echo Run setup_windows.bat and fill in the required Supabase and OCR values.
    exit /b 1
  )
)

echo ===================================================
echo Starting KMUTNB Attendance on Windows
echo ===================================================
echo Backend : http://127.0.0.1:8000
echo OCR     : http://127.0.0.1:3001
echo Frontend: http://127.0.0.1:5173
echo.

start "Attendance Backend" /D "%PROJECT_ROOT%\backend" "%BACKEND_PYTHON%" -m uvicorn main:app --host 127.0.0.1 --port 8000
start "Attendance OCR" /D "%PROJECT_ROOT%\ocr-service" "%ComSpec%" /d /k ""%PROJECT_ROOT%\ocr-service\start_windows.cmd""
start "Attendance Frontend" /D "%PROJECT_ROOT%\frontend" "%ComSpec%" /d /k npm.cmd run dev -- --host 127.0.0.1

echo Services were opened in three separate windows.
echo Close those service windows to stop the system.
exit /b 0
