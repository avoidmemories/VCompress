@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo VCompress setup
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found.
    echo Trying to install Node.js LTS with winget...
    echo.
    where winget >nul 2>nul
    if errorlevel 1 (
        echo ERROR: winget was not found.
        echo Install Node.js LTS manually from https://nodejs.org/
        echo Then run this setup.bat again.
        pause
        exit /b 1
    )
    winget install --id OpenJS.NodeJS.LTS -e --source winget
    if errorlevel 1 (
        echo.
        echo ERROR: Node.js installation failed.
        echo Install Node.js LTS manually from https://nodejs.org/
        echo Then run this setup.bat again.
        pause
        exit /b 1
    )
    echo.
    echo Node.js was installed.
    echo Close this window, open setup.bat again, and continue installation.
    pause
    exit /b 0
)

where npm >nul 2>nul
if errorlevel 1 (
    echo ERROR: npm was not found.
    echo Reinstall Node.js LTS from https://nodejs.org/
    pause
    exit /b 1
)

echo Node:
node --version
echo.
echo npm:
npm --version
echo.

echo Installing app dependencies...
if exist package-lock.json (
    npm ci
) else (
    npm install
)

if errorlevel 1 (
    echo.
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Setup completed successfully.
echo Run run.bat or run_hidden.vbs to start.
echo ========================================
pause
