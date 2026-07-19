'use strict';

const fs = require('fs');
const path = require('path');

function createExtensionManager(userDataPath) {
  const extensionsDir = path.join(userDataPath, 'extensions');
  const configPath = path.join(userDataPath, 'extensions.json');

  // id -> { manifest, instance, running, error }
  const registry = new Map();
  let enabledConfig = {};
  let isEngineRunning = false;

  if (!fs.existsSync(extensionsDir)) {
    fs.mkdirSync(extensionsDir, { recursive: true });
  }

  function loadConfig() {
    try {
      if (fs.existsSync(configPath)) {
        enabledConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (_) {
      enabledConfig = {};
    }
  }

  function saveConfig() {
    try {
      fs.writeFileSync(configPath, JSON.stringify(enabledConfig, null, 2));
    } catch (_) {}
  }

  function scan() {
    loadConfig();
    registry.clear();
    if (!fs.existsSync(extensionsDir)) return;

    const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(extensionsDir, entry.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const id = manifest.id || entry.name;
        registry.set(id, {
          manifest,
          instance: null,
          running: false,
          error: null,
          dir: path.join(extensionsDir, entry.name),
        });
        if (!(id in enabledConfig)) {
          enabledConfig[id] = false;
        }
      } catch (e) {
        console.error(`[ExtensionManager] Failed to load manifest in ${entry.name}:`, e.message);
      }
    }
    saveConfig();
  }

  function loadInstance(id) {
    const ext = registry.get(id);
    if (!ext) return null;
    const mainPath = path.join(ext.dir, ext.manifest.main || 'main.js');
    try {
      // Clear require cache for hot-reload support
      delete require.cache[require.resolve(mainPath)];
      ext.instance = require(mainPath);
      ext.error = null;
    } catch (e) {
      ext.instance = null;
      ext.error = e.message;
      console.error(`[ExtensionManager] Failed to load extension "${id}":`, e.message);
    }
    return ext.instance;
  }

  function makeContext(id) {
    const ext = registry.get(id);
    const settingsPath = ext ? path.join(ext.dir, 'settings.json') : null;
    return {
      getState: () => null,
      log: (msg) => console.log(`[Ext:${id}] ${msg}`),
      getSettings: () => {
        if (!settingsPath) return {};
        try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) { return {}; }
      },
      saveSettings: (data) => {
        if (!settingsPath) return;
        try { fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2)); } catch (_) {}
      },
    };
  }

  function startExtension(id) {
    const ext = registry.get(id);
    if (!ext || ext.running) return;
    const instance = loadInstance(id);
    if (!instance || typeof instance.activate !== 'function') return;
    try {
      const ctx = makeContext(id);
      instance.activate(ctx);
      ext.running = true;
      ext.error = null;
    } catch (e) {
      ext.error = e.message;
      ext.running = false;
      console.error(`[ExtensionManager] activate() failed for "${id}":`, e.message);
    }
  }

  function stopExtension(id) {
    const ext = registry.get(id);
    if (!ext || !ext.running) return;
    try {
      if (ext.instance && typeof ext.instance.deactivate === 'function') {
        ext.instance.deactivate();
      }
    } catch (e) {
      console.error(`[ExtensionManager] deactivate() failed for "${id}":`, e.message);
    }
    ext.running = false;
  }

  function startAll() {
    isEngineRunning = true;
    scan();
    for (const [id] of registry) {
      if (enabledConfig[id]) {
        startExtension(id);
      }
    }
  }

  function stopAll() {
    for (const [id] of registry) {
      stopExtension(id);
    }
    isEngineRunning = false;
  }

  function notifyStateChange(newState, prevState) {
    for (const [id, ext] of registry) {
      if (!ext.running || !ext.instance) continue;
      if (typeof ext.instance.onStateChange !== 'function') continue;
      try {
        ext.instance.onStateChange(newState, prevState);
      } catch (e) {
        console.error(`[ExtensionManager] onStateChange() failed for "${id}":`, e.message);
      }
    }
  }

  function setEnabled(id, enabled) {
    if (!registry.has(id)) return;
    enabledConfig[id] = enabled;
    saveConfig();

    if (isEngineRunning) {
      if (enabled) {
        startExtension(id);
      } else {
        stopExtension(id);
      }
    }
  }

  function getAll() {
    // Don't call scan() here — it clears running state. Just reload config.
    loadConfig();
    if (registry.size === 0) scan(); // only scan if empty (first call)
    const result = [];
    for (const [id, ext] of registry) {
      result.push({
        id,
        name: ext.manifest.name || id,
        description: ext.manifest.description || '',
        version: ext.manifest.version || '1.0.0',
        author: ext.manifest.author || '',
        enabled: !!enabledConfig[id],
        running: ext.running,
        error: ext.error,
        hasSettings: !!(ext.manifest.settingsSchema && ext.manifest.settingsSchema.length),
      });
    }
    return result;
  }

  function getSettings(id) {
    const ext = registry.get(id);
    if (!ext) return {};
    const settingsPath = path.join(ext.dir, 'settings.json');
    try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) { return {}; }
  }

  function saveSettings(id, data) {
    const ext = registry.get(id);
    if (!ext) return;
    const settingsPath = path.join(ext.dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
    // Notify running extension of settings change
    if (ext.running && ext.instance && typeof ext.instance.onSettingsChange === 'function') {
      try { ext.instance.onSettingsChange(data); } catch (_) {}
    }
  }

  function getSchema(id) {
    const ext = registry.get(id);
    if (!ext) return [];
    return ext.manifest.settingsSchema || [];
  }

  function getRunningCount() {
    let count = 0;
    for (const [, ext] of registry) {
      if (ext.running) count++;
    }
    return count;
  }

  // Initialize on creation
  scan();

  return { startAll, stopAll, notifyStateChange, setEnabled, getAll, getRunningCount, getSettings, saveSettings, getSchema, scan };
}

module.exports = { createExtensionManager };
