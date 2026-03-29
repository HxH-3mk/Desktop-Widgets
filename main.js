const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'widgets.json');
const widgetsDir = path.join(userDataPath, 'widgets');
const settingsPath = path.join(userDataPath, 'settings.json');

if (!fs.existsSync(widgetsDir)) {
  const defaultWidgetsDir = path.join(__dirname, 'widgets');
  if (fs.existsSync(defaultWidgetsDir)) {
    try { fs.cpSync(defaultWidgetsDir, widgetsDir, { recursive: true }); } catch (e) { fs.mkdirSync(widgetsDir, { recursive: true }); }
  } else {
    fs.mkdirSync(widgetsDir, { recursive: true });
  }
}

if (!fs.existsSync(dbPath)) {
  const defaultDbPath = path.join(__dirname, 'widgets.json');
  if (fs.existsSync(defaultDbPath)) {
    try { fs.copyFileSync(defaultDbPath, dbPath); } catch (e) { fs.writeFileSync(dbPath, '[]'); }
  } else {
    fs.writeFileSync(dbPath, '[]');
  }
}

if (!fs.existsSync(settingsPath)) {
  const defaultSettings = path.join(__dirname, 'settings.json');
  if (fs.existsSync(defaultSettings)) {
    try { fs.copyFileSync(defaultSettings, settingsPath); } catch (e) { fs.writeFileSync(settingsPath, JSON.stringify({ startWithWindows: false, startMinimized: false }, null, 2)); }
  } else {
    fs.writeFileSync(settingsPath, JSON.stringify({ startWithWindows: false, startMinimized: false }, null, 2));
  }
}

let controlPanelWindow;
let activeWindows = {};
let tray = null;
let isQuitting = false;

function getSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    return { startWithWindows: false, startMinimized: false };
  }
}

function saveSettings(updates) {
  try {
    const current = getSettings();
    const merged = { ...current, ...updates };
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
    return merged;
  } catch (e) {
    return getSettings();
  }
}

function applyStartupSetting(enable) {
  app.setLoginItemSettings({
    openAtLogin: enable,
    openAsHidden: true,
    name: 'Desktop Widgets',
    path: process.execPath,
    args: ['--hidden']
  });
}

function saveWidgetState(widgetId, updates) {
  try {
    let widgets = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const index = widgets.findIndex(w => w.id === widgetId);
    if (index !== -1) {
      widgets[index] = { ...widgets[index], ...updates };
      fs.writeFileSync(dbPath, JSON.stringify(widgets, null, 2));
    }
  } catch (e) { }
}

function createTrayIcon() {
  const { nativeImage } = require('electron');

  const iconPath = path.join(__dirname, 'color-widgets.ico');

  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    const pngPath = path.join(__dirname, 'color-widgets.png');
    if (fs.existsSync(pngPath)) {
      trayIcon = nativeImage.createFromPath(pngPath);
    } else {
      trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAhklEQVQ4jc2TMQqAMAxFX8UDuOnJvIuDiODgLXTxBO7iQUQ8gWfRpbQWrFjoQiDk8/NJSIA3SKkDUlU9TiJypq8BmFlV7yJSVHVz9wBgZkFEbmbWzIzMrJkZ7oxdVQEAEUFVQURARMDMQERwZiAi6FMDERERERFCKUkJgoiIiIj/AHAHlSwmfwAAAABJRU5ErkJggg==');
    }
  }

  tray = new Tray(trayIcon);

  const updateTrayMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '⚙️ Open Control Panel',
        click: () => {
          showControlPanel();
        }
      },
      { type: 'separator' },
      {
        label: '❌ Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  };

  tray.setToolTip('Desktop Widgets');
  updateTrayMenu();

  tray.on('double-click', () => {
    showControlPanel();
  });

  tray.on('click', () => {
    showControlPanel();
  });
}

function showControlPanel() {
  if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
    controlPanelWindow.show();
    controlPanelWindow.focus();
    controlPanelWindow.restore();
  } else {
    createControlPanel();
  }
}

function createControlPanel() {
  let windowIcon = path.join(__dirname, 'color-widgets.ico');
  if (!fs.existsSync(windowIcon)) {
    windowIcon = path.join(__dirname, 'color-widgets.png');
  }

  controlPanelWindow = new BrowserWindow({
    width: 950,
    height: 750,
    title: "Widgets Control Panel",
    icon: windowIcon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    show: false
  });

  controlPanelWindow.setMenu(null);
  controlPanelWindow.loadFile('control-panel.html');

  controlPanelWindow.once('ready-to-show', () => {
    const settings = getSettings();
    const startHidden = process.argv.includes('--hidden') && settings.startMinimized;
    if (!startHidden) {
      controlPanelWindow.show();
    }
  });

  controlPanelWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      controlPanelWindow.hide();
    }
  });
}

app.whenReady().then(() => {
  const settings = getSettings();
  applyStartupSetting(settings.startWithWindows || false);

  createControlPanel();
  createTrayIcon();

  ipcMain.handle('toggle-widget', (event, widgetConfig, isFixed) => {
    const widgetId = widgetConfig.id;

    if (activeWindows[widgetId]) {
      const [x, y] = activeWindows[widgetId].getPosition();
      saveWidgetState(widgetId, { wasRunning: false, lastX: x, lastY: y });
      activeWindows[widgetId].close();
      delete activeWindows[widgetId];
      return false;
    }

    const widgetPath = path.join(widgetsDir, widgetConfig.folder, 'index.html');
    if (!fs.existsSync(widgetPath)) return false;

    const windowOptions = {
      width: parseInt(widgetConfig.width),
      height: parseInt(widgetConfig.height),
      frame: false,
      transparent: true,
      skipTaskbar: true,
      resizable: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    };

    if (isFixed) {
      windowOptions.type = 'desktop';
      windowOptions.focusable = false;
      windowOptions.hasShadow = false;
    }

    const widgetWindow = new BrowserWindow(windowOptions);
    widgetWindow.loadFile(widgetPath);

    if (widgetConfig.lastX !== undefined && widgetConfig.lastY !== undefined) {
      widgetWindow.setPosition(widgetConfig.lastX, widgetConfig.lastY);
    }

    let freshWidget = widgetConfig;
    try {
      const allWidgets = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      freshWidget = allWidgets.find(w => w.id === widgetId) || widgetConfig;
    } catch (e) { }

    widgetWindow.webContents.on('did-finish-load', () => {
      if (isFixed) {
        widgetWindow.webContents.insertCSS('body { -webkit-app-region: no-drag !important; overflow: hidden; }');
      } else {
        widgetWindow.webContents.insertCSS(`
          body { -webkit-app-region: drag !important; overflow: hidden; }
          input, button, textarea, select { -webkit-app-region: no-drag !important; }
        `);
      }
      if (freshWidget.isMuted) {
        widgetWindow.webContents.setAudioMuted(true);
      }
      if (freshWidget.noClicks) {
        widgetWindow.setIgnoreMouseEvents(true, { forward: true });
      }
    });

    if (isFixed) {
      widgetWindow.on('minimize', (e) => { e.preventDefault(); widgetWindow.restore(); });
      widgetWindow.on('hide', (e) => { e.preventDefault(); widgetWindow.show(); });
    }

    widgetWindow.on('close', () => {
      if (!widgetWindow.isDestroyed()) {
        const [x, y] = widgetWindow.getPosition();
        saveWidgetState(widgetId, { wasRunning: false, lastX: x, lastY: y });
      }
    });

    widgetWindow.on('closed', () => {
      delete activeWindows[widgetId];
      if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
        controlPanelWindow.webContents.send('widget-closed', widgetId);
      }
    });

    saveWidgetState(widgetId, { wasRunning: true, wasFixed: isFixed });

    activeWindows[widgetId] = widgetWindow;

    setTimeout(() => {
      if (controlPanelWindow && !controlPanelWindow.isDestroyed()) controlPanelWindow.focus();
    }, 100);

    return true;
  });

  ipcMain.handle('get-widgets', () => JSON.parse(fs.readFileSync(dbPath, 'utf8')));

  ipcMain.handle('set-fixed-mode', (event, widgetId, isFixed) => {
    const win = activeWindows[widgetId];
    if (!win || win.isDestroyed()) return false;

    const [x, y] = win.getPosition();

    if (isFixed) {
      win.setIgnoreMouseEvents(false);
      win.setFocusable(false);
      win.setAlwaysOnTop(false);
      try { win.setType('desktop'); } catch (e) { }
      win.webContents.insertCSS('body { -webkit-app-region: no-drag !important; }');
    } else {
      try { win.setType('normal'); } catch (e) { }
      win.setFocusable(true);
      win.webContents.insertCSS('body { -webkit-app-region: drag !important; } input, button, textarea, select { -webkit-app-region: no-drag !important; }');
    }

    win.setPosition(x, y);
    saveWidgetState(widgetId, { wasFixed: isFixed });

    setTimeout(() => {
      if (controlPanelWindow && !controlPanelWindow.isDestroyed()) controlPanelWindow.focus();
    }, 100);

    return true;
  });

  ipcMain.handle('select-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select HTML File',
      properties: ['openFile'],
      filters: [{ name: 'HTML Files', extensions: ['html', 'htm'] }]
    });
    return canceled ? null : filePaths[0];
  });

  ipcMain.handle('add-widget', (event, newWidget, sourceFile) => {
    let widgets = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    newWidget.id = Date.now().toString();
    newWidget.folder = `widget_${newWidget.id}`;

    const newDirPath = path.join(widgetsDir, newWidget.folder);
    fs.mkdirSync(newDirPath);

    if (sourceFile && fs.existsSync(sourceFile)) {
      fs.copyFileSync(sourceFile, path.join(newDirPath, 'index.html'));
    } else {
      fs.writeFileSync(path.join(newDirPath, 'index.html'), `<!DOCTYPE html><html><head><style>body { margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background: rgba(20, 20, 20, 0.6); border-radius: 15px; color: white; font-family: sans-serif; user-select: none; overflow: hidden; }</style></head><body><h2>${newWidget.name}</h2></body></html>`);
    }

    widgets.push(newWidget);
    fs.writeFileSync(dbPath, JSON.stringify(widgets, null, 2));
    return true;
  });

  ipcMain.handle('update-widget', (event, updatedWidget) => {
    let widgets = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const index = widgets.findIndex(w => w.id === updatedWidget.id);
    if (index !== -1) {
      widgets[index] = updatedWidget;
      fs.writeFileSync(dbPath, JSON.stringify(widgets, null, 2));

      if (activeWindows[updatedWidget.id]) {
        activeWindows[updatedWidget.id].setSize(parseInt(updatedWidget.width), parseInt(updatedWidget.height));
      }
      return true;
    }
    return false;
  });

  ipcMain.handle('delete-widget', (event, widgetId) => {
    if (activeWindows[widgetId]) activeWindows[widgetId].close();
    let widgets = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const widgetToDelete = widgets.find(w => w.id === widgetId);

    if (widgetToDelete) {
      const dirPath = path.join(widgetsDir, widgetToDelete.folder);
      if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true, force: true });
      widgets = widgets.filter(w => w.id !== widgetId);
      fs.writeFileSync(dbPath, JSON.stringify(widgets, null, 2));
    }
    return true;
  });

  ipcMain.handle('export-widget', async (event, widgetId) => {
    let widgets = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) return false;

    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select Destination Folder',
      properties: ['openDirectory']
    });

    if (!canceled && filePaths.length > 0) {
      const sourcePath = path.join(widgetsDir, widget.folder);
      const destPath = path.join(filePaths[0], `${widget.name}_Exported`);
      fs.cpSync(sourcePath, destPath, { recursive: true });
      fs.writeFileSync(path.join(destPath, 'config.json'), JSON.stringify(widget));
      return true;
    }
    return false;
  });

  ipcMain.handle('import-widget', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select Widget Folder',
      properties: ['openDirectory']
    });

    if (!canceled && filePaths.length > 0) {
      const sourcePath = filePaths[0];
      const configPath = path.join(sourcePath, 'config.json');

      if (fs.existsSync(configPath)) {
        let importedWidget = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        importedWidget.id = Date.now().toString();
        importedWidget.folder = `widget_${importedWidget.id}`;

        const destPath = path.join(widgetsDir, importedWidget.folder);
        fs.cpSync(sourcePath, destPath, { recursive: true });

        let widgets = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        widgets.push(importedWidget);
        fs.writeFileSync(dbPath, JSON.stringify(widgets, null, 2));
        return true;
      }
    }
    return false;
  });

  ipcMain.handle('get-settings', () => {
    return getSettings();
  });

  ipcMain.handle('set-startup', (event, enable) => {
    applyStartupSetting(enable);
    saveSettings({ startWithWindows: enable });
    return { startWithWindows: enable };
  });

  ipcMain.handle('set-start-minimized', (event, enable) => {
    saveSettings({ startMinimized: enable });
    return { startMinimized: enable };
  });

  ipcMain.handle('set-mute', (event, widgetId, isMuted) => {
    saveWidgetState(widgetId, { isMuted });
    const win = activeWindows[widgetId];
    if (win && !win.isDestroyed()) {
      win.webContents.setAudioMuted(isMuted);
    }
    return true;
  });

  ipcMain.handle('set-no-clicks', (event, widgetId, noClicks) => {
    saveWidgetState(widgetId, { noClicks });
    const win = activeWindows[widgetId];
    if (win && !win.isDestroyed()) {
      if (noClicks) {
        win.setIgnoreMouseEvents(true, { forward: true });
      } else {
        win.setIgnoreMouseEvents(false);
      }
    }
    return true;
  });

  app.on('activate', () => {
    if (!controlPanelWindow || controlPanelWindow.isDestroyed()) {
      createControlPanel();
    }
  });
});

app.on('window-all-closed', () => { });

app.on('before-quit', () => {
  isQuitting = true;
});