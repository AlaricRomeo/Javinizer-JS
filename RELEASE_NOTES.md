# Release Notes

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
