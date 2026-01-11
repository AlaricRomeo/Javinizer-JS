# JavLibrary-FS Scraper

Clone dello scraper `javlibrary` che utilizza FlareSolverr invece di Puppeteer per bypassare Cloudflare.

## Differenze rispetto a javlibrary

- **javlibrary**: Usa Puppeteer (browser automatizzato) con sessione persistente
- **javlibrary-fs**: Usa FlareSolverr (servizio esterno) con sessione persistente

## Requisiti

- FlareSolverr attivo e raggiungibile (default: `http://flaresolverr:8191`)
- Variabile d'ambiente `FLARESOLVERR_URL` (opzionale, per override dell'URL)

## Configurazione

Aggiungi `javlibrary-fs` alla lista degli scrapers in `config.json`:

```json
{
  "scrapers": {
    "video": [
      "javlibrary-fs"
    ]
  }
}
```

## Vantaggi di FlareSolverr

- **Non richiede browser locale**: FlareSolverr gestisce il browser in un container separato
- **Sessione persistente**: Cookie e clearance Cloudflare vengono riutilizzati tra le richieste
- **Cache condivisa**: Tutti i client che usano la stessa sessione condividono lo stesso stato

## Output

Identico allo scraper `javlibrary` - tutti i campi sono gli stessi:
- `title`: Titolo giapponese
- `releaseDate`: Data di rilascio (YYYY-MM-DD)
- `runtime`: Durata in minuti
- `studio`: Studio/Maker
- `director`: Regista
- `label`: Label
- `genres`: Array di generi
- `actor`: Array di attori con struttura `{name, altName, role, thumb}`
- `coverUrl`: URL della copertina
- `images.poster`: URL del poster

## Uso da CLI

```bash
node scrapers/movies/javlibrary-fs/run.js SDDM-943
node scrapers/movies/javlibrary-fs/run.js SDDM-943 DVDES-590
```

## Struttura dei file

- `run.js`: Entry point CLI
- `scrape.js`: Logica principale di scraping
- `parse.js`: Parsing HTML (copiato da javlibrary)
- `flaresolverr.js`: Client FlareSolverr con gestione sessione persistente
- `README.md`: Questa documentazione

## Note tecniche

- Session ID: `javlibrary-fs` (fisso, condiviso tra tutte le invocazioni)
- Timeout richieste: 60 secondi
- Delay tra richieste: 1 secondo
- La sessione viene distrutta automaticamente alla fine dello scraping
