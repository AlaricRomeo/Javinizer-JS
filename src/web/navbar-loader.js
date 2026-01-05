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

    // Initialize language selector
    initLanguageSelector();
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

// Auto-load navbar when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadNavbar);
} else {
  loadNavbar();
}
