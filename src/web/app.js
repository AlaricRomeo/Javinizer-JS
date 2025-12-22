let currentItem = null;

// ─────────────────────────────
// Sistema Dirty Tracking
// ─────────────────────────────
let dirtyFields = new Set();

function markFieldDirty(fieldId) {
  dirtyFields.add(fieldId);
  const field = document.getElementById(fieldId);
  if (field) {
    field.classList.add('dirty');
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
  updateSaveButton();
}

function updateSaveButton() {
  const saveBtn = document.getElementById('saveItem');
  const badge = document.getElementById('changesBadge');
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
function showNotification(message, type = "info") {
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

  // Rimuovi dopo 3 secondi
  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease-in";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
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

async function loadItem(url) {
  const res = await fetch(url);
  const data = await res.json();

  if (!data.ok) {
    alert(data.error);
    return;
  }

  currentItem = data.item;

  if (currentItem === null) {
    alert("Nessun item disponibile");
    return;
  }

  // snapshot originale
  originalItem = JSON.parse(JSON.stringify(currentItem));

  renderItem(currentItem);
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
    markFieldDirty(fieldId);
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
    markFieldDirty(fieldId);
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

    actorCard.innerHTML = `
      <div class="thumbnail">
        ${hasThumb ? `<img src="${thumbUrl}" alt="${actor.name || 'Actor'}">` : '👤'}
      </div>
      <div class="name">${actor.name || 'Nome mancante'}</div>
      <div class="role">${actor.role || 'Actress'}</div>
    `;

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
  const removeBtn = document.getElementById("actorEditRemove");
  const previewDiv = document.getElementById("actorEditPreview");

  // Se index è null, stiamo aggiungendo un nuovo attore
  if (index === null) {
    document.getElementById("actorEditName").value = "";
    document.getElementById("actorEditAltName").value = "";
    document.getElementById("actorEditRole").value = "Actress";
    document.getElementById("actorEditThumb").value = "";
    removeBtn.style.display = "none";
    previewDiv.style.display = "none";
  } else {
    // Stiamo editando un attore esistente
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

// ─────────────────────────────
// Renderizza i dati
// ─────────────────────────────
function renderItem(item) {
  document.getElementById("current-id").textContent = item.id || "";

  // Informazioni di base
  bindField("id", "id");

  // Display Name (computed: [ID] - Title)
  const displayNameEl = document.getElementById("displayName");
  if (displayNameEl) {
    displayNameEl.value = `[${item.id || ""}] - ${item.title || ""}`;
  }

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

  // Actors
  renderActors();

  // Update display name when title or id changes
  const titleEl = document.getElementById("title");
  const idEl = document.getElementById("id");
  if (titleEl) {
    titleEl.oninput = () => {
      currentItem.title = titleEl.value;
      displayNameEl.value = `[${currentItem.id || ""}] - ${titleEl.value}`;
      markFieldDirty("title");
      updateDebugJson();
    };
  }

  // Clear dirty fields quando carichiamo un nuovo item
  clearDirtyFields();

  // Debug JSON
  updateDebugJson();
}


// ─────────────────────────────
// Navigazione
// ─────────────────────────────
document.getElementById("next").onclick = () =>
  loadItem("/item/next");

document.getElementById("prev").onclick = () =>
  loadItem("/item/prev");

// Salva item modificato
document.getElementById("saveItem").onclick = async () => {
  const saveBtn = document.getElementById("saveItem");
  const saveText = document.getElementById("saveItemText");
  const originalText = saveText.textContent;

  // Verifica che ci siano modifiche
  if (dirtyFields.size === 0) {
    showNotification(window.i18n ? window.i18n.t("messages.noChanges") : "Nessuna modifica da salvare", "info");
    return;
  }

  const changes = getChanges(originalItem, currentItem);

  if (Object.keys(changes).length === 0) {
    showNotification(window.i18n ? window.i18n.t("messages.noChanges") : "Nessuna modifica da salvare", "info");
    return;
  }

  // Disabilita bottone durante salvataggio
  saveBtn.disabled = true;
  saveText.textContent = window.i18n ? window.i18n.t("messages.saving") : "⏳ Salvataggio...";

  try {
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

  } catch (err) {
    showNotification("Errore durante il salvataggio", "error");
    saveBtn.disabled = false;
    saveText.textContent = originalText;
  }
};

// ─────────────────────────────
// Inizializzazione i18n
// ─────────────────────────────
async function initializeApp() {
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

  // Carica primo item
  loadItem("/item/current");
}

// Event listener per cambio lingua
document.getElementById("languageSelector").onchange = async (e) => {
  const newLang = e.target.value;
  await window.i18n.changeLanguage(newLang);

  // Ricarica per aggiornare labels dinamiche
  location.reload();
};

// ─────────────────────────────
// Primo caricamento
// ─────────────────────────────
initializeApp();
