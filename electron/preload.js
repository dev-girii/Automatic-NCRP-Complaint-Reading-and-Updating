// Preload script for Electron
// This script runs before the renderer process loads

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get the backend URL
  getBackendUrl: () => 'http://127.0.0.1:5000',
  
  // Platform info
  platform: process.platform,
  
  // Check if running in Electron
  isElectron: true
});

// Log that preload script has loaded
console.log('Electron preload script loaded');
