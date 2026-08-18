// ─────────────────────────────
// Navbar Component Loader
// ─────────────────────────────

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
  } catch (error) {
    console.error('Failed to load navbar:', error);
  }
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
    // Sync with grid's own search input (bidirectional)
    input.addEventListener('input', (e) => {
      const gridInput = document.getElementById('searchInput');
      if (gridInput) {
        gridInput.value = e.target.value;
        gridInput.dispatchEvent(new Event('input'));
      }
    });
    setTimeout(() => {
      const gridInput = document.getElementById('searchInput');
      if (gridInput) gridInput.addEventListener('input', (e) => { input.value = e.target.value; });
    }, 500);
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

  function showFilterBadge(query, count) {
    if (!filterBadge) return;
    filterBadgeText.textContent = window.i18n
      ? window.i18n.t('nav.filterActive', { query, count })
      : `Filter: "${query}" (${count})`;
    filterBadge.style.display = 'flex';
  }

  function hideFilterBadge() {
    if (filterBadge) filterBadge.style.display = 'none';
  }

  if (filterClearBtn) {
    filterClearBtn.addEventListener('click', async () => {
      if (window.clearSearchFilter) await window.clearSearchFilter();
      hideFilterBadge();
    });
  }

  async function applyAsFilter(q) {
    if (!window.applySearchFilter) return;
    const result = await window.applySearchFilter(q);
    if (result && result.ok && result.count > 0) {
      showFilterBadge(q, result.count);
    } else {
      hideFilterBadge();
      alert(window.i18n ? window.i18n.t('messages.noResultsFound') : 'No results found');
    }
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
