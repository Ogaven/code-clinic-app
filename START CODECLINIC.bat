@echo off
title Code Clinic — Starting...
color 1F
echo.
echo  ==========================================
echo   CODE CLINIC — Starting All Services
echo  ==========================================
echo.

:: Kill anything on ports 4000 and 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":4000" 2^>nul') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" 2^>nul') do taskkill /PID %%a /F >nul 2>&1

echo  [1/2] Starting API on http://localhost:4000
start "CodeClinic API :4000" cmd /k "cd /d "%~dp0codeclinic\apps\api" && pnpm dev"

timeout /t 4 /nobreak >nul

echo  [2/2] Starting Web on http://localhost:3000
start "CodeClinic Web :3000" cmd /k "cd /d "%~dp0codeclinic\apps\web" && npx next dev -p 3000"

echo.
echo  ==========================================
echo   Both servers starting in separate windows
echo   API  → http://localhost:4000
echo   Web  → http://localhost:3000
echo  ==========================================
echo.
timeout /t 6 /nobreak >nul

start "" "http://localhost:3000"
echo  Browser opened. You can close this window.
pause
