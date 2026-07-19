'use strict';

// --- Elements ----------------------------------------------------------------
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
const togglePet = document.getElementById('togglePet');
const statusRing = document.querySelector('.status-ring');
const statusTitle = document.querySelector('.status-info h3');
const statusDesc = document.querySelector('.status-info p');
const statusIndicator = document.querySelector('.status-indicator');
const statusText = document.querySelector('.sidebar-footer').lastChild;

// --- Nav ---------------------------------------------------------------------
navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(nav => nav.classList.remove('active'));
    views.forEach(view => view.classList.remove('active'));
    item.classList.add('active');
    const targetView = item.getAttribute('data-view');
    document.getElementById(`view-${targetView}`).classList.add('active');

    if (targetView === 'library') loadFolders();
    if (targetView === 'profiles') { loadProfilesData(); loadMiniLibrary(); setupDropzones(); }
    if (targetView === 'dashboard') { loadDashboardStats(); updateStatusUI(); }
    if (targetView === 'settings') loadSettings();
    if (targetView === 'extensions') loadExtensions();
  });
});

// --- Pet Toggle --------------------------------------------------------------
let isRunning = false;
let renderSubListGeneration = 0;

async function renderEngineSubList() {
  const subList = document.getElementById('engineSubList');
  if (!subList) return;

  const myGen = ++renderSubListGeneration;

  const prefs = await window.dashboard.getEnginePrefs();
  const extensions = await window.extensions.getAll();

  if (myGen !== renderSubListGeneration) return;

  subList.style.display = 'flex';
  subList.innerHTML = '';

  function makeStatus(active) {
    const s = document.createElement('span');
    s.className = 'engine-sub-status' + (isRunning && active ? ' active' : '');
    s.textContent = isRunning ? (active ? 'Running' : 'Stopped') : 'Engine off';
    return s;
  }

  // Pet row
  const petRow = document.createElement('div');
  petRow.className = 'engine-sub-item';
  const petIcon  = document.createElement('span');
  petIcon.className = 'engine-sub-icon';
  petIcon.textContent = '🐾';
  const petLabel = document.createElement('span');
  petLabel.className = 'engine-sub-label';
  petLabel.textContent = 'Pet';
  const petStatus = makeStatus(prefs.petEnabled !== false);
  petStatus.id = 'petSubStatus';

  const petToggleLabel = document.createElement('label');
  petToggleLabel.className = 'switch-container switch-small';
  const petInput = document.createElement('input');
  petInput.type = 'checkbox';
  petInput.checked = prefs.petEnabled !== false;
  petInput.addEventListener('change', async () => {
    await window.dashboard.setPetEnabled(petInput.checked);
    const st = document.getElementById('petSubStatus');
    if (st) {
      st.textContent = isRunning ? (petInput.checked ? 'Running' : 'Stopped') : 'Engine off';
      st.className = 'engine-sub-status' + (isRunning && petInput.checked ? ' active' : '');
    }
  });
  const petSlider = document.createElement('span');
  petSlider.className = 'slider';
  petToggleLabel.appendChild(petInput);
  petToggleLabel.appendChild(petSlider);
  petRow.appendChild(petIcon);
  petRow.appendChild(petLabel);
  petRow.appendChild(petStatus);
  petRow.appendChild(petToggleLabel);
  subList.appendChild(petRow);

  // Extension rows — only show enabled extensions on dashboard
  for (const ext of extensions) {
    if (!ext.enabled) continue;
    const row = document.createElement('div');
    row.className = 'engine-sub-item';
    const extIcon = document.createElement('span');
    extIcon.className = 'engine-sub-icon';
    extIcon.textContent = '🔌';
    const extLabel = document.createElement('span');
    extLabel.className = 'engine-sub-label';
    extLabel.textContent = ext.name;
    const extStatus = makeStatus(true);
    row.appendChild(extIcon);
    row.appendChild(extLabel);
    row.appendChild(extStatus);
    subList.appendChild(row);
  }
}

async function updateStatusUI() {
  const engineDesc = document.getElementById('engineDesc');
  if (isRunning) {
    statusRing.classList.add('active');
    statusIndicator.classList.add('running');
    statusTitle.textContent = 'Engine Active';
    statusText.nodeValue = ' System Running';
    const count = await window.extensions.getRunningCount();
    if (engineDesc) {
      engineDesc.textContent = count > 0
        ? `Watchers active. ${count} extension${count > 1 ? 's' : ''} active.`
        : 'Watchers active.';
    }
  } else {
    statusRing.classList.remove('active');
    statusIndicator.classList.remove('running');
    statusTitle.textContent = 'Engine Off';
    if (engineDesc) engineDesc.textContent = 'Watchers and Pet window are not running.';
    statusText.nodeValue = ' System Idle';
  }
  await renderEngineSubList();
}

togglePet.addEventListener('change', (e) => {
  if (e.target.checked) {
    window.dashboard.startPet();
    isRunning = true;
  } else {
    window.dashboard.stopPet();
    isRunning = false;
  }
  updateStatusUI();
});

window.dashboard.onPetStopped(() => {
  isRunning = false;
  togglePet.checked = false;
  updateStatusUI();
});

// --- Dashboard Stats ---------------------------------------------------------
async function loadDashboardStats() {
  const folders = await window.dashboard.getFolders();
  const profiles = await window.dashboard.getProfiles();
  document.getElementById('statFolders').textContent = folders.length;
  document.getElementById('statProfiles').textContent = profiles.profiles.length;
  renderDashboardProfilePicker(profiles);
}
loadDashboardStats();
updateStatusUI();

function renderDashboardProfilePicker(profiles) {
  const container = document.getElementById('dashboardProfilePicker');
  if (!container) return;
  container.innerHTML = '';
  profiles.profiles.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'dash-profile-btn' + (p.id === profiles.activeProfile ? ' active' : '');
    btn.textContent = p.name;
    btn.addEventListener('click', async () => {
      await window.dashboard.setActiveProfile(p.id);
      loadDashboardStats();
    });
    container.appendChild(btn);
  });
}

// =============================================================================
// LIBRARY
// =============================================================================
const folderGrid = document.getElementById('folderGrid');
const libraryEmptyState = document.getElementById('libraryEmptyState');
const libraryFolderView = document.getElementById('libraryFolderView');
const libraryGifView = document.getElementById('libraryGifView');
const folderGifGrid = document.getElementById('folderGifGrid');
const folderGifEmpty = document.getElementById('folderGifEmpty');
const importFolderBtn = document.getElementById('importFolderBtn');
const createFolderBtn = document.getElementById('createFolderBtn');
const backToFoldersBtn = document.getElementById('backToFoldersBtn');
const addGifToFolderBtn = document.getElementById('addGifToFolderBtn');

let foldersCache = [];
let currentFolderId = null;
let coverTimers = {};

// --- Folder Grid -------------------------------------------------------------
async function loadFolders() {
  clearCoverTimers();
  foldersCache = await window.dashboard.getFolders();
  renderFolderGrid();
}

function clearCoverTimers() {
  for (const id of Object.keys(coverTimers)) {
    clearInterval(coverTimers[id]);
  }
  coverTimers = {};
}

function renderFolderGrid() {
  if (foldersCache.length === 0) {
    libraryEmptyState.style.display = 'flex';
    folderGrid.style.display = 'none';
    return;
  }
  libraryEmptyState.style.display = 'none';
  folderGrid.style.display = 'grid';
  folderGrid.innerHTML = '';

  foldersCache.forEach(folder => {
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.dataset.folderId = folder.id;

    if (folder.gifCount > 0) {
      const img = document.createElement('img');
      img.className = 'folder-card-cover';
      img.alt = folder.name;
      card.appendChild(img);
      startCoverCycle(folder, img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'folder-card-placeholder';
      placeholder.textContent = '📁';
      card.appendChild(placeholder);
    }

    const info = document.createElement('div');
    info.className = 'folder-card-info';
    const name = document.createElement('span');
    name.className = 'folder-card-name';
    name.textContent = folder.name;
    const count = document.createElement('span');
    count.className = 'folder-card-count';
    count.textContent = folder.gifCount + ' GIF' + (folder.gifCount !== 1 ? 's' : '');
    info.appendChild(name);
    info.appendChild(count);
    card.appendChild(info);

    card.addEventListener('click', () => openFolder(folder.id));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showFolderContextMenu(e.clientX, e.clientY, folder);
    });

    folderGrid.appendChild(card);
  });
}

async function startCoverCycle(folder, imgEl) {
  const gifs = await window.dashboard.getFolderGifs(folder.id);
  if (gifs.length === 0) return;

  if (folder.coverMode === 'fixed' && folder.cover) {
    const coverUrl = gifs.find(g => g.includes(folder.cover));
    if (coverUrl) { imgEl.src = coverUrl; return; }
  }

  let index = Math.floor(Math.random() * gifs.length);
  imgEl.src = gifs[index];

  if (gifs.length > 1) {
    coverTimers[folder.id] = setInterval(() => {
      index = (index + 1) % gifs.length;
      imgEl.src = gifs[index];
    }, 5000);
  }
}

// --- Folder Open/Close -------------------------------------------------------
async function openFolder(folderId) {
  currentFolderId = folderId;
  clearCoverTimers();
  libraryFolderView.style.display = 'none';
  libraryGifView.style.display = 'block';

  const folder = foldersCache.find(f => f.id === folderId);
  document.getElementById('openFolderName').textContent = folder ? folder.name : 'Folder';

  await renderFolderGifs();
}

async function renderFolderGifs() {
  const gifs = await window.dashboard.getFolderGifs(currentFolderId);
  document.getElementById('openFolderCount').textContent = gifs.length + ' animation' + (gifs.length !== 1 ? 's' : '');

  if (gifs.length === 0) {
    folderGifGrid.style.display = 'none';
    folderGifEmpty.style.display = 'flex';
    folderGifGrid.innerHTML = '';
    return;
  }

  folderGifEmpty.style.display = 'none';
  folderGifGrid.style.display = 'grid';
  folderGifGrid.innerHTML = '';

  gifs.forEach(gifUrl => {
    const fileName = decodeURIComponent(gifUrl.split('/').pop());
    const item = document.createElement('div');
    item.className = 'gif-item';

    const img = document.createElement('img');
    img.src = gifUrl;
    img.alt = fileName;

    const nameLabel = document.createElement('div');
    nameLabel.className = 'gif-item-name';
    nameLabel.textContent = fileName;

    item.appendChild(img);
    item.appendChild(nameLabel);

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showGifContextMenu(e.clientX, e.clientY, currentFolderId, fileName, gifUrl);
    });

    folderGifGrid.appendChild(item);
  });
}

function closeFolder() {
  currentFolderId = null;
  libraryGifView.style.display = 'none';
  libraryFolderView.style.display = 'block';
  loadFolders();
}

backToFoldersBtn.addEventListener('click', closeFolder);

addGifToFolderBtn.addEventListener('click', async () => {
  if (!currentFolderId) return;
  const added = await window.dashboard.addGifsToFolder(currentFolderId);
  if (added && added.length > 0) renderFolderGifs();
});

importFolderBtn.addEventListener('click', async () => {
  const result = await window.dashboard.importFolder();
  if (result) loadFolders();
});

createFolderBtn.addEventListener('click', async () => {
  const result = await window.dashboard.createFolder('New Folder');
  if (result) loadFolders();
});

// =============================================================================
// CONTEXT MENU
// =============================================================================
const contextMenu = document.getElementById('contextMenu');

function showContextMenu(x, y, items) {
  contextMenu.innerHTML = '';
  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      contextMenu.appendChild(sep);
    } else {
      const el = document.createElement('div');
      el.className = 'context-menu-item' + (item.danger ? ' danger' : '');
      el.textContent = item.label;
      el.addEventListener('click', () => { hideContextMenu(); item.action(); });
      contextMenu.appendChild(el);
    }
  });

  // Position clamped to viewport
  contextMenu.style.display = 'block';
  const rect = contextMenu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  contextMenu.style.left = Math.min(x, maxX) + 'px';
  contextMenu.style.top = Math.min(y, maxY) + 'px';
}

function hideContextMenu() {
  contextMenu.style.display = 'none';
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.folder-card') && !e.target.closest('.gif-item')) {
    hideContextMenu();
  }
});

function showFolderContextMenu(x, y, folder) {
  showContextMenu(x, y, [
    { label: 'Rename', action: () => renameFolder(folder) },
    { label: 'Set Cover', action: () => toggleCoverMode(folder) },
    { separator: true },
    { label: 'Delete Folder', danger: true, action: () => deleteFolder(folder) }
  ]);
}

function showGifContextMenu(x, y, folderId, fileName, gifUrl) {
  showContextMenu(x, y, [
    { label: 'Set as Cover', action: () => setAsCover(folderId, fileName) },
    { label: 'Reset Cover (Cycle)', action: () => resetCover(folderId) },
    { separator: true },
    { label: 'Delete GIF', danger: true, action: () => deleteGif(folderId, fileName) }
  ]);
}

function renameFolder(folder) {
  const modal = document.getElementById('renameModal');
  const input = document.getElementById('renameInput');
  const confirmBtn = document.getElementById('renameConfirmBtn');
  const cancelBtn = document.getElementById('renameCancelBtn');

  input.value = folder.name;
  modal.style.display = 'flex';
  input.focus();
  input.select();

  function cleanup() {
    modal.style.display = 'none';
    confirmBtn.removeEventListener('click', onConfirm);
    cancelBtn.removeEventListener('click', onCancel);
    input.removeEventListener('keydown', onKey);
  }

  async function onConfirm() {
    const newName = input.value.trim();
    if (newName) {
      await window.dashboard.renameFolder(folder.id, newName);
      loadFolders();
    }
    cleanup();
  }

  function onCancel() { cleanup(); }

  function onKey(e) {
    if (e.key === 'Enter') onConfirm();
    if (e.key === 'Escape') onCancel();
  }

  confirmBtn.addEventListener('click', onConfirm);
  cancelBtn.addEventListener('click', onCancel);
  input.addEventListener('keydown', onKey);
}

function toggleCoverMode(folder) {
  showCoverPicker(folder);
}

function showCoverPicker(folder) {
  const modal = document.getElementById('coverModal');
  const grid = document.getElementById('coverPickerGrid');
  const cancelBtn = document.getElementById('coverCancelBtn');
  const cycleBtn = document.getElementById('coverCycleBtn');

  grid.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Loading...</p>';
  modal.style.display = 'flex';

  window.dashboard.getFolderGifs(folder.id).then(gifs => {
    grid.innerHTML = '';
    if (gifs.length === 0) {
      grid.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No GIFs in this folder.</p>';
      return;
    }
    gifs.forEach(gifUrl => {
      const fileName = decodeURIComponent(gifUrl.split('/').pop());
      const item = document.createElement('div');
      item.className = 'cover-picker-item' + (folder.coverMode === 'fixed' && folder.cover === fileName ? ' selected' : '');

      const img = document.createElement('img');
      img.src = gifUrl;

      item.appendChild(img);
      item.addEventListener('click', async () => {
        await window.dashboard.setCover(folder.id, fileName, 'fixed');
        cleanup();
        loadFolders();
      });
      grid.appendChild(item);
    });
  });

  async function onCycle() {
    await window.dashboard.setCover(folder.id, null, 'cycle');
    cleanup();
    loadFolders();
  }

  function onCancel() { cleanup(); }

  function cleanup() {
    modal.style.display = 'none';
    cancelBtn.removeEventListener('click', onCancel);
    cycleBtn.removeEventListener('click', onCycle);
  }

  cancelBtn.addEventListener('click', onCancel);
  cycleBtn.addEventListener('click', onCycle);
}

function deleteFolder(folder) {
  showDeleteModal(
    'Delete Folder',
    `"${folder.name}" and all its GIFs will be permanently deleted.`,
    async () => {
      await window.dashboard.deleteFolder(folder.id);
      loadFolders();
    }
  );
}

async function setAsCover(folderId, fileName) {
  await window.dashboard.setCover(folderId, fileName, 'fixed');
  loadFolders();
}

async function resetCover(folderId) {
  await window.dashboard.setCover(folderId, null, 'cycle');
  loadFolders();
}

async function deleteGif(folderId, fileName) {
  if (confirm(`Delete "${fileName}"?`)) {
    await window.dashboard.deleteGif(folderId, fileName);
    renderFolderGifs();
  }
}

// =============================================================================
// PROFILES
// =============================================================================
let profilesData = null;
let currentProfileId = null;

const profilesList = document.getElementById('profilesList');
const profileEditor = document.getElementById('profileEditor');
const profileNameInput = document.getElementById('profileNameInput');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const deleteProfileBtn = document.getElementById('deleteProfileBtn');
const addProfileBtn = document.getElementById('addProfileBtn');
const miniLibraryGrid = document.getElementById('miniLibraryGrid');

async function loadProfilesData() {
  profilesData = await window.dashboard.getProfiles();
  renderProfilesList();
  if (profilesData.profiles.length > 0) {
    selectProfile(currentProfileId || profilesData.activeProfile || profilesData.profiles[0].id);
  }
}

function renderProfilesList() {
  profilesList.innerHTML = '';
  profilesData.profiles.forEach(p => {
    const item = document.createElement('div');
    item.className = 'profile-list-item' + (p.id === currentProfileId ? ' active' : '') + (p.id === profilesData.activeProfile ? ' is-active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;
    item.appendChild(nameSpan);

    if (p.id === profilesData.activeProfile) {
      const badge = document.createElement('span');
      badge.className = 'profile-active-badge';
      badge.textContent = 'Active';
      item.appendChild(badge);
    }

    item.addEventListener('click', async () => {
      profilesData.activeProfile = p.id;
      await window.dashboard.setActiveProfile(p.id);
      selectProfile(p.id);
    });
    profilesList.appendChild(item);
  });
}

function selectProfile(id) {
  currentProfileId = id;
  const profile = profilesData.profiles.find(p => p.id === id);
  if (!profile) return;

  profileEditor.style.display = 'flex';
  profileNameInput.value = profile.name;
  renderProfilesList();
  renderStateGifs('idle', profile.states.idle);
  renderStateGifs('working', profile.states.working);
  renderStateGifs('waiting', profile.states.waiting);
}

function renderStateGifs(state, gifs) {
  const container = document.getElementById(`${state}Gifs`);
  if (!container) return;
  container.innerHTML = '';

  const dropzone = container.closest('.state-dropzone');
  const hint = dropzone && dropzone.querySelector('.dropzone-text');
  if (hint) hint.style.display = gifs.length === 0 ? '' : 'none';

  gifs.forEach((gif, index) => {
    const item = document.createElement('div');
    item.className = 'state-gif-item';
    const img = document.createElement('img');
    img.src = gif;

    const rmBtn = document.createElement('button');
    rmBtn.className = 'remove-gif-btn';
    rmBtn.textContent = '✕';
    rmBtn.onclick = (e) => {
      e.stopPropagation();
      const profile = profilesData.profiles.find(p => p.id === currentProfileId);
      profile.states[state].splice(index, 1);
      renderStateGifs(state, profile.states[state]);
      window.dashboard.saveProfiles(profilesData);
    };

    item.appendChild(img);
    item.appendChild(rmBtn);
    container.appendChild(item);
  });
}

// Dropzones
let isDropzonesSetup = false;
function setupDropzones() {
  if (isDropzonesSetup) return;
  isDropzonesSetup = true;

  document.querySelectorAll('.state-dropzone').forEach(dz => {
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => { dz.classList.remove('drag-over'); });
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const gifUrl = e.dataTransfer.getData('text/plain');
      if (gifUrl && currentProfileId) {
        const state = dz.getAttribute('data-state');
        const profile = profilesData.profiles.find(p => p.id === currentProfileId);
        if (!profile.states[state].includes(gifUrl)) {
          profile.states[state].push(gifUrl);
          renderStateGifs(state, profile.states[state]);
          window.dashboard.saveProfiles(profilesData);
        }
      }
    });
  });
}

// Mini library — klasör seçimli
let miniLibraryFolders = [];
let selectedMiniFolderId = null;

async function loadMiniLibrary() {
  miniLibraryFolders = await window.dashboard.getFolders();
  renderMiniFolderTabs();
  if (miniLibraryFolders.length > 0) {
    selectMiniFolder(selectedMiniFolderId && miniLibraryFolders.find(f => f.id === selectedMiniFolderId)
      ? selectedMiniFolderId
      : miniLibraryFolders[0].id);
  } else {
    miniLibraryGrid.innerHTML = '';
  }
}

function renderMiniFolderTabs() {
  const tabBar = document.getElementById('miniLibraryTabs');
  tabBar.innerHTML = '';
  miniLibraryFolders.forEach(folder => {
    const tab = document.createElement('button');
    tab.className = 'mini-folder-tab' + (folder.id === selectedMiniFolderId ? ' active' : '');
    tab.textContent = folder.name;
    tab.addEventListener('click', () => selectMiniFolder(folder.id));
    tabBar.appendChild(tab);
  });
}

async function selectMiniFolder(folderId) {
  selectedMiniFolderId = folderId;
  renderMiniFolderTabs();
  const gifs = await window.dashboard.getFolderGifs(folderId);
  miniLibraryGrid.innerHTML = '';
  gifs.forEach(gif => {
    const item = document.createElement('div');
    item.className = 'mini-gif-item';
    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', gif);
    });
    const img = document.createElement('img');
    img.src = gif;
    item.appendChild(img);
    miniLibraryGrid.appendChild(item);
  });
}

if (saveProfileBtn) {
  saveProfileBtn.addEventListener('click', async () => {
    const profile = profilesData.profiles.find(p => p.id === currentProfileId);
    if (profile) {
      profile.name = profileNameInput.value;
      await window.dashboard.saveProfiles(profilesData);
      renderProfilesList();
      triggerSaveSuccess(saveProfileBtn);
    }
  });
}

function triggerSaveSuccess(btn) {
  const original = btn.textContent;
  btn.textContent = '✓ Saved';
  btn.style.animation = 'savePop 0.35s ease';
  btn.classList.add('save-success');
  setTimeout(() => {
    btn.classList.remove('save-success');
    btn.style.animation = '';
    btn.textContent = original;
  }, 1800);
}

if (deleteProfileBtn) {
  deleteProfileBtn.addEventListener('click', () => {
    if (profilesData.profiles.length <= 1) {
      showInfoModal('Cannot delete the last profile.');
      return;
    }
    const profile = profilesData.profiles.find(p => p.id === currentProfileId);
    showDeleteModal(
      'Delete Profile',
      `"${profile ? profile.name : 'this profile'}" will be permanently deleted.`,
      async () => {
        profilesData.profiles = profilesData.profiles.filter(p => p.id !== currentProfileId);
        if (profilesData.activeProfile === currentProfileId) {
          profilesData.activeProfile = profilesData.profiles[0].id;
        }
        await window.dashboard.saveProfiles(profilesData);
        selectProfile(profilesData.profiles[0].id);
      }
    );
  });
}

function showDeleteModal(title, desc, onConfirm) {
  const modal = document.getElementById('deleteModal');
  const titleEl = document.getElementById('deleteModalTitle');
  const descEl = document.getElementById('deleteModalDesc');
  const confirmBtn = document.getElementById('deleteConfirmBtn');
  const cancelBtn = document.getElementById('deleteCancelBtn');

  titleEl.textContent = title;
  descEl.textContent = desc;
  modal.style.display = 'flex';

  function cleanup() {
    modal.style.display = 'none';
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
  }
  function handleConfirm() { cleanup(); onConfirm(); }
  function handleCancel() { cleanup(); }

  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);
}

function showInfoModal(message) {
  const modal = document.getElementById('infoModal');
  const msgEl = document.getElementById('infoModalMsg');
  const okBtn = document.getElementById('infoModalOkBtn');
  msgEl.textContent = message;
  modal.style.display = 'flex';
  function cleanup() { modal.style.display = 'none'; okBtn.removeEventListener('click', cleanup); }
  okBtn.addEventListener('click', cleanup);
}

if (addProfileBtn) {
  addProfileBtn.addEventListener('click', async () => {
    const newId = 'profile_' + Date.now();
    profilesData.profiles.push({
      id: newId,
      name: 'New Profile',
      states: { idle: [], working: [], waiting: [] }
    });
    await window.dashboard.saveProfiles(profilesData);
    selectProfile(newId);
  });
}

// =============================================================================
// EXTENSIONS
// =============================================================================
async function renderSettingsPanel(ext, container) {
  container.innerHTML = '';
  const schema = await window.extensions.getSchema(ext.id);
  if (!schema || !schema.length) return;
  const saved = await window.extensions.getSettings(ext.id);

  const panel = document.createElement('div');
  panel.className = 'ext-settings-panel';

  const fields = {};
  schema.forEach(field => {
    const row = document.createElement('div');
    row.className = 'ext-settings-row';

    const label = document.createElement('span');
    label.className = 'ext-settings-label';
    label.textContent = field.label;

    const ctrl = document.createElement('div');
    ctrl.className = 'ext-settings-control';

    const val = saved[field.key] !== undefined ? saved[field.key] : field.default;

    if (field.type === 'select') {
      const sel = document.createElement('select');
      (field.options || []).forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (opt === val) o.selected = true;
        sel.appendChild(o);
      });
      ctrl.appendChild(sel);
      fields[field.key] = () => sel.value;
    } else if (field.type === 'toggle') {
      const lbl = document.createElement('label');
      lbl.className = 'switch-container';
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = val === true || val === 'true';
      const sl = document.createElement('span');
      sl.className = 'slider';
      lbl.appendChild(inp); lbl.appendChild(sl);
      ctrl.appendChild(lbl);
      fields[field.key] = () => inp.checked;
    } else if (field.type === 'number') {
      const inp = document.createElement('input');
      inp.type = 'number';
      if (field.min !== undefined) inp.min = field.min;
      if (field.max !== undefined) inp.max = field.max;
      inp.value = val;
      ctrl.appendChild(inp);
      fields[field.key] = () => Number(inp.value);
    }

    row.appendChild(label);
    row.appendChild(ctrl);
    panel.appendChild(row);
  });

  const actions = document.createElement('div');
  actions.className = 'ext-settings-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-primary';
  saveBtn.style.fontSize = '13px';
  saveBtn.style.padding = '7px 16px';
  saveBtn.textContent = 'Save';
  const savedMsg = document.createElement('span');
  savedMsg.className = 'ext-settings-saved';
  savedMsg.textContent = '✓ Saved';

  saveBtn.addEventListener('click', async () => {
    const data = {};
    schema.forEach(f => { data[f.key] = fields[f.key](); });
    await window.extensions.saveSettings(ext.id, data);
    savedMsg.classList.add('visible');
    setTimeout(() => savedMsg.classList.remove('visible'), 2000);
  });

  actions.appendChild(saveBtn);
  actions.appendChild(savedMsg);
  panel.appendChild(actions);
  container.appendChild(panel);
}

async function loadExtensions() {
  const list = document.getElementById('extensionsList');
  const empty = document.getElementById('extensionsEmpty');
  if (!list || !empty) return;

  const extensions = await window.extensions.getAll();

  if (extensions.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  list.style.display = 'flex';
  empty.style.display = 'none';
  list.innerHTML = '';

  extensions.forEach(ext => {
    const card = document.createElement('div');
    card.className = 'extension-card';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'stretch';

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:20px;';

    const icon = document.createElement('div');
    icon.className = 'extension-icon' + (ext.running ? ' running' : '');
    icon.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;

    const info = document.createElement('div');
    info.className = 'extension-info';
    const nameRow = document.createElement('p');
    nameRow.className = 'extension-name';
    nameRow.textContent = ext.name;
    const vBadge = document.createElement('span');
    vBadge.className = 'extension-version';
    vBadge.textContent = 'v' + ext.version;
    nameRow.appendChild(vBadge);
    const desc = document.createElement('p');
    desc.className = 'extension-desc';
    desc.textContent = ext.error ? '⚠ ' + ext.error : (ext.description || '');
    info.appendChild(nameRow);
    info.appendChild(desc);

    const statusBadge = document.createElement('span');
    statusBadge.className = 'extension-status ' + (ext.error ? 'error' : ext.running ? 'running' : 'stopped');
    statusBadge.textContent = ext.error ? 'Error' : ext.running ? 'Running' : 'Stopped';

    const toggle = document.createElement('label');
    toggle.className = 'switch-container';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = ext.enabled;
    input.addEventListener('change', async () => {
      await window.extensions.setEnabled(ext.id, input.checked);
      await loadExtensions();
      await updateStatusUI();
    });
    const span = document.createElement('span');
    span.className = 'slider';
    toggle.appendChild(input);
    toggle.appendChild(span);

    // Build topRow in correct order
    topRow.appendChild(icon);
    topRow.appendChild(info);
    topRow.appendChild(statusBadge);

    // Settings button + container
    let settingsContainer = null;
    if (ext.hasSettings) {
      settingsContainer = document.createElement('div');
      let settingsOpen = false;
      const settingsBtn = document.createElement('button');
      settingsBtn.className = 'btn-settings-toggle';
      settingsBtn.title = 'Settings';
      settingsBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
      settingsBtn.addEventListener('click', async () => {
        settingsOpen = !settingsOpen;
        settingsBtn.classList.toggle('active', settingsOpen);
        if (settingsOpen) {
          await renderSettingsPanel(ext, settingsContainer);
        } else {
          settingsContainer.innerHTML = '';
        }
      });
      topRow.appendChild(settingsBtn);
    }

    topRow.appendChild(toggle);
    card.appendChild(topRow);
    if (settingsContainer) card.appendChild(settingsContainer);
    list.appendChild(card);
  });
}

// =============================================================================
// MARKETPLACE
// =============================================================================
const marketplaceRefreshBtn = document.getElementById('marketplaceRefreshBtn');
const marketplaceList = document.getElementById('marketplaceList');
const marketplaceEmpty = document.getElementById('marketplaceEmpty');
const marketplaceLoading = document.getElementById('marketplaceLoading');
const marketplaceError = document.getElementById('marketplaceError');

let marketplaceCache = [];

marketplaceRefreshBtn.addEventListener('click', () => fetchMarketplace());

async function fetchMarketplace() {
  marketplaceList.innerHTML = '';
  marketplaceEmpty.style.display = 'none';
  marketplaceError.style.display = 'none';
  marketplaceLoading.style.display = 'flex';

  const result = await window.marketplace.fetchList();

  marketplaceLoading.style.display = 'none';

  if (!result.success) {
    marketplaceError.textContent = 'Failed to fetch: ' + (result.error || 'Unknown error');
    marketplaceError.style.display = 'block';
    return;
  }

  marketplaceCache = result.extensions;

  if (marketplaceCache.length === 0) {
    marketplaceEmpty.innerHTML = '<p>No extensions available in the repository yet.</p>';
    marketplaceEmpty.style.display = 'block';
    return;
  }

  renderMarketplace();
}

function renderMarketplace() {
  marketplaceList.innerHTML = '';
  marketplaceEmpty.style.display = 'none';

  marketplaceCache.forEach(ext => {
    const card = document.createElement('div');
    card.className = 'marketplace-card';

    const icon = document.createElement('div');
    icon.className = 'marketplace-card-icon' + (ext._installed ? ' installed' : '');
    icon.innerHTML = ext._installed
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';

    const info = document.createElement('div');
    info.className = 'marketplace-card-info';

    const name = document.createElement('p');
    name.className = 'marketplace-card-name';
    name.textContent = ext.name || ext.id;
    const vBadge = document.createElement('span');
    vBadge.className = 'extension-version';
    vBadge.textContent = 'v' + (ext.version || '1.0.0');
    name.appendChild(vBadge);

    const meta = document.createElement('p');
    meta.className = 'marketplace-card-meta';
    meta.textContent = ext.author ? 'by ' + ext.author : '';

    const desc = document.createElement('p');
    desc.className = 'marketplace-card-desc';
    desc.textContent = ext.description || '';

    info.appendChild(name);
    if (ext.author) info.appendChild(meta);
    info.appendChild(desc);

    const actions = document.createElement('div');
    actions.className = 'marketplace-card-actions';

    if (ext._installed) {
      const uninstallBtn = document.createElement('button');
      uninstallBtn.className = 'btn-uninstall';
      uninstallBtn.textContent = 'Uninstall';
      uninstallBtn.addEventListener('click', async () => {
        uninstallBtn.disabled = true;
        uninstallBtn.textContent = 'Removing...';
        const res = await window.marketplace.uninstall(ext.id || ext._folderName);
        if (res.success) {
          ext._installed = false;
          renderMarketplace();
          loadExtensions();
          updateStatusUI();
        } else {
          uninstallBtn.textContent = 'Error';
          setTimeout(() => { uninstallBtn.textContent = 'Uninstall'; uninstallBtn.disabled = false; }, 2000);
        }
      });
      actions.appendChild(uninstallBtn);
    } else {
      const installBtn = document.createElement('button');
      installBtn.className = 'btn-install';
      installBtn.textContent = 'Install';
      installBtn.addEventListener('click', async () => {
        installBtn.disabled = true;
        installBtn.textContent = 'Installing...';
        const res = await window.marketplace.install(ext._folderName);
        if (res.success) {
          ext._installed = true;
          renderMarketplace();
          loadExtensions();
          updateStatusUI();
        } else {
          installBtn.textContent = 'Failed';
          setTimeout(() => { installBtn.textContent = 'Install'; installBtn.disabled = false; }, 2000);
        }
      });
      actions.appendChild(installBtn);
    }

    card.appendChild(icon);
    card.appendChild(info);
    card.appendChild(actions);
    marketplaceList.appendChild(card);
  });
}

// =============================================================================
// SETTINGS
// =============================================================================
const idePathInput = document.getElementById('idePathInput');
const cliPathInput = document.getElementById('cliPathInput');
const idePathBrowse = document.getElementById('idePathBrowse');
const cliPathBrowse = document.getElementById('cliPathBrowse');
const idePathStatus = document.getElementById('idePathStatus');
const cliPathStatus = document.getElementById('cliPathStatus');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const saveSettingsStatus = document.getElementById('saveSettingsStatus');

async function loadSettings() {
  const s = await window.settings.get();

  document.querySelectorAll('input[name="watchMode"]').forEach(r => {
    r.checked = (r.value === s.watchMode);
  });

  idePathInput.value = s.idePath || '';
  cliPathInput.value = s.cliPath || '';

  await updatePathStatus(s.idePath, idePathStatus);
  await updatePathStatus(s.cliPath, cliPathStatus);
}

async function updatePathStatus(dirPath, statusEl) {
  if (!dirPath) { statusEl.className = 'path-status'; return; }
  const valid = await window.settings.validatePath(dirPath);
  statusEl.className = 'path-status ' + (valid ? 'valid' : 'invalid');
}

idePathBrowse.addEventListener('click', async () => {
  const selected = await window.settings.browseFolder();
  if (selected) {
    idePathInput.value = selected;
    await updatePathStatus(selected, idePathStatus);
  }
});

cliPathBrowse.addEventListener('click', async () => {
  const selected = await window.settings.browseFolder();
  if (selected) {
    cliPathInput.value = selected;
    await updatePathStatus(selected, cliPathStatus);
  }
});

saveSettingsBtn.addEventListener('click', async () => {
  let watchMode = 'BOTH';
  document.querySelectorAll('input[name="watchMode"]').forEach(r => {
    if (r.checked) watchMode = r.value;
  });

  const result = await window.settings.save({
    watchMode,
    idePath: idePathInput.value,
    cliPath: cliPathInput.value,
  });

  idePathStatus.className = 'path-status ' + (result.idePathValid ? 'valid' : 'invalid');
  cliPathStatus.className = 'path-status ' + (result.cliPathValid ? 'valid' : 'invalid');

  saveSettingsStatus.textContent = 'Settings saved!';
  saveSettingsStatus.classList.add('visible');
  setTimeout(() => saveSettingsStatus.classList.remove('visible'), 3000);
});

// =============================================================================
// SETTINGS SUB-TABS
// =============================================================================
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`settings-tab-${tab.getAttribute('data-settings-tab')}`).classList.add('active');
  });
});

// =============================================================================
// DATA EXPORT / IMPORT
// =============================================================================
const exportDataBtn = document.getElementById('exportDataBtn');
const importDataBtn = document.getElementById('importDataBtn');

function showLoadingOverlay(msg) {
  const overlay = document.getElementById('loadingOverlay');
  document.getElementById('loadingMsg').textContent = msg;
  overlay.style.display = 'flex';
}

function hideLoadingOverlay() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

if (exportDataBtn) {
  exportDataBtn.addEventListener('click', async () => {
    showLoadingOverlay('Exporting your data...');
    const result = await window.dataManager.exportData();
    hideLoadingOverlay();
    if (result.success) {
      showInfoModal(`Backup saved successfully!\n\n${result.path}`);
    } else if (result.error !== 'Cancelled') {
      showInfoModal(`Export failed: ${result.error}`);
    }
  });
}

if (importDataBtn) {
  importDataBtn.addEventListener('click', () => showImportConfirmModal());
}

function showImportConfirmModal() {
  const modal = document.getElementById('importConfirmModal');
  const confirmBtn = document.getElementById('importConfirmOkBtn');
  const cancelBtn = document.getElementById('importConfirmCancelBtn');
  modal.style.display = 'flex';

  function cleanup() {
    modal.style.display = 'none';
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
  }

  async function handleConfirm() {
    cleanup();
    showLoadingOverlay('Importing your data...');
    const result = await window.dataManager.importData();
    hideLoadingOverlay();
    if (result.success) {
      showInfoModal('Data imported successfully!');
      setTimeout(() => { loadDashboardStats(); loadSettings(); }, 400);
    } else if (result.error !== 'Cancelled') {
      showInfoModal(`Import failed: ${result.error}`);
    }
  }

  function handleCancel() { cleanup(); }
  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);
}

// =============================================================================
// ONBOARDING
// =============================================================================
let onboardingStep = 0;
const ONBOARDING_STEPS = 5;

async function checkOnboarding() {
  const isFirst = await window.settings.isFirstLaunch();
  if (isFirst) showOnboarding();
}

function showOnboarding() {
  document.getElementById('onboardingOverlay').style.display = 'flex';
  setOnboardingStep(0);
}

function hideOnboarding() {
  document.getElementById('onboardingOverlay').style.display = 'none';
  window.settings.completeOnboarding();
}

function setOnboardingStep(step) {
  onboardingStep = step;

  document.querySelectorAll('.onboarding-dot').forEach((dot, i) => {
    dot.classList.remove('active', 'completed');
    if (i === step) dot.classList.add('active');
    else if (i < step) dot.classList.add('completed');
  });

  document.querySelectorAll('.onboarding-step').forEach((el, i) => {
    el.classList.toggle('active', i === step);
  });

  const backBtn = document.getElementById('onboardingBackBtn');
  const nextBtn = document.getElementById('onboardingNextBtn');
  const skipBtn = document.getElementById('onboardingSkipBtn');

  if (step === 0) {
    backBtn.style.display = 'none';
    nextBtn.style.display = 'none';
    skipBtn.style.visibility = 'hidden';
  } else {
    skipBtn.style.visibility = 'visible';
    backBtn.style.display = step > 1 ? '' : 'none';
    nextBtn.style.display = '';
    nextBtn.textContent = step === ONBOARDING_STEPS - 1 ? 'Finish' : 'Next';
  }

  if (step === 3) {
    updateOnboardingPathVisibility();
    window.settings.get().then(s => {
      const ideIn = document.getElementById('onboardingIdePathInput');
      const cliIn = document.getElementById('onboardingCliPathInput');
      if (!ideIn.value) ideIn.value = s.idePath || '';
      if (!cliIn.value) cliIn.value = s.cliPath || '';
    });
  }
}

function updateOnboardingPathVisibility() {
  const mode = document.querySelector('input[name="onboardingWatchMode"]:checked')?.value || 'IDE';
  document.getElementById('onboardingIdePathGroup').style.display = (mode === 'CLI') ? 'none' : '';
  document.getElementById('onboardingCliPathGroup').style.display = (mode === 'IDE') ? 'none' : '';
}

async function saveOnboardingSettings() {
  const watchMode = document.querySelector('input[name="onboardingWatchMode"]:checked')?.value || 'BOTH';
  const idePath = document.getElementById('onboardingIdePathInput').value;
  const cliPath = document.getElementById('onboardingCliPathInput').value;
  const current = await window.settings.get();
  await window.settings.save({
    ...current,
    watchMode,
    idePath: idePath || current.idePath,
    cliPath: cliPath || current.cliPath,
    onboardingCompleted: true,
  });
}

// Onboarding button wiring
document.getElementById('onboardingImportBtn')?.addEventListener('click', async () => {
  const result = await window.dataManager.importData();
  if (result.success) { hideOnboarding(); loadDashboardStats(); loadSettings(); }
  else if (result.error !== 'Cancelled') showInfoModal(`Import failed: ${result.error}`);
});

document.getElementById('onboardingFreshBtn')?.addEventListener('click', () => setOnboardingStep(1));

document.getElementById('onboardingNextBtn')?.addEventListener('click', async () => {
  if (onboardingStep === ONBOARDING_STEPS - 1) {
    await saveOnboardingSettings();
    hideOnboarding();
  } else {
    setOnboardingStep(onboardingStep + 1);
  }
});

document.getElementById('onboardingBackBtn')?.addEventListener('click', () => {
  if (onboardingStep > 1) setOnboardingStep(onboardingStep - 1);
});

document.getElementById('onboardingSkipBtn')?.addEventListener('click', () => hideOnboarding());

document.getElementById('onboardingIdePathBrowse')?.addEventListener('click', async () => {
  const p = await window.settings.browseFolder();
  if (p) document.getElementById('onboardingIdePathInput').value = p;
});

document.getElementById('onboardingCliPathBrowse')?.addEventListener('click', async () => {
  const p = await window.settings.browseFolder();
  if (p) document.getElementById('onboardingCliPathInput').value = p;
});

document.querySelectorAll('input[name="onboardingWatchMode"]').forEach(r => {
  r.addEventListener('change', updateOnboardingPathVisibility);
});

// Run on load
checkOnboarding();
