// ─────────────────────────────
// Navbar Component Loader
// ─────────────────────────────

// Shared with grid.js — lets the active search/filter query survive a full
// page navigation between edit mode and grid view (sessionStorage, not
// localStorage, so it doesn't leak into a totally separate browser session).
const SEARCH_FILTER_STORAGE_KEY = 'javinizer_searchFilter';

// Same idea as SEARCH_FILTER_STORAGE_KEY, but for an explicit id list
// instead of a text query (e.g. an actor's "N movies" link) — stored as
// JSON {ids, label}. Mutually exclusive with the text filter: setting one
// clears the other (see grid.js and applyIdsAsFilter below).
const IDS_FILTER_STORAGE_KEY = 'javinizer_idsFilter';

// Shared by the navbar's own filter badge (edit mode) and Grid View's own
// badge (grid.js) so both read the same — e.g. 'Filter: "Abeno Miku - 54
// movies"'.
function formatIdsFilterBadge(count, label) {
  if (label) {
    return window.i18n
      ? window.i18n.t('nav.filterActiveMovies', { label, count })
      : `Filter: "${label} - ${count} movie${count === 1 ? '' : 's'}"`;
  }
  return window.i18n
    ? window.i18n.t('nav.filterActiveMoviesNoLabel', { count })
    : `Filter: ${count} movie${count === 1 ? '' : 's'}`;
}

/**
 * Jump to exactly one actor's known movies (real ids from actor_movies) —
 * used by the actor card (actors.js), the actor detail modal
 * (actor-modal.js) and Grid View's own per-actor links (grid.js). Available
 * on every page (unlike the Next/Previous-constraining filter below, which
 * only makes sense in edit mode): it always saves the filter for edit mode
 * to pick up later, and applies it live wherever that's currently possible.
 */
window.applyActorMoviesFilter = async function(actorId, actorName) {
  if (!actorId) return;
  try {
    const res = await fetch(`/api/actors/${encodeURIComponent(actorId)}/movies`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.movieIds) || data.movieIds.length === 0) return;
    const ids = data.movieIds;

    // Edit mode (index.html): constrain Next/Previous right now and show
    // the badge, via the closures set up in initNavbarSearch() below.
    if (window.__applyIdsFilterInPlace) {
      await window.__applyIdsFilterInPlace(ids, actorName);
      return;
    }

    // Anywhere else: just save it as the pending filter (picked up by
    // initNavbarSearch()'s restore-on-init whenever the user does reach
    // edit mode) and go look at the results.
    sessionStorage.setItem(IDS_FILTER_STORAGE_KEY, JSON.stringify({ ids, label: actorName || null }));
    sessionStorage.removeItem(SEARCH_FILTER_STORAGE_KEY);

    if (typeof window.applyIdsFilterLocal === 'function') {
      // Already on grid.html — update in place, no reload. The URL gets
      // just the actor id, not the whole movie list (which for a prolific
      // actor could grow past a safe URL length) — grid.js resolves it back
      // to ids itself when landing on ?actorId=.
      await window.applyIdsFilterLocal(ids, actorName || null, { persist: false });
      const url = new URL(window.location.href);
      url.searchParams.set('actorId', actorId);
      url.searchParams.delete('ids');
      url.searchParams.delete('search');
      history.pushState({}, '', url);
    } else {
      window.location.href = `grid.html?actorId=${encodeURIComponent(actorId)}`;
    }
  } catch (err) {
    console.error('[Filter] Failed to load actor movies:', err);
  }
};

/**
 * Loads the navbar component and initializes it
 */
async function loadNavbar() {
  try {
    // Fetch navbar HTML
    const response = await fetch('/navbar.html');
    const html = await response.text();

    // Create a container for the navbar at the top of body
    const navbarContainer = document.createElement('div');
    navbarContainer.id = 'navbar-container';
    navbarContainer.innerHTML = html;

    // Insert at the beginning of body
    document.body.insertBefore(navbarContainer, document.body.firstChild);

    // Initialize language selector and search
    initLanguageSelector();
    initNavbarSearch();
    initUpdateBadge();
  } catch (error) {
    console.error('Failed to load navbar:', error);
  }
}

/**
 * Shows an "Update available" badge when the server's cached GitHub Releases
 * check (run once at startup, see src/core/updateManager.js) found a newer
 * version. Clicking it downloads and applies the update, which restarts the
 * server — this page then polls /item/update/status until it comes back.
 */
async function initUpdateBadge() {
  const badge = document.getElementById('updateBadge');
  if (!badge) return;

  let latest = null;
  try {
    const res = await fetch('/item/update/check');
    const data = await res.json();
    if (!data.ok || !data.updateAvailable) return;
    latest = data;
  } catch (error) {
    console.error('[Update] Check failed:', error);
    return;
  }

  const t = (key, vars) => window.i18n ? window.i18n.t(key, vars) : key;

  badge.textContent = t('update.available', { version: latest.latestVersion });
  badge.style.display = '';
  badge.addEventListener('click', () => applyUpdate(badge, latest, t));

  // This badge is shown right on page load, which can race ahead of this
  // page's own i18n init (see the identical fix for filterBadge above) and
  // briefly show the raw "update.available" key — re-render once
  // translations are actually loaded.
  window.addEventListener('i18nLoaded', () => {
    if (badge.style.display !== 'none' && !badge.disabled) {
      badge.textContent = t('update.available', { version: latest.latestVersion });
    }
  });
}

async function applyUpdate(badge, latest, t) {
  if (!confirm(t('update.confirmApply', { version: latest.latestVersion }))) return;

  badge.disabled = true;
  badge.textContent = t('update.applying', { version: latest.latestVersion });

  try {
    const res = await fetch('/item/update/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: latest.tag, version: latest.latestVersion })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'unknown error');
  } catch (error) {
    // The server exits right after responding as part of the normal update
    // flow, so a network error here is expected — fall through to polling.
  }

  pollUpdateStatus(badge, latest, t);
}

function pollUpdateStatus(badge, latest, t) {
  const POLL_INTERVAL_MS = 3000;
  const POLL_TIMEOUT_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  const poll = async () => {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      badge.textContent = t('update.applyFailed');
      return;
    }

    try {
      const res = await fetch('/item/update/status');
      const status = await res.json();

      if (status.state === 'complete') {
        badge.textContent = t('update.complete', { version: latest.latestVersion });
        setTimeout(() => window.location.reload(), 1500);
        return;
      }

      // Application files were already swapped successfully (About page
      // will show the new version) — a secondary step like `npm install`
      // or a DB migration failed, but that's not the same as the update
      // itself failing, so it gets its own message instead of applyFailed.
      if (status.state === 'complete_with_warnings') {
        badge.textContent = t('update.completeWithWarnings', { version: latest.latestVersion });
        console.warn('[Update] Completed with warnings:', status.warnings);
        setTimeout(() => window.location.reload(), 2500);
        return;
      }

      if (status.state === 'failed') {
        badge.textContent = t('update.applyFailed');
        console.error('[Update] Failed:', status.error);
        return;
      }
    } catch (error) {
      // Server is mid-restart (old process gone, new one not listening yet) —
      // keep polling silently until it answers again.
      badge.textContent = t('update.waitingForRestart');
    }

    setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}

/**
 * Initialize the language selector dropdown
 */
function initLanguageSelector() {
  const selector = document.getElementById('languageSelector');
  if (!selector) {
    console.error('Language selector not found in navbar');
    return;
  }

  // Function to update selector value based on current language
  const updateSelectorValue = () => {
    const currentLang = window.i18n ? window.i18n.getCurrentLanguage() : 'en';
    selector.value = currentLang;
  };

  // Set initial value
  updateSelectorValue();

  // Handle language change
  selector.addEventListener('change', async (e) => {
    const newLang = e.target.value;

    if (window.i18n) {
      await window.i18n.changeLanguage(newLang);
    }
  });

  // Listen for language changes to update selector
  window.addEventListener('languageChanged', updateSelectorValue);
}

function initNavbarSearch() {
  const input = document.getElementById('navbarSearch');
  const dropdown = document.getElementById('navbarSearchDropdown');
  const container = document.getElementById('navbarSearchContainer');
  const filterBadge = document.getElementById('navbarFilterBadge');
  const filterBadgeText = document.getElementById('navbarFilterBadgeText');
  const filterClearBtn = document.getElementById('navbarFilterClear');
  if (!input) return;

  const pagePath = window.location.pathname;
  const isGrid = pagePath.includes('grid');
  const isMain = !isGrid && (pagePath === '/' || pagePath === '' || pagePath.includes('index') || pagePath.endsWith('/'));

  if (isGrid) {
    // Grid view has its own dedicated search box (#searchInput) right above
    // the grid — a second, synced one up in the navbar was redundant, so
    // the navbar's copy is hidden here instead of kept in sync with it.
    if (container) container.style.display = 'none';
    return;
  }

  if (!isMain) {
    if (container) container.style.display = 'none';
    return;
  }

  // Main page: hidden by default, shown only in edit mode
  if (container) container.style.display = 'none';

  // Expose show/hide so switchMode can control visibility
  window.showNavbarSearch = (visible) => {
    if (container) container.style.display = visible ? '' : 'none';
    if (!visible) { input.value = ''; dropdown.style.display = 'none'; }
  };

  let lastFilterMode = 'text'; // 'text' | 'ids'
  let lastFilterQuery = null;
  let lastFilterLabel = null;
  let lastFilterCount = 0;

  function renderFilterBadge() {
    if (!filterBadge) return;
    if (lastFilterMode === 'ids') {
      filterBadgeText.textContent = formatIdsFilterBadge(lastFilterCount, lastFilterLabel);
    } else {
      filterBadgeText.textContent = window.i18n
        ? window.i18n.t('nav.filterActive', { query: lastFilterQuery, count: lastFilterCount })
        : `Filter: "${lastFilterQuery}" (${lastFilterCount})`;
    }
    filterBadge.style.display = 'flex';
  }

  function showFilterBadge(query, count) {
    lastFilterMode = 'text';
    lastFilterQuery = query;
    lastFilterCount = count;
    renderFilterBadge();
  }

  function showIdsFilterBadge(count, label) {
    lastFilterMode = 'ids';
    lastFilterCount = count;
    lastFilterLabel = label || null;
    renderFilterBadge();
  }

  // The saved-filter restore on init can run before this page's own i18n
  // init finishes loading translations, showing the raw i18n key briefly —
  // re-render the badge text once translations are ready.
  window.addEventListener('i18nLoaded', () => {
    if (filterBadge && filterBadge.style.display === 'flex') {
      renderFilterBadge();
    }
  });

  function hideFilterBadge() {
    if (filterBadge) filterBadge.style.display = 'none';
  }

  if (filterClearBtn) {
    filterClearBtn.addEventListener('click', async () => {
      if (window.clearSearchFilter) await window.clearSearchFilter();
      hideFilterBadge();
      sessionStorage.removeItem(SEARCH_FILTER_STORAGE_KEY);
      sessionStorage.removeItem(IDS_FILTER_STORAGE_KEY);
    });
  }

  // silent: used when restoring a filter saved before a page navigation —
  // no alert on a stale/no-longer-matching query, just drop it quietly.
  async function applyAsFilter(q, silent = false) {
    if (!window.applySearchFilter) return;
    const result = await window.applySearchFilter(q);
    if (result && result.ok && result.count > 0) {
      showFilterBadge(q, result.count);
      sessionStorage.setItem(SEARCH_FILTER_STORAGE_KEY, q);
      sessionStorage.removeItem(IDS_FILTER_STORAGE_KEY);
    } else {
      hideFilterBadge();
      sessionStorage.removeItem(SEARCH_FILTER_STORAGE_KEY);
      if (!silent) alert(window.i18n ? window.i18n.t('messages.noResultsFound') : 'No results found');
    }
  }

  // Same as applyAsFilter, for an explicit id list instead of a text query
  // (e.g. an actor's "N movies" link) — see applyActorMoviesFilter above.
  async function applyIdsAsFilter(ids, label, silent = false) {
    if (!window.applyIdsFilter) return;
    const result = await window.applyIdsFilter(ids);
    if (result && result.ok && result.count > 0) {
      showIdsFilterBadge(result.count, label);
      sessionStorage.setItem(IDS_FILTER_STORAGE_KEY, JSON.stringify({ ids, label: label || null }));
      sessionStorage.removeItem(SEARCH_FILTER_STORAGE_KEY);
    } else {
      hideFilterBadge();
      sessionStorage.removeItem(IDS_FILTER_STORAGE_KEY);
      if (!silent) alert(window.i18n ? window.i18n.t('messages.noResultsFound') : 'No results found');
    }
  }

  // Lets applyActorMoviesFilter (module scope, always available) apply the
  // filter immediately when we're already in edit mode, instead of only
  // saving it for later.
  window.__applyIdsFilterInPlace = (ids, label) => applyIdsAsFilter(ids, label, false);

  // Resume a filter that was active before navigating here from grid view
  // (or before a page reload) — see grid.js for the other half of this.
  // The input itself is left empty, same as right after committing any
  // filter normally; only the badge (and the underlying server-side filter)
  // needs to reappear. An ids filter wins over a text one if somehow both
  // are present (shouldn't normally happen — each clears the other).
  const savedIdsFilterRaw = sessionStorage.getItem(IDS_FILTER_STORAGE_KEY);
  let savedIds = null;
  if (savedIdsFilterRaw) {
    try {
      const parsed = JSON.parse(savedIdsFilterRaw);
      if (parsed && Array.isArray(parsed.ids) && parsed.ids.length > 0) savedIds = parsed;
    } catch (_) { /* ignore malformed saved state */ }
  }

  if (savedIds) {
    applyIdsAsFilter(savedIds.ids, savedIds.label, true);
  } else {
    const savedFilterQuery = sessionStorage.getItem(SEARCH_FILTER_STORAGE_KEY);
    if (savedFilterQuery) applyAsFilter(savedFilterQuery, true);
  }

  let searchTimeout;

  input.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length < 1) { dropdown.style.display = 'none'; return; }

    searchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/item/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!data.ok || !data.results.length) { dropdown.style.display = 'none'; return; }

        dropdown.innerHTML = '';

        // "Use as filter" action: constrains Next/Previous to all matches (data.total),
        // as opposed to clicking a single result below, which jumps once.
        const filterRow = document.createElement('div');
        filterRow.className = 'search-filter-action';
        filterRow.textContent = window.i18n
          ? window.i18n.t('nav.filterResults', { count: data.total })
          : `Filter results (${data.total})`;
        filterRow.addEventListener('click', async () => {
          const q2 = input.value.trim();
          input.value = '';
          dropdown.style.display = 'none';
          await applyAsFilter(q2);
        });
        dropdown.appendChild(filterRow);

        data.results.forEach(item => {
          const div = document.createElement('div');
          div.className = 'search-result-item';
          div.innerHTML = `<span class="sri-id">${item.name || item.id}</span>${item.root ? `<span class="sri-root"> [${item.root}]</span>` : ''}${item.title ? `<span class="sri-title"> — ${item.title}</span>` : ''}`;
          div.addEventListener('click', () => {
            input.value = '';
            dropdown.style.display = 'none';
            if (window.navigateToSearchResult) window.navigateToSearchResult(item);
          });
          dropdown.appendChild(div);
        });
        dropdown.style.display = 'block';
      } catch (err) {
        console.error('[Search] Error:', err);
      }
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; dropdown.style.display = 'none'; }
    if (e.key === 'Enter') {
      const first = dropdown.querySelector('.search-result-item');
      if (first) first.click();
    }
  });
}

// Auto-load navbar when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadNavbar);
} else {
  loadNavbar();
}
