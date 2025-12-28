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
  loadActors();

  // Wait for modal to be loaded before setting up event listeners
  if (document.getElementById('actorEditModal')) {
    setupEventListeners();
  } else {
    window.addEventListener('actorModalLoaded', () => {
      setupEventListeners();
    });
  }
});

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

  if (actor.thumb) {
    const img = document.createElement('img');
    img.src = actor.thumb;
    img.alt = actor.name;
    img.onerror = () => {
      thumb.innerHTML = '👤';
    };
    thumb.appendChild(img);
  } else {
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

  // Show/hide delete button
  deleteBtn.style.display = isNewActor ? 'none' : 'block';

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

  if (thumbUrl) {
    img.src = thumbUrl;
    img.style.display = 'block';
    placeholder.style.display = 'none';

    img.onerror = () => {
      img.style.display = 'none';
      placeholder.style.display = 'block';
    };
  } else {
    img.style.display = 'none';
    placeholder.style.display = 'block';
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

  const actorData = {
    id: currentActor?.id || null,
    name: name,
    altName: document.getElementById('actorEditAltName').value.trim(),
    role: document.getElementById('actorEditRole').value.trim(),
    thumb: document.getElementById('actorEditThumb').value.trim(),
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

    // Fill form with found data
    if (actor.altName) document.getElementById('actorEditAltName').value = actor.altName;
    if (actor.thumb) {
      document.getElementById('actorEditThumb').value = actor.thumb;
      updatePreview(actor.thumb);
    }
    if (actor.birthdate) document.getElementById('actorEditBirthdate').value = actor.birthdate;
    if (actor.height) document.getElementById('actorEditHeight').value = actor.height;
    if (actor.bust) document.getElementById('actorEditBust').value = actor.bust;
    if (actor.waist) document.getElementById('actorEditWaist').value = actor.waist;
    if (actor.hips) document.getElementById('actorEditHips').value = actor.hips;

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
    btnText.textContent = 'Cerca Attore';

    // Hide status after 3 seconds
    setTimeout(() => {
      status.style.display = 'none';
      status.style.color = '#666';
    }, 3000);
  }
}
