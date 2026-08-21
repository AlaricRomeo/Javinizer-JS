// ─────────────────────────────
// Navbar Component Loader
// ─────────────────────────────

// Shared with grid.js — lets the active search/filter query survive a full
// page navigation between edit mode and grid view (sessionStorage, not
// localStorage, so it doesn't leak into a totally separate browser session).
const SEARCH_FILTER_STORAGE_KEY = 'javinizer_searchFilter';

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

  let lastFilterQuery = null;
  let lastFilterCount = 0;

  function showFilterBadge(query, count) {
    if (!filterBadge) return;
    lastFilterQuery = query;
    lastFilterCount = count;
    filterBadgeText.textContent = window.i18n
      ? window.i18n.t('nav.filterActive', { query, count })
      : `Filter: "${query}" (${count})`;
    filterBadge.style.display = 'flex';
  }

  // The saved-filter restore on init can run before this page's own i18n
  // init finishes loading translations, showing the raw "nav.filterActive"
  // key briefly — re-render the badge text once translations are ready.
  window.addEventListener('i18nLoaded', () => {
    if (filterBadge && filterBadge.style.display === 'flex' && lastFilterQuery !== null) {
      showFilterBadge(lastFilterQuery, lastFilterCount);
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
    } else {
      hideFilterBadge();
      sessionStorage.removeItem(SEARCH_FILTER_STORAGE_KEY);
      if (!silent) alert(window.i18n ? window.i18n.t('messages.noResultsFound') : 'No results found');
    }
  }

  // Resume a filter that was active before navigating here from grid view
  // (or before a page reload) — see grid.js for the other half of this.
  // The input itself is left empty, same as right after committing any
  // filter normally; only the badge (and the underlying server-side filter)
  // needs to reappear.
  const savedFilterQuery = sessionStorage.getItem(SEARCH_FILTER_STORAGE_KEY);
  if (savedFilterQuery) applyAsFilter(savedFilterQuery, true);

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
          div.innerHTML = `<span class="sri-id">${item.id}</span>${item.title ? `<span class="sri-title"> — ${item.title}</span>` : ''}`;
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
