let items = [];
let filteredItems = [];
let currentMode = 'scrape';

document.addEventListener('DOMContentLoaded', async () => {
  await initializeI18n();
  await loadItems();
  setupEventListeners();
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

      const selector = document.getElementById('languageSelector');
      if (selector) {
        selector.value = lang;
      }
    }
  } catch (err) {
    console.error("Failed to initialize i18n:", err);
  }

  window.addEventListener('languageChanged', () => {
    if (window.i18n) {
      window.i18n.applyTranslations();
      if (window.applyI18nBindings) window.applyI18nBindings();
    }
  });
}

function setupEventListeners() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
  }
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();

  if (!query) {
    filteredItems = items;
  } else {
    filteredItems = items.filter(item => {
      const searchText = [
        item.id,
        item.filename,
        item.title,
        ...(item.actor || []).map(a => a.name)
      ].filter(Boolean).join(' ').toLowerCase();

      return searchText.includes(query);
    });
  }

  renderItems();
}

async function loadItems() {
  try {
    showLoading(true);

    const configRes = await fetch('/item/config');
    const configData = await configRes.json();

    if (configData.ok) {
      currentMode = configData.config.mode || 'scrape';
    }

    const scrapeRes = await fetch('/item/scrape-list');
    const scrapeData = await scrapeRes.json();

    const libraryRes = await fetch('/item/library-list');
    const libraryData = await libraryRes.json();

    const scrapeItems = (scrapeData.ok ? scrapeData.items : []).map(item => ({
      ...item,
      mode: 'scrape'
    }));

    const libraryItems = (libraryData.ok ? libraryData.items : []).map(item => ({
      ...item,
      mode: 'edit'
    }));

    items = [...scrapeItems, ...libraryItems];

    // Sort: not matched, scraped, saved
    items.sort((a, b) => {
      const getStatus = (item) => {
        if (item.mode === 'edit') return 2; // saved
        if (item.matched === false) return 0; // not matched
        return 1; // scraped
      };
      return getStatus(a) - getStatus(b);
    });

    filteredItems = items;
    renderItems();

  } catch (error) {
    console.error('Failed to load items:', error);
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
  document.getElementById('itemsGrid').style.display = 'none';
}

function renderItems() {
  const grid = document.getElementById('itemsGrid');

  if (filteredItems.length === 0) {
    showEmptyState();
    return;
  }

  document.getElementById('emptyState').style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  filteredItems.forEach(item => {
    const card = createItemCard(item);
    grid.appendChild(card);
  });
}

function createItemCard(item) {
  const card = document.createElement('div');
  card.className = 'item-card';

  const isMatched = item.mode === 'edit' || (item.matched !== false && item.title && item.title.trim() !== '');
  const isNotMatched = !isMatched;

  const coverUrl = item.coverUrl || '';
  const hasCover = coverUrl && coverUrl.trim() !== '';

  const actors = item.actor || [];
  const actorNames = actors.map(a => a.name).filter(Boolean).join(', ');

  const genres = item.genre || [];
  const genreText = Array.isArray(genres) ? genres.slice(0, 3).join(', ') : '';

  let statusBadge = '';
  if (item.mode === 'edit') {
    statusBadge = '<span class="status-badge status-saved">SAVED</span>';
  } else if (isMatched) {
    statusBadge = '<span class="status-badge status-scraped">SCRAPED</span>';
  }

  card.innerHTML = `
    <div class="item-cover">
      ${hasCover ? `<img src="${coverUrl}" alt="${item.id || 'Cover'}" loading="lazy">` : '<span class="placeholder">📁</span>'}
    </div>
    <div class="item-info">
      <div class="item-header">
        <div class="item-id">${item.id || 'Unknown ID'}</div>
        ${statusBadge}
      </div>
      ${!isNotMatched ? `<div class="item-filename">${item.filename || ''}</div>` : ''}
      ${!isNotMatched && genreText ? `<div class="item-meta">${genres.slice(0, 3).map(g => `<span class="meta-tag">${g}</span>`).join('')}</div>` : ''}
      ${!isNotMatched && actorNames ? `
        <div class="item-actors">
          <div class="item-actors-label" data-i18n="grid.actors">Actors</div>
          <div class="item-actors-list">${actorNames}</div>
        </div>
      ` : ''}
      ${!isNotMatched ? `
        <div class="item-actions">
          <button class="btn btn-primary" onclick="selectItem('${item.id || item.filename}')">
            <span data-i18n="buttons.select">SELECT</span>
          </button>
          <button class="btn btn-danger" onclick="deleteItem('${item.id || item.filename}')">
            🗑️
          </button>
        </div>
      ` : ''}
    </div>
  `;

  return card;
}

async function selectItem(identifier) {
  try {
    const item = items.find(i =>
      (i.id && i.id === identifier) || i.filename === identifier
    );

    if (!item) {
      console.error('Item not found:', identifier);
      return;
    }

    const itemMode = item.mode || 'scrape';
    const modeItems = items.filter(i => i.mode === itemMode);
    const index = modeItems.findIndex(i =>
      (i.id && i.id === identifier) || i.filename === identifier
    );

    if (index === -1) {
      console.error('Item index not found in mode:', itemMode);
      return;
    }

    // Navigate to home with mode and item ID parameters
    window.location.href = `/?mode=${itemMode}&item=${encodeURIComponent(identifier)}`;
  } catch (error) {
    console.error('Failed to select item:', error);
  }
}

async function deleteItem(identifier) {
  const item = items.find(i =>
    (i.id && i.id === identifier) || i.filename === identifier
  );

  if (!item) return;

  const confirmMsg = window.i18n
    ? window.i18n.t('messages.confirmDeleteItem')
    : 'Are you sure you want to delete this item?';

  if (!confirm(confirmMsg)) {
    return;
  }

  try {
    const itemMode = item.mode || 'scrape';
    const itemId = item.id || item.filename || identifier;

    console.log('Deleting item:', { itemId, mode: itemMode, item });

    const endpoint = itemMode === 'scrape' ? '/item/scrape-delete' : '/item/library-delete';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: itemId })
    });

    const result = await response.json();

    if (result.ok) {
      await loadItems();
    } else {
      alert('Failed to delete item: ' + (result.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Failed to delete item:', error);
    alert('Error deleting item');
  }
}
