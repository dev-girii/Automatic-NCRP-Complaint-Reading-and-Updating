# NCRP Complaint Tool - Build Instructions

## Prerequisites

Before building the application, make sure you have the following installed:

1. **Python 3.9+** - Download from https://www.python.org/downloads/
   - Make sure to check "Add Python to PATH" during installation
   - Verify: `python --version`

2. **Node.js 18+** - Download from https://nodejs.org/
   - Verify: `node --version`

3. **Tesseract OCR** - Download from https://github.com/UB-Mannheim/tesseract/wiki
   - Install using the Windows 64-bit installer: `tesseract-ocr-w64-setup-5.x.x.exe`
   - Use default path: `C:\Program Files\Tesseract-OCR`
   - The build will copy Tesseract into the app bundle (no need on target PC)

## Build Procedure (with bundled Tesseract)

### Step 1: Setup Tesseract (one-time)

Run **`setup-tesseract.bat`** to copy Tesseract into `tools/tesseract/`:

1. Install Tesseract from https://github.com/UB-Mannheim/tesseract/wiki (if not already)
2. Double-click **`setup-tesseract.bat`**
3. This copies tesseract.exe, tessdata, and DLLs to `tools/tesseract/`
4. The bundled Tesseract will be included in your exe - **no separate install needed for end users**

### Step 2: Build the application

Double-click **`build.bat`** - it will:

1. Run setup-tesseract (if not already done)
2. Install Python dependencies
3. Build Python backend into `ncrp-backend.exe`
4. Install Node.js dependencies
5. Build Electron app with bundled Tesseract and backend

### Step 3: Output

Find your executables in the **`dist`** folder:

- **NCRP-Tool-Portable.exe** - Standalone portable app (no installation)
- **NCRP Complaint Tool Setup x.x.x.exe** - Windows installer

## What happens when the user runs the exe

1. **Backend auto-starts** - The Flask/Python backend runs automatically (no manual start)
2. **Tesseract is bundled** - OCR works from `tools/tesseract/` inside the app (relative path)
3. **SQLite stores data** in `%APPDATA%\ncrp-complaint-tool\data\`
4. **Uploads** go to the same data folder

## Manual Build (if needed)

```bash
# 1. Setup Tesseract first
setup-tesseract.bat

# 2. Build backend
cd backend
pip install -r requirements.txt
pip install pyinstaller
pyinstaller --clean --noconfirm ncrp-backend.spec
cd ..

# 3. Build Electron
npm install
npm run dist
```

## Development Mode

Double-click **`run-dev.bat`** or run `npm start`:

- Backend runs via Python (requires Python installed)
- Uses Tesseract from `tools/tesseract/` if present, else system install
- Opens with DevTools

## Troubleshooting

### "Tesseract not found" during setup
- Install Tesseract from the official installer
- Or set `TESSERACT_CMD` to your tesseract.exe path and run setup-tesseract.bat again

### Backend fails to start in packaged app
- Check that `backend/dist/ncrp-backend.exe` was created
- Run the portable exe from a folder with write permissions
- Data goes to `%APPDATA%\ncrp-complaint-tool\`

### OCR not working in packaged app
- Ensure setup-tesseract.bat ran successfully before build
- Check that `tools/tesseract/tesseract.exe` and `tools/tesseract/tessdata/` exist

### SQLite / data storage
- Development: `backend/data.db`
- Production: `%APPDATA%\ncrp-complaint-tool\data\data.db`

## File Structure

```
frontend/
├── electron/           # Electron main process
├── backend/            # Python Flask backend
│   └── dist/           # ncrp-backend.exe (after build)
├── tools/
│   └── tesseract/      # Bundled Tesseract (after setup-tesseract.bat)
│       ├── tesseract.exe
│       ├── tessdata/
│       └── *.dll
├── build.bat           # Full build script
├── setup-tesseract.bat # Copy Tesseract into bundle
└── run-dev.bat         # Development run
```
