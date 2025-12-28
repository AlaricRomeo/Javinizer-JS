# Actor Scraping Workflow

## Overview

The actor scraping system now operates **after** movie scraping is complete, in a separate batch process. This ensures all actors are scraped once and their data is enriched in all movie JSON files before saving.

## New Workflow

### Phase 1: Movie Scraping
```bash
# Run movie scraping as usual (via WebUI or CLI)
# This creates JSON files in data/scrape/*.json
```

### Phase 2: Actor Batch Processing
```bash
# Option A: Via CLI
node bin/batch-actors.js

# Option B: Via API
curl -X POST http://localhost:4004/actors/batch-process
```

**What happens:**
1. Extracts all unique actor names from `data/scrape/*.json` files
2. For each actor:
   - Checks if already in cache (local scraper)
   - If not cached, scrapes from enabled external scrapers (e.g., javdatabase)
   - Saves actor data as `.nfo` file (Kodi XML format) in `data/actors/` or `actorsPath`
   - Updates `.index.json` with name variants
3. Updates all movie JSON files with enriched actor data (birthdate, measurements, thumb, etc.)

### Phase 3: Save Movies
```bash
# Save movies via WebUI
# Actor data is already enriched in the JSON files
```

## File Structure

### Actor Cache Format

**Location:**
- Default: `./data/actors/`
- External: Configured via `actorsPath` in config.json

**Files:**
```
data/actors/
├── .index.json                 # Name variant → ID mapping
├── remu-hayami.nfo            # Actor data (Kodi XML format)
├── remu-hayami.jpg            # Actor thumbnail
├── test-actor.nfo
└── test-actor.jpg
```

### Actor NFO Format (XML)

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<actor>
  <name>Hayami Remu</name>
  <altname>早美れむ</altname>
  <othername>Remu Hayami</othername>
  <birthdate>1997-12-25</birthdate>
  <height>163</height>
  <bust>88</bust>
  <waist>58</waist>
  <hips>85</hips>
  <thumburl>https://example.com/hayami-remu.jpg</thumburl>
  <thumblocal>remu-hayami.jpg</thumblocal>
  <thumb>https://example.com/hayami-remu.jpg</thumb>
  <sources>
    <source>javdatabase</source>
  </sources>
  <lastupdate>2025-12-27T12:00:00.000Z</lastupdate>
</actor>
```

### Movie JSON (After Batch Processing)

```json
{
  "data": {
    "id": "IESP-659",
    "title": "Remu Hayami Schoolgirl 20 Creampies in a Row",
    "actor": [
      {
        "name": "Remu Hayami",
        "altName": "早美れむ",
        "role": "Actress",
        "birthdate": "1997-12-25",
        "height": 163,
        "bust": 88,
        "waist": 58,
        "hips": 85,
        "thumb": "https://example.com/hayami-remu.jpg"
      }
    ]
  }
}
```

## Configuration

### config.json

```json
{
  "actorsEnabled": true,
  "actorsPath": "/mnt/storage/actors",  // Optional: null = use ./data/actors
  "actorsScrapers": [
    "local",        // Always first (cache lookup)
    "javdatabase"   // External scrapers in priority order
  ]
}
```

### Thumb Path Logic

- **If `actorsPath` is configured:**
  - `thumb` = `"../actors/hayami-remu.jpg"` (relative path)
  - Thumbnail saved to external location

- **If `actorsPath` is null:**
  - `thumb` = `"https://example.com/hayami-remu.jpg"` (original URL)
  - Thumbnail saved to `./data/actors/hayami-remu.jpg`

## CLI Tool

### bin/batch-actors.js

```bash
# Run batch actor processing
node bin/batch-actors.js

# Output:
# ========================================
#   Batch Actor Processing
# ========================================
#
# [ActorScraperManager] Found 5 unique actors in 10 movies
# [ActorScraperManager] Processing actor: Remu Hayami
# [ActorScraperManager] Successfully scraped: Remu Hayami
# ...
#
# ========================================
#   Summary
# ========================================
#
# Scraping Results:
#   Total actors: 5
#   Scraped: 3
#   Cached (already exists): 2
#   Failed: 0
#
# Movie Update Results:
#   Total movies: 10
#   Updated: 10
#   Failed: 0
#
# ✅ Batch processing completed successfully!
```

## API Endpoint

### POST /actors/batch-process

**Request:**
```bash
curl -X POST http://localhost:4004/actors/batch-process
```

**Response:**
```json
{
  "ok": true,
  "message": "Batch actor processing completed",
  "summary": {
    "success": true,
    "scraping": {
      "success": true,
      "message": "Batch scraping completed",
      "total": 5,
      "scraped": 3,
      "cached": 2,
      "failed": 0
    },
    "updating": {
      "success": true,
      "message": "Movie update completed",
      "total": 10,
      "updated": 10,
      "failed": 0
    }
  }
}
```

## Comparison: Old vs New Workflow

### Old Workflow (Before)
```
1. Scrape movies → data/scrape/*.json
2. WebUI editing (optional)
3. Save movie → scrapeSaver.js
   ├── 3.1 Create folder
   ├── 3.2 Move video
   ├── 3.3 Scrape actors (inline, one by one) ❌ SLOW
   ├── 3.4 Generate NFO
   └── 3.5 Download images
```

**Problems:**
- Actor scraping happens during save (blocking)
- Same actor scraped multiple times if in multiple movies
- No batch optimization

### New Workflow (After)
```
1. Scrape movies → data/scrape/*.json
2. Batch process actors (ONCE) ✅
   ├── 2.1 Extract all unique actor names
   ├── 2.2 Scrape missing actors
   ├── 2.3 Save to cache (.nfo format)
   └── 2.4 Update all movie JSONs
3. Save movies → scrapeSaver.js
   ├── 3.1 Create folder
   ├── 3.2 Move video
   ├── 3.3 Generate NFO (actors already enriched)
   └── 3.4 Download images
```

**Benefits:**
- ✅ Actors scraped only once (batch)
- ✅ Faster save process (no actor scraping)
- ✅ Centralized actor cache
- ✅ Kodi-compatible .nfo format
- ✅ CLI and API support

## Migration Notes

### Converting Existing .json to .nfo

```bash
# Manually convert existing actor JSON files
node -e "
const fs = require('fs');
const path = require('path');
const { actorToNFO } = require('./scrapers/actors/schema.js');

const actorsPath = './data/actors';
const files = fs.readdirSync(actorsPath).filter(f => f.endsWith('.json'));

files.forEach(file => {
  const jsonPath = path.join(actorsPath, file);
  const actor = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const nfoContent = actorToNFO(actor);
  const nfoPath = jsonPath.replace('.json', '.nfo');

  fs.writeFileSync(nfoPath, nfoContent, 'utf-8');
  console.log('✅ Converted:', file, '→', path.basename(nfoPath));
});
"
```

## Troubleshooting

### Actors not found during batch processing

**Problem:** `[ActorScraperManager] No actor ID found for: Remu Hayami`

**Solution:** Check `.index.json` for name variant mapping. Add manually if needed:
```json
{
  "remu hayami": "remu-hayami",
  "hayami remu": "remu-hayami",
  "早美れむ": "remu-hayami"
}
```

### External actorsPath not accessible

**Problem:** `Actor not found: /mnt/storage/actors/hayami-remu.nfo`

**Solution:**
1. Verify path exists and has write permissions
2. Set `actorsPath: null` in config.json to use default `./data/actors`

### Batch processing hangs on javdatabase scraper

**Problem:** Puppeteer timeout or connection error

**Solution:**
1. Check internet connection
2. Verify Puppeteer is installed: `npm install puppeteer`
3. Increase timeout in javdatabase scraper
4. Disable javdatabase temporarily: `"actorsScrapers": ["local"]`

## Best Practices

1. **Run batch-actors after each scraping session**
   ```bash
   # Workflow
   ./scrape-movies.sh
   node bin/batch-actors.js
   # Then save via WebUI
   ```

2. **Keep actorsScrapers priority correct**
   ```json
   {
     "actorsScrapers": [
       "local",        // ← Always first (fast cache lookup)
       "javdatabase"   // ← External scrapers after
     ]
   }
   ```

3. **Backup actor cache regularly**
   ```bash
   tar -czf actors-backup-$(date +%Y%m%d).tar.gz data/actors/
   ```

4. **Use external actorsPath for large libraries**
   - Faster SSD/NAS storage
   - Shared across multiple javinizer instances
   - Better organization

## Future Enhancements

- [ ] WebUI button for batch actor processing
- [ ] Progress bar for batch processing
- [ ] Actor merge conflict resolution UI
- [ ] More actor scrapers (JAVLibrary, R18.dev)
- [ ] Actor profile pages in WebUI
- [ ] Automatic actor updates (refresh old data)
