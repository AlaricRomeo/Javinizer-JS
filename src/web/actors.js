// ============================================
// Actors Page - Main JavaScript
// Uses same modal IDs as index.html
// ============================================

let actors = [];
let currentActor = null;
let isNewActor = false;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize i18n
  initializeI18n().then(() => {
    loadActors();
  });

  // Wait for modal to be loaded before setting up event listeners
  if (document.getElementById('actorEditModal')) {
    setupEventListeners();
  } else {
    window.addEventListener('actorModalLoaded', () => {
      // Apply translations to the newly loaded modal
      if (window.i18n) window.i18n.applyTranslations();
      if (window.applyI18nBindings) window.applyI18nBindings();

      setupEventListeners();
    });
  }
});

async function initializeI18n() {
  try {
    const res = await fetch("/item/config");
    const data = await res.json();

    if (data.ok && window.i18n) {
      const lang = data.config.language || "en";
      await window.i18n.loadLanguage(lang);
      window.i18n.applyTranslations();
      if (window.applyI18nBindings) window.applyI18nBindings();

      // Update language selector to reflect loaded language
      const selector = document.getElementById('languageSelector');
      if (selector) {
        selector.value = lang;
      }
    }
  } catch (err) {
    console.error("Failed to initialize i18n:", err);
  }

  // Listen for language changes to reapply translations
  window.addEventListener('languageChanged', () => {
    if (window.i18n) {
      window.i18n.applyTranslations();
      if (window.applyI18nBindings) window.applyI18nBindings();
    }
  });
}

function setupEventListeners() {
  // Add actor button
  document.getElementById('addActorBtn').addEventListener('click', () => {
    openActorModal(null);
  });

  // Close modal
  document.getElementById('actorEditModalClose').addEventListener('click', closeModal);
  document.getElementById('actorEditCancel').addEventListener('click', closeModal);

  // Close modal on overlay click
  document.getElementById('actorEditModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('actorEditModal')) {
      closeModal();
    }
  });

  // Save actor
  document.getElementById('actorEditSave').addEventListener('click', saveActor);

  // Delete actor
  document.getElementById('actorEditRemove').addEventListener('click', deleteActor);

  // Search actor
  document.getElementById('actorEditSearch').addEventListener('click', searchActor);

  // Thumb URL change - update preview
  document.getElementById('actorEditThumb').addEventListener('input', (e) => {
    updatePreview(e.target.value);
  });

  // Upload Image button
  const uploadBtn = document.getElementById('actorEditUploadBtn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      const fileInput = document.getElementById('actorEditUpload');
      const uploadStatus = document.getElementById('actorEditUploadStatus');

      if (!fileInput.files || fileInput.files.length === 0) {
        uploadStatus.style.display = 'block';
        uploadStatus.style.color = '#dc3545';
        uploadStatus.textContent = 'Please select a file first';
        setTimeout(() => {
          uploadStatus.style.display = 'none';
        }, 3000);
        return;
      }

      const file = fileInput.files[0];

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        uploadStatus.style.display = 'block';
        uploadStatus.style.color = '#dc3545';
        uploadStatus.textContent = 'File too large (max 5MB)';
        setTimeout(() => {
          uploadStatus.style.display = 'none';
        }, 3000);
        return;
      }

      // Show uploading status
      uploadBtn.disabled = true;
      uploadStatus.style.display = 'block';
      uploadStatus.style.color = '#667eea';
      uploadStatus.textContent = 'Uploading...';

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
          // Don't update thumb URL field - that's for remote URLs only
          // The uploaded file will be moved to actors cache on save
          // Just store the temp URL in a data attribute for the save handler
          document.getElementById('actorEditThumb').dataset.uploadedFile = result.url;

          // Update preview
          updatePreview(result.url);

          // Show success
          uploadStatus.style.color = '#28a745';
          uploadStatus.textContent = '✓ Image uploaded successfully!';

          // Clear file input
          fileInput.value = '';

          setTimeout(() => {
            uploadStatus.style.display = 'none';
          }, 3000);
        } else {
          throw new Error(result.error || 'Upload failed');
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        uploadStatus.style.color = '#dc3545';
        uploadStatus.textContent = error.message || 'Upload failed';

        setTimeout(() => {
          uploadStatus.style.display = 'none';
        }, 5000);
      } finally {
        uploadBtn.disabled = false;
      }
    });
  }
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

// ============================================
// Load Actors
// ============================================

async function loadActors() {
  try {
    showLoading(true);

    const response = await fetch('/api/actors');
    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Failed to load actors');
    }

    actors = data.actors || [];
    renderActors();

  } catch (error) {
    console.error('Failed to load actors:', error);
    showEmptyState();
  } finally {
    showLoading(false);
  }
}

function showLoading(show) {
  document.getElementById('loadingState').style.display = show ? 'block' : 'none';
}

function showEmptyState() {
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('actorsGrid').style.display = 'none';
}

// ============================================
// Render Actors Grid
// ============================================

function renderActors() {
  const grid = document.getElementById('actorsGrid');

  if (actors.length === 0) {
    showEmptyState();
    return;
  }

  document.getElementById('emptyState').style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  actors.forEach(actor => {
    const card = createActorCard(actor);
    grid.appendChild(card);
  });
}

function createActorCard(actor) {
  const card = document.createElement('div');
  card.className = 'actor-card';
  card.onclick = () => openActorModal(actor);

  // Create thumb
  const thumb = document.createElement('div');
  thumb.className = 'actor-thumb';

  // Thumbnail loading strategy:
  // 1. Try local file in actors cache: /actors/{actor.id}.{ext} (try .webp, .jpg, .png)
  // 2. Fallback to actor.thumb URL
  // 3. Fallback to placeholder

  if (actor.id) {
    // Try to load local file with common extensions
    const extensions = ['webp', 'jpg', 'png'];
    const img = document.createElement('img');
    img.alt = actor.name || 'Actor';

    let currentExtIndex = 0;

    const tryNextExtension = () => {
      if (currentExtIndex < extensions.length) {
        // Add timestamp to bypass cache
        img.src = `/actors/${actor.id}.${extensions[currentExtIndex]}?t=${Date.now()}`;
        currentExtIndex++;
      } else if (actor.thumb) {
        // All local attempts failed, try remote thumb URL
        img.src = actor.thumb;
        img.onerror = () => {
          thumb.innerHTML = '👤';
        };
      } else {
        // No thumb URL, show placeholder
        thumb.innerHTML = '👤';
      }
    };

    img.onerror = tryNextExtension;
    tryNextExtension(); // Start trying

    thumb.appendChild(img);
  } else if (actor.thumb) {
    // No ID, use thumb URL directly
    const img = document.createElement('img');
    img.src = actor.thumb;
    img.alt = actor.name || 'Actor';
    img.onerror = () => {
      thumb.innerHTML = '👤';
    };
    thumb.appendChild(img);
  } else {
    // No ID and no thumb, show placeholder
    thumb.innerHTML = '👤';
  }

  // Create info
  const info = document.createElement('div');
  info.className = 'actor-info';

  const name = document.createElement('div');
  name.className = 'actor-name';
  name.textContent = actor.name || 'Unknown';

  const altName = document.createElement('div');
  altName.className = 'actor-altname';
  altName.textContent = actor.altName || '';

  // Create stats
  const stats = document.createElement('div');
  stats.className = 'actor-stats';

  const statParts = [];
  if (actor.birthdate) statParts.push(`📅 ${actor.birthdate}`);
  if (actor.height) statParts.push(`📏 ${actor.height}cm`);
  if (actor.bust && actor.waist && actor.hips) {
    statParts.push(`📐 ${actor.bust}-${actor.waist}-${actor.hips}`);
  }

  stats.textContent = statParts.join(' • ');

  info.appendChild(name);
  if (actor.altName) info.appendChild(altName);
  if (statParts.length > 0) info.appendChild(stats);

  card.appendChild(thumb);
  card.appendChild(info);

  return card;
}

// ============================================
// Modal Management
// ============================================

function openActorModal(actor) {
  currentActor = actor;
  isNewActor = !actor;

  const modal = document.getElementById('actorEditModal');
  const title = document.getElementById('actorEditModalTitle');
  const deleteBtn = document.getElementById('actorEditRemove');

  // Set title
  title.textContent = isNewActor ? 'Add Actor' : 'Edit Actor';

  // Show/hide delete button (Actor deletion)
  deleteBtn.style.display = isNewActor ? 'none' : 'block';

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
    if (actor && actor.id) {
      deletePhotoBtn.style.display = 'block';
      deletePhotoBtn.onclick = deleteActorImage; // Re-bind just in case
    } else {
      deletePhotoBtn.style.display = 'none';
    }
  }

  // Clear any previous uploaded file data
  delete document.getElementById('actorEditThumb').dataset.uploadedFile;

  // Fill form
  if (actor) {
    document.getElementById('actorEditName').value = actor.name || '';
    document.getElementById('actorEditAltName').value = actor.altName || '';
    document.getElementById('actorEditRole').value = actor.role || 'Actress';
    document.getElementById('actorEditThumb').value = actor.thumb || '';
    document.getElementById('actorEditBirthdate').value = actor.birthdate || '';
    document.getElementById('actorEditHeight').value = actor.height || '';
    document.getElementById('actorEditBust').value = actor.bust || '';
    document.getElementById('actorEditWaist').value = actor.waist || '';
    document.getElementById('actorEditHips').value = actor.hips || '';

    // Show source info
    if (actor.meta && actor.meta.sources && actor.meta.sources.length > 0) {
      document.getElementById('actorEditSourceInfo').style.display = 'block';
      document.getElementById('actorEditSource').textContent = actor.meta.sources.join(', ');
    } else {
      document.getElementById('actorEditSourceInfo').style.display = 'none';
    }

    // Update preview
    updatePreview(actor.thumb);
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
    updatePreview('');
  }

  // Show modal
  modal.classList.add('active');
}

function closeModal() {
  document.getElementById('actorEditModal').classList.remove('active');
  currentActor = null;
  isNewActor = false;
}

function updatePreview(thumbUrl) {
  const img = document.getElementById('actorEditPreviewImg');
  const placeholder = document.getElementById('actorEditPreviewPlaceholder');

  // Priority 1: Temporary uploads (newest version)
  if (thumbUrl && thumbUrl.startsWith('/media/temp_')) {
    img.src = thumbUrl;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    img.onerror = () => {
      img.style.display = 'none';
      placeholder.style.display = 'block';
    };
    return;
  }

  // Priority 2: Smart search by ID (Local Files)
  // This MUST take precedence over the provided URL (unless it's a temp upload)
  // because local files override remote URLs in the system logic.
  const actorId = currentActor?.id;
  if (actorId) {
    const extensions = ['webp', 'jpg', 'png'];
    let currentExtIndex = 0;

    const tryNextExtension = () => {
      if (currentExtIndex < extensions.length) {
        img.src = `/actors/${actorId}.${extensions[currentExtIndex]}?t=${Date.now()}`;
        currentExtIndex++;
      } else if (thumbUrl) {
        // Priority 3: Fallback to provided URL if all local attempts fail
        img.src = thumbUrl;
        img.onerror = () => {
          img.style.display = 'none';
          placeholder.style.display = 'block';
        };
      } else {
        img.style.display = 'none';
        placeholder.style.display = 'block';
      }
    };

    img.onerror = tryNextExtension;
    img.onload = () => {
      img.style.display = 'block';
      placeholder.style.display = 'none';
    };

    tryNextExtension();
    return;
  }

  // Priority 3 (No ID case): Use provided URL directly
  if (thumbUrl) {
    img.src = thumbUrl;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    img.onerror = () => {
      img.style.display = 'none';
      placeholder.style.display = 'block';
    };
    return;
  }

}

// ============================================
// Save Actor
// ============================================

async function saveActor() {
  const name = document.getElementById('actorEditName').value.trim();

  if (!name) {
    alert('Please enter actor name');
    return;
  }

  const thumbField = document.getElementById('actorEditThumb');
  const actorData = {
    ...currentActor,
    id: currentActor?.id || null,
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

    // Reload actors
    await loadActors();
    closeModal();

  } catch (error) {
    console.error('Failed to save actor:', error);
    alert('Failed to save actor: ' + error.message);
  }
}

// ============================================
// Delete Actor
// ============================================

async function deleteActor() {
  if (!currentActor || !currentActor.id) return;

  if (!confirm(`Are you sure you want to delete ${currentActor.name}?`)) {
    return;
  }

  try {
    const response = await fetch('/api/actors/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentActor.id })
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || 'Failed to delete actor');
    }

    // Reload actors
    await loadActors();
    closeModal();

  } catch (error) {
    console.error('Failed to delete actor:', error);
    alert('Failed to delete actor: ' + error.message);
  }
}

// ============================================
// Search Actor
// ============================================

async function searchActor() {
  const name = document.getElementById('actorEditName').value.trim();

  if (!name) {
    alert('Please enter actor name first');
    return;
  }

  const btn = document.getElementById('actorEditSearch');
  const btnText = document.getElementById('actorEditSearchText');
  const status = document.getElementById('actorEditSearchStatus');

  // Disable button
  btn.disabled = true;
  btnText.textContent = 'Searching...';
  status.style.display = 'block';
  status.textContent = 'Searching for actor data...';

  try {
    const response = await fetch('/api/actors/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || 'Actor not found');
    }

    const actor = result.actor;

    // Fill form with found data (populate ALL fields, not just non-empty ones)
    // This ensures that if a field was empty locally, it gets filled with scraped data
    document.getElementById('actorEditAltName').value = actor.altName || '';
    document.getElementById('actorEditThumb').value = actor.thumb || '';
    if (actor.thumb) {
      updatePreview(actor.thumb);
    }
    document.getElementById('actorEditBirthdate').value = actor.birthdate || '';
    document.getElementById('actorEditHeight').value = actor.height || '';
    document.getElementById('actorEditBust').value = actor.bust || '';
    document.getElementById('actorEditWaist').value = actor.waist || '';
    document.getElementById('actorEditHips').value = actor.hips || '';

    // Show source info
    if (actor.meta && actor.meta.sources) {
      document.getElementById('actorEditSourceInfo').style.display = 'block';
      document.getElementById('actorEditSource').textContent = actor.meta.sources.join(', ');
    }

    status.textContent = '✓ Actor data found and loaded';
    status.style.color = '#28a745';

  } catch (error) {
    console.error('Search failed:', error);
    status.textContent = '✗ ' + error.message;
    status.style.color = '#dc3545';
  } finally {
    // Re-enable button
    btn.disabled = false;
    btnText.textContent = 'Search Actor';

    // Hide status after 3 seconds
    setTimeout(() => {
      status.style.display = 'none';
      status.style.color = '#666';
    }, 3000);
  }
}

// ============================================
// Delete Actor Image
// ============================================

async function deleteActorImage() {
  if (!currentActor || !currentActor.id) return;

  const msg = window.i18n ? window.i18n.t('messages.confirmDeletePhoto') : 'Are you sure you want to delete the local photo?';

  if (!confirm(msg)) {
    return;
  }

  try {
    const response = await fetch('/api/actors/delete-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentActor.id })
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
    updatePreview(thumbField.value.trim());

    // Refresh main grid
    await loadActors();

    // Hide delete button
    document.getElementById('actorEditDeletePhoto').style.display = 'none';

  } catch (error) {
    console.error('Failed to delete image:', error);
    alert('Error deleting image');
  }
}

// Wire up events
document.addEventListener('DOMContentLoaded', () => {
  // Other event listeners are set up via onclick in HTML or main app initialization
  // Specifically for the new delete photo button:
  const deletePhotoBtn = document.getElementById('actorEditDeletePhoto');
  if (deletePhotoBtn) {
    deletePhotoBtn.onclick = deleteActorImage;
  }
});
