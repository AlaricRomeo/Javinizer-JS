# Actor Scraper Standard

Standard ufficiale per implementare scraper attori in javinizer-js.
Tutti gli scraper attori DEVONO seguire queste specifiche.

## Table of Contents
- [Input Format](#input-format)
- [Output Format](#output-format)
- [CLI Interface](#cli-interface)
- [Browser Management](#browser-management)
- [Error Handling](#error-handling)
- [Name Inversion Logic](#name-inversion-logic)
- [Implementation Checklist](#implementation-checklist)

---

## Input Format

Gli scraper attori DEVONO accettare **array di nomi** da riga di comando:

```bash
# Single actor
node scrapers/actors/javdb/run.js "Hayami Remu"

# Multiple actors (batch)
node scrapers/actors/javdb/run.js "Hayami Remu" "Sunohara Miki" "Mizuhara Sana"
```

### Argomenti
- `process.argv.slice(2)` = array di nomi attori
- Ogni nome può contenere spazi (quindi va quotato)
- Array vuoto = errore

---

## Output Format

### Successo: Array JSON
Lo scraper DEVE restituire un **array JSON** su stdout, anche per un singolo attore:

```json
[
  {
    "id": "hayami-remu",
    "name": "Hayami Remu",
    "altName": "早美れむ",
    "otherNames": ["Remu Hayami"],
    "birthdate": "1997-12-25",
    "height": 158,
    "bust": 85,
    "waist": 58,
    "hips": 84,
    "thumbUrl": "https://example.com/photo.jpg",
    "thumbLocal": "hayami-remu.jpg",
    "thumb": "/actors/hayami-remu.jpg",
    "meta": {
      "sources": ["javdb"],
      "lastUpdate": "2025-01-13T10:30:00.000Z"
    }
  },
  {
    "id": "sunohara-miki",
    "name": "Sunohara Miki",
    "error": "Not found"
  }
]
```

### Campo obbligatori per successo
- `id`: Slug normalizzato (es. `hayami-remu`)
- `name`: Nome principale

### Campi opzionali
- `altName`: Nome alternativo (giapponese)
- `otherNames`: Array di varianti
- `birthdate`: Data nascita formato `YYYY-MM-DD`
- `height`: Altezza in cm (number)
- `bust`, `waist`, `hips`: Misure in cm (number)
- `thumbUrl`: URL originale foto (sempre preservato)
- `thumbLocal`: Nome file locale (es. `hayami-remu.jpg`)
- `thumb`: Path finale da usare (URL o path relativo)
- `meta.sources`: Array di scraper che hanno fornito dati
- `meta.lastUpdate`: ISO timestamp

### Campo per errori parziali
Se un attore non viene trovato, includere nell'array:

```json
{
  "id": "generated-id",
  "name": "Original Name",
  "error": "Not found"
}
```

### Fallimento totale
In caso di errore critico che impedisce il processing:

```bash
console.error('[scraper] Critical error: ...')
console.log('[]')  # Array vuoto
exit(1)
```

---

## CLI Interface

### Structure

```javascript
#!/usr/bin/env node

const { scrapeActors } = require('./scrape');

async function main() {
  const names = process.argv.slice(2);

  if (names.length === 0) {
    console.error('Usage: node run.js <NAME> [NAME2] [NAME3] ...');
    console.error('Example: node run.js "Hayami Remu"');
    console.error('Example: node run.js "Hayami Remu" "Sunohara Miki"');
    process.exit(1);
  }

  try {
    const results = await scrapeActors(names);

    // Output ONLY valid JSON to stdout
    console.log(JSON.stringify(results, null, 2));

    // Check for errors
    const hasErrors = results.some(r => r.error);

    // Force exit after timeout (browser cleanup)
    setTimeout(() => {
      process.exit(hasErrors ? 1 : 0);
    }, 5000);

  } catch (error) {
    console.error(`[Error] ${error.message}`);

    // Return minimal array with error markers
    const errorResults = names.map(name => ({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      error: error.message
    }));
    console.log(JSON.stringify(errorResults, null, 2));

    setTimeout(() => {
      process.exit(1);
    }, 5000);
  }
}

main();
```

### Key Points
- **Stdout** = JSON output only
- **Stderr** = logs, progress, errors
- Exit codes: 0 = success, 1 = error
- Timeout per cleanup browser (5-15 secondi)

---

## Browser Management

### Shared Browser Instance

Per batch processing, riutilizzare browser tra attori:

```javascript
async function scrapeActors(names) {
  let browser = null;
  const results = [];

  try {
    // Launch once
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Reuse for all actors
    for (const name of names) {
      try {
        const result = await scrapeActor(name, browser);
        results.push(result);
      } catch (error) {
        results.push({
          id: normalizeActorName(name),
          name,
          error: error.message
        });
      }
    }

    return results;

  } finally {
    // Always cleanup
    if (browser) {
      await browser.close();
    }
  }
}
```

### Single Actor Function

La funzione singola DEVE accettare browser opzionale:

```javascript
async function scrapeActor(name, browser = null) {
  const shouldCloseBrowser = !browser;

  try {
    if (!browser) {
      browser = await puppeteer.launch({...});
    }

    const page = await browser.newPage();
    // ... scraping logic ...
    await page.close();

    return actorData;

  } finally {
    if (shouldCloseBrowser && browser) {
      await browser.close();
    }
  }
}
```

---

## Error Handling

### Partial Errors

Se un attore fallisce, NON bloccare gli altri:

```javascript
for (const name of names) {
  try {
    const result = await scrapeActor(name, browser);
    results.push(result);
  } catch (error) {
    console.error(`[scraper] Failed to scrape ${name}: ${error.message}`);
    results.push({
      id: normalizeActorName(name),
      name,
      error: error.message
    });
  }
}
```

### Critical Errors

Errori che bloccano tutto (es. browser crash):

```javascript
try {
  browser = await puppeteer.launch({...});
} catch (error) {
  console.error('[scraper] Cannot launch browser:', error.message);

  // Return error for all actors
  return names.map(name => ({
    id: normalizeActorName(name),
    name,
    error: 'Browser unavailable'
  }));
}
```

---

## Name Inversion Logic

**Ogni scraper DEVE implementare name inversion:**

### Rationale
- Gli attori possono essere referenziati come "First Last" o "Last First"
- L'index NON contiene varianti invertite
- Ogni scraper prova entrambe le varianti autonomamente

### Implementation

```javascript
async function scrapeActor(name, browser = null) {
  // Try original name first
  let result = await tryFetch(name, browser);

  if (!result) {
    // Try inverted name
    const parts = name.trim().split(/\s+/);
    if (parts.length === 2) {
      const invertedName = `${parts[1]} ${parts[0]}`;
      console.error(`[scraper] Trying inverted name: ${invertedName}`);
      result = await tryFetch(invertedName, browser);
    }
  }

  if (!result) {
    return {
      id: normalizeActorName(name),
      name,
      error: 'Not found'
    };
  }

  // IMPORTANT: Use original name for ID
  result.id = normalizeActorName(name);
  return result;
}
```

### Key Points
- Prova prima nome originale
- Se fallisce, inverte e riprova
- L'ID finale usa sempre il nome originale
- Non salvare nomi invertiti nell'index

---

## Implementation Checklist

Per implementare un nuovo scraper attori:

### File Structure
- [ ] `scrapers/actors/{scraper-name}/run.js` - CLI entrypoint
- [ ] `scrapers/actors/{scraper-name}/scrape.js` - Logic (opzionale)

### Input/Output
- [ ] Accetta array di nomi da `process.argv.slice(2)`
- [ ] Valida input (almeno 1 nome)
- [ ] Restituisce array JSON su stdout
- [ ] Log su stderr (non stdout)

### Browser Management
- [ ] Funzione batch con browser condiviso
- [ ] Funzione singola con browser opzionale
- [ ] Cleanup browser in `finally` block
- [ ] Timeout force exit (5-15s)

### Error Handling
- [ ] Errori parziali non bloccano batch
- [ ] Oggetti con `error` field per fallimenti
- [ ] Exit code 0 per successo, 1 per errore
- [ ] Array vuoto `[]` per errori critici

### Name Inversion
- [ ] Implementa logica inversione nome
- [ ] Prova nome originale prima
- [ ] Prova nome invertito se fallisce
- [ ] ID usa sempre nome originale

### Data Format
- [ ] Usa `schema.js` per struttura attore
- [ ] Chiama `normalizeActorName()` per ID
- [ ] Chiama `removeEmptyFields()` prima di return
- [ ] Preserva `thumbUrl` originale
- [ ] Setta `meta.sources` e `meta.lastUpdate`

### Testing
- [ ] Test singolo attore
- [ ] Test batch (3+ attori)
- [ ] Test attore non trovato
- [ ] Test con nome invertito
- [ ] Test errore browser

---

## Example: Minimal Scraper

```javascript
#!/usr/bin/env node

const puppeteer = require('puppeteer');
const { createEmptyActor, normalizeActorName, removeEmptyFields } = require('../schema');

async function scrapeActors(names) {
  let browser = null;
  const results = [];

  try {
    browser = await puppeteer.launch({ headless: true });

    for (const name of names) {
      try {
        const result = await scrapeActor(name, browser);
        results.push(result);
      } catch (error) {
        results.push({
          id: normalizeActorName(name),
          name,
          error: error.message
        });
      }
    }

    return results;

  } finally {
    if (browser) await browser.close();
  }
}

async function scrapeActor(name, browser = null) {
  const shouldCloseBrowser = !browser;

  try {
    if (!browser) {
      browser = await puppeteer.launch({ headless: true });
    }

    // Try original name
    let data = await tryFetch(name, browser);

    // Try inverted name
    if (!data) {
      const parts = name.trim().split(/\s+/);
      if (parts.length === 2) {
        const inverted = `${parts[1]} ${parts[0]}`;
        data = await tryFetch(inverted, browser);
      }
    }

    if (!data) {
      return {
        id: normalizeActorName(name),
        name,
        error: 'Not found'
      };
    }

    return removeEmptyFields(data);

  } finally {
    if (shouldCloseBrowser && browser) {
      await browser.close();
    }
  }
}

async function tryFetch(name, browser) {
  const page = await browser.newPage();
  const slug = normalizeActorName(name);
  const url = `https://example.com/actors/${slug}`;

  const response = await page.goto(url);
  if (!response || response.status() >= 400) {
    await page.close();
    return null;
  }

  const actor = createEmptyActor(name);
  // ... extract data from page ...

  await page.close();
  return actor;
}

async function main() {
  const names = process.argv.slice(2);

  if (names.length === 0) {
    console.error('Usage: node run.js <NAME> [NAME2] ...');
    process.exit(1);
  }

  try {
    const results = await scrapeActors(names);
    console.log(JSON.stringify(results, null, 2));

    const hasErrors = results.some(r => r.error);
    setTimeout(() => process.exit(hasErrors ? 1 : 0), 5000);

  } catch (error) {
    console.error(`[Error] ${error.message}`);
    console.log('[]');
    setTimeout(() => process.exit(1), 5000);
  }
}

main();
```

---

## Comparison with Movie Scrapers

Gli scraper attori seguono lo stesso pattern degli scraper movies:

| Aspect | Movie Scrapers | Actor Scrapers |
|--------|---------------|----------------|
| Input | Array di codici | Array di nomi |
| Output | Array JSON | Array JSON |
| Browser | Condiviso nel batch | Condiviso nel batch |
| Errori parziali | Oggetto con `error` | Oggetto con `error` |
| CLI | `node run.js CODE1 CODE2` | `node run.js "NAME1" "NAME2"` |
| Timeout | 15s force exit | 5-15s force exit |

---

## References

- `schema.js` - Standard actor data structure
- `cache-helper.js` - Cache management utilities
- `actorScraperManager.js` - Manager che orchestra gli scraper
- Movie scrapers in `scrapers/movies/` - Esempio pattern simile
