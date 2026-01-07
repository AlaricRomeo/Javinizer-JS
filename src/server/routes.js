const { loadConfig, saveConfig, getScrapePath } = require("../core/config");
const { buildItem } = require("../core/buildItem");
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");

// Core
const LibraryReader = require("../core/libraryReader");
const ScrapeReader = require("../core/scrapeReader");
const ScrapeSaver = require("../core/scrapeSaver");
const { saveNfoPatch } = require("../core/saveNfo");
const { cleanupTempDirectory } = require("../core/utils");

// getScrapePath() is now imported from config.js and always returns data/scrape

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
    const currentScrapeItem = {
      id: itemId,
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

            // Start batch actor processing
            const { batchProcessActors } = require('../core/actorScraperManager');

            batchProcessActors()
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

    // Update thumbUrl if thumb is a remote URL
    if (actorData.thumb && actorData.thumb.startsWith('http')) {
      actorData.thumbUrl = actorData.thumb;
    }

    // Priority 1: Check for uploadedFile field (new clean approach)
    // Priority 2: Check if thumb is a temporary uploaded file (starts with /media/temp_) - for backward compatibility
    const uploadedPath = actorData.uploadedFile || (actorData.thumb && actorData.thumb.startsWith('/media/temp_') ? actorData.thumb : null);

    if (uploadedPath) {
      const tempFilename = uploadedPath.replace('/media/', '');
      const tempPath = path.join(__dirname, '../../data/temp', tempFilename);

      if (fs.existsSync(tempPath)) {
        // Get actors cache path
        const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
        const actorsPath = getActorsCachePath();

        // Ensure actors directory exists
        if (!fs.existsSync(actorsPath)) {
          fs.mkdirSync(actorsPath, { recursive: true });
        }

        // Generate new filename using actor ID and original extension
        const ext = path.extname(tempFilename);
        const newFilename = `${actorData.id}${ext}`;
        const newPath = path.join(actorsPath, newFilename);

        // Cleanup: remove ANY existing image files for this actor ID
        // This prevents having both .jpg and .png for the same actor
        const extensions = ['.webp', '.jpg', '.jpeg', '.png', '.gif'];
        extensions.forEach(e => {
          const oldPath = path.join(actorsPath, `${actorData.id}${e}`);
          if (fs.existsSync(oldPath)) {
            try {
              fs.unlinkSync(oldPath);
            } catch (err) {
              console.error(`[ActorSave] Failed to delete old image ${oldPath}: ${err.message}`);
            }
          }
        });

        // Move file from temp to actors cache
        const fsPromises = require('fs').promises;
        try {
          await fsPromises.copyFile(tempPath, newPath);
          await fsPromises.unlink(tempPath);
        } catch (moveErr) {
          console.error('[ActorSave] Error moving temp file:', moveErr);
          return res.json({ ok: false, error: `Failed to move uploaded image: ${moveErr.message}` });
        }

        // Update actor meta to use the new filename
        actorData.thumbLocal = newFilename;

        // Clear the thumb field as it's now local
        actorData.thumb = '';
      }
    } else if (actorData.thumb && actorData.thumb.startsWith('/media/upload_')) {
      // Handle legacy case
      const filename = actorData.thumb.replace('/media/', '');
      actorData.thumbLocal = filename;
      actorData.thumb = '';
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

    // Delete image files (try all extensions)
    const extensions = ['webp', 'jpg', 'jpeg', 'png', 'gif'];
    let deleted = false;

    for (const ext of extensions) {
      const imagePath = path.join(actorsPath, `${id}.${ext}`);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
        deleted = true;
      }
    }

    if (!deleted) {
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

    // Use temporary directory for uploaded images
    const tempPath = path.join(__dirname, '../../data/temp');

    // Ensure temp directory exists
    if (!fs.existsSync(tempPath)) {
      fs.mkdirSync(tempPath, { recursive: true });
    }

    // Generate unique filename using hash of file content + timestamp
    const hash = crypto.createHash('md5').update(req.file.buffer).digest('hex').substring(0, 8);
    const timestamp = Date.now();
    const ext = path.extname(req.file.originalname) || '.jpg';
    const filename = `temp_${timestamp}_${hash}${ext}`;
    const filepath = path.join(tempPath, filename);

    // Save file
    fs.writeFileSync(filepath, req.file.buffer);

    // Return the URL path (relative to /media endpoint)
    // For temporary files, we'll use a special identifier
    const imageUrl = `/media/${filename}`;

    // Lazy cleanup of old temp files (older than 24h)
    cleanupTempDirectory(24);

    res.json({
      ok: true,
      url: imageUrl,
      filename: filename
    });

  } catch (err) {
    console.error('[Upload] Error:', err);
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// POST /actors/copy-to-movie
// Copy actor thumbnails to movie folder
// ─────────────────────────────
router.post("/actors/copy-to-movie", async (req, res) => {
  try {
    const { folderId, actors } = req.body;

    if (!folderId) {
      return res.json({ ok: false, error: 'Movie folder ID is required' });
    }

    if (!actors || !Array.isArray(actors) || actors.length === 0) {
      return res.json({ ok: false, error: 'Actor list is required and must not be empty' });
    }

    // Get library path from config
    const config = loadConfig();
    if (!config.libraryPath) {
      return res.json({ ok: false, error: 'Library path not configured' });
    }

    // Find the movie folder in the library
    const movieFolderPath = path.join(config.libraryPath, folderId);

    if (!fs.existsSync(movieFolderPath)) {
      return res.json({ ok: false, error: `Movie folder does not exist: ${movieFolderPath}` });
    }

    // Create actors subfolder in the movie folder
    const actorsFolderPath = path.join(movieFolderPath, 'actors');
    if (!fs.existsSync(actorsFolderPath)) {
      fs.mkdirSync(actorsFolderPath, { recursive: true });
    }

    // Get actors cache path
    const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
    const actorsCachePath = getActorsCachePath();

    let copiedCount = 0;
    const errors = [];

    // Copy each actor's thumbnail to the movie's actors folder
    for (const actor of actors) {
      if (!actor.name) {
        errors.push(`Skipping actor without name`);
        continue;
      }

      try {
        // Normalize actor name to match the file naming convention
        const { normalizeActorName } = require('../../scrapers/actors/schema');
        const actorId = normalizeActorName(actor.name);

        // Look for the actor image in the cache (try common extensions)
        const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        let sourceImagePath = null;

        for (const ext of extensions) {
          const imagePath = path.join(actorsCachePath, `${actorId}${ext}`);
          if (fs.existsSync(imagePath)) {
            sourceImagePath = imagePath;
            break;
          }
        }

        if (!sourceImagePath) {
          // If image not found in cache, try to get from actor's thumb URL in the movie data
          if (actor.thumb && actor.thumb.startsWith('http')) {
            try {
              // Download the image from the thumb URL
              const response = await fetch(actor.thumb);
              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }

              const buffer = Buffer.from(await response.arrayBuffer());

              // Determine file extension from URL or content type
              let ext = path.extname(new URL(actor.thumb).pathname).toLowerCase();
              if (!ext || ext === '.') {
                // Default to jpg if extension not found in URL
                ext = '.jpg';
              }

              // Save the downloaded image to the actors folder
              const downloadedImagePath = path.join(actorsCachePath, `${actorId}${ext}`);
              fs.writeFileSync(downloadedImagePath, buffer);

              sourceImagePath = downloadedImagePath;
            } catch (downloadError) {
              errors.push(`Failed to download actor image for ${actor.name} from ${actor.thumb}: ${downloadError.message}`);
              continue;
            }
          } else {
            errors.push(`Actor image not found for: ${actor.name} (ID: ${actorId}) and no thumb URL available to download`);
            continue;
          }
        }

        // Determine the destination filename following Kodi/Jellyfin standards
        // The filename must match exactly the <name> value in the movie NFO for proper association
        // No transformations - the filename should be the exact actor name with .jpg extension
        const kodiJellyfinSafeName = actor.name
          .replace(/[<>:"/\\|?*]/g, '')  // Remove invalid filename characters
          .trim();                       // Remove leading/trailing whitespace

        const destFilename = `${kodiJellyfinSafeName}.jpg`;
        const destPath = path.join(actorsFolderPath, destFilename);

        // Copy the image file
        fs.copyFileSync(sourceImagePath, destPath);
        copiedCount++;
      } catch (copyError) {
        errors.push(`Failed to copy image for ${actor.name}: ${copyError.message}`);
      }
    }

    res.json({
      ok: true,
      message: `Successfully copied ${copiedCount} actor thumbnails to movie folder`,
      copied: copiedCount,
      errors: errors
    });

  } catch (err) {
    console.error('[CopyActorsToMovie] Error:', err);
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
