// ============================================
// Actor Modal Loader
// Loads the shared actor modal HTML
// ============================================

(async function() {
  try {
    // Load the shared actor modal HTML — cache-busted like the script tags
    // below (?v=N), since a plain fetch() of a static file is otherwise
    // liable to serve a stale cached copy of the markup indefinitely.
    const response = await fetch('/actor-modal.html?v=3');
    const html = await response.text();

    // Insert modal at the end of body
    document.body.insertAdjacentHTML('beforeend', html);

    // Dispatch event to signal modal is loaded
    window.dispatchEvent(new Event('actorModalLoaded'));
  } catch (error) {
    console.error('Failed to load actor modal:', error);
  }
})();
