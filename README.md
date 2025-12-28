# Javinizer-js

> **Beta Release v0.9.0** - Production-ready metadata management for JAV libraries

A cross-platform, containerized web application for managing JAV (Japanese Adult Video) metadata, compatible with Jellyfin, Plex, and Kodi.

## ✨ Features

### Core Functionality
- 🔍 **Automated Scraping** - Plugin-based scraper system for automatic metadata retrieval
- 📝 **Manual Editing** - Full-featured web UI for editing NFO files
- 👥 **Actor Management** - Dedicated actors page with search, thumbnails, and data caching
- 🌐 **Web Interface** - Modern, responsive UI with real-time updates via WebSocket
- 💾 **NFO Preservation** - PATCH mode preserves custom NFO fields during edits
- 📁 **Library Browser** - Built-in file system browser for library management

### Multi-language Support
- 🇬🇧 **English** - Full interface translation
- 🇮🇹 **Italiano** - Complete Italian translation
- 🇯🇵 **日本語** - Complete Japanese translation
- 🔧 **Extensible** - Easy to add new languages via JSON files

### Scraper System
- 🔌 **Plugin Architecture** - Add new scrapers without modifying core code
- 🎯 **Priority System** - Configure scraper priority per field
- 🔄 **Data Merging** - Intelligent merging from multiple sources
- 🌐 **Interactive Support** - Handle Cloudflare, CAPTCHA, and user interactions
- 📦 **Actor Scraping** - Automatic actor data retrieval and caching

### Deployment
- 🐳 **Docker Ready** - Pre-configured Dockerfile and docker-compose.yml
- 🖥️ **Cross-Platform** - Works on Linux, macOS, Windows (via Docker or native Node.js)
- 📊 **Health Checks** - Built-in health monitoring for containers
- 🔧 **Easy Configuration** - Simple JSON configuration file

## Requirements

- Node.js 18+ (or Docker)
- Chromium/Chrome (for scrapers - included in Docker image)

## Installation

### Docker (Recommended)

```bash
# Clone repository
git clone <repository-url>
cd javinizer-js

# Edit docker-compose.yml to set your library path
nano docker-compose.yml

# Start container
docker-compose up -d

# View logs
docker-compose logs -f
```

The web interface will be available at `http://localhost:4004`

### Local Development

```bash
# Clone repository
git clone <repository-url>
cd javinizer-js

# Install dependencies
npm install

# Copy example config
cp config.example.json config.json

# Edit config with your library path
nano config.json

# Start server
npm start
```

The web interface will be available at `http://localhost:4004`

## Configuration

Edit `config.json`:

```json
{
  "libraryPath": "/path/to/your/jav/library",
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
  "fieldPriorities": {
    "title": ["javlibrary", "r18dev"],
    "description": ["r18dev", "javlibrary"]
  }
}
```

### Configuration Options

- **libraryPath**: Root directory of your JAV library
- **mode**: Operating mode - `scrape` or `edit`
- **language**: UI language - `en`, `it`, or `ja`
- **scrapers.video**: List of enabled video scrapers in priority order
- **scrapers.actors.enabled**: Enable/disable actor scraping
- **scrapers.actors.scrapers**: List of actor scrapers in priority order
- **scrapers.actors.externalPath**: Optional external path for actor thumbnails (for sharing across instances)
- **fieldPriorities**: Override scraper priority for specific metadata fields

### Supported Languages

- `en` - English
- `it` - Italiano
- `ja` - 日本語 (Japanese)

Language can be changed from the web UI or in config.json.

## Library Structure

Expected directory structure:

```
/your/library/
  ├── [ID-001]/
  │   ├── [ID-001].nfo
  │   └── [ID-001].mp4 (optional)
  ├── [ID-002]/
  │   └── [ID-002].nfo
  └── ...
```

## NFO Format

Compatible with Jellyfin/Plex/Kodi NFO format:

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

## ScraperManager

Javinizer-js includes a powerful, modular scraping system for automatic metadata retrieval.

### Quick Start

```bash
# Scrape all files in your library
node src/core/scraperManager.js

# Scrape specific codes
node src/core/scraperManager.js SDDM-943 JUR-618
```

The ScraperManager will:
1. Read all files from your `libraryPath` (or process specified codes)
2. Extract DVD codes from filenames
3. Execute enabled scrapers in parallel
4. Merge results based on priority rules
5. Save merged JSON files to `data/scrape/{code}.json`

### Available Scrapers

**Video Scrapers:**
- **javlibrary** - Scrapes javlibrary.com (interactive, Cloudflare protected)
- **r18dev** - Scrapes r18.dev (automatic)
- **javdb** - Scrapes javdb.com (automatic)

**Actor Scrapers:**
- **local** - Uses cached actor data from previous scrapes
- **javdatabase** - Scrapes JavDatabase for actor information

### Web UI Integration

The web UI includes integrated scraping:
- **Scrape Mode**: Scrape and save metadata in one workflow
- **Real-time Progress**: WebSocket updates show scraping progress
- **Interactive Handling**: UI prompts for CAPTCHA/Cloudflare challenges
- **Actor Search**: Search and scrape actor data from the actors page

### Add New Scraper

Create a new scraper plugin in minutes:

```bash
# 1. Create scraper directory
mkdir scrapers/myscraper

# 2. Create run.js (see SCRAPER_DEVELOPMENT.md for template)
nano scrapers/myscraper/run.js

# 3. Test your scraper
node scrapers/myscraper/run.js TEST-001

# 4. Enable in config.json
# Add "myscraper" to scrapers.video array

# Done! No core code changes needed
```

**No code changes needed!** Each scraper is an independent plugin following a simple contract.

### Documentation

- **[SCRAPER_DEVELOPMENT.md](SCRAPER_DEVELOPMENT.md)** - Quick start guide for creating scrapers ⭐
- **[SCRAPER_IMPLEMENTATION_GUIDE.md](SCRAPER_IMPLEMENTATION_GUIDE.md)** - Comprehensive implementation guide
- **[SCRAPER_MANAGER_USAGE.md](SCRAPER_MANAGER_USAGE.md)** - How to use ScraperManager
- **[SCRAPER_MANAGER.md](SCRAPER_MANAGER.md)** - Technical details
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System design and philosophy
- **[scrapers/README.md](scrapers/README.md)** - Scrapers overview

## Development

### Project Structure

```
javinizer-js/
├── src/
│   ├── core/              # Core business logic
│   │   ├── buildItem.js
│   │   ├── config.js
│   │   ├── libraryReader.js
│   │   ├── nfoMapper.js
│   │   ├── saveNfo.js
│   │   ├── scraperManager.js
│   │   └── actorScraperManager.js
│   ├── lang/              # i18n translation files
│   │   ├── en.json
│   │   ├── it.json
│   │   └── ja.json
│   ├── server/            # Express server
│   │   ├── index.js
│   │   └── routes.js
│   └── web/               # Frontend
│       ├── app.js
│       ├── actors.js
│       ├── i18n.js
│       ├── index.html
│       ├── actors.html
│       └── config.html
├── scrapers/              # Scraper plugins
│   ├── movies/
│   │   ├── javlibrary/
│   │   ├── r18dev/
│   │   └── javdb/
│   └── actors/
│       ├── javdatabase/
│       └── local/
├── data/                  # Runtime data
│   ├── scrape/           # Scraped JSON files
│   └── actors/           # Actor cache and thumbnails
├── config.json           # Configuration (gitignored)
├── Dockerfile            # Docker configuration
├── docker-compose.yml    # Docker Compose setup
└── package.json
```

### Adding a New Language

1. Create `src/lang/XX.json` (where XX is language code)
2. Copy structure from `en.json` and translate all keys
3. Add option to language selector in `navbar.html`:
```html
<option value="xx">Language Name</option>
```

All UI elements use `data-i18n` attributes for automatic translation.

## API Endpoints

### Items
- `GET /item/current` - Get current item
- `GET /item/next` - Get next item
- `GET /item/prev` - Get previous item
- `POST /item/save` - Save changes (PATCH mode)
- `DELETE /item/:id` - Delete item

### Configuration
- `GET /item/config` - Get configuration
- `POST /item/config` - Update configuration

### Localization
- `GET /item/lang/:code` - Get translation file

### File System
- `GET /item/browse?path=...` - Browse directories

### Actors
- `GET /actors` - Get all actors
- `POST /actors` - Create/update actor
- `DELETE /actors/:id` - Delete actor
- `POST /actors/search` - Search for actor data

### Scraping
- WebSocket endpoint for real-time scraping progress

## Roadmap

### Completed ✅
- [x] Scraper integration
- [x] Plugin-based scraper architecture
- [x] Actor management system
- [x] Multi-language support (EN, IT, JA)
- [x] WebUI integration with ScraperManager
- [x] Docker containerization
- [x] Actor scraping and caching
- [x] Real-time scraping progress via WebSocket

### Planned 📋
- [ ] Fanart display support
- [ ] Batch operations (multi-select, bulk edit)
- [ ] Image management (cover, screenshots)
- [ ] Advanced search and filtering
- [ ] Custom field mapping
- [ ] Export/Import functionality
- [ ] API authentication
- [ ] Plugin marketplace

## Docker Deployment

### Using docker-compose (Recommended)

```bash
# Edit docker-compose.yml to configure paths
nano docker-compose.yml

# Start services
docker-compose up -d

# Check logs
docker-compose logs -f javinizer-js

# Stop services
docker-compose down
```

### Manual Docker

```bash
# Build image
docker build -t javinizer-js .

# Run container
docker run -d \
  --name javinizer-js \
  -p 4004:4004 \
  -v /path/to/library:/library:ro \
  -v ./config.json:/config/config.json \
  --shm-size=2gb \
  javinizer-js
```

### Resource Requirements

- **Memory**: 512MB minimum, 2GB recommended (for Chromium-based scrapers)
- **SHM Size**: 2GB (required for Puppeteer/Chromium)
- **CPU**: 1 core minimum, 2+ cores recommended for parallel scraping
- **Disk**: Minimal (stores JSON metadata and actor thumbnails only)

## Contributing

Contributions are welcome! Areas where help is appreciated:

- **New Scrapers**: Add support for additional JAV sites
- **Translations**: Add new language translations
- **Bug Reports**: Report issues via GitHub Issues
- **Feature Requests**: Suggest new features
- **Documentation**: Improve docs and guides

Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

[License to be determined]

## Credits

Inspired by [Javinizer](https://github.com/jvlflame/Javinizer) by jvlflame.

## Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/yourusername/javinizer-js/issues).

## Changelog

### v0.9.0 Beta (2024-12-28)

**Major Features:**
- ✨ Multi-language support (English, Italian, Japanese)
- 👥 Complete actor management system with dedicated page
- 🔍 Actor scraping and caching system
- 🌐 WebSocket-based real-time scraping progress
- 🐳 Docker containerization with docker-compose support
- 🎨 Modernized UI with consistent styling across all pages

**Scraper System:**
- 🔌 Plugin architecture for easy scraper development
- 🎯 Per-field priority configuration
- 📦 Multiple actor scrapers (local, javdatabase)
- 🔄 Intelligent data merging from multiple sources

**Technical Improvements:**
- 🏗️ Modular CSS architecture (separate files for different pages)
- 🔧 Shared modal components for consistency
- ⚡ Retry mechanism for better reliability
- 🐛 Multiple bug fixes and optimizations

**Documentation:**
- 📚 SCRAPER_DEVELOPMENT.md quick start guide
- 📖 Comprehensive implementation guides
- 🐳 Docker deployment documentation
