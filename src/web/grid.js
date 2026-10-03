// Browse state: scrape items are few enough to load in full up front;
// library items are paginated from the server (see /item/library-list) so a
// huge library doesn't have to be fully scanned/built before anything shows.
let scrapeItems = [];
let scrapeItemsLoaded = false;
let libraryItems = [];
let libraryOffset = 0;
let libraryHasMore = true;
const LIBRARY_PAGE_SIZE = 60;

// Search state: null means "browsing" (render scrapeItems + libraryItems).
// A non-null array means "showing search results" — fetched in full from
// the server (see /item/library-search) since a query can match anywhere in
// the library, not just whatever pages happen to be loaded so far.
let searchResults = null;
let currentSearchQuery = '';

let currentMode = 'scrape';
let currentConfig = {};

// SEARCH_FILTER_STORAGE_KEY and IDS_FILTER_STORAGE_KEY are declared by
// navbar-loader.js (loaded first on grid.html) and shared here as globals —
// do not redeclare them in this file.

let isLoadingMore = false;

// Guards loadMoreItems() against the IntersectionObserver firing (a short
// or still-empty grid can put the scroll sentinel in view immediately)
// before this initial restore has decided browse vs. filtered — otherwise
// a premature page of the plain alphabetical listing can load and get
// appended once the real (filtered) results arrive right after, showing up
// as unrelated movies tacked onto the end of an actor's filtered list.
let initialLoadComplete = false;

document.addEventListener('DOMContentLoaded', async () => {
  await initializeI18n();
  setupEventListeners();
  setupInfiniteScroll();

  // Restore the active filter, most explicit first: a deep link
  // (?actorId=<id>, e.g. an actor's "N movies" link — kept short instead of
  // carrying the whole movie list, which could otherwise grow past a safe
  // URL length for a prolific actor) wins over one carried over from edit
  // mode (sessionStorage, so it survives navigating here), which wins over
  // a text search deep link (?search=<name>), which wins over a
  // carried-over text search, which wins over nothing. ?ids=... is still
  // accepted for robustness (e.g. an old bookmarked link).
  const urlParams = new URLSearchParams(window.location.search);
  const actorIdParam = urlParams.get('actorId');
  const idsParam = urlParams.get('ids');
  const savedIdsFilter = readIdsFilterStorage();
  const searchParam = urlParams.get('search') || sessionStorage.getItem(SEARCH_FILTER_STORAGE_KEY);

  if (actorIdParam) {
    try {
      const res = await fetch(`/api/actors/${encodeURIComponent(actorIdParam)}/movies`);
      const data = await res.json();
      const ids = (data.ok && Array.isArray(data.movieIds)) ? data.movieIds : [];
      await applyIdsFilterLocal(ids, savedIdsFilter ? savedIdsFilter.label : null, { persist: true });
    } catch (err) {
      console.error('[Grid] Failed to load actor movies:', err);
      await resetAndBrowse();
    }
  } else if (idsParam) {
    // The URL never carries a label (keeps it short/shareable) — pull it
    // from the just-saved sessionStorage entry when present (the click that
    // set this URL just saved it there too), instead of persisting a blank
    // label that would then also clobber it for edit mode's own restore.
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
    await applyIdsFilterLocal(ids, savedIdsFilter ? savedIdsFilter.label : null, { persist: true });
  } else if (savedIdsFilter) {
    await applyIdsFilterLocal(savedIdsFilter.ids, savedIdsFilter.label, { persist: false });
  } else if (searchParam) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = searchParam;
    await applySearchQuery(searchParam);
  } else {
    await resetAndBrowse();
  }

  initialLoadComplete = true;
});

function readIdsFilterStorage() {
  const raw = sessionStorage.getItem(IDS_FILTER_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return (parsed && Array.isArray(parsed.ids) && parsed.ids.length > 0) ? parsed : null;
  } catch (_) {
    return null;
  }
}

let lastGridFilterCount = 0;
let lastGridFilterLabel = null;

function showGridFilterBadge(count, label) {
  const badge = document.getElementById('gridFilterBadge');
  const text = document.getElementById('gridFilterBadgeText');
  if (!badge || !text) return;
  lastGridFilterCount = count;
  lastGridFilterLabel = label || null;
  text.textContent = formatIdsFilterBadge(count, lastGridFilterLabel);
  badge.style.display = 'flex';
}

function hideGridFilterBadge() {
  const badge = document.getElementById('gridFilterBadge');
  if (badge) badge.style.display = 'none';
}

// Show exactly this set of library item ids (e.g. an actor's "N movies"
// link) — unlike applySearchQuery(), this never touches scrape items.
// `persist`: whether to (re-)save this as the active cross-page filter —
// false when restoring from that same saved state, to avoid re-writing it
// with an identical value on every load.
async function applyIdsFilterLocal(ids, label, { persist = true } = {}) {
  currentSearchQuery = '';
  if (!ids || ids.length === 0) {
    searchResults = [];
    hideGridFilterBadge();
    renderFromScratch();
    return;
  }

  if (persist) {
    sessionStorage.setItem(IDS_FILTER_STORAGE_KEY, JSON.stringify({ ids, label: label || null }));
    sessionStorage.removeItem(SEARCH_FILTER_STORAGE_KEY);
  }

  showLoading(true);
  try {
    // POST, not GET+query string — a prolific actor's movie list can grow
    // past what's safe to put in a URL.
    const res = await fetch('/item/library-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await res.json();
    const matchedLibrary = (data.ok ? data.items : []).map(item => ({ ...item, mode: 'edit' }));
    searchResults = sortByStatus(matchedLibrary);
    showGridFilterBadge(matchedLibrary.length, label);
    renderFromScratch();
  } catch (error) {
    console.error('Ids filter failed:', error);
    searchResults = [];
    hideGridFilterBadge();
    renderFromScratch();
  } finally {
    showLoading(false);
  }
}

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
    if (lastGridFilterCount > 0) showGridFilterBadge(lastGridFilterCount, lastGridFilterLabel);
  });
}

function setupEventListeners() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounce);
      const value = e.target.value;
      debounce = setTimeout(() => applySearchQuery(value), 250);
    });
  }

  const gridFilterClear = document.getElementById('gridFilterClear');
  if (gridFilterClear) {
    gridFilterClear.addEventListener('click', async () => {
      sessionStorage.removeItem(IDS_FILTER_STORAGE_KEY);
      // Also clears the Next/Previous restriction server-side, in case edit
      // mode is visited next — best-effort, grid.html doesn't otherwise
      // depend on this endpoint.
      fetch('/item/filter/clear', { method: 'POST' }).catch(() => {});
      const url = new URL(window.location.href);
      url.searchParams.delete('ids');
      url.searchParams.delete('actorId');
      history.pushState({}, '', url);
      await resetAndBrowse();
    });
  }
}

// Every currently-loaded item, scrape and library alike — used by
// selectItem/playItem/deleteItem to look items up by identifier regardless
// of whether they're on screen via browsing or a search.
function allLoadedItems() {
  return searchResults !== null ? searchResults : [...scrapeItems, ...libraryItems];
}

async function applySearchQuery(rawQuery) {
  // Not lowercased: boolean operators (AND / OR / NOT) are uppercase-only,
  // see src/core/searchQuery.js — the server lowercases the terms itself
  const query = (rawQuery || '').trim();
  currentSearchQuery = query;
  hideGridFilterBadge();

  // Keep edit mode's navbar filter in sync, so navigating there carries this
  // search over too (see navbar-loader.js for the other half of this). Text
  // search and an ids filter are mutually exclusive — starting one clears
  // any saved state of the other.
  if (query) {
    sessionStorage.setItem(SEARCH_FILTER_STORAGE_KEY, query);
    sessionStorage.removeItem(IDS_FILTER_STORAGE_KEY);
  } else {
    sessionStorage.removeItem(SEARCH_FILTER_STORAGE_KEY);
  }

  if (!query) {
    searchResults = null;
    // Browsing was never actually loaded if the page started on a search
    // (e.g. the "Movies" deep link) — make sure it has something to show
    // once the query is cleared.
    if (libraryItems.length === 0 && scrapeItems.length === 0) {
      await resetAndBrowse();
    } else {
      renderFromScratch();
    }
    return;
  }

  showLoading(true);
  try {
    // Scrape items are already fully loaded client-side — filter them the
    // same way as before. Library items are searched server-side (see
    // /item/library-search) since paginated browsing no longer holds the
    // whole library to filter here. loadScrapeItemsOnce() is a no-op if
    // browsing already loaded them.
    await loadScrapeItemsOnce();

    const matchedScrape = scrapeItems.filter(item => itemMatchesQuery(item, query));

    const res = await fetch(`/item/library-search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const matchedLibrary = (data.ok ? data.items : []).map(item => ({ ...item, mode: 'edit' }));

    searchResults = sortByStatus([...matchedScrape, ...matchedLibrary]);
    renderFromScratch();
  } catch (error) {
    console.error('Search failed:', error);
    searchResults = [];
    renderFromScratch();
  } finally {
    showLoading(false);
  }
}

function itemMatchesQuery(item, query) {
  const actorNames = item.actorSearchNames && item.actorSearchNames.length > 0
    ? item.actorSearchNames
    : (item.actor || []).flatMap(a => [a.name, a.altName]);

  const searchText = [
    item.id,
    item.filename,
    item.title,
    ...actorNames
  ].filter(Boolean).join(' ').toLowerCase();

  // Plain substring only: boolean queries are evaluated server-side, for library items
  return searchText.includes(query.toLowerCase());
}

function sortByStatus(list) {
  // not matched (scrape) < matched (scrape) < saved (library)
  const getStatus = (item) => {
    if (item.mode === 'edit') return 2;
    if (item.matched === false) return 0;
    return 1;
  };
  return [...list].sort((a, b) => getStatus(a) - getStatus(b));
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

async function loadMoreItems() {
  // The initial browse-vs-filter decision (see DOMContentLoaded) hasn't
  // finished yet — a short/empty grid can put the scroll sentinel in view
  // and fire this before that decision is made, loading a page of the
  // plain alphabetical listing that then gets stuck appended after the
  // real (filtered) results once they arrive.
  if (!initialLoadComplete) return;
  // Search results are fetched in full up front — nothing more to page in.
  if (searchResults !== null || !libraryHasMore) return;

  isLoadingMore = true;
  try {
    const res = await fetch(`/item/library-list?offset=${libraryOffset}&limit=${LIBRARY_PAGE_SIZE}`);
    const data = await res.json();
    if (!data.ok) return;

    const newItems = data.items.map(item => ({ ...item, mode: 'edit' }));
    libraryItems = [...libraryItems, ...newItems];
    libraryOffset += data.items.length;
    libraryHasMore = data.hasMore;

    appendCards(newItems);

    // A page can come back with 0 usable items (e.g. every item in this
    // batch was stale and got skipped) while more are still available
    // further in — keep going instead of stalling the scroll trigger.
    if (newItems.length === 0 && libraryHasMore) {
      isLoadingMore = false;
      await loadMoreItems();
      return;
    }
  } catch (error) {
    console.error('Failed to load more items:', error);
  } finally {
    isLoadingMore = false;
  }
}

async function loadScrapeItemsOnce(force = false) {
  if (scrapeItemsLoaded && !force) return;

  const configRes = await fetch('/item/config');
  const configData = await configRes.json();
  if (configData.ok) {
    currentMode = configData.config.mode || 'scrape';
    currentConfig = configData.config;
  }

  const scrapeRes = await fetch('/item/scrape-list');
  const scrapeData = await scrapeRes.json();
  scrapeItems = sortByStatus((scrapeData.ok ? scrapeData.items : []).map(item => ({ ...item, mode: 'scrape' })));
  scrapeItemsLoaded = true;
}

// (Re)starts browsing from the first page — used on initial load and after
// anything that invalidates the current listing (delete, clearing a search).
async function resetAndBrowse() {
  libraryItems = [];
  libraryOffset = 0;
  libraryHasMore = true;
  searchResults = null;
  hideGridFilterBadge();

  showLoading(true);
  try {
    await loadScrapeItemsOnce(true);

    const res = await fetch(`/item/library-list?offset=0&limit=${LIBRARY_PAGE_SIZE}`);
    const data = await res.json();
    if (data.ok) {
      libraryItems = data.items.map(item => ({ ...item, mode: 'edit' }));
      libraryOffset = data.items.length;
      libraryHasMore = data.hasMore;
    }

    renderFromScratch();
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

function renderFromScratch() {
  const grid = document.getElementById('itemsGrid');
  const displayItems = allLoadedItems();

  if (displayItems.length === 0) {
    showEmptyState();
    return;
  }

  document.getElementById('emptyState').style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';
  appendCards(displayItems);
}

function appendCards(itemsToAppend) {
  const grid = document.getElementById('itemsGrid');
  grid.style.display = 'grid';
  document.getElementById('emptyState').style.display = 'none';
  itemsToAppend.forEach(item => {
    const card = createItemCard(item);
    grid.appendChild(card);
  });
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
  // Actor ids are app-generated slugs (safe to interpolate); names are
  // free text and only ever used as plain innerHTML text below, same as
  // before — never inside an attribute.
  const actorNamesHtml = actors.map(a => {
    const label = a.name || a.altName || "Missing Name";
    return a.id
      ? `<span class="item-actor-link" data-actor-id="${a.id}" title="${label.replace(/"/g, '&quot;')}">${label}</span>`
      : `<span>${label}</span>`;
  }).join(', ');

  const genres = item.genre || [];
  const genreText = Array.isArray(genres) ? genres.slice(0, 3).join(', ') : '';
  const genresLower = Array.isArray(genres) ? genres.map(g => String(g).toLowerCase()) : [];
  const badges = currentConfig.badges || {};
  const isLeaked = badges.leaked !== false && genresLower.includes('leaked');
  const isDecensored = badges.decensored !== false && genresLower.includes('decensored');
  const isUncensored = badges.uncensored !== false && genresLower.includes('uncensored');

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
      ${(isLeaked || isDecensored || isUncensored) ? `
        <div class="item-cover-badges">
          ${isLeaked ? '<img src="images/lk.png" alt="Leaked" title="Leaked">' : ''}
          ${isDecensored ? '<img src="images/dc.png" alt="Decensored" title="Decensored">' : ''}
          ${isUncensored ? '<img src="images/unc.png" alt="Uncensored" title="Uncensored">' : ''}
        </div>
      ` : ''}
    </div>
    <div class="item-info">
      <div class="item-header">
        <div class="item-id">${item.id || 'Unknown ID'}</div>
        ${item.libraryRoot ? `<span class="status-badge status-root"></span>` : ''}
        ${statusBadge}
      </div>
      ${!isNotMatched ? `<div class="item-filename">${item.filename || ''}</div>` : ''}
      ${!isNotMatched && genreText ? `<div class="item-meta">${genres.slice(0, 3).map(g => `<span class="meta-tag">${g}</span>`).join('')}</div>` : ''}
      ${!isNotMatched && actors.length > 0 ? `
        <div class="item-actors">
          <div class="item-actors-label" data-i18n="grid.actors">Actors</div>
          <div class="item-actors-list">${actorNamesHtml}</div>
        </div>
      ` : ''}
      ${!isNotMatched ? `
        <div class="item-actions">
          <button class="btn btn-primary" data-action="select">
            <span data-i18n="buttons.select">SELECT</span>
          </button>
          <button class="btn btn-play" data-action="play" title="Play">
            ▶
          </button>
          <button class="btn btn-danger" data-action="delete">
            🗑️
          </button>
        </div>
      ` : ''}
    </div>
  `;

  // Wired here, not as inline onclick: library ids are folder paths and may
  // contain quotes that would break an inline JS string
  const identifier = item.folderId || item.id || item.filename;
  const rootBadge = card.querySelector('.status-root');
  if (rootBadge) {
    rootBadge.textContent = item.libraryRoot;
    rootBadge.title = item.folderId || '';
  }
  const actionBtn = (action) => card.querySelector(`[data-action="${action}"]`);
  if (actionBtn('select')) {
    actionBtn('select').onclick = () => selectItem(identifier);
    actionBtn('play').onclick = () => playItem(identifier);
    // Library items are deleted by folder (two roots can hold the same movie id)
    actionBtn('delete').onclick = () => deleteItem(item.mode === 'edit' ? item.folderId : item.id, item.mode || 'scrape');
  }

  // An actor name on a movie card jumps to exactly that actor's own known
  // movies — see applyActorMoviesFilter in navbar-loader.js, which (since
  // applyIdsFilterLocal exists here on grid.html) applies it in place, no
  // reload, and also saves it as the active cross-page filter so it's still
  // applied to Next/Previous if the user then switches to edit mode.
  card.querySelectorAll('.item-actor-link').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (window.applyActorMoviesFilter) window.applyActorMoviesFilter(el.dataset.actorId, el.title);
    });
  });

  return card;
}

async function selectItem(identifier) {
  try {
    const item = allLoadedItems().find(i =>
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
      body: JSON.stringify(itemMode === 'scrape' ? { filename: itemId } : { folderId: itemId })
    });

    const result = await response.json();

    if (result.ok) {
      // Reload from scratch to refresh the grid (re-run the active search, if
      // any) — force scrape items to be refetched either way, since the
      // deleted item could have been one of them.
      scrapeItemsLoaded = false;
      if (currentSearchQuery) {
        await applySearchQuery(currentSearchQuery);
      } else {
        await resetAndBrowse();
      }
    } else {
      alert('Failed to delete item: ' + (result.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Failed to delete item:', error);
    alert('Error deleting item');
  }
}

async function playItem(identifier) {
  const item = allLoadedItems().find(i =>
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
