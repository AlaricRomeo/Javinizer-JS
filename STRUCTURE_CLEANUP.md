# Project Structure Cleanup

## Summary
Cleaned up project structure by removing empty/unused directories and organizing files coherently.

## Changes Made

### ✅ Removed Directories
- `data/cache/` - Empty, never used
- `data/imports/` - Empty, never used
- `data/results/` - Empty, never used
- `src/scrapers/` - Empty, scrapers are in `/scrapers/` root

### ✅ Updated Files
1. **`.gitignore`**
   - Changed to ignore entire `data/scrape/` and `data/actors/` directories
   - Added exceptions for `.gitkeep` files to preserve empty directories in git

2. **Added `.gitkeep` files**
   - `data/scrape/.gitkeep` - Preserves scrape directory structure
   - `data/actors/.gitkeep` - Preserves actors directory structure

### ✅ Documentation
1. **`PROJECT_STRUCTURE.md`** (NEW)
   - Complete documentation of project organization
   - Explains each directory's purpose
   - Documents file naming conventions
   - Lists removed directories
   - Explains CLI tools

2. **`REFACTOR_PLAN.md`** (NEW)
   - Planning document for the cleanup
   - Rationale for decisions

## Final Structure

```
javinizer-js/
├── bin/               # CLI tools (batch-actors.js)
├── src/              # Source code
│   ├── core/        # Business logic
│   ├── server/      # Express server
│   ├── web/         # Frontend UI
│   └── lang/        # Translations
├── scrapers/        # Scraper plugins
│   ├── movies/      # Movie scrapers
│   └── actors/      # Actor scrapers
└── data/            # Runtime data (gitignored)
    ├── scrape/      # Scraped JSONs
    └── actors/      # Actor cache
```

## Rationale

### Why `/scrapers/` at root?
- Clear separation: code (`src/`) vs plugins (`scrapers/`)
- Scrapers are independent modules that can be added/removed
- Makes it obvious where to add new scrapers

### Why keep `bin/`?
- `batch-actors.js` is a useful standalone CLI tool
- Standard Node.js convention for executable scripts
- Allows `npm link` for global installation if needed

### Why remove empty directories?
- Cleaner repository structure
- Less confusion about where files should go
- Removed temptation to use wrong directories

## Migration Notes

### For Existing Installations
No migration needed! This cleanup:
- ✅ Only removed **empty** directories
- ✅ Did not move any existing code
- ✅ Did not change any import paths
- ✅ All existing functionality intact

### For New Developers
- See `PROJECT_STRUCTURE.md` for complete documentation
- Follow naming conventions documented there
- Data goes in `data/`, code goes in `src/` or `scrapers/`
