'use strict';

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { ANTIGRAVITY } = require('../config');

function createAntigravityWatcher(onState, customConvDir) {
  const convDir = customConvDir || ANTIGRAVITY.convDir;

  const WAITING_DELAY = 2500;  // yazma durdu -> 2.5sn sonra waiting
  const IDLE_DELAY = 10000;    // 10sn sessizlik -> idle
  const POLL_MS = 300;         // 300ms arayla mtime kontrol (fs.watch kacirirsa yakasin)

  let watcher = null;
  let pollTimer = null;
  let lastEmitted = null;
  let waitingTimer = null;
  let idleTimer = null;
  let lastSeenMtime = 0;       // en son gordugumuz DB/WAL mtime

  function emit(state) {
    if (state === lastEmitted) return;
    lastEmitted = state;
    console.log('[antigravity]', state);
    onState({ source: 'antigravity', state });
  }

  function clearTimers() {
    if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  // Dosya degisti -> aninda working, timer'lari kur
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

  let isPolling = false;

  // Dizindeki en yeni mtime'i bul (Asenkron)
  async function getNewestMtime() {
    let newest = 0;
    try {
      const files = await fsPromises.readdir(convDir);
      const statPromises = files
        .filter(f => f.endsWith('.db') || f.endsWith('.db-wal') || f.endsWith('.db-shm'))
        .map(async (f) => {
          try {
            const stat = await fsPromises.stat(path.join(convDir, f));
            return stat.mtimeMs;
          } catch (_) {
            return 0;
          }
        });
      
      const mtimes = await Promise.all(statPromises);
      if (mtimes.length > 0) {
        newest = Math.max(...mtimes);
      }
    } catch (_) {}
    return newest;
  }

  // Poll: mtime degisti mi kontrol et (Asenkron)
  async function pollCheck() {
    if (isPolling) return; // Onceki islem bitmediyse atla
    isPolling = true;
    try {
      const mt = await getNewestMtime();
      if (lastSeenMtime > 0 && mt > lastSeenMtime) {
        lastSeenMtime = mt;
        onActivity();
      } else if (lastSeenMtime === 0 && mt > 0) {
        lastSeenMtime = mt;
      }
    } finally {
      isPolling = false;
    }
  }

  function start() {
    if (pollTimer) return;

    // Baslangic mtime'i asenkron kaydet
    getNewestMtime().then(mt => {
      if (lastSeenMtime === 0) lastSeenMtime = mt;
    });

    // fs.watch - anlik tetikleme
    try {
      watcher = fs.watch(convDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (filename.endsWith('.db') || filename.endsWith('.db-wal') || filename.endsWith('.db-shm')) {
          lastSeenMtime = Date.now();
          onActivity();
        }
      });
      watcher.on('error', () => {});
      console.log('[antigravity] fs.watch aktif');
    } catch (_) {
      console.log('[antigravity] fs.watch basarisiz, sadece poll kullanilacak');
    }

    // Poll - fs.watch kacirirsa 300ms icinde yakalar
    pollTimer = setInterval(pollCheck, POLL_MS);

    emit('idle');
    console.log('[antigravity] watcher baslatildi');
  }

  function stop() {
    clearTimers();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (watcher) { watcher.close(); watcher = null; }
  }

  return { start, stop };
}

module.exports = { createAntigravityWatcher };
