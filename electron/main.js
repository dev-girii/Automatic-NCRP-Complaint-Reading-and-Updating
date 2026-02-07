const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow;
let backendProcess = null;
let backendPort = 5000;

// Determine if we're running in development or production
const isDev = !app.isPackaged;

// Get the correct paths based on environment
function getBackendPath() {
  if (isDev) {
    // Development: run Python directly
    return {
      type: 'python',
      script: path.join(__dirname, '..', 'backend', 'app.py'),
      cwd: path.join(__dirname, '..', 'backend')
    };
  } else {
    // Production: run the packaged executable
    const resourcesPath = process.resourcesPath;
    // The executable is directly in the backend folder after PyInstaller onefile build
    const exePath = path.join(resourcesPath, 'backend', 'ncrp-backend.exe');
    console.log('Looking for backend exe at:', exePath);
    console.log('Exe exists:', fs.existsSync(exePath));
    return {
      type: 'exe',
      exe: exePath,
      cwd: path.join(resourcesPath, 'backend') // Run from the backend resources folder
    };
  }
}

// Data path: C:\NCRP (database, Excel, uploads, pending)
function getNCRPDataPath() {
  const dataPath = 'C:\\NCRP';
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }
  const uploadsPath = path.join(dataPath, 'uploads');
  if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
  }
  const pendingPath = path.join(dataPath, 'pending');
  if (!fs.existsSync(pendingPath)) {
    fs.mkdirSync(pendingPath, { recursive: true });
  }
  return dataPath;
}

// Get bundled Tesseract path (for OCR)
function getTesseractPath() {
  if (isDev) {
    const devPath = path.join(__dirname, '..', 'tools', 'tesseract', 'tesseract.exe');
    if (fs.existsSync(devPath)) return devPath;
    return null; // Fallback to ncrp_script's auto-detection
  } else {
    const prodPath = path.join(process.resourcesPath, 'tools', 'tesseract', 'tesseract.exe');
    if (fs.existsSync(prodPath)) return prodPath;
    return null;
  }
}

// Get app/resources path for NCRP_APP_PATH (used by ncrp_script for relative tesseract path)
function getAppResourcesPath() {
  if (isDev) {
    return path.join(__dirname, '..');
  } else {
    return process.resourcesPath;
  }
}

// Start the Python backend server (runs automatically when app opens)
function startBackend() {
  return new Promise((resolve, reject) => {
    const backendConfig = getBackendPath();
    const userDataPath = getNCRPDataPath();
    const tesseractPath = getTesseractPath();
    const appResourcesPath = getAppResourcesPath();
    
    // Set environment variables for the backend
    const env = {
      ...process.env,
      NCRP_DATA_PATH: userDataPath,
      NCRP_APP_PATH: appResourcesPath,
      PYTHONUNBUFFERED: '1'
    };
    
    if (tesseractPath) {
      env.TESSERACT_CMD = tesseractPath;
      // TESSDATA_PREFIX = tessdata folder (Tesseract looks for TESSDATA_PREFIX/eng.traineddata)
      const tessDir = path.dirname(tesseractPath);
      const tessdataDir = path.join(tessDir, 'tessdata');
      if (fs.existsSync(tessdataDir)) {
        env.TESSDATA_PREFIX = tessdataDir.replace(/\\/g, '/');
      }
      console.log('Tesseract:', tesseractPath, 'TESSDATA_PREFIX:', env.TESSDATA_PREFIX);
    } else {
      console.log('Tesseract not in bundle - will use system/PATH if available');
    }
    
    console.log('Starting backend...');
    console.log('Backend config:', backendConfig);
    console.log('User data path:', userDataPath);
    
    if (backendConfig.type === 'python') {
      // Development mode: run Python directly
      backendProcess = spawn('python', [backendConfig.script], {
        cwd: backendConfig.cwd,
        env: env,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } else {
      // Production mode: run the packaged executable
      backendProcess = spawn(backendConfig.exe, [], {
        cwd: backendConfig.cwd,
        env: env,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }
    
    backendProcess.stdout.on('data', (data) => {
      console.log(`Backend: ${data}`);
    });
    
    backendProcess.stderr.on('data', (data) => {
      console.error(`Backend Error: ${data}`);
    });
    
    backendProcess.on('error', (err) => {
      console.error('Failed to start backend:', err);
      reject(err);
    });
    
    backendProcess.on('close', (code) => {
      console.log(`Backend process exited with code ${code}`);
      backendProcess = null;
    });
    
    // Wait for the backend to be ready
    waitForBackend(backendPort, 30000)
      .then(() => {
        console.log('Backend is ready!');
        resolve();
      })
      .catch((err) => {
        console.error('Backend failed to start:', err);
        reject(err);
      });
  });
}

// Wait for the backend to respond
function waitForBackend(port, timeout) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    function checkBackend() {
      if (Date.now() - startTime > timeout) {
        reject(new Error('Backend startup timeout'));
        return;
      }
      
      const req = http.request({
        hostname: '127.0.0.1',
        port: port,
        path: '/api/config',
        method: 'GET',
        timeout: 1000
      }, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(checkBackend, 500);
        }
      });
      
      req.on('error', () => {
        setTimeout(checkBackend, 500);
      });
      
      req.on('timeout', () => {
        req.destroy();
        setTimeout(checkBackend, 500);
      });
      
      req.end();
    }
    
    checkBackend();
  });
}

// Stop the backend server
function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend...');
    
    // On Windows, we need to kill the process tree
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
    } else {
      backendProcess.kill('SIGTERM');
    }
    
    backendProcess = null;
  }
}

// Create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    // icon: path.join(__dirname, 'icon.png'), // Add icon file if available
    show: false
  });
  
  // Load the index.html
  const indexPath = isDev
    ? path.join(__dirname, '..', 'index.html')
    : path.join(__dirname, '..', 'index.html');
  
  mainWindow.loadFile(indexPath);
  
  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App ready
app.whenReady().then(async () => {
  try {
    // Start the backend first
    await startBackend();
    
    // Then create the window
    createWindow();
  } catch (err) {
    console.error('Failed to start application:', err);
    dialog.showErrorBox('Startup Error', 
      'Failed to start the backend server. Please make sure Python is installed and try again.\n\n' + err.message);
    app.quit();
  }
});

// Handle window activation (macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up on quit
app.on('before-quit', () => {
  stopBackend();
});

app.on('quit', () => {
  stopBackend();
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  stopBackend();
});
