@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer from https://nodejs.org first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing packages for the first run...
  call npm.cmd ci --no-fund --no-audit
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node scripts/launch.mjs
if errorlevel 1 pause
