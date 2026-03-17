@echo off
chcp 65001 >nul
cd /d "%~dp0"
node run_daily_job.js
