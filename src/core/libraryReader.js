const fs = require("fs");
const path = require("path");
const { getLibraryCachePath, getLibraryPositionPath } = require("./config");

class LibraryReader {
  constructor(rootPath, actorsPath = null) {
    this.rootPath = rootPath;
    this.actorsPath = actorsPath; // Path to exclude from library (actors cache)
    this.items = [];
    this.currentIndex = -1;
    this.totalScanned = 0; // Track how many folders we've scanned
    this.allFolders = []; // All folder names (not loaded yet)
    this.fullyLoaded = false; // Whether we've scanned all folders
    this.cachePath = getLibraryCachePath();
    this.positionPath = getLibraryPositionPath();
    this._cachedById = null; // Map of id -> cached item, used while (re)loading
    this.filterIds = null; // Set of item ids, or null when no filter is active
    this._pendingRestoreId = null; // Item id to resume on, from a previous server run
    this._lastPersistedIndex = null; // Last currentIndex written to disk, to avoid redundant writes
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
    this._cachedById = null;
    this.filterIds = null;
    this._pendingRestoreId = null;
    this._lastPersistedIndex = null;
  }

  /**
   * Restrict next/previous navigation to the given set of item ids.
   * Moves the current item to the first match if it isn't already one.
   */
  setFilter(ids) {
    this.filterIds = new Set(ids);
    const filtered = this._filteredItems();
    if (filtered.length === 0) {
      this.currentIndex = -1;
      return;
    }
    const current = this.currentIndex >= 0 ? this.items[this.currentIndex] : null;
    if (!current || !this.filterIds.has(current.id)) {
      this.currentIndex = this.items.indexOf(filtered[0]);
    }
  }

  /**
   * Remove the active filter; next/previous resume covering the full library.
   */
  clearFilter() {
    this.filterIds = null;
  }

  isFilterActive() {
    return this.filterIds !== null;
  }

  /**
   * Items matching the active filter, in library order. Returns all items when no filter is set.
   */
  _filteredItems() {
    return this.filterIds ? this.items.filter(item => this.filterIds.has(item.id)) : this.items;
  }

  /**
   * Loads the persisted index from disk, if it matches the current rootPath
   */
  _loadDiskCache() {
    try {
      if (!fs.existsSync(this.cachePath)) return null;
      const cache = JSON.parse(fs.readFileSync(this.cachePath, "utf8"));
      if (cache.rootPath !== this.rootPath || !Array.isArray(cache.items)) return null;
      return cache;
    } catch (err) {
      return null;
    }
  }

  /**
   * Persists the current index to disk so the next startup can skip rescanning
   * unchanged folders
   */
  _saveDiskCache() {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify({
        rootPath: this.rootPath,
        items: this.items,
        savedAt: Date.now()
      }), "utf8");
    } catch (err) {
      console.error('[LibraryReader] Failed to save library cache:', err.message);
    }
  }

  /**
   * Loads the persisted "last viewed item" pointer, if it matches the current rootPath
   */
  _loadPosition() {
    try {
      if (!fs.existsSync(this.positionPath)) return null;
      const pos = JSON.parse(fs.readFileSync(this.positionPath, "utf8"));
      if (pos.rootPath !== this.rootPath || !pos.currentItemId) return null;
      return pos;
    } catch (err) {
      return null;
    }
  }

  /**
   * Persists which item is current so edit-mode navigation resumes here after a server
   * restart. Cheap (a few bytes), safe to call on every navigation — unlike the full
   * library index, this is never rewritten on a schedule tied to library size.
   */
  _savePosition(itemId) {
    try {
      const dir = path.dirname(this.positionPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.positionPath, JSON.stringify({
        rootPath: this.rootPath,
        currentItemId: itemId
      }), "utf8");
    } catch (err) {
      console.error('[LibraryReader] Failed to save position:', err.message);
    }
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
   * For large libraries (>500 folders), loads incrementally to avoid blocking.
   * batchSize is a floor, not a ceiling: once it's satisfied, the loop keeps going
   * within timeBudgetMs — a cached folder costs a Map lookup, not a disk seek, so
   * a warm cache (same rootPath as last run) typically finishes the whole library
   * in one call instead of needing dozens of polls. A cold scan (new/changed
   * directory, no matching cache) still yields after batchSize+timeBudgetMs, same
   * as before, keeping the server responsive during a real scan.
   */
  loadLibrary(batchSize = 100, timeBudgetMs = 150) {
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

      // Reuse the persisted index from a previous run (e.g. server restart)
      // so unchanged folders don't need a full readdir scan again
      const diskCache = this._loadDiskCache();
      this._cachedById = diskCache ? new Map(diskCache.items.map(item => [item.id, item])) : null;

      // Resume on the item that was current before the server last stopped
      const savedPosition = this._loadPosition();
      this._pendingRestoreId = savedPosition ? savedPosition.currentItemId : null;
    }

    // Load next batch of folders
    const startIdx = this.totalScanned;
    const minEndIdx = Math.min(startIdx + batchSize, this.allFolders.length);
    const deadline = Date.now() + timeBudgetMs;

    let i = startIdx;
    for (; i < this.allFolders.length; i++) {
      const folderName = this.allFolders[i];
      const folderPath = path.join(this.rootPath, folderName);

      // Exclusion Rule 2: Skip if this is the actors cache path
      if (this.actorsPath && path.resolve(folderPath) === path.resolve(this.actorsPath)) {
        continue;
      }

      // Trust a cached entry for a folder that's still there under the same name —
      // no verification I/O. A renamed/deleted NFO inside it self-heals on the next
      // real access (getCurrent/getItem/library-list already handle that).
      const cachedItem = this._cachedById && this._cachedById.get(folderName);
      let fromCache = false;
      if (cachedItem) {
        this.items.push(cachedItem);
        fromCache = true;
      } else {
        try {
          const files = fs.readdirSync(folderPath);

          // Find all NFO files
          const nfoFiles = files.filter(f => f.toLowerCase().endsWith(".nfo"));

          // Exclusion Rule 3: Skip folders with multiple NFO files (likely actor cache)
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

      // Once the requested batch size is satisfied: a cache hit is essentially free,
      // so keep going bounded only by the time budget — that's what lets a warm cache
      // blow through the rest of the library in one call. A real disk scan (cache miss,
      // e.g. a folder switch with no matching cache) must stop right at batchSize
      // regardless of how fast it was, otherwise "lazy" progressive loading disappears
      // for new/changed libraries on a fast filesystem.
      if (i + 1 >= minEndIdx) {
        if (!fromCache) { i++; break; }
        if (Date.now() > deadline) { i++; break; }
      }
    }

    this.totalScanned = Math.min(i, this.allFolders.length);
    this.fullyLoaded = (this.totalScanned >= this.allFolders.length);

    // Resume the previously-current item once it's been loaded; give up once the
    // whole library is in and it still hasn't turned up (e.g. it was removed).
    if (this._pendingRestoreId) {
      const idx = this.items.findIndex(item => item.id === this._pendingRestoreId);
      if (idx !== -1) {
        this.currentIndex = idx;
        this._lastPersistedIndex = idx;
        this._pendingRestoreId = null;
      } else if (this.fullyLoaded) {
        this._pendingRestoreId = null;
        if (this.currentIndex === -1 && this.items.length > 0) this.currentIndex = 0;
      }
    } else if (this.currentIndex === -1 && this.items.length > 0) {
      this.currentIndex = 0;
    }

    if (this.fullyLoaded) {
      this._saveDiskCache();
      this._cachedById = null;
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
   * Scan only as far as needed to have at least `count` items ready — for
   * paginated endpoints (GET /library-list?offset&limit) that must not pay
   * the cost of a full library scan just to serve one page. A cold scan on
   * slow/network storage can take fs.readdirSync minutes for thousands of
   * folders; loadAll() there would block the whole (single-threaded) server
   * for that entire time. This bounds the blocking work to roughly the
   * requested page instead.
   */
  ensureLoadedUpTo(count) {
    while (this.items.length < count && !this.fullyLoaded) {
      this.loadLibrary();
    }
  }

  /**
   * Returns the current item
   */
  getCurrent() {
    if (this.currentIndex === -1) return null;

    // Controlla se l'elemento corrente è ancora valido
    const current = this.items[this.currentIndex];
    if (current && !fs.existsSync(current.nfo)) {
      this.items.splice(this.currentIndex, 1);
      if (this.currentIndex >= this.items.length) {
        this.currentIndex = this.items.length > 0 ? this.items.length - 1 : -1;
      }
      return this.getCurrent();
    }

    // Persist which item is current, so a server restart resumes here. Only writes
    // when the index actually changed, since getCurrent() is also called as a
    // read-only check (e.g. from getNext/getPrevious) without navigation happening.
    if (current && this.currentIndex !== this._lastPersistedIndex) {
      this._lastPersistedIndex = this.currentIndex;
      this._savePosition(current.id);
    }

    return current;
  }

  /**
   * Returns the item at a specific index
   */
  getItem(index) {
    if (index < 0 || index >= this.items.length) return null;

    // Controlla se l'elemento è ancora valido
    const item = this.items[index];
    if (item && !fs.existsSync(item.nfo)) {
      this.items.splice(index, 1);
      if (this.currentIndex >= index && this.currentIndex > 0) {
        this.currentIndex--;
      }
      return this.getItem(index < this.items.length ? index : index - 1);
    }

    this.currentIndex = index;
    return item;
  }

  /**
   * Go to next item (circular navigation)
   * Auto-loads more items if approaching the end
   */
  getNext() {
    if (this.items.length === 0) return null;

    if (this.filterIds) return this._stepFiltered(1);

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

    if (this.filterIds) return this._stepFiltered(-1);

    this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
    return this.getCurrent();
  }

  /**
   * Move to the next/previous item within the active filter (circular).
   * @param {number} direction - 1 for next, -1 for previous
   */
  _stepFiltered(direction) {
    const filtered = this._filteredItems();
    if (filtered.length === 0) return null;

    const current = this.currentIndex >= 0 ? this.items[this.currentIndex] : null;
    const pos = current ? filtered.findIndex(item => item.id === current.id) : -1;
    const nextPos = pos === -1 ? 0 : (pos + direction + filtered.length) % filtered.length;

    this.currentIndex = this.items.indexOf(filtered[nextPos]);
    return this.getCurrent();
  }

  /**
   * Finds an item by ID
   * @param {string} id - ID of the item to search for
   * @returns {object|null} - Found item or null
   */
  findById(id) {
    const item = this.items.find(item => item.id === id);
    if (item && !fs.existsSync(item.nfo)) {
      const index = this.items.indexOf(item);
      this.items.splice(index, 1);
      if (this.currentIndex >= index && this.currentIndex > 0) {
        this.currentIndex--;
      }
      return null;
    }
    return item || null;
  }

  /**
   * Validates and cleans up invalid items (missing NFO files)
   */
  validateAndCleanup() {
    const validItems = [];
    for (const item of this.items) {
      if (fs.existsSync(item.nfo)) {
        validItems.push(item);
      } else {
        console.warn(`[LibraryReader] File missing: ${item.nfo}. Removed from library.`);
      }
    }
    this.items = validItems;

    // Aggiorna l'indice corrente se necessario
    if (this.currentIndex >= this.items.length) {
      this.currentIndex = this.items.length > 0 ? this.items.length - 1 : -1;
    }
  }

  /**
   * Reloads the current folder (useful if files have changed)
   */
  reloadCurrent() {
    if (this.currentIndex === -1) return null;

    const current = this.items[this.currentIndex];

    try {
      const files = fs.readdirSync(current.path);
      const nfoFile = files.find(f => f.toLowerCase().endsWith(".nfo"));

      if (!nfoFile) {
        // Rimuovi l'elemento se non ha più un file NFO
        this.items.splice(this.currentIndex, 1);
        if (this.currentIndex >= this.items.length) {
          this.currentIndex = this.items.length > 0 ? this.items.length - 1 : -1;
        }
        return this.getCurrent();
      }

      current.nfo = path.join(current.path, nfoFile);
      return current;
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Rimuovi l'elemento se la cartella non esiste più
        this.items.splice(this.currentIndex, 1);
        if (this.currentIndex >= this.items.length) {
          this.currentIndex = this.items.length > 0 ? this.items.length - 1 : -1;
        }
        return this.getCurrent();
      }
      throw err;
    }
  }

  /**
   * Reloads a specific item by ID (useful for lazy updates)
   */
  reloadItemById(id) {
    const index = this.items.findIndex(item => item.id === id);
    if (index === -1) return null;

    const item = this.items[index];

    try {
      const files = fs.readdirSync(item.path);
      const nfoFile = files.find(f => f.toLowerCase().endsWith(".nfo"));

      if (!nfoFile) {
        this.items.splice(index, 1);
        if (this.currentIndex >= index && this.currentIndex > 0) {
          this.currentIndex--;
        }
        return null;
      }

      item.nfo = path.join(item.path, nfoFile);
      return item;
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.items.splice(index, 1);
        if (this.currentIndex >= index && this.currentIndex > 0) {
          this.currentIndex--;
        }
        return null;
      }
      throw err;
    }
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
