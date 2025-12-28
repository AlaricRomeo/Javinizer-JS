# Project Structure Refactoring Plan

## Current Issues
1. `bin/` directory contains only one script that should be elsewhere
2. Empty/unused directories: `data/cache/`, `data/imports/`, `data/results/`, `src/scrapers/`
3. Scrapers are in `/scrapers/` root but unclear organization

## Proposed Structure

```
javinizer-js/
├── src/
│   ├── core/               # Core business logic
│   │   ├── actorScraperManager.js
│   │   ├── libraryReader.js
│   │   ├── saveNfo.js
│   │   ├── scrapeSaver.js
│   │   ├── scrapeReader.js
│   │   └── scraperManager.js
│   ├── server/             # Express server
│   │   ├── index.js
│   │   └── routes.js
│   ├── web/                # Frontend assets
│   │   ├── app.js
│   │   ├── config.html
│   │   ├── i18n-bindings.js
│   │   └── index.html
│   └── lang/               # Translations
│       ├── en.json
│       └── it.json
├── scrapers/               # All scrapers
│   ├── movies/
│   │   └── r18dev/
│   │       ├── scrape.js
│   │       └── r18dev.md
│   └── actors/
│       ├── schema.js       # Shared schema
│       ├── local/
│       │   └── run.js
│       └── javdb/
│           ├── run.js
│           └── javdb.md
├── data/                   # Runtime data (gitignored)
│   ├── scrape/            # Scraped movie JSONs
│   └── actors/            # Actor cache (if not using external path)
├── config.json             # Configuration
├── package.json
└── README.md

## Directories to Remove
- `bin/` (move batch-actors.js to src/core/)
- `data/cache/` (unused)
- `data/imports/` (unused)
- `data/results/` (unused)
- `src/scrapers/` (empty, scrapers are in /scrapers/)

## Files to Move/Rename
1. `bin/batch-actors.js` → Delete (functionality in actorScraperManager.js)
2. Keep `/scrapers/` at root (clear separation of concerns)

## Rationale
- `src/` = source code (core logic, server, frontend)
- `scrapers/` = external plugins (can be added/removed independently)
- `data/` = runtime data only (gitignored)
- Clear separation between code and data
- No empty directories
