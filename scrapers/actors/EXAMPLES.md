# Actor Scraper - Esempi di Utilizzo

## 1. Configurazione Base

In `config.json`:

```json
{
  "actorsEnabled": true,
  "actorsPath": null,
  "actorsScrapers": ["local", "javdatabase"]
}
```

### Opzioni actorsPath

**Opzione A - Path relativo (default):**
```json
{
  "actorsPath": null
}
```
- Usa `./data/actors` come directory base
- Nel NFO usa `photoRelative`: `../actors/{slug}/photo.jpg`
- Ideale per librerie locali

**Opzione B - Path assoluto (container):**
```json
{
  "actorsPath": "/mnt/storage/actors"
}
```
- Usa path assoluto specificato
- Nel NFO usa `photoAbsolute`: `/mnt/storage/actors/{slug}/photo.jpg`
- Ideale per container Docker o storage condiviso

## 2. Utilizzo Programmatico

### Ottenere dati attore (con cache)

```javascript
const { getActor } = require('./src/core/actorScraperManager');

// L'attore viene cercato prima in cache locale,
// poi scraped se non trovato
const actor = await getActor('Hayami Remu');

if (actor) {
  console.log('Nome:', actor.name);
  console.log('Nome JP:', actor.altName);
  console.log('Altezza:', actor.height, 'cm');
  console.log('Misure:', `${actor.bust}-${actor.waist}-${actor.hips}`);
  console.log('Foto:', actor.photoRelative);
}
```

### Force scrape (ignora cache)

```javascript
const { scrapeActor } = require('./src/core/actorScraperManager');

// Force scrape da fonti esterne
const actor = await scrapeActor('Hayami Remu');
```

### Batch processing

```javascript
const { getActor } = require('./src/core/actorScraperManager');

const actorNames = ['Hayami Remu', 'Aika Yumeno', 'Momo Sakura'];

for (const name of actorNames) {
  const actor = await getActor(name);
  if (actor) {
    console.log(`✓ ${actor.name} - ${actor.height}cm`);
  } else {
    console.log(`✗ ${name} - non trovato`);
  }
}
```

## 3. Integrazione nel Workflow di Scraping

### In scrapeSaver.js

```javascript
const { getActor } = require('./actorScraperManager');

async function enrichActorsData(item, config) {
  if (!config.actorsEnabled || !item.actor) {
    return;
  }

  for (const actor of item.actor) {
    if (!actor.name) continue;

    // Ottieni dati completi attore
    const actorData = await getActor(actor.name);

    if (actorData) {
      // Arricchisci con dati aggiuntivi
      actor.altName = actorData.altName || actor.altName;
      actor.birthdate = actorData.birthdate;
      actor.height = actorData.height;
      actor.bust = actorData.bust;
      actor.waist = actorData.waist;
      actor.hips = actorData.hips;
      actor.bloodType = actorData.bloodType;

      // Usa path corretto per foto
      const photoPath = config.actorsPath
        ? actorData.photoAbsolute
        : actorData.photoRelative;

      if (photoPath) {
        actor.thumb = photoPath;
      }

      // Aggiungi metadata
      actor.meta = actorData.meta;
    }
  }
}
```

## 4. Creazione Manuale di Attori

### Struttura directory

```bash
data/actors/
├── .index.json
└── hayami-remu/
    ├── actor.json
    └── photo.jpg
```

### File actor.json

```json
{
  "id": "hayami-remu",
  "name": "Hayami Remu",
  "altName": "早美れむ",
  "otherNames": ["Remu Hayami", "レム早見"],
  "birthdate": "1997-12-25",
  "height": 158,
  "bust": 85,
  "waist": 58,
  "hips": 84,
  "bloodType": "A",
  "photoAbsolute": "/actors/hayami-remu/photo.jpg",
  "photoRelative": "../actors/hayami-remu/photo.jpg",
  "meta": {
    "sources": ["manual"],
    "lastUpdate": "2025-12-27T10:00:00.000Z"
  }
}
```

### Aggiornamento .index.json

```json
{
  "hayami remu": "hayami-remu",
  "早美れむ": "hayami-remu",
  "remu hayami": "hayami-remu",
  "レム早見": "hayami-remu"
}
```

## 5. WebUI - Utilizzo Modal Attore

### Apertura modal per nuovo attore

```javascript
// In app.js
document.getElementById("addActor").onclick = () => {
  if (!currentItem.actor) {
    currentItem.actor = [];
  }
  openActorModal(null);
};
```

### Editing attore esistente

```javascript
function editActor(index) {
  openActorModal(index);
}
```

### Salvataggio dati estesi

Il modal ora include tutti i campi estesi:
- Data di nascita
- Altezza
- Gruppo sanguigno
- Misure (seno, vita, fianchi)
- Fonte dati (read-only)

## 6. Testing e Debugging

### Test local scraper

```bash
# Test con attore esistente
node scrapers/actors/local/run.js "Test Actor"

# Test con attore non esistente
node scrapers/actors/local/run.js "Non Existing Actor"
```

### Test javdatabase scraper

```bash
# Richiede Puppeteer (già installato per javlibrary)

# Test scraping
node scrapers/actors/javdatabase/run.js "Hayami Remu"
```

### Debug ActorScraperManager

```javascript
const { getActor } = require('./src/core/actorScraperManager');

// Abilita log dettagliati (già implementato)
const actor = await getActor('Test Name');

// I log mostreranno:
// - Quale scraper viene eseguito
// - Se l'attore è trovato in cache
// - Quali campi vengono popolati
// - Quando lo scraping si ferma (tutti i campi pieni)
```

### Verifica cache

```bash
# Lista attori in cache
ls -la data/actors/

# Visualizza dati attore
cat data/actors/hayami-remu/actor.json | jq

# Visualizza index
cat data/actors/.index.json | jq
```

## 7. Normalizzazione Nomi

### Esempi di normalizzazione

```javascript
const { normalizeActorName } = require('./scrapers/actors/schema');

console.log(normalizeActorName('Hayami Remu'));      // hayami-remu
console.log(normalizeActorName('早美れむ'));          // (vuoto - solo JP)
console.log(normalizeActorName('Remu Hayami'));      // remu-hayami
console.log(normalizeActorName('AIKA'));             // aika
console.log(normalizeActorName('Maria Nagai'));      // maria-nagai
```

### Gestione caratteri speciali

```javascript
normalizeActorName('Aoi ♥ Ichigo')      // aoi-ichigo
normalizeActorName('Yu-ki Takeuchi')    // yu-ki-takeuchi
normalizeActorName('Rei Mizuna (水菜麗)') // rei-mizuna
```

## 8. Best Practices

### 1. Usa sempre getActor() invece di scrapeActor()
```javascript
// ✓ CORRETTO - usa cache se disponibile
const actor = await getActor(name);

// ✗ EVITA - force scrape ogni volta
const actor = await scrapeActor(name);
```

### 2. Gestisci attori non trovati
```javascript
const actor = await getActor(name);
if (!actor) {
  console.warn(`Actor ${name} not found`);
  // Usa fallback o dati esistenti
  continue;
}
```

### 3. Preserva metadata esistente
```javascript
// Quando modifichi un attore, preserva la fonte
if (existingActor.meta) {
  updatedActor.meta = existingActor.meta;
}
```

### 4. Usa path corretto in base a config
```javascript
const photoPath = config.actorsPath
  ? actor.photoAbsolute
  : actor.photoRelative;
```

## 9. Troubleshooting

### Problema: Attore non trovato in cache

**Soluzione:** Verifica `.index.json`
```bash
cat data/actors/.index.json | grep -i "nome attore"
```

Se manca, aggiungi manualmente o rigenera l'index.

### Problema: JavaDatabase scraper fallisce

**Causa:** Puppeteer non installato

**Soluzione:**
```bash
npm install puppeteer
```

(Nota: Puppeteer dovrebbe già essere installato per javlibrary scraper)

### Problema: Photo path non corretto nel NFO

**Causa:** Config `actorsPath` non corretto

**Soluzione:** Verifica che usi il path giusto:
- `null` → `photoRelative`
- path assoluto → `photoAbsolute`

### Problema: Merge non funziona correttamente

**Causa:** Priorità scrapers errata

**Soluzione:** Verifica `actorsScrapers` in config:
```json
{
  "actorsScrapers": ["local", "javdatabase"]
}
```

`local` deve essere SEMPRE primo per usare la cache.
