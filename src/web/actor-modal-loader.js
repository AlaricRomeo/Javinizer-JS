// ============================================
// Actor Modal Loader
// Loads the shared actor modal HTML
// ============================================

(async function() {
  try {
    const response = await fetch('/actor-modal.html');
    const html = await response.text();

    // Insert modal at the end of body
    document.body.insertAdjacentHTML('beforeend', html);

    // Dispatch event to signal modal is loaded
    window.dispatchEvent(new Event('actorModalLoaded'));
    console.log('[ActorModal] Modal loaded successfully');
  } catch (error) {
    console.error('Failed to load actor modal:', error);
  }
})();
