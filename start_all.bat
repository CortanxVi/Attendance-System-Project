@echo off
title Demo0.2 Services Startup
echo ===================================================
echo Starting All Services for Demo0.2
echo ===================================================

echo [1/3] Starting Backend (FastAPI)...
start "Backend (FastAPI)" cmd /k "cd backend && .\venv\Scripts\uvicorn main:app --reload"

echo [2/3] Starting OCR Service (Node.js)...
start "OCR Service" cmd /k "cd ocr-service && npm start"

echo [3/3] Starting Frontend (Vite)...
start "Frontend (Vite)" cmd /k "cd frontend && npm run dev"

echo.
echo All services have been launched in separate windows!
echo You can close this window now.
