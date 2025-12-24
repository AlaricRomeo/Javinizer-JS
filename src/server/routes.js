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
    res.json(config);
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

    if (!newConfig.libraryPath) {
      return res.json({
        ok: false,
        error: "libraryPath mancante"
      });
    }

    // Mantieni i valori esistenti se non specificati
    const currentConfig = loadConfig();
    if (!newConfig.language) {
      newConfig.language = currentConfig.language || "en";
    }
    if (!newConfig.mode) {
      newConfig.mode = currentConfig.mode || "scrape";
    }
    if (!newConfig.scrapers) {
      newConfig.scrapers = currentConfig.scrapers || [];
    }

    saveConfig(newConfig);

    // 🔁 ricarica la libreria solo se il path è cambiato
    if (newConfig.libraryPath !== currentConfig.libraryPath) {
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
// Avvia lo scraping e restituisce SSE (Server-Sent Events) per il progress
// ─────────────────────────────
router.post("/scrape/start", (req, res) => {
  // Setup SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Funzione helper per inviare eventi
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Avvia scraping
  const { spawn } = require('child_process');
  const scraperPath = path.join(__dirname, '../core/scraperManager.js');

  sendEvent('start', { message: 'Starting ScraperManager...' });

  const child = spawn('node', [scraperPath], {
    stdio: ['ignore', 'pipe', 'pipe']  // stdin=ignore, stdout=pipe, stderr=pipe
  });

  let stdout = '';
  let stderr = '';

  // Cattura stdout (JSON finale)
  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  // Cattura stderr (progress logs) e invia come eventi SSE
  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      stderr += line + '\n';

      // Invia ogni log line come evento progress
      sendEvent('progress', { message: line });
    });
  });

  // Handle completion
  child.on('close', (code) => {
    if (code === 0) {
      sendEvent('complete', {
        message: 'Scraping completed successfully',
        exitCode: code
      });
    } else {
      sendEvent('error', {
        message: `Scraping failed with exit code ${code}`,
        exitCode: code
      });
    }

    res.end();
  });

  // Handle errors
  child.on('error', (error) => {
    sendEvent('error', {
      message: `Failed to start scraper: ${error.message}`
    });
    res.end();
  });

  // Cleanup on client disconnect
  req.on('close', () => {
    if (!child.killed) {
      child.kill();
    }
  });
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
