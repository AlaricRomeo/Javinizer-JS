const { loadConfig, saveConfig, getScrapePath } = require("../core/config");
const { buildItem } = require("../core/buildItem");
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

// Core
const LibraryReader = require("../core/libraryReader");
const ScrapeReader = require("../core/scrapeReader");
const ScrapeSaver = require("../core/scrapeSaver");
const { saveNfoPatch } = require("../core/saveNfo");
const { cleanupTempDirectory } = require("../core/utils");
const updateManager = require("../core/updateManager");

// getScrapePath() is now imported from config.js and always returns data/scrape

// Load config and initialize library reader
const config = loadConfig();
const libraryReader = new LibraryReader(config.libraryPath, config.actorsPath);

// ScrapeReader instance
const scrapeReader = new ScrapeReader();

// Initial load happens lazily on first request (non-blocking startup)

/**
 * Resolve which actorDb id a movie-actor edit should be saved under.
 *
 * A movie's own NFO never stores the actor's central-index id (only
 * name/altname/role/thumb), but the edit-page model attaches the real id at
 * load time (see localMediaMapper.js) and the client round-trips it
 * unchanged through the edit form. Trusting that known id here — instead of
 * re-deriving one from whatever name/altName text is in the payload — is
 * what actually matters for a primary-name rename: if the id had to be
 * re-discovered from text, renaming an actor without also remembering to
 * carry the old name into the alt-names field would fail to match the
 * existing record and silently spawn a second, photo-less duplicate.
 * Falls back to name-based resolution only when there's no id to trust yet
 * (a brand new actor added this session, or older cached data).
 */
function resolveActorSaveId(actor, actorDb, normalizeActorName) {
  if (actor.id && actorDb.getActor(actor.id)) return actor.id;
  return actorDb.resolveId(actor.name, actor.altName) || normalizeActorName(actor.name);
}

// ─────────────────────────────
// standard response helper
// ─────────────────────────────
function ok(item) {
  return { ok: true, item };
}

function fail(error) {
  return { ok: false, error };
}

// ─────────────────────────────
// GET /item/current
// ─────────────────────────────
router.get("/current", async (req, res) => {
  try {
    // Ensure library is loaded
    if (libraryReader.items.length === 0) {
      libraryReader.loadLibrary();
    }

    let item = libraryReader.getCurrent();

    // No current item yet: either nothing to restore (fresh library, land on
    // item 0), or a position from before a server restart is still pending —
    // it's only found once the folder holding it has actually been scanned,
    // which a single batch may not cover on a cold cache. loadAll() finishes
    // the scan (using the disk cache when warm, so normally near-instant) and
    // leaves loadLibrary()'s own restore logic to pick the right index —
    // forcing index 0 here instead would silently overwrite the saved
    // position with item 0 before the real target was ever looked for.
    if (!item && libraryReader.items.length > 0 && !libraryReader.fullyLoaded) {
      libraryReader.loadAll();
      item = libraryReader.getCurrent();
    }
    if (!item && libraryReader.items.length > 0) {
      libraryReader.currentIndex = 0;
      item = libraryReader.getCurrent();
    }

    if (!item) {
      return res.json(ok(null));
    }

    const model = await buildItem(item);
    res.json(ok(model));
  } catch (err) {
    console.error('[/item/current] Error:', err);
    res.json(fail(err.message));
  }
});


// ─────────────────────────────
// GET /item/next
// ─────────────────────────────
router.get("/next", async (req, res) => {
  try {
    const item = libraryReader.getNext();
    if (!item) {
      return res.json(ok(null));
    }

    const model = await buildItem(item);
    res.json(ok(model));
  } catch (err) {
    res.json(fail(err.message));
  }
});

// ─────────────────────────────
// GET /item/prev
// ─────────────────────────────
router.get("/prev", async (req, res) => {
  try {
    const item = libraryReader.getPrevious();
    if (!item) {
      return res.json(ok(null));
    }

    const model = await buildItem(item);
    res.json(ok(model));
  } catch (err) {
    res.json(fail(err.message));
  }
});

// ─────────────────────────────
// GET /item/by-id/:id
// Load item by ID and set as current
// ─────────────────────────────
router.get("/by-id/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Ensure library is loaded
    if (libraryReader.items.length === 0) {
      libraryReader.loadLibrary();
    }

    // Wait a bit for library to load if needed
    if (libraryReader.items.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Find item by ID - try exact match first, then partial match
    const findId = () => {
      let idx = libraryReader.items.findIndex(item => item.id === id);
      if (idx === -1) idx = libraryReader.items.findIndex(item => item.id.includes(id));
      if (idx === -1) idx = libraryReader.items.findIndex(item => item.id.toLowerCase().includes(id.toLowerCase()));
      return idx;
    };

    let itemIndex = findId();

    // A cold cache only scans one batch per loadLibrary() call (see its own
    // comments) — a requested id can genuinely just not be in the library yet
    // at this point instead of not existing at all, most commonly right after
    // a server restart when this route is resuming a saved session item.
    // Finish the scan before concluding it's missing (loadAll() is
    // near-instant once the disk cache is warm, which it is after the first
    // full scan of a run).
    if (itemIndex === -1 && !libraryReader.fullyLoaded) {
      libraryReader.loadAll();
      itemIndex = findId();
    }

    if (itemIndex === -1) {
      // Genuinely not found (or the id is stale, e.g. a deleted item saved
      // in a previous session) — fall back to whatever's current instead.
      let item = libraryReader.getCurrent();
      if (!item && libraryReader.items.length > 0) {
        libraryReader.currentIndex = 0;
        item = libraryReader.getCurrent();
      }

      if (!item) {
        return res.json(ok(null));
      }

      const model = await buildItem(item);
      return res.json(ok(model));
    }

    // Set current index to found item
    libraryReader.currentIndex = itemIndex;
    const item = libraryReader.getCurrent();

    if (!item) {
      return res.json(ok(null));
    }

    const model = await buildItem(item);
    res.json(ok(model));
  } catch (err) {
    console.error('[/item/by-id] Error:', err);
    res.json(fail(err.message));
  }
});

// ─────────────────────────────
// POST /reload
// Reload the library (initial batch load)
// ─────────────────────────────
router.post("/reload", (req, res) => {
  try {
    const result = libraryReader.loadLibrary();
    const status = libraryReader.getStatus();
    res.json({ ok: true, count: libraryReader.count(), status });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /count
// Returns the number of NFOs in the library
// ─────────────────────────────
router.get("/count", (req, res) => {
  try {
    // Load library on first request if not loaded yet
    if (libraryReader.items.length === 0 && !libraryReader.fullyLoaded) {
      libraryReader.loadLibrary();
    }

    const count = libraryReader.count();
    const status = libraryReader.getStatus();
    res.json({ ok: true, count, status });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /load-more
// Load more items from library (for lazy loading)
// ─────────────────────────────
router.post("/load-more", (req, res) => {
  try {
    const { batchSize } = req.body;
    const result = libraryReader.loadLibrary(batchSize || 100);
    const status = libraryReader.getStatus();
    res.json({ ok: true, count: libraryReader.count(), status });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /config
// ─────────────────────────────
router.get("/config", (req, res) => {
  try {
    const config = loadConfig();
    // Ensure mode and scrapers always exist
    if (!config.mode) config.mode = "scrape";
    if (!config.scrapers) config.scrapers = [];

    // Get available scrapers dynamically
    const scrapersBaseDir = path.join(__dirname, '../../scrapers');

    // Get movie scrapers
    const moviesDir = path.join(scrapersBaseDir, 'movies');
    const availableMovieScrapers = fs.existsSync(moviesDir)
      ? fs.readdirSync(moviesDir).filter(name => {
        const scraperPath = path.join(moviesDir, name);
        return fs.statSync(scraperPath).isDirectory() && !name.startsWith('_');
      })
      : [];

    // Get actor scrapers
    const actorsDir = path.join(scrapersBaseDir, 'actors');
    const availableActorScrapers = fs.existsSync(actorsDir)
      ? fs.readdirSync(actorsDir).filter(name => {
        const scraperPath = path.join(actorsDir, name);
        return fs.statSync(scraperPath).isDirectory() && !name.startsWith('_');
      })
      : [];

    res.json({
      ok: true,
      config,
      availableScrapers: {
        movies: availableMovieScrapers,
        actors: availableActorScrapers
      }
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /lang/:code
// Returns the translation file
// ─────────────────────────────
router.get("/lang/:code", (req, res) => {
  try {
    const langCode = req.params.code;
    const langPath = path.join(process.cwd(), "src", "lang", `${langCode}.json`);

    if (!fs.existsSync(langPath)) {
      return res.json({ ok: false, error: "Language not found" });
    }

    const translations = JSON.parse(fs.readFileSync(langPath, "utf8"));
    res.json({ ok: true, translations });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /browse?path=...
// List directory for the file browser
// ─────────────────────────────
router.get("/browse", (req, res) => {
  try {
    // Cross-platform home directory fallback
    const os = require('os');
    const homeDir = os.homedir();
    let dirPath = req.query.path || homeDir;

    // Special case: On Windows, if dirPath is "DRIVES", list all available drives
    if (process.platform === 'win32' && dirPath === 'DRIVES') {
      // Get available drives on Windows
      const drives = [];
      for (let i = 65; i <= 90; i++) { // A-Z
        const driveLetter = String.fromCharCode(i);
        const drivePath = `${driveLetter}:\\`;
        try {
          if (fs.existsSync(drivePath)) {
            drives.push({
              name: `${driveLetter}:`,
              path: drivePath
            });
          }
        } catch (err) {
          // Skip drives that are not accessible
        }
      }

      return res.json({
        ok: true,
        current: 'DRIVES',
        parent: null,
        directories: drives
      });
    }

    // Security: verify that the directory exists and is readable
    if (!fs.existsSync(dirPath)) {
      return res.json({ ok: false, error: "Directory not found" });
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return res.json({ ok: false, error: "Path is not a directory" });
    }

    // Read directory content
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    // Filter only directories, ignore hidden files
    const directories = items
      .filter(item => item.isDirectory() && !item.name.startsWith("."))
      .map(item => ({
        name: item.name,
        path: path.join(dirPath, item.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Add parent directory if we are not at root (cross-platform root detection)
    const parsedPath = path.parse(dirPath);
    const isRoot = parsedPath.root === dirPath;

    // On Windows, when at root, parent should be "DRIVES" to allow drive switching
    let parent;
    if (process.platform === 'win32' && isRoot) {
      parent = 'DRIVES';
    } else if (!isRoot) {
      parent = path.dirname(dirPath);
    } else {
      parent = null;
    }

    // Optionally include files (for executable browser selection)
    let files = [];
    if (req.query.files === '1') {
      files = items
        .filter(item => item.isFile() && !item.name.startsWith("."))
        .map(item => ({ name: item.name, path: path.join(dirPath, item.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    res.json({
      ok: true,
      current: dirPath,
      parent: parent,
      directories: directories,
      files: files
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /search (edit mode only: search by ID and NFO title)
// ─────────────────────────────
let _searchIndex = null;

function getSearchIndex() {
  // A partial scan (the incremental per-batch loadLibrary() used elsewhere
  // for responsiveness) would make this index silently miss whatever hasn't
  // been scanned yet on a cold cache — searching/filtering would then look
  // like it found nothing for a movie that's actually there. loadAll()
  // finishes the scan (near-instant once the disk cache is warm) first.
  if (!libraryReader.fullyLoaded) libraryReader.loadAll();
  // Rebuild if library changed
  if (!_searchIndex || _searchIndex.length !== libraryReader.items.length) {
    const actorDb = require('../../scrapers/actors/actorDb');
    const aliasCache = new Map();
    _searchIndex = libraryReader.items.map(item => {
      let title = '';
      let genres = [];
      let actors = [];
      try {
        const content = fs.readFileSync(item.nfo, 'utf8');
        const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/i);
        if (titleMatch) title = titleMatch[1].trim();

        genres = [...content.matchAll(/<genre>([\s\S]*?)<\/genre>/gi)]
          .map(m => m[1].trim())
          .filter(Boolean);

        const actorNames = (content.match(/<actor>[\s\S]*?<\/actor>/gi) || [])
          .map(block => {
            const m = block.match(/<name>([\s\S]*?)<\/name>/i);
            return m ? m[1].trim() : null;
          })
          .filter(Boolean);

        // Resolve through the actor index so every known alias is searchable
        // here, not just whichever name variant happens to be literally
        // written into this specific movie's own NFO (see actorDb.resolveAliases).
        // aliasCache memoizes per rebuild — the same actor recurs across many
        // movies, so this keeps a full-library rebuild from doing one SQLite
        // round trip per (movie, actor) pair instead of per unique actor.
        const aliasSet = new Set();
        actorNames.forEach(n => {
          const key = n.toLowerCase();
          let aliases = aliasCache.get(key);
          if (!aliases) {
            aliases = actorDb.resolveAliases(n);
            aliasCache.set(key, aliases);
          }
          aliases.forEach(a => aliasSet.add(a));
        });
        actors = Array.from(aliasSet);
      } catch (_) {}
      return { id: item.id, title, genres, actors };
    });
  }
  return _searchIndex;
}

/**
 * Matches the search index against a lowercase, trimmed query.
 * Shared by /search (dropdown) and /filter (navigation).
 */
function matchSearchIndex(q) {
  const index = getSearchIndex();
  return index.filter(item =>
    item.id.toLowerCase().includes(q) ||
    item.title.toLowerCase().includes(q) ||
    item.genres.some(g => g.toLowerCase().includes(q)) ||
    item.actors.some(a => a.toLowerCase().includes(q))
  );
}

router.get("/search", (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 1) return res.json({ ok: true, results: [], total: 0 });

  const matches = matchSearchIndex(q);

  res.json({ ok: true, results: matches.slice(0, 50), total: matches.length });
});

// ─────────────────────────────
// GET /library-search
// Full grid-card data (cover, actors, aliases) for library items matching a
// query — the search counterpart to the paginated /library-list. Grid view
// can't filter client-side once browsing is paginated (it no longer holds
// the whole library), so a search re-queries the server instead; this stays
// fast even on a huge library because getSearchIndex()'s matching is cheap
// (regex over cached NFO text) and buildItem() only runs for the — typically
// small — set of matches, not the whole library.
// ─────────────────────────────
router.get("/library-search", async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q) return res.json({ ok: true, items: [] });

    const matches = matchSearchIndex(q);
    const matchIds = new Set(matches.map(m => m.id));
    const matchedItems = libraryReader.items.filter(item => matchIds.has(item.id));

    const aliasCache = new Map();
    const actorCache = new Map();
    const built = await Promise.all(
      matchedItems.map(async item => {
        try {
          const builtItem = await buildItem(item, actorCache);
          if (!builtItem) return null;
          const localCoverUrl = `/item/library-cover/${encodeURIComponent(builtItem.folderId)}`;
          return {
            id: builtItem.id,
            folderId: builtItem.folderId,
            filename: builtItem.filename,
            title: builtItem.title,
            coverUrl: localCoverUrl,
            remoteCoverUrl: builtItem.coverUrl,
            genre: builtItem.genres,
            actor: builtItem.actor,
            actorSearchNames: resolveActorSearchNames(builtItem.actor, aliasCache)
          };
        } catch (err) {
          console.error(`[library-search] Skipping stale item ${item.id}:`, err.message);
          return null;
        }
      })
    );

    res.json({ ok: true, items: built.filter(Boolean) });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// ─────────────────────────────
// POST /filter
// Restrict /item/next and /item/previous to items matching the query
// ─────────────────────────────
router.post("/filter", async (req, res) => {
  try {
    const q = (req.body.q || '').toLowerCase().trim();
    if (!q) return res.json(fail('Query required'));

    const matches = matchSearchIndex(q);
    if (matches.length === 0) return res.json({ ok: true, count: 0, item: null });

    libraryReader.setFilter(matches.map(m => m.id));
    const current = libraryReader.getCurrent();
    const model = current ? await buildItem(current) : null;
    res.json({ ok: true, count: matches.length, item: model });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// ─────────────────────────────
// POST /filter/clear
// ─────────────────────────────
router.post("/filter/clear", (req, res) => {
  libraryReader.clearFilter();
  res.json({ ok: true });
});

// ─────────────────────────────
// POST /config
// ─────────────────────────────
router.post("/config", (req, res) => {
  try {
    const newConfig = req.body;

    // Keep existing values if not specified
    const currentConfig = loadConfig();
    if (!newConfig.libraryPath && currentConfig.libraryPath) {
      newConfig.libraryPath = currentConfig.libraryPath;
    }
    if (!newConfig.language) {
      newConfig.language = currentConfig.language || "en";
    }
    if (!newConfig.mode) {
      newConfig.mode = currentConfig.mode || "scrape";
    }
    if (!newConfig.scrapers) {
      newConfig.scrapers = currentConfig.scrapers || [];
    }
    if (!newConfig.fieldPriorities && currentConfig.fieldPriorities) {
      newConfig.fieldPriorities = currentConfig.fieldPriorities;
    }

    saveConfig(newConfig);

    // 🔁 Reset library cache if libraryPath or actorsPath changed
    const libraryPathChanged = newConfig.libraryPath && newConfig.libraryPath !== currentConfig.libraryPath;
    const actorsPathChanged = newConfig.actorsPath !== currentConfig.actorsPath;

    if (libraryPathChanged || actorsPathChanged) {
      libraryReader.updatePaths(newConfig.libraryPath, newConfig.actorsPath);
      libraryReader.loadLibrary();
      console.log('[Config] Library cache reset due to path change');

      // Reload scrape items list (always shows all JSONs from data/scrape)
      // Note: JSONs are centralized, so changing library path doesn't delete them
      if (libraryPathChanged) {
        scrapeReader.loadScrapeItems();
        console.log('[Config] Scrape items list reloaded');
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /item/save
// ─────────────────────────────
router.post("/save", async (req, res) => {
  try {
    const { itemId, folderId, changes } = req.body;

    if (!changes || Object.keys(changes).length === 0) {
      return res.json({ ok: false, error: "No changes" });
    }

    // Priority: use folderId (folder name) if provided, fallback to itemId for backwards compatibility
    const searchId = folderId || itemId;

    if (!searchId) {
      return res.json({ ok: false, error: "Item ID missing" });
    }

    // Find the item by folder ID (folder name like "010214-514")
    const item = libraryReader.findById(searchId);
    if (!item) {
      return res.json({ ok: false, error: `Item not found: ${searchId}` });
    }

    await saveNfoPatch(item.nfo, changes);

    // Persist any actor edits (name, alt name, birthdate, measurements, ...) into
    // the persistent index — the movie's own NFO only ever stores name/altname/
    // role/thumb per actor (that's all Kodi's <actor> tag has room for), so
    // without this, anything else typed in the modal is silently dropped.
    if (Array.isArray(changes.actor)) {
      const { saveActorLocal } = require('../core/actorScraperManager');
      const { normalizeActorName } = require('../../scrapers/actors/schema');
      const actorDb = require('../../scrapers/actors/actorDb');

      for (const actor of changes.actor) {
        if (!actor.name) continue;
        try {
          const resolvedId = resolveActorSaveId(actor, actorDb, normalizeActorName);
          saveActorLocal({ ...actor, id: resolvedId, meta: { sources: ['manual'] } }, { replaceNames: true });
        } catch (err) {
          console.error(`[Routes] Failed to persist actor ${actor.name}:`, err.message);
        }
      }
    }

    const saveCfg = loadConfig();
    if (saveCfg.scrapers?.actors?.copyToMovieFolder) {
      try {
        const { readNfo } = require('../core/readNfo');
        const { mapNfoToModel } = require('../core/nfoMapper');
        const parsed = await readNfo(item.nfo);
        const model = mapNfoToModel(parsed);
        if (model?.actor?.length) {
          const { copied, skipped } = await copyActorsToFolder(item.path, model.actor);
          console.error(`[Routes] Auto copy actors to folder: copied=${copied.length}, skipped=${skipped.length}`);
        }
      } catch (copyErr) {
        console.error('[Routes] Auto copy actors failed:', copyErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /item/edit-rescrape
// Re-scrape a library item in edit mode - run scraper and return merged data via WebSocket
// ─────────────────────────────
router.post("/edit-rescrape", async (req, res) => {
  const { EventEmitter } = require('events');
  const { executeScraper, formatTitle } = require('../core/scraperManager');

  try {
    const { folderId, scraper } = req.body;

    if (!folderId || !scraper) {
      return res.json({ ok: false, error: 'Missing folderId or scraper' });
    }

    if (libraryReader.items.length === 0) libraryReader.loadLibrary();
    const libraryItem = libraryReader.findById(folderId);
    if (!libraryItem) {
      return res.json({ ok: false, error: `Item not found: ${folderId}` });
    }

    const existingModel = await buildItem(libraryItem);
    if (!existingModel) {
      return res.json({ ok: false, error: `Failed to read NFO for: ${folderId}` });
    }

    const movieCode = existingModel.id;
    const scrapeId = Date.now().toString();
    res.json({ ok: true, scrapeId });

    const emitter = new EventEmitter();

    const broadcast = (event, data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ event, data, scrapeId }));
        }
      });
    };

    emitter.on('start', data => broadcast('start', data));
    emitter.on('progress', data => broadcast('progress', data));
    emitter.on('scraperError', data => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ event: 'scraperError', data, scrapeId }));
          if (data.callback) client.pendingScraperError = data.callback;
        }
      });
    });
    emitter.on('error', data => broadcast('error', data));
    emitter.on('prompt', data => {
      const promptId = Date.now().toString();
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            event: 'prompt',
            data: { promptId, scraperName: data.scraperName, promptType: data.promptType, message: data.message },
            scrapeId
          }));
          client.pendingPrompts = client.pendingPrompts || {};
          client.pendingPrompts[promptId] = data.callback;
        }
      });
    });

    const editRescrapeCfg = loadConfig();
    const actorsEnabled = editRescrapeCfg.scrapers?.actors?.enabled;
    let totalTasks = 1;
    if (actorsEnabled) totalTasks++;
    let completedTasks = 0;

    const checkAllTasksComplete = (mergedData) => {
      completedTasks++;
      if (completedTasks >= totalTasks) {
        broadcast('complete', {
          message: `Re-scraping completed with ${scraper}.`,
          folderId,
          editMode: true,
          mergedData
        });
      }
    };

    executeScraper(scraper, [movieCode], emitter)
      .then(async (results) => {
        if (!results || results.length === 0) {
          throw new Error(`No results from scraper ${scraper}`);
        }

        const newData = results[0];
        const mergedData = JSON.parse(JSON.stringify(existingModel));

        Object.keys(newData).forEach(field => {
          const value = newData[field];
          const isEmpty = value === null || value === undefined || value === '' ||
            (Array.isArray(value) && value.length === 0) ||
            (typeof value === 'object' && !Array.isArray(value) && value !== null && Object.keys(value).length === 0);
          if (!isEmpty) {
            mergedData[field] = value;
          }
        });

        const { applyGenreRules } = require('../core/genreFilter');
        if (mergedData.genres && editRescrapeCfg.genreRules) {
          mergedData.genres = applyGenreRules(mergedData.genres, editRescrapeCfg.genreRules);
        }

        // Compose title field using configured pattern, independent of the scraper used.
        // Only reformat when this scraper actually returned a fresh raw title — otherwise
        // mergedData.title still holds an already-composed title from a previous scrape.
        if (newData.title) {
          mergedData.title = formatTitle(mergedData, editRescrapeCfg);
        }

        // Video scraping done
        checkAllTasksComplete(mergedData);

        // Start actor scraping if enabled
        if (actorsEnabled) {
          if (mergedData.actor && mergedData.actor.length > 0) {
            broadcast('progress', { message: '🎭 Starting automatic actor scraping...' });
            setTimeout(async () => {
              try {
                const { enrichActorArray } = require('../core/actorScraperManager');
                const summary = await enrichActorArray(mergedData.actor, emitter);
                broadcast('progress', {
                  message: `✅ Actor scraping completed: ${summary.total} actors (${summary.scraped} new, ${summary.cached} cached, ${summary.failed} failed)`
                });
              } catch (actorErr) {
                broadcast('progress', { message: `❌ Actor scraping failed: ${actorErr.message}` });
              }
              checkAllTasksComplete(mergedData);
            }, 500);
          } else {
            // No actors to scrape — still need to complete the actor task
            checkAllTasksComplete(mergedData);
          }
        }
      })
      .catch((err) => {
        console.error(`[Routes] Edit-rescrape error:`, err);
        broadcast('error', { message: err.message });
      });

  } catch (err) {
    console.error('[Routes] Edit-rescrape error:', err);
    return res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /item/actors/rescan
// Re-scan only the current movie's actors (applies the same local-cache-vs-
// online rules as any other actor scrape) and return the refreshed actor
// array via WebSocket. Does not touch any other field or write to disk —
// the user still saves explicitly via /item/edit-rescrape/save.
// ─────────────────────────────
router.post("/actors/rescan", async (req, res) => {
  const { EventEmitter } = require('events');

  try {
    const { folderId, actors } = req.body;

    if (!folderId || !Array.isArray(actors)) {
      return res.json({ ok: false, error: 'Missing folderId or actors' });
    }

    const scrapeId = Date.now().toString();
    res.json({ ok: true, scrapeId });

    const emitter = new EventEmitter();
    const broadcast = (event, data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ event, data, scrapeId }));
        }
      });
    };
    emitter.on('progress', data => broadcast('progress', data));

    const actorsCopy = JSON.parse(JSON.stringify(actors));

    try {
      const { enrichActorArray } = require('../core/actorScraperManager');
      const summary = await enrichActorArray(actorsCopy, emitter);
      broadcast('complete', {
        message: `Actor rescan completed: ${summary.total} actors (${summary.scraped} new, ${summary.cached} cached, ${summary.failed} failed).`,
        folderId,
        actorsOnly: true,
        actors: actorsCopy
      });
    } catch (actorErr) {
      console.error('[Routes] Actor rescan error:', actorErr);
      broadcast('error', { message: actorErr.message });
    }
  } catch (err) {
    console.error('[Routes] Actor rescan error:', err);
    return res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /item/edit-rescrape/save
// Save re-scraped data to existing library folder (regenerate NFO + images, video stays in place)
// ─────────────────────────────
router.post("/edit-rescrape/save", async (req, res) => {
  try {
    const { folderId, item } = req.body;

    if (!folderId || !item) {
      return res.json({ ok: false, error: 'Missing folderId or item' });
    }

    if (libraryReader.items.length === 0) libraryReader.loadLibrary();
    const libraryItem = libraryReader.findById(folderId);
    if (!libraryItem) {
      return res.json({ ok: false, error: `Item not found: ${folderId}` });
    }

    const { saveNfoFull } = require('../core/saveNfo');
    await saveNfoFull(libraryItem.nfo, item);

    // Persist any actor edits into the persistent index — see the analogous
    // comment in POST /save for why this can't be skipped.
    if (Array.isArray(item.actor)) {
      const { saveActorLocal } = require('../core/actorScraperManager');
      const { normalizeActorName } = require('../../scrapers/actors/schema');
      const actorDb = require('../../scrapers/actors/actorDb');

      for (const actor of item.actor) {
        if (!actor.name) continue;
        try {
          const resolvedId = resolveActorSaveId(actor, actorDb, normalizeActorName);
          saveActorLocal({ ...actor, id: resolvedId, meta: { sources: ['manual'] } }, { replaceNames: true });
        } catch (err) {
          console.error(`[Routes] Failed to persist actor ${actor.name}:`, err.message);
        }
      }
    }

    if (item.coverUrl) {
      const saver = new ScrapeSaver(loadConfig());
      const fanartPath = path.join(libraryItem.path, 'fanart.jpg');
      const posterPath = path.join(libraryItem.path, 'poster.jpg');
      try {
        await saver.downloadImage(item.coverUrl, fanartPath);
        await saver.createPoster(fanartPath, posterPath);
      } catch (imgErr) {
        console.warn(`[Routes] Image update failed: ${imgErr.message}`);
      }
    }

    const editSaveCfg = loadConfig();
    if (editSaveCfg.scrapers?.actors?.copyToMovieFolder && item.actor?.length) {
      try {
        const { copied, skipped } = await copyActorsToFolder(libraryItem.path, item.actor);
        console.error(`[Routes] Auto copy actors to folder: copied=${copied.length}, skipped=${skipped.length}`);
      } catch (copyErr) {
        console.error('[Routes] Auto copy actors failed:', copyErr.message);
      }
    }

    libraryReader.loadLibrary();
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// SCRAPE MODE ROUTES
// ─────────────────────────────

// GET /scrape/current
router.get("/scrape/current", (req, res) => {
  try {
    const item = scrapeReader.getCurrent();
    if (!item) {
      return res.json(ok(null));
    }
    // Return data with fileId for session tracking
    const result = { ...item.data, fileId: item.id };
    res.json(ok(result));
  } catch (err) {
    res.json(fail(err.message));
  }
});

// GET /scrape/next
router.get("/scrape/next", (req, res) => {
  try {
    const item = scrapeReader.getNext();
    if (!item) {
      return res.json(ok(null));
    }
    // Return data with fileId for session tracking
    const result = { ...item.data, fileId: item.id };
    res.json(ok(result));
  } catch (err) {
    res.json(fail(err.message));
  }
});

// GET /scrape/prev
router.get("/scrape/prev", (req, res) => {
  try {
    const item = scrapeReader.getPrevious();
    if (!item) {
      return res.json(ok(null));
    }
    // Return data with fileId for session tracking
    const result = { ...item.data, fileId: item.id };
    res.json(ok(result));
  } catch (err) {
    res.json(fail(err.message));
  }
});

// ─────────────────────────────
// GET /scrape/by-id/:id
// Load scrape item by ID and set as current
// ─────────────────────────────
router.get("/scrape/by-id/:id", (req, res) => {
  try {
    const { id } = req.params;

    // Find item by ID - try exact match first, then partial match
    let itemIndex = scrapeReader.items.findIndex(item => item.id === id);

    // If exact match fails, try to find item where ID is contained in the filename
    if (itemIndex === -1) {
      itemIndex = scrapeReader.items.findIndex(item => item.id.includes(id));
    }

    // If still not found, try case-insensitive search
    if (itemIndex === -1) {
      itemIndex = scrapeReader.items.findIndex(item =>
        item.id.toLowerCase().includes(id.toLowerCase())
      );
    }

    if (itemIndex === -1) {
      // Item not found, return current item instead
      const item = scrapeReader.getCurrent();
      if (!item) {
        return res.json(ok(null));
      }
      const result = { ...item.data, fileId: item.id };
      return res.json(ok(result));
    }

    // Set current index to found item
    scrapeReader.currentIndex = itemIndex;
    const item = scrapeReader.getCurrent();

    if (!item) {
      return res.json(ok(null));
    }

    const result = { ...item.data, fileId: item.id };
    res.json(ok(result));
  } catch (err) {
    console.error('[/scrape/by-id] Error:', err);
    res.json(fail(err.message));
  }
});

// GET /scrape/list
// Returns list of all scrape item IDs for navigation
router.get("/scrape/list", (req, res) => {
  try {
    scrapeReader.loadScrapeItems();
    const currentId = scrapeReader.getCurrent()?.id || null;
    const items = scrapeReader.items.map(item => {
      let scraped = false;
      try {
        const raw = fs.readFileSync(item.jsonPath, 'utf8');
        const data = JSON.parse(raw);
        scraped = !!(data.sources && data.sources.length > 0);
      } catch (_) {}
      return { id: item.id, scraped };
    });
    res.json({ ok: true, items, currentId });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// DELETE /scrape/current
router.delete("/scrape/current", (req, res) => {
  try {
    // Check if a specific ID was provided in the request body
    const { id } = req.body;

    if (id) {
      // Reload items to ensure we have the latest list
      scrapeReader.loadScrapeItems();

      const index = scrapeReader.items.findIndex(item => item.id === id);

      if (index === -1) {
        return res.json(fail('Item not found'));
      }

      // Set the current index to the found item and delete it
      scrapeReader.currentIndex = index;
      const result = scrapeReader.deleteCurrent();
      res.json(result);
    } else {
      // Legacy behavior: delete current item based on currentIndex
      const result = scrapeReader.deleteCurrent();
      res.json(result);
    }
  } catch (err) {
    res.json(fail(err.message));
  }
});

// DELETE /scrape/all
router.delete("/scrape/all", (req, res) => {
  try {
    const outputDir = getScrapePath();

    if (!fs.existsSync(outputDir)) {
      return res.json({ ok: true, deleted: 0 });
    }

    const files = fs.readdirSync(outputDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    let deletedCount = 0;
    jsonFiles.forEach(file => {
      const filePath = path.join(outputDir, file);
      fs.unlinkSync(filePath);
      deletedCount++;
    });

    // Reload scrape reader
    scrapeReader.loadScrapeItems();

    res.json({ ok: true, deleted: deletedCount });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// GET /scrape/count
router.get("/scrape/count", (req, res) => {
  try {
    const count = scrapeReader.getCount();
    res.json({ ok: true, count });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// GET /scrape-list - Get full list of scrape items for grid view
// Every known alias (per actorDb.resolveAliases) for each actor's `name` in
// the given movie actor array, deduped — so grid.js's search can match any
// alias for an actor regardless of which name variant this particular
// movie's own NFO happens to hold.
// `cache` is a Map the caller creates once per request and passes to every
// call — the same handful of actors recur across hundreds of movies in a
// real library, so memoizing resolveAliases() for the request's lifetime
// turns O(total actor appearances) SQLite lookups into O(unique actors),
// which is what keeps /scrape-list and /library-list fast on a large library.
function resolveActorSearchNames(actorArray, cache) {
  const actorDb = require('../../scrapers/actors/actorDb');
  const set = new Set();
  (actorArray || []).forEach(a => {
    const n = a && a.name;
    if (!n) return;
    const key = n.toLowerCase();
    let aliases = cache.get(key);
    if (!aliases) {
      aliases = actorDb.resolveAliases(n);
      cache.set(key, aliases);
    }
    aliases.forEach(alias => set.add(alias));
  });
  return Array.from(set);
}

router.get("/scrape-list", async (req, res) => {
  try {
    // Load scrape items first
    scrapeReader.loadScrapeItems();

    const aliasCache = new Map();
    const scrapedItems = scrapeReader.items.map(item => {
      const jsonData = fs.readFileSync(item.jsonPath, 'utf8');
      const parsed = JSON.parse(jsonData);

      // Determine if the item is matched based on whether scraper returned only the id or meaningful data
      // An item is considered NOT matched only if the scraper returns only the id with no other significant data
      const hasMeaningfulData = Boolean(parsed.data && (
        Boolean(parsed.data.title) ||
        Boolean(parsed.data.originalTitle) ||
        Boolean(parsed.data.releaseDate) ||
        parsed.data.runtime > 0 ||
        Boolean(parsed.data.studio) ||
        Boolean(parsed.data.label) ||
        Boolean(parsed.data.series) ||
        Boolean(parsed.data.director) ||
        Boolean(parsed.data.plot) ||
        Boolean(parsed.data.tagline) ||
        Boolean(parsed.data.contentRating) ||
        (Array.isArray(parsed.data.genres) && parsed.data.genres.length > 0) ||
        (Array.isArray(parsed.data.tags) && parsed.data.tags.length > 0) ||
        (Array.isArray(parsed.data.actor) && parsed.data.actor.length > 0) ||
        Boolean(parsed.data.coverUrl) ||
        Boolean(parsed.data.screenshotUrl) ||
        Boolean(parsed.data.trailerUrl) ||
        Boolean(parsed.data.contentId) ||
        (parsed.data.images && (parsed.data.images.poster || (Array.isArray(parsed.data.images.fanart) && parsed.data.images.fanart.length > 0)))
      ));

      return {
        id: item.id,
        filename: parsed.videoFile || item.id,
        videoFile: parsed.videoFile,
        title: parsed.data?.title || '',
        coverUrl: parsed.data?.coverUrl || '',
        genre: parsed.data?.genres || [],
        actor: parsed.data?.actor || [],
        actorSearchNames: resolveActorSearchNames(parsed.data?.actor, aliasCache),
        matched: hasMeaningfulData
      };
    });

    // TODO: In futuro, salvare i VERI "not matched" - quelli per cui lo scraper restituisce solo l'id
    res.json({ ok: true, items: scrapedItems });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// GET /library-list - Paginated library items for grid view
// ?offset=0&limit=60 — building the full card shape (NFO parse + actor
// resolution + local media check) for the whole library on every call was
// the actual cause of grid view hanging: on a cold cache, scanning every
// folder with fs.readdirSync is fine locally but can take minutes over
// slow/network storage, and Node is single-threaded — the whole server sits
// blocked for that entire scan, not just this one request. Paginating
// bounds the blocking work to roughly one page (ensureLoadedUpTo), so the
// first page — and the server — stay responsive regardless of library size.
router.get("/library-list", async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 60));

    libraryReader.ensureLoadedUpTo(offset + limit);

    const pageItems = libraryReader.items.slice(offset, offset + limit);

    // A stale cache entry (nfo renamed/removed since the last full scan) must not
    // take down the whole list — skip just that item and self-heal it out of
    // libraryReader.items so it doesn't keep failing on every subsequent request.
    const aliasCache = new Map();
    const actorCache = new Map();
    const built = await Promise.all(
      pageItems.map(async item => {
        try {
          const builtItem = await buildItem(item, actorCache);
          if (!builtItem) return null;
          // Use local cover image via endpoint, fallback to remote coverUrl
          const localCoverUrl = `/item/library-cover/${encodeURIComponent(builtItem.folderId)}`;
          return {
            id: builtItem.id,
            folderId: builtItem.folderId,
            filename: builtItem.filename,
            title: builtItem.title,
            coverUrl: localCoverUrl, // Prefer local cover
            remoteCoverUrl: builtItem.coverUrl, // Keep remote as fallback
            genre: builtItem.genres,
            actor: builtItem.actor,
            actorSearchNames: resolveActorSearchNames(builtItem.actor, aliasCache)
          };
        } catch (err) {
          console.error(`[library-list] Skipping stale item ${item.id}:`, err.message);
          const idx = libraryReader.items.indexOf(item);
          if (idx !== -1) libraryReader.items.splice(idx, 1);
          return null;
        }
      })
    );
    const items = built.filter(Boolean);

    res.json({
      ok: true,
      items,
      offset,
      limit,
      loadedCount: libraryReader.items.length,
      folderTotal: libraryReader.allFolders.length,
      fullyLoaded: libraryReader.fullyLoaded,
      hasMore: (offset + limit) < libraryReader.items.length || !libraryReader.fullyLoaded
    });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// POST /scrape-index - Set current scrape index
router.post("/scrape-index", (req, res) => {
  try {
    const { index, setMode } = req.body;
    if (typeof index !== 'number' || index < 0) {
      return res.json(fail('Invalid index'));
    }
    scrapeReader.currentIndex = index;

    // Only change mode if explicitly requested
    if (setMode) {
      const cfg = loadConfig();
      cfg.mode = 'scrape';
      saveConfig(cfg);
    }

    res.json({ ok: true });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// POST /library-index - Set current library index
router.post("/library-index", (req, res) => {
  try {
    const { index, setMode } = req.body;
    if (typeof index !== 'number' || index < 0) {
      return res.json(fail('Invalid index'));
    }
    libraryReader.currentIndex = index;
    libraryReader.getCurrent(); // also persists the position for the next server restart

    // Only change mode if explicitly requested
    if (setMode) {
      const cfg = loadConfig();
      cfg.mode = 'edit';
      saveConfig(cfg);
    }

    res.json({ ok: true });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// POST /scrape-delete - Delete scrape item (deletes JSON file)
router.post("/scrape-delete", (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.json(fail('Filename required'));
    }

    // Reload scrape items to ensure we have the latest list
    scrapeReader.loadScrapeItems();

    const index = scrapeReader.items.findIndex(item =>
      item.id === filename
    );

    if (index === -1) {
      return res.json(fail('Item not found'));
    }

    scrapeReader.currentIndex = index;
    const result = scrapeReader.deleteCurrent();
    res.json(result);
  } catch (err) {
    res.json(fail(err.message));
  }
});

// POST /library-delete - Delete library item (move video back to library root, delete folder)
router.post("/library-delete", (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.json(fail('Filename required'));
    }

    const cfg = loadConfig();
    const libraryPath = cfg.libraryPath;

    if (!libraryPath || !fs.existsSync(libraryPath)) {
      return res.json(fail('Library path not configured or not found'));
    }

    // Find the NFO file: {ID}.nfo in any subfolder
    const folders = fs.readdirSync(libraryPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

    let nfoPath = null;
    let folderPath = null;

    for (const folder of folders) {
      const potentialNfoPath = path.join(libraryPath, folder.name, `${filename}.nfo`);
      if (fs.existsSync(potentialNfoPath)) {
        nfoPath = potentialNfoPath;
        folderPath = path.join(libraryPath, folder.name);
        break;
      }
    }

    if (!nfoPath || !folderPath) {
      return res.json(fail('Item not found'));
    }

    // SAFETY CHECK: Ensure folder is inside library path
    if (!folderPath.startsWith(libraryPath)) {
      return res.json(fail('Security error: folder path is outside library'));
    }

    // Find video file in folder and move it to library root
    let videoMoved = false;
    if (fs.existsSync(folderPath)) {
      const entries = fs.readdirSync(folderPath);
      const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];

      for (const entry of entries) {
        const ext = path.extname(entry).toLowerCase();
        if (videoExtensions.includes(ext)) {
          const videoPath = path.join(folderPath, entry);
          const targetPath = path.join(libraryPath, entry);

          // SAFETY CHECK: Verify video file exists before moving
          if (!fs.existsSync(videoPath)) {
            console.error(`[library-delete] ERROR: Video file not found: ${videoPath}`);
            return res.json(fail('Video file not found in folder'));
          }

          // Move video back to library root
          try {
            fs.renameSync(videoPath, targetPath);
            videoMoved = true;
            console.error(`[library-delete] Moved video: ${entry} back to library root`);
          } catch (err) {
            console.error(`[library-delete] ERROR: Failed to move video: ${err.message}`);
            return res.json(fail('Failed to move video file'));
          }
          break;
        }
      }

      // SAFETY CHECK: Only delete folder if video was successfully moved
      if (!videoMoved) {
        console.error(`[library-delete] ERROR: No video file found in folder, aborting delete`);
        return res.json(fail('No video file found in folder'));
      }

      // SAFETY CHECK: Verify video no longer exists in folder before deleting
      const remainingEntries = fs.readdirSync(folderPath);
      const hasVideo = remainingEntries.some(e => {
        const ext = path.extname(e).toLowerCase();
        return videoExtensions.includes(ext);
      });

      if (hasVideo) {
        console.error(`[library-delete] ERROR: Video file still in folder, aborting delete`);
        return res.json(fail('Safety check failed: video still in folder'));
      }

      // Safe to delete folder now
      fs.rmSync(folderPath, { recursive: true, force: true });
      console.error(`[library-delete] Deleted folder: ${folderPath}`);
    }

    // Remove item from libraryReader cache
    const folderName = path.basename(folderPath);
    const index = libraryReader.items.findIndex(item => item.id === folderName);
    if (index !== -1) {
      libraryReader.items.splice(index, 1);
      if (libraryReader.currentIndex >= libraryReader.items.length) {
        libraryReader.currentIndex = Math.max(0, libraryReader.items.length - 1);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// POST /scrape/reload
router.post("/scrape/reload", (req, res) => {
  try {
    scrapeReader.loadScrapeItems();
    res.json({ ok: true, count: scrapeReader.getCount() });
  } catch (err) {
    res.json(fail(err.message));
  }
});

// POST /scrape/save
// Save the current item in scrape mode (create folder, move video, generate NFO, download images)
router.post("/scrape/save", async (req, res) => {
  try {
    // Get the item ID and modified data from the client
    const { itemId, item: modifiedData } = req.body;

    if (!itemId) {
      return res.json(fail("Item ID missing"));
    }

    // Load the JSON file directly using the itemId
    const outputDir = getScrapePath();
    const jsonPath = path.join(outputDir, `${itemId}.json`);

    if (!fs.existsSync(jsonPath)) {
      return res.json(fail(`JSON file not found: ${itemId}`));
    }

    // Read the original JSON data
    const jsonData = fs.readFileSync(jsonPath, "utf8");
    const originalJson = JSON.parse(jsonData);

    // The JSON structure is: { videoFile, scrapedAt, sources, data: {...} }
    // modifiedData contains the updated item data from the client
    // We need to merge modifiedData into originalJson.data, keeping videoFile at root level
    const itemToSave = {
      ...originalJson.data,  // Original scraped data
      ...modifiedData        // Modified data from client (has the same structure as data)
    };

    // Create a currentScrapeItem object compatible with ScrapeSaver
    // ScrapeSaver expects: { videoFile, scrapedAt, sources, data }
    // Use modifiedData.id (may be uppercase) for folder/NFO, itemId for file lookup only
    const currentScrapeItem = {
      id: modifiedData?.id || itemId,
      jsonPath: jsonPath,
      videoFile: originalJson.videoFile,  // Keep videoFile from original JSON
      scrapedAt: originalJson.scrapedAt,
      sources: originalJson.sources,
      data: originalJson.data
    };

    // Create ScrapeSaver instance with updated config
    const currentConfig = loadConfig();
    const saver = new ScrapeSaver(currentConfig);

    // Save the item
    const results = await saver.saveItem(itemToSave, currentScrapeItem);

    if (results.success) {
      // Scrape actors AFTER saving the movie
      const actorResults = { scraped: 0, failed: 0 };

      if (currentConfig.actorsEnabled && itemToSave.actor && Array.isArray(itemToSave.actor)) {
        const { getActor, saveActorLocal } = require('../core/actorScraperManager');
        const { normalizeActorName } = require('../../scrapers/actors/schema');
        const actorDb = require('../../scrapers/actors/actorDb');

        console.error(`[Routes] Scraping ${itemToSave.actor.length} actors from saved movie`);

        for (const actor of itemToSave.actor) {
          if (actor.name) {
            try {
              // Persist whatever is in the form right now — a manual edit
              // (e.g. a corrected name, or name/alt name swapped) — before
              // falling through to auto-fill. getActor() below only fills
              // fields that are still empty, so without this an edit to an
              // already-"complete" actor would otherwise be silently
              // discarded instead of updating the index.
              const resolvedId = resolveActorSaveId(actor, actorDb, normalizeActorName);
              saveActorLocal({ ...actor, id: resolvedId, meta: { sources: ['manual'] } }, { replaceNames: true });

              console.error(`[Routes] Scraping actor: ${actor.name}`);
              await getActor(actor.name, false, actor.altName || []);
              actorResults.scraped++;
            } catch (error) {
              console.error(`[Routes] Failed to scrape actor ${actor.name}:`, error.message);
              actorResults.failed++;
            }
          }
        }

        console.error(`[Routes] Actor scraping completed: ${actorResults.scraped} scraped, ${actorResults.failed} failed`);
      }

      // Auto copy actor thumbs to movie folder if enabled in config
      if (currentConfig.scrapers?.actors?.copyToMovieFolder && results.folder && itemToSave.actor?.length) {
        try {
          const { copied, skipped } = await copyActorsToFolder(results.folder, itemToSave.actor);
          console.error(`[Routes] Auto copy actors: copied=${copied.length}, skipped=${skipped.length}`);
        } catch (err) {
          console.error('[Routes] Auto copy actors failed:', err.message);
        }
      }

      // Remove the JSON file (it has been processed and saved)
      try {
        fs.unlinkSync(jsonPath);
        console.error(`[Routes] Deleted processed JSON: ${jsonPath}`);
      } catch (err) {
        console.error(`[Routes] Failed to delete JSON ${jsonPath}:`, err.message);
      }

      // Reload scrape items list
      scrapeReader.loadScrapeItems();

      // Reset and reload the library to show the new item
      // We need to reset to ensure the count is accurate after adding a new item
      libraryReader.reset();
      libraryReader.loadLibrary();

      res.json({
        ok: true,
        message: "Item saved successfully",
        results: {
          folder: results.folder,
          video: results.video ? path.basename(results.video) : null,
          nfo: results.nfo ? path.basename(results.nfo) : null,
          fanart: results.fanart ? path.basename(results.fanart) : null,
          poster: results.poster ? path.basename(results.poster) : null,
          warnings: results.warnings
        },
        actors: actorResults
      });
    } else {
      res.json(fail(`Save failed: ${results.errors.join(", ")}`));
    }

  } catch (err) {
    res.json(fail(err.message));
  }
});

// ─────────────────────────────
// POST /item/scrape/start
// Start scraping via WebSocket for bidirectional communication
// ─────────────────────────────
router.post("/scrape/start", async (req, res) => {
  const { EventEmitter } = require('events');
  const { scrapeAll, extractCodesFromLibrary } = require('../core/scraperManager');

  try {
    // Get config - always reload fresh config to ensure we use the current library path
    const config = loadConfig();

    // Extract codes from library path
    const libraryPath = config.libraryPath;

    if (!libraryPath) {
      return res.json({ ok: false, error: 'libraryPath not specified in config.json' });
    }

    console.error(`[Routes] Scraping starting with library path: ${libraryPath}`);

    const codes = extractCodesFromLibrary(libraryPath);

    if (codes.length === 0) {
      return res.json({ ok: false, error: 'No files found in library' });
    }

    console.error(`[Routes] Found ${codes.length} file(s) to scrape`);

    // Filter out already scraped codes
    const outputDir = getScrapePath();
    console.error(`[Routes] Scrape output directory: ${outputDir}`);

    const codesToScrape = codes.filter(code => {
      const jsonPath = path.join(outputDir, `${code}.json`);
      return !fs.existsSync(jsonPath);
    });

    if (codesToScrape.length === 0) {
      return res.json({ ok: false, error: 'All files already scraped. Nothing to do.' });
    }

    console.error(`[Routes] Scraping ${codesToScrape.length} new file(s)`);

    // Return immediate response with WebSocket ID
    const scrapeId = Date.now().toString();
    res.json({ ok: true, scrapeId, message: 'Scraping started. Connect to WebSocket for progress.' });

    // Count total scrapers (video + actors if enabled)
    // config is already loaded above at line 493
    let totalScrapers = 1; // Always have video scraping
    if (config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled) {
      totalScrapers++; // Add actor scraping
    }
    let completedScrapers = 0;
    console.error(`[Routes] Total scrapers to run: ${totalScrapers}`);

    // Helper function to check if all scraping is complete
    const checkAllScrapingComplete = () => {
      completedScrapers++;
      console.error(`[Routes] Scraper completed: ${completedScrapers}/${totalScrapers}`);

      if (completedScrapers >= totalScrapers) {
        console.error('[Routes] All scraping completed, sending complete event');
        req.wss.clients.forEach(client => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({
              event: 'complete',
              data: { message: 'All scraping completed' },
              scrapeId
            }));
          }
        });
      }
    };

    // Start scraping in background with WebSocket communication
    const emitter = new EventEmitter();

    // Broadcast events to all WebSocket clients
    emitter.on('start', (data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(JSON.stringify({ event: 'start', data, scrapeId }));
        }
      });
    });

    emitter.on('progress', (data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ event: 'progress', data, scrapeId }));
        }
      });
    });

    emitter.on('scraperError', (data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          // Send error to client
          client.send(JSON.stringify({ event: 'scraperError', data, scrapeId }));

          // Store callback to be called when user responds
          if (data.callback) {
            client.pendingScraperError = data.callback;
          }
        }
      });
    });

    // Note: Video scraping completion is handled in .then() below

    emitter.on('error', (data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ event: 'error', data, scrapeId }));
        }
      });
    });

    emitter.on('prompt', (data) => {
      // Store callback for this prompt
      const promptId = Date.now().toString();

      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            event: 'prompt',
            data: {
              promptId,
              scraperName: data.scraperName,
              promptType: data.promptType,
              message: data.message
            },
            scrapeId
          }));

          // Store callback to be called when user responds
          client.pendingPrompts = client.pendingPrompts || {};
          client.pendingPrompts[promptId] = data.callback;
        }
      });
    });

    // Execute scraping (don't await, let it run in background)
    scrapeAll(codesToScrape, emitter)
      .then(() => {
        console.error('[Routes] Video scraping completed successfully');

        // Video scraping done - increment counter
        checkAllScrapingComplete();

        // Auto-start actor scraping if enabled
        if (config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled) {
          console.error('[Routes] Auto-starting actor scraping after video scraping completed');

          // Wait 1 second before starting actor scraping
          setTimeout(() => {
            // Send notification to client
            req.wss.clients.forEach(client => {
              if (client.readyState === 1) {
                client.send(JSON.stringify({
                  event: 'progress',
                  data: { message: '🎭 Starting automatic actor scraping...' },
                  scrapeId
                }));
              }
            });

            // Start actor processing for scraped movies only
            const { processMultipleMoviesActors } = require('../core/actorScraperManager');

            processMultipleMoviesActors(codesToScrape, emitter)
              .then((summary) => {
                console.error('[Routes] Actor scraping completed successfully');

                // Send completion message
                req.wss.clients.forEach(client => {
                  if (client.readyState === 1) {
                    client.send(JSON.stringify({
                      event: 'progress',
                      data: {
                        message: `✅ Actor scraping completed: ${summary.scraping.total} actors processed (${summary.scraping.scraped} new, ${summary.scraping.cached} cached, ${summary.scraping.failed} failed). ${summary.updating.updated} movie files updated.`
                      },
                      scrapeId
                    }));

                    // Send actorsUpdated event to trigger client reload
                    client.send(JSON.stringify({
                      event: 'actorsUpdated',
                      data: {
                        updated: summary.updating.updated
                      },
                      scrapeId
                    }));
                  }
                });

                // Actor scraping done - increment counter
                checkAllScrapingComplete();
              })
              .catch((error) => {
                console.error('[Routes] Error in auto actor scraping:', error);
                req.wss.clients.forEach(client => {
                  if (client.readyState === 1) {
                    client.send(JSON.stringify({
                      event: 'progress',
                      data: { message: `❌ Actor scraping failed: ${error.message}` },
                      scrapeId
                    }));
                  }
                });

                // Actor scraping failed but still increment counter
                checkAllScrapingComplete();
              });
          }, 1000);
        }
      })
      .catch(error => {
        console.error('[Routes] Scraping error:', error);
        console.error('[Routes] Error stack:', error.stack);
        emitter.emit('error', { message: error.message });

        // Even on error, increment counter to show close button
        checkAllScrapingComplete();
      });

  } catch (error) {
    console.error('[Routes] Error starting scrape:', error);
    res.json({ ok: false, error: error.message });
  }
});

// ─────────────────────────────
// POST /actors/batch-process
// Batch scrape actors from all movie JSONs and update them
// ─────────────────────────────
router.post("/actors/batch-process", async (req, res) => {
  const { batchProcessActors } = require('../core/actorScraperManager');

  try {
    console.error('[Routes] Starting batch actor processing...');

    // Run batch processing
    const summary = await batchProcessActors();

    res.json({
      ok: true,
      message: 'Batch actor processing completed',
      summary: summary
    });

  } catch (error) {
    console.error('[Routes] Error in batch actor processing:', error);
    res.json({ ok: false, error: error.message });
  }
});

// ─────────────────────────────
// POST /actors/search
// Search for a single actor by name
// ─────────────────────────────
router.post("/actors/search", async (req, res) => {
  const { getActor } = require('../core/actorScraperManager');

  try {
    const { name, altName, forceOverwrite } = req.body;

    if (!name) {
      return res.json({ ok: false, error: 'Actor name is required' });
    }

    console.error(`[Routes] Searching for actor: ${name}${altName ? ` (alt: ${altName})` : ''}${forceOverwrite ? ' (force overwrite)' : ''}`);

    // Search/scrape actor — altName is passed as extra name candidates for online scrapers
    const actorData = await getActor(name, forceOverwrite || false, altName || []);

    if (actorData) {
      res.json({
        ok: true,
        actor: actorData
      });
    } else {
      res.json({
        ok: false,
        error: 'Actor not found'
      });
    }

  } catch (error) {
    console.error('[Routes] Error searching actor:', error);
    res.json({ ok: false, error: error.message });
  }
});

// ─────────────────────────────
// POST /item/scrape/rescrape
// Re-scrape a specific movie with a selected scraper and merge with existing data
// ─────────────────────────────
router.post("/scrape/rescrape", async (req, res) => {
  const { EventEmitter } = require('events');
  const { executeScraper, mergeResults, formatTitle } = require('../core/scraperManager');

  try {
    const { movieId, scraper } = req.body;

    if (!movieId || !scraper) {
      return res.json({ ok: false, error: 'Missing movieId or scraper parameter' });
    }

    // Check if JSON file exists
    const outputDir = getScrapePath();
    const jsonPath = path.join(outputDir, `${movieId}.json`);

    if (!fs.existsSync(jsonPath)) {
      return res.json({ ok: false, error: `Movie ${movieId} not found in scrape data` });
    }

    // Load existing data
    let existingWrapper;
    try {
      const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
      existingWrapper = JSON.parse(jsonContent);
    } catch (err) {
      return res.json({ ok: false, error: `Failed to read existing data: ${err.message}` });
    }

    console.error(`[Routes] Re-scraping ${movieId} with ${scraper}`);

    // Return immediate response with WebSocket ID
    const scrapeId = Date.now().toString();
    res.json({ ok: true, scrapeId, message: `Re-scraping started with ${scraper}` });

    // Start re-scraping in background with WebSocket communication
    const emitter = new EventEmitter();

    // Broadcast events to all WebSocket clients
    emitter.on('start', (data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ event: 'start', data, scrapeId }));
        }
      });
    });

    emitter.on('progress', (data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ event: 'progress', data, scrapeId }));
        }
      });
    });

    emitter.on('scraperError', (data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ event: 'scraperError', data, scrapeId }));
          if (data.callback) {
            client.pendingScraperError = data.callback;
          }
        }
      });
    });

    emitter.on('error', (data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ event: 'error', data, scrapeId }));
        }
      });
    });

    emitter.on('prompt', (data) => {
      const promptId = Date.now().toString();
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            event: 'prompt',
            data: {
              promptId,
              scraperName: data.scraperName,
              promptType: data.promptType,
              message: data.message
            },
            scrapeId
          }));
          client.pendingPrompts = client.pendingPrompts || {};
          client.pendingPrompts[promptId] = data.callback;
        }
      });
    });

    // Count total tasks (video + actors if enabled)
    const config = loadConfig();
    let totalTasks = 1; // Always have video re-scraping
    if (config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled) {
      totalTasks++; // Add actor scraping
    }
    let completedTasks = 0;
    console.error(`[Routes] Total tasks to run: ${totalTasks}`);

    // Helper function to check if all tasks are complete
    const checkAllTasksComplete = () => {
      completedTasks++;
      console.error(`[Routes] Task completed: ${completedTasks}/${totalTasks}`);

      if (completedTasks >= totalTasks) {
        console.error('[Routes] All re-scraping tasks completed, sending complete event');
        req.wss.clients.forEach(client => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({
              event: 'complete',
              data: {
                message: `Re-scraping completed. Data merged with priority to ${scraper}.`,
                movieId: movieId
              },
              scrapeId
            }));
          }
        });

        // Reload scrape reader to reflect changes
        scrapeReader.loadScrapeItems();
      }
    };

    // Execute scraper for single movie
    executeScraper(scraper, [movieId], emitter)
      .then((results) => {
        console.error(`[Routes] Re-scraping with ${scraper} completed`);

        // Results is an array of scraped data
        if (!results || results.length === 0) {
          throw new Error(`No results from scraper ${scraper}`);
        }

        const newData = results[0];

        // Manual merge with priority to new data
        // Start with existing data as base
        const mergedData = JSON.parse(JSON.stringify(existingWrapper.data));

        // Override with new data where available (non-empty values)
        Object.keys(newData).forEach(field => {
          const value = newData[field];

          // Check if value is non-empty
          const isEmpty = value === null ||
                         value === undefined ||
                         value === '' ||
                         (Array.isArray(value) && value.length === 0) ||
                         (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

          // If new value is not empty, use it (override existing)
          if (!isEmpty) {
            mergedData[field] = value;
          }
          // If new value is empty but field doesn't exist in merged, add it anyway
          else if (!(field in mergedData)) {
            mergedData[field] = value;
          }
        });

        // Ensure 'id' matches movieId
        mergedData.id = movieId;

        // Apply genre filter rules
        const { applyGenreRules } = require('../core/genreFilter');
        const rescrapeConfig = loadConfig();
        if (mergedData.genres && rescrapeConfig.genreRules) {
          mergedData.genres = applyGenreRules(mergedData.genres, rescrapeConfig.genreRules);
        }

        // Compose title field using configured pattern, independent of the scraper used.
        // Only reformat when this scraper actually returned a fresh raw title —
        // mergedData.title otherwise still holds the already-composed title from
        // a previous scrape, and reformatting it again would double up placeholders like {id}.
        if (newData.title) {
          mergedData.title = formatTitle(mergedData, rescrapeConfig);
        }

        // Update wrapper with new data and metadata
        const updatedWrapper = {
          scrapedAt: new Date().toISOString(),
          sources: [...new Set([scraper, ...(existingWrapper.sources || [])])],
          videoFile: existingWrapper.videoFile,
          data: mergedData
        };

        // Save updated JSON
        fs.writeFileSync(jsonPath, JSON.stringify(updatedWrapper, null, 2), 'utf-8');
        console.error(`[Routes] Saved merged data to ${jsonPath}`);

        // Video scraping done - increment counter
        checkAllTasksComplete();

        // Auto-start actor scraping if enabled
        if (config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled) {
          console.error('[Routes] Auto-starting actor scraping after video re-scraping completed');

          // Wait 1 second before starting actor scraping
          setTimeout(() => {
            // Send notification to client
            req.wss.clients.forEach(client => {
              if (client.readyState === 1) {
                client.send(JSON.stringify({
                  event: 'progress',
                  data: { message: '🎭 Starting automatic actor scraping...' },
                  scrapeId
                }));
              }
            });

            // Start single movie actor processing
            const { processSingleMovieActors } = require('../core/actorScraperManager');

            processSingleMovieActors(movieId, emitter)
              .then((summary) => {
                console.error('[Routes] Actor scraping completed successfully');

                // Send completion message
                req.wss.clients.forEach(client => {
                  if (client.readyState === 1) {
                    client.send(JSON.stringify({
                      event: 'progress',
                      data: {
                        message: `✅ Actor scraping completed: ${summary.total} actors processed (${summary.scraped} new, ${summary.cached} cached, ${summary.failed} failed). Movie file updated: ${summary.movieUpdated ? 'Yes' : 'No'}`
                      },
                      scrapeId
                    }));

                    // Send actorsUpdated event to trigger client reload
                    client.send(JSON.stringify({
                      event: 'actorsUpdated',
                      data: {
                        updated: summary.movieUpdated
                      },
                      scrapeId
                    }));
                  }
                });

                // Actor scraping done - increment counter
                checkAllTasksComplete();
              })
              .catch((error) => {
                console.error('[Routes] Error in auto actor scraping:', error);
                req.wss.clients.forEach(client => {
                  if (client.readyState === 1) {
                    client.send(JSON.stringify({
                      event: 'progress',
                      data: { message: `❌ Actor scraping failed: ${error.message}` },
                      scrapeId
                    }));
                  }
                });

                // Actor scraping failed but still increment counter
                checkAllTasksComplete();
              });
          }, 1000);
        }
      })
      .catch((err) => {
        console.error(`[Routes] Re-scraping error:`, err);
        req.wss.clients.forEach(client => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({
              event: 'error',
              data: { message: err.message },
              scrapeId
            }));
          }
        });

        // Even on error, increment counter to allow completion
        checkAllTasksComplete();
      });

  } catch (err) {
    console.error('[Routes] Re-scraping error:', err);
    return res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /item/scrape/clear-cache
// Clear the cache of all scrapers
// ─────────────────────────────
router.post("/scrape/clear-cache", async (req, res) => {
  try {
    // Scrapers are now organized in subdirectories (movies, actors, etc.)
    const scrapersBaseDir = path.join(__dirname, '../../scrapers');
    const scraperTypes = fs.readdirSync(scrapersBaseDir).filter(name => {
      const typePath = path.join(scrapersBaseDir, name);
      return fs.statSync(typePath).isDirectory() && name !== 'README.md';
    });

    let clearedCount = 0;

    // Iterate through each scraper type (movies, actors, etc.)
    for (const scraperType of scraperTypes) {
      const typeDir = path.join(scrapersBaseDir, scraperType);
      const scrapers = fs.readdirSync(typeDir);

      for (const scraper of scrapers) {
        // Skip template, schema, and non-directories
        if (scraper === '_template' || scraper.endsWith('.js') || scraper.endsWith('.md')) continue;

        const scraperPath = path.join(typeDir, scraper);
        const stat = fs.statSync(scraperPath);

        if (!stat.isDirectory()) continue;

        // Check for common cache directories
        const cacheDirs = [
          path.join(scraperPath, '.browser-data'),
          path.join(scraperPath, '.cache'),
          path.join(scraperPath, 'cache')
        ];

        for (const cacheDir of cacheDirs) {
          if (fs.existsSync(cacheDir)) {
            // Remove cache directory recursively
            fs.rmSync(cacheDir, { recursive: true, force: true });
            console.error(`[ClearCache] Removed: ${cacheDir}`);
            clearedCount++;
          }
        }
      }
    }

    // NOTE: data/actors/ is NOT cleared here — it is persistent actor storage
    // (NFO + photos), not a disposable scraper cache. Actors not yet promoted
    // to the external library live there exclusively; wiping it would delete
    // their data permanently.

    res.json({
      ok: true,
      message: `Cleared ${clearedCount} cache director${clearedCount === 1 ? 'y' : 'ies'}`
    });

  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /genre-rules/apply — apply genre rules to all data/scrape/*.json files
// ─────────────────────────────
router.post("/genre-rules/apply", async (req, res) => {
  try {
    const { applyGenreRules } = require('../core/genreFilter');
    const { loadConfig, getScrapePath } = require('../core/config');

    const config = loadConfig();
    const rulesText = config.genreRules || '';

    if (!rulesText.trim()) {
      return res.json({ ok: true, updated: 0, message: 'No genre rules defined' });
    }

    const scrapeDir = getScrapePath();
    if (!fs.existsSync(scrapeDir)) {
      return res.json({ ok: true, updated: 0, message: 'Scrape directory is empty' });
    }

    const files = fs.readdirSync(scrapeDir).filter(f => f.endsWith('.json'));
    let updated = 0;

    for (const file of files) {
      const filePath = path.join(scrapeDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const wrapped = JSON.parse(raw);

        if (!wrapped.data || !Array.isArray(wrapped.data.genres)) continue;

        const before = wrapped.data.genres;
        const after = applyGenreRules(before, rulesText);

        const changed = JSON.stringify(before) !== JSON.stringify(after);
        if (changed) {
          wrapped.data.genres = after;
          fs.writeFileSync(filePath, JSON.stringify(wrapped, null, 2), 'utf-8');
          updated++;
        }
      } catch (err) {
        console.error(`[genre-rules/apply] Error processing ${file}: ${err.message}`);
      }
    }

    res.json({ ok: true, updated, total: files.length });
  } catch (err) {
    console.error('[genre-rules/apply]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /genre-rules/apply-library — apply genre rules to all library NFO files (edit mode)
// ─────────────────────────────
router.post("/genre-rules/apply-library", async (req, res) => {
  try {
    const { applyGenreRules } = require('../core/genreFilter');
    const { readNfo } = require('../core/readNfo');
    const { mapNfoToModel } = require('../core/nfoMapper');

    const config = loadConfig();
    const rulesText = config.genreRules || '';

    if (!rulesText.trim()) {
      return res.json({ ok: true, updated: 0, message: 'No genre rules defined' });
    }

    if (libraryReader.items.length === 0) {
      libraryReader.loadLibrary();
    }

    const items = libraryReader.items.filter(item => item.nfo && fs.existsSync(item.nfo));
    let updated = 0;

    for (const item of items) {
      try {
        const parsedXml = await readNfo(item.nfo);
        const model = mapNfoToModel(parsedXml);
        if (!model || !Array.isArray(model.genres)) continue;

        const before = model.genres;
        const after = applyGenreRules(before, rulesText);

        if (JSON.stringify(before) !== JSON.stringify(after)) {
          await saveNfoPatch(item.nfo, { genres: after });
          updated++;
        }
      } catch (err) {
        console.error(`[genre-rules/apply-library] Error processing ${item.nfo}: ${err.message}`);
      }
    }

    res.json({ ok: true, updated, total: items.length });
  } catch (err) {
    console.error('[genre-rules/apply-library]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// Actor Management Routes
// ─────────────────────────────

const {
  saveActorLocal,
  scrapeActor
} = require('../core/actorScraperManager');



// ─────────────────────────────
// GET /actors - List all actors from the internal cache (data/actors)
router.get("/actors", async (req, res) => {
  try {
    // The internal cache (data/actors) is the single library all actors are
    // read from — externalPath is only ever a copy destination for favorites.
    const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
    const { nfoToActor } = require('../../scrapers/actors/schema');
    const actorsPath = getActorsCachePath();

    if (!actorsPath || !fs.existsSync(actorsPath)) {
      return res.json({ ok: true, actors: [] });
    }

    const files = fs.readdirSync(actorsPath);
    const actors = [];

    const { normalizeActorName } = require('../../scrapers/actors/schema');

    for (const file of files) {
      if (!file.endsWith('.nfo')) continue;

      try {
        const nfoContent = fs.readFileSync(path.join(actorsPath, file), 'utf-8');
        const actor = nfoToActor(nfoContent);
        let fileId = file.replace('.nfo', '');
        // If filename-derived ID is empty (e.g. ".nfo"), rename the file using name-based ID
        if (!fileId && actor.name) {
          const newId = normalizeActorName(actor.name);
          if (newId) {
            const oldPath = path.join(actorsPath, file);
            const newNfoPath = path.join(actorsPath, `${newId}.nfo`);
            try {
              fs.renameSync(oldPath, newNfoPath);
              fileId = newId;
            } catch (_) {}
          }
        }
        actor.id = fileId || null;
        if (actor.name && actor.id) actors.push(actor);
      } catch (_) {}
    }

    actors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json({ ok: true, actors });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// POST /actors/save - Save actor
// ─────────────────────────────
// externalPath ("Copy favorite actors to") photo mirroring
//
// Two independent bugs used to live here: syncing only copied the new file
// if a same-named file wasn't already there (so re-uploading the same
// actor's photo a second time silently no-opped), and neither sync path
// removed a same-id file under a DIFFERENT extension — so an old .webp
// could sit next to a fresh .jpg forever. The /actors/:file serving route
// (index.js) tries extensions in a fixed order and returns the first match,
// so a stale old-extension file keeps winning over the new photo even
// though the "current" one did get copied. Centralizing the sync here so
// there's exactly one place that (a) always overwrites and (b) always
// clears every other extension first.
// ─────────────────────────────
function syncFavoritePhotoToExternal(actorId, cacheFilename) {
  const { getActorsCachePath, getExternalActorsPath } = require('../../scrapers/actors/cache-helper');
  const extPath = getExternalActorsPath();
  if (!extPath) return;

  const cachedPhoto = path.join(getActorsCachePath(), cacheFilename);
  if (!fs.existsSync(cachedPhoto)) return;

  if (!fs.existsSync(extPath)) fs.mkdirSync(extPath, { recursive: true });

  const oldPicsDir = path.join(extPath, 'old-pics');
  if (!fs.existsSync(oldPicsDir)) fs.mkdirSync(oldPicsDir, { recursive: true });

  const ts = Date.now();
  const imageExtensions = ['.webp', '.jpg', '.jpeg', '.png', '.gif'];
  imageExtensions.forEach(e => {
    const oldImg = path.join(extPath, `${actorId}${e}`);
    if (fs.existsSync(oldImg)) {
      try { fs.renameSync(oldImg, path.join(oldPicsDir, `${ts}_${actorId}${e}`)); } catch (_) {}
    }
  });

  try {
    fs.copyFileSync(cachedPhoto, path.join(extPath, cacheFilename));
    console.log(`[ActorSave] Synced photo to externalPath: ${cacheFilename}`);
    require('../../scrapers/actors/actorDb').touchExternalFile(actorId, cacheFilename);
  } catch (err) {
    console.error('[ActorSave] Failed to sync photo to externalPath:', err.message);
  }
}

// Mirror image of syncFavoritePhotoToExternal(): removes every extension for
// this actor id from externalPath (soft-deleted to old-pics/, same as above)
// and clears the DB's external-file reference. Used when the local photo is
// deleted — without this, the externalPath copy (and the stale extension it
// might be under) keeps winning in the serving route's fallback order.
function removeFavoritePhotoFromExternal(actorId) {
  const { getExternalActorsPath } = require('../../scrapers/actors/cache-helper');
  const extPath = getExternalActorsPath();
  if (!extPath || !fs.existsSync(extPath)) return false;

  const oldPicsDir = path.join(extPath, 'old-pics');
  const imageExtensions = ['.webp', '.jpg', '.jpeg', '.png', '.gif'];
  let removed = false;
  imageExtensions.forEach(e => {
    const img = path.join(extPath, `${actorId}${e}`);
    if (fs.existsSync(img)) {
      if (!fs.existsSync(oldPicsDir)) fs.mkdirSync(oldPicsDir, { recursive: true });
      try { fs.renameSync(img, path.join(oldPicsDir, `${Date.now()}_${actorId}${e}`)); removed = true; } catch (_) {}
    }
  });

  if (removed) {
    require('../../scrapers/actors/actorDb').touchExternalFile(actorId, '');
  }
  return removed;
}

router.post("/actors/save", async (req, res) => {
  try {
    const { normalizeActorName } = require('../../scrapers/actors/schema');
    const actorData = req.body;

    // The id is stable once assigned — it's an internal slug, not required
    // to match a fresh normalize of the current name (many ids were
    // established in inverted order by a scraper, e.g. "shina-sara" for
    // "Sara Shina"). Only derive a fresh id when the actor truly has none
    // yet; recomputing it from the current name on every save used to
    // mistake "id isn't derivable from the name" for "actor was renamed"
    // and delete the real NFO/photo out from under an unrelated fresh id.
    if (!actorData.id) {
      actorData.id = normalizeActorName(actorData.name);
    }

    // Update thumbUrl if thumb is a remote URL
    if (actorData.thumb && actorData.thumb.startsWith('http')) {
      actorData.thumbUrl = actorData.thumb;
    }

    // If forceOverwrite is true and we have a remote thumb URL, download it
    if (actorData.forceOverwrite && actorData.thumb && actorData.thumb.startsWith('http')) {
      try {
        console.log(`[ActorSave] Force overwrite enabled, downloading image: ${actorData.thumb}`);

        // Download image using native https/http
        const imageUrl = new URL(actorData.thumb);
        const protocol = imageUrl.protocol === 'https:' ? https : http;

        const imageBuffer = await new Promise((resolve, reject) => {
          const chunks = [];
          const request = protocol.get(actorData.thumb, { timeout: 15000 }, (response) => {
            // Follow redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              const redirectUrl = response.headers.location;
              const redirectProtocol = redirectUrl.startsWith('https') ? https : http;
              redirectProtocol.get(redirectUrl, { timeout: 15000 }, (redirectResponse) => {
                redirectResponse.on('data', chunk => chunks.push(chunk));
                redirectResponse.on('end', () => resolve(Buffer.concat(chunks)));
                redirectResponse.on('error', reject);
              }).on('error', reject);
              return;
            }

            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
          });

          request.on('error', reject);
          request.on('timeout', () => {
            request.destroy();
            reject(new Error('Request timeout'));
          });
        });

        // Save to temp directory
        const tempPath = path.join(__dirname, '../../data/temp');
        if (!fs.existsSync(tempPath)) {
          fs.mkdirSync(tempPath, { recursive: true });
        }

        // Generate unique temp filename
        const hash = crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 8);
        const timestamp = Date.now();
        const ext = path.extname(imageUrl.pathname) || '.jpg';
        const tempFilename = `temp_overwrite_${timestamp}_${hash}${ext}`;
        const tempFilePath = path.join(tempPath, tempFilename);

        fs.writeFileSync(tempFilePath, imageBuffer);
        console.log(`[ActorSave] Downloaded image to temp: ${tempFilename}`);

        // Set uploadedFile to the temp path so it will be moved to actors folder
        actorData.uploadedFile = `/media/${tempFilename}`;

      } catch (downloadErr) {
        console.error(`[ActorSave] Failed to download remote image: ${downloadErr.message}`);
        // Continue without downloading - will keep the remote URL
      }
    }

    const { getActorsCachePath, getExternalActorsPath } = require('../../scrapers/actors/cache-helper');
    const { actorToNFO } = require('../../scrapers/actors/schema');
    const imageExtensions = ['.webp', '.jpg', '.jpeg', '.png', '.gif'];

    // Handle uploaded image: move temp file to actors cache
    const uploadedPath = actorData.uploadedFile || (actorData.thumb && actorData.thumb.startsWith('/media/temp_') ? actorData.thumb : null);

    if (uploadedPath) {
      const tempFilename = uploadedPath.replace('/media/', '');
      const tempPath = path.join(__dirname, '../../data/temp', tempFilename);

      if (fs.existsSync(tempPath)) {
        const actorsPath = getActorsCachePath();
        if (!fs.existsSync(actorsPath)) fs.mkdirSync(actorsPath, { recursive: true });

        const ext = path.extname(tempFilename);
        const newFilename = `${actorData.id}${ext}`;
        const newPath = path.join(actorsPath, newFilename);

        // Remove all existing image files for this actor ID in cache
        imageExtensions.forEach(e => {
          const old = path.join(actorsPath, `${actorData.id}${e}`);
          if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch (_) {} }
        });

        const fsPromises = require('fs').promises;
        try {
          await fsPromises.copyFile(tempPath, newPath);
          await fsPromises.unlink(tempPath);
        } catch (moveErr) {
          console.error('[ActorSave] Error moving temp file:', moveErr);
          return res.json({ ok: false, error: `Failed to move uploaded image: ${moveErr.message}` });
        }

        actorData.thumbLocal = newFilename;
        actorData.thumb = '';

        // Sync new photo to externalPath when this actor is a favorite — that
        // path is now purely a "copy of favorites" destination, not the library.
        if (actorData.favorite) {
          syncFavoritePhotoToExternal(actorData.id, newFilename);
        }
      }
    }

    // Ensure meta object exists
    actorData.meta = actorData.meta || {};
    actorData.meta.lastUpdate = new Date().toISOString();

    // If thumbLocal is missing from request, resolve it from cache so NFO is written correctly
    if (!actorData.thumbLocal) {
      const cacheDir = getActorsCachePath();
      for (const e of ['.webp', '.jpg', '.jpeg', '.png', '.gif']) {
        if (fs.existsSync(path.join(cacheDir, `${actorData.id}${e}`))) {
          actorData.thumbLocal = `${actorData.id}${e}`;
          break;
        }
      }
    }

    // Save actor to internal cache always — this is the single library all
    // actors are read from (see GET /actors); externalPath is only ever a
    // copy destination for favorites, never the source of truth.
    // replaceNames: true so an alt name removed in the form is actually
    // dropped from the index instead of lingering forever (insertNameIfNew
    // only ever adds).
    saveActorLocal(actorData, { replaceNames: true });

    // Copy NFO (and photo) to externalPath when this actor is a favorite,
    // overwriting any previous copy so edits stay in sync.
    const extPath = getExternalActorsPath();
    if (actorData.favorite && extPath) {
      if (!fs.existsSync(extPath)) fs.mkdirSync(extPath, { recursive: true });
      const actorNfoInExt = path.join(extPath, `${actorData.id}.nfo`);

      const nfoContent = actorToNFO(actorData);
      fs.writeFileSync(actorNfoInExt, nfoContent, 'utf-8');

      // Sync photo to externalPath — thumbLocal may be absent from request
      // data (e.g. a save with no photo change), so fall back to scanning
      // the cache by actor ID.
      let thumbLocalToSync = actorData.thumbLocal;
      if (!thumbLocalToSync) {
        const cacheDir = getActorsCachePath();
        for (const e of imageExtensions) {
          const candidate = path.join(cacheDir, `${actorData.id}${e}`);
          if (fs.existsSync(candidate)) { thumbLocalToSync = `${actorData.id}${e}`; break; }
        }
      }
      if (thumbLocalToSync) {
        syncFavoritePhotoToExternal(actorData.id, thumbLocalToSync);
      }
    }

    res.json({ ok: true, id: actorData.id });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// POST /actors/delete - Delete actor from externalPath library
router.post("/actors/delete", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ ok: false, error: 'Actor ID required' });

    const { getActorsCachePath, getExternalActorsPath } = require('../../scrapers/actors/cache-helper');

    // Delete from every copy: the internal library and any favorite copy in externalPath.
    for (const dir of [getActorsCachePath(), getExternalActorsPath()].filter(Boolean)) {
      const nfoPath = path.join(dir, `${id}.nfo`);
      if (fs.existsSync(nfoPath)) fs.unlinkSync(nfoPath);

      for (const ext of ['webp', 'jpg', 'jpeg', 'png', 'gif']) {
        const imgPath = path.join(dir, `${id}.${ext}`);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
      }
    }

    // Explicit user action — the one and only place a persistent index row is removed
    require('../../scrapers/actors/actorDb').deleteActor(id);

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// Copies (or removes) an actor's NFO+photo between the internal cache and
// externalPath — externalPath is purely a "copy of favorites" destination,
// never the source of truth, so this only ever mirrors the cache's record.
function syncFavoriteCopy(actorId, isFavorite) {
  const { getActorsCachePath, getExternalActorsPath } = require('../../scrapers/actors/cache-helper');
  const extPath = getExternalActorsPath();
  if (!extPath) return;

  const cachePath = getActorsCachePath();
  const imageExts = ['webp', 'jpg', 'jpeg', 'png', 'gif'];

  if (isFavorite) {
    if (!fs.existsSync(extPath)) fs.mkdirSync(extPath, { recursive: true });

    const cacheNfo = path.join(cachePath, `${actorId}.nfo`);
    if (fs.existsSync(cacheNfo)) fs.copyFileSync(cacheNfo, path.join(extPath, `${actorId}.nfo`));

    for (const ext of imageExts) {
      const src = path.join(cachePath, `${actorId}.${ext}`);
      if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(extPath, `${actorId}.${ext}`)); break; }
    }
  } else {
    const extNfo = path.join(extPath, `${actorId}.nfo`);
    if (fs.existsSync(extNfo)) fs.unlinkSync(extNfo);

    for (const ext of imageExts) {
      const extImg = path.join(extPath, `${actorId}.${ext}`);
      if (fs.existsSync(extImg)) fs.unlinkSync(extImg);
    }
  }
}

// ─────────────────────────────
// POST /actors/favorite
// Mark/unmark an actor as favorite in the internal cache (the single
// library), then mirror the change to externalPath if configured — copying
// the NFO+photo there when favorited, deleting the copy when unfavorited.
// Also accepts name/altName/thumb/role so the movie page's favorite button
// can favorite an actor that isn't cached yet (e.g. actor scraping is
// disabled), creating a minimal record from the movie's own actor data.
// ─────────────────────────────
router.post("/actors/favorite", async (req, res) => {
  try {
    const { id, favorite, name, altName, thumb, role } = req.body;
    if (!id && !name) return res.json({ ok: false, error: 'Actor ID or name required' });

    const { normalizeActorName, nfoToActor, actorToNFO } = require('../../scrapers/actors/schema');
    const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
    const actorDb = require('../../scrapers/actors/actorDb');

    const isFavorite = !!favorite;
    const cachePath = getActorsCachePath();
    if (!fs.existsSync(cachePath)) fs.mkdirSync(cachePath, { recursive: true });

    // Resolve to an already-cached actor: explicit id, else look up by name via the index.
    let actorId = (id && fs.existsSync(path.join(cachePath, `${id}.nfo`))) ? id : null;
    if (!actorId && name) {
      const dbActor = actorDb.findActorByName(name);
      if (dbActor && fs.existsSync(path.join(cachePath, `${dbActor.id}.nfo`))) actorId = dbActor.id;
    }

    if (!actorId) {
      // Not cached yet — create a minimal record from the movie's own actor data.
      if (!name) return res.json({ ok: false, error: `Actor not found: ${id}` });
      actorId = normalizeActorName(name);

      let thumbLocal = '';
      if (thumb && thumb.startsWith('http')) {
        const urlExtension = thumb.match(/\.(webp|jpg|jpeg|png)(\?|$)/i);
        const ext = urlExtension ? urlExtension[1].toLowerCase() : 'jpg';
        const destPath = path.join(cachePath, `${actorId}.${ext}`);
        try {
          await new ScrapeSaver(loadConfig()).downloadImage(thumb, destPath);
          thumbLocal = `${actorId}.${ext}`;
        } catch (dlErr) {
          console.error('[actors/favorite] Failed to download thumb:', dlErr.message);
        }
      }

      saveActorLocal({
        id: actorId,
        name,
        altName: altName || '',
        role: role || 'Actress',
        thumbUrl: (thumb && thumb.startsWith('http')) ? thumb : '',
        thumbLocal,
        meta: { sources: ['manual'] }
      });
    }

    // actorDb.upsertActor() (inside saveActorLocal above) never touches the
    // favorite column, so it's set here — after the row is guaranteed to
    // exist — then patched into the on-disk NFO, which is what actually
    // drives display everywhere (GET /actors reads NFOs, not the DB).
    actorDb.setFavorite(actorId, isFavorite);

    const nfoPath = path.join(cachePath, `${actorId}.nfo`);
    const diskActor = nfoToActor(fs.readFileSync(nfoPath, 'utf-8'));
    diskActor.id = actorId;
    diskActor.favorite = isFavorite;
    fs.writeFileSync(nfoPath, actorToNFO(diskActor), 'utf-8');

    syncFavoriteCopy(actorId, isFavorite);

    res.json({ ok: true, id: actorId, favorite: isFavorite });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /actors/duplicates
// Candidate actor pairs sharing a name — surfaces the same check logged at
// startup (see index.js) so the merge UI can offer to review them.
// ─────────────────────────────
router.get("/actors/duplicates", async (req, res) => {
  try {
    const actorDb = require('../../scrapers/actors/actorDb');
    res.json({ ok: true, groups: actorDb.findDuplicateGroups() });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /actors/merge
// Merge loserId into winnerId (identity index + external/internal NFO
// copies) and delete the loser's record. Physical-field conflicts are
// resolved automatically by actorDb.mergeActors (winner wins, empty fields
// filled from loser) — no interactive per-field override from this endpoint.
// ─────────────────────────────
router.post("/actors/merge", async (req, res) => {
  try {
    const { winnerId, loserId } = req.body;
    if (!winnerId || !loserId || winnerId === loserId) {
      return res.json({ ok: false, error: 'winnerId and loserId (distinct) are required' });
    }

    const actorDb = require('../../scrapers/actors/actorDb');
    if (!actorDb.getActor(winnerId)) return res.json({ ok: false, error: `Actor not found: ${winnerId}` });
    if (!actorDb.getActor(loserId)) return res.json({ ok: false, error: `Actor not found: ${loserId}` });

    const merged = actorDb.mergeActors(winnerId, loserId);

    const { actorToNFO } = require('../../scrapers/actors/schema');
    const { getActorsCachePath, getExternalActorsPath } = require('../../scrapers/actors/cache-helper');
    const nfoDirs = [getExternalActorsPath(), getActorsCachePath()].filter(Boolean);

    const nfoContent = actorToNFO(merged);
    for (const dir of nfoDirs) {
      // Update the winner's record wherever it already exists.
      const winnerNfoPath = path.join(dir, `${winnerId}.nfo`);
      if (fs.existsSync(winnerNfoPath)) fs.writeFileSync(winnerNfoPath, nfoContent, 'utf-8');

      // Remove the loser's NFO + photo so it stops appearing as a separate actor.
      // Photo files are intentionally left in place (see actorDb.mergeActors doc).
      const loserNfoPath = path.join(dir, `${loserId}.nfo`);
      if (fs.existsSync(loserNfoPath)) fs.unlinkSync(loserNfoPath);
    }

    res.json({ ok: true, actor: merged });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /actors/remove-name
// Removes a single alt name from an actor — the alternative to
// /actors/merge when a duplicate-name match (GET /actors/duplicates) turns
// out to be a real name collision between two different people rather than
// the same person: instead of merging, drop the shared name from whichever
// one it doesn't actually belong to.
// ─────────────────────────────
router.post("/actors/remove-name", async (req, res) => {
  try {
    const { id, name } = req.body;
    if (!id || !name) return res.json({ ok: false, error: 'id and name are required' });

    const actorDb = require('../../scrapers/actors/actorDb');
    const names = actorDb.getActorNames(id);
    if (!names.primary) return res.json({ ok: false, error: `Actor not found: ${id}` });
    if (names.primary.toLowerCase() === String(name).toLowerCase()) {
      return res.json({ ok: false, error: `"${name}" is ${id}'s primary name — can't remove it here` });
    }

    const removed = actorDb.removeName(id, name);
    if (!removed) return res.json({ ok: false, error: `Name "${name}" not found on ${id}` });

    // Patch every NFO copy (internal cache + external favorite copy) so the
    // removed name also disappears from what's actually displayed/edited —
    // GET /actors reads NFOs directly, not the name index.
    const updatedNames = actorDb.getActorNames(id);
    const { nfoToActor, actorToNFO } = require('../../scrapers/actors/schema');
    const { getActorsCachePath, getExternalActorsPath } = require('../../scrapers/actors/cache-helper');

    for (const dir of [getActorsCachePath(), getExternalActorsPath()].filter(Boolean)) {
      const nfoPath = path.join(dir, `${id}.nfo`);
      if (!fs.existsSync(nfoPath)) continue;
      const actor = nfoToActor(fs.readFileSync(nfoPath, 'utf-8'));
      actor.id = id;
      actor.altName = updatedNames.alt.join(', ');
      fs.writeFileSync(nfoPath, actorToNFO(actor), 'utf-8');
    }

    res.json({ ok: true, id, names: updatedNames });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /actors/delete-image
// Delete local actor image
// ─────────────────────────────
router.post("/actors/delete-image", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) throw new Error("Missing actor ID");

    // Use centralized cache helper
    const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
    const actorsPath = getActorsCachePath();

    // Also try inverted ID: "asamiya-rei" → "rei-asamiya"
    const parts = id.split('-');
    const invertedId = parts.length >= 2
      ? [...parts.slice(Math.ceil(parts.length / 2)), ...parts.slice(0, Math.ceil(parts.length / 2))].join('-')
      : null;
    const idsToTry = [id, ...(invertedId && invertedId !== id ? [invertedId] : [])];

    const extensions = ['webp', 'jpg', 'jpeg', 'png', 'gif'];
    let deleted = false;

    for (const tryId of idsToTry) {
      for (const ext of extensions) {
        const imagePath = path.join(actorsPath, `${tryId}.${ext}`);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
          deleted = true;
        }
      }
    }

    // Deleting the cache file alone would leave the NFO and index still
    // pointing at it, and (for favorites) leave the externalPath mirror
    // untouched — either one makes the deleted photo keep reappearing (the
    // NFO/index reference resolves as if the file still existed, and the
    // /actors/:file route falls back to externalPath, which still has its
    // own copy). So this always clears all three, not just the cache file —
    // and, importantly, doesn't bail out early if there was no cache file to
    // begin with, since a stale NFO/external reference can outlive it (e.g.
    // a previous delete that ran before this cleanup existed).
    const { nfoToActor, actorToNFO } = require('../../scrapers/actors/schema');
    const nfoPath = path.join(actorsPath, `${id}.nfo`);
    let clearedNfoRef = false;
    if (fs.existsSync(nfoPath)) {
      const actor = nfoToActor(fs.readFileSync(nfoPath, 'utf-8'));
      if (actor.thumb || actor.thumbLocal || actor.thumbUrl) {
        actor.thumb = '';
        actor.thumbLocal = '';
        actor.thumbUrl = '';
        fs.writeFileSync(nfoPath, actorToNFO(actor), 'utf-8');
        clearedNfoRef = true;
      }
    }
    require('../../scrapers/actors/actorDb').touchCacheFile(id, '');
    const clearedExternal = removeFavoritePhotoFromExternal(id);

    if (!deleted && !clearedNfoRef && !clearedExternal) {
      return res.json({ ok: false, error: "No local image found to delete" });
    }

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});


// ─────────────────────────────
// POST /actors/upload-image
// Upload actor thumbnail image
// ─────────────────────────────

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

router.post("/actors/upload-image", upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ ok: false, error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname) || '.jpg';
    const actorName = req.body.actorName || '';

    // If actor name provided, save directly to cache (skip temp)
    if (actorName) {
      const { normalizeActorName } = require('../../scrapers/actors/schema');
      const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
      // Resolve the actor's real canonical id via the index first — a fresh
      // normalizeActorName(actorName) can differ from the id already on
      // record (e.g. ids established in inverted order by a scraper), which
      // would silently save the upload under a new, unrelated filename that
      // the index never looks at again.
      const existingActor = require('../../scrapers/actors/actorDb').findActorRowByName(actorName);
      const actorId = existingActor ? existingActor.id : normalizeActorName(actorName);
      const actorsPath = getActorsCachePath();

      if (!fs.existsSync(actorsPath)) fs.mkdirSync(actorsPath, { recursive: true });

      // Remove any existing image for this actor before saving
      ['.webp', '.jpg', '.jpeg', '.png', '.gif'].forEach(e => {
        const old = path.join(actorsPath, `${actorId}${e}`);
        if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch (_) {} }
      });

      const filename = `${actorId}${ext}`;
      fs.writeFileSync(path.join(actorsPath, filename), req.file.buffer);
      console.log(`[Upload] Saved directly to cache: ${filename}`);
      require('../../scrapers/actors/actorDb').touchCacheFile(actorId, filename);

      return res.json({ ok: true, url: `/actors/${filename}`, filename, savedToCache: true });
    }

    // No actor name: save to temp
    const tempDir = path.join(__dirname, '../../data/temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const hash = crypto.createHash('md5').update(req.file.buffer).digest('hex').substring(0, 8);
    const filename = `temp_${Date.now()}_${hash}${ext}`;
    fs.writeFileSync(path.join(tempDir, filename), req.file.buffer);

    cleanupTempDirectory(24);

    res.json({ ok: true, url: `/media/${filename}`, filename });

  } catch (err) {
    console.error('[Upload] Error:', err);
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /item/play-video
// Play video using configured video player
// ─────────────────────────────
router.post("/play-video", async (req, res) => {
  try {
    const { videoPath, videoPlayerPath } = req.body;

    if (!videoPath) {
      return res.json({ ok: false, error: 'Video path is required' });
    }

    if (!videoPlayerPath) {
      return res.json({ ok: false, error: 'Video player path is required' });
    }

    const { spawn } = require('child_process');
    const pathModule = require('path');

    // Sanitize paths to prevent command injection
    // Resolve to absolute paths to ensure they're within allowed directories
    const sanitizedPlayerPath = pathModule.resolve(videoPlayerPath);

    // Additional security check: ensure paths start with expected directories
    const allowedPaths = [
      pathModule.resolve('.'), // Current working directory
      pathModule.resolve('./data'), // Data directory
      pathModule.resolve(require('os').homedir()) // Home directory
    ];

    // On Windows, add standard program installation directories
    if (process.platform === 'win32') {
      allowedPaths.push('C:\\Program Files');
      allowedPaths.push('C:\\Program Files (x86)');
      if (process.env.LOCALAPPDATA) {
        allowedPaths.push(process.env.LOCALAPPDATA);
      }
    }
    // On macOS, add /Applications
    if (process.platform === 'darwin') {
      allowedPaths.push('/Applications');
    }
    // On Linux, add standard binary paths
    if (process.platform === 'linux') {
      allowedPaths.push('/usr/bin');
      allowedPaths.push('/usr/local/bin');
      allowedPaths.push('/opt');
    }

    // For video player path, check if it looks like a full path (contains path separator)
    // Only validate paths that look like full paths, allow executables in PATH
    if (videoPlayerPath.includes(pathModule.sep)) {
      const isPathAllowed = (testPath, allowedList) => {
        return allowedList.some(allowed => testPath.startsWith(allowed + pathModule.sep) || testPath === allowed);
      };

      if (!isPathAllowed(sanitizedPlayerPath, allowedPaths)) {
        return res.json({ ok: false, error: 'Video player path is not in allowed directories' });
      }

      // Check if video player executable exists
      if (!fs.existsSync(sanitizedPlayerPath)) {
        return res.json({ ok: false, error: `Video player does not exist: ${sanitizedPlayerPath}` });
      }
    }

    // For video path, we trust the path provided by our own server API
    // but still check if the file exists
    if (!fs.existsSync(videoPath)) {
      return res.json({ ok: false, error: `Video file does not exist: ${videoPath}` });
    }

    // Try to execute the video player
    // Use the original paths (not sanitized) to allow executables in PATH
    const child = spawn(videoPlayerPath, [videoPath], {
      detached: true,
      stdio: 'ignore'
    });

    // Unref to allow the main process to exit without waiting for the video player
    child.unref();

    res.json({ ok: true, message: 'Video player launched successfully' });

  } catch (err) {
    console.error('[PlayVideo] Error:', err);
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /item/open-folder
// Open the movie folder in the OS file manager
// ─────────────────────────────
router.post("/open-folder", async (req, res) => {
  try {
    const { folderPath } = req.body;

    if (!folderPath) {
      return res.json({ ok: false, error: 'Folder path is required' });
    }

    const resolvedPath = path.resolve(folderPath);
    const cfg = loadConfig();
    const libraryPath = cfg.libraryPath ? path.resolve(cfg.libraryPath) : null;

    // Only allow opening folders inside the configured library path
    if (!libraryPath || (resolvedPath !== libraryPath && !resolvedPath.startsWith(libraryPath + path.sep))) {
      return res.json({ ok: false, error: 'Folder path is not inside the library path' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.json({ ok: false, error: `Folder does not exist: ${resolvedPath}` });
    }

    const { spawn } = require('child_process');
    const command = process.platform === 'win32' ? 'explorer'
      : process.platform === 'darwin' ? 'open'
      : 'xdg-open';

    const child = spawn(command, [resolvedPath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    res.json({ ok: true, message: 'Folder opened successfully' });
  } catch (err) {
    console.error('[OpenFolder] Error:', err);
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /item/scrape/video/:itemId
// Get the original video file path for a scrape item
// ─────────────────────────────
router.get("/scrape/video/:itemId", async (req, res) => {
  try {
    const itemId = req.params.itemId;
    const outputDir = require('../core/config').getScrapePath();
    const jsonPath = path.join(outputDir, `${itemId}.json`);

    if (!fs.existsSync(jsonPath)) {
      return res.json({ ok: false, error: `JSON file not found: ${jsonPath}` });
    }

    const jsonData = fs.readFileSync(jsonPath, "utf8");
    const originalJson = JSON.parse(jsonData);

    if (!originalJson.videoFile) {
      return res.json({ ok: false, error: 'videoFile not found in JSON' });
    }

    res.json({ ok: true, videoFile: originalJson.videoFile });

  } catch (err) {
    console.error('[GetScrapeVideo] Error:', err);
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /item/library-cover/:folderId
// Serve cover image from library folder
// ─────────────────────────────
router.get("/library-cover/:folderId", async (req, res) => {
  try {
    const folderId = req.params.folderId;
    const config = loadConfig();

    if (!config.libraryPath) {
      return res.status(404).send('Library path not configured');
    }

    const folderPath = path.join(config.libraryPath, folderId);

    if (!fs.existsSync(folderPath)) {
      return res.status(404).send('Folder not found');
    }

    // Look for cover image (same priority as localMediaMapper)
    const files = fs.readdirSync(folderPath);
    const imageExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

    const findImage = (patterns) => {
      for (const pattern of patterns) {
        for (const file of files) {
          const lowerFile = file.toLowerCase();
          const ext = lowerFile.split('.').pop();
          if (!imageExtensions.includes(ext)) continue;

          if (pattern.includes('.')) {
            if (lowerFile === pattern) return file;
          } else {
            const regex = new RegExp(`^.*${pattern}\\.(${imageExtensions.join('|')})$`, 'i');
            if (regex.test(lowerFile)) return file;
          }
        }
      }
      return null;
    };

    const coverFile = findImage(['fanart']);

    if (!coverFile) {
      return res.status(404).send('Cover image not found');
    }

    const coverPath = path.join(folderPath, coverFile);
    res.sendFile(coverPath);

  } catch (err) {
    console.error('[LibraryCover] Error:', err);
    res.status(500).send(err.message);
  }
});

// ─────────────────────────────
// GET /item/videos/:folderId
// Get list of video files in a movie folder
// ─────────────────────────────
router.get("/videos/:folderId", async (req, res) => {
  try {
    const folderId = req.params.folderId;
    const config = loadConfig();

    if (!config.libraryPath) {
      return res.json({ ok: false, error: 'Library path not configured' });
    }

    const folderPath = path.join(config.libraryPath, folderId);

    if (!fs.existsSync(folderPath)) {
      return res.json({ ok: false, error: `Folder does not exist: ${folderPath}` });
    }

    // Get all video files in the folder
    const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.3g2', '.m2ts', '.ts', '.vob', '.iso'];
    const files = fs.readdirSync(folderPath);
    const videoFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return videoExtensions.includes(ext);
    }).map(file => path.join(folderPath, file));

    res.json({ ok: true, videos: videoFiles });

  } catch (err) {
    console.error('[GetVideos] Error:', err);
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// Helper: copy actor thumbs to a movie folder's actors/ subfolder
// ─────────────────────────────
async function copyActorsToFolder(folderPath, actors) {
  const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
  const { scrapeLocal } = require('../../scrapers/actors/local/run');
  const { actorToNFO } = require('../../scrapers/actors/schema');
  const actorDb = require('../../scrapers/actors/actorDb');
  const actorsPath = getActorsCachePath();
  const destFolder = path.join(folderPath, 'actors');

  if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

  const extensions = ['webp', 'jpg', 'jpeg', 'png', 'gif'];
  const copied = [];
  const skipped = [];

  for (const actor of actors) {
    if (!actor.name) continue;
    let found = false;
    let savedExt = null;

    // 1. Find actor via NFO scan (externalPath first, then data/actors) — used below
    // both as a photo source (fallback) and for the .nfo metadata written alongside it.
    const actorData = await scrapeLocal(actor.name).catch(() => null);
    const actorId = actorData && actorData.id;

    // 1a. Prefer the actor's own thumb when it already points into our internal cache
    // (e.g. a photo just uploaded/edited in the actor modal, not yet reflected in the
    // index's thumb_cache_file if this call races an upload). This is the freshest
    // possible source — what the user just picked — so it wins over 1b below.
    const ownCacheMatch = typeof actor.thumb === 'string' && actor.thumb.match(/^\/actors\/([^/\\]+)$/);
    if (ownCacheMatch) {
      const srcPath = path.join(actorsPath, ownCacheMatch[1]);
      if (fs.existsSync(srcPath)) {
        const ext = path.extname(ownCacheMatch[1]).replace(/^\./, '');
        // Remove any stale photo left over from a previous copy under a different extension
        extensions.filter(e => e !== ext).forEach(e => {
          const stale = path.join(destFolder, `${actor.name}.${e}`);
          if (fs.existsSync(stale)) { try { fs.unlinkSync(stale); } catch (_) {} }
        });
        fs.copyFileSync(srcPath, path.join(destFolder, `${actor.name}.${ext}`));
        copied.push(actor.name);
        found = true;
        savedExt = ext;
      }
    }

    if (!found && actorId) {
      // Resolve via the persistent index — internal cache is the single
      // source of truth (see resolvePhotoSource()). Also self-heals a stale
      // reference if the file no longer exists.
      const source = actorDb.resolvePhotoSource(actorId, { cachePath: actorsPath });
      if (source) {
        // Remove any stale photo left over from a previous copy under a different extension
        extensions.filter(e => e !== source.ext).forEach(e => {
          const stale = path.join(destFolder, `${actor.name}.${e}`);
          if (fs.existsSync(stale)) { try { fs.unlinkSync(stale); } catch (_) {} }
        });
        fs.copyFileSync(source.absolutePath, path.join(destFolder, `${actor.name}.${source.ext}`));
        copied.push(actor.name);
        found = true;
        savedExt = source.ext;
      }
    }

    // 2. Fallback: download from remote thumb URL
    // Use actorData.thumbUrl (original URL) if actor.thumb is a local path
    const thumbUrl = (actor.thumb && actor.thumb.startsWith('http'))
      ? actor.thumb
      : (actorData && actorData.thumbUrl && actorData.thumbUrl.startsWith('http') ? actorData.thumbUrl : null);

    if (!found && thumbUrl) {
      try {
        const imageUrl = new URL(thumbUrl);
        const protocol = imageUrl.protocol === 'https:' ? https : http;
        const imageBuffer = await new Promise((resolve, reject) => {
          const req2 = protocol.get(thumbUrl, { timeout: 15000 }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              const redirectUrl = new URL(response.headers.location, thumbUrl);
              const rp = redirectUrl.protocol === 'https:' ? https : http;
              const req3 = rp.get(redirectUrl.href, { timeout: 15000 }, (res2) => {
                const chunks = [];
                res2.on('data', c => chunks.push(c));
                res2.on('end', () => resolve(Buffer.concat(chunks)));
                res2.on('error', reject);
              });
              req3.on('error', reject);
              return;
            }
            const chunks = [];
            response.on('data', c => chunks.push(c));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
          });
          req2.on('error', reject);
        });
        const ext = (path.extname(imageUrl.pathname) || '.jpg').replace(/^\./, '');
        // Remove any stale photo left over from a previous copy under a different extension
        extensions.filter(e => e !== ext).forEach(e => {
          const stale = path.join(destFolder, `${actor.name}.${e}`);
          if (fs.existsSync(stale)) { try { fs.unlinkSync(stale); } catch (_) {} }
        });
        fs.writeFileSync(path.join(destFolder, `${actor.name}.${ext}`), imageBuffer);
        copied.push(actor.name);
        found = true;
        savedExt = ext;
      } catch (dlErr) {
        console.error(`[copyActorsToFolder] Failed to download thumb for ${actor.name}:`, dlErr.message);
      }
    }

    if (found && actorId) {
      actorDb.linkMovie(actorId, path.basename(folderPath));
    }

    // 3. Write full actor .nfo alongside the photo (javinizer-js internal format,
    // not Kodi-compliant, used by the "local" scraper to re-find actor details
    // from movie folders after a cache reset)
    if (found && actorData) {
      try {
        const nfoActor = savedExt ? { ...actorData, thumbLocal: `${actor.name}.${savedExt}` } : actorData;
        fs.writeFileSync(path.join(destFolder, `${actor.name}.nfo`), actorToNFO(nfoActor), 'utf-8');
      } catch (nfoErr) {
        console.error(`[copyActorsToFolder] Failed to write nfo for ${actor.name}:`, nfoErr.message);
      }
    }

    if (!found) skipped.push(actor.name);
  }

  return { copied, skipped };
}

// ─────────────────────────────
// GET /update/check
// Result of the version check run once at server startup (see index.js) —
// no per-request GitHub API call, just serves the cached result.
// ─────────────────────────────
router.get("/update/check", (req, res) => {
  res.json(updateManager.getCachedCheck());
});

// ─────────────────────────────
// GET /update/version
// Current installed version, straight from package.json — unlike
// /update/check this never depends on the GitHub API being reachable, so
// the About page can always show it.
// ─────────────────────────────
router.get("/update/version", (req, res) => {
  res.json({ version: require('../../package.json').version });
});

// ─────────────────────────────
// POST /update/apply
// Kicks off the standalone updater (bin/apply-update.js) and exits this
// process shortly after responding, so the updater can swap files/restart.
// ─────────────────────────────
router.post("/update/apply", (req, res) => {
  try {
    const { tag, version } = req.body;
    if (!tag || !version) {
      return res.json({ ok: false, error: "tag and version required" });
    }

    updateManager.startUpdateProcess({ tag, version });
    res.json({ ok: true });

    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    console.error("[update/apply] Error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /update/status
// Polled by the WebUI after POST /update/apply — the server restarts mid-
// update, so progress is read from a status file rather than a held request.
// ─────────────────────────────
router.get("/update/status", (req, res) => {
  res.json(updateManager.readUpdateStatus());
});

// ─────────────────────────────
// POST /actors/copy-to-movie
// Copy actor thumbnails to the movie folder's actors/ subfolder
// ─────────────────────────────
router.post("/actors/copy-to-movie", async (req, res) => {
  try {
    const { folderId, actors } = req.body;

    if (!folderId || !actors || !Array.isArray(actors)) {
      return res.json({ ok: false, error: 'folderId and actors array required' });
    }

    const config = loadConfig();
    if (!config.libraryPath) {
      return res.json({ ok: false, error: 'Library path not configured' });
    }

    const folderPath = path.join(config.libraryPath, folderId);
    if (!fs.existsSync(folderPath)) {
      return res.json({ ok: false, error: `Movie folder does not exist: ${folderPath}` });
    }

    const { copied, skipped } = await copyActorsToFolder(folderPath, actors);
    res.json({ ok: true, copied, skipped });
  } catch (err) {
    console.error('[actors/copy-to-movie] Error:', err);
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
