# Project Structure

This document describes the organization of the Javinizer-JS project.

## Directory Structure

```
javinizer-js/
├── bin/                    # CLI Tools
│   └── batch-actors.js    # Standalone CLI for batch actor processing
│
├── src/                    # Source Code
│   ├── core/              # Core Business Logic
│   │   ├── actorScraperManager.js   # Manages actor scraping workflow
│   │   ├── libraryReader.js         # Reads movie library (edit mode)
│   │   ├── saveNfo.js              # NFO file save operations
│   │   ├── scrapeSaver.js          # Saves scraped data
│   │   ├── scrapeReader.js         # Reads scraped data (scrape mode)
│   │   └── scraperManager.js       # Manages movie scraping workflow
│   │
│   ├── server/            # Express Server
│   │   ├── index.js      # Server initialization
│   │   └── routes.js     # API routes
│   │
│   ├── web/              # Frontend Assets
│   │   ├── app.js               # Main frontend logic
│   │   ├── config.html          # Configuration page
│   │   ├── i18n-bindings.js    # i18n UI bindings
│   │   └── index.html           # Main UI page
│   │
│   └── lang/             # Translations
│       ├── en.json       # English translations
│       └── it.json       # Italian translations
│
├── scrapers/             # Scraper Plugins
│   ├── movies/          # Movie Scrapers
│   │   └── r18dev/
│   │       ├── scrape.js     # Scraper implementation
│   │       └── r18dev.md     # Documentation
│   │
│   └── actors/          # Actor Scrapers
│       ├── schema.js    # Shared actor schema
│       ├── local/
│       │   └── run.js   # Local cache scraper
│       └── javdb/
│           ├── run.js   # JAVDatabase scraper
│           └── javdb.md # Documentation
│
├── data/                # Runtime Data (gitignored)
│   ├── scrape/         # Scraped movie JSONs (temporary)
│   └── actors/         # Actor cache (if not using external path)
│
├── config.json          # User configuration
├── package.json         # Node.js dependencies
└── README.md           # Main documentation
```

## Key Principles

1. **Separation of Concerns**
   - `src/core/` = Business logic
   - `src/server/` = HTTP layer
   - `src/web/` = Frontend UI
   - `scrapers/` = Data acquisition (plugins)

2. **Code vs Data**
   - All code in `src/` and `scrapers/`
   - All runtime data in `data/` (gitignored)
   - Configuration in `config.json` (gitignored)

3. **Scraper Plugin Architecture**
   - Movie scrapers in `scrapers/movies/`
   - Actor scrapers in `scrapers/actors/`
   - Each scraper is self-contained
   - Can be added/removed independently

4. **Data Flow**
   - **Scrape Mode**: scrapers → `data/scrape/` → save to library
   - **Edit Mode**: library NFO ↔ UI ↔ library NFO
   - **Actor Flow**: movie data → actor scrapers → actor cache → enrich movie data

## File Naming Conventions

- **Core modules**: camelCase (e.g., `libraryReader.js`)
- **Scrapers**: lowercase with dash (e.g., `r18dev/scrape.js`)
- **Configs**: lowercase (e.g., `config.json`)
- **Documentation**: UPPERCASE (e.g., `README.md`)

## Removed Directories

The following directories were removed as they were empty/unused:
- `data/cache/` - Not used
- `data/imports/` - Not used
- `data/results/` - Not used
- `src/scrapers/` - Empty (scrapers are in `/scrapers/`)

## CLI Tools

### batch-actors.js
Located in `bin/`, this is a standalone CLI tool for batch processing actors.

**Usage:**
```bash
node bin/batch-actors.js
```

**What it does:**
1. Extracts actor names from all scraped movies in `data/scrape/`
2. Scrapes each actor using configured scrapers
3. Saves actor data to cache as .nfo files
4. Updates all movie JSONs with enriched actor data

**When to use:**
- After completing movie scraping
- To update actor data for all movies at once
- Can be run standalone or integrated into workflows
