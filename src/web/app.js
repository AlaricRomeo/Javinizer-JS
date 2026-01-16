console.log('🚀 app.js v5 loaded!');

let currentItem = null;
let currentMode = null; // "edit" or "scrape" - will be set in initializeApp

// ─────────────────────────────
// Sistema Dirty Tracking
// ─────────────────────────────
let dirtyFields = new Set();

function markFieldDirty(fieldId, itemKey = null) {
  // Verifica che originalItem esista
  if (!originalItem) return;

  // If itemKey is not provided, use fieldId as fallback (backward compatibility)
  const key = itemKey || fieldId;

  const currentValue = currentItem[key];
  const originalValue = originalItem[key];

  // Confronta i valori (gestisce array e oggetti)
  const isDifferent = JSON.stringify(currentValue) !== JSON.stringify(originalValue);

  // Cerca l'elemento DOM (potrebbe non esistere per campi come "actor")
  const field = document.getElementById(fieldId);

  if (isDifferent) {
    dirtyFields.add(fieldId);
    if (field) field.classList.add('dirty');
  } else {
    dirtyFields.delete(fieldId);
    if (field) field.classList.remove('dirty');
  }

  updateSaveButton();
}

function clearDirtyFields() {
  dirtyFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field) {
      field.classList.remove('dirty');
    }
  });
  dirtyFields.clear();

  // Update save button for both modes
  updateSaveButton();
}

function updateSaveButton() {
  const saveBtn = document.getElementById('saveItem');
  const badge = document.getElementById('changesBadge');

  // Protezione: se gli elementi non esistono ancora, esci
  if (!saveBtn || !badge) return;

  const count = dirtyFields.size;

  // In scrape mode, the button is enabled if there is a loaded item (regardless of dirty fields)
  if (currentMode === "scrape") {
    if (currentItem && currentItem.id) {
      saveBtn.disabled = false;
      saveBtn.classList.add('has-changes');
      // Mostra badge solo se ci sono modifiche
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    } else {
      saveBtn.disabled = true;
      saveBtn.classList.remove('has-changes');
      badge.style.display = 'none';
    }
  } else {
    // In edit mode, the button is enabled only if there are dirty fields
    if (count > 0) {
      saveBtn.classList.add('has-changes');
      badge.textContent = count;
      badge.style.display = 'flex';
      saveBtn.disabled = false;
    } else {
      saveBtn.classList.remove('has-changes');
      badge.style.display = 'none';
      saveBtn.disabled = true;
    }
  }
}

// ─────────────────────────────
// Sistema notifiche
// ─────────────────────────────
function showNotification(message, type = "info", duration = 5000) {
  // Crea elemento notifica
  const notification = document.createElement("div");
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 100px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 4px;
    color: white;
    font-weight: bold;
    z-index: 9999;
    animation: slideIn 0.3s ease-out;
    box-shadow: 0 4px 6px rgba(0,0,0,0.2);
    white-space: pre-line;
  `;

  // Colore in base al tipo
  if (type === "success") {
    notification.style.backgroundColor = "#28a745";
  } else if (type === "error") {
    notification.style.backgroundColor = "#dc3545";
  } else {
    notification.style.backgroundColor = "#007bff";
  }

  document.body.appendChild(notification);

  // Rimuovi dopo il tempo specificato
  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease-in";
    setTimeout(() => notification.remove(), 300);
  }, duration);
}

// Carica il config
async function loadConfig() {
  const res = await fetch("/item/config");
  const data = await res.json();

  if (!data.ok) {
    alert(data.error);
    return;
  }

  document.getElementById("libraryPath").value =
    data.config.libraryPath || "";

  return data.config;
}

// Carica la configurazione per ottenere il video player path
async function getVideoPlayerPath() {
  const res = await fetch("/item/config");
  const data = await res.json();

  if (!data.ok) {
    return null;
  }

  return data.config.videoPlayerPath || null;
}

// Salva il mode nel config
async function saveModeToConfig(mode) {
  await saveConfigField('mode', mode);
}

// Salva il config (funzione helper generica)
async function saveConfigField(field, value) {
  try {
    // Carica config corrente
    const res = await fetch("/item/config");
    const data = await res.json();

    if (!data.ok) return false;

    const config = data.config;
    config[field] = value;

    // Salva config aggiornato
    const saveRes = await fetch("/item/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    });

    const saveData = await saveRes.json();
    return saveData.ok;
  } catch (err) {
    console.error(`Error saving ${field}:`, err);
    return false;
  }
}

// Backward compatibility wrapper
async function saveLibraryPath(libraryPath) {
  const success = await saveConfigField('libraryPath', libraryPath);
  if (!success) {
    alert(window.i18n ? window.i18n.t("messages.libraryPathSaveErrorAlert") : "Errore durante il salvataggio del percorso libreria");
  }
  return success;
}



// ─────────────────────────────
// Directory Browser
// ─────────────────────────────
let currentBrowserPath = "";

async function loadDirectories(path) {
  const res = await fetch(`/item/browse?path=${encodeURIComponent(path)}`);
  const data = await res.json();

  if (!data.ok) {
    alert(data.error);
    return;
  }

  currentBrowserPath = data.current;

  // Display "My Computer" if showing drives list on Windows
  if (data.current === 'DRIVES') {
    document.getElementById("dirBrowserPath").value = "💻 My Computer";
  } else {
    document.getElementById("dirBrowserPath").value = data.current;
  }

  const listEl = document.getElementById("dirBrowserList");
  listEl.innerHTML = "";

  // Add directories (or drives)
  data.directories.forEach(dir => {
    const dirDiv = document.createElement("div");
    dirDiv.style.cssText = "padding: 10px; cursor: pointer; border-bottom: 1px solid #eee;";

    // Use drive icon for drives, folder icon for regular directories
    const icon = data.current === 'DRIVES' ? '💾' : '📁';
    dirDiv.innerHTML = `${icon} ${dir.name}`;

    dirDiv.onmouseover = () => dirDiv.style.backgroundColor = "#e9ecef";
    dirDiv.onmouseout = () => dirDiv.style.backgroundColor = "transparent";
    dirDiv.onclick = () => loadDirectories(dir.path);
    listEl.appendChild(dirDiv);
  });

  if (data.directories.length === 0) {
    const emptyMsg = data.current === 'DRIVES'
      ? "No drives found"
      : "Nessuna sottocartella";
    listEl.innerHTML = `<div style='color: #999; text-align: center; padding: 20px;'>${emptyMsg}</div>`;
  }

  // Enable/disable Up button
  document.getElementById("dirBrowserUp").disabled = data.parent === null;
}

// Apri browser directory
document.getElementById("browseLibrary").onclick = async () => {
  const currentPath = document.getElementById("libraryPath").value || "/home";
  document.getElementById("dirBrowserModal").style.display = "block";
  await loadDirectories(currentPath);
};

// Naviga su
document.getElementById("dirBrowserUp").onclick = async () => {
  const res = await fetch(`/item/browse?path=${encodeURIComponent(currentBrowserPath)}`);
  const data = await res.json();
  if (data.ok && data.parent) {
    await loadDirectories(data.parent);
  }
};

// Seleziona directory e salva automaticamente
document.getElementById("dirBrowserSelect").onclick = async () => {
  const selectBtn = document.getElementById("dirBrowserSelect");
  const originalText = selectBtn.textContent;

  // Prevent selecting "DRIVES" as a path
  if (currentBrowserPath === 'DRIVES') {
    alert("Please select a drive first, not the drives list.");
    return;
  }

  // Aggiorna UI
  document.getElementById("libraryPath").value = currentBrowserPath;
  selectBtn.textContent = "⏳ Salvataggio...";
  selectBtn.disabled = true;

  // Chiudi modal
  document.getElementById("dirBrowserModal").style.display = "none";

  // Salva automaticamente
  const saved = await saveLibraryPath(currentBrowserPath);

  // Ripristina bottone
  selectBtn.textContent = originalText;
  selectBtn.disabled = false;

  if (saved) {
    // Mostra notifica di successo
    showNotification(window.i18n ? window.i18n.t("messages.pathUpdated") : "✓ Library path aggiornato e salvato", "success");

    // Ricarica il primo item della nuova libreria
    // (the server will reload the library automatically)
    setTimeout(async () => {
      if (currentMode === "scrape") {
        // In scrape mode: check availability and load first scrape item
        await checkScrapeAvailability();
        const loaded = await loadItem("/item/scrape/current");
        updateDeleteButtons(loaded);
      } else {
        // In edit mode: load first library item
        await loadItem("/item/current");
      }
    }, 500);
  } else {
    showNotification(window.i18n ? window.i18n.t("messages.pathUpdateError") : "✗ Errore nel salvataggio", "error");
  }
};

// Annulla
document.getElementById("dirBrowserCancel").onclick = () => {
  document.getElementById("dirBrowserModal").style.display = "none";
};

// Chiudi cliccando sullo sfondo
document.getElementById("dirBrowserOverlay").onclick = (e) => {
  if (e.target.id === "dirBrowserOverlay") {
    document.getElementById("dirBrowserModal").style.display = "none";
  }
};

// ─────────────────────────────
// Carica un item dal server
// ─────────────────────────────
let originalItem = null;

// ─────────────────────────────
// Mode Management
// ─────────────────────────────
async function updateStatusDisplay(elementId, count, emptyMessage, filledMessageFn, color, emptyColor = "#999") {
  const statusEl = document.getElementById(elementId);
  if (!statusEl) return;

  if (count > 0) {
    statusEl.textContent = filledMessageFn(count);
    statusEl.style.color = color;
  } else {
    statusEl.textContent = emptyMessage;
    statusEl.style.color = emptyColor;
  }
}

async function checkLibraryCount() {
  try {
    // Prima ricarica la libreria (batch iniziale)
    await fetch("/item/reload", { method: "POST" });

    // Poi conta
    const res = await fetch("/item/count");
    const data = await res.json();
    const count = data.ok ? data.count : 0;
    const status = data.status || {};

    // Mostra informazioni di progresso se la libreria non è completamente caricata
    let statusText;
    if (status.fullyLoaded) {
      statusText = `${count} NFO file${count !== 1 ? 's' : ''} nella libreria`;
    } else {
      statusText = `${count} NFO caricati (${status.progress || 0}% scansionato, ${status.totalFolders || 0} cartelle)`;
    }

    updateStatusDisplay(
      "libraryStatus",
      count,
      "Nessun NFO nella libreria",
      (c) => statusText,
      "#667eea"
    );

    // Se siamo in edit mode e count = 0, svuota l'interfaccia
    if (currentMode === "edit" && count === 0) {
      clearUI();
    }

    return count;
  } catch (err) {
    console.error("Error checking library count:", err);
    return 0;
  }
}

async function checkScrapeAvailability() {
  try {
    // Reload JSON files with retry logic
    await retryFetch(() => fetch("/item/scrape/reload", { method: "POST" }), 2, 200);

    // Get count
    const res = await fetch("/item/scrape/count");
    const data = await res.json();
    const count = data.ok ? data.count : 0;

    updateStatusDisplay(
      "scrapeStatus",
      count,
      "No items available",
      (c) => `${c} item${c > 1 ? 's' : ''} disponibili`,
      "#28a745"
    );

    // Se siamo in scrape mode e count = 0, svuota l'interfaccia
    if (currentMode === "scrape" && count === 0) {
      clearUI();
    }

    return count;
  } catch (err) {
    console.error("Error checking scrape availability:", err);
    return 0;
  }
}

async function switchMode(newMode) {
  // If the mode is already set and equal, do nothing
  if (currentMode === newMode && currentMode !== null) return;

  currentMode = newMode;

  // Salva il mode nel config.json
  await saveModeToConfig(newMode);

  // Wait a moment for server to process the config save
  await new Promise(resolve => setTimeout(resolve, 100));

  // Pulisci UI prima del cambio mode
  clearUI();

  // Aggiorna UI dei bottoni mode
  const editBtn = document.getElementById("modeEdit");
  const scrapeBtn = document.getElementById("modeScrape");
  const saveBtn = document.getElementById("saveItem");
  const scrapePanel = document.querySelector(".scraper-panel");
  const copyActorsBtn = document.getElementById("copyActorsToFolder");

  if (newMode === "edit") {
    // Edit mode
    editBtn.classList.add("active");
    scrapeBtn.classList.remove("active");

    // Disabilita il pannello scrape in edit mode
    if (scrapePanel) {
      scrapePanel.style.opacity = "0.5";
      scrapePanel.style.pointerEvents = "none";
    }

    // Show copy actors button in edit mode
    if (copyActorsBtn) {
      copyActorsBtn.style.display = "block";
    }

    // Force refresh library count before loading item
    await checkLibraryCount();

    // Try to load saved item from session, fallback to current
    const savedItemId = getSavedItemId("edit");
    let loaded = false;
    if (savedItemId) {
      loaded = await loadItem(`/item/by-id/${encodeURIComponent(savedItemId)}`);
    }
    if (!loaded) {
      await loadItem("/item/current");
    }

    // In edit mode the save button is enabled only with dirty fields
    updateSaveButton();
  } else {
    // Scrape mode
    editBtn.classList.remove("active");
    scrapeBtn.classList.add("active");

    // Abilita il pannello scrape in scrape mode
    if (scrapePanel) {
      scrapePanel.style.opacity = "1";
      scrapePanel.style.pointerEvents = "auto";
    }

    // Hide copy actors button in scrape mode
    if (copyActorsBtn) {
      copyActorsBtn.style.display = "none";
    }

    // Check scrape availability first to ensure counter is updated
    await checkScrapeAvailability();

    // Try to load saved item from session, fallback to current
    const savedItemId = getSavedItemId("scrape");
    let loaded = false;
    if (savedItemId) {
      loaded = await loadItem(`/item/scrape/by-id/${encodeURIComponent(savedItemId)}`);
    }

    // If saved item failed, try current
    if (!loaded) {
      loaded = await loadItem("/item/scrape/current");
    }

    // If first load failed, retry after short delay (for initial page load timing issues)
    if (!loaded) {
      await new Promise(resolve => setTimeout(resolve, 300));
      loaded = await loadItem("/item/scrape/current");
    }

    // Update delete buttons visibility
    updateDeleteButtons(loaded);

    // In scrape mode the save button is enabled only if there is an item
    if (saveBtn && loaded) {
      saveBtn.disabled = false;
      saveBtn.classList.add("has-changes");
    } else if (saveBtn && !loaded) {
      saveBtn.disabled = true;
      saveBtn.classList.remove("has-changes");
    }
  }
}

// Helper function to update delete buttons visibility
async function updateDeleteButtons(itemLoaded) {
  const deleteBtn = document.getElementById("deleteItem");
  const deleteAllBtn = document.getElementById("deleteAllItems");

  if (!deleteBtn || !deleteAllBtn) return;

  // Get scrape count from server instead of parsing DOM
  let scrapeCount = 0;
  try {
    const res = await fetch("/item/scrape/count");
    const data = await res.json();
    scrapeCount = data.ok ? data.count : 0;
  } catch (err) {
    console.error("Error getting scrape count:", err);
  }

  // Show deleteItem only if there is a loaded item
  deleteBtn.style.display = itemLoaded ? "block" : "none";

  // Mostra deleteAllItems solo se ci sono items disponibili
  deleteAllBtn.style.display = (scrapeCount > 0) ? "block" : "none";
}

// ─────────────────────────────
// Clear UI
// ─────────────────────────────
function clearUI() {
  // Clear all text fields (EXCEPT libraryPath which is handled separately)
  const textFields = [
    "id", "contentId", "title", "alternateTitle", "description",
    "director", "releaseDate", "runtime", "series", "maker", "label",
    "rating", "contentRating",
    "genres", "tags",
    "coverUrl", "screenshotUrl", "trailerUrl"
  ];

  textFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field) field.value = "";
  });

  // Svuota ID corrente
  const currentIdEl = document.getElementById("current-id");
  if (currentIdEl) currentIdEl.textContent = "";

  // Nascondi fanart, mostra placeholder
  const fanartImg = document.getElementById("fanartImage");
  const fanartPlaceholder = document.getElementById("fanartPlaceholder");
  if (fanartImg) {
    fanartImg.style.display = "none";
    fanartImg.src = "";
    fanartImg.onerror = null; // Rimuovi gestore errori
  }
  if (fanartPlaceholder) {
    fanartPlaceholder.style.display = "block";
  }

  // Svuota griglia attori
  const actorsGrid = document.getElementById("actors-grid");
  if (actorsGrid) {
    actorsGrid.innerHTML = "";
  }

  // Reset array attori in currentItem
  if (currentItem) {
    currentItem.actor = [];
  }

  // Clear dirty fields
  clearDirtyFields();

  // Debug JSON - svuota
  const debugJson = document.getElementById("debugJson");
  if (debugJson) {
    debugJson.textContent = "{}";
  }

  // Hide copy actors button when clearing UI
  const copyActorsBtn = document.getElementById("copyActorsToFolder");
  if (copyActorsBtn) {
    copyActorsBtn.style.display = "none";
  }
}

// ─────────────────────────────
// Retry Helper for Frontend
// ─────────────────────────────
async function retryFetch(fn, maxRetries = 2, baseDelay = 200) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, baseDelay * (attempt + 1)));
    }
  }
  throw lastError;
}

// ─────────────────────────────
// Helper functions for scrape navigation
// ─────────────────────────────
async function getNextScrapeIndex(currentFileId) {
  try {
    const res = await fetch('/item/scrape/list');
    const data = await res.json();
    if (!data.ok || !data.items) return null;

    const currentIdx = data.items.findIndex(item => item === currentFileId);
    if (currentIdx === -1) return null;

    const nextIdx = (currentIdx + 1) % data.items.length;
    return data.items[nextIdx];
  } catch (err) {
    console.error('Error getting next scrape index:', err);
    return null;
  }
}

async function getPrevScrapeIndex(currentFileId) {
  try {
    const res = await fetch('/item/scrape/list');
    const data = await res.json();
    if (!data.ok || !data.items) return null;

    const currentIdx = data.items.findIndex(item => item === currentFileId);
    if (currentIdx === -1) return null;

    const prevIdx = (currentIdx - 1 + data.items.length) % data.items.length;
    return data.items[prevIdx];
  } catch (err) {
    console.error('Error getting prev scrape index:', err);
    return null;
  }
}

// ─────────────────────────────
// Session Storage for Current Index
// ─────────────────────────────
function saveCurrentIndex(mode, itemId) {
  try {
    if (mode === "edit") {
      sessionStorage.setItem('javinizer_editModeItemId', itemId);
    } else if (mode === "scrape") {
      sessionStorage.setItem('javinizer_scrapeModeItemId', itemId);
    }
  } catch (err) {
    console.error('Error saving current index to sessionStorage:', err);
  }
}

function getSavedItemId(mode) {
  try {
    if (mode === "edit") {
      return sessionStorage.getItem('javinizer_editModeItemId');
    } else if (mode === "scrape") {
      return sessionStorage.getItem('javinizer_scrapeModeItemId');
    }
  } catch (err) {
    console.error('Error reading saved index from sessionStorage:', err);
  }
  return null;
}

// ─────────────────────────────
// Load Item
// ─────────────────────────────
async function loadItem(url) {
  try {
    // IMPORTANT: Check for unsaved changes before loading a new item
    if (dirtyFields.size > 0) {
      const confirm = window.confirm(
        "You have unsaved changes. If you continue, these changes will be lost. Do you want to continue?"
      );
      if (!confirm) {
        return false;
      }
    }

    // Use retry logic for fetching
    const res = await retryFetch(() => fetch(url), 2, 200);

    // Check if response is ok
    if (!res.ok) {
      // 404 or other HTTP errors - not a big deal, just no items available
      if (res.status !== 404) {
        console.error(`HTTP error! status: ${res.status}`);
      }
      return false;
    }

    const data = await res.json();

    if (!data.ok) {
      // Only show alert if there's a specific error message (not just "no items")
      if (data.error && !data.error.includes('No item') && !data.error.includes('nessun')) {
        alert(data.error);
      }
      return false;
    }

    // Clear dirty fields BEFORE loading new item
    clearDirtyFields();

    currentItem = data.item;

    if (currentItem === null) {
      // Svuota l'interfaccia
      clearUI();

      // In scrape mode non mostriamo alert, solo disabilitiamo il bottone
      if (currentMode === "scrape") {
        return false;
      }
      // In edit mode mostra anche un messaggio (opzionale, puoi rimuoverlo se preferisci)
      return false;
    }

    // snapshot originale
    originalItem = JSON.parse(JSON.stringify(currentItem));

    // Save current item ID in session storage
    // Use folderId for edit mode (folder name), fileId for scrape mode (JSON filename)
    const itemIdToSave = currentMode === "edit" ? currentItem.folderId : currentItem.fileId;
    if (currentItem && itemIdToSave) {
      saveCurrentIndex(currentMode, itemIdToSave);
    }

    renderItem(currentItem);
    return true;
  } catch (err) {
    // Silent failure after retries - normal if no items exist
    console.error("Error loading item:", err);
    return false;
  }
}

function getChanges(original, modified) {
  const changes = {};

  for (const key in modified) {
    const origVal = original[key];
    const modVal = modified[key];

    // Salta meta e local (gestiti dal sistema)
    if (key === "meta" || key === "local" || key === "images") {
      continue;
    }

    // Confronto array
    if (Array.isArray(modVal)) {
      const origArray = Array.isArray(origVal) ? origVal : [];
      if (JSON.stringify(origArray) !== JSON.stringify(modVal)) {
        changes[key] = modVal;
      }
      continue;
    }

    // Confronto oggetti complessi (es. rating, actor)
    if (typeof modVal === "object" && modVal !== null) {
      if (JSON.stringify(origVal) !== JSON.stringify(modVal)) {
        changes[key] = modVal;
      }
      continue;
    }

    // Confronto valori semplici
    if (modVal !== origVal) {
      changes[key] = modVal;
    }
  }

  return changes;
}


// ─────────────────────────────
// Helper per creare binding campo
// ─────────────────────────────
function bindField(fieldId, itemKey) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  el.value = currentItem[itemKey] || "";
  el.oninput = () => {
    currentItem[itemKey] = el.value;
    markFieldDirty(fieldId, itemKey); // Passa sia fieldId che itemKey
    updateDebugJson();
  };
}

function bindArrayField(fieldId, itemKey) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  const array = currentItem[itemKey] || [];
  el.value = array.join(", ");
  el.oninput = () => {
    const value = el.value.trim();
    currentItem[itemKey] = value ? value.split(",").map(s => s.trim()) : [];
    markFieldDirty(fieldId, itemKey); // Passa sia fieldId che itemKey
    updateDebugJson();
  };
}

function updateDebugJson() {
  const debugEl = document.getElementById("debug-json");
  if (debugEl) {
    debugEl.textContent = JSON.stringify(currentItem, null, 2);
  }
}

// ─────────────────────────────
// Intersection Observer for Lazy Loading
// ─────────────────────────────
let lazyLoadObserver = null;

function initLazyLoadObserver() {
  if (lazyLoadObserver) return;

  lazyLoadObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        const src = img.dataset.src;

        if (src) {
          img.src = src;
          img.removeAttribute('data-src');
          lazyLoadObserver.unobserve(img);
        }
      }
    });
  }, {
    rootMargin: '50px' // Start loading 50px before element is visible
  });
}

// ─────────────────────────────
// Gestione Actors (Grid Layout)
// ─────────────────────────────
function createActorThumbnail(thumbUrl, actorName) {
  const thumbnailDiv = document.createElement('div');
  thumbnailDiv.className = 'thumbnail';

  if (actorName) {
    // Normalize actor name to match the ID format used for files
    const normalizedActorName = normalizeActorNameForFile(actorName);

    // First, try to load from local actors cache
    const localImageUrl = `/actors/${normalizedActorName}.jpg`;

    const img = document.createElement('img');
    img.alt = actorName || 'Actor';

    // Set up error handler for when local image doesn't exist
    img.onerror = () => {
      // If local image fails, try the original thumb URL
      if (thumbUrl && thumbUrl !== localImageUrl) {
        img.src = thumbUrl;
        img.removeAttribute('data-src');
      } else {
        thumbnailDiv.innerHTML = '👤';
      }
    };

    // Use lazy loading with Intersection Observer
    img.dataset.src = localImageUrl;
    img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3C/svg%3E'; // Transparent placeholder

    // Initialize observer if needed
    initLazyLoadObserver();
    lazyLoadObserver.observe(img);

    thumbnailDiv.appendChild(img);
  } else if (thumbUrl) {
    // If no actor name but thumb URL exists, use the thumb URL with lazy loading
    const img = document.createElement('img');
    img.alt = actorName || 'Actor';
    img.dataset.src = thumbUrl;
    img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3C/svg%3E';
    img.onerror = () => { thumbnailDiv.innerHTML = '👤'; };

    initLazyLoadObserver();
    lazyLoadObserver.observe(img);

    thumbnailDiv.appendChild(img);
  } else {
    // No actor name and no thumb URL
    thumbnailDiv.innerHTML = '👤';
  }

  return thumbnailDiv;
}

// Helper function to normalize actor name for file lookup (similar to backend normalizeActorName)
function normalizeActorNameForFile(name) {
  if (!name) return '';

  // Convert to lowercase and replace spaces and special characters with hyphens
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')  // Replace special characters with spaces
    .trim()
    .replace(/\s+/g, '-');         // Replace spaces with hyphens
}

function createActorCard(actor, index) {
  const actorCard = document.createElement("div");
  actorCard.className = "actor-card";
  actorCard.dataset.actorIndex = index;

  // Crea thumbnail
  const thumbnail = createActorThumbnail(actor.thumb, actor.name);
  actorCard.appendChild(thumbnail);

  // Aggiungi nome e ruolo
  const nameDiv = document.createElement('div');
  nameDiv.className = 'name';
  // Se c'è il nome visualizza il nome
  if (actor.name) {
    nameDiv.textContent = actor.name;
  }
  // Se non c'è il nome visualizza l'alternate name
  else if (actor.altName) {
    nameDiv.textContent = actor.altName;
  }
  // Se non c'è né il nome né l'alternate name visualizza "Missing Name"
  else {
    nameDiv.textContent = window.i18n ? window.i18n.t("messages.missingName") : 'Nome mancante';
  }

  const roleDiv = document.createElement('div');
  roleDiv.className = 'role';
  roleDiv.textContent = actor.role || 'Actress';

  actorCard.appendChild(nameDiv);
  actorCard.appendChild(roleDiv);

  // Click per aprire modal di editing
  actorCard.onclick = () => editActor(index);

  return actorCard;
}

function updateActorCard(card, actor, index) {
  card.dataset.actorIndex = index;

  // Update thumbnail
  const thumbnail = card.querySelector('.thumbnail');
  if (thumbnail) {
    const newThumbnail = createActorThumbnail(actor.thumb, actor.name);
    thumbnail.replaceWith(newThumbnail);
  }

  // Update name
  const nameDiv = card.querySelector('.name');
  if (nameDiv) {
    // Se c'è il nome visualizza il nome
  if (actor.name) {
    nameDiv.textContent = actor.name;
  }
  // Se non c'è il nome visualizza l'alternate name
  else if (actor.altName) {
    nameDiv.textContent = actor.altName;
  }
  // Se non c'è né il nome né l'alternate name visualizza "Missing Name"
  else {
    nameDiv.textContent = window.i18n ? window.i18n.t("messages.missingName") : 'Nome mancante';
  }
  }

  // Update role
  const roleDiv = card.querySelector('.role');
  if (roleDiv) {
    roleDiv.textContent = actor.role || 'Actress';
  }

  // Update click handler
  card.onclick = () => editActor(index);
}

function renderActors() {
  const actorsGrid = document.getElementById("actors-grid");

  if (!currentItem.actor) {
    currentItem.actor = [];
  }

  const existingCards = Array.from(actorsGrid.children);

  // Update existing cards and create new ones
  currentItem.actor.forEach((actor, index) => {
    if (existingCards[index]) {
      // Update existing card
      updateActorCard(existingCards[index], actor, index);
    } else {
      // Create and append new card
      const newCard = createActorCard(actor, index);
      actorsGrid.appendChild(newCard);
    }
  });

  // Remove excess cards
  while (actorsGrid.children.length > currentItem.actor.length) {
    actorsGrid.removeChild(actorsGrid.lastChild);
  }
}

// ─────────────────────────────
// Actor Edit Modal - Using Unified System Only
// ─────────────────────────────

// Note: Using unified ActorModal system functions
// All actor modal functionality is handled by actor-modal.js

// Variable specific to movie context
let editingActorIndex = null;

function openActorModal(index = null) {
  // Set the modal mode to 'movie' for index.html context and use unified system
  ActorModal.setActorModalMode('movie');
  // Store the index for later use in save/remove operations
  editingActorIndex = index;
  ActorModal.openActorModal(index);

  // Update the visibility of the remove button after the modal is opened
  setTimeout(() => {
    const removeBtn = document.getElementById("actorEditRemove");
    if (removeBtn) {
      removeBtn.style.display = index === null ? "none" : "block";
    }
  }, 100); // Small delay to ensure modal is fully loaded
}

function closeActorModal() {
  // Use unified system
  ActorModal.closeActorModal();
  // Reset the local variable when closing
  editingActorIndex = null;
}

function updateActorPreview(url) {
  // Use unified system
  ActorModal.updateActorPreview(url);
}

// Funzione per editing attore
function editActor(index) {
  openActorModal(index);
}

// ─────────────────────────────
// Renderizza i dati
// ─────────────────────────────
function renderItem(item) {
  document.getElementById("current-id").textContent = item.id || "";

  // Informazioni di base
  bindField("id", "id");
  bindField("contentId", "contentId");
  bindField("title", "title");
  bindField("alternateTitle", "originalTitle"); // alternateTitle maps to originalTitle
  bindField("description", "plot"); // description maps to plot

  // Produzione
  bindField("director", "director");
  bindField("releaseDate", "releaseDate");
  bindField("runtime", "runtime");
  bindField("series", "series");
  bindField("maker", "studio"); // maker maps to studio
  bindField("label", "label");

  // Rating
  const ratingEl = document.getElementById("rating");
  if (ratingEl) {
    ratingEl.value = item.rating?.value || "";
    ratingEl.oninput = () => {
      if (!currentItem.rating) currentItem.rating = {};
      currentItem.rating.value = parseFloat(ratingEl.value) || 0;
      markFieldDirty("rating");
      updateDebugJson();
    };
  }

  bindField("contentRating", "contentRating");

  // Array
  bindArrayField("genres", "genres");
  bindArrayField("tags", "tags");

  // Media URLs
  bindField("coverUrl", "coverUrl");
  bindField("screenshotUrl", "screenshotUrl");
  bindField("trailerUrl", "trailerUrl");

  // Fanart - logica diversa per edit mode e scrape mode
  const fanartImg = document.getElementById("fanartImage");
  const fanartPlaceholder = document.getElementById("fanartPlaceholder");

  if (currentMode === "scrape") {
    // In scrape mode usa coverUrl come fanart
    if (item.coverUrl) {
      fanartImg.src = item.coverUrl;
      // Gestisci errore caricamento immagine
      fanartImg.onerror = () => {
        fanartImg.style.display = "none";
        fanartPlaceholder.style.display = "block";
      };
      fanartImg.style.display = "block";
      fanartPlaceholder.style.display = "none";
    } else {
      fanartImg.style.display = "none";
      fanartPlaceholder.style.display = "block";
    }
  } else {
    // In edit mode usa il fanart rilevato dal backend
    if (item.images && item.images.fanart && item.images.fanart.length > 0) {
      // Usa il primo fanart trovato dal backend (con pattern matching)
      const fanartPath = item.images.fanart[0];

      fanartImg.src = `/media/${encodeURIComponent(fanartPath)}`;

      // Gestisci errore caricamento immagine
      fanartImg.onerror = () => {
        // Se il file non esiste, mostra placeholder
        fanartImg.style.display = "none";
        fanartPlaceholder.style.display = "block";
      };

      fanartImg.style.display = "block";
      fanartPlaceholder.style.display = "none";
    } else {
      fanartImg.style.display = "none";
      fanartPlaceholder.style.display = "block";
    }
  }

  // Actors
  renderActors();

  // Clear dirty fields quando carichiamo un nuovo item
  clearDirtyFields();

  // Show copy actors button if in edit mode
  if (currentMode === "edit") {
    const copyActorsBtn = document.getElementById("copyActorsToFolder");
    if (copyActorsBtn) {
      copyActorsBtn.style.display = "block";
    }
  }

  // Debug JSON
  updateDebugJson();
}


// ─────────────────────────────
// Navigazione
// ─────────────────────────────
function setupEventHandlers() {
  // Mode toggle buttons
  document.getElementById("modeEdit").onclick = () => switchMode("edit");
  document.getElementById("modeScrape").onclick = () => switchMode("scrape");

  // Navigation buttons - use different routes based on the mode
  document.getElementById("next").onclick = async () => {
    if (currentMode === "edit") {
      await loadItem("/item/next");
    } else {
      // For scrape mode, pass current ID to ensure correct navigation
      if (currentItem && currentItem.fileId) {
        const nextIndex = await getNextScrapeIndex(currentItem.fileId);
        if (nextIndex !== null) {
          await loadItem(`/item/scrape/by-id/${encodeURIComponent(nextIndex)}`);
        }
      } else {
        await loadItem("/item/scrape/next");
      }
    }
  };

  document.getElementById("prev").onclick = async () => {
    if (currentMode === "edit") {
      await loadItem("/item/prev");
    } else {
      // For scrape mode, pass current ID to ensure correct navigation
      if (currentItem && currentItem.fileId) {
        const prevIndex = await getPrevScrapeIndex(currentItem.fileId);
        if (prevIndex !== null) {
          await loadItem(`/item/scrape/by-id/${encodeURIComponent(prevIndex)}`);
        }
      } else {
        await loadItem("/item/scrape/prev");
      }
    }
  };

  // Event listener per cambio lingua (gestito tramite evento custom dal navbar)
  window.addEventListener("languageChanged", () => {
    // Riapplica i bindings per aggiornare le labels
    if (window.applyI18nBindings) {
      window.applyI18nBindings();
    }

    // Ricarica l'item corrente per aggiornare eventuali testi dinamici
    if (currentItem) {
      renderItem(currentItem);
    }
  });

  // Bottone "Scrape Now!" - avvia lo scraper
  document.getElementById("scrapeNow").onclick = async () => {
    startScraping();
  };

  // Bottone "Clear Scrapers Cache" - pulisce la cache di tutti gli scraper
  document.getElementById("clearCache").onclick = async () => {
    if (!confirm("Sei sicuro di voler pulire la cache di tutti gli scraper?")) {
      return;
    }

    try {
      const res = await fetch("/item/scrape/clear-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      const data = await res.json();

      if (data.ok) {
        showNotification(data.message, "success");
      } else {
        showNotification((window.i18n ? window.i18n.t("messages.errorPrefix") : "Errore: ") + data.error, "error");
      }
    } catch (err) {
      showNotification(window.i18n ? window.i18n.t("messages.errorClearingCache") : "Errore durante la pulizia della cache", "error");
    }
  };

  // Dropdown "Re-scrape Current Movie" - permette di fare il rescrape il movie corrente con uno scraper specifico
  document.getElementById("rescrapeDropdown").onchange = async (e) => {
    const selectedScraper = e.target.value;
    if (!selectedScraper) return;

    if (currentMode !== "scrape") {
      showNotification("Re-scraping is only available in scrape mode", "error");
      e.target.value = ""; // Reset dropdown
      return;
    }

    // In scrape mode, currentItem has structure: { id, jsonPath, scrapedAt, sources, videoFile, data: {...} }
    // We can use either currentItem.id or currentItem.data.id
    const movieId = currentItem?.id || currentItem?.data?.id;

    if (!currentItem || !movieId) {
      console.error('[Re-scrape] No movie loaded. currentItem:', currentItem);
      showNotification("No movie loaded", "error");
      e.target.value = ""; // Reset dropdown
      return;
    }

    // Conferma azione
    const confirmMsg = window.i18n
      ? window.i18n.t("messages.confirmRescrape", { movieId, scraper: selectedScraper })
      : `Re-scrape "${movieId}" with ${selectedScraper}?\n\nFound fields will be replaced.\nMissing fields will be kept as they were.`;
    if (!confirm(confirmMsg)) {
      e.target.value = ""; // Reset dropdown
      return;
    }

    // Reset dropdown immediatamente
    e.target.value = "";

    // Avvia re-scraping
    await rescrapeCurrentMovie(selectedScraper, movieId);
  };

  // Bottone "Delete Item" - elimina il JSON corrente in scrape mode
  document.getElementById("deleteItem").onclick = async () => {
    if (currentMode !== "scrape") return;

    if (!confirm("Sei sicuro di voler eliminare questo item?")) {
      return;
    }

    try {
      // Send the current item ID in the request body to ensure we delete the right item
      const res = await fetch("/item/scrape/current", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: currentItem?.id })
      });

      const data = await res.json();

      if (!data.ok) {
        showNotification(window.i18n ? window.i18n.t("messages.errorDuringDeletion") : "Errore durante l'eliminazione", "error");
        return;
      }

      showNotification(window.i18n ? window.i18n.t("messages.itemDeleted") : "Item eliminato", "success");

      // Aggiorna il contatore
      await checkScrapeAvailability();

      // Carica il prossimo item disponibile
      const loaded = await loadItem("/item/scrape/current");

      // Update delete buttons visibility
      updateDeleteButtons(loaded);

    } catch (err) {
      showNotification(window.i18n ? window.i18n.t("messages.errorDuringDeletion") : "Errore durante l'eliminazione", "error");
    }
  };

  // Bottone "Delete All Items" - elimina tutti i JSON in scrape mode
  document.getElementById("deleteAllItems").onclick = async () => {
    if (currentMode !== "scrape") return;

    const scrapeStatusEl = document.getElementById("scrapeStatus");
    const statusText = scrapeStatusEl ? scrapeStatusEl.textContent : "";
    const match = statusText.match(/(\d+)\s+item/);
    const count = match ? parseInt(match[1]) : 0;
    if (count === 0) return;

    if (!confirm(`Sei sicuro di voler eliminare TUTTI i ${count} items?`)) {
      return;
    }

    try {
      const res = await fetch("/item/scrape/all", {
        method: "DELETE"
      });

      const data = await res.json();

      if (!data.ok) {
        showNotification(window.i18n ? window.i18n.t("messages.errorDuringDeletion") : "Errore durante l'eliminazione", "error");
        return;
      }

      const message = window.i18n
        ? window.i18n.t("messages.itemsDeleted", { count: data.deleted })
        : `Eliminati ${data.deleted} item`;
      showNotification(message, "success");

      // Aggiorna il contatore
      await checkScrapeAvailability();

      // Pulisci UI
      clearUI();

      // Update delete buttons visibility (no item loaded)
      updateDeleteButtons(false);

    } catch (err) {
      showNotification(window.i18n ? window.i18n.t("messages.errorDuringDeletion") : "Errore durante l'eliminazione", "error");
    }
  };

  // Salva item modificato
  document.getElementById("saveItem").onclick = async () => {
    const saveBtn = document.getElementById("saveItem");
    const saveText = document.getElementById("saveItemText");

    if (!saveText) {
      console.error("saveItemText element not found - DOM might have been replaced");
      return;
    }

    const originalText = saveText.textContent;

    // Disabilita bottone durante salvataggio
    saveBtn.disabled = true;
    saveText.textContent = window.i18n ? window.i18n.t("messages.saving") : "⏳ Salvataggio...";

    try {
      if (currentMode === "scrape") {
        // SCRAPE MODE: Salva completo (crea cartella, sposta video, genera NFO, scarica immagini)
        const res = await fetch("/item/scrape/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: currentItem.id,  // Include JSON ID to identify which item to save
            item: currentItem
          })
        });

        const data = await res.json();

        if (!data.ok) {
          showNotification(data.error, "error");
          saveBtn.disabled = false;
          saveText.textContent = originalText;
          return;
        }

        // Successo
        let message = "✓ Item salvato con successo";
        let duration = 3000; // default
        if (data.results && data.results.warnings && data.results.warnings.length > 0) {
          message += `\n\nWarnings:\n${data.results.warnings.join("\n")}`;
          duration = 6000; // Show warnings for longer
        }
        showNotification(message, "success", duration);

        // Clear dirty fields
        clearDirtyFields();

        // Carica il prossimo item in scrape mode (after deletion, current becomes next)
        setTimeout(async () => {
          const loaded = await loadItem("/item/scrape/current");

          // Re-enable save button only after loading is complete
          saveBtn.disabled = false;
          saveText.textContent = originalText;

          // Aggiorna il contatore scrape e i bottoni
          await checkScrapeAvailability();
          updateDeleteButtons(loaded);
        }, 1000);

      } else {
        // EDIT MODE: Salva solo le modifiche al NFO esistente
        // Verifica che ci siano modifiche
        if (dirtyFields.size === 0) {
          showNotification(window.i18n ? window.i18n.t("messages.noChanges") : "Nessuna modifica da salvare", "info");
          saveBtn.disabled = false;
          saveText.textContent = originalText;
          return;
        }

        const changes = getChanges(originalItem, currentItem);

        if (Object.keys(changes).length === 0) {
          showNotification(window.i18n ? window.i18n.t("messages.noChanges") : "Nessuna modifica da salvare", "info");
          saveBtn.disabled = false;
          saveText.textContent = originalText;
          return;
        }

        const res = await fetch("/item/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: currentItem.id,
            folderId: currentItem.folderId, // Folder name for finding the item
            changes
          })
        });

        const data = await res.json();

        if (!data.ok) {
          showNotification(data.error, "error");
          saveBtn.disabled = false;
          saveText.textContent = originalText;
          return;
        }

        // Successo
        showNotification(window.i18n ? window.i18n.t("messages.changesSaved") : "✓ Modifiche salvate", "success");

        // Clear dirty fields
        clearDirtyFields();

        // Update originalItem to reflect saved state (no need to reload)
        originalItem = JSON.parse(JSON.stringify(currentItem));

        // Re-enable save button
        saveBtn.disabled = false;
        saveText.textContent = originalText;
      }

    } catch (err) {
      showNotification(window.i18n ? window.i18n.t("messages.errorSaving") : "Errore durante il salvataggio", "error");
      saveBtn.disabled = false;
      saveText.textContent = originalText;
    }
  };

  // ─────────────────────────────
  // Actor Event Handlers
  // ─────────────────────────────

  // Aggiungi nuovo attore (apre modal vuoto)
  document.getElementById("addActor").onclick = () => {
    if (!currentItem.actor) {
      currentItem.actor = [];
    }
    openActorModal(null);
  };

  // Copy actors to movie folder button
  const copyActorsBtn = document.getElementById("copyActorsToFolder");
  if (copyActorsBtn) {
    copyActorsBtn.onclick = async () => {
      // Show confirmation dialog with i18n text
      const confirmText = window.i18n ? window.i18n.t("messages.confirmCopyActorsToFolder") : "Are you sure you want to copy actor thumbnails to the movie folder? This will create an 'actors' folder and copy all actor thumbnails.";
      if (confirm(confirmText)) {
        await copyActorsToMovieFolder();
      }
    };
  }

  // Play video button
  const playVideoBtn = document.getElementById("playVideo");
  if (playVideoBtn) {
    playVideoBtn.onclick = playVideo;
  }

  // Setup Actor Modal Event Listeners (when modal is loaded)
  setupActorModalEventListeners();
}

// Copy actors to movie folder functionality
async function copyActorsToMovieFolder() {
  if (!currentItem || !currentItem.actor || !currentItem.folderId) {
    showNotification(
      window.i18n ? window.i18n.t("messages.errorPrefix") + "No actors or movie folder available" : "Errore: No actors or movie folder available",
      "error"
    );
    return;
  }

  const actors = currentItem.actor;
  if (actors.length === 0) {
    showNotification(
      window.i18n ? window.i18n.t("messages.errorPrefix") + "No actors to copy" : "Errore: No actors to copy",
      "error"
    );
    return;
  }

  // Show progress notification
  const progressNotification = showNotification(
    window.i18n ? window.i18n.t("messages.copyingActors") : "Copying actors...",
    "info",
    0 // Don't auto-hide
  );

  try {
    // Call backend API to copy actors
    const response = await fetch("/item/actors/copy-to-movie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId: currentItem.folderId,
        actors: actors
      })
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || "Failed to copy actors");
    }

    // Success notification
    showNotification(
      window.i18n ? window.i18n.t("messages.actorsCopiedSuccessfully") : "✓ Actors copied successfully",
      "success"
    );
  } catch (error) {
    console.error("Error copying actors to movie folder:", error);
    showNotification(
      (window.i18n ? window.i18n.t("messages.errorPrefix") : "Error: ") + error.message,
      "error"
    );
  } finally {
    // Remove progress notification
    if (progressNotification) {
      progressNotification.remove();
    }
  }
}

// Setup event listeners for actor modal
// Called after modal is loaded (either immediately or after async load)
function setupActorModalEventListeners() {
  console.log('[setupActorModalEventListeners] Called');

  // Check if modal exists, if not wait for it
  if (!document.getElementById("actorEditModal")) {
    console.log('[setupActorModalEventListeners] Modal not found, waiting for actorModalLoaded event');
    window.addEventListener('actorModalLoaded', () => {
      setupActorModalEventListeners();
    }, { once: true });
    return;
  }

  console.log('[setupActorModalEventListeners] Modal found, setting up event listeners');

  // Event listeners per Actor Edit Modal
  document.getElementById("actorEditCancel").onclick = closeActorModal;

  // Close button
  const closeBtn = document.getElementById("actorEditModalClose");
  if (closeBtn) {
    closeBtn.onclick = closeActorModal;
  }

  // Save actor button
  document.getElementById("actorEditSave").onclick = () => {
    const name = document.getElementById("actorEditName").value;
    const altName = document.getElementById("actorEditAltName").value;
    const role = document.getElementById("actorEditRole").value || "Actress";
    const thumb = document.getElementById("actorEditThumb").value;

    // Raccogli campi estesi
    const birthdate = document.getElementById("actorEditBirthdate").value;
    const height = parseInt(document.getElementById("actorEditHeight").value) || 0;
    const bust = parseInt(document.getElementById("actorEditBust").value) || 0;
    const waist = parseInt(document.getElementById("actorEditWaist").value) || 0;
    const hips = parseInt(document.getElementById("actorEditHips").value) || 0;

    const actorData = {
      name,
      altName,
      role,
      thumb,
      birthdate,
      height,
      bust,
      waist,
      hips
    };

    // Preserva meta se esiste (per editing)
    if (editingActorIndex !== null && currentItem.actor[editingActorIndex].meta) {
      actorData.meta = currentItem.actor[editingActorIndex].meta;
    }

    if (editingActorIndex === null) {
      // Aggiungi nuovo attore
      currentItem.actor.push(actorData);
    } else {
      // Modifica attore esistente
      currentItem.actor[editingActorIndex] = actorData;
    }

    // Marca actors come modificato
    markFieldDirty("actor");

    renderActors();
    updateDebugJson();
    closeActorModal();
  };

  // Remove actor button
  document.getElementById("actorEditRemove").onclick = () => {
    if (editingActorIndex !== null) {
      const actorName = currentItem.actor[editingActorIndex].name || "questo attore";
      if (confirm(window.i18n ? window.i18n.t("messages.confirmRemoveActorPrompt", { name: actorName }) : `Rimuovere ${actorName}?`)) {
        currentItem.actor.splice(editingActorIndex, 1);

        // Marca actors come modificato
        markFieldDirty("actor");

        renderActors();
        updateDebugJson();
        closeActorModal();
      }
    }
  };

  // Chiudi modal cliccando sullo sfondo
  const modal = document.getElementById("actorEditModal");
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeActorModal();
      }
    };
  }

  // Update preview quando cambia thumb URL
  document.getElementById("actorEditThumb").oninput = (e) => {
    updateActorPreview(e.target.value);
  };

  // Search Actor button
  document.getElementById("actorEditSearch").onclick = async () => {
    const actorName = document.getElementById("actorEditName").value.trim();

    if (!actorName) {
      alert(window.i18n ? window.i18n.t("messages.enterActorNameFirstAlert") : "Inserisci il nome dell'attore prima di cercare");
      return;
    }

    const searchBtn = document.getElementById("actorEditSearch");
    const searchText = document.getElementById("actorEditSearchText");
    const searchStatus = document.getElementById("actorEditSearchStatus");

    // Disable button and show loading
    searchBtn.disabled = true;
    searchText.textContent = window.i18n ? window.i18n.t("messages.searchingActor") : "Ricerca in corso...";
    searchStatus.style.display = "block";
    searchStatus.style.color = "#666";
    searchStatus.textContent = window.i18n ? window.i18n.t("messages.searchingActorData") : "Cercando dati dell'attore...";

    try {
      const response = await fetch("/item/actors/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: actorName })
      });

      const result = await response.json();

      if (result.ok && result.actor) {
        // Fill form with actor data
        if (result.actor.name) {
          document.getElementById("actorEditName").value = result.actor.name;
        }
        if (result.actor.altName) {
          document.getElementById("actorEditAltName").value = result.actor.altName;
        }
        if (result.actor.birthdate) {
          document.getElementById("actorEditBirthdate").value = result.actor.birthdate;
        }
        if (result.actor.height && result.actor.height > 0) {
          document.getElementById("actorEditHeight").value = result.actor.height;
        }
        if (result.actor.bust && result.actor.bust > 0) {
          document.getElementById("actorEditBust").value = result.actor.bust;
        }
        if (result.actor.waist && result.actor.waist > 0) {
          document.getElementById("actorEditWaist").value = result.actor.waist;
        }
        if (result.actor.hips && result.actor.hips > 0) {
          document.getElementById("actorEditHips").value = result.actor.hips;
        }
        if (result.actor.thumb) {
          document.getElementById("actorEditThumb").value = result.actor.thumb;
          updateActorPreview(result.actor.thumb);
        }

        // Show source info
        const sourceInfo = document.getElementById("actorEditSourceInfo");
        const sourceSpan = document.getElementById("actorEditSource");
        if (result.actor.meta && result.actor.meta.sources && result.actor.meta.sources.length > 0) {
          sourceSpan.textContent = result.actor.meta.sources.join(", ");
          sourceInfo.style.display = "block";
        }

        // Success message
        searchStatus.style.color = "#28a745";
        searchStatus.textContent = "✓ Dati trovati e caricati!";

        setTimeout(() => {
          searchStatus.style.display = "none";
        }, 3000);
      } else {
        // Not found
        searchStatus.style.color = "#dc3545";
        searchStatus.textContent = result.error || (window.i18n ? window.i18n.t("messages.actorNotFound") : "Attore non trovato");

        setTimeout(() => {
          searchStatus.style.display = "none";
        }, 5000);
      }
    } catch (error) {
      console.error("Error searching actor:", error);
      searchStatus.style.color = "#dc3545";
      searchStatus.textContent = window.i18n ? window.i18n.t("messages.errorSearchingActor") : "Errore durante la ricerca";

      setTimeout(() => {
        searchStatus.style.display = "none";
      }, 5000);
    } finally {
      // Re-enable button
      searchBtn.disabled = false;
      searchText.textContent = "Cerca Attore";
    }
  };

  // Upload Image button
  const uploadBtn = document.getElementById("actorEditUploadBtn");
  console.log('[setupActorModalEventListeners] Upload button:', uploadBtn);

  if (!uploadBtn) {
    console.error('[setupActorModalEventListeners] Upload button not found!');
    return;
  }

  console.log('[setupActorModalEventListeners] Setting up upload button click handler');
  uploadBtn.onclick = async () => {
    console.log('[Upload] Button clicked!');
    const fileInput = document.getElementById("actorEditUpload");
    const uploadStatus = document.getElementById("actorEditUploadStatus");

    if (!fileInput.files || fileInput.files.length === 0) {
      uploadStatus.style.display = "block";
      uploadStatus.style.color = "#dc3545";
      uploadStatus.textContent = "Please select a file first";
      setTimeout(() => {
        uploadStatus.style.display = "none";
      }, 3000);
      return;
    }

    const file = fileInput.files[0];

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      uploadStatus.style.display = "block";
      uploadStatus.style.color = "#dc3545";
      uploadStatus.textContent = "File too large (max 5MB)";
      setTimeout(() => {
        uploadStatus.style.display = "none";
      }, 3000);
      return;
    }

    // Show uploading status
    uploadBtn.disabled = true;
    uploadStatus.style.display = "block";
    uploadStatus.style.color = "#667eea";
    uploadStatus.textContent = "Uploading...";

    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/item/actors/upload-image', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.ok && result.url) {
        // Update thumb URL field with uploaded image URL
        document.getElementById("actorEditThumb").value = result.url;

        // Update preview
        updateActorPreview(result.url);

        // Show success
        uploadStatus.style.color = "#28a745";
        uploadStatus.textContent = "✓ Image uploaded successfully!";

        // Clear file input
        fileInput.value = "";

        setTimeout(() => {
          uploadStatus.style.display = "none";
        }, 3000);
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error) {
      console.error("Error uploading image:", error);
      uploadStatus.style.color = "#dc3545";
      uploadStatus.textContent = error.message || "Upload failed";

      setTimeout(() => {
        uploadStatus.style.display = "none";
      }, 5000);
    } finally {
      uploadBtn.disabled = false;
    }
  };
}

// ─────────────────────────────
// Wait for server to be ready
// ─────────────────────────────
async function waitForServer(maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch("/item/config");
      if (res.ok) {
        return true;
      }
    } catch (err) {
      // Retry on error
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  console.error('[waitForServer] Server not ready after max retries');
  return false;
}

// ─────────────────────────────
// Inizializzazione i18n
// ─────────────────────────────
async function initializeApp() {
  // Wait for server to be ready first
  const serverReady = await waitForServer();
  if (!serverReady) {
    alert('Server not ready. Please refresh the page.');
    return;
  }

  // Setup event handlers
  setupEventHandlers();
  // Carica config per ottenere la lingua
  const configRes = await fetch("/item/config");
  const configData = await configRes.json();

  if (configData.ok) {
    const lang = configData.config.language || "en";

    // Carica traduzioni
    await window.i18n.loadLanguage(lang);

    // Imposta lingua nel selector
    document.getElementById("languageSelector").value = lang;

    // Applica traduzioni agli elementi con data-i18n
    window.i18n.applyTranslations();

    // Applica bindings alle labels e altri elementi
    if (window.applyI18nBindings) {
      window.applyI18nBindings();
    }

    // Popola campo library path PRIMA di switchMode
    const libraryPath = configData.config.libraryPath || "";
    document.getElementById("libraryPath").value = libraryPath;

    // Popola dropdown scraper per re-scraping
    if (configData.availableScrapers && configData.availableScrapers.movies) {
      populateScraperDropdown(configData.availableScrapers.movies);
    }

    // Check scrape mode availability and library BEFORE switchMode
    await checkLibraryCount();
    await checkScrapeAvailability();

    // Check if mode and item are specified in URL (from grid view)
    const urlParams = new URLSearchParams(window.location.search);
    const urlMode = urlParams.get('mode');
    const urlItem = urlParams.get('item');

    // Set initial mode from URL or config
    const initialMode = urlMode || configData.config.mode || "scrape";

    // Save mode to config if it came from URL
    if (urlMode && urlMode !== configData.config.mode) {
      await saveModeToConfig(urlMode);
    }

    await switchMode(initialMode);

    // Load specific item if provided in URL
    if (urlItem) {
      const itemEndpoint = initialMode === 'scrape'
        ? `/item/scrape/by-id/${encodeURIComponent(urlItem)}`
        : `/item/by-id/${encodeURIComponent(urlItem)}`;
      await loadItem(itemEndpoint);

      // Clean URL to remove parameters
      window.history.replaceState({}, '', '/');
    }

    // Initialize scrape panel visibility based on mode
    const scrapePanel = document.querySelector(".scraper-panel");
    if (scrapePanel) {
      if (initialMode === "edit") {
        scrapePanel.style.opacity = "0.5";
        scrapePanel.style.pointerEvents = "none";
      } else {
        scrapePanel.style.opacity = "1";
        scrapePanel.style.pointerEvents = "auto";
      }
    }
  } else {
    // Fallback se config non disponibile
    await checkLibraryCount();
    await checkScrapeAvailability();
  }

  // Polling automatico ogni 5 secondi per aggiornare entrambi i contatori
  setInterval(() => {
    checkLibraryCount();
    checkScrapeAvailability();
  }, 5000);

  // Show/hide play button based on video player path
  updatePlayButtonVisibility();
}

// ─────────────────────────────
// Update Play Button Visibility
// ─────────────────────────────

async function updatePlayButtonVisibility() {
  const videoPlayerPath = await getVideoPlayerPath();
  const playButtonContainer = document.querySelector('.play-button-container');

  if (playButtonContainer) {
    if (videoPlayerPath && videoPlayerPath.trim() !== '') {
      playButtonContainer.style.display = 'block';
    } else {
      playButtonContainer.style.display = 'none';
    }
  }
}

// ─────────────────────────────
// Play Video Functionality
// ─────────────────────────────

async function playVideo() {
  if (!currentItem || !currentItem.id) {
    showNotification("No item selected", "error");
    return;
  }

  const videoPlayerPath = await getVideoPlayerPath();
  if (!videoPlayerPath || videoPlayerPath.trim() === '') {
    showNotification("Video player path not configured", "error");
    return;
  }

  try {
    // Determine video path based on current mode
    let videoPath = null;

    if (currentMode === "scrape") {
      // In scrape mode, get videoFile from the original JSON using the item ID
      if (currentItem.id) {
        const response = await fetch(`/item/scrape/video/${encodeURIComponent(currentItem.id)}`);
        const data = await response.json();

        if (data.ok && data.videoFile) {
          videoPath = data.videoFile;
        }
      }
    } else if (currentMode === "edit") {
      // In edit mode, construct video path from library path + folder name
      const libraryPath = document.getElementById("libraryPath").value;
      if (libraryPath && currentItem.folderId) {
        // Look for video files in the movie folder
        const response = await fetch(`/item/videos/${encodeURIComponent(currentItem.folderId)}`);
        const data = await response.json();

        if (data.ok && data.videos && data.videos.length > 0) {
          // Use the first video file found
          videoPath = data.videos[0];
        }
      }
    }

    if (!videoPath) {
      showNotification("Video file not found", "error");
      return;
    }

    // Send request to server to play the video
    const response = await fetch('/item/play-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath: videoPath,
        videoPlayerPath: videoPlayerPath
      })
    });

    const result = await response.json();

    if (result.ok) {
      showNotification("Playing video...", "success");
    } else {
      showNotification(result.error || "Failed to play video", "error");
    }
  } catch (error) {
    console.error("Error playing video:", error);
    showNotification("Error playing video: " + error.message, "error");
  }
}

// ─────────────────────────────
// Scraping Functions
// ─────────────────────────────

/**
 * Popola il dropdown con gli scraper disponibili
 */
function populateScraperDropdown(scrapers) {
  const dropdown = document.getElementById("rescrapeDropdown");
  if (!dropdown) return;

  // Clear existing options except the first one (placeholder)
  while (dropdown.options.length > 1) {
    dropdown.remove(1);
  }

  // Add scrapers as options
  scrapers.forEach(scraper => {
    const option = document.createElement("option");
    option.value = scraper;
    option.textContent = scraper;
    dropdown.appendChild(option);
  });
}

/**
 * Re-scrape current movie with selected scraper
 */
async function rescrapeCurrentMovie(scraperName, movieId) {
  const modal = document.getElementById('scrapingModal');
  const progressDiv = document.getElementById('scrapingProgress');
  const closeBtn = document.getElementById('scrapingClose');

  // Show modal
  modal.style.display = 'block';
  progressDiv.innerHTML = `<div style="color: #667eea;">🔍 Re-scraping with ${scraperName}...</div>`;
  closeBtn.style.display = 'none';

  try {
    // Connect to WebSocket if not already connected
    if (!scrapingWebSocket || scrapingWebSocket.readyState !== WebSocket.OPEN) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      scrapingWebSocket = new WebSocket(wsUrl);

      // Wait for connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
        scrapingWebSocket.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        scrapingWebSocket.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        };
      });
    }

    // Set up message handler
    scrapingWebSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const { event: eventType, data } = message;

        handleScrapingEvent(progressDiv, closeBtn, eventType, data);
      } catch (error) {
        console.error('[WebSocket] Error parsing message:', error);
      }
    };

    // Start re-scraping via HTTP POST
    const response = await fetch('/item/scrape/rescrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        movieId: movieId,
        scraper: scraperName
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || 'Failed to start re-scraping');
    }

    appendProgress(progressDiv, `✅ Re-scraping started with ${scraperName}`, 'success');

  } catch (error) {
    console.error('[Re-scraping] Error:', error);
    appendProgress(progressDiv, `❌ Error: ${error.message}`, 'error');
    closeBtn.style.display = 'block';
  }

  // Close button handler
  closeBtn.onclick = () => {
    modal.style.display = 'none';
  };
}

/**
 * WebSocket connection for scraping
 */
let scrapingWebSocket = null;

/**
 * Start scraping process with real-time feedback via WebSocket
 */
async function startScraping() {
  const modal = document.getElementById('scrapingModal');
  const progressDiv = document.getElementById('scrapingProgress');
  const closeBtn = document.getElementById('scrapingClose');

  // Show modal
  modal.style.display = 'block';
  progressDiv.innerHTML = '<div style="color: #667eea;">🚀 Starting scraping...</div>';
  closeBtn.style.display = 'none';

  try {
    // Connect to WebSocket if not already connected
    if (!scrapingWebSocket || scrapingWebSocket.readyState !== WebSocket.OPEN) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      scrapingWebSocket = new WebSocket(wsUrl);

      scrapingWebSocket.onopen = () => {
        console.log('[WebSocket] Connected');
      };

      scrapingWebSocket.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        appendProgress(progressDiv, '❌ WebSocket connection error', 'error');
        closeBtn.style.display = 'block';
      };

      scrapingWebSocket.onclose = () => {
        console.log('[WebSocket] Disconnected');
      };

      // Wait for connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
        scrapingWebSocket.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        scrapingWebSocket.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        };
      });
    }

    // Set up message handler
    scrapingWebSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const { event: eventType, data } = message;

        handleScrapingEvent(progressDiv, closeBtn, eventType, data);
      } catch (error) {
        console.error('[WebSocket] Error parsing message:', error);
      }
    };

    // Start scraping via HTTP POST
    const response = await fetch('/item/scrape/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || 'Failed to start scraping');
    }

    appendProgress(progressDiv, `✅ ${result.message}`, 'info');

  } catch (error) {
    appendProgress(progressDiv, '❌ Error: ' + error.message, 'error');
    closeBtn.style.display = 'block';
  }

  // Close button handler
  closeBtn.onclick = () => {
    modal.style.display = 'none';
  };
}

/**
 * Handle scraping event
 */
async function handleScrapingEvent(progressDiv, closeBtn, eventType, data) {
  switch (eventType) {
    case 'start':
      appendProgress(progressDiv, data.message, 'info');
      break;

    case 'progress':
      // Identify scraper type and apply appropriate color
      let type = 'progress';
      let message = data.message;

      if (message.includes('Executing scraper')) {
        type = 'executing';
      } else if (message.includes('[r18dev]')) {
        type = 'r18dev';
        // Replace [r18dev] with colored version
        message = message.replace('[r18dev]', '[R18.dev]');
      } else if (message.includes('[browser]')) {
        type = 'javlibrary';
        // Replace [browser] with [JavLibrary]
        message = message.replace('[browser]', '[JavLibrary]');
      } else if (message.includes('[actor-scraper]') || message.includes('actor')) {
        type = 'actor';
        message = message.replace('[actor-scraper]', '[Actor Scraper]');
      }

      appendProgress(progressDiv, message, type);
      break;

    case 'scraperError':
      // Show scraper error and ask user if they want to continue
      const errorMsg = `❌ Scraper "${data.scraperName}" failed: ${data.message}`;
      appendProgress(progressDiv, errorMsg, 'error');

      // Ask user if they want to continue with next scraper
      const continueNext = await showConfirmDialog(
        'Scraper Error',
        `Scraper "${data.scraperName}" failed.\n\nError: ${data.message}\n\nDo you want to continue with the next scraper?`,
        'Continue',
        'Stop',
        true  // destructiveCancel = true per rendere "Stop" rosso
      );

      // Send response back via WebSocket
      if (scrapingWebSocket && scrapingWebSocket.readyState === WebSocket.OPEN) {
        scrapingWebSocket.send(JSON.stringify({
          type: 'scraperErrorResponse',
          continue: continueNext
        }));
      }

      if (!continueNext) {
        appendProgress(progressDiv, '⚠️ Scraping stopped by user', 'info');
        closeBtn.style.display = 'block';
      }
      break;

    case 'complete':
      appendProgress(progressDiv, '✅ ' + data.message, 'success');

      // Show Close button - complete is only sent when ALL scraping is done
      closeBtn.style.display = 'block';

      // If this was a re-scrape of a specific movie, reload it
      if (data.movieId) {
        // Reload the same movie to show updated data
        console.log('[complete] Reloading specific movie:', data.movieId);
        await loadItem(`/item/scrape/by-id/${data.movieId}`);
        appendProgress(progressDiv, `🔄 Reloaded ${data.movieId} with updated data`, 'info');
      } else {
        // Auto-reload scrape items dopo completamento batch scraping
        checkScrapeAvailability().then(async () => {
          // Se ci sono items, carica il primo
          const scrapeStatusEl = document.getElementById("scrapeStatus");
          const statusText = scrapeStatusEl ? scrapeStatusEl.textContent : "";
          const match = statusText.match(/(\d+)\s+item/);
          const scrapeCount = match ? parseInt(match[1]) : 0;

          if (scrapeCount > 0) {
            const loaded = await loadItem("/item/scrape/current");
            updateDeleteButtons(loaded);
          }
        });
      }
      break;

    case 'error':
      appendProgress(progressDiv, '❌ ' + data.message, 'error');
      closeBtn.style.display = 'block';
      break;

    case 'actorsUpdated':
      // Actors have been updated, reload current item to show new actor data
      console.log('[actorsUpdated] currentItem.id:', currentItem?.id);
      console.log('[actorsUpdated] currentItem.fileId:', currentItem?.fileId);
      console.log('[actorsUpdated] currentItem.folderId:', currentItem?.folderId);
      console.log('[actorsUpdated] currentMode:', currentMode);

      if (currentItem && currentItem.fileId && currentMode === 'scrape') {
        // Reload the specific item by its fileId to maintain navigation position
        console.log('[actorsUpdated] Reloading item by fileId:', currentItem.fileId);
        loadItem(`/item/scrape/${currentItem.fileId}`);
      } else if (currentItem && currentItem.folderId && currentMode === 'edit') {
        // Edit mode uses folderId
        console.log('[actorsUpdated] Reloading item by folderId:', currentItem.folderId);
        loadItem(`/item/edit/${currentItem.folderId}`);
      } else {
        // Fallback to current if ID is not available
        console.log('[actorsUpdated] Fallback to current');
        const currentUrl = window.location.hash || '/item/scrape/current';
        const itemUrl = currentUrl.startsWith('#') ? currentUrl.substring(1) : currentUrl;
        loadItem(itemUrl);
      }
      // Note: Close button will be shown by subsequent 'complete' event
      break;

    case 'prompt':
      // Interactive prompt from scraper
      // Check if message is an i18n key or plain text
      const translatedMessage = window.i18n && window.i18n.t(`messages.${data.message}`) !== `messages.${data.message}`
        ? window.i18n.t(`messages.${data.message}`)
        : data.message;

      const promptMsg = `⏸️ ${data.scraperName}: ${translatedMessage}`;
      appendProgress(progressDiv, promptMsg, 'prompt');

      // Translate dialog title and buttons if available
      const dialogTitle = window.i18n
        ? window.i18n.t('messages.actionRequired')
        : 'User Action Required';
      const continueBtn = window.i18n ? window.i18n.t('buttons.continue') : 'Continue';
      const cancelBtn = window.i18n ? window.i18n.t('buttons.cancel') : 'Cancel';

      // Show confirm dialog
      const userResponse = await showConfirmDialog(
        dialogTitle,
        translatedMessage,
        continueBtn,
        cancelBtn
      );

      // Send response back via WebSocket
      if (scrapingWebSocket && scrapingWebSocket.readyState === WebSocket.OPEN) {
        scrapingWebSocket.send(JSON.stringify({
          type: 'promptResponse',
          promptId: data.promptId,
          response: userResponse
        }));
      }

      if (userResponse) {
        appendProgress(progressDiv, '✅ User confirmed - continuing...', 'success');
      } else {
        appendProgress(progressDiv, '⚠️ User canceled', 'info');
      }
      break;
  }
}

/**
 * Show a confirm dialog (interactive prompt)
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 * @param {string} confirmText - Confirm button text (default: 'OK')
 * @param {string} cancelText - Cancel button text (default: 'Cancel')
 * @param {boolean} destructiveCancel - If true, makes cancel button red (for destructive actions)
 * @returns {Promise<boolean>} - True if confirmed, false if canceled
 */
function showConfirmDialog(title, message, confirmText = 'OK', cancelText = 'Cancel', destructiveCancel = false) {
  return new Promise((resolve) => {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 3000;
    `;

    // Create dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 24px;
      max-width: 500px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    `;

    // Title
    const titleEl = document.createElement('h3');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      margin: 0 0 16px 0;
      color: #333;
      font-size: 20px;
    `;

    // Message
    const messageEl = document.createElement('p');
    messageEl.textContent = message;
    messageEl.style.cssText = `
      margin: 0 0 24px 0;
      color: #666;
      line-height: 1.5;
      white-space: pre-line;
    `;

    // Buttons container
    const buttonsEl = document.createElement('div');
    buttonsEl.style.cssText = `
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    `;

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = cancelText;
    const cancelBtnBg = destructiveCancel ? '#dc3545' : 'white';
    const cancelBtnColor = destructiveCancel ? 'white' : '#333';
    const cancelBtnBorder = destructiveCancel ? 'none' : '1px solid #ddd';
    cancelBtn.style.cssText = `
      padding: 10px 20px;
      border: ${cancelBtnBorder};
      background: ${cancelBtnBg};
      color: ${cancelBtnColor};
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    `;
    cancelBtn.onclick = () => {
      document.body.removeChild(overlay);
      resolve(false);
    };

    // Confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = confirmText;
    confirmBtn.style.cssText = `
      padding: 10px 20px;
      border: none;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    `;
    confirmBtn.onclick = () => {
      document.body.removeChild(overlay);
      resolve(true);
    };

    // Assemble dialog
    buttonsEl.appendChild(cancelBtn);
    buttonsEl.appendChild(confirmBtn);
    dialog.appendChild(titleEl);
    dialog.appendChild(messageEl);
    dialog.appendChild(buttonsEl);
    overlay.appendChild(dialog);

    // Show dialog
    document.body.appendChild(overlay);
  });
}

/**
 * Append progress message to the progress div
 */
function appendProgress(div, message, type) {
  const colors = {
    info: '#667eea',
    progress: '#333',
    executing: '#dc3545',     // Red for "Executing scraper"
    r18dev: '#9333ea',        // Purple for R18.dev
    javlibrary: '#0ea5e9',    // Sky blue for JavLibrary
    actor: '#f59e0b',         // Amber for Actor scraper
    success: '#28a745',
    error: '#dc3545',
    prompt: '#ff9800'         // Orange for interactive prompts
  };

  const line = document.createElement('div');
  line.style.color = colors[type] || '#333';
  line.style.marginBottom = '4px';

  // Bold for executing, prompt, and scraper-specific messages
  const isBold = ['executing', 'prompt', 'r18dev', 'javlibrary', 'actor'].includes(type);
  line.style.fontWeight = isBold ? 'bold' : 'normal';

  line.textContent = message;

  div.appendChild(line);

  // Auto-scroll to bottom
  div.scrollTop = div.scrollHeight;
}

// ─────────────────────────────
// Primo caricamento
// ─────────────────────────────
document.addEventListener('DOMContentLoaded', initializeApp);
