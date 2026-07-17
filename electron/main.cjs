const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
app.commandLine.appendSwitch('ignore-certificate-errors');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

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

  console.log(`Starting Python backend: ${execPath} ${args.join(' ')}`);

  pythonProcess = spawn(execPath, args, {
    cwd: path.dirname(execPath),
    stdio: 'pipe',
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python Stdout]: ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Stderr]: ${data.toString().trim()}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python backend exited with code ${code}`);
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

ipcMain.handle('encrypt-string', async (event, plainText) => {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(plainText).toString('base64');
    }
  } catch (err) {
    console.error('safeStorage encryption failed, falling back to plaintext:', err);
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
    console.error('safeStorage decryption failed, returning encrypted data:', err);
  }
  return encryptedBase64;
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
  } catch (err) {
    console.error('Failed to open external link:', err);
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
    console.error('Failed to clean up old temp workspaces:', err);
  }

  // 2. Return a single fixed draft directory for startup
  const draftPath = path.join(baseDir, 'default_draft');
  return draftPath;
});

app.whenReady().then(() => {
  startPythonBackend();
  checkBackendReady((ready) => {
    if (ready) {
      console.log('Python backend is up and running. Launching Electron UI...');
      createWindow();
    } else {
      console.error('Failed to connect to Python backend. Launching UI anyway...');
      createWindow();
    }
  });

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
    console.log('Terminating Python backend sidecar...');
    pythonProcess.kill();
  }
});
