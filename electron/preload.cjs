const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  selectVideo: () => ipcRenderer.invoke('select-video'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectSaveProject: () => ipcRenderer.invoke('select-save-project'),
  selectOpenProject: () => ipcRenderer.invoke('select-open-project'),
  selectExportVideo: () => ipcRenderer.invoke('select-export-video'),
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  encryptString: (str) => ipcRenderer.invoke('encrypt-string', str),
  decryptString: (str) => ipcRenderer.invoke('decrypt-string', str),
  getTempWorkspace: () => ipcRenderer.invoke('get-temp-workspace'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getHostname: () => ipcRenderer.invoke('get-hostname'),
  exportLogs: () => ipcRenderer.invoke('export-logs')
});
