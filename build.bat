@echo off
echo ========================================
echo NCRP Complaint Tool - Build Script
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

echo [0/6] Setting up Tesseract OCR (bundled with app)...
call "%~dp0setup-tesseract.bat" silent
if errorlevel 1 (
    echo ERROR: Tesseract setup failed. Install Tesseract first, then run setup-tesseract.bat
    pause
    exit /b 1
)

if not exist "%~dp0tools\tesseract\tesseract.exe" (
    echo ERROR: tools\tesseract\tesseract.exe not found. Run setup-tesseract.bat first.
    pause
    exit /b 1
)
echo Tesseract found. OK.
echo.

echo [1/6] Installing Python dependencies...
cd backend
pip install -r requirements.txt
pip install pyinstaller
if errorlevel 1 (
    echo ERROR: Failed to install Python dependencies
    cd ..
    pause
    exit /b 1
)

echo.
echo [2/6] Building Python backend executable...
pyinstaller --clean --noconfirm ncrp-backend.spec
if errorlevel 1 (
    echo ERROR: Failed to build Python backend
    cd ..
    pause
    exit /b 1
)

cd ..

echo.
echo [3/6] Installing Node.js dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install Node.js dependencies
    pause
    exit /b 1
)

echo.
echo [4/6] Building Electron application (includes Tesseract, auto-starts backend)...
call npm run dist
if errorlevel 1 (
    echo ERROR: Failed to build Electron app
    pause
    exit /b 1
)

echo.
echo ========================================
echo BUILD COMPLETE!
echo ========================================
echo.
echo Output files are in the 'dist' folder:
echo  - NCRP-Tool-Portable.exe (standalone, no install needed)
echo  - NCRP Complaint Tool Setup*.exe (installer)
echo.
echo The app will:
echo  - Auto-start the backend when you open the exe
echo  - Use bundled Tesseract for OCR (no separate install needed)
echo  - Store data (data.db, ncrp_complaints.xlsx) in C:\NCRP
echo.
pause
