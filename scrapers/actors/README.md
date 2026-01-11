# Actor Scraper System

Sistema di scraping attori separato dai film, con cache locale e scraping intelligente da fonti esterne.

## Struttura

```
scrapers/actors/
├── schema.js              # Schema standard attore + funzioni di normalizzazione
├── local/                 # Scraper locale (cache filesystem)
│   └── run.js
├── javdatabase/          # Scraper esterno (javdatabase.com)
│   └── run.js
└── README.md

data/actors/
├── .index.json           # Mapping name variants → slug ID
└── {actor-slug}/
    ├── actor.json        # Dati attore
    └── photo.jpg         # Foto attore
```

## Schema Attore

Ogni attore ha i seguenti campi:

```javascript
{
  "id": "hayami-remu",              // Slug normalizzato
  "name": "Hayami Remu",            // Nome principale
  "altName": "早美れむ",             // Nome giapponese
  "otherNames": ["Remu Hayami"],    // Varianti
  "birthdate": "1997-12-25",
  "height": 158,
  "bust": 85,
  "waist": 58,
  "hips": 84,
  "bloodType": "A",
  "photoAbsolute": "/actors/hayami-remu/photo.jpg",  // Path assoluto
  "photoRelative": "../actors/hayami-remu/photo.jpg", // Path relativo a library
  "meta": {
    "sources": ["javdatabase", "local"],
    "lastUpdate": "2025-12-26"
  }
}
```

## Configurazione (config.json)

```json
{
  "actorsEnabled": true,
  "actorsPath": null,  // null = usa ./data/actors, altrimenti path assoluto
  "actorsScrapers": ["local", "javdatabase"]
}
```

## Logica Path

- Se `actorsPath` è configurato → usa `photoAbsolute` (path assoluto per container)
- Se `actorsPath` è `null` → usa `photoRelative` (relativo a library)
- Il sistema salva SEMPRE entrambi i path nel `actor.json`

## Scrapers

### Regola di Name Inversion (IMPORTANTE)

**Ogni scraper DEVE implementare la logica di inversione del nome:**

1. Prova a cercare l'attore con il nome originale
2. Se NON trovato, inverte il nome (es. "Mao Hamasaki" → "Hamasaki Mao")
3. Prova a cercare con il nome invertito
4. Se NON trovato, passa al prossimo scraper

**Razionale:**
- L'index NON deve contenere varianti invertite
- Ogni scraper è responsabile di provare l'inversione
- Questo evita duplicati nell'index e mantiene la logica centralizzata

### Local Scraper

Legge dati da `data/actors/{id}/actor.json`
- Cache layer per lookup veloci
- Usa `actors-index.json` per risolvere varianti del nome
- **Implementa name inversion**: prova prima con nome originale, poi con nome invertito

### JAVDB Scraper (javdatabase.com)

Scarica dati da `https://www.javdatabase.com/idols/{slug}/`
- Estrae: name, birthdate, height, bust, waist, hips, photo
- Usa Puppeteer per lo scraping
- Scarica foto in `actorsPath/{slug}/photo.{ext}`
- **Implementa name inversion**: prova prima con nome originale, poi con nome invertito

## Merge Intelligente

Il sistema usa la priorità definita in `actorsScrapers` per ogni campo:
1. Per ogni campo, usa il primo valore non-vuoto dalla lista di scrapers
2. Quando tutti i campi sono pieni → stop scraping
3. I nomi alternativi (`otherNames`) vengono merged da tutti gli scrapers

**Esempio:**
- `local` ha `name` + `photo`
- `javdatabase` aggiunge `birthdate` + `measurements`
- Risultato finale ha tutti i campi popolati

## Normalizzazione Nomi

La funzione `normalizeActorName(name)` converte:
- `"Hayami Remu"` → `"hayami-remu"`
- `"早美れむ"` → `"hayami-remu"` (rimuove caratteri giapponesi)
- `"Remu Hayami"` → `"hayami-remu"`

Regole:
- Lowercase
- Rimuovi caratteri speciali e giapponesi
- Converti spazi in trattini
- Rimuovi trattini multipli/consecutivi

## Index Mapping

Il file `actors-index.json` mappa le varianti del nome all'ID normalizzato:

```json
{
  "hayami remu": "hayami-remu",
  "早美れむ": "hayami-remu"
}
```

**IMPORTANTE:** L'index NON contiene nomi invertiti. Gli scrapers gestiscono l'inversione autonomamente.

Varianti incluse nell'index:
- Nome principale (`name`)
- Nome alternativo (`altName`)
- Altri nomi (`otherNames[]`)

Varianti NON incluse (gestite dagli scrapers):
- Nomi invertiti (es. "Yura Kana" ↔ "Kana Yura")

## Integrazione in scrapeSaver.js

Quando salvi un film con `actorsEnabled: true`:

```javascript
if (config.actorsEnabled && item.actor) {
  for (const actor of item.actor) {
    const actorData = await getActor(actor.name);

    // Usa path corretto per NFO
    const photoPath = config.actorsPath
      ? actorData.photoAbsolute
      : actorData.photoRelative;

    actor.thumb = photoPath;
  }
}
```

## WebUI - Modal Attore

Il modal è stato aggiornato con i seguenti campi:
- **Base:** Nome, Nome Alternativo, Ruolo, Thumb URL
- **Estesi:** Data di Nascita, Altezza, Gruppo Sanguigno
- **Misure:** Seno, Vita, Fianchi
- **Info:** Fonte dati (read-only, mostra da dove provengono i dati)

## API ActorScraperManager

```javascript
const { getActor, scrapeActor } = require('./src/core/actorScraperManager');

// Ottieni attore (da cache o scrape)
const actor = await getActor('Hayami Remu');

// Force scrape (anche se in cache)
const actor = await scrapeActor('Hayami Remu');
```

## Note Importanti

- **NO update automatico:** gli attori non cambiano frequentemente
- **NO batch update:** solo on-demand per attore
- **Priorità:** `local` sempre primo (cache), poi scrapers esterni
- **Auto-save:** se scraper esterno trova attore → salva in local per cache

## Testing

Per testare il sistema:

```bash
# Test local scraper
node scrapers/actors/local/run.js "Test Actor"

# Test javdatabase scraper (richiede Puppeteer, già installato)
node scrapers/actors/javdatabase/run.js "Hayami Remu"
```
