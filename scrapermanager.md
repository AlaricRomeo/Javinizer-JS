You are writing code for the project "javinizer-js".

Context (DO NOT IGNORE):
- We already have multiple standalone scrapers.
- Each scraper is an independent CLI app.
- Each scraper is executed like:
  node run.js ID-001 ID-002 ID-003
- Each scraper outputs ONLY valid JSON to stdout.
- The JSON:
  - contains ONLY non-empty fields
  - contains NO null values
  - contains NO empty arrays
- If a scraper finds nothing for a code, it outputs:
  [{ "code": "ID-XXX" }]
- Scrapers NEVER merge data.
- Scrapers NEVER write XML.
- Scrapers NEVER know about other scrapers.
- Some scrapers are interactive (Cloudflare / human intervention).
- Some scrapers are fully automatic.

Your task:
Implement a **ScraperManager** for VIDEO scraping only.

The ScraperManager must:
- NOT scrape anything itself
- NOT parse HTML
- NOT know site-specific logic
- ONLY orchestrate scrapers and merge their JSON outputs

Architecture rules (STRICT):
1) The ScraperManager reads a config file (config.json)
2) The ScraperManager NEVER hardcodes scraper names or paths
3) The ScraperManager NEVER decides priorities by itself
4) ALL decisions come from config.json

IMPORTANT CONFIG BEHAVIOR (NEW, MUST FOLLOW):
- config.json contains a list of ENABLED scrapers
- ONLY scrapers present in this list must be executed
- Any scraper NOT listed must be completely ignored
- The order of scrapers in this list defines the DEFAULT priority order

Config responsibilities:
- Define the list of enabled scrapers (ordered)
- Define field-level priority overrides (optional)
- Define behavior on failure (continue / stop)

Priority rules (VERY IMPORTANT):
- Priority is evaluated per field
- If a field HAS an explicit priority list in config:
  - use that order
- If a field DOES NOT have an explicit priority list:
  - use the global scraper order defined in the enabled scrapers list
- The ScraperManager must NEVER invent priorities

ScraperManager responsibilities:
- Receive a list of DVD-IDs as input
- Execute ONLY enabled scrapers, in the configured order
- Execute scrapers sequentially (no parallelism)
- Capture stdout JSON from each scraper
- Ignore stderr (used only for human logs)
- Collect all scraper outputs per DVD-ID
- Merge outputs ONLY AFTER all scrapers have completed

Merge rules (STRICT):
- No field is mergeable
- Each field is atomic
- If multiple scrapers provide the same field:
  - select the value based on priority rules
- If a scraper does not provide a field:
  - treat it as "not provided"
- NEVER generate empty fields
- NEVER invent data
- NEVER normalize values

Failure rules:
- If a scraper returns only `{ code }` for an ID:
  - treat it as "no data from this scraper"
- If all scrapers return only `{ code }`:
  - final output for that ID is `{ code }`
- Do NOT retry scrapers
- Do NOT crash on partial failures

Output:
- Final output must be valid JSON
- One object per DVD-ID
- Only fields that survived merge
- NO empty fields
- NO nulls
- NO arrays if empty

Technical constraints:
- Node.js
- Use child_process to execute scrapers
- No external frameworks
- Keep the code readable and boring
- Prefer clarity over cleverness
- Add comments explaining WHAT is happening, not WHY

Deliverables:
- scraperManager.js
- Example config.json demonstrating:
  - enabled scraper list (ordered)
  - at least one field with explicit priority
  - fallback to default scraper order for other fields
- No UI code
- No WebUI logic

IMPORTANT:
Do NOT add features that were not requested.
Do NOT invent abstractions.
Do NOT optimize prematurely.

This ScraperManager must be dumb, explicit, and predictable.
