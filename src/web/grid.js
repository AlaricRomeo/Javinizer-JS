let items = [];
let filteredItems = [];
let currentMode = 'scrape';

// Lazy loading config
const ITEMS_PER_PAGE = 30; // ~10 rows x 3 columns
let displayedCount = 0;
let isLoadingMore = false;

document.addEventListener('DOMContentLoaded', async () => {
  await initializeI18n();
  await loadItems();
  setupEventListeners();
  setupInfiniteScroll();
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
        ...(item.actor || []).map(a => {
          // Se c'è il nome usa il nome
          if (a.name) return a.name;
          // Se non c'è il nome usa l'alternate name
          if (a.altName) return a.altName;
          // Se non c'è né il nome né l'alternate name usa "Missing Name"
          return "Missing Name";
        })
      ].filter(Boolean).join(' ').toLowerCase();

      return searchText.includes(query);
    });
  }

  // Reset pagination when searching
  displayedCount = 0;
  renderItems();
}

function setupInfiniteScroll() {
  // Use IntersectionObserver for efficient scroll detection
  const sentinel = document.createElement('div');
  sentinel.id = 'scrollSentinel';
  sentinel.style.height = '1px';
  document.getElementById('itemsGrid').after(sentinel);

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !isLoadingMore) {
      loadMoreItems();
    }
  }, {
    rootMargin: '200px' // Load 200px before reaching the end
  });

  observer.observe(sentinel);
}

function loadMoreItems() {
  if (displayedCount >= filteredItems.length) return;

  isLoadingMore = true;
  const grid = document.getElementById('itemsGrid');
  const nextBatch = filteredItems.slice(displayedCount, displayedCount + ITEMS_PER_PAGE);

  nextBatch.forEach(item => {
    const card = createItemCard(item);
    grid.appendChild(card);
  });

  displayedCount += nextBatch.length;
  isLoadingMore = false;
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

  // Only render first batch, rest will be loaded on scroll
  const initialBatch = filteredItems.slice(0, ITEMS_PER_PAGE);
  initialBatch.forEach(item => {
    const card = createItemCard(item);
    grid.appendChild(card);
  });

  displayedCount = initialBatch.length;
}

function createItemCard(item) {
  const card = document.createElement('div');
  card.className = 'item-card';

  const isMatched = item.mode === 'edit' || item.matched !== false;
  const isNotMatched = !isMatched;

  const coverUrl = item.coverUrl || '';
  const remoteCoverUrl = item.remoteCoverUrl || '';
  const hasCover = coverUrl && coverUrl.trim() !== '';

  const actors = item.actor || [];
  const actorNames = actors.map(a => {
    // Se c'è il nome visualizza il nome
    if (a.name) return a.name;
    // Se non c'è il nome visualizza l'alternate name
    if (a.altName) return a.altName;
    // Se non c'è né il nome né l'alternate name visualizza "Missing Name"
    return "Missing Name";
  }).join(', ');

  const genres = item.genre || [];
  const genreText = Array.isArray(genres) ? genres.slice(0, 3).join(', ') : '';

  let statusBadge = '';
  if (item.mode === 'edit') {
    statusBadge = '<span class="status-badge status-saved">SAVED</span>';
  } else if (isMatched) {
    statusBadge = '<span class="status-badge status-scraped">SCRAPED</span>';
  }

  // For edit mode items, try local cover first, fallback to remote
  const imgErrorHandler = remoteCoverUrl
    ? `onerror="this.onerror=null; this.src='${remoteCoverUrl}'"`
    : `onerror="this.style.display='none'; this.nextElementSibling.style.display='inline'"`;

  card.innerHTML = `
    <div class="item-cover">
      ${hasCover
        ? `<img src="${coverUrl}" alt="${item.id || 'Cover'}" loading="lazy" ${imgErrorHandler}><span class="placeholder" style="display:none">📁</span>`
        : '<span class="placeholder">📁</span>'}
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
          <button class="btn btn-primary" onclick="selectItem('${item.folderId || item.id || item.filename}')">
            <span data-i18n="buttons.select">SELECT</span>
          </button>
          <button class="btn btn-play" onclick="playItem('${item.folderId || item.id || item.filename}')" title="Play">
            ▶
          </button>
          <button class="btn btn-danger" onclick="deleteItem('${item.id}', '${item.mode || 'scrape'}')">
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
      i.folderId === identifier || i.id === identifier || i.filename === identifier
    );

    if (!item) {
      console.error('Item not found:', identifier);
      return;
    }

    const itemMode = item.mode || 'scrape';

    // Navigate to home with mode and item ID parameters
    window.location.href = `/?mode=${itemMode}&item=${encodeURIComponent(identifier)}`;
  } catch (error) {
    console.error('Failed to select item:', error);
  }
}

async function deleteItem(identifier, mode) {
  const confirmMsg = window.i18n
    ? window.i18n.t('messages.confirmDeleteItem')
    : 'Are you sure you want to delete this item?';

  if (!confirm(confirmMsg)) {
    return;
  }

  try {
    // Use the mode passed from the button or fallback to 'scrape' if not provided
    const itemMode = mode || 'scrape';

    // Use the identifier directly as the filename for deletion
    const itemId = identifier;

    const endpoint = itemMode === 'scrape' ? '/item/scrape-delete' : '/item/library-delete';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: itemId })
    });

    const result = await response.json();

    if (result.ok) {
      // Reload items to refresh the grid
      await loadItems();
    } else {
      alert('Failed to delete item: ' + (result.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Failed to delete item:', error);
    alert('Error deleting item');
  }
}

async function playItem(identifier) {
  const item = items.find(i =>
    i.folderId === identifier || i.id === identifier || i.filename === identifier
  );

  if (!item) {
    console.error('Item not found:', identifier);
    return;
  }

  try {
    // Get video player path from config
    const configRes = await fetch('/item/config');
    const configData = await configRes.json();
    const videoPlayerPath = configData.ok ? configData.config.videoPlayerPath : null;

    if (!videoPlayerPath || videoPlayerPath.trim() === '') {
      alert(window.i18n ? window.i18n.t('messages.videoPlayerNotConfigured') : 'Video player path not configured');
      return;
    }

    // Get video path based on mode
    let videoPath = null;

    if (item.mode === 'scrape') {
      // For scrape items, videoFile is already in the item data
      if (item.videoFile) {
        videoPath = item.videoFile;
      } else if (item.id) {
        // Fallback: fetch from API
        const response = await fetch(`/item/scrape/video/${encodeURIComponent(item.id)}`);
        const data = await response.json();
        if (data.ok && data.videoFile) {
          videoPath = data.videoFile;
        }
      }
    } else if (item.mode === 'edit') {
      // For library items, get video from folder
      const folderId = item.folderId || item.id;
      const response = await fetch(`/item/videos/${encodeURIComponent(folderId)}`);
      const data = await response.json();
      if (data.ok && data.videos && data.videos.length > 0) {
        videoPath = data.videos[0];
      }
    }

    if (!videoPath) {
      alert(window.i18n ? window.i18n.t('messages.videoNotFound') : 'Video file not found');
      return;
    }

    // Play the video
    const response = await fetch('/item/play-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath: videoPath,
        videoPlayerPath: videoPlayerPath
      })
    });

    const result = await response.json();

    if (!result.ok) {
      alert('Error: ' + (result.error || 'Failed to play video'));
    }
  } catch (error) {
    console.error('Failed to play video:', error);
    alert('Error playing video');
  }
}
