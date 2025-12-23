// ─────────────────────────────
// Bindings i18n per elementi HTML
// ─────────────────────────────

/**
 * Applica i bindings i18n a tutti gli elementi dell'interfaccia
 * Viene chiamato dopo il caricamento delle traduzioni
 */
function applyI18nBindings() {
  const t = window.i18n.t;

  // Sezioni
  setText("#fanart-container h3", t("sections.fanart"));
  setText(".config-panel h3", t("sections.libraryPath"));
  setText(".scraper-panel h3", t("sections.scraperPanel"));

  // Form sections
  setText(".form-section:nth-of-type(1) h3", t("sections.basicInfo"));
  setText(".form-section:nth-of-type(2) h3", t("sections.production"));
  setText(".form-section:nth-of-type(3) h3", t("sections.rating"));
  setText(".form-section:nth-of-type(4) h3", t("sections.categories"));
  setText(".form-section:nth-of-type(5) h3", t("sections.mediaUrls"));
  setText(".actors-section h3", t("sections.actors"));

  // Fields labels
  setLabelFor("id", t("fields.id"));
  setLabelFor("title", t("fields.title"));
  setLabelFor("alternateTitle", t("fields.alternateTitle"));
  setLabelFor("description", t("fields.description"));
  setLabelFor("director", t("fields.director"));
  setLabelFor("releaseDate", t("fields.releaseDate"));
  setLabelFor("runtime", t("fields.runtime"));
  setLabelFor("series", t("fields.series"));
  setLabelFor("maker", t("fields.maker"));
  setLabelFor("label", t("fields.label"));
  setLabelFor("rating", t("fields.rating"));
  setLabelFor("contentRating", t("fields.contentRating"));
  setLabelFor("genres", t("fields.genres"));
  setLabelFor("tags", t("fields.tags"));
  setLabelFor("coverUrl", t("fields.coverUrl"));
  setLabelFor("screenshotUrl", t("fields.screenshotUrl"));
  setLabelFor("trailerUrl", t("fields.trailerUrl"));

  // Buttons
  setText("#saveItemText", t("buttons.save"));
  setText("#addActor", t("buttons.addActor"));

  // Placeholders
  setText("#fanartPlaceholder", t("placeholders.noImage"));
  setText(".config-panel small", t("messages.libraryPathHelp"));

  // Actor Modal
  setModalText("#actorEditContent h2", t("actorModal.title"));
  setModalLabel("#actorEditName", t("actorModal.name"));
  setModalLabel("#actorEditAltName", t("actorModal.altName"));
  setModalLabel("#actorEditRole", t("actorModal.role"));
  setModalLabel("#actorEditThumb", t("actorModal.thumbUrl"));
  setText("#actorEditPreview label", t("actorModal.preview"));
  setText("#actorEditContent > div:nth-child(6)", `<strong>Nota:</strong> ${t("actorModal.note")}`);
  setText("#actorEditCancel", t("buttons.cancel"));
  setText("#actorEditRemove", t("buttons.remove"));
  setText("#actorEditSave", t("buttons.save"));

  // Directory Browser Modal
  setText("#dirBrowserContent h3", t("messages.selectDirectory"));
  setText("#dirBrowserUp", t("messages.upDirectory"));
  setText("#dirBrowserCancel", t("buttons.cancel"));
  setText("#dirBrowserSelect", t("messages.selectThisFolder"));

  // Placeholders dinamici
  setPlaceholder("#actorEditName", t("placeholders.actorName"));
  setPlaceholder("#actorEditAltName", t("placeholders.altName"));
  setPlaceholder("#actorEditRole", t("placeholders.role"));
}

// Helper functions
function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}

function setLabelFor(inputId, text) {
  const input = document.getElementById(inputId);
  if (input) {
    const label = input.previousElementSibling;
    if (label && label.tagName === "LABEL") {
      label.textContent = text;
    }
  }
}

function setModalText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}

function setModalLabel(inputSelector, text) {
  const input = document.querySelector(inputSelector);
  if (input) {
    const label = input.previousElementSibling;
    if (label && label.tagName === "LABEL") {
      label.textContent = text;
    }
  }
}

function setPlaceholder(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.placeholder = text;
}

// Esporta globalmente
window.applyI18nBindings = applyI18nBindings;
