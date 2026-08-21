# Actor Scraper System

Sistema di scraping attori separato dai film, con cache locale e scraping intelligente da fonti esterne.

## 📚 Documentation

- **[SCRAPER-STANDARD.md](./SCRAPER-STANDARD.md)** - Standard obbligatorio per implementare nuovi scraper
- **[EXAMPLES.md](./EXAMPLES.md)** - Esempi pratici di implementazione
- **[WORKFLOW.md](./WORKFLOW.md)** - Workflow dettagliato del sistema

## Convenzione nomi

Gli scraper il cui nome termina in **`-fs`** richiedono [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) attivo per bypassare la protezione Cloudflare.  
Configura l'URL tramite la variabile d'ambiente `FLARESOLVERR_URL` (default: `http://localhost:8191`).

## Struttura

```
scrapers/actors/
├── SCRAPER-STANDARD.md    # ⭐ Standard input/output per scraper
├── schema.js              # Schema dati attore standard
├── cache-helper.js        # Utility per cache management
├── local/                 # Scraper locale (NFO scan)
│   └── run.js
├── javdb/                 # javdatabase.com (Puppeteer)
│   └── run.js
└── xcity/                 # xxx.xcity.jp (fetch + cheerio)
    └── run.js

data/actors/
└── {actor-id}.nfo         # File NFO attore (Kodi format)
```

## Quick Start

### Scraping singolo attore
```bash
node scrapers/actors/javdb/run.js "Hayami Remu"
```

### Scraping batch (multiple actors)
```bash
node scrapers/actors/javdb/run.js "Hayami Remu" "Sunohara Miki" "Mizuhara Sana"
```

### Output format
```json
[
  {
    "id": "hayami-remu",
    "name": "Hayami Remu",
    "altName": "早美れむ",
    "birthdate": "1997-12-25",
    "height": 158,
    "bust": 85,
    "waist": 58,
    "hips": 84,
    "thumbUrl": "https://example.com/photo.jpg",
    "thumb": "/actors/hayami-remu.jpg",
    "meta": {
      "sources": ["javdb"],
      "lastUpdate": "2025-01-13T10:30:00.000Z"
    }
  }
]
```

## Schema Attore

Vedi [schema.js](./schema.js) per la definizione completa.

Campi principali:
- `id` - Slug normalizzato (es. `hayami-remu`)
- `name` - Nome principale
- `altName` - Nomi alternativi/alias separati da virgola (nome giapponese, vecchi nomi d'arte, ecc.) — un solo campo, niente `otherNames` separato
- `birthdate` - Formato `YYYY-MM-DD`
- `height`, `bust`, `waist`, `hips` - Numeri in cm
- `thumbUrl` - URL originale foto (sempre preservato)
- `thumbLocal` - Nome file locale
- `thumb` - Path finale da usare
- `meta.sources` - Array di scraper che hanno fornito dati
- `meta.lastUpdate` - ISO timestamp

## Scrapers Disponibili

### Local Scraper
Legge dalla cache locale (`.nfo` files)
- Path: `scrapers/actors/local/run.js`
- Cache: `data/actors/{id}.nfo`
- Usa `actors-index.json` per risolvere varianti

### JAVDB Scraper
Scrape da javdatabase.com
- Path: `scrapers/actors/javdb/run.js`
- Source: `https://www.javdatabase.com/idols/{slug}/`
- Usa Puppeteer headless
- Scarica foto automaticamente

### XCITY Scraper
Scrape da xxx.xcity.jp (JAV Idol Listing)
- Path: `scrapers/actors/xcity/run.js`
- Ricerca: `https://xxx.xcity.jp/idol/?q={nome}` (match esatto sul nome tra i risultati)
- Dettaglio: `https://xxx.xcity.jp/idol/detail/{id}/`
- Usa `fetch` + `cheerio` (nessun browser/FlareSolverr richiesto)
- Estrae: nome, data di nascita, altezza, misure (B/W/H), foto
- Non fornisce `altName` (nessun nome giapponese in pagina)

## Configurazione (config.json)

```json
{
  "scrapers": {
    "actors": {
      "enabled": true,
      "externalPath": null,
      "scrapers": ["local", "javdb", "xcity"]
    }
  }
}
```

- `enabled` - Abilita/disabilita actor scraping
- `externalPath` - Destinazione di copia per gli attori preferiti (null = disabilitata). **Non** è più una cache/libreria letta dagli scraper: `data/actors/` è l'unica fonte dati per tutti gli attori, `local` incluso. Quando un attore viene marcato preferito, NFO+foto vengono copiati qui (aggiornati in caso di modifica, rimossi se tolto dai preferiti) — utile per condividere i preferiti con altri media server (Jellyfin, Plex) o altre istanze di Javinizer-JS.
- `scrapers` - Priorità scraper (local sempre primo)

## Preferiti (Favorites)

- Ogni attore ha un flag `favorite` (bool) persistito sia nell'NFO (`<favorite>true</favorite>`) sia nell'indice SQLite (`actors.favorite`, colonna aggiunta via migrazione automatica in `actorDb.js`).
- Non viene mai impostato da uno scraper: `upsertActor()` (in `actorDb.js`) esclude deliberatamente questa colonna dai propri `INSERT`/`UPDATE`, così un re-scrape non può azzerarlo.
- Toggle via `POST /actors/favorite` (`{id, favorite}` o `{name, altName, thumb, role, favorite}` se l'attore non è ancora in `data/actors`, es. scraping attori disabilitato — in quel caso viene creato al volo).
- Attori duplicati (stesso nome su più record — vedi il warning `[actorDb] N name(s) shared by multiple actor records` a ogni avvio) si uniscono da `actors.html` (banner "Review") oppure da CLI con `node bin/merge-actors.js`; entrambi usano `actorDb.findDuplicateNames()`/`mergeActors()`.
- Se il nome condiviso è solo un'omonimia (due persone diverse, non un duplicato reale), il banner "Review" offre anche `POST /actors/remove-name` per togliere quel singolo alias da uno dei due record senza unirli.

## Name Inversion Logic

**Tutti gli scraper implementano name inversion automatica:**

1. Prova con nome originale (es. "Hayami Remu")
2. Se non trovato, inverte (es. "Remu Hayami")
3. Se non trovato, restituisce errore

**L'index NON contiene nomi invertiti** - ogni scraper gestisce l'inversione autonomamente.

## Index Mapping

`actors-index.json` mappa varianti → ID:

```json
{
  "hayami remu": "hayami-remu",
  "早美れむ": "hayami-remu",
  "remu hayami": "hayami-remu"
}
```

Costruito da:
- Nome principale (`name`)
- Nomi alternativi/alias (`altName`)

Rebuild index:
```bash
node scripts/rebuild-actor-index.js
```

## Manager API

```javascript
const {
  getActor,
  scrapeActor,
  batchProcessActors,
  processSingleMovieActors,
  processMultipleMoviesActors
} = require('./src/core/actorScraperManager');

// Get actor (cache or scrape)
const actor = await getActor('Hayami Remu');

// Force scrape
const actor = await scrapeActor('Hayami Remu');

// Process all actors in data/scrape/*.json
await batchProcessActors(emitter);

// Process actors for one movie
await processSingleMovieActors('APNS-162', emitter);

// Process actors for multiple movies
await processMultipleMoviesActors(['APNS-162', 'HTMS-087'], emitter);
```

## Testing

```bash
# Test single actor
node scrapers/actors/javdb/run.js "Hayami Remu"

# Test batch (3 actors)
node scrapers/actors/javdb/run.js "Hayami Remu" "Sunohara Miki" "Mizuhara Sana"

# Test local cache
node scrapers/actors/local/run.js "Hayami Remu"

# Test not found
node scrapers/actors/javdb/run.js "NonExistent Actor"
```

## Implementare Nuovo Scraper

1. Leggi **[SCRAPER-STANDARD.md](./SCRAPER-STANDARD.md)**
2. Crea directory `scrapers/actors/{nome}/`
3. Implementa `run.js` seguendo lo standard
4. Testa con singolo + batch
5. Aggiungi a `config.json` scrapers list

**Checklist obbligatoria:**
- ✅ Accetta array di nomi da argv
- ✅ Restituisce array JSON su stdout
- ✅ Browser condiviso per batch
- ✅ Name inversion logic
- ✅ Error handling parziale
- ✅ Timeout force exit

## Note

- Gli attori vengono cached automaticamente dopo scraping
- Update solo on-demand (attori non cambiano frequentemente)
- `local` scraper ha sempre priorità (cache first)
- Browser riutilizzato in batch per performance
- Array input/output consistente con movies scrapers
