// ============================================
// Unified Actor Modal System
// Shared between index.html and actors.html
// ============================================

let unifiedCurrentActor = null;
let unifiedIsNewActor = false;
let modalMode = 'movie'; // 'movie' for index.html, 'library' for actors.html
let lastSearchForceOverwrite = false;

// Callbacks registered by movie context (app.js)
let _movieContextSave = null;
let _movieContextDelete = null;

function registerMovieContextHandlers(onSave, onDelete) {
  _movieContextSave = onSave;
  _movieContextDelete = onDelete;
}

function setActorModalMode(mode) {
  modalMode = mode;
}

// Open actor modal — unified for both movie and library contexts
function openActorModal(actor) {
  unifiedCurrentActor = actor || null;
  unifiedIsNewActor = !actor;

  const modal = document.getElementById('actorEditModal');
  if (!modal) return;

  const modalTitle = document.getElementById('actorEditModalTitle');
  const removeBtn = document.getElementById('actorEditRemove');
  const deletePhotoBtn = document.getElementById('actorEditDeletePhoto');
  const sourceInfo = document.getElementById('actorEditSourceInfo');
  const sourceSpan = document.getElementById('actorEditSource');

  // Title
  if (modalTitle) {
    modalTitle.textContent = window.i18n
      ? window.i18n.t(unifiedIsNewActor ? 'actorModal.titleAdd' : 'actorModal.title')
      : (unifiedIsNewActor ? 'Add Actor' : 'Edit Actor');
  }

  // Remove/Delete actor button
  if (removeBtn) removeBtn.style.display = unifiedIsNewActor ? 'none' : 'block';

  // Delete photo button: only in library mode with existing actor
  if (deletePhotoBtn) {
    if (modalMode === 'library' && actor && actor.id) {
      deletePhotoBtn.style.display = 'block';
      deletePhotoBtn.onclick = deleteActorImage;
    } else {
      deletePhotoBtn.style.display = 'none';
    }
  }

  // Clear any previous uploaded file data
  const thumbField = document.getElementById('actorEditThumb');
  if (thumbField) delete thumbField.dataset.uploadedFile;

  // Populate form fields
  const a = actor || {};
  _setField('actorEditName', a.name || '');
  _setField('actorEditAltName', a.altName || '');
  _setField('actorEditRole', a.role || 'Actress');
  _setField('actorEditThumb', a.thumb || '');
  _setField('actorEditBirthdate', a.birthdate || '');
  _setField('actorEditHeight', a.height || '');
  _setField('actorEditBust', a.bust || '');
  _setField('actorEditWaist', a.waist || '');
  _setField('actorEditHips', a.hips || '');

  // Source info
  if (!unifiedIsNewActor && a.meta && a.meta.sources && a.meta.sources.length > 0) {
    if (sourceSpan) sourceSpan.textContent = a.meta.sources.join(', ');
    if (sourceInfo) sourceInfo.style.display = 'block';
  } else {
    if (sourceInfo) sourceInfo.style.display = 'none';
  }

  // Reset overwrite checkbox
  const overwriteCheckbox = document.getElementById('actorEditOverwriteLocal');
  if (overwriteCheckbox) overwriteCheckbox.checked = false;
  lastSearchForceOverwrite = false;

  // Update preview
  updateActorPreview(a.thumb || '');

  // Show modal
  modal.classList.add('active');
}

function _setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

// Close actor modal
function closeActorModal() {
  const modal = document.getElementById('actorEditModal');
  if (modal) modal.classList.remove('active');

  unifiedCurrentActor = null;
  unifiedIsNewActor = false;

  const previewImg = document.getElementById('actorEditPreviewImg');
  const placeholder = document.getElementById('actorEditPreviewPlaceholder');
  if (previewImg) { previewImg.src = ''; previewImg.style.display = 'none'; }
  if (placeholder) placeholder.style.display = 'block';
}

// Update actor preview image
// Tries local cache first (/actors/{id}.ext), then remote URL
function updateActorPreview(url, forceRemote = false) {
  const previewImg = document.getElementById('actorEditPreviewImg');
  const placeholder = document.getElementById('actorEditPreviewPlaceholder');
  if (!previewImg || !placeholder) return;

  if (forceRemote && url && url.trim() !== '') {
    previewImg.src = url;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';
    previewImg.onerror = () => { previewImg.style.display = 'none'; placeholder.style.display = 'block'; };
    previewImg.onload = () => { previewImg.style.display = 'block'; placeholder.style.display = 'none'; };
    return;
  }

  // Try local file by actor ID, then fall back to URL
  if (unifiedCurrentActor && (unifiedCurrentActor.id || unifiedCurrentActor.name)) {
    const actorId = unifiedCurrentActor.id || _normalizeActorId(unifiedCurrentActor.name);
    const extensions = ['webp', 'jpg', 'jpeg', 'png', 'gif'];
    const ts = Date.now();
    let extIndex = 0;

    const tryNext = () => {
      if (extIndex < extensions.length) {
        previewImg.src = `/actors/${actorId}.${extensions[extIndex++]}?t=${ts}`;
      } else if (url && url.trim() !== '') {
        previewImg.src = url;
        previewImg.onerror = () => { previewImg.style.display = 'none'; placeholder.style.display = 'block'; };
        previewImg.onload = () => { previewImg.style.display = 'block'; placeholder.style.display = 'none'; };
      } else {
        previewImg.style.display = 'none';
        placeholder.style.display = 'block';
      }
    };

    previewImg.onerror = tryNext;
    previewImg.onload = () => { previewImg.style.display = 'block'; placeholder.style.display = 'none'; };
    tryNext();
    return;
  }

  if (url && url.trim() !== '') {
    previewImg.src = url;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';
    previewImg.onerror = () => { previewImg.style.display = 'none'; placeholder.style.display = 'block'; };
    return;
  }

  previewImg.style.display = 'none';
  placeholder.style.display = 'block';
}

function _normalizeActorId(name) {
  if (!name) return '';
  let n = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, '-');
  if (!n) {
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = (((h << 5) + h) ^ name.charCodeAt(i)) >>> 0;
    n = 'actor-' + h.toString(16).padStart(8, '0');
  }
  return n;
}

// Get current form data
function _getFormData() {
  const thumbField = document.getElementById('actorEditThumb');
  return {
    ...unifiedCurrentActor,
    id: unifiedCurrentActor?.id || null,
    name: (document.getElementById('actorEditName')?.value || '').trim(),
    altName: (document.getElementById('actorEditAltName')?.value || '').trim(),
    role: (document.getElementById('actorEditRole')?.value || '').trim(),
    thumb: thumbField?.value.trim() || '',
    uploadedFile: thumbField?.dataset.uploadedFile || null,
    birthdate: document.getElementById('actorEditBirthdate')?.value || '',
    height: parseInt(document.getElementById('actorEditHeight')?.value) || 0,
    bust: parseInt(document.getElementById('actorEditBust')?.value) || 0,
    waist: parseInt(document.getElementById('actorEditWaist')?.value) || 0,
    hips: parseInt(document.getElementById('actorEditHips')?.value) || 0,
    forceOverwrite: lastSearchForceOverwrite,
  };
}

// Save actor — dispatches to movie context callback or library API
async function saveActor() {
  if (modalMode === 'movie') {
    if (_movieContextSave) _movieContextSave(_getFormData());
    return;
  }

  // Library context: save via API
  const name = (document.getElementById('actorEditName')?.value || '').trim();
  if (!name) {
    alert(window.i18n ? window.i18n.t('messages.enterActorNameFirstAlert') : 'Please enter actor name');
    return;
  }

  const actorData = _getFormData();

  try {
    const response = await fetch('/api/actors/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...actorData, context: 'library' })
    });
    const result = await response.json();

    if (!result.ok) throw new Error(result.error || 'Failed to save actor');

    const thumbField = document.getElementById('actorEditThumb');
    if (thumbField) delete thumbField.dataset.uploadedFile;

    if (typeof loadActors === 'function') await loadActors();
    closeActorModal();
  } catch (error) {
    console.error('Failed to save actor:', error);
    alert('Failed to save actor: ' + error.message);
  }
}

// Delete actor — dispatches to movie context callback or library API
async function deleteActor() {
  if (modalMode === 'movie') {
    if (_movieContextDelete) _movieContextDelete();
    return;
  }

  // Library context: delete via API
  if (!unifiedCurrentActor || !unifiedCurrentActor.id) return;

  const msg = window.i18n
    ? window.i18n.t('messages.confirmDeleteActor', { name: unifiedCurrentActor.name })
    : `Are you sure you want to delete ${unifiedCurrentActor.name}?`;

  if (!confirm(msg)) return;

  try {
    const response = await fetch('/api/actors/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: unifiedCurrentActor.id })
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || 'Failed to delete actor');

    if (typeof loadActors === 'function') await loadActors();
    closeActorModal();
  } catch (error) {
    console.error('Failed to delete actor:', error);
    alert('Failed to delete actor: ' + error.message);
  }
}

// Search actor (unified for both contexts)
async function searchActor() {
  const actorName = (document.getElementById('actorEditName')?.value || '').trim();
  if (!actorName) {
    alert(window.i18n ? window.i18n.t('messages.enterActorNameFirstAlert') : "Enter actor name before searching");
    return;
  }

  const searchBtn = document.getElementById('actorEditSearch');
  const searchText = document.getElementById('actorEditSearchText');
  const searchStatus = document.getElementById('actorEditSearchStatus');
  const overwriteCheckbox = document.getElementById('actorEditOverwriteLocal');
  const forceOverwrite = overwriteCheckbox ? overwriteCheckbox.checked : false;

  lastSearchForceOverwrite = forceOverwrite;

  searchBtn.disabled = true;
  if (searchText) searchText.textContent = window.i18n ? window.i18n.t('messages.searchingActor') : 'Searching...';
  if (searchStatus) { searchStatus.style.display = 'block'; searchStatus.style.color = '#666'; searchStatus.textContent = window.i18n ? window.i18n.t('messages.searchingActorData') : 'Searching actor data...'; }

  try {
    const response = await fetch('/item/actors/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: actorName, forceOverwrite })
    });
    const result = await response.json();

    if (result.ok && result.actor) {
      const shouldOverwrite = (currentValue, newValue) => {
        if (forceOverwrite) return newValue !== undefined && newValue !== null && newValue !== '';
        return (!currentValue || currentValue === '') && (newValue !== undefined && newValue !== null);
      };

      const fill = (id, val) => { if (shouldOverwrite(document.getElementById(id)?.value, val)) _setField(id, val); };

      fill('actorEditName', result.actor.name);
      fill('actorEditAltName', result.actor.altName);
      fill('actorEditBirthdate', result.actor.birthdate);
      if (shouldOverwrite(document.getElementById('actorEditHeight')?.value, result.actor.height) && result.actor.height > 0) _setField('actorEditHeight', result.actor.height);
      if (shouldOverwrite(document.getElementById('actorEditBust')?.value, result.actor.bust) && result.actor.bust > 0) _setField('actorEditBust', result.actor.bust);
      if (shouldOverwrite(document.getElementById('actorEditWaist')?.value, result.actor.waist) && result.actor.waist > 0) _setField('actorEditWaist', result.actor.waist);
      if (shouldOverwrite(document.getElementById('actorEditHips')?.value, result.actor.hips) && result.actor.hips > 0) _setField('actorEditHips', result.actor.hips);
      fill('actorEditThumb', result.actor.thumb);

      if (result.actor.thumb) updateActorPreview(result.actor.thumb, forceOverwrite);

      const sourceInfo = document.getElementById('actorEditSourceInfo');
      const sourceSpan = document.getElementById('actorEditSource');
      if (result.actor.meta && result.actor.meta.sources && result.actor.meta.sources.length > 0) {
        if (sourceSpan) sourceSpan.textContent = result.actor.meta.sources.join(', ');
        if (sourceInfo) sourceInfo.style.display = 'block';
      }

      if (searchStatus) {
        searchStatus.style.color = '#28a745';
        searchStatus.textContent = window.i18n ? window.i18n.t('messages.actorDataFound') : '✓ Data found!';
        setTimeout(() => { searchStatus.style.display = 'none'; }, 3000);
      }
    } else {
      if (searchStatus) {
        searchStatus.style.color = '#dc3545';
        searchStatus.textContent = result.error || (window.i18n ? window.i18n.t('messages.actorNotFound') : 'Actor not found');
        setTimeout(() => { searchStatus.style.display = 'none'; }, 5000);
      }
    }
  } catch (error) {
    console.error('Error searching actor:', error);
    if (searchStatus) {
      searchStatus.style.color = '#dc3545';
      searchStatus.textContent = window.i18n ? window.i18n.t('messages.errorSearchingActor') : 'Error searching actor';
      setTimeout(() => { searchStatus.style.display = 'none'; }, 5000);
    }
  } finally {
    searchBtn.disabled = false;
    if (searchText) searchText.textContent = window.i18n ? window.i18n.t('actorModal.searchActor') : 'Search Actor';
  }
}

// Delete local actor image (library context only)
async function deleteActorImage() {
  if (!unifiedCurrentActor || !unifiedCurrentActor.id) return;

  const msg = window.i18n ? window.i18n.t('messages.confirmDeletePhoto') : 'Delete the local photo?';
  if (!confirm(msg)) return;

  try {
    const response = await fetch('/api/actors/delete-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: unifiedCurrentActor.id })
    });
    const result = await response.json();
    if (!result.ok) { alert('Failed to delete image: ' + (result.error || 'Unknown error')); return; }

    const thumbField = document.getElementById('actorEditThumb');
    updateActorPreview(thumbField?.value.trim() || '');

    if (typeof loadActors === 'function') await loadActors();

    const deletePhotoBtn = document.getElementById('actorEditDeletePhoto');
    if (deletePhotoBtn) deletePhotoBtn.style.display = 'none';
  } catch (error) {
    console.error('Failed to delete image:', error);
    alert('Error deleting image');
  }
}

// Upload actor image (unified for both contexts)
// If actor name is available, passes it to the server for direct cache save
async function uploadActorImage() {
  const fileInput = document.getElementById('actorEditUpload');
  const uploadStatus = document.getElementById('actorEditUploadStatus');

  if (!fileInput.files || fileInput.files.length === 0) {
    if (uploadStatus) { uploadStatus.style.display = 'block'; uploadStatus.style.color = '#dc3545'; uploadStatus.textContent = window.i18n ? window.i18n.t('messages.selectFileFirst') : 'Please select a file first'; setTimeout(() => { uploadStatus.style.display = 'none'; }, 3000); }
    return;
  }

  const file = fileInput.files[0];
  if (file.size > 5 * 1024 * 1024) {
    if (uploadStatus) { uploadStatus.style.display = 'block'; uploadStatus.style.color = '#dc3545'; uploadStatus.textContent = window.i18n ? window.i18n.t('messages.fileTooLarge') : 'File too large (max 5MB)'; setTimeout(() => { uploadStatus.style.display = 'none'; }, 3000); }
    return;
  }

  const uploadBtn = document.getElementById('actorEditUploadBtn');
  if (uploadBtn) uploadBtn.disabled = true;
  if (uploadStatus) { uploadStatus.style.display = 'block'; uploadStatus.style.color = '#667eea'; uploadStatus.textContent = window.i18n ? window.i18n.t('messages.uploading') : 'Uploading...'; }

  try {
    const formData = new FormData();
    formData.append('image', file);

    // Include actor name so server can save directly to cache
    const actorName = (document.getElementById('actorEditName')?.value || '').trim();
    if (actorName) formData.append('actorName', actorName);

    const response = await fetch('/item/actors/upload-image', { method: 'POST', body: formData });
    const result = await response.json();

    if (result.ok && result.url) {
      const thumbField = document.getElementById('actorEditThumb');
      if (thumbField) {
        thumbField.value = result.url;
        // Mark as uploaded file so save handler knows to finalize it
        thumbField.dataset.uploadedFile = result.url;
      }

      // Show preview directly (temp or final URL)
      const previewImg = document.getElementById('actorEditPreviewImg');
      const placeholder = document.getElementById('actorEditPreviewPlaceholder');
      if (previewImg && placeholder) {
        previewImg.src = result.url + '?t=' + Date.now();
        previewImg.style.display = 'block';
        placeholder.style.display = 'none';
      }

      fileInput.value = '';

      if (uploadStatus) {
        uploadStatus.style.color = '#28a745';
        uploadStatus.textContent = window.i18n ? window.i18n.t('messages.imageUploadedSuccess') : '✓ Image uploaded!';
        setTimeout(() => { uploadStatus.style.display = 'none'; }, 3000);
      }
    } else {
      throw new Error(result.error || 'Upload failed');
    }
  } catch (error) {
    console.error('Error uploading image:', error);
    if (uploadStatus) {
      uploadStatus.style.color = '#dc3545';
      uploadStatus.textContent = error.message || 'Upload failed';
      setTimeout(() => { uploadStatus.style.display = 'none'; }, 5000);
    }
  } finally {
    if (uploadBtn) uploadBtn.disabled = false;
  }
}

// Setup event listeners — works for both contexts
function setupActorModalEventListeners() {
  if (!document.getElementById('actorEditModal')) {
    window.addEventListener('actorModalLoaded', () => setupActorModalEventListeners(), { once: true });
    return;
  }

  const get = (id) => document.getElementById(id);

  get('actorEditCancel').onclick = closeActorModal;

  const closeBtn = get('actorEditModalClose');
  if (closeBtn) closeBtn.onclick = closeActorModal;

  get('actorEditSave').onclick = saveActor;
  get('actorEditRemove').onclick = deleteActor;

  // Close only on a genuine click on the backdrop: both mousedown and mouseup
  // must start/end on the backdrop itself, so selecting text inside the modal
  // and releasing the mouse outside its perimeter doesn't close it.
  const modal = get('actorEditModal');
  if (modal) {
    let mouseDownOnBackdrop = false;
    modal.onmousedown = (e) => { mouseDownOnBackdrop = (e.target === modal); };
    modal.onmouseup = (e) => {
      if (mouseDownOnBackdrop && e.target === modal) closeActorModal();
      mouseDownOnBackdrop = false;
    };
  }

  get('actorEditThumb').oninput = (e) => updateActorPreview(e.target.value);

  get('actorEditSearch').onclick = searchActor;

  const uploadBtn = get('actorEditUploadBtn');
  if (uploadBtn) uploadBtn.onclick = uploadActorImage;

  const deletePhotoBtn = get('actorEditDeletePhoto');
  if (deletePhotoBtn) deletePhotoBtn.onclick = deleteActorImage;
}

window.ActorModal = {
  setActorModalMode,
  registerMovieContextHandlers,
  openActorModal,
  closeActorModal,
  updateActorPreview,
  saveActor,
  deleteActor,
  searchActor,
  deleteActorImage,
  uploadActorImage,
  setupActorModalEventListeners,
  get unifiedCurrentActor() { return unifiedCurrentActor; }
};
