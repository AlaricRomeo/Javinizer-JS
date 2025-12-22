// ─────────────────────────────
// Sistema di internazionalizzazione (i18n)
// ─────────────────────────────

let currentLang = "en";
let translations = {};

/**
 * Carica le traduzioni per la lingua specificata
 */
async function loadLanguage(langCode) {
  try {
    const res = await fetch(`/item/lang/${langCode}`);
    const data = await res.json();

    if (!data.ok) {
      console.error("Error loading language:", data.error);
      return false;
    }

    translations = data.translations;
    currentLang = langCode;
    return true;
  } catch (err) {
    console.error("Error loading language:", err);
    return false;
  }
}

/**
 * Ottiene una traduzione dal path (es: "fields.title")
 */
function t(path) {
  const keys = path.split(".");
  let value = translations;

  for (const key of keys) {
    if (value && typeof value === "object" && key in value) {
      value = value[key];
    } else {
      console.warn(`Translation missing: ${path}`);
      return path; // Fallback al path stesso
    }
  }

  return value;
}

/**
 * Ottiene la lingua corrente
 */
function getCurrentLanguage() {
  return currentLang;
}

/**
 * Applica le traduzioni a tutti gli elementi con attributo data-i18n
 */
function applyTranslations() {
  // Traduci testi
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });

  // Traduci placeholder
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = t(key);
  });

  // Traduci title/tooltip
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    const key = el.getAttribute("data-i18n-title");
    el.title = t(key);
  });
}

/**
 * Cambia lingua e ricarica le traduzioni
 */
async function changeLanguage(langCode) {
  const success = await loadLanguage(langCode);
  if (success) {
    applyTranslations();

    // Salva nel config
    await saveLanguageToConfig(langCode);

    // Trigger custom event per notificare il cambio lingua
    window.dispatchEvent(new CustomEvent("languageChanged", { detail: { lang: langCode } }));
  }
  return success;
}

/**
 * Salva la lingua nel config del server
 */
async function saveLanguageToConfig(langCode) {
  try {
    // Carica config corrente
    const configRes = await fetch("/item/config");
    const configData = await configRes.json();

    if (!configData.ok) return;

    // Aggiorna con nuova lingua
    const updatedConfig = {
      ...configData.config,
      language: langCode
    };

    // Salva
    await fetch("/item/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedConfig)
    });
  } catch (err) {
    console.error("Error saving language to config:", err);
  }
}

// Esporta funzioni globalmente
window.i18n = {
  loadLanguage,
  t,
  getCurrentLanguage,
  applyTranslations,
  changeLanguage
};
