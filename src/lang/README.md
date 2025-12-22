# Internationalization (i18n)

This directory contains translation files for the Javinizer-js web interface.

## Supported Languages

- **en** - English
- **it** - Italiano (Italian)

## File Structure

Each language file is a JSON file with the following structure:

```json
{
  "app": {
    "title": "Application title"
  },
  "nav": {
    "config": "Navigation links",
    "about": "..."
  },
  "sections": {
    "fanart": "Section titles",
    "..."
  },
  "fields": {
    "id": "Form field labels",
    "..."
  },
  "buttons": {
    "save": "Button labels",
    "..."
  },
  "placeholders": {
    "noImage": "Placeholder text",
    "..."
  },
  "messages": {
    "libraryPathHelp": "Help and info messages",
    "..."
  },
  "actorModal": {
    "title": "Actor modal specific translations",
    "..."
  },
  "settings": {
    "language": "Settings labels"
  }
}
```

## Adding a New Language

1. Create a new file `src/lang/XX.json` (where XX is the language code)
2. Copy the structure from `en.json`
3. Translate all strings to the target language
4. Add the new language option to the language selector in `src/web/index.html`:

```html
<option value="XX">Language Name</option>
```

## Language Configuration

The selected language is stored in `config.json`:

```json
{
  "libraryPath": "/path/to/library",
  "language": "en"
}
```

## Usage in Code

The i18n system provides the following global functions:

- `window.i18n.loadLanguage(langCode)` - Load translation file
- `window.i18n.t(path)` - Get translation by path (e.g., "fields.title")
- `window.i18n.changeLanguage(langCode)` - Change language and reload

Translations are applied automatically on page load and when the language selector changes.
