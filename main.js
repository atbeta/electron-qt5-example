const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let pythonProcess = null;
let latestHostRect = null;
let restoreVisibleTimer = null;
let startupShown = false;
let keepAliveTimer = null;
let manualVisibilityMode = 'auto';

function sendToPython(payload) {
  if (!pythonProcess || !pythonProcess.stdin || pythonProcess.stdin.destroyed) {
    return;
  }
  pythonProcess.stdin.write(`${JSON.stringify(payload)}\n`);
}

function clearRestoreVisibleTimer() {
  if (restoreVisibleTimer) {
    clearTimeout(restoreVisibleTimer);
    restoreVisibleTimer = null;
  }
}

function clearKeepAliveTimer() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function getAutoVisible() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  return mainWindow.isVisible() && !mainWindow.isMinimized();
}

function getCurrentVisiblePreference() {
  if (manualVisibilityMode === 'show') return true;
  if (manualVisibilityMode === 'hide') return false;
  return getAutoVisible();
}

function applyQtWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const visible = getCurrentVisiblePreference();
  const topmost = visible && mainWindow.isFocused();
  sendToPython({ type: 'set_topmost', topmost });
  sendToPython({ type: 'set_visible', visible });
}

function syncQtBoundsToScreen() {
  if (!mainWindow || !latestHostRect) {
    return;
  }

  const contentBounds = mainWindow.getContentBounds();
  const scaleFactor = screen.getDisplayMatching(contentBounds).scaleFactor || 1;
  const x = (contentBounds.x + latestHostRect.x) * scaleFactor;
  const y = (contentBounds.y + latestHostRect.y) * scaleFactor;
  const width = latestHostRect.width * scaleFactor;
  const height = latestHostRect.height * scaleFactor;

  sendToPython({
    type: 'set_bounds',
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  });
}

function hideQtImmediately() {
  clearRestoreVisibleTimer();
  sendToPython({ type: 'set_visible', visible: false });
}

function showQtAfterRestore(delayMs = 180) {
  clearRestoreVisibleTimer();
  syncQtBoundsToScreen();
  restoreVisibleTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) {
      return;
    }
    applyQtWindowState();
    syncQtBoundsToScreen();
  }, delayMs);
}

function startQtKeepAlive() {
  clearKeepAliveTimer();
  keepAliveTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      sendToPython({ type: 'set_topmost', topmost: false });
      sendToPython({ type: 'set_visible', visible: false });
      return;
    }

    syncQtBoundsToScreen();
    applyQtWindowState();
  }, 450);
}

function spawnQtProcess() {
  const scriptPath = path.join(__dirname, 'qt_embed.py');
  pythonProcess = spawn('python', [scriptPath], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  pythonProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[py] ${chunk.toString()}`);
  });

  pythonProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[py-err] ${chunk.toString()}`);
  });

  pythonProcess.on('exit', (code) => {
    console.log(`Python process exited: ${code}`);
    pythonProcess = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('move', () => {
    syncQtBoundsToScreen();
    applyQtWindowState();
  });

  mainWindow.on('resize', () => {
    syncQtBoundsToScreen();
    applyQtWindowState();
  });

  mainWindow.on('minimize', () => {
    hideQtImmediately();
  });

  mainWindow.on('restore', () => {
    showQtAfterRestore();
  });

  mainWindow.on('show', () => {
    showQtAfterRestore();
  });

  mainWindow.on('focus', () => {
    applyQtWindowState();
    syncQtBoundsToScreen();
  });

  mainWindow.on('blur', () => {
    applyQtWindowState();
  });

  mainWindow.on('closed', () => {
    clearRestoreVisibleTimer();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  spawnQtProcess();
  startQtKeepAlive();

  ipcMain.on('host-rect', (_event, payload) => {
    latestHostRect = {
      x: Math.round(payload.x),
      y: Math.round(payload.y),
      width: Math.max(1, Math.round(payload.width)),
      height: Math.max(1, Math.round(payload.height)),
    };
    syncQtBoundsToScreen();
    applyQtWindowState();
    if (!startupShown) {
      startupShown = true;
      sendToPython({ type: 'set_visible', visible: getCurrentVisiblePreference() });
    }
  });

  ipcMain.handle('qt-visibility', (_event, payload) => {
    const action = payload?.action;
    if (action === 'show') {
      manualVisibilityMode = 'show';
    } else if (action === 'hide') {
      manualVisibilityMode = 'hide';
    } else if (action === 'toggle') {
      const current = getCurrentVisiblePreference();
      manualVisibilityMode = current ? 'hide' : 'show';
    } else if (action === 'auto') {
      manualVisibilityMode = 'auto';
    } else if (action !== 'state') {
      return { ok: false, error: 'unknown_action' };
    }

    syncQtBoundsToScreen();
    applyQtWindowState();
    return {
      ok: true,
      mode: manualVisibilityMode,
      visible: getCurrentVisiblePreference(),
      autoVisible: getAutoVisible(),
    };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  clearRestoreVisibleTimer();
  clearKeepAliveTimer();
  startupShown = false;
  manualVisibilityMode = 'auto';
  sendToPython({ type: 'shutdown' });
  if (pythonProcess) {
    pythonProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
