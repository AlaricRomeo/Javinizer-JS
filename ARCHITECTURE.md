# Javinizer-js Architecture

## Overview

Javinizer-js uses a **plugin-based architecture** where scrapers are independent, discoverable modules that follow a simple contract.

## Core Principle: Zero Coupling

The ScraperManager **never** needs to be modified when adding new scrapers.

```
New Scraper = New Directory + Config Update
```

**NOT:**
```
New Scraper = Code Changes + Config Update
```

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                      ScraperManager                         │
│  - Reads config.json                                        │
│  - Executes scrapers by name                                │
│  - Captures JSON from stdout                                │
│  - Merges results by priority                               │
│  - NO hardcoded scraper knowledge                           │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │
                          │ Discovers scrapers by name
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                       config.json                            │
│  {                                                           │
│    "scrapers": ["javlibrary", "r18dev", "newscraper"],     │
│    "fieldPriorities": { ... }                               │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Names map to directories
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    scrapers/ directory                       │
│                                                              │
│  ├── javlibrary/                                            │
│  │   └── run.js  ← Independent CLI app                     │
│  │                                                          │
│  ├── r18dev/                                                │
│  │   └── run.js  ← Independent CLI app                     │
│  │                                                          │
│  └── newscraper/                                            │
│      └── run.js  ← Independent CLI app                     │
│                                                              │
│  Each scraper:                                              │
│  - Knows nothing about other scrapers                       │
│  - Outputs ONLY JSON to stdout                              │
│  - Follows the same contract                                │
└─────────────────────────────────────────────────────────────┘
```

## The Contract

Every scraper is a CLI application that follows this interface:

### Input
```bash
node scrapers/{name}/run.js CODE1 CODE2 CODE3
```

### Output (stdout)
```json
[
  {
    "code": "CODE1",
    "title": "Title",
    ...
  }
]
```

### Logging (stderr)
```javascript
console.error('[Scraper] Log messages here');
```

## Discovery Mechanism

1. ScraperManager reads `config.json`
2. Gets list of enabled scrapers: `["javlibrary", "r18dev"]`
3. For each name, constructs path: `scrapers/{name}/run.js`
4. Executes scraper if path exists
5. Captures stdout as JSON

**No registry, no imports, no hardcoded names.**

## Data Flow

```
Input Codes: ["SDDM-943", "JUR-618"]
                    │
                    ▼
         ┌──────────────────────┐
         │  ScraperManager      │
         │  reads config.json   │
         └──────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌──────────────┐        ┌──────────────┐
│  javlibrary  │        │    r18dev    │
│  run.js      │        │    run.js    │
└──────────────┘        └──────────────┘
        │                       │
        │ JSON array            │ JSON array
        │ to stdout             │ to stdout
        │                       │
        └───────────┬───────────┘
                    ▼
         ┌──────────────────────┐
         │  ScraperManager      │
         │  parses JSON         │
         │  merges by priority  │
         └──────────────────────┘
                    │
                    ▼
         Final merged JSON array
```

## Priority System

### Default Priority

Order in `scrapers` array = priority:

```json
{
  "scrapers": ["javlibrary", "r18dev", "newscraper"]
}
```

- javlibrary = 1st (highest)
- r18dev = 2nd
- newscraper = 3rd (lowest)

### Field-Specific Priority

Override for specific fields:

```json
{
  "scrapers": ["javlibrary", "r18dev", "newscraper"],
  "fieldPriorities": {
    "title": ["newscraper", "r18dev", "javlibrary"],
    "coverUrl": ["r18dev", "javlibrary", "newscraper"]
  }
}
```

**Evaluation:**
- For `title`: newscraper > r18dev > javlibrary
- For `coverUrl`: r18dev > javlibrary > newscraper
- For all other fields: javlibrary > r18dev > newscraper (default)

### Merge Algorithm

```javascript
for each field in final output:
  priority = fieldPriorities[field] || defaultScraperOrder

  for each scraper in priority order:
    if scraper has this field AND value is not empty:
      use this value
      break  // stop searching
```

**Result:** First non-empty value from highest priority scraper wins.

## Why This Architecture?

### ✅ Advantages

1. **Zero coupling** - ScraperManager never changes
2. **Easy to add scrapers** - Just create directory + update config
3. **Independent development** - Each scraper is isolated
4. **Easy testing** - Test scrapers standalone
5. **Simple debugging** - Each scraper is a separate process
6. **Flexible prioritization** - Config-driven, per-field control
7. **Gradual migration** - Add/remove scrapers without breaking others

### ❌ Disadvantages (Intentional Trade-offs)

1. **No parallel execution** - Sequential only (keeps it simple)
2. **No shared code** - Each scraper is independent (OK for our use case)
3. **Process overhead** - Spawn processes for each scraper (acceptable cost)
4. **No retry logic** - Fail fast (keeps it predictable)

## File Structure

```
javinizer-js/
│
├── config.json                    # Configuration (scrapers list, priorities)
├── scraperManager.js              # Orchestrator (no scraper knowledge)
│
├── scrapers/                      # Scraper plugins directory
│   ├── _template/                 # Copy this to create new scrapers
│   │   ├── run.js                # Template entry point
│   │   ├── scrape.js             # Template logic
│   │   └── README.md             # Template usage guide
│   │
│   ├── javlibrary/               # Scraper: javlibrary.com
│   │   ├── run.js                # Entry point
│   │   ├── scrape.js             # Main logic
│   │   ├── browser.js            # Puppeteer automation
│   │   └── parse.js              # HTML parsing
│   │
│   ├── r18dev/                   # Scraper: r18.dev
│   │   ├── run.js                # Entry point
│   │   ├── scrape.js             # Main logic
│   │   └── browser.js            # Puppeteer automation
│   │
│   └── README.md                 # Scrapers overview
│
├── SCRAPER_MANAGER.md            # ScraperManager documentation
├── SCRAPER_IMPLEMENTATION_GUIDE.md  # How to create scrapers
└── ARCHITECTURE.md               # This file
```

## Adding a New Scraper (Step by Step)

### 1. Create Scraper Directory

```bash
cp -r scrapers/_template scrapers/mynewscraper
cd scrapers/mynewscraper
```

### 2. Implement Scraping Logic

Edit `scrape.js` and implement `scrapeSingleCode()` function:

```javascript
async function scrapeSingleCode(code) {
  // Your implementation here
  return {
    code: code,
    title: "Title from my source",
    description: "Description"
  };
}
```

### 3. Test Standalone

```bash
node run.js TEST-001
```

Verify:
- ✅ Only JSON on stdout
- ✅ Logs on stderr
- ✅ Valid JSON array format

### 4. Enable in Config

Edit `config.json`:

```json
{
  "scrapers": ["javlibrary", "r18dev", "mynewscraper"]
}
```

### 5. Test with ScraperManager

```bash
node scraperManager.js TEST-001
```

### 6. (Optional) Set Field Priorities

```json
{
  "scrapers": ["javlibrary", "r18dev", "mynewscraper"],
  "fieldPriorities": {
    "title": ["mynewscraper", "r18dev", "javlibrary"]
  }
}
```

**Done!** No ScraperManager modifications needed.

## Design Philosophy

### Keep It Boring

- No abstractions
- No clever tricks
- No magic
- Just simple process execution and JSON parsing

### Keep It Explicit

- Config-driven behavior
- No hidden logic
- Predictable execution order
- Clear error handling

### Keep It Extensible

- Add scrapers without code changes
- Change priorities without code changes
- Enable/disable scrapers in config
- Each scraper is independent

## Common Questions

### Q: Can I add a scraper without modifying any code?

**A:** Yes! Just create `scrapers/yourname/run.js` and add `"yourname"` to config.json.

### Q: Do I need to update ScraperManager when I add a scraper?

**A:** No. ScraperManager discovers scrapers by name from config.json.

### Q: Can scrapers share code?

**A:** No. Each scraper is independent. This is intentional to avoid coupling.

### Q: Can I run scrapers in parallel?

**A:** No. ScraperManager runs them sequentially. This keeps it simple and predictable.

### Q: What if I want different priorities for different fields?

**A:** Use `fieldPriorities` in config.json. You can set per-field priority overrides.

### Q: Can I have multiple scrapers with the same name?

**A:** No. Scraper names must be unique (they map to directory names).

### Q: What happens if a scraper fails?

**A:** ScraperManager continues with other scrapers. Failed scrapers return `{ code }`.

## Summary

The architecture is intentionally simple:

1. Scrapers are independent CLI apps
2. ScraperManager discovers them by name
3. Config.json controls which run and their priority
4. No coupling, no hardcoded knowledge
5. Add new scrapers by creating directories

**Philosophy:** Boring, explicit, extensible.
