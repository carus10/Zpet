'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onStateChange: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('pet:state', listener);
    return () => ipcRenderer.removeListener('pet:state', listener);
  },
  setInteractive: (interactive) => ipcRenderer.send('pet:interactive', interactive),
  dragBy: (dx, dy) => ipcRenderer.send('pet:drag', { dx, dy }),
  quit: () => ipcRenderer.send('pet:quit'),
  stopPet: () => ipcRenderer.send('dashboard:stop-pet'),
});

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (data) => ipcRenderer.invoke('settings:save', data),
  browseFolder: () => ipcRenderer.invoke('settings:browse-folder'),
  validatePath: (dirPath) => ipcRenderer.invoke('settings:validate-path', dirPath),
  isFirstLaunch: () => ipcRenderer.invoke('settings:is-first-launch'),
  completeOnboarding: () => ipcRenderer.invoke('settings:complete-onboarding'),
});

contextBridge.exposeInMainWorld('dataManager', {
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
});

contextBridge.exposeInMainWorld('extensions', {
  getAll: () => ipcRenderer.invoke('extensions:get-all'),
  setEnabled: (id, enabled) => ipcRenderer.invoke('extensions:set-enabled', id, enabled),
  getRunningCount: () => ipcRenderer.invoke('extensions:get-running-count'),
  getSettings: (id) => ipcRenderer.invoke('extensions:get-settings', id),
  saveSettings: (id, data) => ipcRenderer.invoke('extensions:save-settings', id, data),
  getSchema: (id) => ipcRenderer.invoke('extensions:get-schema', id),
  installFromFolder: (sourcePath) => ipcRenderer.invoke('extensions:install-from-folder', sourcePath),
  openFolder: () => ipcRenderer.invoke('extensions:open-folder'),
});

contextBridge.exposeInMainWorld('marketplace', {
  fetchList: () => ipcRenderer.invoke('marketplace:fetch-list'),
  install: (folderName) => ipcRenderer.invoke('marketplace:install', folderName),
  uninstall: (extId) => ipcRenderer.invoke('marketplace:uninstall', extId),
});

contextBridge.exposeInMainWorld('dashboard', {
  startPet: () => ipcRenderer.send('dashboard:start-pet'),
  stopPet: () => ipcRenderer.send('dashboard:stop-pet'),
  setPetEnabled: (enabled) => ipcRenderer.invoke('dashboard:set-pet-enabled', enabled),
  getEnginePrefs: () => ipcRenderer.invoke('dashboard:get-engine-prefs'),
  onPetStopped: (cb) => ipcRenderer.on('pet:stopped', cb),
  // Library - folders
  getFolders: () => ipcRenderer.invoke('library:get-folders'),
  createFolder: (name) => ipcRenderer.invoke('library:create-folder', name),
  renameFolder: (id, name) => ipcRenderer.invoke('library:rename-folder', id, name),
  deleteFolder: (id) => ipcRenderer.invoke('library:delete-folder', id),
  importFolder: () => ipcRenderer.invoke('library:import-folder'),
  // Library - GIFs in folder
  getFolderGifs: (folderId) => ipcRenderer.invoke('library:get-folder-gifs', folderId),
  addGifsToFolder: (folderId) => ipcRenderer.invoke('library:add-gifs-to-folder', folderId),
  deleteGif: (folderId, fileName) => ipcRenderer.invoke('library:delete-gif', folderId, fileName),
  setCover: (folderId, fileName, mode) => ipcRenderer.invoke('library:set-cover', folderId, fileName, mode),
  // Profiles
  getProfiles: () => ipcRenderer.invoke('profiles:get'),
  saveProfiles: (data) => ipcRenderer.invoke('profiles:save', data),
  setActiveProfile: (id) => ipcRenderer.invoke('profiles:set-active', id),
});
