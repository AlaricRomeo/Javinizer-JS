# Scrapers Directory

This directory contains scrapers organized by content type.

## Structure

```
scrapers/
├── movies/           # Movie/JAV metadata scrapers
│   ├── schema.js     # Standard output format definition
│   ├── _template/    # Template for creating new scrapers
│   ├── javlibrary/   # javlibrary.com scraper
│   └── r18dev/       # r18.dev scraper
│
└── actors/           # (Future) Actor profile scrapers
    └── ...
```

## Content Types

### Movies (`scrapers/movies/`)

Scrapers for JAV movie metadata (DVD codes like SDDM-943, JUR-618, etc.).

**Standard Output Format**: See `movies/schema.js` for the complete specification.

**Available Scrapers**:
- `javlibrary` - Scrapes javlibrary.com (requires interactive Cloudflare bypass)
- `r18dev` - Scrapes r18.dev (automatic)
- `_template` - Template for creating new scrapers

### Actors (`scrapers/actors/`) - Future

Scrapers for actor/actress profile metadata.

## Adding a New Movie Scraper

### Quick Start

1. Copy the template:
   ```bash
   cp -r movies/_template movies/mynewscraper
   cd movies/mynewscraper
   ```

2. Replace "TEMPLATE" with your scraper name in all files

3. Implement your scraping logic in `scrape.js`:
   ```javascript
   const { createEmptyMovie } = require('../schema');

   async function scrapeSingleCode(code) {
     const movie = createEmptyMovie(code);  // Start with standard format

     // Fill in fields from your source
     movie.title = "...";
     movie.releaseDate = "YYYY-MM-DD";
     movie.genres = ["Drama", "Romance"];
     // ...

     return movie;  // Already in standard format!
   }
   ```

4. Test it:
   ```bash
   node run.js TEST-001
   ```

5. Enable it in `config.json`:
   ```json
   {
     "scrapers": ["javlibrary", "r18dev", "mynewscraper"]
   }
   ```

That's it! No modifications to ScraperManager needed.

## Scraper Contract

Each scraper is an independent CLI application that:

**Input:** Accepts DVD codes as command-line arguments
```bash
node run.js CODE1 CODE2 CODE3
```

**Output:** Returns valid JSON array in **standard format** (see `movies/schema.js`)
```json
[
  {
    "id": "CODE1",
    "code": "CODE1",
    "title": "Title",
    "originalTitle": "",
    "releaseDate": "2023-01-15",
    "runtime": 120,
    "genres": ["Drama"],
    "actor": [
      {
        "name": "Actor Name",
        "altName": "",
        "role": "Actress",
        "thumb": ""
      }
    ],
    ...
  }
]
```

**Logging:** All logs go to stderr (not stdout)
```javascript
console.error('[MyScraper] Processing...');  // ✅ Good
console.log('[MyScraper] Processing...');    // ❌ Bad
```

## Rules

1. ✅ **DO** use `createEmptyMovie()` from schema.js
2. ✅ **DO** return data in standard format
3. ✅ **DO** output ONLY JSON to stdout
4. ✅ **DO** output logs to stderr
5. ✅ **DO** remove null/empty values
6. ✅ **DO** return standard empty movie on failure
7. ❌ **DON'T** modify ScraperManager
8. ❌ **DON'T** use custom field names (use schema!)
9. ❌ **DON'T** try to merge data from other scrapers

## Directory Structure

Each scraper should have this structure:

```
scrapers/
└── yourscrapername/
    ├── run.js           # Entry point (REQUIRED)
    ├── scrape.js        # Main logic
    ├── browser.js       # Browser automation (optional)
    ├── parse.js         # HTML parsing (optional)
    ├── package.json     # Dependencies (optional)
    └── .gitignore       # Ignore cache/data (optional)
```

## Testing

### Test Standalone
```bash
cd yourscrapername
node run.js SDDM-943
```

### Test with ScraperManager
```bash
node ../scraperManager.js SDDM-943
```

## Documentation

- **Full Implementation Guide:** `/SCRAPER_IMPLEMENTATION_GUIDE.md`
- **ScraperManager Docs:** `/SCRAPER_MANAGER.md`
- **Template:** `_template/README.md`

## How ScraperManager Finds Scrapers

1. Reads `config.json` → `scrapers` array
2. For each scraper name, looks for `scrapers/{name}/run.js`
3. Executes it with DVD codes as arguments
4. Captures JSON from stdout
5. Merges results according to priority rules

**Zero configuration needed in ScraperManager!**

## Priority System

Position in config.json determines default priority:

```json
{
  "scrapers": ["javlibrary", "r18dev", "myscraper"]
}
```

- javlibrary = highest priority (first)
- r18dev = medium priority
- myscraper = lowest priority (last)

Override per-field:

```json
{
  "scrapers": ["javlibrary", "r18dev", "myscraper"],
  "fieldPriorities": {
    "title": ["myscraper", "r18dev", "javlibrary"]
  }
}
```

Now for `title` field: myscraper > r18dev > javlibrary

## Examples

See existing scrapers:
- `javlibrary/` - Complex scraper with HTML parsing and Puppeteer
- `r18dev/` - Browser automation with JSON API
- `_template/` - Minimal template to copy
