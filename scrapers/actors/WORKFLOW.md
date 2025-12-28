# Actor Scraper - Flusso di Funzionamento

## 📋 Panoramica

Il sistema di actor scraping è **integrato nel processo di save** e avviene **PRIMA** della generazione del NFO.

## 🔄 Flusso Completo

### Fase 1: Scraping Film (separato, prima)

```
User → Esegue scraperManager
     ↓
scraperManager.js
     ├─ Esegue scrapers film (r18dev, javlibrary, etc.)
     ├─ Merge risultati
     └─ Salva in data/scrape/{ID}.json

Risultato: File JSON con dati film + array actors (solo nomi base)
```

**Esempio file salvato:**
```json
{
  "scrapedAt": "2025-12-27T10:00:00Z",
  "sources": ["r18dev"],
  "data": {
    "id": "SDDM-943",
    "title": "...",
    "actor": [
      {
        "name": "Hayami Remu",
        "role": "Actress"
        // Nessun altro dato ancora!
      }
    ]
  }
}
```

---

### Fase 2: WebUI - Editing (opzionale)

```
User → Apre WebUI
     → Vede film scraped
     → Può modificare campi
     → Può editare attori nel modal

Nessun scraping attori ancora!
```

---

### Fase 3: Save Film (QUI avviene lo scraping attori!)

Quando l'utente clicca "Salva" nella WebUI:

```
WebUI → POST /scrape/save
      ↓
routes.js (riga 359)
      ├─ Riceve item modificato dall'utente
      ├─ Crea ScrapeSaver instance
      └─ Chiama saver.saveItem(itemToSave, scrapeData)

      ↓

scrapeSaver.js::saveItem()
      ├─ 1. Crea cartella nella libreria
      ├─ 2. Sposta e rinomina video
      │
      ├─ 2.5. 🎯 SCRAPING ATTORI (NUOVO!)
      │   │
      │   └─ if (actorsEnabled && item.actor)
      │       │
      │       └─ for each actor in item.actor:
      │           │
      │           ├─ actorData = await getActor(actor.name)
      │           │                      ↓
      │           │           actorScraperManager.js
      │           │                      ├─ Cerca in index
      │           │                      ├─ Cerca in cache (local scraper)
      │           │                      └─ Se non trovato:
      │           │                          ├─ Esegue javdatabase scraper
      │           │                          ├─ Merge risultati
      │           │                          └─ Salva in cache
      │           │
      │           └─ Aggiorna actor.thumb con photo path
      │               Aggiorna actor.altName, etc.
      │
      ├─ 3. Genera NFO (con dati attori completi!)
      ├─ 4. Scarica fanart
      └─ 5. Crea poster
```

---

## 📊 Flusso Dettagliato Scraping Attori

### Step 2.5 in scrapeSaver.js (righe 173-202)

```javascript
// Input: item.actor = [{ name: "Hayami Remu", role: "Actress" }]

for (const actor of item.actor) {
  // 1. Chiama getActor()
  const actorData = await getActor(actor.name);

  // 2. getActor() internamente:
  //    a. Cerca in .index.json → trova ID "hayami-remu"
  //    b. Carica data/actors/hayami-remu/actor.json
  //    c. Se trovato → return dati completi
  //    d. Se NON trovato:
  //       - Esegue local scraper → nulla
  //       - Esegue javdatabase scraper:
  //         * Scrape da javdatabase.com/idols/hayami-remu/
  //         * Download foto → data/actors/hayami-remu/photo.jpg
  //         * Salva actor.json in cache
  //         * Aggiorna .index.json
  //       - Return dati completi

  // 3. Aggiorna actor object con dati scraped
  if (actorData) {
    actor.altName = actorData.altName;        // Nome giapponese
    actor.birthdate = actorData.birthdate;    // Data nascita (solo in actor.json)
    actor.height = actorData.height;          // Altezza (solo in actor.json)
    actor.bust = actorData.bust;              // Seno (solo in actor.json)
    actor.waist = actorData.waist;            // Vita (solo in actor.json)
    actor.hips = actorData.hips;              // Fianchi (solo in actor.json)

    // Determina path foto corretto
    const photoPath = config.actorsPath
      ? actorData.photoAbsolute    // Container: "/actors/hayami-remu/photo.jpg"
      : actorData.photoRelative;   // Locale: "../actors/hayami-remu/photo.jpg"

    actor.thumb = photoPath;       // URL/path per NFO
  }
}

// Output: item.actor = [
//   {
//     name: "Hayami Remu",
//     altName: "早美れむ",
//     role: "Actress",
//     thumb: "../actors/hayami-remu/photo.jpg",
//     birthdate: "1997-12-25",
//     height: 158,
//     bust: 85,
//     waist: 58,
//     hips: 84
//   }
// ]
```

### Step 3: Generazione NFO

Il NFO viene generato **DOPO** lo scraping attori, quindi include tutti i dati:

```xml
<movie>
  <id>SDDM-943</id>
  <title>...</title>
  <actor>
    <name>Hayami Remu</name>
    <role>Actress</role>
    <thumb>../actors/hayami-remu/photo.jpg</thumb>
  </actor>
</movie>
```

---

## 🎯 Punti Chiave

### 1. Ordine delle Operazioni

```
Scraping Film → WebUI Editing → SAVE → Scraping Attori → NFO
                  (opzionale)      ↑
                                   └─ Qui avviene tutto!
```

### 2. Cache degli Attori

**Prima richiesta** per "Hayami Remu":
```
getActor("Hayami Remu")
  → Index: non trovato
  → Local: non trovato
  → JavaDatabase: scrape → SUCCESS
  → Salva in cache
  → Return dati completi
```

**Seconda richiesta** (stesso attore in altro film):
```
getActor("Hayami Remu")
  → Index: trovato → "hayami-remu"
  → Local: trovato in cache!
  → Return dati completi (VELOCE!)
```

### 3. Scraping On-Demand

Gli attori vengono scraped **solo quando necessario**:
- ✓ Durante il save di un film
- ✓ Se non sono già in cache
- ✗ NON durante lo scraping del film
- ✗ NON durante la visualizzazione nella WebUI

### 4. Gestione Errori

Se lo scraping di un attore fallisce:
```javascript
try {
  const actorData = await getActor(actor.name);
  // ...
} catch (error) {
  console.error(`Failed to scrape actor ${actor.name}: ${error.message}`);
  // Continua con il prossimo attore
  // Il film viene salvato comunque!
}
```

Il film viene salvato **anche se** alcuni attori non sono stati trovati.

---

## 📁 Struttura Dati nel Tempo

### T1: Dopo Scraping Film
```
data/scrape/SDDM-943.json
{
  "data": {
    "actor": [
      { "name": "Hayami Remu", "role": "Actress" }
    ]
  }
}

data/actors/
  (vuoto o attori precedenti)
```

### T2: Dopo Save Film
```
/mnt/library/SDDM-943/
  ├── SDDM-943.mp4
  ├── SDDM-943.nfo        ← NFO con thumb="../actors/hayami-remu/photo.jpg"
  ├── fanart.jpg
  └── poster.jpg

data/actors/
  ├── .index.json          ← Aggiunto mapping "hayami remu" → "hayami-remu"
  └── hayami-remu/
      ├── actor.json       ← Dati completi attore
      └── photo.jpg        ← Foto scaricata
```

---

## 🔧 Configurazione

### actorsEnabled: false (default prima dell'implementazione)

```javascript
// Nel save:
// 2.5. Scrape actors if enabled
if (this.config.actorsEnabled && item.actor) {
  // Questo blocco viene SALTATO
}

// Risultato NFO:
<actor>
  <name>Hayami Remu</name>
  <role>Actress</role>
  <!-- Nessun thumb! -->
</actor>
```

### actorsEnabled: true (dopo configurazione)

```javascript
// Nel save:
if (this.config.actorsEnabled && item.actor) {
  // Questo blocco viene ESEGUITO
  for (const actor of item.actor) {
    const actorData = await getActor(actor.name);
    // Arricchisce i dati...
  }
}

// Risultato NFO:
<actor>
  <name>Hayami Remu</name>
  <role>Actress</role>
  <thumb>../actors/hayami-remu/photo.jpg</thumb>
</actor>
```

---

## 💡 Vantaggi di Questo Approccio

### 1. Efficienza
- Scraping attori solo quando serve (durante il save)
- Cache locale per riutilizzo
- Nessun overhead durante lo scraping film

### 2. Flessibilità
- User può disabilitare con `actorsEnabled: false`
- User può modificare manualmente i dati attore prima del save
- Scraping fallito non blocca il save del film

### 3. Consistenza
- NFO generato con dati completi
- Path foto sempre corretto (assoluto/relativo)
- Metadata tracked (sources, lastUpdate)

---

## 🚨 Limitazioni

### Modifiche Manuali Attori
Se l'utente modifica i dati attore nel modal **PRIMA** del save, questi vengono **SOVRASCRITTI** dallo scraping.

**Soluzione:** Disabilita `actorsEnabled` temporaneamente se vuoi mantenere modifiche manuali.

### Network Richiesto
Lo scraping javdatabase richiede connessione internet. Se offline, vengono usati solo dati in cache locale.

### Primo Save Lento
Il primo save di un film con nuovi attori può essere lento (deve scrapare da javdatabase). I save successivi sono veloci (cache).
