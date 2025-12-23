const fs = require("fs");
const path = require("path");

class LibraryReader {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.items = [];
    this.currentIndex = -1;
  }

  /**
   * Scansiona la root e trova solo le cartelle valide
   * (una cartella è valida se contiene almeno un file .nfo)
   */
  loadLibrary() {
    // Verifica che il path esista
    if (!fs.existsSync(this.rootPath)) {
      this.items = [];
      this.currentIndex = -1;
      return;
    }

    const entries = fs.readdirSync(this.rootPath, { withFileTypes: true });

    this.items = entries
      .filter(entry => entry.isDirectory())
      .map(entry => {
        const folderPath = path.join(this.rootPath, entry.name);
        const files = fs.readdirSync(folderPath);

        const nfoFile = files.find(f => f.toLowerCase().endsWith(".nfo"));
        if (!nfoFile) return null;

        return {
          id: entry.name,
          path: folderPath,
          nfo: path.join(folderPath, nfoFile)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id));

    this.currentIndex = this.items.length > 0 ? 0 : -1;
  }

  /**
   * Ritorna l'item corrente
   */
  getCurrent() {
    if (this.currentIndex === -1) return null;
    return this.items[this.currentIndex];
  }

  /**
   * Ritorna l'item a un indice specifico
   */
  getItem(index) {
    if (index < 0 || index >= this.items.length) return null;
    this.currentIndex = index;
    return this.getCurrent();
  }

  /**
   * Vai all'item successivo (navigazione circolare)
   */
  getNext() {
    if (this.items.length === 0) return null;

    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    return this.getCurrent();
  }

  /**
   * Vai all'item precedente (navigazione circolare)
   */
  getPrevious() {
    if (this.items.length === 0) return null;

    this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
    return this.getCurrent();
  }

  /**
   * Ricarica la cartella corrente (utile se i file sono cambiati)
   */
  reloadCurrent() {
    if (this.currentIndex === -1) return null;

    const current = this.items[this.currentIndex];
    const files = fs.readdirSync(current.path);
    const nfoFile = files.find(f => f.toLowerCase().endsWith(".nfo"));

    if (!nfoFile) return null;

    current.nfo = path.join(current.path, nfoFile);
    return current;
  }

  /**
   * Numero totale di item validi
   */
  count() {
    return this.items.length;
  }
}

module.exports = LibraryReader;
