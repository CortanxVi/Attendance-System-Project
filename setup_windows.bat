@echo off
setlocal EnableExtensions
title KMUTNB Attendance - Windows setup

cd /d "%~dp0"
set "PROJECT_ROOT=%CD%"

where py.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python Launcher was not found. Install Python 3.12 x64 from python.org.
  exit /b 1
)

py -3.12 -c "import platform, struct, sys; ok = sys.version_info[:2] == (3, 12) and struct.calcsize('P') * 8 == 64 and platform.machine().lower() in ('amd64', 'x86_64'); raise SystemExit(0 if ok else 1)" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python 3.12 x64 was not found. Install the x64 build and enable the Python Launcher.
  exit /b 1
)

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

if not exist "%PROJECT_ROOT%\backend\.venv-windows\Scripts\python.exe" (
  echo [1/4] Creating the Python virtual environment...
  py -3.12 -m venv "%PROJECT_ROOT%\backend\.venv-windows"
  if errorlevel 1 goto :failed
) else (
  echo [1/4] Python virtual environment already exists.
)

echo [2/4] Installing backend packages...
"%PROJECT_ROOT%\backend\.venv-windows\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :failed
"%PROJECT_ROOT%\backend\.venv-windows\Scripts\python.exe" -m pip install -r "%PROJECT_ROOT%\backend\requirement.txt"
if errorlevel 1 goto :failed

echo [3/4] Installing Light OCR packages...
pushd "%PROJECT_ROOT%\ocr-service"
call npm.cmd ci
if errorlevel 1 (popd & goto :failed)
call npm.cmd run doctor
if errorlevel 1 (popd & goto :failed)
popd

echo [4/4] Installing frontend packages...
pushd "%PROJECT_ROOT%\frontend"
call npm.cmd ci
if errorlevel 1 (popd & goto :failed)
popd

if not exist "%PROJECT_ROOT%\backend\.env" copy /Y "%PROJECT_ROOT%\backend\.env.example" "%PROJECT_ROOT%\backend\.env" >nul
if not exist "%PROJECT_ROOT%\ocr-service\.env" copy /Y "%PROJECT_ROOT%\ocr-service\.env.example" "%PROJECT_ROOT%\ocr-service\.env" >nul
if not exist "%PROJECT_ROOT%\frontend\.env.local" copy /Y "%PROJECT_ROOT%\frontend\.env.local.example" "%PROJECT_ROOT%\frontend\.env.local" >nul

echo.
echo Setup completed.
echo IMPORTANT: Fill in backend\.env, ocr-service\.env, and frontend\.env.local.
echo Use the same random OCR_SERVICE_TOKEN in the backend and OCR files.
echo Then run start_all.bat.
exit /b 0

:failed
echo.
echo [ERROR] Setup failed. Review the error above; no existing .env file was overwritten.
exit /b 1
