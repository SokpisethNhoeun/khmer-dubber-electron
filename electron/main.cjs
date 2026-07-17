const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
app.commandLine.appendSwitch('ignore-certificate-errors');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Initialize logs file
const logFilePath = path.join(app.getPath('userData'), 'app.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function logToFile(type, message) {
  const cleanMsg = message.toString().trim();
  const logMessage = `[${new Date().toISOString()}] [${type}] ${cleanMsg}\n`;
  try {
    logStream.write(logMessage);
  } catch (e) {
    console.error('Failed to write log to file', e);
  }
  if (type === 'ERROR') {
    console.error(`[${type}] ${cleanMsg}`);
  } else {
    console.log(`[${type}] ${cleanMsg}`);
  }
}

// Log initial startup info
logToFile('INFO', `App starting. UserData path: ${app.getPath('userData')}`);

let mainWindow;
let pythonProcess = null;
const BACKEND_PORT = 9847;

const isDev = !app.isPackaged;

function getPythonPath() {
  if (isDev) {
    const platform = process.platform;
    if (platform === 'win32') {
      return path.join(__dirname, '..', 'python-backend', 'venv', 'Scripts', 'python.exe');
    }
    return path.join(__dirname, '..', 'python-backend', 'venv', 'bin', 'python');
  } else {
    const platform = process.platform;
    const exeName = platform === 'win32' ? 'main.exe' : 'main';
    return path.join(process.resourcesPath, 'python-backend', 'dist', 'main', exeName);
  }
}

function startPythonBackend() {
  const pythonPath = getPythonPath();
  const mainPyPath = path.join(__dirname, '..', 'python-backend', 'main.py');
  
  let args = [];
  let execPath = pythonPath;

  if (isDev) {
    args = [mainPyPath, BACKEND_PORT.toString()];
  } else {
    execPath = pythonPath;
    args = [BACKEND_PORT.toString()];
  }

  logToFile('INFO', `Starting Python backend: ${execPath} ${args.join(' ')}`);

  pythonProcess = spawn(execPath, args, {
    cwd: path.dirname(execPath),
    stdio: 'pipe',
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  pythonProcess.stdout.on('data', (data) => {
    logToFile('PYTHON_STDOUT', data);
  });

  pythonProcess.stderr.on('data', (data) => {
    logToFile('PYTHON_STDERR', data);
  });

  pythonProcess.on('close', (code) => {
    logToFile('INFO', `Python backend exited with code ${code}`);
  });
}

function checkBackendReady(callback, retries = 20) {
  const client = new net.Socket();
  client.connect(BACKEND_PORT, '127.0.0.1', () => {
    client.end();
    callback(true);
  });

  client.on('error', () => {
    if (retries > 0) {
      setTimeout(() => checkBackendReady(callback, retries - 1), 500);
    } else {
      callback(false);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Khmer Dubber',
    titleBarStyle: 'default',
    backgroundColor: '#0d0e12',
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:4927');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov'] }
    ]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

const getProjectsPath = () => {
  const fs = require('fs');
  const p = path.join(app.getPath('documents'), 'Dubify Projects');
  fs.mkdirSync(p, { recursive: true });
  return p;
};

ipcMain.handle('select-save-project', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Save Dubify Project',
    defaultPath: path.join(getProjectsPath(), 'project.dubify'),
    filters: [
      { name: 'Dubify Project', extensions: ['dubify'] }
    ]
  });
  if (result.canceled) return null;
  return result.filePath;
});

ipcMain.handle('select-open-project', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Dubify Project',
    defaultPath: getProjectsPath(),
    filters: [
      { name: 'Dubify Project', extensions: ['dubify'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-file', async (event, options) => {
  const result = await dialog.showOpenDialog({
    title: options.title || 'Select File',
    filters: options.filters || [],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-export-video', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Export Dubbed Video',
    defaultPath: 'final_dubbed.mp4',
    filters: [
      { name: 'MP4 Video', extensions: ['mp4'] }
    ]
  });
  if (result.canceled) return null;
  return result.filePath;
});

ipcMain.handle('export-logs', async () => {
  const defaultPath = path.join(app.getPath('desktop'), 'khmer-video-dubber-logs.txt');
  const result = await dialog.showSaveDialog({
    title: 'Export Application Logs',
    defaultPath: defaultPath,
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });
  
  if (result.canceled) return { success: false };
  
  try {
    if (fs.existsSync(logFilePath)) {
      fs.copyFileSync(logFilePath, result.filePath);
    } else {
      fs.writeFileSync(result.filePath, 'No logs recorded yet.');
    }
    return { success: true, path: result.filePath };
  } catch (err) {
    logToFile('ERROR', `Failed to export logs: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('encrypt-string', async (event, plainText) => {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(plainText).toString('base64');
    }
  } catch (err) {
    logToFile('ERROR', `safeStorage encryption failed, falling back to plaintext: ${err.message}`);
  }
  return plainText;
});

ipcMain.handle('decrypt-string', async (event, encryptedBase64) => {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(buffer);
    }
  } catch (err) {
    logToFile('ERROR', `safeStorage decryption failed, returning encrypted data: ${err.message}`);
  }
  return encryptedBase64;
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
  } catch (err) {
    logToFile('ERROR', `Failed to open external link: ${err.message}`);
  }
});

ipcMain.handle('get-hostname', () => {
  try {
    return require('os').hostname() || 'Desktop';
  } catch {
    return 'Desktop';
  }
});

ipcMain.handle('get-temp-workspace', async () => {
  const fs = require('fs');
  const baseDir = path.join(app.getPath('temp'), 'dubify_workspaces');
  
  // 1. Run automatic cleanup of old project directories (older than 24 hours)
  try {
    if (fs.existsSync(baseDir)) {
      const folders = fs.readdirSync(baseDir);
      const now = Date.now();
      for (const folder of folders) {
        if (folder.startsWith('project_')) {
          const folderPath = path.join(baseDir, folder);
          const stat = fs.statSync(folderPath);
          // If folder is older than 24 hours, delete it recursively
          if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
            fs.rmSync(folderPath, { recursive: true, force: true });
          }
        }
      }
    }
  } catch (err) {
    logToFile('ERROR', `Failed to clean up old temp workspaces: ${err.message}`);
  }

  // 2. Return a single fixed draft directory for startup
  const draftPath = path.join(baseDir, 'default_draft');
  return draftPath;
});

app.whenReady().then(() => {
  startPythonBackend();
  checkBackendReady((ready) => {
    if (ready) {
      logToFile('INFO', 'Python backend is up and running. Launching Electron UI...');
      createWindow();
    } else {
      logToFile('ERROR', 'Failed to connect to Python backend. Launching UI anyway...');
      createWindow();
    }
  });

  // Check for updates on startup in production
  if (!isDev) {
    try {
      autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      logToFile('ERROR', `Auto-updater error on startup: ${err.message}`);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (pythonProcess) {
    logToFile('INFO', 'Terminating Python backend sidecar...');
    pythonProcess.kill();
  }
});
