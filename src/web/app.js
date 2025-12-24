let currentItem = null;
let currentMode = "edit"; // "edit" or "scrape"

// ─────────────────────────────
// Sistema Dirty Tracking
// ─────────────────────────────
let dirtyFields = new Set();

function markFieldDirty(fieldId, itemKey = null) {
  // Verifica che originalItem esista
  if (!originalItem) return;

  // Se itemKey non è fornito, usa fieldId come fallback (retrocompatibilità)
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

  // In scrape mode il bottone rimane sempre abilitato
  if (currentMode === "scrape") {
    const saveBtn = document.getElementById("saveItem");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.add("has-changes");
    }
  } else {
    updateSaveButton();
  }
}

function updateSaveButton() {
  const saveBtn = document.getElementById('saveItem');
  const badge = document.getElementById('changesBadge');

  // Protezione: se gli elementi non esistono ancora, esci
  if (!saveBtn || !badge) return;

  const count = dirtyFields.size;

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

// ─────────────────────────────
// Sistema notifiche
// ─────────────────────────────
function showNotification(message, type = "info", duration = 5000) {
  // Crea elemento notifica
  const notification = document.createElement("div");
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 4px;
    color: white;
    font-weight: bold;
    z-index: 2000;
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
}

// Salva il config (funzione helper)
async function saveLibraryPath(libraryPath) {
  const res = await fetch("/item/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryPath })
  });

  const data = await res.json();

  if (!data.ok) {
    alert("Errore: " + data.error);
    return false;
  }

  return true;
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
  document.getElementById("dirBrowserPath").value = data.current;

  const listEl = document.getElementById("dirBrowserList");
  listEl.innerHTML = "";

  // Aggiungi directory
  data.directories.forEach(dir => {
    const dirDiv = document.createElement("div");
    dirDiv.style.cssText = "padding: 10px; cursor: pointer; border-bottom: 1px solid #eee;";
    dirDiv.innerHTML = `📁 ${dir.name}`;
    dirDiv.onmouseover = () => dirDiv.style.backgroundColor = "#e9ecef";
    dirDiv.onmouseout = () => dirDiv.style.backgroundColor = "transparent";
    dirDiv.onclick = () => loadDirectories(dir.path);
    listEl.appendChild(dirDiv);
  });

  if (data.directories.length === 0) {
    listEl.innerHTML = "<div style='color: #999; text-align: center; padding: 20px;'>Nessuna sottocartella</div>";
  }

  // Abilita/disabilita bottone Su
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
    showNotification("✓ Library path aggiornato e salvato", "success");

    // Ricarica il primo item della nuova libreria
    // (il server si occuperà di ricaricare la libreria automaticamente)
    setTimeout(() => {
      loadItem("/item/current");
    }, 500);
  } else {
    showNotification("✗ Errore nel salvataggio", "error");
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
async function checkLibraryCount() {
  try {
    // Prima ricarica la libreria
    await fetch("/item/reload", { method: "POST" });

    // Poi conta
    const res = await fetch("/item/count");
    const data = await res.json();

    const libraryStatus = document.getElementById("libraryStatus");
    const count = data.ok ? data.count : 0;

    if (libraryStatus) {
      if (count > 0) {
        libraryStatus.textContent = `${count} NFO file${count > 1 ? 's' : ''} nella libreria`;
        libraryStatus.style.color = "#667eea";
      } else {
        libraryStatus.textContent = "Nessun NFO nella libreria";
        libraryStatus.style.color = "#999";
      }
    }

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
    // Prima ricarica i file JSON
    await fetch("/item/scrape/reload", { method: "POST" });

    // Poi conta
    const res = await fetch("/item/scrape/count");
    const data = await res.json();

    const scrapeStatus = document.getElementById("scrapeStatus");
    const count = data.ok ? data.count : 0;

    if (scrapeStatus) {
      if (count > 0) {
        scrapeStatus.textContent = `${count} item${count > 1 ? 's' : ''} disponibili`;
        scrapeStatus.style.color = "#28a745";
      } else {
        scrapeStatus.textContent = "No items available";
        scrapeStatus.style.color = "#999";
      }
    }

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
  if (currentMode === newMode) return;

  currentMode = newMode;

  // Pulisci UI prima del cambio mode
  clearUI();

  // Aggiorna UI dei bottoni
  const editBtn = document.getElementById("modeEdit");
  const scrapeBtn = document.getElementById("modeScrape");
  const saveBtn = document.getElementById("saveItem");
  const deleteBtn = document.getElementById("deleteItem");

  if (newMode === "edit") {
    editBtn.classList.add("active");
    scrapeBtn.classList.remove("active");
    // Nascondi bottone delete in edit mode
    if (deleteBtn) deleteBtn.style.display = "none";
    await loadItemForMode("/item/current");
    // In edit mode il bottone salva è abilitato solo con dirty fields
    updateSaveButton();
  } else {
    editBtn.classList.remove("active");
    scrapeBtn.classList.add("active");
    const loaded = await loadItemForMode("/item/scrape/current");
    // In scrape mode mostra il bottone delete solo se c'è un item
    if (deleteBtn) {
      deleteBtn.style.display = loaded ? "block" : "none";
    }
    // In scrape mode il bottone salva è abilitato solo se c'è un item
    if (saveBtn && loaded) {
      saveBtn.disabled = false;
      saveBtn.classList.add("has-changes");
    } else if (saveBtn && !loaded) {
      saveBtn.disabled = true;
      saveBtn.classList.remove("has-changes");
    }
  }
}

async function loadItemForMode(url) {
  return await loadItem(url);
}

// ─────────────────────────────
// Clear UI
// ─────────────────────────────
function clearUI() {
  // Svuota tutti i campi di testo
  const textFields = [
    "id", "title", "alternateTitle", "description",
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

  // Svuota lista attori
  const actorsList = document.getElementById("actorsList");
  if (actorsList) {
    actorsList.innerHTML = "";
  }

  // Clear dirty fields
  clearDirtyFields();

  // Debug JSON - svuota
  const debugJson = document.getElementById("debugJson");
  if (debugJson) {
    debugJson.textContent = "{}";
  }
}

// ─────────────────────────────
// Load Item
// ─────────────────────────────
async function loadItem(url) {
  const res = await fetch(url);
  const data = await res.json();

  if (!data.ok) {
    alert(data.error);
    return false;
  }

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

  renderItem(currentItem);
  return true;
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
// Gestione Actors (Grid Layout)
// ─────────────────────────────
function renderActors() {
  const actorsGrid = document.getElementById("actors-grid");
  actorsGrid.innerHTML = "";

  if (!currentItem.actor) {
    currentItem.actor = [];
  }

  currentItem.actor.forEach((actor, index) => {
    const actorCard = document.createElement("div");
    actorCard.className = "actor-card";

    const thumbUrl = actor.thumb || "";
    const hasThumb = thumbUrl !== "";

    // Creazione della card con immagine
    actorCard.innerHTML = `
      <div class="thumbnail"></div>
      <div class="name">${actor.name || 'Nome mancante'}</div>
      <div class="role">${actor.role || 'Actress'}</div>
    `;

    // Aggiungi l'immagine con gestione dell'errore
    const thumbnailDiv = actorCard.querySelector('.thumbnail');
    if (hasThumb) {
      const img = document.createElement('img');
      img.src = thumbUrl;
      img.alt = actor.name || 'Actor';

      // Gestisci errore caricamento immagine
      img.onerror = () => {
        thumbnailDiv.innerHTML = '👤';
      };

      thumbnailDiv.appendChild(img);
    } else {
      thumbnailDiv.innerHTML = '👤';
    }

    // Click per aprire modal di editing
    actorCard.onclick = () => {
      editActor(index);
    };

    actorsGrid.appendChild(actorCard);
  });
}

// ─────────────────────────────
// Actor Edit Modal
// ─────────────────────────────
let editingActorIndex = null;

function openActorModal(index = null) {
  editingActorIndex = index;
  const modal = document.getElementById("actorEditModal");
  const modalTitle = document.querySelector("#actorEditContent h2");
  const removeBtn = document.getElementById("actorEditRemove");
  const previewDiv = document.getElementById("actorEditPreview");

  // Se index è null, stiamo aggiungendo un nuovo attore
  if (index === null) {
    // Cambia titolo del modal
    modalTitle.textContent = window.i18n ? window.i18n.t("actorModal.titleAdd") : "Aggiungi Attore";

    document.getElementById("actorEditName").value = "";
    document.getElementById("actorEditAltName").value = "";
    document.getElementById("actorEditRole").value = "Actress";
    document.getElementById("actorEditThumb").value = "";
    removeBtn.style.display = "none";
    previewDiv.style.display = "none";
  } else {
    // Stiamo editando un attore esistente
    // Cambia titolo del modal
    modalTitle.textContent = window.i18n ? window.i18n.t("actorModal.title") : "Modifica Attore";

    const actor = currentItem.actor[index];
    document.getElementById("actorEditName").value = actor.name || "";
    document.getElementById("actorEditAltName").value = actor.altName || "";
    document.getElementById("actorEditRole").value = actor.role || "Actress";
    document.getElementById("actorEditThumb").value = actor.thumb || "";
    removeBtn.style.display = "block";

    // Mostra preview se c'è un'immagine
    if (actor.thumb) {
      updateActorPreview(actor.thumb);
    } else {
      previewDiv.style.display = "none";
    }
  }

  modal.style.display = "block";
}

function closeActorModal() {
  document.getElementById("actorEditModal").style.display = "none";
  editingActorIndex = null;
}

function updateActorPreview(url) {
  const previewDiv = document.getElementById("actorEditPreview");
  const previewImg = document.getElementById("actorEditPreviewImg");
  const placeholder = document.getElementById("actorEditPreviewPlaceholder");

  // Protezione: verifica che gli elementi esistano
  if (!previewDiv || !previewImg || !placeholder) {
    console.warn("Preview elements not found in DOM");
    return;
  }

  if (url && url.trim() !== "") {
    previewDiv.style.display = "block";
    previewImg.src = url;
    previewImg.style.display = "block";
    placeholder.style.display = "none";

    // Gestisci errore caricamento immagine
    previewImg.onerror = () => {
      previewImg.style.display = "none";
      placeholder.style.display = "block";
    };
  } else {
    previewDiv.style.display = "none";
  }
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
    // In edit mode usa fanart.jpg dalla stessa cartella del .nfo
    if (item.local && item.local.path) {
      // Cerca fanart.jpg nella stessa cartella del .nfo
      const fanartPath = `${item.local.path}/fanart.jpg`;

      fanartImg.src = `/media/${encodeURIComponent(fanartPath)}`;

      // Gestisci errore caricamento immagine
      fanartImg.onerror = () => {
        // Se fanart.jpg non esiste, mostra placeholder
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

  // Navigation buttons - usano route diverse in base alla modalità
  document.getElementById("next").onclick = () => {
    const url = currentMode === "edit" ? "/item/next" : "/item/scrape/next";
    loadItem(url);
  };

  document.getElementById("prev").onclick = () => {
    const url = currentMode === "edit" ? "/item/prev" : "/item/scrape/prev";
    loadItem(url);
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
        showNotification("Errore: " + data.error, "error");
      }
    } catch (err) {
      showNotification("Errore durante la pulizia della cache", "error");
    }
  };

  // Bottone "Delete Item" - elimina il JSON corrente in scrape mode
  document.getElementById("deleteItem").onclick = async () => {
    if (currentMode !== "scrape") return;

    if (!confirm("Sei sicuro di voler eliminare questo item?")) {
      return;
    }

    try {
      const res = await fetch("/item/scrape/current", {
        method: "DELETE"
      });

      const data = await res.json();

      if (!data.ok) {
        showNotification("Errore durante l'eliminazione", "error");
        return;
      }

      showNotification("Item eliminato", "success");

      // Aggiorna il contatore
      await checkScrapeAvailability();

      // Carica il prossimo item disponibile
      const deleteBtn = document.getElementById("deleteItem");
      const loaded = await loadItem("/item/scrape/current");

      // Mostra/nascondi bottone delete in base alla disponibilità
      if (deleteBtn) {
        deleteBtn.style.display = loaded ? "block" : "none";
      }

    } catch (err) {
      showNotification("Errore durante l'eliminazione", "error");
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
          body: JSON.stringify({ item: currentItem })
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
          duration = 6000; // Mostra i warning più a lungo
        }
        showNotification(message, "success", duration);

        // Clear dirty fields
        clearDirtyFields();

        // Carica il prossimo item in scrape mode
        setTimeout(() => {
          loadItem("/item/scrape/current");
          saveText.textContent = originalText;
          // Aggiorna il contatore scrape
          checkScrapeAvailability();
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
          body: JSON.stringify({ changes })
        });

        const data = await res.json();

        if (!data.ok) {
          showNotification(data.error, "error");
          saveBtn.disabled = false;
          saveText.textContent = originalText;
          return;
        }

        // Successo
        showNotification(window.i18n ? window.i18n.t("messages.saved") : "✓ Modifiche salvate", "success");

        // Clear dirty fields
        clearDirtyFields();

        // Ricarica item aggiornato per sincronizzare con server
        setTimeout(() => {
          loadItem("/item/current");
          saveText.textContent = originalText;
        }, 500);
      }

    } catch (err) {
      showNotification("Errore durante il salvataggio", "error");
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

  // Event listeners per Actor Edit Modal
  document.getElementById("actorEditCancel").onclick = closeActorModal;

  document.getElementById("actorEditSave").onclick = () => {
    const name = document.getElementById("actorEditName").value;
    const altName = document.getElementById("actorEditAltName").value;
    const role = document.getElementById("actorEditRole").value || "Actress";
    const thumb = document.getElementById("actorEditThumb").value;

    const actorData = { name, altName, role, thumb };

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

  document.getElementById("actorEditRemove").onclick = () => {
    if (editingActorIndex !== null) {
      const actorName = currentItem.actor[editingActorIndex].name || "questo attore";
      if (confirm(`Rimuovere ${actorName}?`)) {
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
  document.getElementById("actorEditOverlay").onclick = (e) => {
    if (e.target.id === "actorEditOverlay") {
      closeActorModal();
    }
  };

  // Update preview quando cambia thumb URL
  document.getElementById("actorEditThumb").oninput = (e) => {
    updateActorPreview(e.target.value);
  };
}

// ─────────────────────────────
// Inizializzazione i18n
// ─────────────────────────────
async function initializeApp() {
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

    // Popola campo library path
    document.getElementById("libraryPath").value = configData.config.libraryPath || "";
  }

  // Verifica disponibilità modalità scrape e libreria
  checkLibraryCount();
  checkScrapeAvailability();

  // Polling automatico ogni 5 secondi per aggiornare entrambi i contatori
  setInterval(() => {
    checkLibraryCount();
    checkScrapeAvailability();
  }, 5000);

  // Carica primo item
  loadItem("/item/current");
}

// ─────────────────────────────
// Scraping Functions
// ─────────────────────────────

/**
 * Start scraping process with real-time feedback
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
    // Fetch with streaming
    const response = await fetch('/item/scrape/start', {
      method: 'POST',
      headers: {
        'Accept': 'text/event-stream'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Read stream
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Decode chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete events in buffer
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // Keep incomplete event in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        // Parse SSE event
        const eventMatch = line.match(/^event: (\w+)\ndata: (.+)$/s);
        if (eventMatch) {
          const [, eventType, dataStr] = eventMatch;
          const data = JSON.parse(dataStr);

          handleScrapingEvent(progressDiv, closeBtn, eventType, data);
        }
      }
    }

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
function handleScrapingEvent(progressDiv, closeBtn, eventType, data) {
  switch (eventType) {
    case 'start':
      appendProgress(progressDiv, data.message, 'info');
      break;

    case 'progress':
      // Highlight "Executing scraper" in red
      const type = data.message.includes('Executing scraper') ? 'executing' : 'progress';
      appendProgress(progressDiv, data.message, type);
      break;

    case 'complete':
      appendProgress(progressDiv, '✅ ' + data.message, 'success');
      closeBtn.style.display = 'block';
      break;

    case 'error':
      appendProgress(progressDiv, '❌ ' + data.message, 'error');
      closeBtn.style.display = 'block';
      break;
  }
}

/**
 * Append progress message to the progress div
 */
function appendProgress(div, message, type) {
  const colors = {
    info: '#667eea',
    progress: '#333',
    executing: '#dc3545',  // Red for "Executing scraper"
    success: '#28a745',
    error: '#dc3545'
  };

  const line = document.createElement('div');
  line.style.color = colors[type] || '#333';
  line.style.marginBottom = '4px';
  line.style.fontWeight = type === 'executing' ? 'bold' : 'normal';
  line.textContent = message;

  div.appendChild(line);

  // Auto-scroll to bottom
  div.scrollTop = div.scrollHeight;
}

// ─────────────────────────────
// Primo caricamento
// ─────────────────────────────
document.addEventListener('DOMContentLoaded', initializeApp);
