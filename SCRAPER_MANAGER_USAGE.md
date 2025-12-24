# ScraperManager Usage Guide

## Overview

ScraperManager automatically scrapes metadata for all video files in your library.

## Location

```
src/core/scraperManager.js
```

## How It Works

1. **Reads library path** from `config.json`
2. **Scans all files** in the library directory
3. **Extracts DVD codes** from filenames (text before first space)
4. **Skips directories** completely
5. **Executes scrapers** sequentially for all codes
6. **Merges results** based on priority rules
7. **Saves JSON files** to `data/scrape/{code}.json`

## Usage

Simply run:

```bash
node src/core/scraperManager.js
```

No command-line arguments needed - it reads everything from `config.json`.

## Example

### Library Structure

```
/mnt/Jav/library/
  ├── SDDM-943 Movie Title.mp4    → Code: SDDM-943
  ├── JUR-618.nfo                  → Code: JUR-618  
  ├── ABC-123 [Tagged].mkv         → Code: ABC-123
  ├── XYZ-456 File Name.avi        → Code: XYZ-456
  └── SomeDirectory/               → SKIPPED (directory)
```

### Configuration

```json
{
  "libraryPath": "/mnt/Jav/library",
  "scrapers": ["javlibrary", "r18dev"],
  "fieldPriorities": {
    "title": ["r18dev", "javlibrary"]
  }
}
```

### Execution

```bash
$ node src/core/scraperManager.js

[ScraperManager] Reading library: /mnt/Jav/library
[ScraperManager] Found 4 file(s) to scrape
[ScraperManager] Enabled scrapers: javlibrary, r18dev
[ScraperManager] Scraping 4 code(s): SDDM-943, JUR-618, ABC-123, XYZ-456
[ScraperManager] Executing scraper: javlibrary
...
[ScraperManager] Executing scraper: r18dev
...
[ScraperManager] Saved: data/scrape/SDDM-943.json
[ScraperManager] Saved: data/scrape/JUR-618.json
[ScraperManager] Saved: data/scrape/ABC-123.json
[ScraperManager] Saved: data/scrape/XYZ-456.json
[ScraperManager] Completed. Saved 4 JSON file(s) to data/scrape/
```

### Output Files

```
data/scrape/
  ├── SDDM-943.json
  ├── JUR-618.json
  ├── ABC-123.json
  └── XYZ-456.json
```

Each JSON file contains merged metadata from all enabled scrapers.

## Code Extraction Rules

From filenames, the code is extracted as:

- **Before first space**: `"SDDM-943 Title.mp4"` → `"SDDM-943"`
- **Remove extension**: `"JUR-618.nfo"` → `"JUR-618"`
- **Entire name if no space**: `"ABC-123.mkv"` → `"ABC-123"`

## Output Format

Each JSON file is cleaned to remove:
- `null` values
- Empty strings `""`
- Empty arrays `[]`

Example output:

```json
{
  "code": "SDDM-943",
  "title": "Movie Title",
  "description": "Description text",
  "releaseDate": "2023-01-15",
  "actresses": [
    {
      "name": "Actress Name",
      "role": "Actress"
    }
  ],
  "genres": ["Drama", "Romance"],
  "coverUrl": "https://example.com/cover.jpg"
}
```

## Interactive Scrapers

ScraperManager fully supports interactive scrapers (like javlibrary):

```bash
$ node src/core/scraperManager.js

[ScraperManager] Executing scraper: javlibrary
[Browser] ========================================
[Browser] Please solve the Cloudflare challenge
[Browser] Press ENTER when ready
[Browser] ========================================
<you press ENTER>
[Browser] Continuing...
[ScraperManager] Scraper javlibrary completed successfully
```

Your terminal input is passed directly to the scraper.

## Configuration

All behavior is controlled by `config.json`:

### Required Fields

```json
{
  "libraryPath": "/path/to/your/library"
}
```

### Optional Fields

```json
{
  "scrapers": ["javlibrary", "r18dev"],
  "fieldPriorities": {
    "title": ["r18dev", "javlibrary"],
    "coverUrl": ["r18dev", "javlibrary"]
  }
}
```

## Error Handling

- If a scraper fails, ScraperManager continues with other scrapers
- If all scrapers fail for a code, it saves `{ "code": "XXX" }`
- Partial failures don't stop the process
- All errors are logged to stderr

## Tips

1. **Test first**: Use a small library for testing
2. **Check logs**: All progress is logged to stderr
3. **Verify output**: Check `data/scrape/` for generated files
4. **Interactive scrapers**: Be ready to interact when using javlibrary
5. **Priority tuning**: Adjust `fieldPriorities` for better results
