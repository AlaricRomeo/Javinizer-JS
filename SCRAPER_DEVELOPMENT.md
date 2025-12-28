# Scraper Development Guide

Quick reference for developing new scrapers for Javinizer-js.

## Quick Start

```bash
# 1. Create your scraper directory
mkdir scrapers/myscraper

# 2. Create run.js (entry point)
cat > scrapers/myscraper/run.js << 'EOF'
#!/usr/bin/env node

async function scrape(codes) {
  const results = [];

  for (const code of codes) {
    console.error(`[MyScraper] Processing: ${code}`);

    try {
      // Your scraping logic here
      const data = {
        code: code,
        title: "Example Title",
        description: "Example description"
      };

      results.push(cleanData(data));
    } catch (error) {
      console.error(`[MyScraper] Error: ${error.message}`);
      results.push({ code });
    }
  }

  return results;
}

function cleanData(obj) {
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== '' &&
        !(Array.isArray(value) && value.length === 0)) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

async function main() {
  const codes = process.argv.slice(2);

  if (codes.length === 0) {
    console.error('Usage: node run.js <CODE> [CODE2] ...');
    process.exit(1);
  }

  try {
    const results = await scrape(codes);
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error(`[Error] ${error.message}`);
    console.log(JSON.stringify(codes.map(code => ({ code })), null, 2));
    process.exit(1);
  }
}

main();
EOF

# 3. Test your scraper
node scrapers/myscraper/run.js TEST-001

# 4. Enable in config
# Add "myscraper" to the scrapers array in config.json
```

## The Contract

### Input
Your scraper receives DVD codes as command-line arguments:
```bash
node run.js SDDM-943 JUR-618 ABC-123
```

### Output
Your scraper outputs **ONLY** valid JSON to stdout:
```json
[
  {
    "code": "SDDM-943",
    "title": "Example Title",
    "description": "Example description"
  }
]
```

### Logging
All debug messages and logs go to stderr:
```javascript
console.error('[MyScraper] Starting...');  // ✅ Good
console.log('[MyScraper] Starting...');    // ❌ Bad - breaks JSON parsing
```

## Critical Rules

1. **JSON only on stdout** - No debug messages, no logs
2. **Array format** - Always return array, even for single results
3. **Include 'code' field** - Every object MUST have a `code` or `dvd_id` field
4. **No empty values** - Remove null, empty strings, empty arrays
5. **Use stderr for logs** - All human messages go to stderr

## Standard Field Names

```javascript
{
  "code": "SDDM-943",              // Required
  "contentId": "sddm00943",        // Alternative ID format
  "title": "Video Title",
  "alternateTitle": "Alternate",
  "description": "Description",
  "releaseDate": "2023-01-15",     // ISO 8601 format
  "runtime": 120,                  // Minutes (number)
  "director": "Director Name",
  "series": "Series Name",
  "maker": "Studio Name",
  "label": "Label Name",
  "rating": 8.5,                   // 0-10 (number)
  "genres": ["Genre1", "Genre2"],
  "tags": ["Tag1", "Tag2"],
  "actors": [{
    "name": "Actor Name",
    "role": "Actress",
    "thumbUrl": "https://..."
  }],
  "coverUrl": "https://...",
  "screenshotUrl": "https://...",
  "trailerUrl": "https://..."
}
```

## Directory Structure

```
scrapers/
└── myscraper/
    ├── run.js          # Entry point (REQUIRED)
    ├── scrape.js       # Main logic (optional)
    ├── browser.js      # Browser automation (optional)
    └── package.json    # Dependencies (optional)
```

## Testing

### Test Standalone
```bash
cd scrapers/myscraper
node run.js TEST-001
```

Check output:
- ✅ Only JSON on stdout
- ✅ Logs on stderr
- ✅ Valid JSON array
- ✅ Contains 'code' field
- ✅ No null/empty values

### Test with ScraperManager

1. Add to `config.json`:
```json
{
  "scrapers": ["myscraper"]
}
```

2. Run:
```bash
node src/core/scraperManager.js TEST-001
```

## Advanced Features

### Browser Automation (Puppeteer)

If you need to scrape JavaScript-heavy sites:

```javascript
const puppeteer = require('puppeteer');

async function scrapeSingleCode(code) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(`https://example.com/video/${code}`);

    const title = await page.$eval('h1.title', el => el.textContent);
    const description = await page.$eval('.description', el => el.textContent);

    return {
      code: code,
      title: title.trim(),
      description: description.trim()
    };
  } finally {
    await browser.close();
  }
}
```

### Interactive Scrapers (CAPTCHA, Cloudflare)

If your scraper needs user interaction:

```javascript
console.error('========================================');
console.error('Please solve the CAPTCHA in the browser');
console.error('Press ENTER when ready');
console.error('========================================');

await new Promise((resolve) => {
  process.stdin.once('data', () => {
    process.stdin.pause();
    resolve();
  });
});
```

### Error Handling

Always handle errors gracefully:

```javascript
try {
  const results = await scrape(codes);
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(`[Error] ${error.message}`);
  // Return minimal JSON on error
  console.log(JSON.stringify(codes.map(code => ({ code })), null, 2));
  process.exit(1);
}
```

## Configuration

### Enable Scraper

Add to `config.json`:
```json
{
  "scrapers": ["javlibrary", "r18dev", "myscraper"]
}
```

Position in array = default priority (first = highest)

### Field Priorities

Override priority for specific fields:
```json
{
  "scrapers": ["javlibrary", "r18dev", "myscraper"],
  "fieldPriorities": {
    "title": ["myscraper", "r18dev", "javlibrary"],
    "coverUrl": ["myscraper"]
  }
}
```

This means:
- For `title`: prefer myscraper → r18dev → javlibrary
- For `coverUrl`: prefer myscraper (fallback to global order)
- All other fields: use global order

## Common Mistakes

❌ **Writing to stdout before JSON**
```javascript
console.log('Starting...');  // BREAKS JSON PARSING
```

❌ **Returning objects instead of arrays**
```javascript
return { code: "XXX" };   // BAD
return [{ code: "XXX" }]; // GOOD
```

❌ **Including empty values**
```javascript
{ title: "", genres: [], rating: null }  // BAD
{ title: "Title" }                       // GOOD
```

❌ **Modifying ScraperManager**
```javascript
// BAD - each scraper should be standalone
if (scraper === 'myscraper') { ... }
```

## Checklist

Before enabling your scraper:

- [ ] Created `scrapers/yourname/run.js`
- [ ] Accepts codes as CLI arguments
- [ ] Outputs ONLY JSON to stdout
- [ ] Logs go to stderr
- [ ] Returns array format
- [ ] Includes 'code' field
- [ ] Removes null/empty values
- [ ] Handles errors gracefully
- [ ] Tested standalone
- [ ] Tested with ScraperManager
- [ ] Added to config.json

## Examples

### Example 1: Simple HTTP Scraper

```javascript
#!/usr/bin/env node
const https = require('https');

async function scrape(codes) {
  const results = [];

  for (const code of codes) {
    console.error(`[Example] Scraping ${code}...`);

    try {
      const data = await fetchData(code);
      results.push(cleanData(data));
    } catch (error) {
      console.error(`[Example] Error: ${error.message}`);
      results.push({ code });
    }
  }

  return results;
}

async function fetchData(code) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.example.com/video/${code}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const json = JSON.parse(data);
          resolve({
            code: code,
            title: json.title,
            description: json.description
          });
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

function cleanData(obj) {
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== '' &&
        !(Array.isArray(value) && value.length === 0)) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

async function main() {
  const codes = process.argv.slice(2);
  if (codes.length === 0) {
    console.error('Usage: node run.js <CODE> [CODE2] ...');
    process.exit(1);
  }

  try {
    const results = await scrape(codes);
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error(`[Error] ${error.message}`);
    console.log(JSON.stringify(codes.map(code => ({ code })), null, 2));
    process.exit(1);
  }
}

main();
```

### Example 2: HTML Scraper with Cheerio

```javascript
#!/usr/bin/env node
const https = require('https');
const cheerio = require('cheerio');

async function scrapeSingleCode(code) {
  return new Promise((resolve, reject) => {
    https.get(`https://example.com/video/${code}`, (res) => {
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        try {
          const $ = cheerio.load(html);

          resolve({
            code: code,
            title: $('h1.title').text().trim(),
            description: $('.description').text().trim(),
            genres: $('.genre').map((i, el) => $(el).text()).get(),
            coverUrl: $('img.cover').attr('src')
          });
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

// ... rest of the code same as Example 1
```

## Further Reading

- **[SCRAPER_IMPLEMENTATION_GUIDE.md](SCRAPER_IMPLEMENTATION_GUIDE.md)** - Comprehensive guide
- **[scrapers/README.md](scrapers/README.md)** - Overview of existing scrapers
- **[SCRAPER_MANAGER.md](SCRAPER_MANAGER.md)** - How ScraperManager works
- **[scrapers/INTERACTIVE_PROTOCOL.md](scrapers/INTERACTIVE_PROTOCOL.md)** - Interactive scraper protocol

## Summary

To add a new scraper:

1. **Create** `scrapers/yourname/run.js`
2. **Follow** the input/output contract
3. **Add** `"yourname"` to `config.json` scrapers array
4. **Done!** No ScraperManager changes needed

The ScraperManager automatically:
- Discovers your scraper by name
- Executes it with correct arguments
- Captures and parses JSON output
- Merges results by priority rules
