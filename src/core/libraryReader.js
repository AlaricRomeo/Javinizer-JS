const fs = require("fs");
const path = require("path");

class LibraryReader {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.items = [];
    this.currentIndex = -1;
  }

  /**
   * Scans the root and finds only valid folders
   * (a folder is valid if it contains at least one .nfo file)
   */
  loadLibrary() {
    // Verify that the path exists
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
   * Returns the current item
   */
  getCurrent() {
    if (this.currentIndex === -1) return null;
    return this.items[this.currentIndex];
  }

  /**
   * Returns the item at a specific index
   */
  getItem(index) {
    if (index < 0 || index >= this.items.length) return null;
    this.currentIndex = index;
    return this.getCurrent();
  }

  /**
   * Go to next item (circular navigation)
   */
  getNext() {
    if (this.items.length === 0) return null;

    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    return this.getCurrent();
  }

  /**
   * Go to previous item (circular navigation)
   */
  getPrevious() {
    if (this.items.length === 0) return null;

    this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
    return this.getCurrent();
  }

  /**
   * Finds an item by ID
   * @param {string} id - ID of the item to search for
   * @returns {object|null} - Found item or null
   */
  findById(id) {
    return this.items.find(item => item.id === id) || null;
  }

  /**
   * Reloads the current folder (useful if files have changed)
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
   * Total number of valid items
   */
  count() {
    return this.items.length;
  }
}

module.exports = LibraryReader;
