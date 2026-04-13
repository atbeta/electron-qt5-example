const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qtSync', {
  syncHostRect: (rect) => ipcRenderer.send('host-rect', rect),
  show: () => ipcRenderer.invoke('qt-visibility', { action: 'show' }),
  hide: () => ipcRenderer.invoke('qt-visibility', { action: 'hide' }),
  toggle: () => ipcRenderer.invoke('qt-visibility', { action: 'toggle' }),
  auto: () => ipcRenderer.invoke('qt-visibility', { action: 'auto' }),
  getState: () => ipcRenderer.invoke('qt-visibility', { action: 'state' }),
});
