'use strict';

const fs = require('fs');
const path = require('path');
const { ANTIGRAVITY } = require('../config');

function createCliWatcher(onState, customBrainDir) {
  const cliBrainDir = customBrainDir || ANTIGRAVITY.cliBrainDir;

  const WAITING_DELAY = 2500;  // yazma durdu -> 2.5sn sonra waiting
  const IDLE_DELAY = 10000;    // 10sn sessizlik -> idle
  const POLL_MS = 300;         // 300ms arayla mtime kontrol

  let pollTimer = null;
  let activeWatcher = null;
  let activeWatchDir = null;
  
  let lastEmitted = null;
  let waitingTimer = null;
  let idleTimer = null;
  let lastSeenMtime = 0;

  function emit(state) {
    if (state === lastEmitted) return;
    lastEmitted = state;
    console.log('[cli]', state);
    onState({ source: 'cli', state });
  }

  function clearTimers() {
    if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function onActivity() {
    clearTimers();
    emit('working');

    waitingTimer = setTimeout(() => {
      waitingTimer = null;
      emit('waiting');

      idleTimer = setTimeout(() => {
        idleTimer = null;
        emit('idle');
      }, IDLE_DELAY - WAITING_DELAY);
    }, WAITING_DELAY);
  }

  // Find the active conversation dir and its newest file mtime
  function getNewestStats() {
    let newestDir = null;
    let newestDirMtime = 0;
    
    try {
      if (!fs.existsSync(cliBrainDir)) return { mtime: 0, dir: null };
      
      const dirs = fs.readdirSync(cliBrainDir, { withFileTypes: true });
      for (const dirent of dirs) {
        if (!dirent.isDirectory()) continue;
        try {
          const dirPath = path.join(cliBrainDir, dirent.name);
          const stat = fs.statSync(dirPath);
          if (stat.mtimeMs > newestDirMtime) {
            newestDirMtime = stat.mtimeMs;
            newestDir = dirPath;
          }
        } catch (_) {}
      }
      
      if (!newestDir) return { mtime: 0, dir: null };
      
      const logsDir = path.join(newestDir, '.system_generated', 'logs');
      let newestFileMtime = 0;
      
      if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir);
        for (const f of files) {
          if (!f.endsWith('.jsonl') && !f.endsWith('.json')) continue;
          try {
            const mt = fs.statSync(path.join(logsDir, f)).mtimeMs;
            if (mt > newestFileMtime) newestFileMtime = mt;
          } catch (_) {}
        }
      }
      
      return { mtime: newestFileMtime, dir: logsDir };
      
    } catch (_) {
      return { mtime: 0, dir: null };
    }
  }

  // Dynamically attach fs.watch to the active logs folder
  function updateWatcher(logsDir) {
    if (!logsDir) return;
    if (activeWatchDir === logsDir) return;
    
    if (activeWatcher) {
      activeWatcher.close();
      activeWatcher = null;
    }
    
    activeWatchDir = logsDir;
    
    try {
      if (fs.existsSync(logsDir)) {
        activeWatcher = fs.watch(logsDir, { recursive: false }, (eventType, filename) => {
          if (!filename) return;
          if (filename.endsWith('.jsonl') || filename.endsWith('.json')) {
            lastSeenMtime = Date.now();
            onActivity();
          }
        });
        activeWatcher.on('error', () => {
          activeWatcher = null;
          activeWatchDir = null;
        });
        console.log('[cli] fs.watch aktif:', logsDir);
      }
    } catch (_) {
      console.log('[cli] fs.watch basarisiz:', logsDir);
      activeWatcher = null;
      activeWatchDir = null;
    }
  }

  function pollCheck() {
    const { mtime, dir } = getNewestStats();
    if (dir) {
      updateWatcher(dir);
    }
    if (mtime > lastSeenMtime) {
      lastSeenMtime = mtime;
      onActivity();
    }
  }

  function start() {
    if (pollTimer) return;

    const { mtime, dir } = getNewestStats();
    lastSeenMtime = mtime;
    if (dir) {
      updateWatcher(dir);
    }

    pollTimer = setInterval(pollCheck, POLL_MS);

    emit('idle');
    console.log('[cli] watcher baslatildi');
  }

  function stop() {
    clearTimers();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (activeWatcher) { activeWatcher.close(); activeWatcher = null; activeWatchDir = null; }
  }

  return { start, stop };
}

module.exports = { createCliWatcher };
