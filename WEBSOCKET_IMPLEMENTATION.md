# WebSocket Bidirectional Communication - Implementation Summary

## Obiettivo
Implementare comunicazione bidirezionale tra scrapers e WebUI per supportare scrapers interattivi (es. javlibrary con Cloudflare).

## Architettura

```
┌─────────────────┐         WebSocket           ┌──────────────────┐
│   Browser       │ ←─────────────────────────→ │   Express        │
│   (WebUI)       │    (bidirectional comm)     │   Server         │
└─────────────────┘                             └──────────────────┘
                                                         ↓
                                                 ┌──────────────────┐
                                                 │  ScraperManager  │
                                                 │  (EventEmitter)  │
                                                 └──────────────────┘
                                                         ↓
                                                   stdin/stdout
                                                         ↓
                                                 ┌──────────────────┐
                                                 │  Scraper Child   │
                                                 │  Process         │
                                                 └──────────────────┘
```

## File Modificati

### 1. Server WebSocket (`src/server/index.js`)
- Creato server WebSocket integrato con Express
- Handler per connessioni WebSocket
- Gestione messaggi bidirezionali (`promptResponse`)
- Passaggio `wss` alle routes via middleware

### 2. ScraperManager (`src/core/scraperManager.js`)
- Aggiunto supporto EventEmitter per eventi real-time
- Intercettazione messaggi `__PROMPT__:` da stdout
- Invio risposte a scrapers via stdin
- Eventi emessi:
  - `start` - Inizio scraping
  - `progress` - Messaggi di progresso
  - `scraperError` - Errori scraper
  - `prompt` - Richiesta interazione utente
  - `complete` - Completamento
  - `error` - Errori generali

### 3. Routes (`src/server/routes.js`)
- Sostituito SSE con WebSocket
- POST `/item/scrape/start` ritorna risposta immediata + scrapeId
- Broadcast eventi WebSocket a tutti i client connessi
- Handler evento `prompt` con callback storage

### 4. WebUI (`src/web/app.js`)
- Rimossa implementazione SSE
- Connessione WebSocket automatica
- Handler evento `prompt` con modal dialog
- Invio `promptResponse` tramite WebSocket
- Nuovo colore arancione per messaggi prompt

### 5. Javlibrary Scraper (`scrapers/movies/javlibrary/browser.js`)
- Funzione `waitForUserConfirmation()` per prompt interattivi
- Invio `__PROMPT__:` a stdout
- Ricezione risposte da stdin
- Gestione cancellazione utente

## Protocollo di Comunicazione

### Scraper → ScraperManager (via stdout)
```javascript
const promptData = { type: 'confirm', message: 'Your message' };
console.log(`__PROMPT__:${JSON.stringify(promptData)}`);
```

### ScraperManager → Scraper (via stdin)
```json
{"response": true}
```
o
```json
{"response": false}
```

### ScraperManager → WebUI (via WebSocket)
```json
{
  "event": "prompt",
  "data": {
    "promptId": "1234567890",
    "scraperName": "javlibrary",
    "promptType": "confirm",
    "message": "Please solve Cloudflare..."
  },
  "scrapeId": "1234567890"
}
```

### WebUI → ScraperManager (via WebSocket)
```json
{
  "type": "promptResponse",
  "promptId": "1234567890",
  "response": true
}
```

## Eventi WebSocket

| Evento | Direzione | Descrizione |
|--------|-----------|-------------|
| `start` | Server→Client | Inizio scraping |
| `progress` | Server→Client | Messaggio progresso |
| `scraperError` | Server→Client | Errore scraper + confirm dialog |
| `prompt` | Server→Client | Richiesta interazione utente |
| `complete` | Server→Client | Completamento scraping |
| `error` | Server→Client | Errore generale |
| `promptResponse` | Client→Server | Risposta utente a prompt |
| `scraperErrorResponse` | Client→Server | Risposta a errore scraper |

## Vantaggi

1. **Indipendenza Scrapers**: Gli scrapers rimangono processi indipendenti
2. **Protocollo Standardizzato**: Qualsiasi scraper può usare lo stesso protocollo
3. **Fallback CLI**: Quando non c'è WebSocket, risposte automatiche
4. **User Experience**: Dialog modali nella WebUI invece di terminale
5. **Scalabilità**: Supporto multipli client WebSocket contemporaneamente

## Esempio d'Uso: Javlibrary

1. Scraper javlibrary apre browser Puppeteer
2. Invia prompt: "Solve Cloudflare challenge"
3. ScraperManager intercetta e emette evento `prompt`
4. Routes invia evento via WebSocket a WebUI
5. WebUI mostra dialog modale all'utente
6. Utente risolve Cloudflare e clicca "Continue"
7. WebUI invia `promptResponse` via WebSocket
8. Routes chiama callback che invia risposta a stdin dello scraper
9. Scraper riceve risposta e continua l'esecuzione

## Testing

### Modalità CLI (senza WebSocket)
```bash
node src/core/scraperManager.js
# Prompts ricevono automaticamente response: true
```

### Modalità WebUI (con WebSocket)
```bash
npm start
# Aprire browser su http://localhost:4004
# Click "Start Scraping"
# Risolvere Cloudflare quando richiesto
```

## File di Documentazione

- `scrapers/INTERACTIVE_PROTOCOL.md` - Guida completa per sviluppatori scrapers
- Esempi completi in `scrapers/movies/javlibrary/browser.js`

## Prossimi Passi Possibili

1. ✅ Timeout per prompts (evitare blocchi infiniti)
2. ✅ Supporto prompt tipo "input" (non solo confirm)
3. ✅ Retry automatico su errori Cloudflare
4. ✅ Persistenza sessione browser più robusta
5. ✅ Logging strutturato eventi WebSocket
