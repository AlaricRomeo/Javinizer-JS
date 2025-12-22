# Javinizer-js

A web-based metadata editor for JAV (Japanese Adult Video) libraries, compatible with Jellyfin and Kodi.

## Features

- 📝 **Manual Metadata Editing** - Edit NFO files for your JAV collection
- 🌍 **Multi-language** - Support for English and Italian (extensible)
- 👥 **Actor Management** - Grid-based actor cards with thumbnail support
- 📁 **Library Browser** - Built-in file system browser for library selection
- 💾 **NFO Preservation** - PATCH mode preserves custom NFO fields
- 🎨 **Modern UI** - Clean, responsive two-column layout

## Requirements

- Node.js 16+
- npm or yarn

## Installation

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

### Docker

```bash
# Build image
docker build -t javinizer-js .

# Run with docker-compose
docker-compose up -d
```

Edit `docker-compose.yml` to set your library path before starting.

## Configuration

Edit `config.json`:

```json
{
  "libraryPath": "/path/to/your/jav/library",
  "language": "en"
}
```

### Supported Languages

- `en` - English
- `it` - Italiano

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

Compatible with Jellyfin/Kodi NFO format:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>Movie Title</title>
  <originaltitle>Original Title</originaltitle>
  <id>ID-001</id>
  <premiered>2024-01-01</premiered>
  <director>Director Name</director>
  <studio>Studio Name</studio>
  <genre>Drama</genre>
  <actor>
    <name>Actor Name</name>
    <role>Actress</role>
  </actor>
</movie>
```

## Development

### Project Structure

```
javinizer-js/
├── src/
│   ├── core/          # Core business logic
│   │   ├── buildItem.js
│   │   ├── config.js
│   │   ├── libraryReader.js
│   │   ├── nfoMapper.js
│   │   └── saveNfo.js
│   ├── lang/          # i18n translation files
│   │   ├── en.json
│   │   └── it.json
│   ├── server/        # Express server
│   │   ├── routes.js
│   │   └── server.js
│   └── web/           # Frontend
│       ├── app.js
│       ├── i18n.js
│       ├── i18n-bindings.js
│       └── index.html
├── config.json        # Configuration (gitignored)
├── package.json
└── README.md
```

### Adding a New Language

1. Create `src/lang/XX.json` (where XX is language code)
2. Copy structure from `en.json` and translate
3. Add option to language selector in `index.html`

See `src/lang/README.md` for details.

## API Endpoints

- `GET /item/current` - Get current item
- `GET /item/next` - Get next item
- `GET /item/prev` - Get previous item
- `POST /item/save` - Save changes (PATCH mode)
- `GET /item/config` - Get configuration
- `POST /item/config` - Update configuration
- `GET /item/lang/:code` - Get translation file
- `GET /item/browse?path=...` - Browse directories

## Roadmap

- [ ] Scraper integration (planned)
- [ ] Fanart display support
- [ ] Actor database with autocomplete
- [ ] Batch operations
- [ ] Image management (cover, screenshots)
- [ ] Advanced search and filtering

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

[License to be determined]

## Credits

Inspired by [Javinizer](https://github.com/jvlflame/Javinizer) by jvlflame.

## Support

For issues and feature requests, please use the GitHub issue tracker.
