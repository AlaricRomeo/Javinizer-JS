// ============================================
// Unified Actor Modal System
// Shared between index.html and actors.html
// ============================================

// Global variables managed by the unified actor modal system
// These are shared between different contexts
let unifiedCurrentActor = null;
let unifiedIsNewActor = false;
let modalMode = 'movie'; // 'movie' for index.html, 'library' for actors.html

// Note: editingActorIndex is managed by app.js in movie context
// and is not part of the unified system since it's specific to movie context

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

// Set the modal mode based on the context
function setActorModalMode(mode) {
  modalMode = mode;
}

// Open actor modal with appropriate context
function openActorModal(actorOrIndex = null) {
  if (modalMode === 'movie') {
    // Called from index.html (movie context)
    // editingActorIndex is managed by app.js in movie context
    unifiedCurrentActor = actorOrIndex === null ? null : currentItem.actor[actorOrIndex];  // Set unifiedCurrentActor to the actor being edited for preview purposes
    unifiedIsNewActor = actorOrIndex === null;

    const modal = document.getElementById("actorEditModal");
    if (!modal || !document.getElementById("actorEditModalTitle")) {
      return;
    }

    const modalTitle = document.getElementById("actorEditModalTitle");
    const removeBtn = document.getElementById("actorEditRemove");
    const sourceInfo = document.getElementById("actorEditSourceInfo");

    const actor = unifiedIsNewActor ? {} : currentItem.actor[actorOrIndex];

    // Imposta titolo
    modalTitle.textContent = window.i18n
      ? window.i18n.t(unifiedIsNewActor ? "actorModal.titleAdd" : "actorModal.title")
      : (unifiedIsNewActor ? "Aggiungi Attore" : "Modifica Attore");

    // Update preview first
    updateActorPreview(actor.thumb || "");

    // Popola campi base
    const nameEl = document.getElementById("actorEditName");
    const altNameEl = document.getElementById("actorEditAltName");
    const roleEl = document.getElementById("actorEditRole");
    const thumbEl = document.getElementById("actorEditThumb");

    if (nameEl) nameEl.value = actor.name || "";
    if (altNameEl) altNameEl.value = actor.altName || "";
    if (roleEl) roleEl.value = actor.role || "Actress";
    if (thumbEl) thumbEl.value = actor.thumb || "";

    // Popola campi estesi
    const birthdateEl = document.getElementById("actorEditBirthdate");
    const heightEl = document.getElementById("actorEditHeight");
    const bustEl = document.getElementById("actorEditBust");
    const waistEl = document.getElementById("actorEditWaist");
    const hipsEl = document.getElementById("actorEditHips");

    if (birthdateEl) birthdateEl.value = actor.birthdate || "";
    if (heightEl) heightEl.value = actor.height || "";
    if (bustEl) bustEl.value = actor.bust || "";
    if (waistEl) waistEl.value = actor.waist || "";
    if (hipsEl) hipsEl.value = actor.hips || "";

    // Mostra fonte dati se disponibile
    if (!unifiedIsNewActor && actor.meta && actor.meta.sources) {
      const sourceSpan = document.getElementById("actorEditSource");
      if (sourceSpan) {
        sourceSpan.textContent = actor.meta.sources.join(", ");
        sourceInfo.style.display = "block";
      }
    } else {
      if (sourceInfo) sourceInfo.style.display = "none";
    }

    // Manage remove button visibility
    if (removeBtn) removeBtn.style.display = unifiedIsNewActor ? "none" : "block";

    // Show modal using CSS class
    modal.classList.add("active");
  } else {
    // Called from actors.html (library context)
    unifiedCurrentActor = actorOrIndex;
    unifiedIsNewActor = !actorOrIndex;

    const modal = document.getElementById('actorEditModal');
    const title = document.getElementById('actorEditModalTitle');
    const deleteBtn = document.getElementById('actorEditRemove');

    // Set title
    title.textContent = unifiedIsNewActor ? 'Add Actor' : 'Edit Actor';

    // Show/hide delete button (Actor deletion)
    deleteBtn.style.display = unifiedIsNewActor ? 'none' : 'block';

    // Show/hide DELETE PHOTO button
    const deletePhotoBtn = document.getElementById('actorEditDeletePhoto');
    if (deletePhotoBtn) {
      // 1. Update Text
      if (window.i18n) {
        const span = deletePhotoBtn.querySelector('span');
        if (span) {
          // Set data-i18n attribute if missing ensure future updates work automatically via app-wide listeners
          if (!span.hasAttribute('data-i18n') || span.getAttribute('data-i18n') === 'DELETE_LOCAL_PHOTO') {
            span.setAttribute('data-i18n', 'buttons.deleteLocalPhoto');
          }
          // Force manual update now
          span.textContent = window.i18n.t('buttons.deleteLocalPhoto');
        }
      }

      // 2. Update Visibility
      // Only show if we have an actor ID (edit mode)
      if (actorOrIndex && actorOrIndex.id) {
        deletePhotoBtn.style.display = 'block';
        deletePhotoBtn.onclick = deleteActorImage; // Re-bind just in case
      } else {
        deletePhotoBtn.style.display = 'none';
      }
    }

    // Clear any previous uploaded file data
    delete document.getElementById('actorEditThumb').dataset.uploadedFile;

    // Fill form
    if (actorOrIndex) {
      document.getElementById('actorEditName').value = actorOrIndex.name || '';
      document.getElementById('actorEditAltName').value = actorOrIndex.altName || '';
      document.getElementById('actorEditRole').value = actorOrIndex.role || 'Actress';
      document.getElementById('actorEditThumb').value = actorOrIndex.thumb || '';
      document.getElementById('actorEditBirthdate').value = actorOrIndex.birthdate || '';
      document.getElementById('actorEditHeight').value = actorOrIndex.height || '';
      document.getElementById('actorEditBust').value = actorOrIndex.bust || '';
      document.getElementById('actorEditWaist').value = actorOrIndex.waist || '';
      document.getElementById('actorEditHips').value = actorOrIndex.hips || '';

      // Show source info
      if (actorOrIndex.meta && actorOrIndex.meta.sources && actorOrIndex.meta.sources.length > 0) {
        document.getElementById('actorEditSourceInfo').style.display = 'block';
        document.getElementById('actorEditSource').textContent = actorOrIndex.meta.sources.join(', ');
      } else {
        document.getElementById('actorEditSourceInfo').style.display = 'none';
      }

      // Update preview
      updateActorPreview(actorOrIndex.thumb);
    } else {
      // Clear form
      document.getElementById('actorEditName').value = '';
      document.getElementById('actorEditAltName').value = '';
      document.getElementById('actorEditRole').value = 'Actress';
      document.getElementById('actorEditThumb').value = '';
      document.getElementById('actorEditBirthdate').value = '';
      document.getElementById('actorEditHeight').value = '';
      document.getElementById('actorEditBust').value = '';
      document.getElementById('actorEditWaist').value = '';
      document.getElementById('actorEditHips').value = '';
      document.getElementById('actorEditSourceInfo').style.display = 'none';
      // Clear preview when adding a new actor to avoid showing previous actor's image
      updateActorPreview('');
    }

    // Show modal
    modal.classList.add('active');
  }
}

// Close actor modal
function closeActorModal() {
  const modal = document.getElementById("actorEditModal");
  if (modal) {
    modal.classList.remove("active");
  }
  unifiedCurrentActor = null;
  unifiedIsNewActor = false;

  // Ensure the preview is cleared when modal closes to prevent showing previous actor's image
  const previewImg = document.getElementById("actorEditPreviewImg");
  const placeholder = document.getElementById("actorEditPreviewPlaceholder");

  if (previewImg) {
    previewImg.src = "";
    previewImg.style.display = "none";
  }
  if (placeholder) {
    placeholder.style.display = "block";
  }
}

// Update actor preview image
function updateActorPreview(url) {
  const previewImg = document.getElementById("actorEditPreviewImg");
  const placeholder = document.getElementById("actorEditPreviewPlaceholder");

  // Protezione: verifica che gli elementi esistano
  if (!previewImg || !placeholder) {
    console.warn("Preview elements not found in DOM");
    return;
  }

  if (url && url.trim() !== "") {
    // In both modes, prioritize local file lookup if we have an actor name
    // This applies to both movie and library contexts
    if (unifiedCurrentActor && unifiedCurrentActor.name) {
      // Try to load from local actors cache first
      const normalizedActorName = normalizeActorNameForFile(unifiedCurrentActor.name);
      const localImageUrl = `/actors/${normalizedActorName}.jpg`;

      previewImg.src = localImageUrl;

      // Set up error handler for when local image doesn't exist
      previewImg.onerror = () => {
        // If local image fails, try the original thumb URL
        if (url && url !== localImageUrl) {
          previewImg.src = url;
          previewImg.onerror = () => {
            previewImg.style.display = "none";
            placeholder.style.display = "block";
          };
        } else {
          previewImg.style.display = "none";
          placeholder.style.display = "block";
        }
      };

      previewImg.onload = () => {
        previewImg.style.display = "block";
        placeholder.style.display = "none";
      };
    } else {
      // When no actor name is available, use the provided URL
      previewImg.src = url;
      previewImg.style.display = "block";
      placeholder.style.display = "none";

      // Gestisci errore caricamento immagine
      previewImg.onerror = () => {
        previewImg.style.display = "none";
        placeholder.style.display = "block";
      };
    }
  } else {
    previewImg.style.display = "none";
    placeholder.style.display = "block";
  }
}

// Save actor based on current mode
async function saveActor() {
  if (modalMode === 'movie') {
    // In movie context, we need to call the appropriate functions from app.js
    // This will be handled by the event listeners in app.js which use the original logic
    console.error('saveActor in movie mode should be handled by app.js event listeners');
    return;
  } else {
    // Save in library context (actors.html)
    const name = document.getElementById('actorEditName').value.trim();

    if (!name) {
      alert('Please enter actor name');
      return;
    }

    const thumbField = document.getElementById('actorEditThumb');
    const actorData = {
      ...unifiedCurrentActor,
      id: unifiedCurrentActor?.id || null,
      name: name,
      altName: document.getElementById('actorEditAltName').value.trim(),
      role: document.getElementById('actorEditRole').value.trim(),
      thumb: thumbField.value.trim(),
      uploadedFile: thumbField.dataset.uploadedFile || null,
      birthdate: document.getElementById('actorEditBirthdate').value,
      height: parseInt(document.getElementById('actorEditHeight').value) || 0,
      bust: parseInt(document.getElementById('actorEditBust').value) || 0,
      waist: parseInt(document.getElementById('actorEditWaist').value) || 0,
      hips: parseInt(document.getElementById('actorEditHips').value) || 0
    };

    try {
      const response = await fetch('/api/actors/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(actorData)
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.error || 'Failed to save actor');
      }

      // Clear uploaded file data
      delete thumbField.dataset.uploadedFile;

      // Reload actors if in library mode
      if (typeof loadActors === 'function') {
        await loadActors();
      }

      closeActorModal();

    } catch (error) {
      console.error('Failed to save actor:', error);
      alert('Failed to save actor: ' + error.message);
    }
  }
}

// Delete actor based on current mode
async function deleteActor() {
  if (modalMode === 'movie') {
    // In movie context, we need to call the appropriate functions from app.js
    // This will be handled by the event listeners in app.js which use the original logic
    console.error('deleteActor in movie mode should be handled by app.js event listeners');
    return;
  } else {
    // Delete in library context (actors.html)
    if (!unifiedCurrentActor || !unifiedCurrentActor.id) return;

    if (!confirm(window.i18n ? window.i18n.t("messages.confirmDeleteActor", { name: unifiedCurrentActor.name }) : `Are you sure you want to delete ${unifiedCurrentActor.name}?`)) {
      return;
    }

    try {
      const response = await fetch('/api/actors/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: unifiedCurrentActor.id })
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.error || 'Failed to delete actor');
      }

      // Reload actors
      if (typeof loadActors === 'function') {
        await loadActors();
      }

      closeActorModal();

    } catch (error) {
      console.error('Failed to delete actor:', error);
      alert('Failed to delete actor: ' + error.message);
    }
  }
}

// Search actor functionality
async function searchActor() {
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
}

// Delete actor image (for library mode)
async function deleteActorImage() {
  if (!unifiedCurrentActor || !unifiedCurrentActor.id) return;

  const msg = window.i18n ? window.i18n.t('messages.confirmDeletePhoto') : 'Are you sure you want to delete the local photo?';

  if (!confirm(msg)) {
    return;
  }

  try {
    const response = await fetch('/api/actors/delete-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: unifiedCurrentActor.id })
    });

    const result = await response.json();

    if (!result.ok) {
      alert('Failed to delete image: ' + (result.error || 'Unknown error'));
      return;
    }

    // Success! Update UI
    // Force preview update to use thumbnail URL or placeholder
    // We pass the remote URL (if any) so the preview falls back to it
    const thumbField = document.getElementById('actorEditThumb');
    updateActorPreview(thumbField.value.trim());

    // Refresh main grid
    if (typeof loadActors === 'function') {
      await loadActors();
    }

    // Hide delete button
    document.getElementById('actorEditDeletePhoto').style.display = 'none';

  } catch (error) {
    console.error('Failed to delete image:', error);
    alert('Error deleting image');
  }
}

// Upload image functionality
async function uploadActorImage() {
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
  const uploadBtn = document.getElementById("actorEditUploadBtn");
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

      // Clear file input
      fileInput.value = "";

      // Show success
      uploadStatus.style.color = "#28a745";
      uploadStatus.textContent = "✓ Image uploaded successfully!";

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
}

// Setup event listeners for actor modal
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

  document.getElementById("actorEditSave").onclick = saveActor;

  document.getElementById("actorEditRemove").onclick = deleteActor;

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
  document.getElementById("actorEditSearch").onclick = searchActor;

  // Upload Image button
  const uploadBtn = document.getElementById("actorEditUploadBtn");
  console.log('[setupActorModalEventListeners] Upload button:', uploadBtn);

  if (!uploadBtn) {
    console.error('[setupActorModalEventListeners] Upload button not found!');
    return;
  }

  console.log('[setupActorModalEventListeners] Setting up upload button click handler');
  uploadBtn.onclick = uploadActorImage;

  // Wire up events for delete photo button
  const deletePhotoBtn = document.getElementById('actorEditDeletePhoto');
  if (deletePhotoBtn) {
    deletePhotoBtn.onclick = deleteActorImage;
  }
}

// Export functions globally
window.ActorModal = {
  setActorModalMode,
  openActorModal,
  closeActorModal,
  updateActorPreview,
  saveActor,
  deleteActor,
  searchActor,
  deleteActorImage,
  uploadActorImage,
  setupActorModalEventListeners,
  // Expose internal variables for context-specific functions
  get unifiedCurrentActor() {
    return unifiedCurrentActor;
  }
};
