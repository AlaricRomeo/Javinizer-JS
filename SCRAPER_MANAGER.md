# ScraperManager

ScraperManager is a simple orchestrator that executes multiple video scrapers and merges their JSON outputs according to configuration rules.

## What it does

- Reads `config.json` to determine which scrapers to run
- Executes ONLY enabled scrapers in the specified order
- Captures JSON output from each scraper's stdout
- Merges results based on priority rules
- Outputs final merged JSON to stdout

## What it does NOT do

- Does NOT scrape websites itself
- Does NOT parse HTML
- Does NOT know site-specific logic
- Does NOT retry failed scrapers
- Does NOT run scrapers in parallel
- Does NOT invent or normalize data

## Usage

```bash
node scraperManager.js <CODE> [CODE2] [CODE3] ...
```

### Examples

```bash
# Scrape a single code
node scraperManager.js SDDM-943

# Scrape multiple codes
node scraperManager.js SDDM-943 JUR-618 ABC-123
```

## Configuration

All behavior is controlled by `config.json`:

### Enabled Scrapers

The `scrapers` array defines which scrapers to execute and their default priority order:

```json
{
  "scrapers": [
    "javlibrary",
    "r18dev"
  ]
}
```

- Only scrapers listed here will be executed
- Order matters: first scraper = highest priority
- If a scraper is not in this list, it will be completely ignored

### Field Priority Overrides (Optional)

You can override the priority for specific fields using `fieldPriorities`:

```json
{
  "scrapers": ["javlibrary", "r18dev"],
  "fieldPriorities": {
    "title": ["r18dev", "javlibrary"],
    "description": ["javlibrary", "r18dev"]
  }
}
```

This means:
- For the `title` field: prefer r18dev, fallback to javlibrary
- For the `description` field: prefer javlibrary, fallback to r18dev
- For all other fields: use the global `scrapers` order

## How Merging Works

### Priority Rules

For each field in the final output:

1. Check if the field has an explicit priority list in `fieldPriorities`
2. If yes, use that priority order
3. If no, use the global `scrapers` order
4. Select the first non-empty value from the highest priority scraper

### Merge Algorithm

```
For each DVD code:
  For each field:
    Get priority order (explicit or default)
    For each scraper in priority order:
      If scraper provided this field:
        If value is not empty/null:
          Use this value
          Stop searching
```

### Empty Value Rules

A value is considered empty if:
- It is `null`
- It is an empty string `""`
- It is an empty array `[]`

Empty values are NEVER included in the final output.

### Failure Handling

If a scraper:
- Exits with non-zero code → treat as "no data"
- Returns only `{ "code": "XXX" }` → treat as "no data"
- Fails to parse JSON → treat as "no data"

If ALL scrapers fail for a code:
- Output: `{ "code": "XXX" }`

## Example

### Input

```bash
node scraperManager.js SDDM-943
```

### Config

```json
{
  "scrapers": ["javlibrary", "r18dev"],
  "fieldPriorities": {
    "title": ["r18dev", "javlibrary"]
  }
}
```

### Scraper Outputs

**javlibrary**:
```json
[{
  "code": "SDDM-943",
  "title": "Title from JavLibrary",
  "description": "Description from JavLibrary",
  "genres": ["Drama", "Romance"]
}]
```

**r18dev**:
```json
[{
  "code": "SDDM-943",
  "title": "Title from R18",
  "coverUrl": "https://r18.dev/cover.jpg"
}]
```

### Final Output

```json
[{
  "code": "SDDM-943",
  "title": "Title from R18",
  "description": "Description from JavLibrary",
  "genres": ["Drama", "Romance"],
  "coverUrl": "https://r18.dev/cover.jpg"
}]
```

**Why?**
- `title`: r18dev has priority (from `fieldPriorities`)
- `description`: only javlibrary provides it
- `genres`: only javlibrary provides it
- `coverUrl`: only r18dev provides it

## Technical Details

### Process Model

- Scrapers are executed sequentially (one at a time)
- Each scraper receives all codes at once
- ScraperManager waits for each scraper to complete
- stderr from scrapers is passed through (for human logs)
- stdout from scrapers is captured (for JSON parsing)

### Interactive Scraper Support

**IMPORTANT:** ScraperManager fully supports interactive scrapers.

Interactive scrapers can:
- Open real browsers (e.g., Puppeteer)
- Display instructions to the user via stderr
- Wait for user input via stdin (e.g., "press ENTER to continue")
- Require human intervention (e.g., solving CAPTCHA, Cloudflare challenges)

ScraperManager handles this by:
- **Inheriting stdin** from the parent terminal
- **Never closing or overriding stdin**
- **Waiting indefinitely** (no timeouts)
- **Passing through stderr** so user sees instructions
- **Only capturing stdout** for JSON parsing

Example flow with interactive scraper:

```
[ScraperManager] Executing scraper: javlibrary
[Browser] Opening browser...
[Browser] ========================================
[Browser] Please solve the Cloudflare challenge
[Browser] Press ENTER when ready
[Browser] ========================================
<user presses ENTER in terminal>
[Browser] Continuing...
<scraper completes and outputs JSON>
[ScraperManager] Scraper javlibrary completed successfully
```

This works because stdin is inherited from your terminal.

### Error Handling

- ScraperManager does NOT crash on partial failures
- If one scraper fails, others continue
- Final output includes all successfully merged data
- Codes with no data get `{ "code": "XXX" }`

### File Structure

```
javinizer-js/
├── config.json              # Main configuration
├── config-example.json      # Example with field priorities
├── scraperManager.js        # This file
└── scrapers/
    ├── javlibrary/
    │   └── run.js
    └── r18dev/
        └── run.js
```

## Limitations

- No parallel execution (scrapers run sequentially)
- No retry logic
- No timeout handling
- No partial result caching
- No progress reporting (except stderr logs)

These limitations are intentional to keep the code simple and predictable.
