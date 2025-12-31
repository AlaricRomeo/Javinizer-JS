const fs = require("fs");
const path = require("path");

class LibraryReader {
  constructor(rootPath, actorsPath = null) {
    this.rootPath = rootPath;
    this.actorsPath = actorsPath; // Path to exclude from library (actors cache)
    this.items = [];
    this.currentIndex = -1;
    this.totalScanned = 0; // Track how many folders we've scanned
    this.allFolders = []; // All folder names (not loaded yet)
    this.fullyLoaded = false; // Whether we've scanned all folders
  }

  /**
   * Reset all cached data (call when library path changes)
   */
  reset() {
    this.items = [];
    this.currentIndex = -1;
    this.totalScanned = 0;
    this.allFolders = [];
    this.fullyLoaded = false;
  }

  /**
   * Update root path and actors path, resetting cache
   */
  updatePaths(rootPath, actorsPath = null) {
    this.rootPath = rootPath;
    this.actorsPath = actorsPath;
    this.reset();
  }

  /**
   * Scans the root and finds only valid folders
   * (a folder is valid if it contains at least one .nfo file)
   *
   * For large libraries (>500 folders), loads incrementally to avoid blocking
   */
  loadLibrary(batchSize = 100) {
    // Verify that the path exists
    if (!fs.existsSync(this.rootPath)) {
      this.items = [];
      this.currentIndex = -1;
      this.allFolders = [];
      this.totalScanned = 0;
      this.fullyLoaded = true;
      return;
    }

    // If first load, get all folder names
    if (this.allFolders.length === 0) {
      const entries = fs.readdirSync(this.rootPath, { withFileTypes: true });
      this.allFolders = entries
        .filter(entry => entry.isDirectory())
        .filter(entry => !entry.name.startsWith('.')) // Exclude hidden folders
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));

      this.totalScanned = 0;
      this.items = [];
      this.fullyLoaded = false;
    }

    // Load next batch of folders
    const startIdx = this.totalScanned;
    const endIdx = Math.min(startIdx + batchSize, this.allFolders.length);

    for (let i = startIdx; i < endIdx; i++) {
      const folderName = this.allFolders[i];
      const folderPath = path.join(this.rootPath, folderName);

      // Exclusion Rule 2: Skip if this is the actors cache path
      if (this.actorsPath && path.resolve(folderPath) === path.resolve(this.actorsPath)) {
        continue;
      }

      try {
        const files = fs.readdirSync(folderPath);

        // Find all NFO files
        const nfoFiles = files.filter(f => f.toLowerCase().endsWith(".nfo"));

        // Exclusion Rule 3: Skip folders with multiple NFO files (likely actor cache)
        if (nfoFiles.length > 1) {
          continue;
        }

        // Check if folder has exactly one NFO
        if (nfoFiles.length === 1) {
          this.items.push({
            id: folderName,
            path: folderPath,
            nfo: path.join(folderPath, nfoFiles[0])
          });
        }
      } catch (err) {
        // Skip folders we can't read
        console.error(`[LibraryReader] Cannot read folder ${folderName}:`, err.message);
      }
    }

    this.totalScanned = endIdx;
    this.fullyLoaded = (this.totalScanned >= this.allFolders.length);

    // Set current index if not set
    if (this.currentIndex === -1 && this.items.length > 0) {
      this.currentIndex = 0;
    }

    return {
      loaded: this.items.length,
      total: this.allFolders.length,
      scanned: this.totalScanned,
      fullyLoaded: this.fullyLoaded
    };
  }

  /**
   * Load all remaining folders (blocking operation for large libraries)
   */
  loadAll() {
    while (!this.fullyLoaded) {
      this.loadLibrary(500); // Load in larger batches
    }
    return this.items.length;
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
   * Auto-loads more items if approaching the end
   */
  getNext() {
    if (this.items.length === 0) return null;

    this.currentIndex = (this.currentIndex + 1) % this.items.length;

    // If we're near the end and haven't loaded everything, load more
    if (!this.fullyLoaded && this.currentIndex >= this.items.length - 10) {
      this.loadLibrary(100);
    }

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
   * Total number of valid items currently loaded
   */
  count() {
    return this.items.length;
  }

  /**
   * Get loading status
   */
  getStatus() {
    return {
      loaded: this.items.length,
      totalFolders: this.allFolders.length,
      scanned: this.totalScanned,
      fullyLoaded: this.fullyLoaded,
      progress: this.allFolders.length > 0
        ? Math.round((this.totalScanned / this.allFolders.length) * 100)
        : 100
    };
  }
}

module.exports = LibraryReader;
