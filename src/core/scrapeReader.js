const fs = require("fs");
const path = require("path");

/**
 * ScrapeReader - Navigazione tra file JSON nella cartella scrape
 * Simile a LibraryReader ma per i file JSON generati dagli scraper
 */
class ScrapeReader {
  constructor() {
    // Usa percorso relativo al progetto invece di home directory
    this.scrapePath = path.join(__dirname, "../../data/scrape");
    this.items = [];
    this.currentIndex = -1;

    // Crea la cartella se non esiste
    if (!fs.existsSync(this.scrapePath)) {
      fs.mkdirSync(this.scrapePath, { recursive: true });
    }
  }

  /**
   * Carica tutti i file JSON dalla cartella scrape
   */
  loadScrapeItems() {
    this.items = [];
    this.currentIndex = -1;

    if (!fs.existsSync(this.scrapePath)) {
      return;
    }

    const files = fs.readdirSync(this.scrapePath);

    // Filtra solo i file .json
    const jsonFiles = files.filter(f => f.endsWith(".json"));

    this.items = jsonFiles.map(filename => ({
      id: path.basename(filename, ".json"),
      jsonPath: path.join(this.scrapePath, filename)
    }));

    // Ordina per nome file (ID)
    this.items.sort((a, b) => a.id.localeCompare(b.id));

    if (this.items.length > 0) {
      this.currentIndex = 0;
    }
  }

  /**
   * Ritorna l'item corrente (con dati caricati)
   * Se il file è corrotto, restituisce null senza crashare
   */
  getCurrent() {
    if (this.currentIndex < 0 || this.currentIndex >= this.items.length) {
      return null;
    }

    const item = this.items[this.currentIndex];

    try {
      const jsonData = fs.readFileSync(item.jsonPath, "utf8");
      const parsed = JSON.parse(jsonData);

      return {
        id: item.id,
        jsonPath: item.jsonPath,
        ...parsed
      };
    } catch (err) {
      console.error(`Skipping corrupted JSON ${item.jsonPath}:`, err.message);
      return null;
    }
  }

  /**
   * Passa al prossimo item valido (salta file corrotti)
   */
  getNext() {
    if (this.items.length === 0) return null;

    const startIndex = this.currentIndex;
    let attempts = 0;

    // Prova fino a quando non trova un file valido o ha controllato tutti
    do {
      this.currentIndex = (this.currentIndex + 1) % this.items.length;
      attempts++;

      const result = this.getCurrent();
      if (result !== null) {
        return result;
      }

      // Se abbiamo fatto il giro completo, tutti i file sono corrotti
      if (attempts >= this.items.length) {
        console.error("All JSON files are corrupted");
        return null;
      }
    } while (this.currentIndex !== startIndex);

    return null;
  }

  /**
   * Passa all'item precedente valido (salta file corrotti)
   */
  getPrevious() {
    if (this.items.length === 0) return null;

    const startIndex = this.currentIndex;
    let attempts = 0;

    // Prova fino a quando non trova un file valido o ha controllato tutti
    do {
      this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
      attempts++;

      const result = this.getCurrent();
      if (result !== null) {
        return result;
      }

      // Se abbiamo fatto il giro completo, tutti i file sono corrotti
      if (attempts >= this.items.length) {
        console.error("All JSON files are corrupted");
        return null;
      }
    } while (this.currentIndex !== startIndex);

    return null;
  }

  /**
   * Ricarica l'item corrente
   */
  reloadCurrent() {
    return this.getCurrent();
  }

  /**
   * Elimina il file JSON corrente
   */
  deleteCurrent() {
    if (this.currentIndex < 0 || this.currentIndex >= this.items.length) {
      return { ok: false, error: "No item selected" };
    }

    const item = this.items[this.currentIndex];

    try {
      fs.unlinkSync(item.jsonPath);

      // Rimuovi dall'array
      this.items.splice(this.currentIndex, 1);

      // Aggiusta l'indice
      if (this.items.length === 0) {
        this.currentIndex = -1;
      } else if (this.currentIndex >= this.items.length) {
        this.currentIndex = this.items.length - 1;
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Conta i file JSON disponibili
   */
  getCount() {
    return this.items.length;
  }

  /**
   * Ottiene l'indice corrente
   */
  getCurrentIndex() {
    return this.currentIndex;
  }
}

module.exports = ScrapeReader;
