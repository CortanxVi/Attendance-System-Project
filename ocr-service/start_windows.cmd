@echo off
setlocal EnableExtensions

rem The OCR worker must not inherit database or browser credentials.
set "SUPABASE_URL="
set "SUPABASE_KEY="
set "SUPABASE_SECRET_KEY="
set "SUPABASE_SERVICE_ROLE_KEY="
set "VITE_SUPABASE_URL="
set "VITE_SUPABASE_ANON_KEY="
set "VITE_SUPABASE_PUBLISHABLE_KEY="
set "OCR_SERVICE_TOKEN="

node --env-file="%~dp0.env" "%~dp0ocr-server.js"
set "OCR_EXIT_CODE=%ERRORLEVEL%"
if not "%OCR_EXIT_CODE%"=="0" echo [ERROR] OCR service stopped with exit code %OCR_EXIT_CODE%.
exit /b %OCR_EXIT_CODE%
