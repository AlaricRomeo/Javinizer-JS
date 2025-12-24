# Scraper Implementation Guide

This guide explains how to implement new scrapers for javinizer-js WITHOUT modifying the ScraperManager.

## Core Principles

1. **Zero ScraperManager modifications** - The ScraperManager never needs to be changed
2. **Follow the contract** - New scrapers must follow the input/output contract
3. **Be independent** - Each scraper is a standalone CLI application
4. **Be discoverable** - Just add the scraper name to config.json

## The Scraper Contract

### Input (Command Line Arguments)

Your scraper MUST accept DVD codes as command-line arguments:

```bash
node run.js CODE1 CODE2 CODE3 ...
```

**Examples:**
```bash
node run.js SDDM-943
node run.js SDDM-943 JUR-618 ABC-123
```

### Output (stdout)

Your scraper MUST output **ONLY** valid JSON to stdout:

```json
[
  {
    "code": "SDDM-943",
    "title": "Example Title",
    "description": "Example description",
    "releaseDate": "2023-01-15"
  }
]
```

**CRITICAL RULES:**

1. **JSON only on stdout** - No debug messages, no logs, no extra text
2. **Array format** - Always output an array, even for single results
3. **Include 'code' field** - Every object MUST have a `code` or `dvd_id` field
4. **No empty values** - Remove null values, empty strings, empty arrays
5. **No empty arrays** - If no results, return `[{ "code": "XXX" }]`
6. **Use stderr for logs** - All human-readable messages go to stderr

### Logging (stderr)

All debug messages, progress updates, and human-readable output MUST go to stderr:

```javascript
console.error('[MyScraper] Starting scrape...');  // ✅ Good
console.log('[MyScraper] Starting scrape...');    // ❌ Bad - pollutes stdout
```

### Error Handling

If your scraper encounters an error:

1. Log the error to stderr
2. Output minimal JSON with just the code
3. Exit with code 1

```javascript
try {
  const results = await scrape(codes);
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(`[Error] ${error.message}`);
  console.log(JSON.stringify(codes.map(code => ({ code })), null, 2));
  process.exit(1);
}
```

## Directory Structure

Create your scraper in the `scrapers/` directory:

```
scrapers/
└── myscraper/           # Your scraper name (lowercase, no spaces)
    ├── run.js          # Entry point (REQUIRED)
    ├── scrape.js       # Main scraping logic
    ├── browser.js      # Browser automation (if needed)
    └── package.json    # Dependencies (optional)
```

## Minimal Implementation

### Step 1: Create Directory

```bash
mkdir scrapers/myscraper
cd scrapers/myscraper
```

### Step 2: Implement run.js

This is the ONLY required file. Example:

```javascript
#!/usr/bin/env node

/**
 * CLI entrypoint for myscraper
 * Usage: node run.js <CODE> [CODE2] [CODE3] ...
 */

const { scrape } = require('./scrape');

async function main() {
  const codes = process.argv.slice(2);

  if (codes.length === 0) {
    console.error('Usage: node run.js <CODE> [CODE2] ...');
    process.exit(1);
  }

  try {
    const results = await scrape(codes);

    // Output ONLY valid JSON to stdout
    console.log(JSON.stringify(results, null, 2));

  } catch (error) {
    console.error(`[Error] ${error.message}`);
    // On error, output minimal JSON array
    console.log(JSON.stringify(codes.map(code => ({ code })), null, 2));
    process.exit(1);
  }
}

main();
```

### Step 3: Implement scrape.js

Example skeleton:

```javascript
async function scrape(codes) {
  console.error(`[MyScraper] Scraping ${codes.length} code(s)`);

  const results = [];

  for (const code of codes) {
    console.error(`[MyScraper] Processing: ${code}`);

    try {
      // Your scraping logic here
      const data = await scrapeSingleCode(code);

      // Only add if we got data
      if (data && Object.keys(data).length > 1) {
        results.push(cleanData(data));
      } else {
        results.push({ code });
      }

    } catch (error) {
      console.error(`[MyScraper] Failed to scrape ${code}: ${error.message}`);
      results.push({ code });
    }
  }

  return results;
}

async function scrapeSingleCode(code) {
  // Your implementation here
  // Example: fetch from API, scrape HTML, etc.

  return {
    code: code,
    title: "Example Title",
    description: "Example description"
  };
}

function cleanData(obj) {
  // Remove null, undefined, empty strings, empty arrays
  const cleaned = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;

    // Recursively clean objects
    if (typeof value === 'object' && !Array.isArray(value)) {
      const cleanedNested = cleanData(value);
      if (Object.keys(cleanedNested).length > 0) {
        cleaned[key] = cleanedNested;
      }
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

module.exports = { scrape };
```

## Field Naming Conventions

Use these standard field names when possible:

```javascript
{
  "code": "SDDM-943",              // Required
  "dvd_id": "SDDM-943",            // Alternative to 'code'
  "content_id": "sddm00943",       // Alternative ID format
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
  "genres": ["Genre1", "Genre2"],  // Array of strings
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

## Testing Your Scraper

### Test Standalone

```bash
cd scrapers/myscraper
node run.js TEST-001
```

**Check:**
- ✅ Only JSON on stdout
- ✅ Logs/messages on stderr
- ✅ Valid JSON array format
- ✅ Contains 'code' field
- ✅ No null values
- ✅ No empty arrays

### Test with ScraperManager

1. Add your scraper to config.json:

```json
{
  "scrapers": ["myscraper"]
}
```

2. Run ScraperManager:

```bash
node scraperManager.js TEST-001
```

## Enable Your Scraper

### Step 1: Add to Enabled List

Edit `config.json`:

```json
{
  "scrapers": ["javlibrary", "r18dev", "myscraper"]
}
```

Position in the array = default priority (first = highest)

### Step 2: (Optional) Set Field Priorities

If you want your scraper to have priority for specific fields:

```json
{
  "scrapers": ["javlibrary", "r18dev", "myscraper"],
  "fieldPriorities": {
    "title": ["myscraper", "r18dev", "javlibrary"],
    "coverUrl": ["myscraper", "javlibrary", "r18dev"]
  }
}
```

This means:
- For `title`: prefer myscraper, fallback to r18dev, then javlibrary
- For `coverUrl`: prefer myscraper, fallback to javlibrary, then r18dev
- For all other fields: use global order (javlibrary → r18dev → myscraper)

## Interactive Scrapers (Cloudflare, CAPTCHA, etc.)

If your scraper requires human intervention:

1. **Use stderr for prompts**:
```javascript
console.error('========================================');
console.error('Please solve the CAPTCHA in the browser');
console.error('Press ENTER when ready');
console.error('========================================');
```

2. **Wait for user input**:
```javascript
await new Promise((resolve) => {
  process.stdin.once('data', () => {
    process.stdin.pause();
    resolve();
  });
});
```

3. **ScraperManager will handle it** - It inherits stdin automatically

## Complete Example: Simple HTTP Scraper

```javascript
// scrapers/example/run.js
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
    const url = `https://api.example.com/video/${code}`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => data += chunk);

      res.on('end', () => {
        if (res.statusCode === 200) {
          const json = JSON.parse(data);
          resolve({
            code: code,
            title: json.title,
            description: json.description,
            releaseDate: json.release_date
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

## Checklist for New Scrapers

Before submitting/using your scraper:

- [ ] Created `scrapers/yourname/run.js`
- [ ] Accepts codes as CLI arguments
- [ ] Outputs ONLY JSON to stdout
- [ ] Outputs logs to stderr
- [ ] Returns array format
- [ ] Includes 'code' or 'dvd_id' field
- [ ] Removes null/empty values
- [ ] Handles errors gracefully
- [ ] Returns `[{ "code": "XXX" }]` on failure
- [ ] Tested standalone: `node run.js TEST-001`
- [ ] Tested with ScraperManager
- [ ] Added to config.json scrapers list
- [ ] (Optional) Set field priorities in config.json

## Common Mistakes to Avoid

❌ **Don't write to stdout except for final JSON**
```javascript
console.log('Starting scrape...');  // BAD - breaks JSON parsing
```

❌ **Don't return objects directly, always use arrays**
```javascript
return { code: "XXX" };  // BAD
return [{ code: "XXX" }]; // GOOD
```

❌ **Don't include empty values**
```javascript
{ title: "", genres: [], rating: null }  // BAD
```

❌ **Don't hardcode scraper names in your code**
```javascript
if (scraper === 'javlibrary') { ... }  // BAD - ScraperManager handles this
```

❌ **Don't try to merge data from other scrapers**
```javascript
// BAD - ScraperManager does this
const otherData = require('../otherscraper/scrape');
```

## Summary

To add a new scraper:

1. Create `scrapers/yourname/run.js`
2. Follow the input/output contract
3. Add `"yourname"` to `config.json` → `scrapers` array
4. Done! No ScraperManager changes needed

The ScraperManager will automatically:
- Discover your scraper by name
- Execute it with the correct arguments
- Capture and parse its JSON output
- Merge results according to priority rules
