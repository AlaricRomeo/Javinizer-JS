const { loadConfig, saveConfig } = require("../core/config");
const { buildItem } = require("../core/buildItem");
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// config
const configPath = path.join(process.cwd(), "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Core
const LibraryReader = require("../core/libraryReader");
const ScrapeReader = require("../core/scrapeReader");
const ScrapeSaver = require("../core/scrapeSaver");
const { saveNfoPatch } = require("../core/saveNfo");

// istanza con PATH REALE
const libraryReader = new LibraryReader(config.libraryPath);
libraryReader.loadLibrary();

// istanza ScrapeReader
const scrapeReader = new ScrapeReader();
scrapeReader.loadScrapeItems();

// ─────────────────────────────
// helper risposta standard
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
    const item = libraryReader.getCurrent();
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
// Ricarica la libreria
// ─────────────────────────────
router.post("/reload", (req, res) => {
  try {
    libraryReader.loadLibrary();
    res.json({ ok: true, count: libraryReader.count() });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /count
// Restituisce il numero di NFO nella libreria
// ─────────────────────────────
router.get("/count", (req, res) => {
  try {
    const count = libraryReader.count();
    res.json({ ok: true, count });
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
    // Assicurati che mode e scrapers esistano sempre
    if (!config.mode) config.mode = "scrape";
    if (!config.scrapers) config.scrapers = [];
    res.json({ ok: true, config });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /lang/:code
// Restituisce il file di traduzione
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
// Lista directory per il file browser
// ─────────────────────────────
router.get("/browse", (req, res) => {
  try {
    const dirPath = req.query.path || process.env.HOME || "/";

    // Sicurezza: verifica che la directory esista ed è leggibile
    if (!fs.existsSync(dirPath)) {
      return res.json({ ok: false, error: "Directory non trovata" });
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return res.json({ ok: false, error: "Path non è una directory" });
    }

    // Leggi contenuto directory
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    // Filtra solo le directory, ignora file nascosti
    const directories = items
      .filter(item => item.isDirectory() && !item.name.startsWith("."))
      .map(item => ({
        name: item.name,
        path: path.join(dirPath, item.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Aggiungi parent directory se non siamo alla root
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

    // Mantieni i valori esistenti se non specificati
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

    // 🔁 ricarica la libreria solo se il path è cambiato
    if (newConfig.libraryPath && newConfig.libraryPath !== currentConfig.libraryPath) {
      libraryReader.rootPath = newConfig.libraryPath;
      libraryReader.loadLibrary();
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
    const changes = req.body.changes;
    if (!changes || Object.keys(changes).length === 0) {
      return res.json({ ok: false, error: "Nessuna modifica" });
    }

    const item = libraryReader.getCurrent();
    if (!item) {
      return res.json({ ok: false, error: "Nessun item corrente" });
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
    res.json(ok(item.data)); // Restituisce solo i dati, non i metadati scrape
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
    const outputDir = path.join(__dirname, '../../data/scrape');

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
// Salva l'item corrente in scrape mode (crea cartella, sposta video, genera NFO, scarica immagini)
router.post("/scrape/save", async (req, res) => {
  try {
    // Ottieni l'item corrente con i dati modificati dal client
    const modifiedData = req.body.item;

    // Ottieni l'item originale dallo scrapeReader
    const currentScrapeItem = scrapeReader.getCurrent();

    if (!currentScrapeItem) {
      return res.json(fail("No scrape item loaded"));
    }

    // Merge dei dati modificati con quelli originali
    const itemToSave = { ...currentScrapeItem.data, ...modifiedData };

    // Crea istanza ScrapeSaver con config aggiornata
    const currentConfig = loadConfig();
    const saver = new ScrapeSaver(currentConfig);

    // Salva l'item
    const results = await saver.saveItem(itemToSave, currentScrapeItem);

    if (results.success) {
      // Rimuovi il file JSON dalla lista (è stato processato)
      scrapeReader.deleteCurrent();

      // Ricarica la libreria per mostrare il nuovo item
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
        }
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
// Avvia lo scraping tramite WebSocket per comunicazione bidirezionale
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
    const outputDir = path.join(__dirname, '../../data/scrape');
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

    // Execute scraping
    scrapeAll(codesToScrape, emitter).catch(error => {
      console.error('[Routes] Scraping error:', error);
      emitter.emit('error', { message: error.message });
    });

  } catch (error) {
    console.error('[Routes] Error starting scrape:', error);
    res.json({ ok: false, error: error.message });
  }
});

// ─────────────────────────────
// POST /item/scrape/clear-cache
// Pulisce la cache di tutti gli scraper
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

module.exports = router;
