'use strict';

const CYCLE_MS = 5000;

const petEl = document.getElementById('pet');
const gifEl = document.getElementById('gif');
const emojiEl = document.getElementById('emoji');
const quitEl = document.getElementById('quit');

let cycleTimer = null;
let currentGifs = [];
let cycleIndex = 0;
let currentState = null;
let currentSrc = null; // hangi dosya yuklu — gereksiz reload engelle

let retryCount = 0;
const MAX_RETRY = 3;

function showGif(gifPath) {
  // Ayni dosya zaten yukluyse ve gorunuyorsa tekrar dokunma
  if (currentSrc === gifPath && gifEl.classList.contains('visible')) return;
  currentSrc = gifPath;

  const url = gifPath.startsWith('file://') ? gifPath.replace(/\\/g, '/') : ('file:///' + gifPath.replace(/\\/g, '/'));
  gifEl.onload = () => {
    petEl.classList.add('gif-mode');
    gifEl.classList.add('visible');
    retryCount = 0;
  };
  gifEl.onerror = () => {
    currentSrc = null;
    // Retry: belki dosya gecici olarak erisilemedi
    if (retryCount < MAX_RETRY) {
      retryCount++;
      setTimeout(() => showGif(gifPath), 500);
    } else {
      petEl.classList.remove('gif-mode');
      gifEl.classList.remove('visible');
      retryCount = 0;
    }
  };
  gifEl.src = url;
}

function hideAll() {
  petEl.classList.remove('gif-mode');
  gifEl.classList.remove('visible');
  gifEl.src = '';
  emojiEl.textContent = '';
  currentSrc = null;
}

function stopCycle() {
  if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; }
}

function startCycle(gifs) {
  stopCycle();
  currentGifs = gifs;
  cycleIndex = 0;
  showGif(currentGifs[0]);
  if (currentGifs.length > 1) {
    cycleTimer = setInterval(() => {
      cycleIndex = (cycleIndex + 1) % currentGifs.length;
      showGif(currentGifs[cycleIndex]);
    }, CYCLE_MS);
  }
}

function setState(payload) {
  const state = typeof payload === 'string' ? payload : payload.state;
  const gifs = (typeof payload === 'object' && Array.isArray(payload.gifs)) ? payload.gifs : [];

  // Ayni state geliyorsa ama gif gorunmuyorsa -> tekrar yukle
  const gifVisible = gifEl.classList.contains('visible');
  if (state === currentState && gifs.length > 0 && gifs.length === currentGifs.length && gifs[0] === currentGifs[0] && gifVisible) {
    return;
  }
  currentState = state;
  petEl.setAttribute('data-state', state);

  if (gifs.length > 0) {
    startCycle(gifs);
  } else {
    stopCycle();
    hideAll();
  }
}

// Click-through toggle
let lastInteractive = false;
document.addEventListener('mousemove', (e) => {
  const over = e.target === petEl || petEl.contains(e.target);
  if (over !== lastInteractive) {
    lastInteractive = over;
    window.pet.setInteractive(over);
  }
});

// Surukle
let dragging = false;
let lastX = 0, lastY = 0;
petEl.addEventListener('mousedown', (e) => {
  if (e.target === quitEl) return;
  dragging = true; lastX = e.screenX; lastY = e.screenY;
});
let rafPending = false;
let pendingDx = 0, pendingDy = 0;
document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  pendingDx += e.screenX - lastX;
  pendingDy += e.screenY - lastY;
  lastX = e.screenX;
  lastY = e.screenY;
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => {
      if (pendingDx || pendingDy) window.pet.dragBy(pendingDx, pendingDy);
      pendingDx = 0; pendingDy = 0;
      rafPending = false;
    });
  }
});
document.addEventListener('mouseup', () => { dragging = false; });

quitEl.addEventListener('click', () => window.pet.stopPet());

window.pet.onStateChange((payload) => setState(payload));
