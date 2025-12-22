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
const { saveNfoPatch } = require("../core/saveNfo");

// istanza con PATH REALE
const libraryReader = new LibraryReader(config.libraryPath);
libraryReader.loadLibrary();

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
// GET /config
// ─────────────────────────────
router.get("/config", (req, res) => {
  try {
    const config = loadConfig();
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

    if (!newConfig.libraryPath) {
      return res.json({
        ok: false,
        error: "libraryPath mancante"
      });
    }

    // Mantieni la lingua esistente se non specificata
    const currentConfig = loadConfig();
    if (!newConfig.language) {
      newConfig.language = currentConfig.language || "en";
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



module.exports = router;
