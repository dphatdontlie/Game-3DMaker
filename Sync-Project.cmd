@echo off
setlocal
cd /d "%~dp0"
echo Checking for local changes...
git diff --quiet
if errorlevel 1 goto dirty
git diff --cached --quiet
if errorlevel 1 goto dirty
git pull --ff-only
if errorlevel 1 goto failed
call npm.cmd ci --no-fund --no-audit
if errorlevel 1 goto failed
echo Project is up to date. Your maps in data were not changed.
pause
exit /b 0
:dirty
echo Local code changes found. Please save them in Git before syncing.
pause
exit /b 1
:failed
echo Sync failed. No force pull or reset was performed.
pause
exit /b 1
