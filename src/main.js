'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { WINDOW_WIDTH, WINDOW_HEIGHT, ASSETS_DIR, WATCH_MODE, ANTIGRAVITY } = require('../config');
const { createStateMachine } = require('./stateMachine');
const { createAntigravityWatcher } = require('../watchers/antigravity');
const { createCliWatcher } = require('../watchers/cliWatcher');
const { createExtensionManager } = require('./extensionManager');

let petWindow = null;
let dashboardWindow = null;
let isPetRunning = false;
let isEngineRunning = false;
let isPetEnabled = true;
let tray = null;
let antigravityWatcher = null;
let cliWatcher = null;
let sm = null;
let extensionManager = null;

let currentWatchMode = WATCH_MODE;
let currentSettings = null;

// --- Paths -------------------------------------------------------------------
const userDataPath = path.join(app.getPath('userData'), 'zpet_data');
const enginePrefsPath = path.join(app.getPath('userData'), 'zpet_data', 'enginePrefs.json');
const libraryBasePath = path.join(userDataPath, 'library');
const libraryJsonPath = path.join(libraryBasePath, 'library.json');
const profilesJsonPath = path.join(userDataPath, 'profiles.json');
const settingsJsonPath = path.join(userDataPath, 'settings.json');
const oldGifsPath = path.join(userDataPath, 'gifs');

// --- Migration ---------------------------------------------------------------
function migrateToFolderLibrary() {
  if (fs.existsSync(libraryBasePath)) return;

  fs.mkdirSync(libraryBasePath, { recursive: true });

  const defaultFolderId = 'folder_default';
  const defaultFolderPath = path.join(libraryBasePath, defaultFolderId);
  fs.mkdirSync(defaultFolderPath, { recursive: true });

  if (fs.existsSync(oldGifsPath)) {
    const files = fs.readdirSync(oldGifsPath).filter(f => /\.(gif|png|webp)$/i.test(f));
    for (const file of files) {
      try {
        fs.copyFileSync(path.join(oldGifsPath, file), path.join(defaultFolderPath, file));
      } catch (_) {}
    }
  }

  const libraryData = {
    folders: [{
      id: defaultFolderId,
      name: 'Imported GIFs',
      cover: null,
      coverMode: 'cycle'
    }]
  };
  fs.writeFileSync(libraryJsonPath, JSON.stringify(libraryData, null, 2), 'utf-8');

  if (fs.existsSync(profilesJsonPath)) {
    try {
      const raw = fs.readFileSync(profilesJsonPath, 'utf-8');
      const profiles = JSON.parse(raw);
      const oldSegment = '/user_data/gifs/';
      const newSegment = `/user_data/library/${defaultFolderId}/`;

      for (const profile of profiles.profiles || []) {
        for (const state of Object.keys(profile.states || {})) {
          profile.states[state] = (profile.states[state] || []).map(url =>
            url.includes(oldSegment) ? url.replace(oldSegment, newSegment) : url
          );
        }
      }
      fs.writeFileSync(profilesJsonPath, JSON.stringify(profiles, null, 2), 'utf-8');
    } catch (_) {}
  }

  console.log('[migration] Library folder structure created.');
}

// --- Library helpers ---------------------------------------------------------
function readLibrary() {
  try {
    if (!fs.existsSync(libraryJsonPath)) {
      const data = { folders: [] };
      fs.writeFileSync(libraryJsonPath, JSON.stringify(data, null, 2), 'utf-8');
      return data;
    }
    return JSON.parse(fs.readFileSync(libraryJsonPath, 'utf-8'));
  } catch (_) {
    return { folders: [] };
  }
}

function writeLibrary(data) {
  fs.writeFileSync(libraryJsonPath, JSON.stringify(data, null, 2), 'utf-8');
}

function getFolderGifFiles(folderId) {
  const folderPath = path.join(libraryBasePath, folderId);
  if (!fs.existsSync(folderPath)) return [];
  return fs.readdirSync(folderPath).filter(f => /\.(gif|png|webp)$/i.test(f));
}

function gifFileToUrl(folderId, fileName) {
  const fullPath = path.join(libraryBasePath, folderId, fileName);
  return `file:///${fullPath.replace(/\\/g, '/')}`;
}

// --- Profiles helpers --------------------------------------------------------
const defaultProfiles = {
  activeProfile: 'profile_1',
  profiles: [{
    id: 'profile_1',
    name: 'Default Theme',
    states: { idle: [], working: [], waiting: [] }
  }]
};

function readProfiles() {
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  if (!fs.existsSync(profilesJsonPath)) {
    fs.writeFileSync(profilesJsonPath, JSON.stringify(defaultProfiles, null, 2), 'utf-8');
    return defaultProfiles;
  }
  try {
    return JSON.parse(fs.readFileSync(profilesJsonPath, 'utf-8'));
  } catch (_) {
    return defaultProfiles;
  }
}

function writeProfiles(data) {
  fs.writeFileSync(profilesJsonPath, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Settings helpers --------------------------------------------------------
function getDefaultSettings() {
  return {
    watchMode: WATCH_MODE,
    idePath: ANTIGRAVITY.convDir,
    cliPath: ANTIGRAVITY.cliBrainDir,
  };
}

function readSettings() {
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  if (!fs.existsSync(settingsJsonPath)) {
    // First launch — flag onboarding as incomplete
    const def = { ...getDefaultSettings(), onboardingCompleted: false };
    fs.writeFileSync(settingsJsonPath, JSON.stringify(def, null, 2), 'utf-8');
    return def;
  }
  try {
    const stored = JSON.parse(fs.readFileSync(settingsJsonPath, 'utf-8'));
    // Existing users who upgraded and don't have this field are already onboarded
    if (!('onboardingCompleted' in stored)) stored.onboardingCompleted = true;
    return { ...getDefaultSettings(), ...stored };
  } catch (_) {
    return { ...getDefaultSettings(), onboardingCompleted: true };
  }
}

function writeSettings(data) {
  fs.writeFileSync(settingsJsonPath, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Pet state ---------------------------------------------------------------
function getGifList(state) {
  const data = readProfiles();
  const activeProfile = data.profiles.find(p => p.id === data.activeProfile);
  if (!activeProfile || !activeProfile.states) return [];

  let gifs = activeProfile.states[state] || [];
  if (gifs.length === 0 && state !== 'idle') {
    gifs = activeProfile.states['idle'] || [];
  }
  return gifs;
}

let lastPushedState = null;

function pushStateToRenderer(state, prevState) {
  const st = typeof state === 'string' ? state : (state && state.current) || 'idle';
  if (st === lastPushedState) return;
  const prev = lastPushedState;
  lastPushedState = st;

  if (petWindow && !petWindow.isDestroyed()) {
    const gifs = getGifList(st);
    petWindow.webContents.send('pet:state', { state: st, gifs });
  }
  updateTrayTooltip(st);

  if (extensionManager) {
    extensionManager.notifyStateChange(st, prevState || prev || 'idle');
  }
}

let heartbeatTimer = null;

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (lastPushedState && petWindow && !petWindow.isDestroyed()) {
      const gifs = getGifList(lastPushedState);
      petWindow.webContents.send('pet:state', { state: lastPushedState, gifs });
    }
  }, 5000);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

sm = createStateMachine(pushStateToRenderer);
extensionManager = createExtensionManager(userDataPath);

function applyWatchMode(mode) {
  currentWatchMode = mode;

  if (!antigravityWatcher) antigravityWatcher = createAntigravityWatcher((evt) => sm.setState(evt), currentSettings && currentSettings.idePath);
  if (!cliWatcher) cliWatcher = createCliWatcher((evt) => sm.setState(evt), currentSettings && currentSettings.cliPath);

  if (isPetRunning && (mode === 'BOTH' || mode === 'IDE')) {
    antigravityWatcher.start();
  } else {
    antigravityWatcher.stop();
  }

  if (isPetRunning && (mode === 'BOTH' || mode === 'CLI')) {
    cliWatcher.start();
  } else {
    cliWatcher.stop();
  }

  if (typeof rebuildTrayMenu === 'function') {
    rebuildTrayMenu(lastStateForTray || 'idle');
  }
}

// --- Tray --------------------------------------------------------------------
let lastStateForTray = 'idle';

function createTray() {
  const icoPath = path.join(ASSETS_DIR, 'tray.ico');
  let icon;
  try {
    if (fs.existsSync(icoPath)) icon = nativeImage.createFromPath(icoPath);
  } catch (_) {}
  if (!icon || icon.isEmpty()) icon = nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('Desktop Pet');
  rebuildTrayMenu('idle');
  tray.on('double-click', () => {
    if (!dashboardWindow) {
      createDashboardWindow();
    } else {
      if (dashboardWindow.isVisible()) dashboardWindow.hide(); else dashboardWindow.show();
    }
  });
}

function rebuildTrayMenu(state) {
  if (!tray) return;

  let modeLabel = 'IDE & CLI';
  if (currentWatchMode === 'IDE') modeLabel = 'IDE Only';
  if (currentWatchMode === 'CLI') modeLabel = 'CLI Only';

  const menu = Menu.buildFromTemplate([
    { label: 'Status: ' + state, enabled: false },
    { label: 'Mode: ' + modeLabel, enabled: false },
    { type: 'separator' },
    {
      label: 'Watch Platform',
      submenu: [
        { label: 'IDE Only', type: 'radio', checked: currentWatchMode === 'IDE', click: () => applyWatchMode('IDE') },
        { label: 'CLI Only', type: 'radio', checked: currentWatchMode === 'CLI', click: () => applyWatchMode('CLI') },
        { label: 'Both', type: 'radio', checked: currentWatchMode === 'BOTH', click: () => applyWatchMode('BOTH') }
      ]
    },
    { type: 'separator' },
    { label: 'Show / Hide Dashboard', click: () => {
        if (!dashboardWindow) createDashboardWindow();
        else dashboardWindow.isVisible() ? dashboardWindow.hide() : dashboardWindow.show();
      }
    },
    { label: 'Reset to Idle', click: () => sm.setState({ source: 'manual', state: 'idle' }) },
    { type: 'separator' },
    { label: 'Exit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function updateTrayTooltip(state) {
  lastStateForTray = state;
  if (tray) {
    tray.setToolTip('Pet - ' + state);
    rebuildTrayMenu(state);
  }
}

// --- Windows -----------------------------------------------------------------
function createDashboardWindow() {
  if (dashboardWindow) return;
  dashboardWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    title: 'Zpet',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#111111',
      symbolColor: '#A3A3A3',
      height: 32
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    }
  });
  dashboardWindow.loadFile(path.join(__dirname, 'renderer', 'dashboard', 'index.html'));
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
    app.isQuitting = true;
    app.quit();
  });
}

function createPetWindow() {
  if (petWindow) return;
  petWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    backgroundThrottling: false,
    paintWhenInitiallyHidden: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet', 'index.html'));
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.on('closed', () => { petWindow = null; });
  petWindow.webContents.on('did-finish-load', () => {
    lastPushedState = null;
    pushStateToRenderer(sm.getEffectiveState());
  });
}

// --- IPC: Pet ----------------------------------------------------------------
ipcMain.on('pet:interactive', (_e, interactive) => {
  if (!petWindow) return;
  if (interactive) petWindow.setIgnoreMouseEvents(false);
  else petWindow.setIgnoreMouseEvents(true, { forward: true });
});
ipcMain.on('pet:drag', (_e, { dx, dy }) => {
  if (!petWindow) return;
  const [x, y] = petWindow.getPosition();
  petWindow.setPosition(x + dx, y + dy);
});
ipcMain.on('pet:quit', () => { app.isQuitting = true; app.quit(); });

// --- Engine Prefs ------------------------------------------------------------
function readEnginePrefs() {
  try {
    if (fs.existsSync(enginePrefsPath)) return JSON.parse(fs.readFileSync(enginePrefsPath, 'utf8'));
  } catch (_) {}
  return { petEnabled: true };
}
function writeEnginePrefs(data) {
  try { fs.writeFileSync(enginePrefsPath, JSON.stringify(data, null, 2)); } catch (_) {}
}

// --- IPC: Dashboard controls -------------------------------------------------
ipcMain.on('dashboard:start-pet', () => {
  isEngineRunning = true;
  isPetRunning = true;
  const prefs = readEnginePrefs();
  isPetEnabled = prefs.petEnabled !== false;
  if (isPetEnabled) createPetWindow();
  startHeartbeat();
  applyWatchMode(currentWatchMode);
  if (extensionManager) extensionManager.startAll();
});
ipcMain.on('dashboard:stop-pet', () => {
  isEngineRunning = false;
  isPetRunning = false;
  stopHeartbeat();
  if (extensionManager) extensionManager.stopAll();
  if (antigravityWatcher) antigravityWatcher.stop();
  if (cliWatcher) cliWatcher.stop();
  if (petWindow) {
    petWindow.close();
    petWindow = null;
  }
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('pet:stopped');
  }
});

ipcMain.handle('dashboard:set-pet-enabled', (_e, enabled) => {
  isPetEnabled = enabled;
  const prefs = readEnginePrefs();
  prefs.petEnabled = enabled;
  writeEnginePrefs(prefs);
  if (!isEngineRunning) return;
  if (enabled && !petWindow) {
    createPetWindow();
  } else if (!enabled && petWindow) {
    petWindow.close();
    petWindow = null;
    isPetRunning = false;
  }
});

ipcMain.handle('dashboard:get-engine-prefs', () => readEnginePrefs());

ipcMain.handle('extensions:get-all', () => {
  if (!extensionManager) return [];
  return extensionManager.getAll();
});

ipcMain.handle('extensions:set-enabled', (_e, id, enabled) => {
  if (!extensionManager) return;
  extensionManager.setEnabled(id, enabled);
});

ipcMain.handle('extensions:get-running-count', () => {
  if (!extensionManager) return 0;
  return extensionManager.getRunningCount();
});

ipcMain.handle('extensions:get-settings', (_e, id) => {
  if (!extensionManager) return {};
  return extensionManager.getSettings(id);
});

ipcMain.handle('extensions:save-settings', (_e, id, data) => {
  if (!extensionManager) return;
  extensionManager.saveSettings(id, data);
});

ipcMain.handle('extensions:get-schema', (_e, id) => {
  if (!extensionManager) return [];
  return extensionManager.getSchema(id);
});

ipcMain.handle('extensions:install-from-folder', async (_e, sourcePath) => {
  if (!extensionManager) return { success: false, error: 'Extension manager not ready' };
  const manifestPath = path.join(sourcePath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { success: false, error: 'No manifest.json found' };
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const id = manifest.id || path.basename(sourcePath);
    const destDir = path.join(userDataPath, 'extensions', id);
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
    fs.cpSync(sourcePath, destDir, { recursive: true });
    extensionManager.scan && extensionManager.scan();
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('extensions:open-folder', () => {
  const extDir = path.join(userDataPath, 'extensions');
  if (!fs.existsSync(extDir)) fs.mkdirSync(extDir, { recursive: true });
  shell.openPath(extDir);
});

// --- IPC: Extension Marketplace (GitHub) -------------------------------------
const REPO_API_BASE = 'https://api.github.com/repos/carus10/Zpet/contents/extensions';
const REPO_RAW_BASE = 'https://raw.githubusercontent.com/carus10/Zpet/main/extensions';

ipcMain.handle('marketplace:fetch-list', async () => {
  const { net } = require('electron');
  try {
    const dirData = await netFetch(REPO_API_BASE);
    const folders = dirData.filter(item => item.type === 'dir' && item.name !== 'DEVELOPMENT.md');
    const results = [];
    for (const folder of folders) {
      try {
        const manifestUrl = `${REPO_RAW_BASE}/${folder.name}/manifest.json`;
        const manifest = await netFetch(manifestUrl);
        const installed = fs.existsSync(path.join(userDataPath, 'extensions', manifest.id || folder.name, 'manifest.json'));
        results.push({ ...manifest, _folderName: folder.name, _installed: installed });
      } catch (_) {}
    }
    return { success: true, extensions: results };
  } catch (e) {
    return { success: false, error: e.message, extensions: [] };
  }
});

ipcMain.handle('marketplace:install', async (_e, folderName) => {
  try {
    const filesData = await netFetch(`${REPO_API_BASE}/${folderName}`);
    const files = filesData.filter(f => f.type === 'file');

    let manifest = null;
    for (const f of files) {
      if (f.name === 'manifest.json') {
        manifest = await netFetch(f.download_url);
        break;
      }
    }
    if (!manifest) return { success: false, error: 'No manifest.json in extension' };

    const id = manifest.id || folderName;
    const destDir = path.join(userDataPath, 'extensions', id);
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });

    for (const file of files) {
      const content = await netFetchRaw(file.download_url);
      fs.writeFileSync(path.join(destDir, file.name), content);
    }

    if (extensionManager && extensionManager.scan) extensionManager.scan();
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('marketplace:uninstall', (_e, extId) => {
  try {
    const extDir = path.join(userDataPath, 'extensions', extId);
    if (extensionManager) {
      extensionManager.setEnabled(extId, false);
    }
    if (fs.existsSync(extDir)) {
      fs.rmSync(extDir, { recursive: true, force: true });
    }
    if (extensionManager && extensionManager.scan) extensionManager.scan();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function netFetch(url) {
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    request.setHeader('User-Agent', 'Zpet-App');
    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (_) { reject(new Error('Failed to parse response')); }
      });
    });
    request.on('error', (err) => reject(err));
    request.end();
  });
}

function netFetchRaw(url) {
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    request.setHeader('User-Agent', 'Zpet-App');
    const chunks = [];
    request.on('response', (response) => {
      response.on('data', (chunk) => { chunks.push(chunk); });
      response.on('end', () => { resolve(Buffer.concat(chunks)); });
    });
    request.on('error', (err) => reject(err));
    request.end();
  });
}

// --- IPC: Library (folders) --------------------------------------------------
ipcMain.handle('library:get-folders', () => {
  const data = readLibrary();
  return data.folders.map(f => ({
    ...f,
    gifCount: getFolderGifFiles(f.id).length
  }));
});

ipcMain.handle('library:create-folder', (_e, name) => {
  const data = readLibrary();
  const folder = {
    id: 'folder_' + Date.now(),
    name: name || 'New Folder',
    cover: null,
    coverMode: 'cycle'
  };
  const folderPath = path.join(libraryBasePath, folder.id);
  fs.mkdirSync(folderPath, { recursive: true });
  data.folders.push(folder);
  writeLibrary(data);
  return { ...folder, gifCount: 0 };
});

ipcMain.handle('library:rename-folder', (_e, id, newName) => {
  const data = readLibrary();
  const folder = data.folders.find(f => f.id === id);
  if (folder) {
    folder.name = newName;
    writeLibrary(data);
  }
  return true;
});

ipcMain.handle('library:delete-folder', (_e, id) => {
  const data = readLibrary();
  data.folders = data.folders.filter(f => f.id !== id);
  writeLibrary(data);
  const folderPath = path.join(libraryBasePath, id);
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
  return true;
});

ipcMain.handle('library:import-folder', async () => {
  if (!dashboardWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(dashboardWindow, {
    title: 'Select Folder to Import',
    properties: ['openDirectory']
  });
  if (canceled || filePaths.length === 0) return null;

  const sourceDir = filePaths[0];
  const folderName = path.basename(sourceDir);
  const folderId = 'folder_' + Date.now();
  const destDir = path.join(libraryBasePath, folderId);
  fs.mkdirSync(destDir, { recursive: true });

  let count = 0;
  try {
    const files = fs.readdirSync(sourceDir).filter(f => /\.(gif|png|webp)$/i.test(f));
    for (const file of files) {
      fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, file));
      count++;
    }
  } catch (_) {}

  const folder = { id: folderId, name: folderName, cover: null, coverMode: 'cycle' };
  const data = readLibrary();
  data.folders.push(folder);
  writeLibrary(data);

  return { ...folder, gifCount: count };
});

ipcMain.handle('library:get-folder-gifs', (_e, folderId) => {
  const files = getFolderGifFiles(folderId);
  return files.map(f => gifFileToUrl(folderId, f));
});

ipcMain.handle('library:add-gifs-to-folder', async (_e, folderId) => {
  if (!dashboardWindow) return [];
  const { canceled, filePaths } = await dialog.showOpenDialog(dashboardWindow, {
    title: 'Select GIFs',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['gif', 'png', 'webp'] }]
  });
  if (canceled || filePaths.length === 0) return [];

  const destDir = path.join(libraryBasePath, folderId);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const added = [];
  for (const filePath of filePaths) {
    const fileName = path.basename(filePath);
    const destPath = path.join(destDir, fileName);
    try {
      fs.copyFileSync(filePath, destPath);
      added.push(gifFileToUrl(folderId, fileName));
    } catch (_) {}
  }
  return added;
});

ipcMain.handle('library:delete-gif', (_e, folderId, fileName) => {
  const filePath = path.join(libraryBasePath, folderId, fileName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return true;
});

ipcMain.handle('library:set-cover', (_e, folderId, fileName, mode) => {
  const data = readLibrary();
  const folder = data.folders.find(f => f.id === folderId);
  if (folder) {
    folder.cover = fileName;
    folder.coverMode = mode || 'fixed';
    writeLibrary(data);
  }
  return true;
});

// --- IPC: Profiles -----------------------------------------------------------
ipcMain.handle('profiles:get', () => readProfiles());

ipcMain.handle('profiles:save', (_e, data) => {
  writeProfiles(data);
  return true;
});

ipcMain.handle('profiles:set-active', (_e, profileId) => {
  const data = readProfiles();
  data.activeProfile = profileId;
  writeProfiles(data);
  return true;
});

// --- IPC: Settings -----------------------------------------------------------
ipcMain.handle('settings:get', () => readSettings());

ipcMain.handle('settings:save', (_e, newSettings) => {
  const result = {
    saved: true,
    idePathValid: fs.existsSync(newSettings.idePath),
    cliPathValid: fs.existsSync(newSettings.cliPath),
  };
  writeSettings(newSettings);
  currentSettings = newSettings;
  currentWatchMode = newSettings.watchMode;

  // Hot-reload watchers with new paths
  if (antigravityWatcher) antigravityWatcher.stop();
  if (cliWatcher) cliWatcher.stop();
  antigravityWatcher = createAntigravityWatcher((evt) => sm.setState(evt), newSettings.idePath);
  cliWatcher = createCliWatcher((evt) => sm.setState(evt), newSettings.cliPath);
  applyWatchMode(currentWatchMode);

  rebuildTrayMenu(lastStateForTray || 'idle');
  return result;
});

ipcMain.handle('settings:browse-folder', async () => {
  if (!dashboardWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(dashboardWindow, {
    title: 'Select Folder',
    properties: ['openDirectory'],
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('settings:validate-path', (_e, dirPath) => fs.existsSync(dirPath));

ipcMain.handle('settings:is-first-launch', () => {
  const s = readSettings();
  return !s.onboardingCompleted;
});

ipcMain.handle('settings:complete-onboarding', () => {
  const s = readSettings();
  s.onboardingCompleted = true;
  writeSettings(s);
  return true;
});

// --- IPC: Data Export/Import -------------------------------------------------
ipcMain.handle('data:export', async () => {
  if (!dashboardWindow) return { success: false, error: 'No window' };
  const { canceled, filePaths } = await dialog.showOpenDialog(dashboardWindow, {
    title: 'Select Export Destination',
    properties: ['openDirectory'],
  });
  if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };

  const archiver = require('archiver');
  const destDir = filePaths[0];
  const dateStr = new Date().toISOString().slice(0, 10);
  const zipPath = path.join(destDir, `zpet-backup-${dateStr}.zip`);

  return new Promise((resolve) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve({ success: true, path: zipPath }));
    archive.on('error', (err) => resolve({ success: false, error: err.message }));

    archive.pipe(output);
    if (fs.existsSync(settingsJsonPath)) archive.file(settingsJsonPath, { name: 'settings.json' });
    if (fs.existsSync(profilesJsonPath)) archive.file(profilesJsonPath, { name: 'profiles.json' });
    if (fs.existsSync(libraryBasePath)) archive.directory(libraryBasePath, 'library');
    archive.finalize();
  });
});

ipcMain.handle('data:import', async () => {
  if (!dashboardWindow) return { success: false, error: 'No window' };
  const { canceled, filePaths } = await dialog.showOpenDialog(dashboardWindow, {
    title: 'Select Backup File',
    properties: ['openFile'],
    filters: [{ name: 'Zpet Backup', extensions: ['zip'] }],
  });
  if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };

  const extractZip = require('extract-zip');
  const zipPath = filePaths[0];
  const tempDir = path.join(app.getPath('temp'), `zpet_import_${Date.now()}`);

  try {
    await extractZip(zipPath, { dir: tempDir });

    const hasSettings = fs.existsSync(path.join(tempDir, 'settings.json'));
    const hasProfiles = fs.existsSync(path.join(tempDir, 'profiles.json'));
    const hasLibrary = fs.existsSync(path.join(tempDir, 'library'));

    if (!hasSettings && !hasProfiles && !hasLibrary) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { success: false, error: 'Invalid backup: no recognized data found.' };
    }

    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
    if (hasSettings) fs.copyFileSync(path.join(tempDir, 'settings.json'), settingsJsonPath);
    if (hasProfiles) fs.copyFileSync(path.join(tempDir, 'profiles.json'), profilesJsonPath);
    if (hasLibrary) {
      if (fs.existsSync(libraryBasePath)) fs.rmSync(libraryBasePath, { recursive: true, force: true });
      fs.cpSync(path.join(tempDir, 'library'), libraryBasePath, { recursive: true });
    }

    fs.rmSync(tempDir, { recursive: true, force: true });

    // Reload settings and watchers
    currentSettings = readSettings();
    currentWatchMode = currentSettings.watchMode;
    if (antigravityWatcher) antigravityWatcher.stop();
    if (cliWatcher) cliWatcher.stop();
    antigravityWatcher = createAntigravityWatcher((evt) => sm.setState(evt), currentSettings.idePath);
    cliWatcher = createCliWatcher((evt) => sm.setState(evt), currentSettings.cliPath);
    applyWatchMode(currentWatchMode);

    return { success: true };
  } catch (err) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    return { success: false, error: err.message };
  }
});

// --- App lifecycle -----------------------------------------------------------
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-frame-rate-limit');

app.whenReady().then(() => {
  currentSettings = readSettings();
  currentWatchMode = currentSettings.watchMode;
  migrateToFolderLibrary();
  createDashboardWindow();
  createTray();
  console.log('[pet] App started. Dashboard opened.');
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => {
  stopHeartbeat();
  if (antigravityWatcher) antigravityWatcher.stop();
  if (cliWatcher) cliWatcher.stop();
  if (tray) { tray.destroy(); tray = null; }
});
