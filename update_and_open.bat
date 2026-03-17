@echo off
chcp 65001 >nul

echo ============================================
echo   BRAG Intelligence Dashboard - Updating...
echo ============================================

cd /d "%~dp0"

:: Run the daily job
node run_daily_job.js

echo.
echo Opening dashboard in browser...
explorer "http://localhost:3001"

echo.
echo Starting server (don't close this window!)...
node src/server.js
