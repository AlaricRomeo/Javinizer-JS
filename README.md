# Javinizer-js

> **Version 1.0** - Production-ready metadata management for JAV libraries

A powerful, cross-platform web application for managing JAV (Japanese Adult Video) metadata. Fully compatible with Jellyfin, Plex, and Kodi media servers.

## Features

### Core Functionality
- **Automated Scraping** - Plugin-based scraper system for automatic metadata retrieval from multiple sources
- **Manual Editing** - Full-featured web UI for manual NFO file editing and library management
- **Actor Management** - Dedicated actors page with search, thumbnails, and automatic data caching
- **Web Interface** - Modern, responsive UI with real-time updates via WebSocket
- **NFO Preservation** - Manual edits are preserved and merged with scraped data intelligently
- **Library Browser** - Built-in file system browser for easy library navigation
- **Error Resilience** - Automatic validation and recovery from common library issues

### Multi-language Support
- English - Full interface translation
- Italiano - Complete Italian translation
- 日本語 - Complete Japanese translation
- Extensible - Easy to add new languages via JSON files

### Scraper System
- **Plugin Architecture** - Add new scrapers without modifying core code
- **Priority System** - Configure scraper priority per field for optimal metadata quality
- **Data Merging** - Intelligent merging from multiple sources with conflict resolution
- **Interactive Support** - Handle Cloudflare, CAPTCHA, and other interactive challenges
- **Actor Scraping** - Automatic actor data retrieval with built-in caching
- **Rate Limiting** - Respects source websites with built-in rate limiting (max 80 items per session)

### Cross-Platform Support
- **Windows** - Full support with optimized file handling and browser cleanup
- **Linux** - Automatic package manager detection and Node.js installation
- **macOS** - Native support with all features enabled
- **No Containers** - Runs directly with Node.js for simple deployment

## Intended Use & Fair Use Policy

**Javinizer-js is designed exclusively for personal, home use.**

This software helps individuals manage metadata for their legally-owned media libraries. To ensure responsible use:

- Personal home media library management only
- Rate-limited scraping (max 80 items per session) to respect source websites
- Caching system minimizes redundant requests
- NOT for commercial use
- NOT for bulk/automated scraping operations
- NOT for redistribution of scraped data

By using this software, you agree to:
1. Use it only for organizing your personal media collection
2. Respect the rate limits and caching mechanisms
3. Comply with the terms of service of scraped websites
4. Not use it for any commercial purposes

**This is a personal hobby project.** The author does not endorse or encourage any violation of copyright laws or terms of service of third-party websites.

## Requirements

- **Node.js** 18 or higher
- **Chromium/Chrome** (automatically installed via Puppeteer for browser automation)
- **Disk Space** - Minimal (stores JSON metadata and actor thumbnails only)
- **Memory** - 512MB minimum, 2GB recommended for browser-based scrapers

## Quick Start

### Linux (with start.sh)

```bash
# Clone repository
git clone https://github.com/yourusername/javinizer-js.git
cd javinizer-js

# Run the automatic setup script
./start.sh
```

The `start.sh` script will:
- Detect your Linux distribution automatically
- Install Node.js if not present (using apt, yum, dnf, or pacman)
- Install npm dependencies
- Create config.json from example if needed
- Start the server

### Windows / macOS / Manual Installation

```bash
# Clone repository
git clone https://github.com/yourusername/javinizer-js.git
cd javinizer-js

# Install dependencies
npm install

# Copy example config
cp config.example.json config.json

# Edit config with your library path
# Windows: notepad config.json
# macOS/Linux: nano config.json

# Start server
npm start
```

The web interface will be available at `http://localhost:4004`

## Configuration

Edit `config.json` to customize your setup:

```json
{
  "libraryPath": "/path/to/your/jav/library",
  "language": "en"
}
```

### Configuration Options

- **libraryPath** - Root directory of your JAV library (required)
- **language** - UI language: `en` (English), `it` (Italiano), or `ja` (日本語)

Additional settings can be configured from the web UI settings page:
- Scraper selection and priority
- Actor scraping settings
- Field-level scraper priorities
- External actor cache path (optional)

## Library Structure

Your library should follow this structure for best results:

```
/your/library/
  ├── [ID-001]/
  │   ├── [ID-001].nfo       # Metadata file (required)
  │   └── [ID-001].mp4       # Video file (optional)
  ├── [ID-002]/
  │   ├── [ID-002].nfo
  │   └── [ID-002].mkv
  └── ...
```

**Note:** Video files are optional. If not present, the system will show warnings but continue processing metadata normally.

## NFO Format

NFO files are compatible with Jellyfin, Plex, and Kodi:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>Movie Title</title>
  <originaltitle>Original Title</originaltitle>
  <id>ID-001</id>
  <contentid>id00001</contentid>
  <premiered>2024-01-01</premiered>
  <runtime>120</runtime>
  <director>Director Name</director>
  <studio>Studio Name</studio>
  <label>Label Name</label>
  <genre>Drama</genre>
  <tag>Tag 1</tag>
  <actor>
    <name>Actor Name</name>
    <role>Actress</role>
    <thumb>https://example.com/actor-thumb.jpg</thumb>
  </actor>
  <art>
    <poster>https://example.com/cover.jpg</poster>
    <fanart>https://example.com/fanart.jpg</fanart>
  </art>
</movie>
```

## Available Scrapers

### Video Metadata Scrapers
- **javlibrary** - Scrapes javlibrary.com (interactive, Cloudflare protected)
- **r18dev** - Scrapes r18.dev (automatic, fast)

### Actor Data Scrapers
- **javdatabase** - Scrapes javdatabase.com (automatic, with built-in caching)

## Web Interface

### Main Features

1. **Library Browser** - Navigate through your library items
2. **Metadata Editor** - Edit all NFO fields with live preview
3. **Scraper Integration** - Scrape and save metadata in one workflow
4. **Actor Management** - Dedicated page for managing actor data
5. **Settings** - Configure scrapers, language, and preferences
6. **Real-time Updates** - WebSocket-based progress tracking

### Workflow Modes

The application supports different workflows:

1. **Browse & Edit** - Manually browse and edit existing NFO files
2. **Scrape & Save** - Automatically scrape metadata and save to library
3. **Actor Search** - Find and cache actor information

## Error Handling & Resilience

Version 1.0 includes robust error handling:

- **Automatic NFO Validation** - Invalid NFO elements are automatically detected and removed
- **Missing File Recovery** - Graceful handling of manually deleted folders
- **Warning System** - Non-critical issues (like missing video files) generate warnings instead of errors
- **Browser Cleanup** - Automatic cleanup of Puppeteer browser instances on Windows
- **File Lock Prevention** - Safe file handling to prevent Windows file locking issues

## Adding New Scrapers

Create a new scraper plugin in minutes without modifying core code:

```bash
# 1. Create scraper directory
mkdir scrapers/movies/myscraper

# 2. Create run.js (see SCRAPER_DEVELOPMENT.md for details)
# Your scraper just needs to export a function that returns metadata

# 3. Test your scraper
node scrapers/movies/myscraper/run.js TEST-001

# 4. Enable in web UI settings
# Add "myscraper" to enabled scrapers list

# Done! No core code changes needed
```

See [SCRAPER_DEVELOPMENT.md](SCRAPER_DEVELOPMENT.md) for the complete guide.

## Project Structure

```
javinizer-js/
├── src/
│   ├── core/              # Core business logic
│   │   ├── libraryReader.js      # NFO file reading and validation
│   │   ├── scrapeSaver.js        # Save scraped data to library
│   │   ├── scraperManager.js     # Orchestrate multiple scrapers
│   │   ├── nfoMapper.js          # Map JSON to NFO XML
│   │   └── ...
│   ├── lang/              # i18n translation files
│   │   ├── en.json        # English
│   │   ├── it.json        # Italian
│   │   └── ja.json        # Japanese
│   ├── server/            # Express server
│   │   ├── index.js       # Server entry point
│   │   └── routes.js      # API routes
│   └── web/               # Frontend
│       ├── app.js         # Main page
│       ├── actors.js      # Actors page
│       ├── i18n.js        # Internationalization
│       └── *.html         # UI pages
├── scrapers/              # Scraper plugins
│   ├── movies/
│   │   ├── javlibrary/    # JAVLibrary scraper
│   │   ├── r18dev/        # R18.dev scraper
│   │   └── _template/     # Template for new scrapers
│   └── actors/
│       └── javdatabase/   # Actor scraper
├── data/                  # Runtime data
│   ├── scrape/           # Scraped JSON files (centralized)
│   └── actors/           # Actor cache and thumbnails
├── config.json           # User configuration (gitignored)
├── config.example.json   # Example configuration
├── start.sh              # Linux auto-setup script
└── package.json          # npm configuration
```

## API Endpoints

The application provides a REST API for integration:

### Items
- `GET /item/current` - Get current library item
- `GET /item/next` - Navigate to next item
- `GET /item/prev` - Navigate to previous item
- `POST /item/save` - Save NFO changes
- `DELETE /item/:id` - Delete item from library

### Configuration
- `GET /item/config` - Get current configuration
- `POST /item/config` - Update configuration

### Localization
- `GET /item/lang/:code` - Get translation file (en, it, ja)

### File System
- `GET /item/browse?path=...` - Browse directories

### Actors
- `GET /actors` - List all cached actors
- `POST /actors` - Create/update actor
- `DELETE /actors/:id` - Delete actor
- `POST /actors/search` - Search and scrape actor data

### WebSocket
- Real-time scraping progress updates
- Error notifications
- Status messages

## Development

### Running in Development Mode

```bash
# Install nodemon for auto-restart on changes
npm install

# Run with auto-reload
npm run dev
```

### Adding a New Language

1. Create `src/lang/XX.json` (where XX is the language code)
2. Copy the structure from `en.json` and translate all keys
3. Language will be automatically available in the UI selector

All UI elements use `data-i18n` attributes for automatic translation.

## Contributing

Contributions are welcome! Areas where help is appreciated:

- **New Scrapers** - Add support for additional JAV metadata sources
- **Translations** - Add new language translations
- **Bug Reports** - Report issues via GitHub Issues
- **Feature Requests** - Suggest improvements
- **Documentation** - Improve guides and examples

Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Documentation

- **[SCRAPER_DEVELOPMENT.md](SCRAPER_DEVELOPMENT.md)** - Quick start guide for creating scrapers
- **[SCRAPER_IMPLEMENTATION_GUIDE.md](SCRAPER_IMPLEMENTATION_GUIDE.md)** - Comprehensive scraper implementation guide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System design and philosophy
- **[scrapers/README.md](scrapers/README.md)** - Scrapers overview

## License

MIT License with Additional Fair Use Terms

See [LICENSE](LICENSE) file for details.

**TL;DR**: Free for personal use. Not for commercial use or bulk scraping.

## Credits

Inspired by [Javinizer](https://github.com/jvlflame/Javinizer) by jvlflame.

## Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/yourusername/javinizer-js/issues).

## Changelog

### v1.0.0 (2026-01-03)

**Production Release - Stable and Feature Complete**

**Major Features:**
- Multi-language support (English, Italian, Japanese)
- Complete actor management system with dedicated page
- Actor scraping and caching system
- WebSocket-based real-time scraping progress
- Modern, responsive UI with consistent styling
- Cross-platform support (Windows, Linux, macOS)

**Scraper System:**
- Plugin architecture for easy scraper development
- Per-field priority configuration
- Multiple video scrapers (javlibrary, r18dev)
- Actor scraper with automatic caching (javdatabase)
- Intelligent data merging from multiple sources
- Interactive scraper support for Cloudflare/CAPTCHA

**Stability Improvements:**
- Automatic NFO validation and error recovery
- Graceful handling of missing video files (warnings instead of errors)
- Protection against manual folder deletion errors
- Windows-optimized file handling and browser cleanup
- Robust error handling throughout the application

**Platform Support:**
- Linux auto-setup script with package manager detection
- Windows file locking prevention and browser cleanup
- macOS full compatibility

**Technical:**
- Modular CSS architecture
- Shared UI components for consistency
- Retry mechanisms for better reliability
- Comprehensive error logging and user feedback
- WebSocket connection management

**Documentation:**
- Complete README with quick start guides
- SCRAPER_DEVELOPMENT.md for plugin developers
- Comprehensive implementation guides
- API documentation

---

**Ready for production use.** This release represents a stable, feature-complete version suitable for managing personal JAV libraries.
