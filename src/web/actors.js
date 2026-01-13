// ============================================
// Actors Page - Main JavaScript
// Uses same modal IDs as index.html
// ============================================

let actors = [];
let filteredActors = [];
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
  // Set the modal mode to 'library' for actors.html context
  if (window.ActorModal) {
    ActorModal.setActorModalMode('library');
    ActorModal.setupActorModalEventListeners();
  }

  // Add actor button
  document.getElementById('addActorBtn').addEventListener('click', () => {
    openActorModal(null);
  });

  // Search input
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
  }

  // Event listeners are handled by the unified system
  // The unified system will handle all modal operations
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();

  if (!query) {
    filteredActors = actors;
  } else {
    filteredActors = actors.filter(actor => {
      const searchText = [
        actor.id,
        actor.name,
        actor.altName,
        ...(actor.otherNames || [])
      ].filter(Boolean).join(' ').toLowerCase();

      return searchText.includes(query);
    });
  }

  renderActors();
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
    filteredActors = actors;
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

  if (filteredActors.length === 0) {
    showEmptyState();
    return;
  }

  document.getElementById('emptyState').style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  filteredActors.forEach(actor => {
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
// Modal Management - Using Unified Actor Modal System
// ============================================

function openActorModal(actor) {
  // Set the modal mode to 'library' for actors.html context and use unified system
  ActorModal.setActorModalMode('library');
  ActorModal.openActorModal(actor);
}

function closeModal() {
  // Use unified system
  ActorModal.closeActorModal();
}

function updatePreview(thumbUrl) {
  // Use unified system
  ActorModal.updateActorPreview(thumbUrl);
}

// ============================================
// Save Actor - Using Unified Actor Modal System
// ============================================

async function saveActor() {
  // Use unified system
  await ActorModal.saveActor();
}

// ============================================
// Delete Actor - Using Unified Actor Modal System
// ============================================

async function deleteActor() {
  // Use unified system
  await ActorModal.deleteActor();
}

// ============================================
// Search Actor - Using Unified Actor Modal System
// ============================================

async function searchActor() {
  // Use unified system
  await ActorModal.searchActor();
}

// ============================================
// Delete Actor Image
// ============================================

async function deleteActorImage() {
  // Use the unified system's current actor variable
  const currentActor = window.ActorModal.unifiedCurrentActor;
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
