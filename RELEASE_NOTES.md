# Release Notes

## v1.8.0 (2026-08-18)

### 🔍 Library search-as-filter

- The navbar search (edit mode) can now either jump to a single result (click on it, or Enter — unchanged) or, via the new "Filter results (N)" option, constrain Next/Previous navigation to only the matching movies
- Matches on ID, title, actor name and genre (partial, case-insensitive)
- A filter badge shows the active query and result count, with a one-click clear
- No new dependency: reuses the existing in-memory search index, extended with actor/genre extraction

### 🎭 Local actor scraper: library fallback + richer "Copy actors to movie folder"

- New third fallback tier for the `local` actor scraper: when preferiti (`externalPath`) and cache both miss, and "Copy actors to movie folder" is enabled, it now also searches every library movie folder's `actors/` subfolder
- `copyActorsToFolder` now writes a full actor `.nfo` (javinizer-js's own actor schema, not Kodi's movie-actor tag) alongside the photo, so this fallback can recover complete actor data even after a cache reset — not just a name
- Correctly bypassed when "Overwrite local data" is checked in the actor modal: the library-folder scan is skipped there so a stale photo can't be self-healed back into the cache while the user is deliberately forcing a fresh remote fetch

### 🖼️ Actor photo serving fixes

- `/actors/*` now searches `externalPath` (preferiti) fully — exact name, then any known extension — before falling back to the internal cache, instead of mixing the two per-extension
- Actor thumbnail resolution self-heals when the cached file's extension no longer matches (e.g. after a re-upload) by locating the actual file for that actor ID instead of falling back to the remote URL

### 🎬 New scrapers

- **XCITY** (actor scraper, `xxx.xcity.jp`) replaces `xslist-fs` — same data (name, birthdate, height, measurements, photo), no FlareSolverr/Cloudflare workaround needed (plain `fetch` + `cheerio`)
- **LibreDMM** (movie scraper, `libredmm.com`) — new JSON API-based source

### 🔠 ID field always uppercase

- The ID field in edit/scrape mode now normalizes to uppercase on load and as you type

### ⛔ Cancel scraping button

- The scraping modal now has a Cancel button while a scrape is in progress — closes the WebSocket and hides the modal immediately, instead of only being dismissible after completion

### 🌐 Configurable browser path

- New "Browser path" field in Config → General Settings, with a folder/file browser, for pointing Puppeteer at a specific Chromium/Chrome binary
- Takes priority over the `PUPPETEER_EXECUTABLE_PATH` env var

### 🏷️ Leaked / Decensored / Uncensored badges

- Movies tagged with these genres now show a small badge overlay on the cover, in both grid view and the edit-mode detail panel
- Fixed a collateral bug in `/scrape-list` and `/library-list` that read the wrong field name (`genre` instead of `genres`), which had also been silently breaking the existing genre tags

### 📁 "Open folder" button (edit mode)

- New button next to Play opens the movie's folder in the OS file manager
- Path is validated to be inside the configured library path before opening

### 🎭 Actor modal unification

- Single actor modal implementation shared between the home/scrape view and the actors (preferiti) page, replacing two divergent code paths
- Uploading a new actor photo now soft-deletes the previous one (moved to `old-pics/`) instead of leaving orphaned files behind

---

## v1.7.0 (2026-05-29)

### 🔄 Edit Mode Re-scrape

- New re-scrape capability in edit/library mode: re-scrape any title already in your library using a specific scraper of your choice
- Scraped data is loaded into the form for review — nothing is written until you click Save
- Navigating away or switching mode discards the temporary data (existing dirty-field confirmation dialog)
- Actor scraping runs automatically during edit-mode re-scrape if enabled in config
- Auto copy actors to movie folder on save when `copyToMovieFolder` is enabled (works in both scrape and edit mode)

### 🖥️ UI Rationalization

- Unified scraper panel: single panel works in both modes
- In edit mode, scrape-only controls (Scrape Now, Clear Cache, Delete) are hidden automatically
- Removed duplicate re-scrape dropdown that appeared only in edit mode

---

## v0.9.6 (2026-04-01)

### 🎭 New Actor Scraper: xslist-fs

- New scraper `xslist-fs` for [xslist.org](https://xslist.org/en)
- Extracts: English name, Japanese altName, birthdate, bust/waist/hips, photo
- Uses FlareSolverr to bypass Cloudflare protection
- Requires `FLARESOLVERR_URL` env variable (default: `http://localhost:8191`)
- Enable via config: add `xslist-fs` to actor scrapers list (e.g. `local, xslist-fs, javdb`)

### 📝 NFO title-case formatting

- Genres, tags (movie NFO) now written with initial capitals on each word (ucFirst)
- Actor `name` and `altName` now written with initial capitals in actor NFO

### 📖 Documentation

- Scrapers with names ending in `-fs` require FlareSolverr — documented in `scrapers/actors/README.md`

---

## v0.9.5 (2026-03-29)

### 🎭 Actor System — Major Overhaul

#### Index-free actor lookup
- Removed `actors-index.json` entirely from both `data/actors/` and `externalPath`
- All actor lookups now scan `.nfo` files directly — simpler and always accurate
- Removed "Rebuild Actors Index" button (no longer needed)
- `actorIndexManager.js` is now unused (kept for reference, not called)

#### Smarter local scraper (`scrapers/actors/local/run.js`)
- Searches `externalPath` first, then `data/actors` as fallback
- Fixed `matchesActor`: now correctly tries both `actor.name` and `invertName(actor.name)` plus all altnames and their inverted forms — previously only inverted the search term, not the stored name
- `searchInDirectory` exported for reuse

#### Actor scraping flow improvements
- Batch scrape (`processSingleMovieActors`, `processMultipleMoviesActors`, `batchScrapeActors`): now checks local NFOs (including externalPath) before going online
- If local data is complete → skip online scrapers entirely
- If local data is incomplete → continue online but only fill missing fields (local values preserved)
- `scrapeActor`: pre-loads all known name variants (name + altnames) from local NFO before running online scrapers, so javdb etc. try all name forms
- `resolveActorThumb`: local file (`thumbLocal`) now takes priority over online URL (`thumbUrl`)

#### Save to library fixes
- `POST /actors/save-to-library`: now searches `data/actors` only (not externalPath) when looking up the cached actor to copy
- Duplicate check now scans externalPath NFOs for both `name` and all `altName` values of the incoming actor
- Fixed stale closure bug: "+" button on actor cards now reads `currentItem.actor[index]` at click time instead of capturing the object reference at render time

#### Config: "Copy actors to movie folder"
- New checkbox in configuration page under Actor Scrapers section
- When enabled, actor thumbnails are automatically copied to `<movie_folder>/actors/` on every movie save
- i18n keys added: `config.copyActorsToMovieFolder`, `config.copyActorsToMovieFolderHelp`

#### "Clear Scrapers Cache"
- Already cleared `data/actors/` — confirmed working

---

## v0.9.0 Beta (2024-12-28)

### 🎉 First Beta Release

Javinizer-js is now ready for beta testing! This release includes a complete rewrite with modern architecture, comprehensive internationalization, and a powerful plugin-based scraping system.

### ✨ Major Features

#### Multi-language Support
- 🇬🇧 **English** - Complete interface translation
- 🇮🇹 **Italiano** - Full Italian translation
- 🇯🇵 **日本語** - Complete Japanese translation
- Language selector in navigation bar for instant switching
- Extensible i18n system with 150+ translation keys
- Support for template variables in translations ({name}, {count})

#### Actor Management System
- **Dedicated Actors Page** - Manage your actor library separately
- **Actor Cards** - Grid-based layout with thumbnails and metadata
- **Search & Scrape** - Built-in actor search with online scraping
- **Data Caching** - Local cache for faster access and offline support
- **External Path Support** - Share actor data across multiple instances or with media servers
- **Edit Modal** - Comprehensive actor editing with all metadata fields

#### Scraper System Enhancements
- **Plugin Architecture** - Add new scrapers without modifying core code
- **Actor Scrapers** - Automatic actor data retrieval and caching
  - `local` - Use cached actor data
  - `javdatabase` - Scrape JavDatabase for actor information
- **Per-field Priorities** - Configure which scraper to prefer for specific metadata fields
- **WebSocket Integration** - Real-time scraping progress in the web UI
- **Interactive Protocol** - Handle CAPTCHA, Cloudflare, and user interactions seamlessly

#### Web UI Improvements
- **Modernized Layout** - Consistent styling across all pages (Home, Actors, Configuration)
- **Shared Components** - Unified modal system for actors across pages
- **Modular CSS** - Separate stylesheets for better organization and maintainability
- **Responsive Design** - Works on desktop, tablet, and mobile devices
- **Real-time Updates** - WebSocket-based progress tracking during scraping

#### Deployment & Infrastructure
- 🐳 **Docker Ready** - Pre-configured Dockerfile with Chromium support
- 📦 **docker-compose.yml** - Easy deployment with volume mounting
- 🏥 **Health Checks** - Built-in health monitoring for containers
- 🔧 **Simple Configuration** - Single JSON file for all settings
- 📊 **Resource Limits** - Optimized memory and CPU usage

### 🔧 Technical Improvements

#### Architecture
- **Modular CSS** - actors.css, modal.css for separate concerns
- **Shared Modal Component** - actor-modal.html loaded dynamically
- **Event-Driven System** - Custom events for component coordination
- **Retry Mechanism** - Exponential backoff for network requests
- **Error Boundaries** - Graceful error handling throughout the app

#### Bug Fixes
- Fixed critical bug with dirty field detection (Set vs Object.keys)
- Fixed modal not opening in edit/scrape mode
- Fixed network timing issues on page load/refresh
- Fixed console.error misuse in actorScraperManager (24 instances)
- Fixed null element access in actor modal
- Fixed thumbnail preview not updating correctly
- Fixed navbar positioning on actors page

#### Code Quality
- Removed duplicate functions and redundant code
- Cleaned up debug console.log statements (12+ instances)
- Removed unused variables and imports
- Improved error messages and logging
- Standardized code formatting

### 📚 Documentation

#### New Documentation
- **SCRAPER_DEVELOPMENT.md** - Quick start guide for creating scrapers
- **Updated README.md** - Comprehensive beta release documentation
- **Docker Documentation** - Deployment guides and resource requirements
- **API Documentation** - Complete endpoint reference
- **Changelog** - Version history in README.md

#### Existing Documentation (Enhanced)
- SCRAPER_IMPLEMENTATION_GUIDE.md - Complete implementation details
- SCRAPER_MANAGER.md - Technical details of the scraper system
- ARCHITECTURE.md - System design and philosophy
- ACTOR_WORKFLOW.md - Actor scraping workflow
- PROJECT_STRUCTURE.md - Codebase organization

### 🔄 Migration Guide

#### From Previous Versions

If you're upgrading from an earlier version:

1. **Update config.json structure**:
```json
{
  "libraryPath": "/path/to/library",
  "mode": "scrape",
  "language": "en",
  "scrapers": {
    "video": ["javlibrary", "r18dev"],
    "actors": {
      "enabled": true,
      "scrapers": ["local", "javdatabase"],
      "externalPath": ""
    }
  },
  "fieldPriorities": {}
}
```

2. **Install new dependencies**:
```bash
npm install
```

3. **Update Docker setup** (if using Docker):
```bash
docker-compose down
docker-compose build
docker-compose up -d
```

### 🎯 Breaking Changes

- **Config structure changed**: `scrapers` is now an object with `video` and `actors` properties
- **Actor data location**: Actors moved from `data/scrape/actors/` to `data/actors/`
- **Language codes**: Use `ja` instead of `jp` for Japanese
- **API changes**: New endpoints for actors (`/actors`, `/actors/search`)

### 📋 Known Issues

- Fanart display not yet implemented (planned for next release)
- Batch operations not available yet (planned)
- Image management UI needs enhancement
- Some scrapers may require CAPTCHA solving manually

### 🚀 Getting Started

#### Quick Start with Docker

```bash
# Clone repository
git clone <repository-url>
cd javinizer-js

# Configure docker-compose.yml
nano docker-compose.yml  # Set your library path

# Start container
docker-compose up -d

# Access web UI
open http://localhost:4004
```

#### Quick Start (Native)

```bash
# Clone repository
git clone <repository-url>
cd javinizer-js

# Install dependencies
npm install

# Configure
cp config.example.json config.json
nano config.json  # Set your library path

# Start server
npm start

# Access web UI
open http://localhost:4004
```

### 🤝 Contributing

We welcome contributions! Areas where help is appreciated:

- **New Scrapers** - Add support for additional JAV sites
- **Translations** - Add new language translations (Korean, Chinese, etc.)
- **Bug Reports** - Report issues via GitHub Issues
- **Feature Requests** - Suggest new features
- **Documentation** - Improve docs and guides

See SCRAPER_DEVELOPMENT.md for creating new scrapers - it's easy!

### 🙏 Acknowledgments

Special thanks to:
- jvlflame for the original [Javinizer](https://github.com/jvlflame/Javinizer) that inspired this project
- All beta testers who provided feedback
- Contributors to the scraper ecosystem

### 📞 Support

- **Issues**: [GitHub Issue Tracker](https://github.com/yourusername/javinizer-js/issues)
- **Documentation**: See README.md and docs folder
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/javinizer-js/discussions)

### 🔮 What's Next?

#### v1.0.0 Roadmap
- Fanart display and management
- Batch operations (multi-select, bulk edit)
- Enhanced image management
- Advanced search and filtering
- API authentication
- Performance optimizations
- Additional scrapers

#### Future Plans
- Plugin marketplace for scrapers
- Custom field mapping
- Export/Import functionality
- Mobile app
- Video player integration
- AI-powered metadata enhancement

---

**Download**: [GitHub Releases](https://github.com/yourusername/javinizer-js/releases/tag/v0.9.0)

**Docker Image**: `docker pull javinizer-js:0.9.0` (coming soon)

**Upgrade**: See Migration Guide above

Thank you for trying Javinizer-js Beta! Please report any issues or feedback.
