@echo off
setlocal EnableDelayedExpansion
set "SILENT="
if /i "%1"=="silent" set "SILENT=1"
echo ========================================
echo Tesseract OCR - Setup for NCRP Build
echo ========================================
echo.

set "TARGET=%~dp0tools\tesseract"
set "TARGET_EXE=%TARGET%\tesseract.exe"

REM Create target folder
if not exist "%TARGET%" mkdir "%TARGET%"
if not exist "%TARGET%\tessdata" mkdir "%TARGET%\tessdata"

REM Check if already set up
if exist "%TARGET_EXE%" (
    echo Tesseract already found at %TARGET_EXE%
    "%TARGET_EXE%" --version 2>nul
    if !errorlevel! equ 0 (
        echo Setup complete. You can proceed with the build.
        if not defined SILENT pause
        exit /b 0
    )
)

REM Common Tesseract install locations
set "SOURCES="
set "SOURCES=!SOURCES! %ProgramFiles%\Tesseract-OCR"
set "SOURCES=!SOURCES! %ProgramFiles(x86)%\Tesseract-OCR"
set "SOURCES=!SOURCES! %LOCALAPPDATA%\Programs\Tesseract-OCR"
set "SOURCES=!SOURCES! C:\Program Files\Tesseract-OCR"
set "SOURCES=!SOURCES! C:\Program Files (x86)\Tesseract-OCR"
set "SOURCES=!SOURCES! C:\Tesseract-OCR"

REM Also check TESSERACT_CMD env var
if defined TESSERACT_CMD (
    for %%A in ("%TESSERACT_CMD%") do set "TESSERACT_DIR=%%~dpA"
    set "SOURCES=!SOURCES! !TESSERACT_DIR:~0,-1!"
)

set "FOUND="
for %%D in (!SOURCES!) do (
    if exist "%%~D\tesseract.exe" (
        set "FOUND=%%~D"
        goto :copy
    )
)

echo.
echo ERROR: Tesseract OCR not found!
echo.
echo Please install Tesseract first:
echo   1. Download from: https://github.com/UB-Mannheim/tesseract/wiki
echo   2. Run the installer (tesseract-ocr-w64-setup-5.x.x.exe)
echo   3. Use default install path: C:\Program Files\Tesseract-OCR
echo   4. Run this script again
echo.
echo Or set TESSERACT_CMD to your tesseract.exe path and run again.
echo.
if not defined SILENT pause
exit /b 1

:copy
echo Found Tesseract at: %FOUND%
echo.
echo Copying files to %TARGET%...

REM Copy main executable
copy /Y "%FOUND%\tesseract.exe" "%TARGET%\"
if errorlevel 1 (
    echo Failed to copy tesseract.exe
    pause
    exit /b 1
)

REM Copy tessdata (required for OCR)
if exist "%FOUND%\tessdata" (
    xcopy /E /Y /I "%FOUND%\tessdata\*" "%TARGET%\tessdata\"
)

REM Copy DLLs (tesseract needs these at runtime)
for %%F in (leptonica-1.82.0.dll leptonica-1.83.dll leptonica-1.84.dll liblept-5.dll) do (
    if exist "%FOUND%\%%F" copy /Y "%FOUND%\%%F" "%TARGET%\"
)
for %%F in (libtesseract-5.dll libtesseract-4.dll) do (
    if exist "%FOUND%\%%F" copy /Y "%FOUND%\%%F" "%TARGET%\"
)
REM Copy all DLLs to be safe
for %%F in ("%FOUND%\*.dll") do copy /Y "%%F" "%TARGET%\" 2>nul

echo.
echo ========================================
echo Setup complete!
echo ========================================
echo Tesseract copied to: %TARGET%
echo.
echo You can now run build.bat to create the executable.
echo.
if not defined SILENT pause
exit /b 0
