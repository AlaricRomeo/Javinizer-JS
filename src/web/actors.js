// ============================================
// Actors Page - Main JavaScript
// Uses same modal IDs as index.html
// ============================================

let actors = [];
let filteredActors = [];
let currentActor = null;
let isNewActor = false;
let favoritesOnly = true;
let duplicateGroups = [];

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize i18n
  initializeI18n().then(() => {
    loadActors();
    loadDuplicates();
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

  // Favorites / All filter toggle
  document.getElementById('filterAllBtn').addEventListener('click', () => setFavoritesOnly(false));
  document.getElementById('filterFavoritesBtn').addEventListener('click', () => setFavoritesOnly(true));

  // Duplicate actors review modal
  document.getElementById('reviewDuplicatesBtn').addEventListener('click', openMergeModal);
  document.getElementById('mergeModalClose').addEventListener('click', closeMergeModal);
  document.getElementById('mergeModal').addEventListener('click', (e) => {
    if (e.target.id === 'mergeModal') closeMergeModal();
  });

  // Event listeners are handled by the unified system
  // The unified system will handle all modal operations
}

function setFavoritesOnly(value) {
  favoritesOnly = value;
  document.getElementById('filterAllBtn').classList.toggle('active', !value);
  document.getElementById('filterFavoritesBtn').classList.toggle('active', value);
  applyFilters();
}

function handleSearch() {
  applyFilters();
}

function applyFilters() {
  const query = (document.getElementById('searchInput').value || '').toLowerCase().trim();

  filteredActors = actors.filter(actor => {
    if (favoritesOnly && !actor.favorite) return false;

    if (!query) return true;

    const searchText = [
      actor.id,
      actor.name,
      actor.altName
    ].filter(Boolean).join(' ').toLowerCase();

    return searchText.includes(query);
  });

  renderActors();
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
    applyFilters();

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
  // 1. Try local file in actors cache: /actors/{actor.id}.{ext}
  // 2. Fallback to actor.thumb URL
  // 3. Fallback to placeholder

  if (actor.id) {
    // Try to load local file with common extensions
    const extensions = ['webp', 'jpg', 'jpeg', 'png', 'gif'];
    const img = document.createElement('img');
    // Se c'è il nome usa il nome
    if (actor.name) {
      img.alt = actor.name;
    }
    // Se non c'è il nome usa l'alternate name
    else if (actor.altName) {
      img.alt = actor.altName;
    }
    // Se non c'è né il nome né l'alternate name usa "Actor"
    else {
      img.alt = 'Actor';
    }

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
    // Se c'è il nome usa il nome
    if (actor.name) {
      img.alt = actor.name;
    }
    // Se non c'è il nome usa l'alternate name
    else if (actor.altName) {
      img.alt = actor.altName;
    }
    // Se non c'è né il nome né l'alternate name usa "Actor"
    else {
      img.alt = 'Actor';
    }
    img.onerror = () => {
      thumb.innerHTML = '👤';
    };
    thumb.appendChild(img);
  } else {
    // No ID and no thumb, show placeholder
    thumb.innerHTML = '👤';
  }

  // Favorite star toggle
  const star = document.createElement('div');
  star.className = 'actor-favorite-star' + (actor.favorite ? ' active' : '');
  star.innerHTML = '<i class="fas fa-star"></i>';
  star.title = actor.favorite
    ? (window.i18n ? window.i18n.t('actors.unmarkFavorite') : 'Remove from favorites')
    : (window.i18n ? window.i18n.t('actors.markFavorite') : 'Mark as favorite');
  star.onclick = (e) => {
    e.stopPropagation();
    toggleFavorite(actor, star);
  };
  thumb.appendChild(star);

  // Create info
  const info = document.createElement('div');
  info.className = 'actor-info';

  const name = document.createElement('div');
  name.className = 'actor-name';
  // Se c'è il nome visualizza il nome
  if (actor.name) {
    name.textContent = actor.name;
  }
  // Se non c'è il nome visualizza l'alternate name
  else if (actor.altName) {
    name.textContent = actor.altName;
  }
  // Se non c'è né il nome né l'alternate name visualizza "Unknown"
  else {
    name.textContent = 'Unknown';
  }

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

  // Movies link — jumps to the grid view, pre-filled with this actor's name
  const moviesLink = document.createElement('a');
  moviesLink.className = 'actor-movies-link';
  moviesLink.href = `grid.html?search=${encodeURIComponent(actor.name || actor.altName || '')}`;
  moviesLink.innerHTML = `<i class="fas fa-film"></i> <span data-i18n="actors.movies">movies</span>`;
  moviesLink.onclick = (e) => e.stopPropagation();
  info.appendChild(moviesLink);

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
// Favorites
// ============================================

async function toggleFavorite(actor, starEl) {
  const newValue = !actor.favorite;

  try {
    const response = await fetch('/api/actors/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: actor.id, favorite: newValue })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Failed to update favorite');

    actor.favorite = newValue;
    starEl.classList.toggle('active', newValue);
    starEl.title = newValue
      ? (window.i18n ? window.i18n.t('actors.unmarkFavorite') : 'Remove from favorites')
      : (window.i18n ? window.i18n.t('actors.markFavorite') : 'Mark as favorite');

    // Drop the card immediately if we're viewing favorites-only and it was just unfavorited
    if (favoritesOnly && !newValue) {
      applyFilters();
    }
  } catch (error) {
    console.error('Failed to toggle favorite:', error);
    alert(window.i18n ? window.i18n.t('actors.favoriteError') : 'Failed to update favorite');
  }
}

// ============================================
// Duplicate Actors — Review & Merge
// ============================================

async function loadDuplicates() {
  try {
    const response = await fetch('/api/actors/duplicates');
    const data = await response.json();
    duplicateGroups = data.ok ? (data.groups || []) : [];
    renderDuplicatesBanner();
  } catch (error) {
    console.error('Failed to load duplicate actors:', error);
  }
}

function renderDuplicatesBanner() {
  const banner = document.getElementById('duplicatesBanner');
  if (duplicateGroups.length === 0) {
    banner.style.display = 'none';
    return;
  }

  const text = window.i18n
    ? window.i18n.t('actors.duplicatesWarning', { count: duplicateGroups.length })
    : `${duplicateGroups.length} possible duplicate actor(s) found.`;
  document.getElementById('duplicatesBannerText').textContent = text;
  banner.style.display = 'flex';
}

function renderMergeCandidate(actor, otherId) {
  const wrap = document.createElement('div');
  wrap.className = 'merge-candidate';

  if (actor.thumb) {
    const img = document.createElement('img');
    img.alt = actor.name || actor.id;
    img.src = actor.thumb;
    img.onerror = () => {
      img.replaceWith(Object.assign(document.createElement('div'), {
        className: 'merge-candidate-placeholder',
        innerHTML: '👤'
      }));
    };
    wrap.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'merge-candidate-placeholder';
    placeholder.innerHTML = '👤';
    wrap.appendChild(placeholder);
  }

  const name = document.createElement('div');
  name.className = 'merge-candidate-name';
  name.textContent = actor.name || actor.id;
  wrap.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'merge-candidate-meta';
  const movieLabel = window.i18n ? window.i18n.t('actors.movies') : 'movies';
  meta.textContent = `${actor.id} • ${actor.movieCount || 0} ${movieLabel}`;
  wrap.appendChild(meta);

  const keepBtn = document.createElement('button');
  keepBtn.type = 'button';
  keepBtn.className = 'btn btn-success';
  keepBtn.textContent = window.i18n ? window.i18n.t('actors.keepThis') : 'Keep this one';
  keepBtn.onclick = () => confirmMerge(actor, otherId);
  wrap.appendChild(keepBtn);

  return wrap;
}

function renderMergeModal() {
  const body = document.getElementById('mergeModalBody');
  body.innerHTML = '';

  if (duplicateGroups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'merge-empty';
    empty.textContent = window.i18n ? window.i18n.t('actors.noDuplicates') : 'No duplicate actors found.';
    body.appendChild(empty);
    return;
  }

  duplicateGroups.forEach(group => {
    const [a, b] = group.actors;
    if (!a || !b) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'merge-group';

    const shared = document.createElement('div');
    shared.className = 'merge-group-shared';
    const sharedLabel = window.i18n ? window.i18n.t('actors.sharedNames') : 'Shared name(s)';
    const sharedLabelEl = document.createElement('div');
    sharedLabelEl.textContent = `${sharedLabel}: ${group.sharedNames.join(', ')}`;
    shared.appendChild(sharedLabelEl);

    const notSameLabel = window.i18n ? window.i18n.t('actors.notSamePerson') : 'Not the same person — remove from:';
    group.sharedNames.forEach(sharedName => {
      const row = document.createElement('div');
      row.className = 'merge-shared-name-row';

      const rowLabel = document.createElement('span');
      rowLabel.className = 'merge-shared-name-label';
      rowLabel.textContent = `"${sharedName}" — ${notSameLabel}`;
      row.appendChild(rowLabel);

      [a, b].forEach(actor => {
        const isPrimary = (actor.name || '').toLowerCase() === sharedName.toLowerCase();
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-link-remove';
        btn.textContent = actor.name || actor.id;
        btn.disabled = isPrimary;
        if (isPrimary) {
          btn.title = window.i18n ? window.i18n.t('actors.isPrimaryName') : "This is their primary name";
        }
        btn.onclick = () => removeSharedName(actor.id, sharedName, actor.name || actor.id);
        row.appendChild(btn);
      });

      shared.appendChild(row);
    });

    groupEl.appendChild(shared);

    const pair = document.createElement('div');
    pair.className = 'merge-group-pair';
    pair.appendChild(renderMergeCandidate(a, b.id));

    const vs = document.createElement('div');
    vs.className = 'merge-group-vs';
    vs.textContent = window.i18n ? window.i18n.t('actors.mergeVs') : 'vs';
    pair.appendChild(vs);

    pair.appendChild(renderMergeCandidate(b, a.id));

    groupEl.appendChild(pair);
    body.appendChild(groupEl);
  });
}

function openMergeModal() {
  renderMergeModal();
  document.getElementById('mergeModal').style.display = 'flex';
}

function closeMergeModal() {
  document.getElementById('mergeModal').style.display = 'none';
}

async function confirmMerge(winnerActor, loserId) {
  const confirmMsg = window.i18n
    ? window.i18n.t('actors.confirmMerge', { winner: winnerActor.name || winnerActor.id, loser: loserId })
    : `Merge "${loserId}" into "${winnerActor.name || winnerActor.id}"? This cannot be undone.`;
  if (!confirm(confirmMsg)) return;

  try {
    const response = await fetch('/api/actors/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winnerId: winnerActor.id, loserId })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Merge failed');

    await loadDuplicates();
    await loadActors();
    renderMergeModal();
  } catch (error) {
    console.error('Failed to merge actors:', error);
    alert(window.i18n ? window.i18n.t('actors.mergeError') : 'Failed to merge actors');
  }
}

async function removeSharedName(actorId, name, actorLabel) {
  const confirmMsg = window.i18n
    ? window.i18n.t('actors.confirmRemoveName', { name, actor: actorLabel })
    : `Remove "${name}" from ${actorLabel}? They won't be flagged as a duplicate for this name anymore.`;
  if (!confirm(confirmMsg)) return;

  try {
    const response = await fetch('/api/actors/remove-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: actorId, name })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Failed to remove name');

    await loadDuplicates();
    await loadActors();
    renderMergeModal();
  } catch (error) {
    console.error('Failed to remove name:', error);
    alert(window.i18n ? window.i18n.t('actors.removeNameError') : 'Failed to remove name');
  }
}

