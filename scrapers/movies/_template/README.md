# Scraper Template

This is a template for creating new scrapers.

## How to Use This Template

1. **Copy the template directory:**
   ```bash
   cp -r scrapers/_template scrapers/yourscrapername
   cd scrapers/yourscrapername
   ```

2. **Replace "TEMPLATE" with your scraper name:**
   - In `run.js`: Replace all instances of "TEMPLATE"
   - In `scrape.js`: Replace all instances of "TEMPLATE"

3. **Implement your scraping logic:**
   - Edit `scrape.js`
   - Implement the `scrapeSingleCode()` function
   - Add any helper functions you need

4. **Test your scraper:**
   ```bash
   node run.js TEST-001
   ```

5. **Enable your scraper:**
   - Add your scraper name to `config.json`:
   ```json
   {
     "scrapers": ["javlibrary", "r18dev", "yourscrapername"]
   }
   ```

## Files Included

- **run.js** - Entry point (CLI interface)
- **scrape.js** - Main scraping logic (implement your code here)
- **README.md** - This file

## Optional Files You Can Add

- **browser.js** - If you need Puppeteer/browser automation
- **parse.js** - If you need HTML parsing logic
- **package.json** - If you have dependencies
- **.gitignore** - To ignore cache/session data

## Scraper Contract

Your scraper MUST:

1. Accept DVD codes as command-line arguments
2. Output ONLY valid JSON to stdout
3. Output logs/messages to stderr
4. Return array format: `[{ code: "XXX", ... }]`
5. Include 'code' or 'dvd_id' field in every object
6. Remove null values, empty strings, empty arrays
7. On error, return `[{ code: "XXX" }]` for each code

See `SCRAPER_IMPLEMENTATION_GUIDE.md` for full details.

## Example Implementation

See existing scrapers for examples:
- `scrapers/javlibrary/` - HTML scraping with Puppeteer
- `scrapers/r18dev/` - Browser automation with JSON API

## Testing

Test standalone:
```bash
node run.js SDDM-943
```

Test with ScraperManager:
```bash
node ../../scraperManager.js SDDM-943
```

## Need Help?

Read the full guide: `SCRAPER_IMPLEMENTATION_GUIDE.md`
