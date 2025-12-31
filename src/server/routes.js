const { loadConfig, saveConfig } = require("../core/config");
const { buildItem } = require("../core/buildItem");
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// Core
const LibraryReader = require("../core/libraryReader");
const ScrapeReader = require("../core/scrapeReader");
const ScrapeSaver = require("../core/scrapeSaver");
const { saveNfoPatch } = require("../core/saveNfo");

/**
 * Get scrape path based on library path
 * Items are stored in {libraryPath}/.javinizer/scrape/
 */
function getScrapePath() {
  const config = loadConfig();
  const libraryPath = config.libraryPath;

  if (!libraryPath) {
    return path.join(__dirname, '../../data/scrape'); // Fallback
  }

  return path.join(libraryPath, '.javinizer', 'scrape');
}

// Load config and initialize library reader
const config = loadConfig();
const libraryReader = new LibraryReader(config.libraryPath, config.actorsPath);

// ScrapeReader instance
const scrapeReader = new ScrapeReader();

// Initial load happens lazily on first request (non-blocking startup)

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

    // If no current item but items exist, get the first one
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
    res.json({ ok: true, config });
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
    const dirPath = req.query.path || process.env.HOME || "/";

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

    // Add parent directory if we are not at root
    const parent = dirPath !== "/" ? path.dirname(dirPath) : null;

    res.json({
      ok: true,
      current: dirPath,
      parent: parent,
      directories: directories
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
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
    res.json(ok(item.data)); // Returns only the data, not the scrape metadata
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
    res.json(ok(item.data));
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
    res.json(ok(item.data));
  } catch (err) {
    res.json(fail(err.message));
  }
});

// DELETE /scrape/current
router.delete("/scrape/current", (req, res) => {
  try {
    const result = scrapeReader.deleteCurrent();
    res.json(result);
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
    // Get the current item with modified data from the client
    const modifiedData = req.body.item;

    // Get the original item from scrapeReader
    const currentScrapeItem = scrapeReader.getCurrent();

    if (!currentScrapeItem) {
      return res.json(fail("No scrape item loaded"));
    }

    // Merge modified data with original data
    const itemToSave = { ...currentScrapeItem.data, ...modifiedData };

    // Create ScrapeSaver instance with updated config
    const currentConfig = loadConfig();
    const saver = new ScrapeSaver(currentConfig);

    // Save the item
    const results = await saver.saveItem(itemToSave, currentScrapeItem);

    if (results.success) {
      // Scrape actors AFTER saving the movie
      const actorResults = { scraped: 0, failed: 0 };

      if (currentConfig.actorsEnabled && itemToSave.actor && Array.isArray(itemToSave.actor)) {
        const { getActor } = require('../core/actorScraperManager');

        console.error(`[Routes] Scraping ${itemToSave.actor.length} actors from saved movie`);

        for (const actor of itemToSave.actor) {
          if (actor.name) {
            try {
              console.error(`[Routes] Scraping actor: ${actor.name}`);
              await getActor(actor.name);
              actorResults.scraped++;
            } catch (error) {
              console.error(`[Routes] Failed to scrape actor ${actor.name}:`, error.message);
              actorResults.failed++;
            }
          }
        }

        console.error(`[Routes] Actor scraping completed: ${actorResults.scraped} scraped, ${actorResults.failed} failed`);
      }

      // Remove the JSON file from the list (it has been processed)
      scrapeReader.deleteCurrent();

      // Reload the library to show the new item
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
          warnings: results.errors
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
    // Get config
    const config = loadConfig();

    // Extract codes from library path
    const libraryPath = config.libraryPath;

    if (!libraryPath) {
      return res.json({ ok: false, error: 'libraryPath not specified in config.json' });
    }

    console.error(`[Routes] Reading library: ${libraryPath}`);

    const codes = extractCodesFromLibrary(libraryPath);

    if (codes.length === 0) {
      return res.json({ ok: false, error: 'No files found in library' });
    }

    console.error(`[Routes] Found ${codes.length} file(s) to scrape`);

    // Filter out already scraped codes
    const outputDir = getScrapePath();
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

    emitter.on('complete', (data) => {
      req.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ event: 'complete', data, scrapeId }));
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

        // Auto-start actor scraping if enabled in config
        const config = loadConfig();
        console.error('[Routes] Config loaded:', JSON.stringify(config.scrapers, null, 2));
        console.error('[Routes] Actors enabled:', config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled);

        if (config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled) {
          console.error('[Routes] Auto-starting actor scraping after video scraping completed');

          // Wait 2 seconds to ensure all JSON files are written to disk
          setTimeout(() => {
            // Send notification to client that actor scraping is starting
            req.wss.clients.forEach(client => {
              if (client.readyState === 1) {
                client.send(JSON.stringify({
                  event: 'progress',
                  data: { message: '🎭 Starting automatic actor scraping...' },
                  scrapeId
                }));
              }
            });

            // Start batch actor processing
            const { batchProcessActors } = require('../core/actorScraperManager');

            batchProcessActors()
            .then((summary) => {
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
            });
          }, 2000); // Wait 2 seconds before starting actor scraping
        }
      })
      .catch(error => {
        console.error('[Routes] Scraping error:', error);
        emitter.emit('error', { message: error.message });
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
    const { name } = req.body;

    if (!name) {
      return res.json({ ok: false, error: 'Actor name is required' });
    }

    console.error(`[Routes] Searching for actor: ${name}`);

    // Search/scrape actor
    const actorData = await getActor(name);

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

    res.json({
      ok: true,
      message: `Cleared ${clearedCount} cache director${clearedCount === 1 ? 'y' : 'ies'}`
    });

  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// Actor Management Routes
// ─────────────────────────────

const {
  loadActorLocal,
  saveActorLocal,
  resolveActorId,
  scrapeActor
} = require('../core/actorScraperManager');

// GET /actors - List all actors
router.get("/actors", async (req, res) => {
  try {
    // Use centralized cache helper
    const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
    const actorsPath = getActorsCachePath();

    if (!fs.existsSync(actorsPath)) {
      return res.json({ ok: true, actors: [] });
    }

    const files = fs.readdirSync(actorsPath);
    const actors = [];

    for (const file of files) {
      // Skip non-NFO files
      if (!file.endsWith('.nfo')) continue;
      if (file === '.index.json') continue;

      const actorId = file.replace('.nfo', '');
      const actor = loadActorLocal(actorId);

      if (actor) {
        actors.push(actor);
      }
    }

    // Sort by name
    actors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    res.json({ ok: true, actors });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// POST /actors/save - Save actor
router.post("/actors/save", async (req, res) => {
  try {
    const { normalizeActorName } = require('../../scrapers/actors/schema');
    const actorData = req.body;

    // Generate ID from name if not provided
    if (!actorData.id) {
      actorData.id = normalizeActorName(actorData.name);
    }

    // Ensure meta object exists
    actorData.meta = actorData.meta || {};
    actorData.meta.lastUpdate = new Date().toISOString();

    // Save actor
    saveActorLocal(actorData);

    res.json({ ok: true, id: actorData.id });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// POST /actors/delete - Delete actor
router.post("/actors/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json({ ok: false, error: 'Actor ID required' });
    }

    // Use centralized cache helper
    const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
    const actorsPath = getActorsCachePath();
    const actorNfoPath = path.join(actorsPath, `${id}.nfo`);

    // Delete NFO file
    if (fs.existsSync(actorNfoPath)) {
      fs.unlinkSync(actorNfoPath);
    }

    // Delete image files (try all extensions)
    const extensions = ['webp', 'jpg', 'jpeg', 'png', 'gif'];
    for (const ext of extensions) {
      const imagePath = path.join(actorsPath, `${id}.${ext}`);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    // Remove from index
    const indexPath = path.join(actorsPath, '.index.json');
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

      // Remove all entries pointing to this actor ID
      Object.keys(index).forEach(key => {
        if (index[key] === id) {
          delete index[key];
        }
      });

      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    }

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// POST /actors/search - Search for actor data
router.post("/actors/search", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.json({ ok: false, error: 'Actor name required' });
    }

    // Check if already in cache
    const actorId = resolveActorId(name);
    if (actorId) {
      const actor = loadActorLocal(actorId);
      if (actor) {
        return res.json({ ok: true, actor });
      }
    }

    // Scrape actor
    const actor = await scrapeActor(name);

    if (!actor) {
      return res.json({ ok: false, error: 'Actor not found' });
    }

    res.json({ ok: true, actor });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
