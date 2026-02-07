@echo off
echo ========================================
echo NCRP Complaint Tool - Development Mode
echo ========================================
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    pause
    exit /b 1
)

REM Check if Node.js is available
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    pause
    exit /b 1
)

REM Install Node dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo Installing Node.js dependencies...
    call npm install
)

echo.
echo Starting the application in development mode...
echo (Backend will start automatically with Electron)
echo.
echo Press Ctrl+C to stop the application.
echo.

call npm start
